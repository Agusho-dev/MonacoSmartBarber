-- ============================================================================
-- 203 — Fidelización: correcciones de la revisión adversarial (SQL)
-- ============================================================================
-- 1. `loyalty_finalize_visit.tier_changed` llegaba SIEMPRE null a la tablet:
--    el trigger de la visita ya había consumido la subida/enrolamiento/gracia
--    antes de que finalize corriera. Ahora el cambio se lee de los eventos del
--    cliente registrados desde que la visita se creó.
-- 2. Un premio acotado a un servicio (`reward_catalog.service_id`) descontaba
--    sobre TODO el subtotal. Ahora el % se calcula sobre el precio vigente de
--    ESE servicio (spec §4: "el sistema toma el precio vigente del servicio").
-- 3. `loyalty_notification_rules.days_before` era un campo muerto: el cron
--    usaba `expiring_soon_days` y un 3 literal. Ahora la anticipación de los
--    avisos `points_expiring` y `tier_grace_reminder` sale de la regla (con el
--    valor viejo como fallback si está vacía). `expiring_soon_days` sigue
--    siendo la ventana de "por vencer" que muestra la app.
-- 4. La devolución de un canje cancelado contaba como "emitidos"/"ganados" y
--    el canje cancelado seguía contando como "canjeado". Las filas `reversal`
--    quedan fuera de esos agregados y el canje cancelado lleva `reversed_by`.
-- 5. `loyalty_cancel_client_reward` y `loyalty_reverse_visit` aceptan quién lo
--    hizo (`p_staff_id`, `p_actor_user_id`) y lo dejan en el evento. Como las
--    firmas cambian, se DROPean las viejas: con DEFAULTs, las llamadas de 2/3
--    argumentos (triggers, finalize) serían ambiguas.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. tier_changed desde los eventos
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.loyalty_finalize_visit(p_visit_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v visits%ROWTYPE; v_res jsonb; v_balance integer; v_lot point_transactions%ROWTYPE; v_tier loyalty_tiers%ROWTYPE;
  v_state client_loyalty_state%ROWTYPE; v_reward reward_catalog%ROWTYPE; v_before integer; v_change text;
BEGIN
  SELECT * INTO v FROM visits WHERE id = p_visit_id;
  IF v.id IS NULL OR v.client_id IS NULL THEN RETURN jsonb_build_object('enabled', false); END IF;
  v_res := loyalty_process_visit(p_visit_id);
  IF v_res ? 'skipped' THEN RETURN jsonb_build_object('enabled', false, 'reason', v_res->>'skipped'); END IF;

  SELECT * INTO v_state FROM client_loyalty_state WHERE client_id = v.client_id;
  SELECT * INTO v_tier FROM loyalty_tiers WHERE organization_id = v.organization_id AND code = v_state.tier_code;
  SELECT * INTO v_lot FROM point_transactions WHERE visit_id = p_visit_id AND type = 'earned' AND reversed_by IS NULL;
  v_balance := loyalty_points_balance(v.client_id);
  v_before := v_balance - COALESCE(v_lot.remaining, 0);

  -- El cambio de categoría que produjo ESTA visita: el más reciente de los
  -- eventos del cliente desde que la fila de la visita existe (el trigger de
  -- fila corre en la misma transacción que el INSERT, a veces 1-2 s antes del
  -- UPDATE de completeService).
  SELECT CASE e.kind WHEN 'tier_up' THEN 'up' WHEN 'enrolled' THEN 'enrolled' WHEN 'grace_started' THEN 'grace'
                     WHEN 'tier_down' THEN 'down' WHEN 'grace_recovered' THEN 'recovered' END
    INTO v_change
    FROM loyalty_events e
   WHERE e.client_id = v.client_id AND e.kind IN ('tier_up','enrolled','grace_started','tier_down','grace_recovered')
     AND e.created_at >= v.created_at - interval '2 minutes'
   ORDER BY e.created_at DESC LIMIT 1;
  v_change := COALESCE(v_res->>'change', v_change);

  IF v_lot.id IS NOT NULL AND v_lot.points > 0 AND NOT EXISTS (
       SELECT 1 FROM loyalty_events WHERE visit_id = p_visit_id AND kind = 'points_earned') THEN
    PERFORM loyalty_log_event(v.organization_id, v.client_id, 'points_earned', p_visit_id,
      jsonb_build_object('points', v_lot.points, 'balance', v_balance, 'tier', v_state.tier_code, 'meta', v_lot.meta));
    PERFORM loyalty_notify(v.organization_id, v.client_id, 'points_earned',
      jsonb_build_object('puntos', v_lot.points::text, 'saldo', v_balance::text, 'categoria', v_tier.name), 'earned:' || p_visit_id);
  END IF;

  SELECT * INTO v_reward FROM reward_catalog r
   WHERE r.organization_id = v.organization_id AND r.is_active AND r.points_cost > 0
     AND (r.valid_from IS NULL OR r.valid_from <= now()) AND (r.valid_until IS NULL OR r.valid_until > now())
     AND (r.stock IS NULL OR r.stock > 0)
     AND (r.allowed_tiers IS NULL OR v_state.tier_code = ANY (r.allowed_tiers))
     AND r.points_cost <= v_balance AND r.points_cost > v_before
   ORDER BY r.points_cost ASC LIMIT 1;
  IF v_reward.id IS NOT NULL THEN
    PERFORM loyalty_notify(v.organization_id, v.client_id, 'reward_unlocked',
      jsonb_build_object('premio', v_reward.name, 'saldo', v_balance::text), 'unlocked:' || v_reward.id || ':' || to_char(now(), 'YYYY-MM'));
  ELSE
    SELECT * INTO v_reward FROM reward_catalog r
     WHERE r.organization_id = v.organization_id AND r.is_active AND r.points_cost > 0
       AND (r.valid_from IS NULL OR r.valid_from <= now()) AND (r.valid_until IS NULL OR r.valid_until > now())
       AND (r.stock IS NULL OR r.stock > 0)
       AND (r.allowed_tiers IS NULL OR v_state.tier_code = ANY (r.allowed_tiers))
       AND r.points_cost > v_balance AND (r.points_cost - v_balance) <= GREATEST(r.points_cost * 0.25, 1)
     ORDER BY r.points_cost ASC LIMIT 1;
    IF v_reward.id IS NOT NULL THEN
      PERFORM loyalty_notify(v.organization_id, v.client_id, 'near_reward',
        jsonb_build_object('premio', v_reward.name, 'faltan', (v_reward.points_cost - v_balance)::text, 'saldo', v_balance::text),
        'near_reward:' || v_reward.id || ':' || to_char(now(), 'YYYY-MM'));
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'enabled', true,
    'points_earned', COALESCE(v_lot.points, 0),
    'balance', v_balance,
    'tier_code', v_state.tier_code, 'tier_name', v_tier.name,
    'tier_color_primary', v_tier.color_primary, 'tier_color_secondary', v_tier.color_secondary, 'tier_text_color', v_tier.text_color,
    'tier_changed', v_change,
    'visits_in_window', v_state.visits_in_window,
    'grace_until', v_state.grace_until,
    'next_tier_name', v_res->>'next_tier_name', 'visits_to_next', v_res->'visits_to_next',
    'multiplier_pct', v_res->'multiplier_pct');
