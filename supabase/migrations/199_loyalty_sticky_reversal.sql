-- ============================================================================
-- 199 — Fidelización: una reversión administrativa NO se deshace sola
-- ============================================================================
-- Verificado en prod (transacción revertida): tras `loyalty_reverse_visit`,
-- cualquier UPDATE posterior de la visita (editar el importe desde el
-- historial) volvía a disparar el trigger, que no encontraba lote vivo y
-- acreditaba uno nuevo. La reversión del dueño duraba hasta la próxima edición.
--
-- Ahora el lote revertido guarda el motivo (`meta.reversal_reason`) y
-- `loyalty_process_visit` sólo re-acredita si la reversión fue la automática
-- por "el servicio no cuenta como visita" (que sí debe deshacerse si el
-- servicio vuelve a contar).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.loyalty_reverse_lot(p_lot_id uuid, p_reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_lot point_transactions%ROWTYPE; v_rev uuid;
BEGIN
  SELECT * INTO v_lot FROM point_transactions WHERE id = p_lot_id AND reversed_by IS NULL FOR UPDATE;
  IF v_lot.id IS NULL THEN RETURN 0; END IF;
  IF v_lot.remaining > 0 THEN
    INSERT INTO point_transactions (client_id, organization_id, points, remaining, type, description, reverses, meta)
    VALUES (v_lot.client_id, v_lot.organization_id, -v_lot.remaining, 0, 'reversal',
            'Reversión: ' || COALESCE(p_reason, 'anulación'), v_lot.id,
            jsonb_build_object('reason', p_reason, 'lot_type', v_lot.type, 'already_spent', v_lot.points - v_lot.remaining))
    RETURNING id INTO v_rev;
  END IF;
  UPDATE point_transactions
     SET remaining = 0, reversed_by = COALESCE(v_rev, v_lot.id),
         meta = meta || jsonb_build_object('reversal_reason', COALESCE(p_reason, 'anulación'), 'reversed_at', now())
   WHERE id = v_lot.id;
  RETURN v_lot.remaining;
END; $$;

CREATE OR REPLACE FUNCTION public.loyalty_process_visit(p_visit_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v visits%ROWTYPE; v_s loyalty_settings%ROWTYPE; v_lot point_transactions%ROWTYPE;
  v_recalc jsonb; v_mult integer; v_calc jsonb; v_pts integer; v_lot_id uuid; v_n integer; v_sticky boolean;
BEGIN
  SELECT * INTO v FROM visits WHERE id = p_visit_id;
  IF v.id IS NULL OR v.client_id IS NULL THEN RETURN jsonb_build_object('skipped', 'no_client'); END IF;
  SELECT * INTO v_s FROM loyalty_settings WHERE organization_id = v.organization_id;
  IF v_s.organization_id IS NULL OR NOT v_s.is_enabled THEN RETURN jsonb_build_object('skipped', 'disabled'); END IF;

  IF NOT loyalty_visit_qualifies(v) THEN
    IF EXISTS (SELECT 1 FROM point_transactions WHERE visit_id = p_visit_id AND type = 'earned' AND reversed_by IS NULL) THEN
      PERFORM loyalty_reverse_visit(p_visit_id, 'el servicio no cuenta como visita');
      PERFORM loyalty_recalc_tier(v.client_id);
    END IF;
    RETURN jsonb_build_object('skipped', 'not_qualifying');
  END IF;

  v_recalc := loyalty_recalc_tier(v.client_id);
  SELECT multiplier_pct INTO v_mult FROM loyalty_tiers
   WHERE organization_id = v.organization_id AND code = v_recalc->>'tier_code';
  v_mult := COALESCE(v_mult, 100);

  -- Una reversión hecha a mano (dueño) o por borrado es definitiva para esta
  -- visita; sólo la automática por servicio no computable se puede rehacer.
  SELECT EXISTS (
    SELECT 1 FROM point_transactions
     WHERE (visit_id = p_visit_id OR meta->>'visit_id' = p_visit_id::text) AND type = 'earned' AND reversed_by IS NOT NULL
       AND COALESCE(meta->>'reversal_reason', '') <> 'el servicio no cuenta como visita'
  ) INTO v_sticky;

  IF v_sticky THEN
    v_pts := 0;
  ELSIF v_s.program_started_at IS NOT NULL AND v.completed_at >= v_s.program_started_at THEN
    v_calc := loyalty_points_for_visit(v, v_s.base_points, v_mult);
    v_pts := (v_calc->>'points')::integer;
    SELECT * INTO v_lot FROM point_transactions
     WHERE visit_id = p_visit_id AND type = 'earned' AND reversed_by IS NULL FOR UPDATE;
    IF v_lot.id IS NULL THEN
      INSERT INTO point_transactions (client_id, organization_id, visit_id, branch_id, points, remaining, type, description, expires_at, meta)
      VALUES (v.client_id, v.organization_id, p_visit_id, v.branch_id, v_pts, v_pts, 'earned',
              'Puntos por tu visita', v.completed_at + make_interval(days => v_s.points_expiry_days),
              v_calc || jsonb_build_object('tier_code', v_recalc->>'tier_code', 'visit_id', p_visit_id))
      RETURNING id INTO v_lot_id;
    ELSIF v_lot.remaining = v_lot.points THEN
      v_lot_id := v_lot.id;
      IF v_lot.points <> v_pts OR v_lot.expires_at IS DISTINCT FROM v.completed_at + make_interval(days => v_s.points_expiry_days) THEN
        UPDATE point_transactions
           SET points = v_pts, remaining = v_pts, branch_id = v.branch_id,
               expires_at = v.completed_at + make_interval(days => v_s.points_expiry_days),
               meta = v_calc || jsonb_build_object('tier_code', v_recalc->>'tier_code', 'visit_id', p_visit_id)
         WHERE id = v_lot.id;
      END IF;
    ELSE
      v_lot_id := v_lot.id; v_pts := v_lot.points;
      IF v_lot.points <> (v_calc->>'points')::integer THEN
        PERFORM loyalty_log_event(v.organization_id, v.client_id, 'error', p_visit_id,
          jsonb_build_object('what', 'lot_consumed_cannot_recalc', 'lot_points', v_lot.points, 'new_points', v_calc->>'points'));
      END IF;
    END IF;
  ELSE
    v_pts := 0;
  END IF;

  PERFORM loyalty_grant_welcome_bonus(v.client_id);
  PERFORM loyalty_complete_referral_for_visit(p_visit_id);

  v_n := (v_recalc->>'visits_in_window')::integer;
  IF (v_recalc->>'visits_to_next')::integer = 1 THEN
    PERFORM loyalty_notify(v.organization_id, v.client_id, 'near_tier',
      jsonb_build_object('categoria_siguiente', v_recalc->>'next_tier_name', 'visitas', v_n::text),
      'near_tier:' || (v_recalc->>'next_tier_code') || ':' || to_char(now(), 'IYYY-IW'));
  END IF;

  RETURN v_recalc || jsonb_build_object('points', COALESCE(v_pts, 0), 'lot_id', v_lot_id, 'multiplier_pct', v_mult, 'sticky_reversal', v_sticky);
END; $$;