END; $$;

-- ----------------------------------------------------------------------------
-- 2. Descuento sobre el precio del servicio acotado
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redeem_coupon_for_visit(p_qr_code text, p_visit_id uuid, p_service_subtotal numeric)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_visit visits%ROWTYPE; v_reward client_rewards%ROWTYPE; v_catalog reward_catalog%ROWTYPE;
  v_pct numeric; v_discount numeric; v_net numeric; v_same_person boolean; v_branch_tz text; v_has_benefit boolean; v_base numeric;
BEGIN
  SELECT * INTO v_visit FROM visits WHERE id = p_visit_id;
  IF v_visit.id IS NULL THEN RETURN json_build_object('success', false, 'error', 'visit_not_found'); END IF;

  SELECT * INTO v_reward FROM client_rewards WHERE qr_code = p_qr_code FOR UPDATE;
  IF v_reward.id IS NULL THEN RETURN json_build_object('success', false, 'error', 'not_found'); END IF;
  IF v_reward.organization_id IS DISTINCT FROM v_visit.organization_id THEN RETURN json_build_object('success', false, 'error', 'wrong_org'); END IF;

  IF v_reward.client_id IS DISTINCT FROM v_visit.client_id THEN
    v_same_person := v_visit.client_id IS NOT NULL AND v_reward.client_id IN (SELECT loyalty_same_person_ids(v_visit.client_id));
    IF NOT COALESCE(v_same_person, false) THEN RETURN json_build_object('success', false, 'error', 'wrong_client'); END IF;
  END IF;

  IF v_reward.status = 'redeemed' THEN RETURN json_build_object('success', false, 'error', 'already_redeemed'); END IF;
  IF v_reward.status = 'cancelled' THEN RETURN json_build_object('success', false, 'error', 'cancelled'); END IF;
  IF v_reward.status <> 'available' THEN RETURN json_build_object('success', false, 'error', 'not_available'); END IF;
  IF v_reward.expires_at IS NOT NULL AND v_reward.expires_at < now() THEN
    UPDATE client_rewards SET status = 'expired' WHERE id = v_reward.id;
    RETURN json_build_object('success', false, 'error', 'expired');
  END IF;

  SELECT * INTO v_catalog FROM reward_catalog WHERE id = v_reward.reward_id;

  IF COALESCE(v_catalog.activation_delay_minutes, 0) > 0
     AND now() < v_reward.created_at + make_interval(mins => v_catalog.activation_delay_minutes) THEN
    RETURN json_build_object('success', false, 'error', 'not_active_yet',
      'activates_at', v_reward.created_at + make_interval(mins => v_catalog.activation_delay_minutes));
  END IF;
  IF v_catalog.redeemable_weekdays IS NOT NULL THEN
    v_branch_tz := loyalty_tz_of_branch(v_visit.branch_id);
    IF NOT (extract(isodow FROM (now() AT TIME ZONE v_branch_tz))::smallint = ANY (v_catalog.redeemable_weekdays)) THEN
      RETURN json_build_object('success', false, 'error', 'wrong_weekday', 'allowed_weekdays', v_catalog.redeemable_weekdays);
    END IF;
  END IF;

  IF v_catalog.kind IN ('merch', 'especial') THEN
    UPDATE client_rewards SET status = 'redeemed', redeemed_at = now(), redeemed_by = v_visit.barber_id,
           delivered_by = v_visit.barber_id, redeemed_visit_id = p_visit_id, redeemed_branch_id = v_visit.branch_id
     WHERE id = v_reward.id AND status = 'available';
    IF NOT FOUND THEN RETURN json_build_object('success', false, 'error', 'already_redeemed'); END IF;
    PERFORM loyalty_log_event(v_reward.organization_id, v_reward.client_id, 'reward_used', p_visit_id,
      jsonb_build_object('client_reward_id', v_reward.id, 'reward_name', v_catalog.name, 'kind', v_catalog.kind));
    RETURN json_build_object('success', true, 'client_reward_id', v_reward.id, 'reward_name', v_catalog.name,
      'kind', v_catalog.kind, 'discount_pct', 0, 'is_free_service', false, 'discount_amount', 0, 'net_amount', v_visit.amount);
  END IF;

  IF v_catalog.service_id IS NOT NULL AND v_visit.service_id IS NOT NULL AND v_catalog.service_id <> v_visit.service_id
     AND NOT (v_catalog.service_id = ANY (COALESCE(v_visit.extra_services, '{}'::uuid[]))) THEN
    RETURN json_build_object('success', false, 'error', 'wrong_service',
      'service_name', (SELECT name FROM services WHERE id = v_catalog.service_id));
  END IF;

  v_has_benefit := COALESCE(v_visit.discount_amount, 0) > 0 OR v_visit.client_reward_id IS NOT NULL
                   OR EXISTS (SELECT 1 FROM referrals WHERE visit_id = p_visit_id AND status IN ('pending','completed'));
  IF v_has_benefit AND NOT v_catalog.allow_stacking THEN
    RETURN json_build_object('success', false, 'error', 'no_stacking');
  END IF;

  v_pct := CASE WHEN v_catalog.is_free_service THEN 100 ELSE COALESCE(v_catalog.discount_pct, 0) END;
  -- Base del descuento: el precio vigente del servicio acotado (spec §4) o,
  -- sin servicio acotado, el subtotal de servicios del cobro. Nunca más que
  -- el subtotal ni que lo cobrado.
  v_base := GREATEST(p_service_subtotal, 0);
  IF v_catalog.service_id IS NOT NULL THEN
    SELECT LEAST(COALESCE(price, v_base), v_base) INTO v_base FROM services WHERE id = v_catalog.service_id;
    v_base := COALESCE(v_base, GREATEST(p_service_subtotal, 0));
  END IF;
  v_discount := LEAST(round(v_base * v_pct / 100.0), GREATEST(v_visit.amount, 0));
  IF v_pct <= 0 OR v_discount <= 0 THEN RETURN json_build_object('success', false, 'error', 'no_discount'); END IF;

  UPDATE client_rewards SET status = 'redeemed', redeemed_at = now(), redeemed_by = v_visit.barber_id,
         redeemed_visit_id = p_visit_id, redeemed_branch_id = v_visit.branch_id
   WHERE id = v_reward.id AND status = 'available';
  IF NOT FOUND THEN RETURN json_build_object('success', false, 'error', 'already_redeemed'); END IF;

  v_net := GREATEST(v_visit.amount - v_discount, 0);
  UPDATE visits SET amount = v_net, discount_amount = COALESCE(discount_amount, 0) + v_discount, client_reward_id = v_reward.id
   WHERE id = p_visit_id;
  PERFORM loyalty_log_event(v_reward.organization_id, v_reward.client_id, 'reward_used', p_visit_id,
    jsonb_build_object('client_reward_id', v_reward.id, 'reward_name', v_catalog.name, 'kind', v_catalog.kind, 'discount_amount', v_discount, 'base', v_base));

  RETURN json_build_object('success', true, 'client_reward_id', v_reward.id, 'reward_name', v_catalog.name, 'kind', v_catalog.kind,
    'discount_pct', v_catalog.discount_pct, 'is_free_service', v_catalog.is_free_service, 'discount_amount', v_discount, 'net_amount', v_net,
    'service_id', v_catalog.service_id, 'base_amount', v_base);
END; $$;

-- ----------------------------------------------------------------------------
-- 3. El cron lee days_before de la regla
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.loyalty_daily_maintenance()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record; v_expired integer := 0; v_notified integer := 0; v_recalc integer := 0; v_rewards integer := 0; v_reminders integer := 0; v_res jsonb; v_tz text;
BEGIN
  FOR r IN SELECT id, client_id, organization_id, remaining, expires_at FROM point_transactions
            WHERE remaining > 0 AND expires_at IS NOT NULL AND expires_at <= now() FOR UPDATE SKIP LOCKED LOOP
    INSERT INTO point_transactions (client_id, organization_id, points, remaining, type, description, reverses, meta)
    VALUES (r.client_id, r.organization_id, -r.remaining, 0, 'expired', 'Puntos vencidos', r.id, jsonb_build_object('lot_id', r.id, 'expired_at', r.expires_at));
    UPDATE point_transactions SET remaining = 0 WHERE id = r.id;
    PERFORM loyalty_log_event(r.organization_id, r.client_id, 'points_expired', NULL, jsonb_build_object('points', r.remaining, 'lot_id', r.id));
    v_expired := v_expired + 1;
  END LOOP;

  -- Aviso de vencimiento: anticipación = loyalty_notification_rules.days_before
  -- (fallback: expiring_soon_days), una vez por lote.
  FOR r IN SELECT t.id, t.client_id, t.organization_id, t.remaining, t.expires_at
             FROM point_transactions t
             JOIN loyalty_settings s ON s.organization_id = t.organization_id AND s.is_enabled
             LEFT JOIN loyalty_notification_rules nr ON nr.organization_id = t.organization_id AND nr.kind = 'points_expiring'
            WHERE t.remaining > 0 AND t.expires_at > now()
              AND t.expires_at <= now() + make_interval(days => GREATEST(COALESCE(nr.days_before, s.expiring_soon_days), 1)) LOOP
    v_tz := loyalty_tz_of_branch((SELECT branch_id FROM visits WHERE client_id = r.client_id ORDER BY completed_at DESC LIMIT 1));
    IF loyalty_notify(r.organization_id, r.client_id, 'points_expiring',
         jsonb_build_object('puntos', r.remaining::text,
                            'dias', GREATEST(ceil(extract(epoch FROM (r.expires_at - now())) / 86400.0)::integer, 1)::text,
                            'fecha', to_char(r.expires_at AT TIME ZONE v_tz, 'DD/MM')),
         'expiring:' || r.id) THEN v_notified := v_notified + 1; END IF;
  END LOOP;

  FOR r IN SELECT st.client_id, st.grace_until, st.tier_code FROM client_loyalty_state st
             JOIN loyalty_settings s ON s.organization_id = st.organization_id AND s.is_enabled
            WHERE st.tier_code IS NOT NULL LOOP
    v_res := loyalty_recalc_tier(r.client_id);
    IF v_res->>'change' IS NOT NULL THEN v_recalc := v_recalc + 1; END IF;
  END LOOP;

  -- Recordatorio de gracia: N días antes (days_before de la regla; fallback 3),
  -- una vez por gracia.
  FOR r IN SELECT st.client_id, st.organization_id, st.grace_until, t.name
             FROM client_loyalty_state st
             JOIN loyalty_tiers t ON t.organization_id = st.organization_id AND t.code = st.tier_code
             JOIN loyalty_settings s ON s.organization_id = st.organization_id AND s.is_enabled
             LEFT JOIN loyalty_notification_rules nr ON nr.organization_id = st.organization_id AND nr.kind = 'tier_grace_reminder'
            WHERE st.grace_until IS NOT NULL AND st.grace_until > now()
              AND st.grace_until <= now() + make_interval(days => GREATEST(COALESCE(nr.days_before, 3), 1)) LOOP
    IF loyalty_notify(r.organization_id, r.client_id, 'tier_grace_reminder',
         jsonb_build_object('categoria', r.name, 'dias', GREATEST(ceil(extract(epoch FROM (r.grace_until - now())) / 86400.0)::integer, 1)::text),
         'grace_reminder:' || to_char(r.grace_until, 'YYYY-MM-DD')) THEN v_reminders := v_reminders + 1; END IF;
  END LOOP;

  WITH x AS (UPDATE client_rewards SET status = 'expired' WHERE status = 'available' AND expires_at IS NOT NULL AND expires_at < now() RETURNING 1)
  SELECT count(*) INTO v_rewards FROM x;

  RETURN jsonb_build_object('lots_expired', v_expired, 'expiring_notified', v_notified, 'tier_changes', v_recalc,
                            'grace_reminders', v_reminders, 'rewards_expired', v_rewards, 'ran_at', now());
END; $$;

-- ----------------------------------------------------------------------------
-- 4. Devoluciones fuera de "emitidos"/"ganados"; canje cancelado = reversed_by
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_client_global_points()
RETURNS TABLE (total_balance integer, total_earned integer, total_redeemed integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT loyalty_points_balance(public.current_client_id()),
         COALESCE(SUM(points) FILTER (WHERE points > 0 AND type <> 'reversal'), 0)::integer,
         COALESCE(-SUM(points) FILTER (WHERE type = 'redeemed' AND reversed_by IS NULL), 0)::integer
  FROM point_transactions WHERE client_id = public.current_client_id();
$$;

CREATE OR REPLACE FUNCTION public.get_client_loyalty()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_client clients%ROWTYPE; v_s loyalty_settings%ROWTYPE; v_state client_loyalty_state%ROWTYPE;
  v_tier loyalty_tiers%ROWTYPE; v_next loyalty_tiers%ROWTYPE; v_after loyalty_tiers%ROWTYPE;
  v_balance integer; v_soon integer; v_next_exp timestamptz; v_next_exp_pts integer; v_member timestamptz;
  v_earned integer; v_redeemed integer; v_ref_done integer; v_tiers jsonb; v_preview boolean := false; v_enabled boolean;
BEGIN
  SELECT * INTO v_client FROM clients WHERE id = public.current_client_id();
  IF v_client.id IS NULL THEN RETURN jsonb_build_object('program', jsonb_build_object('enabled', false), 'error', 'client_not_found'); END IF;
  SELECT * INTO v_s FROM loyalty_settings WHERE organization_id = v_client.organization_id;
  SELECT * INTO v_state FROM client_loyalty_state WHERE client_id = v_client.id;
  v_preview := v_state.preview_until IS NOT NULL AND v_state.preview_until > now() AND v_state.tier_code IS NOT NULL;
  v_enabled := v_s.organization_id IS NOT NULL AND (v_s.is_enabled OR v_preview);

  SELECT COALESCE(jsonb_agg(loyalty_tier_json(t) ORDER BY t.sort_order), '[]'::jsonb) INTO v_tiers
    FROM loyalty_tiers t WHERE t.organization_id = v_client.organization_id AND t.is_active;
  SELECT COALESCE(SUM(points) FILTER (WHERE points > 0 AND type <> 'reversal'), 0),
         COALESCE(-SUM(points) FILTER (WHERE type = 'redeemed' AND reversed_by IS NULL), 0)
    INTO v_earned, v_redeemed FROM point_transactions WHERE client_id = v_client.id;

  IF NOT v_enabled THEN
    RETURN jsonb_build_object(
      'program', jsonb_build_object('enabled', false, 'reward_validity_days', COALESCE(v_s.reward_validity_days, 30)),
      'client', jsonb_build_object('id', v_client.id, 'name', v_client.name, 'member_since', v_client.created_at),
      'tier', NULL, 'next_tier', NULL, 'visits_in_window', 0, 'grace', NULL,
      'points', jsonb_build_object('balance', loyalty_points_balance(v_client.id), 'expiring_soon_points', 0, 'next_expiry_at', NULL,
                                   'next_expiry_points', 0, 'earned_total', v_earned, 'redeemed_total', v_redeemed),
      'referral', jsonb_build_object('enabled', false), 'tiers', v_tiers);
  END IF;

  IF v_s.is_enabled THEN
    PERFORM loyalty_recalc_tier(v_client.id);
    PERFORM loyalty_grant_welcome_bonus(v_client.id);
    SELECT * INTO v_state FROM client_loyalty_state WHERE client_id = v_client.id;
  END IF;
  SELECT * INTO v_tier FROM loyalty_tiers WHERE organization_id = v_client.organization_id AND code = v_state.tier_code;
  SELECT * INTO v_next FROM loyalty_tiers WHERE organization_id = v_client.organization_id AND is_active AND sort_order = v_state.tier_sort + 1;
  SELECT * INTO v_after FROM loyalty_tiers WHERE organization_id = v_client.organization_id AND is_active AND sort_order = v_state.tier_sort - 1;

  v_balance := loyalty_points_balance(v_client.id);
  SELECT COALESCE(SUM(remaining), 0) INTO v_soon FROM point_transactions
   WHERE client_id = v_client.id AND remaining > 0 AND expires_at > now() AND expires_at <= now() + make_interval(days => v_s.expiring_soon_days);
  SELECT expires_at, SUM(remaining) INTO v_next_exp, v_next_exp_pts FROM point_transactions
   WHERE client_id = v_client.id AND remaining > 0 AND expires_at > now() GROUP BY expires_at ORDER BY expires_at ASC LIMIT 1;
  SELECT COALESCE(SUM(points) FILTER (WHERE points > 0 AND type <> 'reversal'), 0),
         COALESCE(-SUM(points) FILTER (WHERE type = 'redeemed' AND reversed_by IS NULL), 0)
    INTO v_earned, v_redeemed FROM point_transactions WHERE client_id = v_client.id;
  SELECT LEAST(v_client.created_at, COALESCE(min(completed_at), v_client.created_at)) INTO v_member FROM visits WHERE client_id = v_client.id;
  SELECT count(*) INTO v_ref_done FROM referrals WHERE referrer_client_id = v_client.id AND status = 'completed';

  RETURN jsonb_build_object(
    'program', jsonb_build_object('enabled', true, 'preview', v_preview AND NOT v_s.is_enabled, 'started_at', v_s.program_started_at,
      'base_points', v_s.base_points, 'expiry_days', v_s.points_expiry_days, 'window_weeks', v_s.window_weeks, 'grace_days', v_s.grace_days,
      'welcome_bonus_points', v_s.welcome_bonus_points, 'reward_validity_days', v_s.reward_validity_days),
    'client', jsonb_build_object('id', v_client.id, 'name', v_client.name, 'member_since', v_member),
    'tier', CASE WHEN v_tier.id IS NULL THEN NULL ELSE loyalty_tier_json(v_tier) || jsonb_build_object('reached_at', v_state.tier_reached_at) END,
    'next_tier', CASE WHEN v_next.id IS NULL THEN NULL ELSE loyalty_tier_json(v_next) || jsonb_build_object('faltan', GREATEST(v_next.min_visits - v_state.visits_in_window, 0)) END,
    'visits_in_window', COALESCE(v_state.visits_in_window, 0),
    'grace', CASE WHEN v_state.grace_until IS NULL THEN NULL ELSE jsonb_build_object(
        'until', v_state.grace_until, 'days_left', GREATEST(ceil(extract(epoch FROM (v_state.grace_until - now())) / 86400.0)::integer, 0),
        'tier_after_code', v_after.code, 'tier_after_name', v_after.name) END,
    'points', jsonb_build_object('balance', v_balance, 'expiring_soon_points', v_soon, 'expiring_soon_days', v_s.expiring_soon_days,
      'next_expiry_at', v_next_exp, 'next_expiry_points', COALESCE(v_next_exp_pts, 0), 'earned_total', v_earned, 'redeemed_total', v_redeemed),
    'referral', jsonb_build_object('enabled', v_s.referral_enabled
        AND (v_s.referral_valid_from IS NULL OR v_s.referral_valid_from <= now())
        AND (v_s.referral_valid_until IS NULL OR v_s.referral_valid_until > now()),
      'code', v_client.referral_code, 'discount_pct', v_s.referral_new_client_discount_pct,
      'referred_points', v_s.referral_new_client_points, 'referrer_points', v_s.referral_referrer_points, 'completed_count', v_ref_done),
    'tiers', v_tiers);
END; $$;

CREATE OR REPLACE FUNCTION public.loyalty_dashboard_overview(p_org uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_s loyalty_settings%ROWTYPE; v_tiers jsonb; v_pts jsonb; v_rewards jsonb; v_refs jsonb; v_events jsonb; v_grace integer; v_dist jsonb;
BEGIN
  SELECT * INTO v_s FROM loyalty_settings WHERE organization_id = p_org;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('code', t.code, 'name', t.name, 'sort', t.sort_order,
           'color_primary', t.color_primary, 'color_secondary', t.color_secondary, 'text_color', t.text_color,
           'count', (SELECT count(*) FROM client_loyalty_state s WHERE s.organization_id = p_org AND s.tier_code = t.code),
           'in_grace', (SELECT count(*) FROM client_loyalty_state s WHERE s.organization_id = p_org AND s.tier_code = t.code AND s.grace_until IS NOT NULL))
           ORDER BY t.sort_order), '[]'::jsonb)
    INTO v_tiers FROM loyalty_tiers t WHERE t.organization_id = p_org;
  SELECT jsonb_build_object(
      'issued_30d', COALESCE(SUM(points) FILTER (WHERE points > 0 AND type <> 'reversal' AND created_at > now() - interval '30 days'), 0),
      'redeemed_30d', COALESCE(-SUM(points) FILTER (WHERE type = 'redeemed' AND reversed_by IS NULL AND created_at > now() - interval '30 days'), 0),
      'expired_30d', COALESCE(-SUM(points) FILTER (WHERE type = 'expired' AND created_at > now() - interval '30 days'), 0),
      'live_balance', COALESCE(SUM(remaining) FILTER (WHERE remaining > 0 AND (expires_at IS NULL OR expires_at > now())), 0),
      'expiring_30d', COALESCE(SUM(remaining) FILTER (WHERE remaining > 0 AND expires_at > now() AND expires_at <= now() + interval '30 days'), 0),
      'clients_with_points', count(DISTINCT client_id) FILTER (WHERE remaining > 0 AND (expires_at IS NULL OR expires_at > now())))
    INTO v_pts FROM point_transactions WHERE organization_id = p_org;
  SELECT jsonb_build_object(
      'available', count(*) FILTER (WHERE status = 'available'),
      'used_30d', count(*) FILTER (WHERE status = 'redeemed' AND redeemed_at > now() - interval '30 days'),
      'expired_30d', count(*) FILTER (WHERE status = 'expired' AND expires_at > now() - interval '30 days'))
    INTO v_rewards FROM client_rewards WHERE organization_id = p_org AND source = 'points_redemption';
  SELECT jsonb_build_object(
      'completed_30d', count(*) FILTER (WHERE status = 'completed' AND completed_at > now() - interval '30 days'),
      'completed_total', count(*) FILTER (WHERE status = 'completed'),
      'pending', count(*) FILTER (WHERE status = 'pending'))
    INTO v_refs FROM referrals WHERE organization_id = p_org;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'client_id', e.client_id, 'client_name', c.name,
           'data', e.data, 'created_at', e.created_at) ORDER BY e.created_at DESC), '[]'::jsonb)
    INTO v_events
    FROM (SELECT * FROM loyalty_events WHERE organization_id = p_org AND kind <> 'notification_sent' ORDER BY created_at DESC LIMIT 30) e
    LEFT JOIN clients c ON c.id = e.client_id;
  SELECT count(*) INTO v_grace FROM client_loyalty_state WHERE organization_id = p_org AND grace_until IS NOT NULL;
  IF v_s.organization_id IS NOT NULL THEN
    v_dist := loyalty_preview_distribution(p_org, v_s.window_weeks, ARRAY[
      COALESCE((SELECT min_visits FROM loyalty_tiers WHERE organization_id = p_org AND code = 'plata'), 3),
      COALESCE((SELECT min_visits FROM loyalty_tiers WHERE organization_id = p_org AND code = 'oro'), 6),
      COALESCE((SELECT min_visits FROM loyalty_tiers WHERE organization_id = p_org AND code = 'platinum'), 9)]);
  END IF;
  RETURN jsonb_build_object('settings', to_jsonb(v_s), 'tiers', v_tiers, 'points', v_pts, 'rewards', v_rewards,
    'referrals', v_refs, 'events', v_events, 'in_grace', v_grace, 'distribution_preview', v_dist,
    'errors_7d', (SELECT count(*) FROM loyalty_events WHERE organization_id = p_org AND kind = 'error' AND created_at > now() - interval '7 days'));
END; $$;

-- ----------------------------------------------------------------------------
-- 5. Quién canceló / revirtió (firmas nuevas: DROP de las viejas)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.loyalty_cancel_client_reward(uuid, text, boolean);
CREATE FUNCTION public.loyalty_cancel_client_reward(p_client_reward_id uuid, p_reason text, p_refund boolean DEFAULT true,
                                                    p_staff_id uuid DEFAULT NULL, p_actor_user_id uuid DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_cr client_rewards%ROWTYPE; v_s loyalty_settings%ROWTYPE; r record; v_restored integer := 0; v_tx uuid;
BEGIN
  SELECT * INTO v_cr FROM client_rewards WHERE id = p_client_reward_id FOR UPDATE;
  IF v_cr.id IS NULL THEN RETURN json_build_object('success', false, 'error', 'not_found'); END IF;
  IF v_cr.status <> 'available' THEN RETURN json_build_object('success', false, 'error', 'not_available'); END IF;
  UPDATE client_rewards SET status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason WHERE id = v_cr.id;
  UPDATE reward_catalog SET stock = stock + 1 WHERE id = v_cr.reward_id AND stock IS NOT NULL;

  IF p_refund AND v_cr.redemption_tx_id IS NOT NULL THEN
    SELECT * INTO v_s FROM loyalty_settings WHERE organization_id = v_cr.organization_id;
    INSERT INTO point_transactions (client_id, organization_id, points, remaining, type, description, reverses, meta)
    VALUES (v_cr.client_id, v_cr.organization_id, v_cr.points_spent, 0, 'reversal', 'Devolución: ' || COALESCE(p_reason, 'canje cancelado'),
            v_cr.redemption_tx_id, jsonb_build_object('client_reward_id', v_cr.id, 'staff_id', p_staff_id, 'actor_user_id', p_actor_user_id))
    RETURNING id INTO v_tx;
    -- El canje queda marcado como revertido: deja de contar en "canjeados".
    UPDATE point_transactions SET reversed_by = v_tx WHERE id = v_cr.redemption_tx_id;
    FOR r IN SELECT c.lot_tx_id, c.points, l.expires_at FROM point_lot_consumptions c JOIN point_transactions l ON l.id = c.lot_tx_id
              WHERE c.redemption_tx_id = v_cr.redemption_tx_id LOOP
      IF r.expires_at IS NULL OR r.expires_at > now() THEN
        UPDATE point_transactions SET remaining = remaining + r.points WHERE id = r.lot_tx_id;
      ELSE
        INSERT INTO point_transactions (client_id, organization_id, points, remaining, type, description, expires_at, meta)
        VALUES (v_cr.client_id, v_cr.organization_id, r.points, r.points, 'reversal', 'Devolución de canje',
                now() + make_interval(days => COALESCE(v_s.points_expiry_days, 120)), jsonb_build_object('client_reward_id', v_cr.id));
      END IF;
      v_restored := v_restored + r.points;
    END LOOP;
  END IF;
  PERFORM loyalty_log_event(v_cr.organization_id, v_cr.client_id, 'reward_cancelled', NULL,
    jsonb_build_object('client_reward_id', v_cr.id, 'reason', p_reason, 'points_restored', v_restored,
                       'staff_id', p_staff_id, 'actor_user_id', p_actor_user_id));
  RETURN json_build_object('success', true, 'points_restored', v_restored);
END; $$;

DROP FUNCTION IF EXISTS public.loyalty_reverse_visit(uuid, text);
CREATE FUNCTION public.loyalty_reverse_visit(p_visit_id uuid, p_reason text DEFAULT 'visita anulada',
                                             p_staff_id uuid DEFAULT NULL, p_actor_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_lot point_transactions%ROWTYPE; v_ref referrals%ROWTYPE; v_reverted integer := 0; v_client uuid; v_org uuid; v_spent integer := 0;
BEGIN
  SELECT * INTO v_lot FROM point_transactions
   WHERE (visit_id = p_visit_id OR meta->>'visit_id' = p_visit_id::text) AND type = 'earned' AND reversed_by IS NULL
   LIMIT 1;
  IF v_lot.id IS NOT NULL THEN
    v_client := v_lot.client_id; v_org := v_lot.organization_id; v_spent := v_lot.points - v_lot.remaining;
    v_reverted := loyalty_reverse_lot(v_lot.id, p_reason);
  END IF;

  SELECT * INTO v_ref FROM referrals WHERE visit_id = p_visit_id AND status IN ('pending','completed') FOR UPDATE;
  IF v_ref.id IS NOT NULL THEN
    v_client := COALESCE(v_client, v_ref.referred_client_id); v_org := COALESCE(v_org, v_ref.organization_id);
    IF v_ref.referred_tx_id IS NOT NULL THEN PERFORM loyalty_reverse_lot(v_ref.referred_tx_id, 'referido anulado'); END IF;
    IF v_ref.referrer_tx_id IS NOT NULL THEN PERFORM loyalty_reverse_lot(v_ref.referrer_tx_id, 'referido anulado'); END IF;
    UPDATE referrals SET status = 'cancelled', rejection_reason = p_reason WHERE id = v_ref.id;
    PERFORM loyalty_log_event(v_ref.organization_id, v_ref.referrer_client_id, 'referral_cancelled', p_visit_id,
      jsonb_build_object('referral_id', v_ref.id, 'reason', p_reason, 'staff_id', p_staff_id, 'actor_user_id', p_actor_user_id));
  END IF;

  IF v_client IS NOT NULL THEN
    PERFORM loyalty_log_event(v_org, v_client, 'reversal', p_visit_id,
      jsonb_build_object('points_reverted', v_reverted, 'points_already_spent', v_spent, 'reason', p_reason, 'lot_id', v_lot.id,
                         'staff_id', p_staff_id, 'actor_user_id', p_actor_user_id));
  END IF;
  RETURN jsonb_build_object('points_reverted', v_reverted, 'points_already_spent', v_spent, 'referral_cancelled', v_ref.id IS NOT NULL);
END; $$;

-- Grants de las firmas nuevas (el loop de la 197 no vuelve a correr).
REVOKE ALL ON FUNCTION public.loyalty_cancel_client_reward(uuid, text, boolean, uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.loyalty_cancel_client_reward(uuid, text, boolean, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.loyalty_reverse_visit(uuid, text, uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.loyalty_reverse_visit(uuid, text, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.get_client_loyalty() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_client_loyalty() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_client_global_points() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_client_global_points() TO authenticated, service_role;
