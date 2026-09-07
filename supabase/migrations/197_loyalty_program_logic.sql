-- ============================================================================
-- 197 — Programa de fidelización Monaco: LÓGICA (funciones, triggers, cron)
-- ============================================================================
-- Requiere la 196 (esquema). Todas las funciones son SECURITY DEFINER con
-- search_path fijo. Grants: las RPC del cliente (auth.uid()) a authenticated;
-- todo lo demás sólo service_role (dashboard, cobro, cron).
--
-- Invariantes que sostiene este archivo:
--   · El saldo NO es un contador: es SUM(remaining) de los lotes vivos.
--   · Un fallo del programa jamás bloquea un cobro (trigger con EXCEPTION →
--     fila `error` en loyalty_events, visible en el dashboard).
--   · Toda acreditación por visita es idempotente por visit_id: la visita se
--     escribe en 2-3 fases (trigger de fila → UPDATE de completeService →
--     UPDATE del cupón) y el lote se recalcula mientras nadie lo consumió.
--   · Subir de categoría es inmediato; bajar pasa por gracia y de a UN escalón.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Helpers
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.loyalty_tz_of_branch(p_branch_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((SELECT timezone FROM branches WHERE id = p_branch_id), 'America/Argentina/Buenos_Aires');
$$;

-- Visitas válidas del cliente en la ventana móvil, contadas por DÍA local
-- (dos filas el mismo día = una atención; spec §2).
CREATE OR REPLACE FUNCTION public.loyalty_visits_in_window(p_client_id uuid, p_now timestamptz, p_weeks integer)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT count(DISTINCT (v.completed_at AT TIME ZONE COALESCE(b.timezone, 'America/Argentina/Buenos_Aires'))::date)::integer
  FROM visits v
  LEFT JOIN branches b ON b.id = v.branch_id
  LEFT JOIN services s ON s.id = v.service_id
  WHERE v.client_id = p_client_id
    AND v.completed_at > p_now - make_interval(weeks => p_weeks)
    AND v.completed_at <= p_now
    AND (v.service_id IS NOT NULL OR v.queue_entry_id IS NOT NULL)
    AND (v.service_id IS NULL OR COALESCE(s.counts_as_visit, true));
$$;

CREATE OR REPLACE FUNCTION public.loyalty_points_balance(p_client_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(SUM(remaining), 0)::integer
  FROM point_transactions
  WHERE client_id = p_client_id AND remaining > 0 AND (expires_at IS NULL OR expires_at > now());
$$;

-- Renderiza {{clave}} desde un jsonb plano. Claves desconocidas quedan vacías.
CREATE OR REPLACE FUNCTION public.loyalty_render(p_tpl text, p_vars jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v_out text := COALESCE(p_tpl, ''); r record;
BEGIN
  FOR r IN SELECT key, value FROM jsonb_each_text(COALESCE(p_vars, '{}'::jsonb)) LOOP
    v_out := replace(v_out, '{{' || r.key || '}}', COALESCE(r.value, ''));
  END LOOP;
  RETURN regexp_replace(v_out, '\{\{[a-z_]+\}\}', '', 'g');
END; $$;

CREATE OR REPLACE FUNCTION public.loyalty_log_event(p_org uuid, p_client_id uuid, p_kind text, p_visit_id uuid, p_data jsonb)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO loyalty_events (organization_id, client_id, kind, visit_id, data)
  VALUES (p_org, p_client_id, p_kind, p_visit_id, COALESCE(p_data, '{}'::jsonb))
  RETURNING id;
$$;

-- Mismo criterio de identidad que find_client_id_by_phone / redeem_coupon_for_visit:
-- misma org + últimos 10 dígitos (no degenerados). Incluye al propio cliente.
CREATE OR REPLACE FUNCTION public.loyalty_same_person_ids(p_client_id uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH me AS (SELECT organization_id, phone_tail(phone) AS tail FROM clients WHERE id = p_client_id)
  SELECT p_client_id
  UNION
  SELECT c.id FROM clients c, me
   WHERE c.organization_id = me.organization_id
     AND length(me.tail) >= 8 AND me.tail !~ '^(.)\1*$'
     AND phone_tail(c.phone) = me.tail;
$$;

-- ----------------------------------------------------------------------------
-- 1. Notificaciones: bandeja in-app SIEMPRE + push (si hay token, lo manda la
--    edge function send-push, que reutiliza la fila de bandeja por
--    data.inbox_notification_id en vez de insertar otra).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.loyalty_notify(p_org uuid, p_client_id uuid, p_kind text, p_vars jsonb, p_dedupe_key text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_rule loyalty_notification_rules%ROWTYPE;
  v_pref boolean; v_title text; v_body text; v_push_kind text; v_deep text;
  v_notif_id uuid; v_outbox_id uuid; v_vars jsonb; v_name text;
BEGIN
  SELECT * INTO v_rule FROM loyalty_notification_rules WHERE organization_id = p_org AND kind = p_kind;
  IF v_rule.id IS NULL OR NOT v_rule.is_enabled THEN RETURN false; END IF;

  IF p_dedupe_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM loyalty_events WHERE client_id = p_client_id AND kind = 'notification_sent' AND data->>'key' = p_dedupe_key
  ) THEN RETURN false; END IF;

  SELECT rewards INTO v_pref FROM client_notification_preferences WHERE client_id = p_client_id;
  IF v_pref IS FALSE THEN RETURN false; END IF;

  SELECT name INTO v_name FROM clients WHERE id = p_client_id;
  v_vars := COALESCE(p_vars, '{}'::jsonb) || jsonb_build_object('nombre', public.push_first_name(v_name));
  v_title := left(loyalty_render(v_rule.title, v_vars), 65);
  v_body  := left(loyalty_render(v_rule.body, v_vars), 240);
  v_push_kind := CASE WHEN p_kind IN ('benefit_new','reward_unlocked','near_reward') THEN 'reward' ELSE 'points' END;
  v_deep := COALESCE(v_rule.deep_link, '/home');

  INSERT INTO client_notifications (client_id, organization_id, type, title, body, data, deep_link, is_read)
  VALUES (p_client_id, p_org, v_push_kind, v_title, v_body,
          jsonb_build_object('type', v_push_kind, 'loyalty_kind', p_kind, 'deep_link', v_deep), v_deep, false)
  RETURNING id INTO v_notif_id;

  INSERT INTO push_outbox (organization_id, client_id, kind, title, body, data, deep_link)
  VALUES (p_org, p_client_id, v_push_kind, v_title, v_body,
          jsonb_build_object('type', v_push_kind, 'value', '', 'deep_link', v_deep,
                             'loyalty_kind', p_kind, 'inbox_notification_id', v_notif_id::text),
          v_deep)
  RETURNING id INTO v_outbox_id;
  UPDATE client_notifications SET push_outbox_id = v_outbox_id WHERE id = v_notif_id;

  PERFORM loyalty_log_event(p_org, p_client_id, 'notification_sent', NULL,
    jsonb_build_object('key', p_dedupe_key, 'kind', p_kind, 'notification_id', v_notif_id, 'title', v_title));
  RETURN true;
END; $$;

-- ----------------------------------------------------------------------------
-- 2. Categoría
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.loyalty_recalc_tier(p_client_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_client clients%ROWTYPE; v_s loyalty_settings%ROWTYPE; v_state client_loyalty_state%ROWTYPE;
  v_target loyalty_tiers%ROWTYPE; v_lower loyalty_tiers%ROWTYPE; v_next loyalty_tiers%ROWTYPE;
  v_n integer; v_now timestamptz := now(); v_change text := NULL; v_prev text; v_tz text;
BEGIN
  SELECT * INTO v_client FROM clients WHERE id = p_client_id;
  IF v_client.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_s FROM loyalty_settings WHERE organization_id = v_client.organization_id;
  IF v_s.organization_id IS NULL OR NOT v_s.is_enabled THEN RETURN NULL; END IF;

  v_n := loyalty_visits_in_window(p_client_id, v_now, v_s.window_weeks);

  SELECT * INTO v_target FROM loyalty_tiers
   WHERE organization_id = v_client.organization_id AND is_active
     AND min_visits <= v_n AND (max_visits IS NULL OR v_n <= max_visits)
   ORDER BY sort_order DESC LIMIT 1;
  IF v_target.id IS NULL THEN
    -- Rangos con hueco: el escalón más alto cuyo mínimo ya se cumple.
    SELECT * INTO v_target FROM loyalty_tiers
     WHERE organization_id = v_client.organization_id AND is_active AND min_visits <= v_n
     ORDER BY sort_order DESC LIMIT 1;
  END IF;
  IF v_target.id IS NULL THEN RETURN NULL; END IF;

  INSERT INTO client_loyalty_state (client_id, organization_id)
  VALUES (p_client_id, v_client.organization_id) ON CONFLICT (client_id) DO NOTHING;
  SELECT * INTO v_state FROM client_loyalty_state WHERE client_id = p_client_id FOR UPDATE;
  v_prev := v_state.tier_code;

  IF v_state.tier_code IS NULL THEN
    UPDATE client_loyalty_state SET tier_code = v_target.code, tier_sort = v_target.sort_order,
      visits_in_window = v_n, tier_reached_at = v_now, enrolled_at = COALESCE(enrolled_at, v_now),
      grace_until = NULL, last_recalc_at = v_now, updated_at = v_now WHERE client_id = p_client_id;
    PERFORM loyalty_log_event(v_client.organization_id, p_client_id, 'enrolled', NULL,
      jsonb_build_object('tier', v_target.code, 'visits', v_n));
    v_change := 'enrolled';

  ELSIF v_target.sort_order > v_state.tier_sort THEN
    UPDATE client_loyalty_state SET tier_code = v_target.code, tier_sort = v_target.sort_order,
      visits_in_window = v_n, tier_reached_at = v_now, grace_until = NULL, last_recalc_at = v_now, updated_at = v_now
     WHERE client_id = p_client_id;
    PERFORM loyalty_log_event(v_client.organization_id, p_client_id, 'tier_up', NULL,
      jsonb_build_object('from', v_prev, 'to', v_target.code, 'visits', v_n));
    PERFORM loyalty_notify(v_client.organization_id, p_client_id, 'tier_up',
      jsonb_build_object('categoria', v_target.name, 'multiplicador', v_target.multiplier_pct::text, 'visitas', v_n::text),
      'tier_up:' || v_target.code || ':' || to_char(v_now, 'YYYY-MM-DD'));
    v_change := 'up';

  ELSIF v_target.sort_order = v_state.tier_sort THEN
    IF v_state.grace_until IS NOT NULL THEN
      PERFORM loyalty_log_event(v_client.organization_id, p_client_id, 'grace_recovered', NULL,
        jsonb_build_object('tier', v_state.tier_code, 'visits', v_n));
      v_change := 'recovered';
    END IF;
    UPDATE client_loyalty_state SET visits_in_window = v_n, grace_until = NULL, last_recalc_at = v_now, updated_at = v_now
     WHERE client_id = p_client_id;

  ELSE
    -- Por debajo de su categoría: gracia, y recién después baja UN escalón.
    IF v_state.grace_until IS NULL AND v_s.grace_days > 0 THEN
      UPDATE client_loyalty_state SET grace_until = v_now + make_interval(days => v_s.grace_days),
        visits_in_window = v_n, last_recalc_at = v_now, updated_at = v_now WHERE client_id = p_client_id;
      PERFORM loyalty_log_event(v_client.organization_id, p_client_id, 'grace_started', NULL,
        jsonb_build_object('tier', v_state.tier_code, 'target', v_target.code, 'until', v_now + make_interval(days => v_s.grace_days), 'visits', v_n));
      v_tz := loyalty_tz_of_branch((SELECT branch_id FROM visits WHERE client_id = p_client_id ORDER BY completed_at DESC LIMIT 1));
      PERFORM loyalty_notify(v_client.organization_id, p_client_id, 'tier_grace_warning',
        jsonb_build_object('categoria', (SELECT name FROM loyalty_tiers WHERE organization_id = v_client.organization_id AND code = v_state.tier_code),
                           'dias', v_s.grace_days::text,
                           'fecha', to_char((v_now + make_interval(days => v_s.grace_days)) AT TIME ZONE v_tz, 'DD/MM')),
        'grace:' || v_state.tier_code || ':' || to_char(v_now, 'YYYY-MM-DD'));
      v_change := 'grace';
    ELSIF v_state.grace_until IS NULL OR v_state.grace_until <= v_now THEN
      SELECT * INTO v_lower FROM loyalty_tiers
       WHERE organization_id = v_client.organization_id AND is_active AND sort_order = v_state.tier_sort - 1;
      IF v_lower.id IS NOT NULL THEN
        UPDATE client_loyalty_state SET tier_code = v_lower.code, tier_sort = v_lower.sort_order,
          visits_in_window = v_n, tier_reached_at = v_now, grace_until = NULL, last_recalc_at = v_now, updated_at = v_now
         WHERE client_id = p_client_id;
        PERFORM loyalty_log_event(v_client.organization_id, p_client_id, 'tier_down', NULL,
          jsonb_build_object('from', v_prev, 'to', v_lower.code, 'visits', v_n));
        PERFORM loyalty_notify(v_client.organization_id, p_client_id, 'tier_down',
          jsonb_build_object('categoria', v_lower.name, 'visitas', v_n::text),
          'tier_down:' || v_lower.code || ':' || to_char(v_now, 'YYYY-MM-DD'));
        v_change := 'down';
      ELSE
        UPDATE client_loyalty_state SET visits_in_window = v_n, last_recalc_at = v_now, updated_at = v_now WHERE client_id = p_client_id;
      END IF;
    ELSE
      UPDATE client_loyalty_state SET visits_in_window = v_n, last_recalc_at = v_now, updated_at = v_now WHERE client_id = p_client_id;
    END IF;
  END IF;

  SELECT * INTO v_state FROM client_loyalty_state WHERE client_id = p_client_id;
  SELECT * INTO v_next FROM loyalty_tiers
   WHERE organization_id = v_client.organization_id AND is_active AND sort_order = v_state.tier_sort + 1;

  RETURN jsonb_build_object(
    'tier_code', v_state.tier_code, 'previous_tier_code', v_prev, 'change', v_change,
    'visits_in_window', v_n, 'grace_until', v_state.grace_until,
    'next_tier_code', v_next.code, 'next_tier_name', v_next.name,
    'visits_to_next', CASE WHEN v_next.id IS NULL THEN NULL ELSE GREATEST(v_next.min_visits - v_n, 0) END);
END; $$;

-- ----------------------------------------------------------------------------
-- 3. Bono de bienvenida (una sola vez; primer contacto con el programa)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.loyalty_grant_welcome_bonus(p_client_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_client clients%ROWTYPE; v_s loyalty_settings%ROWTYPE; v_state client_loyalty_state%ROWTYPE; v_tx uuid;
BEGIN
  SELECT * INTO v_client FROM clients WHERE id = p_client_id;
  IF v_client.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_s FROM loyalty_settings WHERE organization_id = v_client.organization_id;
  IF v_s.organization_id IS NULL OR NOT v_s.is_enabled OR v_s.welcome_bonus_points <= 0 THEN RETURN NULL; END IF;

  INSERT INTO client_loyalty_state (client_id, organization_id)
  VALUES (p_client_id, v_client.organization_id) ON CONFLICT (client_id) DO NOTHING;
  SELECT * INTO v_state FROM client_loyalty_state WHERE client_id = p_client_id FOR UPDATE;
  IF v_state.welcome_bonus_tx_id IS NOT NULL THEN RETURN v_state.welcome_bonus_tx_id; END IF;

  INSERT INTO point_transactions (client_id, organization_id, points, remaining, type, description, expires_at, meta)
  VALUES (p_client_id, v_client.organization_id, v_s.welcome_bonus_points, v_s.welcome_bonus_points, 'welcome_bonus',
          'Bono de bienvenida', now() + make_interval(days => v_s.points_expiry_days), '{}'::jsonb)
  RETURNING id INTO v_tx;
  UPDATE client_loyalty_state SET welcome_bonus_tx_id = v_tx, enrolled_at = COALESCE(enrolled_at, now()), updated_at = now()
   WHERE client_id = p_client_id;
  PERFORM loyalty_log_event(v_client.organization_id, p_client_id, 'welcome_bonus', NULL,
    jsonb_build_object('points', v_s.welcome_bonus_points, 'tx_id', v_tx));
  RETURN v_tx;
END; $$;

-- ----------------------------------------------------------------------------
-- 4. Puntos por visita
-- ----------------------------------------------------------------------------
-- Puntos base × porcentaje realmente pagado × multiplicador. El "precio
-- completo" es lo cobrado + lo descontado, o el precio vigente del servicio si
-- fuera mayor (un cobro manual por debajo del precio también paga menos).
CREATE OR REPLACE FUNCTION public.loyalty_points_for_visit(p_visit visits, p_base integer, p_multiplier_pct integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_price numeric; v_full numeric; v_pct numeric; v_pts integer;
BEGIN
  SELECT price INTO v_price FROM services WHERE id = p_visit.service_id;
  v_full := GREATEST(COALESCE(p_visit.amount, 0) + COALESCE(p_visit.discount_amount, 0), COALESCE(v_price, 0));
  IF v_full <= 0 THEN v_pct := 0;
  ELSE v_pct := LEAST(1, GREATEST(COALESCE(p_visit.amount, 0), 0) / v_full);
  END IF;
  v_pts := round(p_base * v_pct * p_multiplier_pct / 100.0)::integer;
  RETURN jsonb_build_object('points', GREATEST(v_pts, 0), 'paid_pct', round(v_pct * 100),
    'full_price', v_full, 'paid_amount', COALESCE(p_visit.amount, 0), 'base_points', p_base, 'multiplier_pct', p_multiplier_pct);
END; $$;

CREATE OR REPLACE FUNCTION public.loyalty_visit_qualifies(p_visit visits)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p_visit.client_id IS NOT NULL
     AND (p_visit.service_id IS NOT NULL OR p_visit.queue_entry_id IS NOT NULL)
     AND (p_visit.service_id IS NULL OR COALESCE((SELECT counts_as_visit FROM services WHERE id = p_visit.service_id), true));
$$;

-- Reversión (anulación administrativa o borrado de la visita). Revierte lo
-- que quede sin consumir del lote y, si había referido completado sobre la
-- visita, lo cancela y revierte los dos bonos. Lo consumido no se persigue: se
-- deja registrado cuánto era.
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
  UPDATE point_transactions SET remaining = 0, reversed_by = COALESCE(v_rev, v_lot.id) WHERE id = v_lot.id;
  RETURN v_lot.remaining;
END; $$;

CREATE OR REPLACE FUNCTION public.loyalty_reverse_visit(p_visit_id uuid, p_reason text DEFAULT 'visita anulada')
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
      jsonb_build_object('referral_id', v_ref.id, 'reason', p_reason));
  END IF;

  IF v_client IS NOT NULL THEN
    PERFORM loyalty_log_event(v_org, v_client, 'reversal', p_visit_id,
      jsonb_build_object('points_reverted', v_reverted, 'points_already_spent', v_spent, 'reason', p_reason, 'lot_id', v_lot.id));
  END IF;
  RETURN jsonb_build_object('points_reverted', v_reverted, 'points_already_spent', v_spent, 'referral_cancelled', v_ref.id IS NOT NULL);
END; $$;

-- Completa un referido pendiente cuando la visita quedó cobrada (spec §7: los
-- puntos se acreditan recién con el servicio completado y cobrado).
CREATE OR REPLACE FUNCTION public.loyalty_complete_referral_for_visit(p_visit_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ref referrals%ROWTYPE; v_s loyalty_settings%ROWTYPE; v_tx_new uuid; v_tx_ref uuid; v_friend text; v_expiry timestamptz;
BEGIN
  SELECT * INTO v_ref FROM referrals WHERE visit_id = p_visit_id AND status = 'pending' FOR UPDATE;
  IF v_ref.id IS NULL THEN RETURN false; END IF;
  SELECT * INTO v_s FROM loyalty_settings WHERE organization_id = v_ref.organization_id;
  IF v_s.organization_id IS NULL OR NOT v_s.is_enabled THEN RETURN false; END IF;
  v_expiry := now() + make_interval(days => v_s.points_expiry_days);

  IF v_ref.referred_points > 0 THEN
    INSERT INTO point_transactions (client_id, organization_id, points, remaining, type, description, expires_at, meta)
    VALUES (v_ref.referred_client_id, v_ref.organization_id, v_ref.referred_points, v_ref.referred_points, 'referral_referred',
            'Bono por venir recomendado', v_expiry, jsonb_build_object('referral_id', v_ref.id, 'visit_id', p_visit_id))
    RETURNING id INTO v_tx_new;
  END IF;
  IF v_ref.referrer_points > 0 THEN
    INSERT INTO point_transactions (client_id, organization_id, points, remaining, type, description, expires_at, meta)
    VALUES (v_ref.referrer_client_id, v_ref.organization_id, v_ref.referrer_points, v_ref.referrer_points, 'referral_referrer',
            'Recomendaste a un amigo', v_expiry, jsonb_build_object('referral_id', v_ref.id, 'visit_id', p_visit_id))
    RETURNING id INTO v_tx_ref;
  END IF;

  UPDATE referrals SET status = 'completed', completed_at = now(), referred_tx_id = v_tx_new, referrer_tx_id = v_tx_ref
   WHERE id = v_ref.id;

  SELECT public.push_first_name(name) INTO v_friend FROM clients WHERE id = v_ref.referred_client_id;
  PERFORM loyalty_log_event(v_ref.organization_id, v_ref.referrer_client_id, 'referral_completed', p_visit_id,
    jsonb_build_object('referral_id', v_ref.id, 'points', v_ref.referrer_points, 'referred_client_id', v_ref.referred_client_id));
  PERFORM loyalty_log_event(v_ref.organization_id, v_ref.referred_client_id, 'referral_completed', p_visit_id,
    jsonb_build_object('referral_id', v_ref.id, 'points', v_ref.referred_points, 'referrer_client_id', v_ref.referrer_client_id));
  PERFORM loyalty_notify(v_ref.organization_id, v_ref.referrer_client_id, 'referral_completed_referrer',
    jsonb_build_object('nombre_amigo', COALESCE(NULLIF(v_friend, ''), 'Tu amigo'), 'puntos', v_ref.referrer_points::text), 'ref_done:' || v_ref.id);
  PERFORM loyalty_notify(v_ref.organization_id, v_ref.referred_client_id, 'referral_completed_referred',
    jsonb_build_object('puntos', v_ref.referred_points::text), 'ref_welcome:' || v_ref.id);
  RETURN true;
END; $$;

-- El post-servicio (spec §11), idempotente y re-ejecutable en cada fase de
-- escritura de la visita.
CREATE OR REPLACE FUNCTION public.loyalty_process_visit(p_visit_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v visits%ROWTYPE; v_s loyalty_settings%ROWTYPE; v_lot point_transactions%ROWTYPE;
  v_recalc jsonb; v_mult integer; v_calc jsonb; v_pts integer; v_lot_id uuid; v_next loyalty_tiers%ROWTYPE; v_n integer;
BEGIN
  SELECT * INTO v FROM visits WHERE id = p_visit_id;
  IF v.id IS NULL OR v.client_id IS NULL THEN RETURN jsonb_build_object('skipped', 'no_client'); END IF;
  SELECT * INTO v_s FROM loyalty_settings WHERE organization_id = v.organization_id;
  IF v_s.organization_id IS NULL OR NOT v_s.is_enabled THEN RETURN jsonb_build_object('skipped', 'disabled'); END IF;

  IF NOT loyalty_visit_qualifies(v) THEN
    -- Cambió a un servicio que no cuenta (o es venta de producto): si había
    -- lote sin consumir, se revierte y se recalcula la categoría.
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

  IF v_s.program_started_at IS NOT NULL AND v.completed_at >= v_s.program_started_at THEN
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

  -- "Te falta una visita para llegar a X": depende sólo del conteo, así que
  -- puede salir desde acá (a lo sumo una vez por semana ISO por categoría).
  v_n := (v_recalc->>'visits_in_window')::integer;
  IF (v_recalc->>'visits_to_next')::integer = 1 THEN
    PERFORM loyalty_notify(v.organization_id, v.client_id, 'near_tier',
      jsonb_build_object('categoria_siguiente', v_recalc->>'next_tier_name', 'visitas', v_n::text),
      'near_tier:' || (v_recalc->>'next_tier_code') || ':' || to_char(now(), 'IYYY-IW'));
  END IF;

  RETURN v_recalc || jsonb_build_object('points', COALESCE(v_pts, 0), 'lot_id', v_lot_id, 'multiplier_pct', v_mult);
END; $$;

-- Cierre explícito desde completeService / createManualVisit: manda las
-- notificaciones que dependen del importe FINAL (puntos ganados, premio
-- desbloqueado, "te faltan pocos puntos") y devuelve el resumen para la
-- tablet. El trigger no puede saber cuál de sus 2-3 corridas es la última.
CREATE OR REPLACE FUNCTION public.loyalty_finalize_visit(p_visit_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v visits%ROWTYPE; v_res jsonb; v_balance integer; v_lot point_transactions%ROWTYPE; v_tier loyalty_tiers%ROWTYPE;
  v_state client_loyalty_state%ROWTYPE; v_reward reward_catalog%ROWTYPE; v_before integer; v_up boolean;
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

  IF v_lot.id IS NOT NULL AND v_lot.points > 0 AND NOT EXISTS (
       SELECT 1 FROM loyalty_events WHERE visit_id = p_visit_id AND kind = 'points_earned') THEN
    PERFORM loyalty_log_event(v.organization_id, v.client_id, 'points_earned', p_visit_id,
      jsonb_build_object('points', v_lot.points, 'balance', v_balance, 'tier', v_state.tier_code, 'meta', v_lot.meta));
    PERFORM loyalty_notify(v.organization_id, v.client_id, 'points_earned',
      jsonb_build_object('puntos', v_lot.points::text, 'saldo', v_balance::text, 'categoria', v_tier.name), 'earned:' || p_visit_id);
  END IF;

  -- Premio más barato que el cliente PUEDE canjear (activo, vigente, con
  -- stock, categoría permitida) y que antes de esta visita no alcanzaba.
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

  v_up := (v_res->>'change') IN ('up', 'enrolled');
  RETURN jsonb_build_object(
    'enabled', true,
    'points_earned', COALESCE(v_lot.points, 0),
    'balance', v_balance,
    'tier_code', v_state.tier_code, 'tier_name', v_tier.name,
    'tier_color_primary', v_tier.color_primary, 'tier_color_secondary', v_tier.color_secondary, 'tier_text_color', v_tier.text_color,
    'tier_changed', v_res->>'change',
    'visits_in_window', v_state.visits_in_window,
    'next_tier_name', v_res->>'next_tier_name', 'visits_to_next', v_res->'visits_to_next',
    'multiplier_pct', v_res->'multiplier_pct');
END; $$;

-- Triggers sobre visits: nunca bloquean el cobro.
CREATE OR REPLACE FUNCTION public.fn_loyalty_on_visit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.client_id IS NOT DISTINCT FROM OLD.client_id
     AND NEW.service_id IS NOT DISTINCT FROM OLD.service_id AND NEW.amount IS NOT DISTINCT FROM OLD.amount
     AND NEW.discount_amount IS NOT DISTINCT FROM OLD.discount_amount AND NEW.completed_at IS NOT DISTINCT FROM OLD.completed_at THEN
    RETURN NEW;
  END IF;
  IF NEW.client_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM loyalty_settings WHERE organization_id = NEW.organization_id AND is_enabled) THEN RETURN NEW; END IF;
  BEGIN
    PERFORM loyalty_process_visit(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO loyalty_events (organization_id, client_id, kind, visit_id, data)
    VALUES (NEW.organization_id, NEW.client_id, 'error', NEW.id,
            jsonb_build_object('what', 'process_visit', 'sqlstate', SQLSTATE, 'message', SQLERRM));
    RAISE WARNING '[loyalty] process_visit % falló: % (%)', NEW.id, SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.fn_loyalty_on_visit_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.client_id IS NULL THEN RETURN OLD; END IF;
  BEGIN
    PERFORM loyalty_reverse_visit(OLD.id, 'visita borrada');
    PERFORM loyalty_recalc_tier(OLD.client_id);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO loyalty_events (organization_id, client_id, kind, visit_id, data)
    VALUES (OLD.organization_id, OLD.client_id, 'error', OLD.id,
            jsonb_build_object('what', 'reverse_visit', 'sqlstate', SQLSTATE, 'message', SQLERRM));
    RAISE WARNING '[loyalty] reverse_visit % falló: % (%)', OLD.id, SQLERRM, SQLSTATE;
  END;
  RETURN OLD;
END; $$;

DROP TRIGGER IF EXISTS trg_loyalty_on_visit ON public.visits;
CREATE TRIGGER trg_loyalty_on_visit
  AFTER INSERT OR UPDATE OF client_id, service_id, amount, discount_amount, completed_at ON public.visits
  FOR EACH ROW WHEN (NEW.completed_at IS NOT NULL AND NEW.client_id IS NOT NULL)
  EXECUTE FUNCTION public.fn_loyalty_on_visit();

-- AFTER DELETE: el lote se ubica también por meta->>'visit_id' porque la FK
-- visit_id es ON DELETE SET NULL y el orden entre triggers RI y de usuario no
-- es algo de lo que convenga depender.
CREATE INDEX IF NOT EXISTS idx_point_tx_meta_visit ON public.point_transactions ((meta->>'visit_id')) WHERE type = 'earned';
DROP TRIGGER IF EXISTS trg_loyalty_on_visit_delete ON public.visits;
CREATE TRIGGER trg_loyalty_on_visit_delete
  AFTER DELETE ON public.visits FOR EACH ROW EXECUTE FUNCTION public.fn_loyalty_on_visit_delete();

-- El push genérico de "premio nuevo" (mig 193) no aplica a los canjes por
-- puntos: de eso se ocupa la regla `benefit_new` del programa.
DROP TRIGGER IF EXISTS trg_push_on_client_reward ON public.client_rewards;
CREATE TRIGGER trg_push_on_client_reward
  AFTER INSERT ON public.client_rewards FOR EACH ROW
  WHEN (NEW.status = 'available' AND NEW.source <> 'points_redemption')
  EXECUTE FUNCTION public.fn_push_on_client_reward();

-- ----------------------------------------------------------------------------
-- 5. Consumo FEFO y canje
-- ----------------------------------------------------------------------------
-- Quien llama tiene que tener bloqueada la fila de client_loyalty_state.
CREATE OR REPLACE FUNCTION public.loyalty_consume_points(p_client_id uuid, p_org uuid, p_points integer, p_type text, p_description text, p_meta jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_left integer := p_points; v_tx uuid; r record; v_take integer;
BEGIN
  IF p_points <= 0 THEN RAISE EXCEPTION 'invalid_points'; END IF;
  IF loyalty_points_balance(p_client_id) < p_points THEN RAISE EXCEPTION 'insufficient_points'; END IF;
  INSERT INTO point_transactions (client_id, organization_id, points, remaining, type, description, meta)
  VALUES (p_client_id, p_org, -p_points, 0, p_type, p_description, COALESCE(p_meta, '{}'::jsonb)) RETURNING id INTO v_tx;
  FOR r IN SELECT id, remaining FROM point_transactions
            WHERE client_id = p_client_id AND remaining > 0 AND (expires_at IS NULL OR expires_at > now())
            ORDER BY expires_at ASC NULLS LAST, created_at ASC FOR UPDATE LOOP
    v_take := LEAST(r.remaining, v_left);
    UPDATE point_transactions SET remaining = remaining - v_take WHERE id = r.id;
    INSERT INTO point_lot_consumptions (redemption_tx_id, lot_tx_id, points) VALUES (v_tx, r.id, v_take);
    v_left := v_left - v_take;
    EXIT WHEN v_left <= 0;
  END LOOP;
  IF v_left > 0 THEN RAISE EXCEPTION 'insufficient_points'; END IF;
  RETURN v_tx;
END; $$;

CREATE OR REPLACE FUNCTION public.loyalty_redeem_reward_for_client(p_client_id uuid, p_reward_id uuid, p_channel text DEFAULT 'app')
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_client clients%ROWTYPE; v_s loyalty_settings%ROWTYPE; v_state client_loyalty_state%ROWTYPE; v_reward reward_catalog%ROWTYPE;
  v_balance integer; v_tx uuid; v_cr client_rewards%ROWTYPE; v_required_tier text; v_validity integer;
BEGIN
  SELECT * INTO v_client FROM clients WHERE id = p_client_id;
  IF v_client.id IS NULL THEN RETURN json_build_object('success', false, 'error', 'client_not_found'); END IF;
  SELECT * INTO v_s FROM loyalty_settings WHERE organization_id = v_client.organization_id;
  IF v_s.organization_id IS NULL OR NOT v_s.is_enabled THEN RETURN json_build_object('success', false, 'error', 'program_disabled'); END IF;

  INSERT INTO client_loyalty_state (client_id, organization_id) VALUES (p_client_id, v_client.organization_id) ON CONFLICT (client_id) DO NOTHING;
  SELECT * INTO v_state FROM client_loyalty_state WHERE client_id = p_client_id FOR UPDATE;

  SELECT * INTO v_reward FROM reward_catalog WHERE id = p_reward_id AND organization_id = v_client.organization_id FOR UPDATE;
  IF v_reward.id IS NULL OR NOT v_reward.is_active OR v_reward.points_cost <= 0 THEN
    RETURN json_build_object('success', false, 'error', 'not_available');
  END IF;
  IF (v_reward.valid_from IS NOT NULL AND v_reward.valid_from > now()) OR (v_reward.valid_until IS NOT NULL AND v_reward.valid_until <= now()) THEN
    RETURN json_build_object('success', false, 'error', 'expired');
  END IF;
  IF v_reward.allowed_tiers IS NOT NULL AND (v_state.tier_code IS NULL OR NOT (v_state.tier_code = ANY (v_reward.allowed_tiers))) THEN
    SELECT name INTO v_required_tier FROM loyalty_tiers
     WHERE organization_id = v_client.organization_id AND code = ANY (v_reward.allowed_tiers) ORDER BY sort_order ASC LIMIT 1;
    RETURN json_build_object('success', false, 'error', 'tier_locked', 'tier_required', v_required_tier);
  END IF;
  IF v_reward.stock IS NOT NULL AND v_reward.stock <= 0 THEN RETURN json_build_object('success', false, 'error', 'out_of_stock'); END IF;

  v_balance := loyalty_points_balance(p_client_id);
  IF v_balance < v_reward.points_cost THEN
    RETURN json_build_object('success', false, 'error', 'insufficient_points', 'required', v_reward.points_cost, 'available', v_balance);
  END IF;

  v_tx := loyalty_consume_points(p_client_id, v_client.organization_id, v_reward.points_cost, 'redeemed',
            'Canje: ' || v_reward.name, jsonb_build_object('reward_id', v_reward.id, 'channel', p_channel));
  IF v_reward.stock IS NOT NULL THEN UPDATE reward_catalog SET stock = stock - 1 WHERE id = v_reward.id; END IF;

  v_validity := COALESCE(v_reward.validity_days, v_s.reward_validity_days);
  INSERT INTO client_rewards (client_id, organization_id, reward_id, source, status, expires_at, points_spent, redemption_tx_id)
  VALUES (p_client_id, v_client.organization_id, v_reward.id, 'points_redemption', 'available',
          now() + make_interval(days => v_validity), v_reward.points_cost, v_tx)
  RETURNING * INTO v_cr;
  UPDATE point_transactions SET meta = meta || jsonb_build_object('client_reward_id', v_cr.id) WHERE id = v_tx;

  PERFORM loyalty_log_event(v_client.organization_id, p_client_id, 'reward_redeemed', NULL,
    jsonb_build_object('reward_id', v_reward.id, 'reward_name', v_reward.name, 'points', v_reward.points_cost,
                       'client_reward_id', v_cr.id, 'channel', p_channel));
  PERFORM loyalty_notify(v_client.organization_id, p_client_id, 'benefit_new',
    jsonb_build_object('premio', v_reward.name, 'fecha', to_char(v_cr.expires_at AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM')),
    'benefit:' || v_cr.id);

  RETURN json_build_object('success', true, 'reward_name', v_reward.name, 'client_reward_id', v_cr.id,
    'qr_code', v_cr.qr_code, 'expires_at', v_cr.expires_at, 'points_remaining', v_balance - v_reward.points_cost, 'kind', v_reward.kind);
END; $$;

CREATE OR REPLACE FUNCTION public.loyalty_redeem_reward(p_reward_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_client uuid := public.current_client_id();
BEGIN
  IF v_client IS NULL THEN RETURN json_build_object('success', false, 'error', 'client_not_found'); END IF;
  RETURN loyalty_redeem_reward_for_client(v_client, p_reward_id, 'app');
END; $$;

-- Compatibilidad con la app ya instalada (misma firma, mismo shape de error).
CREATE OR REPLACE FUNCTION public.redeem_points_for_reward(p_reward_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_res json; v_client uuid := public.current_client_id();
BEGIN
  IF v_client IS NULL THEN RETURN json_build_object('success', false, 'error', 'Client not found'); END IF;
  v_res := loyalty_redeem_reward_for_client(v_client, p_reward_id, 'app');
  IF (v_res->>'success')::boolean THEN RETURN v_res; END IF;
  RETURN json_build_object('success', false,
    'error', CASE v_res->>'error'
               WHEN 'insufficient_points' THEN 'Insufficient points'
               WHEN 'out_of_stock' THEN 'Out of stock'
               WHEN 'tier_locked' THEN 'Tier locked'
               ELSE 'Reward not available' END,
    'required', v_res->'required', 'available', v_res->'available');
END; $$;

-- Cancelación administrativa de un beneficio canjeado (con o sin devolución).
CREATE OR REPLACE FUNCTION public.loyalty_cancel_client_reward(p_client_reward_id uuid, p_reason text, p_refund boolean DEFAULT true)
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
            v_cr.redemption_tx_id, jsonb_build_object('client_reward_id', v_cr.id)) RETURNING id INTO v_tx;
    FOR r IN SELECT c.lot_tx_id, c.points, l.expires_at FROM point_lot_consumptions c JOIN point_transactions l ON l.id = c.lot_tx_id
              WHERE c.redemption_tx_id = v_cr.redemption_tx_id LOOP
      IF r.expires_at IS NULL OR r.expires_at > now() THEN
        UPDATE point_transactions SET remaining = remaining + r.points WHERE id = r.lot_tx_id;
      ELSE
        -- El lote original ya venció: los puntos vuelven en un lote nuevo.
        INSERT INTO point_transactions (client_id, organization_id, points, remaining, type, description, expires_at, meta)
        VALUES (v_cr.client_id, v_cr.organization_id, r.points, r.points, 'reversal', 'Devolución de canje',
                now() + make_interval(days => COALESCE(v_s.points_expiry_days, 120)), jsonb_build_object('client_reward_id', v_cr.id));
      END IF;
      v_restored := v_restored + r.points;
    END LOOP;
  END IF;
  PERFORM loyalty_log_event(v_cr.organization_id, v_cr.client_id, 'reward_cancelled', NULL,
    jsonb_build_object('client_reward_id', v_cr.id, 'reason', p_reason, 'points_restored', v_restored));
  RETURN json_build_object('success', true, 'points_restored', v_restored);
END; $$;

-- Ajuste manual desde el dashboard (± con motivo). Negativo = consume FEFO.
CREATE OR REPLACE FUNCTION public.loyalty_adjust_points(p_client_id uuid, p_points integer, p_reason text, p_staff_id uuid DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_client clients%ROWTYPE; v_s loyalty_settings%ROWTYPE; v_tx uuid;
BEGIN
  IF p_points = 0 OR abs(p_points) > 100000 THEN RETURN json_build_object('success', false, 'error', 'invalid_points'); END IF;
  SELECT * INTO v_client FROM clients WHERE id = p_client_id;
  IF v_client.id IS NULL THEN RETURN json_build_object('success', false, 'error', 'client_not_found'); END IF;
  SELECT * INTO v_s FROM loyalty_settings WHERE organization_id = v_client.organization_id;
  IF v_s.organization_id IS NULL THEN RETURN json_build_object('success', false, 'error', 'program_disabled'); END IF;
  INSERT INTO client_loyalty_state (client_id, organization_id) VALUES (p_client_id, v_client.organization_id) ON CONFLICT (client_id) DO NOTHING;
  PERFORM 1 FROM client_loyalty_state WHERE client_id = p_client_id FOR UPDATE;

  IF p_points > 0 THEN
    INSERT INTO point_transactions (client_id, organization_id, points, remaining, type, description, expires_at, meta)
    VALUES (p_client_id, v_client.organization_id, p_points, p_points, 'manual_adjust', COALESCE(NULLIF(p_reason, ''), 'Ajuste manual'),
            now() + make_interval(days => v_s.points_expiry_days), jsonb_build_object('staff_id', p_staff_id, 'reason', p_reason))
    RETURNING id INTO v_tx;
  ELSE
    BEGIN
      v_tx := loyalty_consume_points(p_client_id, v_client.organization_id, -p_points, 'manual_adjust',
                COALESCE(NULLIF(p_reason, ''), 'Ajuste manual'), jsonb_build_object('staff_id', p_staff_id, 'reason', p_reason));
    EXCEPTION WHEN OTHERS THEN
      RETURN json_build_object('success', false, 'error', 'insufficient_points', 'available', loyalty_points_balance(p_client_id));
    END;
  END IF;
  PERFORM loyalty_log_event(v_client.organization_id, p_client_id, 'manual_adjust', NULL,
    jsonb_build_object('points', p_points, 'reason', p_reason, 'staff_id', p_staff_id, 'tx_id', v_tx));
  RETURN json_build_object('success', true, 'balance', loyalty_points_balance(p_client_id));
END; $$;

-- ----------------------------------------------------------------------------
-- 6. Aplicación en el local (cobro): reescritura de redeem_coupon_for_visit
--    con acumulación, servicio aplicable, estado cancelado y entrega de merch.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redeem_coupon_for_visit(p_qr_code text, p_visit_id uuid, p_service_subtotal numeric)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_visit visits%ROWTYPE; v_reward client_rewards%ROWTYPE; v_catalog reward_catalog%ROWTYPE;
  v_pct numeric; v_discount numeric; v_net numeric; v_same_person boolean; v_branch_tz text; v_has_benefit boolean;
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

  -- Merch / especial: es una ENTREGA, no un descuento. No toca el importe.
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

  -- Un servicio admite UN beneficio promocional, salvo que el premio acumule.
  v_has_benefit := COALESCE(v_visit.discount_amount, 0) > 0 OR v_visit.client_reward_id IS NOT NULL
                   OR EXISTS (SELECT 1 FROM referrals WHERE visit_id = p_visit_id AND status IN ('pending','completed'));
  IF v_has_benefit AND NOT v_catalog.allow_stacking THEN
    RETURN json_build_object('success', false, 'error', 'no_stacking');
  END IF;

  v_pct := CASE WHEN v_catalog.is_free_service THEN 100 ELSE COALESCE(v_catalog.discount_pct, 0) END;
  v_discount := LEAST(round(GREATEST(p_service_subtotal, 0) * v_pct / 100.0), GREATEST(v_visit.amount, 0));
  IF v_pct <= 0 OR v_discount <= 0 THEN RETURN json_build_object('success', false, 'error', 'no_discount'); END IF;

  UPDATE client_rewards SET status = 'redeemed', redeemed_at = now(), redeemed_by = v_visit.barber_id,
         redeemed_visit_id = p_visit_id, redeemed_branch_id = v_visit.branch_id
   WHERE id = v_reward.id AND status = 'available';
  IF NOT FOUND THEN RETURN json_build_object('success', false, 'error', 'already_redeemed'); END IF;

  v_net := GREATEST(v_visit.amount - v_discount, 0);
  UPDATE visits SET amount = v_net, discount_amount = COALESCE(discount_amount, 0) + v_discount, client_reward_id = v_reward.id
   WHERE id = p_visit_id;
  PERFORM loyalty_log_event(v_reward.organization_id, v_reward.client_id, 'reward_used', p_visit_id,
    jsonb_build_object('client_reward_id', v_reward.id, 'reward_name', v_catalog.name, 'kind', v_catalog.kind, 'discount_amount', v_discount));

  RETURN json_build_object('success', true, 'client_reward_id', v_reward.id, 'reward_name', v_catalog.name, 'kind', v_catalog.kind,
    'discount_pct', v_catalog.discount_pct, 'is_free_service', v_catalog.is_free_service, 'discount_amount', v_discount, 'net_amount', v_net);
END; $$;

-- Entrega de merch/especial SIN cobro (el cliente pasa a retirar la gorra).
CREATE OR REPLACE FUNCTION public.deliver_reward_by_qr(p_qr_code text, p_staff_id uuid, p_branch_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_reward client_rewards%ROWTYPE; v_catalog reward_catalog%ROWTYPE; v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM branches WHERE id = p_branch_id;
  SELECT * INTO v_reward FROM client_rewards WHERE qr_code = p_qr_code FOR UPDATE;
  IF v_reward.id IS NULL THEN RETURN json_build_object('success', false, 'error', 'not_found'); END IF;
  IF v_reward.organization_id IS DISTINCT FROM v_org THEN RETURN json_build_object('success', false, 'error', 'wrong_org'); END IF;
  IF v_reward.status = 'redeemed' THEN RETURN json_build_object('success', false, 'error', 'already_redeemed'); END IF;
  IF v_reward.status = 'cancelled' THEN RETURN json_build_object('success', false, 'error', 'cancelled'); END IF;
  IF v_reward.status <> 'available' THEN RETURN json_build_object('success', false, 'error', 'not_available'); END IF;
  IF v_reward.expires_at IS NOT NULL AND v_reward.expires_at < now() THEN
    UPDATE client_rewards SET status = 'expired' WHERE id = v_reward.id;
    RETURN json_build_object('success', false, 'error', 'expired');
  END IF;
  SELECT * INTO v_catalog FROM reward_catalog WHERE id = v_reward.reward_id;
  IF v_catalog.kind NOT IN ('merch', 'especial') THEN RETURN json_build_object('success', false, 'error', 'needs_checkout'); END IF;
  UPDATE client_rewards SET status = 'redeemed', redeemed_at = now(), redeemed_by = p_staff_id, delivered_by = p_staff_id, redeemed_branch_id = p_branch_id
   WHERE id = v_reward.id AND status = 'available';
  IF NOT FOUND THEN RETURN json_build_object('success', false, 'error', 'already_redeemed'); END IF;
  PERFORM loyalty_log_event(v_reward.organization_id, v_reward.client_id, 'reward_used', NULL,
    jsonb_build_object('client_reward_id', v_reward.id, 'reward_name', v_catalog.name, 'kind', v_catalog.kind, 'delivered_by', p_staff_id));
  RETURN json_build_object('success', true, 'client_reward_id', v_reward.id, 'reward_name', v_catalog.name, 'kind', v_catalog.kind);
END; $$;

-- ----------------------------------------------------------------------------
-- 7. Referidos
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.loyalty_generate_referral_code()
RETURNS text LANGUAGE plpgsql VOLATILE AS $$
DECLARE v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; v_code text := ''; v_bytes bytea; i integer;
BEGIN
  v_bytes := extensions.gen_random_bytes(8);
  FOR i IN 0..7 LOOP
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
  END LOOP;
  RETURN v_code;
END; $$;

CREATE OR REPLACE FUNCTION public.get_my_referral_code()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_client uuid := public.current_client_id(); v_code text; v_try integer := 0;
BEGIN
  IF v_client IS NULL THEN RETURN NULL; END IF;
  SELECT referral_code INTO v_code FROM clients WHERE id = v_client;
  IF v_code IS NOT NULL THEN RETURN v_code; END IF;
  LOOP
    v_try := v_try + 1;
    v_code := loyalty_generate_referral_code();
    BEGIN
      UPDATE clients SET referral_code = v_code WHERE id = v_client AND referral_code IS NULL;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_try > 10 THEN RAISE; END IF;
    END;
  END LOOP;
  SELECT referral_code INTO v_code FROM clients WHERE id = v_client;
  RETURN v_code;
END; $$;

-- Validación SIN consumir (la llama el server action al escanear en la tablet).
CREATE OR REPLACE FUNCTION public.validate_referral_for_checkout(p_org uuid, p_code text, p_client_id uuid, p_branch_id uuid, p_exclude_visit_id uuid DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_s loyalty_settings%ROWTYPE; v_referrer clients%ROWTYPE; v_code text := upper(trim(COALESCE(p_code, ''))); v_done integer;
BEGIN
  SELECT * INTO v_s FROM loyalty_settings WHERE organization_id = p_org;
  IF v_s.organization_id IS NULL OR NOT v_s.is_enabled OR NOT v_s.referral_enabled THEN
    RETURN json_build_object('ok', false, 'error', 'referral_disabled');
  END IF;
  IF (v_s.referral_valid_from IS NOT NULL AND v_s.referral_valid_from > now()) OR (v_s.referral_valid_until IS NOT NULL AND v_s.referral_valid_until <= now()) THEN
    RETURN json_build_object('ok', false, 'error', 'referral_expired');
  END IF;
  IF v_code = '' THEN RETURN json_build_object('ok', false, 'error', 'code_not_found'); END IF;
  SELECT * INTO v_referrer FROM clients WHERE referral_code = v_code AND organization_id = p_org;
  IF v_referrer.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'code_not_found'); END IF;
  IF p_client_id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'client_required'); END IF;
  IF p_client_id = v_referrer.id OR p_client_id IN (SELECT loyalty_same_person_ids(v_referrer.id)) THEN
    RETURN json_build_object('ok', false, 'error', 'self_referral');
  END IF;
  -- "Nuevo" = ningún servicio completado antes, en ninguna fila del mismo teléfono.
  IF EXISTS (
    SELECT 1 FROM visits v
     WHERE v.client_id IN (SELECT loyalty_same_person_ids(p_client_id))
       AND (v.service_id IS NOT NULL OR v.queue_entry_id IS NOT NULL)
       AND (p_exclude_visit_id IS NULL OR v.id <> p_exclude_visit_id)
  ) THEN RETURN json_build_object('ok', false, 'error', 'not_new_client'); END IF;
  IF EXISTS (SELECT 1 FROM referrals WHERE referred_client_id IN (SELECT loyalty_same_person_ids(p_client_id)) AND status IN ('pending','completed')) THEN
    RETURN json_build_object('ok', false, 'error', 'already_referred');
  END IF;
  IF v_s.referral_max_per_referrer IS NOT NULL THEN
    SELECT count(*) INTO v_done FROM referrals WHERE referrer_client_id = v_referrer.id AND status IN ('pending','completed');
    IF v_done >= v_s.referral_max_per_referrer THEN RETURN json_build_object('ok', false, 'error', 'referrer_limit'); END IF;
  END IF;
  RETURN json_build_object('ok', true, 'referrer_client_id', v_referrer.id,
    'referrer_first_name', public.push_first_name(v_referrer.name),
    'discount_pct', v_s.referral_new_client_discount_pct,
    'referred_points', v_s.referral_new_client_points, 'referrer_points', v_s.referral_referrer_points);
END; $$;

-- Aplica el descuento a la visita y deja el referido `pending`: el trigger de
-- loyalty (que dispara con el UPDATE de amount) lo completa y acredita los
-- puntos a los dos. Mismo patrón que redeem_coupon_for_visit.
CREATE OR REPLACE FUNCTION public.apply_referral_for_visit(p_code text, p_visit_id uuid, p_service_subtotal numeric, p_staff_id uuid DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_visit visits%ROWTYPE; v_val json; v_discount numeric; v_net numeric; v_ref uuid; v_has_benefit boolean;
BEGIN
  SELECT * INTO v_visit FROM visits WHERE id = p_visit_id FOR UPDATE;
  IF v_visit.id IS NULL THEN RETURN json_build_object('success', false, 'error', 'visit_not_found'); END IF;
  v_val := validate_referral_for_checkout(v_visit.organization_id, p_code, v_visit.client_id, v_visit.branch_id, p_visit_id);
  IF NOT (v_val->>'ok')::boolean THEN RETURN json_build_object('success', false, 'error', v_val->>'error'); END IF;

  v_has_benefit := COALESCE(v_visit.discount_amount, 0) > 0 OR v_visit.client_reward_id IS NOT NULL;
  IF v_has_benefit THEN RETURN json_build_object('success', false, 'error', 'no_stacking'); END IF;

  v_discount := LEAST(round(GREATEST(p_service_subtotal, 0) * (v_val->>'discount_pct')::numeric / 100.0), GREATEST(v_visit.amount, 0));
  v_net := GREATEST(v_visit.amount - v_discount, 0);

  INSERT INTO referrals (organization_id, referrer_client_id, referred_client_id, visit_id, branch_id, service_id, scanned_by_staff_id,
                         status, discount_pct, discount_amount, referred_points, referrer_points)
  VALUES (v_visit.organization_id, (v_val->>'referrer_client_id')::uuid, v_visit.client_id, p_visit_id, v_visit.branch_id, v_visit.service_id,
          p_staff_id, 'pending', (v_val->>'discount_pct')::integer, v_discount, (v_val->>'referred_points')::integer, (v_val->>'referrer_points')::integer)
  RETURNING id INTO v_ref;
  PERFORM loyalty_log_event(v_visit.organization_id, v_visit.client_id, 'referral_created', p_visit_id,
    jsonb_build_object('referral_id', v_ref, 'referrer_client_id', v_val->>'referrer_client_id', 'discount_amount', v_discount));

  -- Dispara el trigger → loyalty_process_visit → loyalty_complete_referral_for_visit.
  UPDATE visits SET amount = v_net, discount_amount = COALESCE(discount_amount, 0) + v_discount WHERE id = p_visit_id;
  -- Si el programa hubiera quedado deshabilitado entre validar y aplicar, el
  -- trigger no corre: completar acá es idempotente (busca `pending`).
  PERFORM loyalty_complete_referral_for_visit(p_visit_id);

  RETURN json_build_object('success', true, 'referral_id', v_ref, 'discount_pct', (v_val->>'discount_pct')::integer,
    'discount_amount', v_discount, 'net_amount', v_net, 'referrer_first_name', v_val->>'referrer_first_name',
    'referred_points', (v_val->>'referred_points')::integer, 'referrer_points', (v_val->>'referrer_points')::integer);
END; $$;

-- ----------------------------------------------------------------------------
-- 8. Lectura para la app (auth.uid())
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.loyalty_tier_json(t loyalty_tiers)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('code', t.code, 'name', t.name, 'sort', t.sort_order, 'min_visits', t.min_visits, 'max_visits', t.max_visits,
    'multiplier_pct', t.multiplier_pct, 'color_primary', t.color_primary, 'color_secondary', t.color_secondary,
    'text_color', t.text_color, 'benefits', to_jsonb(t.benefits));
$$;

CREATE OR REPLACE FUNCTION public.get_client_loyalty()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_client clients%ROWTYPE; v_s loyalty_settings%ROWTYPE; v_state client_loyalty_state%ROWTYPE;
  v_tier loyalty_tiers%ROWTYPE; v_next loyalty_tiers%ROWTYPE; v_after loyalty_tiers%ROWTYPE;
  v_balance integer; v_soon integer; v_next_exp timestamptz; v_next_exp_pts integer; v_member timestamptz;
  v_earned integer; v_redeemed integer; v_ref_done integer; v_tiers jsonb;
BEGIN
  SELECT * INTO v_client FROM clients WHERE id = public.current_client_id();
  IF v_client.id IS NULL THEN RETURN jsonb_build_object('program', jsonb_build_object('enabled', false), 'error', 'client_not_found'); END IF;
  SELECT * INTO v_s FROM loyalty_settings WHERE organization_id = v_client.organization_id;

  SELECT COALESCE(jsonb_agg(loyalty_tier_json(t) ORDER BY t.sort_order), '[]'::jsonb) INTO v_tiers
    FROM loyalty_tiers t WHERE t.organization_id = v_client.organization_id AND t.is_active;

  IF v_s.organization_id IS NULL OR NOT v_s.is_enabled THEN
    RETURN jsonb_build_object(
      'program', jsonb_build_object('enabled', false),
      'client', jsonb_build_object('id', v_client.id, 'name', v_client.name, 'member_since', v_client.created_at),
      'tier', NULL, 'next_tier', NULL, 'visits_in_window', 0, 'grace', NULL,
      'points', jsonb_build_object('balance', loyalty_points_balance(v_client.id), 'expiring_soon_points', 0, 'next_expiry_at', NULL, 'next_expiry_points', 0),
      'referral', jsonb_build_object('enabled', false), 'tiers', v_tiers);
  END IF;

  -- Primer contacto: enrola y acredita el bono (una sola vez).
  PERFORM loyalty_recalc_tier(v_client.id);
  PERFORM loyalty_grant_welcome_bonus(v_client.id);
  SELECT * INTO v_state FROM client_loyalty_state WHERE client_id = v_client.id;
  SELECT * INTO v_tier FROM loyalty_tiers WHERE organization_id = v_client.organization_id AND code = v_state.tier_code;
  SELECT * INTO v_next FROM loyalty_tiers WHERE organization_id = v_client.organization_id AND is_active AND sort_order = v_state.tier_sort + 1;
  SELECT * INTO v_after FROM loyalty_tiers WHERE organization_id = v_client.organization_id AND is_active AND sort_order = v_state.tier_sort - 1;

  v_balance := loyalty_points_balance(v_client.id);
  SELECT COALESCE(SUM(remaining), 0) INTO v_soon FROM point_transactions
   WHERE client_id = v_client.id AND remaining > 0 AND expires_at > now() AND expires_at <= now() + make_interval(days => v_s.expiring_soon_days);
  SELECT expires_at, SUM(remaining) INTO v_next_exp, v_next_exp_pts FROM point_transactions
   WHERE client_id = v_client.id AND remaining > 0 AND expires_at > now() GROUP BY expires_at ORDER BY expires_at ASC LIMIT 1;
  SELECT COALESCE(SUM(points) FILTER (WHERE points > 0), 0), COALESCE(-SUM(points) FILTER (WHERE type = 'redeemed'), 0)
    INTO v_earned, v_redeemed FROM point_transactions WHERE client_id = v_client.id;
  SELECT LEAST(v_client.created_at, COALESCE(min(completed_at), v_client.created_at)) INTO v_member FROM visits WHERE client_id = v_client.id;
  SELECT count(*) INTO v_ref_done FROM referrals WHERE referrer_client_id = v_client.id AND status = 'completed';

  RETURN jsonb_build_object(
    'program', jsonb_build_object('enabled', true, 'started_at', v_s.program_started_at, 'base_points', v_s.base_points,
      'expiry_days', v_s.points_expiry_days, 'window_weeks', v_s.window_weeks, 'grace_days', v_s.grace_days, 'welcome_bonus_points', v_s.welcome_bonus_points),
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

CREATE OR REPLACE FUNCTION public.get_client_point_history(p_limit integer DEFAULT 80)
RETURNS TABLE (id uuid, points integer, type text, description text, created_at timestamptz, expires_at timestamptz,
               remaining integer, is_expired boolean, visit_id uuid, branch_name text, meta jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT t.id, t.points, t.type, t.description, t.created_at, t.expires_at, t.remaining,
         (t.points > 0 AND t.remaining = 0 AND t.expires_at IS NOT NULL AND t.expires_at <= now() AND t.reversed_by IS NULL) AS is_expired,
         t.visit_id, b.name, t.meta
  FROM point_transactions t LEFT JOIN branches b ON b.id = t.branch_id
  WHERE t.client_id = public.current_client_id()
  ORDER BY t.created_at DESC LIMIT LEAST(GREATEST(COALESCE(p_limit, 80), 1), 300);
$$;

CREATE OR REPLACE FUNCTION public.get_client_referrals()
RETURNS TABLE (id uuid, status text, created_at timestamptz, completed_at timestamptz, points integer,
               friend_first_name text, i_am_referrer boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.id, r.status, r.created_at, r.completed_at,
         CASE WHEN r.referrer_client_id = public.current_client_id() THEN r.referrer_points ELSE r.referred_points END,
         public.push_first_name(CASE WHEN r.referrer_client_id = public.current_client_id() THEN cr.name ELSE cf.name END),
         r.referrer_client_id = public.current_client_id()
  FROM referrals r
  JOIN clients cr ON cr.id = r.referred_client_id
  JOIN clients cf ON cf.id = r.referrer_client_id
  WHERE (r.referrer_client_id = public.current_client_id() OR r.referred_client_id = public.current_client_id())
    AND r.status <> 'rejected'
  ORDER BY r.created_at DESC;
$$;

-- Catálogo con los candados ya resueltos para ESTE cliente.
CREATE OR REPLACE FUNCTION public.get_loyalty_catalog()
RETURNS TABLE (id uuid, name text, description text, kind text, points_cost integer, discount_pct integer, is_free_service boolean,
               stock integer, image_url text, category text, allowed_tiers text[], allow_stacking boolean, validity_days integer,
               valid_from timestamptz, valid_until timestamptz, service_id uuid, service_name text, is_featured boolean, sort_order integer,
               locked_by_tier boolean, tier_required_code text, tier_required_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH me AS (
    SELECT c.id, c.organization_id, s.tier_code, s.tier_sort
    FROM clients c LEFT JOIN client_loyalty_state s ON s.client_id = c.id
    WHERE c.id = public.current_client_id()
  )
  SELECT r.id, r.name, r.description, r.kind, r.points_cost, r.discount_pct, r.is_free_service, r.stock, r.image_url, r.category,
         r.allowed_tiers, r.allow_stacking, r.validity_days, r.valid_from, r.valid_until, r.service_id, sv.name,
         r.is_featured, r.sort_order,
         (r.allowed_tiers IS NOT NULL AND (me.tier_code IS NULL OR NOT (me.tier_code = ANY (r.allowed_tiers)))) AS locked_by_tier,
         lt.code, lt.name
  FROM reward_catalog r
  JOIN me ON me.organization_id = r.organization_id
  LEFT JOIN services sv ON sv.id = r.service_id
  LEFT JOIN LATERAL (
    SELECT t.code, t.name FROM loyalty_tiers t
     WHERE t.organization_id = r.organization_id AND r.allowed_tiers IS NOT NULL AND t.code = ANY (r.allowed_tiers)
     ORDER BY t.sort_order ASC LIMIT 1
  ) lt ON true
  WHERE r.is_active AND r.points_cost > 0
    AND (r.valid_from IS NULL OR r.valid_from <= now()) AND (r.valid_until IS NULL OR r.valid_until > now())
  ORDER BY r.is_featured DESC, r.sort_order ASC, r.points_cost ASC, r.name ASC;
$$;

-- get_client_wallet: cambia el shape → DROP + CREATE (compatible hacia atrás:
-- sólo agrega columnas).
DROP FUNCTION IF EXISTS public.get_client_wallet();
CREATE FUNCTION public.get_client_wallet()
RETURNS TABLE (reward_id uuid, client_reward_id uuid, reward_name text, reward_description text, reward_type reward_type,
               discount_pct integer, is_free_service boolean, status client_reward_status, qr_code text, expires_at timestamptz,
               created_at timestamptz, image_url text, points_cost integer, category text,
               kind text, service_name text, points_spent integer, redeemed_at timestamptz, allow_stacking boolean, cancel_reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT rc.id, cr.id, rc.name, rc.description, rc.type, rc.discount_pct, rc.is_free_service,
         cr.status, cr.qr_code, cr.expires_at, cr.created_at, rc.image_url, rc.points_cost, rc.category,
         rc.kind, sv.name, cr.points_spent, cr.redeemed_at, rc.allow_stacking, cr.cancel_reason
  FROM client_rewards cr
  JOIN reward_catalog rc ON rc.id = cr.reward_id
  LEFT JOIN services sv ON sv.id = rc.service_id
  WHERE cr.client_id = public.current_client_id()
  ORDER BY cr.created_at DESC;
$$;

-- Saldo global derivado de los lotes (la app instalada lo sigue llamando).
CREATE OR REPLACE FUNCTION public.get_client_global_points()
RETURNS TABLE (total_balance integer, total_earned integer, total_redeemed integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT loyalty_points_balance(public.current_client_id()),
         COALESCE(SUM(points) FILTER (WHERE points > 0), 0)::integer,
         COALESCE(-SUM(points) FILTER (WHERE type = 'redeemed'), 0)::integer
  FROM point_transactions WHERE client_id = public.current_client_id();
$$;

-- ----------------------------------------------------------------------------
-- 9. Proceso diario (spec §11): vencimientos, avisos, gracia, beneficios.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.loyalty_daily_maintenance()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record; v_expired integer := 0; v_notified integer := 0; v_recalc integer := 0; v_rewards integer := 0; v_reminders integer := 0; v_res jsonb; v_tz text;
BEGIN
  -- 1. Lotes vencidos → movimiento `expired` + remaining 0.
  FOR r IN SELECT id, client_id, organization_id, remaining, expires_at FROM point_transactions
            WHERE remaining > 0 AND expires_at IS NOT NULL AND expires_at <= now() FOR UPDATE SKIP LOCKED LOOP
    INSERT INTO point_transactions (client_id, organization_id, points, remaining, type, description, reverses, meta)
    VALUES (r.client_id, r.organization_id, -r.remaining, 0, 'expired', 'Puntos vencidos', r.id, jsonb_build_object('lot_id', r.id, 'expired_at', r.expires_at));
    UPDATE point_transactions SET remaining = 0 WHERE id = r.id;
    PERFORM loyalty_log_event(r.organization_id, r.client_id, 'points_expired', NULL, jsonb_build_object('points', r.remaining, 'lot_id', r.id));
    v_expired := v_expired + 1;
  END LOOP;

  -- 2. Aviso de vencimiento próximo (una vez por lote).
  FOR r IN SELECT t.id, t.client_id, t.organization_id, t.remaining, t.expires_at, s.expiring_soon_days
             FROM point_transactions t JOIN loyalty_settings s ON s.organization_id = t.organization_id AND s.is_enabled
            WHERE t.remaining > 0 AND t.expires_at > now() AND t.expires_at <= now() + make_interval(days => s.expiring_soon_days) LOOP
    v_tz := loyalty_tz_of_branch((SELECT branch_id FROM visits WHERE client_id = r.client_id ORDER BY completed_at DESC LIMIT 1));
    IF loyalty_notify(r.organization_id, r.client_id, 'points_expiring',
         jsonb_build_object('puntos', r.remaining::text,
                            'dias', GREATEST(ceil(extract(epoch FROM (r.expires_at - now())) / 86400.0)::integer, 1)::text,
                            'fecha', to_char(r.expires_at AT TIME ZONE v_tz, 'DD/MM')),
         'expiring:' || r.id) THEN v_notified := v_notified + 1; END IF;
  END LOOP;

  -- 3. Categorías: detecta caídas fuera de ventana (gracia) y bajadas vencidas.
  FOR r IN SELECT st.client_id, st.grace_until, st.tier_code FROM client_loyalty_state st
             JOIN loyalty_settings s ON s.organization_id = st.organization_id AND s.is_enabled
            WHERE st.tier_code IS NOT NULL LOOP
    v_res := loyalty_recalc_tier(r.client_id);
    IF v_res->>'change' IS NOT NULL THEN v_recalc := v_recalc + 1; END IF;
  END LOOP;

  -- 4. Recordatorio de gracia a 3 días (una vez por gracia).
  FOR r IN SELECT st.client_id, st.organization_id, st.grace_until, t.name
             FROM client_loyalty_state st
             JOIN loyalty_tiers t ON t.organization_id = st.organization_id AND t.code = st.tier_code
             JOIN loyalty_settings s ON s.organization_id = st.organization_id AND s.is_enabled
            WHERE st.grace_until IS NOT NULL AND st.grace_until > now() AND st.grace_until <= now() + interval '3 days' LOOP
    IF loyalty_notify(r.organization_id, r.client_id, 'tier_grace_reminder',
         jsonb_build_object('categoria', r.name, 'dias', GREATEST(ceil(extract(epoch FROM (r.grace_until - now())) / 86400.0)::integer, 1)::text),
         'grace_reminder:' || to_char(r.grace_until, 'YYYY-MM-DD')) THEN v_reminders := v_reminders + 1; END IF;
  END LOOP;

  -- 5. Beneficios canjeados vencidos.
  WITH x AS (UPDATE client_rewards SET status = 'expired' WHERE status = 'available' AND expires_at IS NOT NULL AND expires_at < now() RETURNING 1)
  SELECT count(*) INTO v_rewards FROM x;

  RETURN jsonb_build_object('lots_expired', v_expired, 'expiring_notified', v_notified, 'tier_changes', v_recalc,
                            'grace_reminders', v_reminders, 'rewards_expired', v_rewards, 'ran_at', now());
END; $$;

-- ----------------------------------------------------------------------------
-- 10. Alta, habilitación, backfill y simulador (dashboard, service_role)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.loyalty_seed_org(p_org uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO loyalty_settings (organization_id) VALUES (p_org) ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO loyalty_tiers (organization_id, code, name, sort_order, min_visits, max_visits, multiplier_pct, color_primary, color_secondary, text_color, benefits) VALUES
    (p_org, 'bronce',   'Bronce',   1, 0, 2,    100, '#7A4A22', '#C78A4E', '#FFF4E8', ARRAY['Sumás puntos en cada visita', 'Acceso al catálogo de premios']),
    (p_org, 'plata',    'Plata',    2, 3, 5,    105, '#3E444D', '#C9CFD6', '#FFFFFF', ARRAY['5 % más de puntos por visita', 'Premios exclusivos Plata']),
    (p_org, 'oro',      'Oro',      3, 6, 8,    110, '#7A5A12', '#F2CC5B', '#1A1200', ARRAY['10 % más de puntos por visita', 'Premios exclusivos Oro', 'Prioridad en novedades']),
    (p_org, 'platinum', 'Platinum', 4, 9, NULL, 115, '#0B0B0D', '#3A3A44', '#F5F5F7', ARRAY['15 % más de puntos por visita', 'Premios exclusivos Platinum', 'Beneficios en comercios asociados'])
  ON CONFLICT (organization_id, code) DO NOTHING;

  INSERT INTO loyalty_notification_rules (organization_id, kind, is_enabled, title, body, days_before, deep_link, sort_order) VALUES
    (p_org, 'tier_up',                      true,  '¡Llegaste a Cliente {{categoria}}!',                  'Ahora sumás puntos al {{multiplicador}} % en cada visita. Seguí así.',            NULL, '/categoria', 10),
    (p_org, 'near_tier',                    true,  'Te falta una visita para {{categoria_siguiente}}',    'Ya tenés {{visitas}} visitas recientes. Una más y subís de categoría.',            NULL, '/categoria', 20),
    (p_org, 'tier_grace_warning',           true,  'Tu nivel {{categoria}} está por vencer',              'Realizá una visita antes del {{fecha}} para mantener tu categoría.',               NULL, '/categoria', 30),
    (p_org, 'tier_grace_reminder',          true,  'Tenés {{dias}} días para mantener tu nivel {{categoria}}', 'Una visita alcanza para seguir siendo Cliente {{categoria}}.',                 3,    '/categoria', 40),
    (p_org, 'tier_down',                    true,  'Tu categoría cambió a {{categoria}}',                 'Tus puntos siguen intactos. Volvé pronto para recuperar tu nivel.',                NULL, '/categoria', 50),
    (p_org, 'points_earned',                false, 'Sumaste {{puntos}} puntos',                           'Ya tenés {{saldo}} puntos para canjear en la app.',                                NULL, '/points',    60),
    (p_org, 'points_expiring',              true,  'Tenés {{puntos}} puntos que vencen en {{dias}} días', 'Canjealos antes del {{fecha}} para no perderlos.',                                 14,   '/points',    70),
    (p_org, 'reward_unlocked',              true,  'Ya podés canjear {{premio}}',                         'Tenés {{saldo}} puntos. Entrá a la app y canjealo.',                               NULL, '/rewards',   80),
    (p_org, 'near_reward',                  true,  'Te faltan {{faltan}} puntos para {{premio}}',         'Estás cerca. Tu próxima visita te acerca al premio.',                              NULL, '/rewards',   90),
    (p_org, 'benefit_new',                  true,  'Tenés un nuevo beneficio disponible',                 '{{premio}} ya está en Mis premios. Mostrá el QR en la barbería antes del {{fecha}}.', NULL, '/mis-premios', 100),
    (p_org, 'referral_completed_referrer',  true,  'Tu recomendación se completó',                        '{{nombre_amigo}} ya se cortó en Monaco. Sumaste {{puntos}} puntos.',               NULL, '/invitar',   110),
    (p_org, 'referral_completed_referred',  true,  'Bienvenido a Monaco',                                 'Ya tenés tus primeros {{puntos}} puntos. Mirá los premios en la app.',             NULL, '/rewards',   120)
  ON CONFLICT (organization_id, kind) DO NOTHING;
END; $$;

-- Categoría inicial de TODOS los clientes con historial, en una sola query
-- (spec §1: "si ya tenía frecuencia de Platinum, entra como Platinum"). Sólo
-- enrola a los que no tenían categoría; sin puntos retroactivos.
CREATE OR REPLACE FUNCTION public.loyalty_backfill_tiers(p_org uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_s loyalty_settings%ROWTYPE; v_n integer;
BEGIN
  SELECT * INTO v_s FROM loyalty_settings WHERE organization_id = p_org;
  IF v_s.organization_id IS NULL THEN RETURN 0; END IF;
  WITH counts AS (
    SELECT v.client_id, count(DISTINCT (v.completed_at AT TIME ZONE COALESCE(b.timezone, 'America/Argentina/Buenos_Aires'))::date)::integer AS n
    FROM visits v LEFT JOIN branches b ON b.id = v.branch_id LEFT JOIN services s ON s.id = v.service_id
    WHERE v.organization_id = p_org AND v.client_id IS NOT NULL
      AND v.completed_at > now() - make_interval(weeks => v_s.window_weeks)
      AND (v.service_id IS NOT NULL OR v.queue_entry_id IS NOT NULL)
      AND (v.service_id IS NULL OR COALESCE(s.counts_as_visit, true))
    GROUP BY v.client_id
  ), everyone AS (
    SELECT c.id AS client_id, COALESCE(k.n, 0) AS n
    FROM clients c LEFT JOIN counts k ON k.client_id = c.id
    WHERE c.organization_id = p_org AND EXISTS (SELECT 1 FROM visits v WHERE v.client_id = c.id)
  ), targets AS (
    SELECT e.client_id, e.n, t.code, t.sort_order
    FROM everyone e
    JOIN LATERAL (
      SELECT code, sort_order FROM loyalty_tiers
       WHERE organization_id = p_org AND is_active AND min_visits <= e.n
       ORDER BY sort_order DESC LIMIT 1
    ) t ON true
  ), upserted AS (
    INSERT INTO client_loyalty_state (client_id, organization_id, tier_code, tier_sort, visits_in_window, tier_reached_at, enrolled_at, last_recalc_at)
    SELECT client_id, p_org, code, sort_order, n, now(), now(), now() FROM targets
    ON CONFLICT (client_id) DO UPDATE
      SET tier_code = EXCLUDED.tier_code, tier_sort = EXCLUDED.tier_sort, visits_in_window = EXCLUDED.visits_in_window,
          tier_reached_at = now(), enrolled_at = COALESCE(client_loyalty_state.enrolled_at, now()), last_recalc_at = now(), updated_at = now()
      WHERE client_loyalty_state.tier_code IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM upserted;
  PERFORM loyalty_log_event(p_org, NULL, 'backfill', NULL, jsonb_build_object('enrolled', v_n, 'window_weeks', v_s.window_weeks));
  RETURN v_n;
END; $$;

CREATE OR REPLACE FUNCTION public.loyalty_set_program_enabled(p_org uuid, p_enabled boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_n integer := 0; v_first boolean;
BEGIN
  PERFORM loyalty_seed_org(p_org);
  IF p_enabled THEN
    SELECT program_started_at IS NULL INTO v_first FROM loyalty_settings WHERE organization_id = p_org;
    UPDATE loyalty_settings SET is_enabled = true, program_started_at = COALESCE(program_started_at, now()), updated_at = now()
     WHERE organization_id = p_org;
    v_n := loyalty_backfill_tiers(p_org);
    PERFORM loyalty_log_event(p_org, NULL, 'program_enabled', NULL, jsonb_build_object('enrolled', v_n, 'first_time', v_first));
  ELSE
    UPDATE loyalty_settings SET is_enabled = false, updated_at = now() WHERE organization_id = p_org;
    PERFORM loyalty_log_event(p_org, NULL, 'program_disabled', NULL, '{}'::jsonb);
  END IF;
  RETURN jsonb_build_object('enabled', p_enabled, 'enrolled', v_n);
END; $$;

-- Simulador: cuántos clientes caerían en cada categoría con umbrales hipotéticos.
-- p_thresholds = [min_plata, min_oro, min_platinum].
CREATE OR REPLACE FUNCTION public.loyalty_preview_distribution(p_org uuid, p_window_weeks integer, p_thresholds integer[])
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH counts AS (
    SELECT v.client_id, count(DISTINCT (v.completed_at AT TIME ZONE COALESCE(b.timezone, 'America/Argentina/Buenos_Aires'))::date)::integer AS n
    FROM visits v LEFT JOIN branches b ON b.id = v.branch_id LEFT JOIN services s ON s.id = v.service_id
    WHERE v.organization_id = p_org AND v.client_id IS NOT NULL
      AND v.completed_at > now() - make_interval(weeks => GREATEST(COALESCE(p_window_weeks, 12), 1))
      AND (v.service_id IS NOT NULL OR v.queue_entry_id IS NOT NULL)
      AND (v.service_id IS NULL OR COALESCE(s.counts_as_visit, true))
    GROUP BY v.client_id
  ), everyone AS (
    SELECT c.id, COALESCE(k.n, 0) AS n FROM clients c LEFT JOIN counts k ON k.client_id = c.id
    WHERE c.organization_id = p_org AND EXISTS (SELECT 1 FROM visits v WHERE v.client_id = c.id)
  )
  SELECT jsonb_build_object(
    'bronce',   count(*) FILTER (WHERE n < p_thresholds[1]),
    'plata',    count(*) FILTER (WHERE n >= p_thresholds[1] AND n < p_thresholds[2]),
    'oro',      count(*) FILTER (WHERE n >= p_thresholds[2] AND n < p_thresholds[3]),
    'platinum', count(*) FILTER (WHERE n >= p_thresholds[3]),
    'total', count(*), 'with_visits_in_window', count(*) FILTER (WHERE n > 0))
  FROM everyone;
$$;

-- Resumen para /dashboard/fidelizacion.
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
      'issued_30d', COALESCE(SUM(points) FILTER (WHERE points > 0 AND created_at > now() - interval '30 days'), 0),
      'redeemed_30d', COALESCE(-SUM(points) FILTER (WHERE type = 'redeemed' AND created_at > now() - interval '30 days'), 0),
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

-- Ficha de un cliente para la pestaña Clientes del dashboard.
CREATE OR REPLACE FUNCTION public.loyalty_client_summary(p_client_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_client clients%ROWTYPE; v_state client_loyalty_state%ROWTYPE; v_tier loyalty_tiers%ROWTYPE; v_next loyalty_tiers%ROWTYPE; v_s loyalty_settings%ROWTYPE;
BEGIN
  SELECT * INTO v_client FROM clients WHERE id = p_client_id;
  IF v_client.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_s FROM loyalty_settings WHERE organization_id = v_client.organization_id;
  SELECT * INTO v_state FROM client_loyalty_state WHERE client_id = p_client_id;
  SELECT * INTO v_tier FROM loyalty_tiers WHERE organization_id = v_client.organization_id AND code = v_state.tier_code;
  SELECT * INTO v_next FROM loyalty_tiers WHERE organization_id = v_client.organization_id AND is_active AND sort_order = v_state.tier_sort + 1;
  RETURN jsonb_build_object(
    'client', jsonb_build_object('id', v_client.id, 'name', v_client.name, 'phone', v_client.phone, 'created_at', v_client.created_at,
                                 'referral_code', v_client.referral_code, 'has_app', v_client.auth_user_id IS NOT NULL),
    'state', CASE WHEN v_state.id IS NULL THEN NULL ELSE jsonb_build_object('tier_code', v_state.tier_code, 'tier_name', v_tier.name,
       'color_primary', v_tier.color_primary, 'color_secondary', v_tier.color_secondary, 'text_color', v_tier.text_color,
       'visits_in_window', v_state.visits_in_window, 'total_visits', v_state.total_visits, 'tier_reached_at', v_state.tier_reached_at,
       'grace_until', v_state.grace_until, 'enrolled_at', v_state.enrolled_at, 'last_visit_at', v_state.last_visit_at,
       'next_tier_name', v_next.name, 'visits_to_next', CASE WHEN v_next.id IS NULL THEN NULL ELSE GREATEST(v_next.min_visits - v_state.visits_in_window, 0) END,
       'welcome_bonus', v_state.welcome_bonus_tx_id IS NOT NULL) END,
    'visits_in_window_live', CASE WHEN v_s.organization_id IS NULL THEN NULL ELSE loyalty_visits_in_window(p_client_id, now(), v_s.window_weeks) END,
    'balance', loyalty_points_balance(p_client_id),
    'lots', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', t.id, 'points', t.points, 'remaining', t.remaining, 'type', t.type,
               'description', t.description, 'created_at', t.created_at, 'expires_at', t.expires_at, 'visit_id', t.visit_id, 'meta', t.meta,
               'reversed', t.reversed_by IS NOT NULL) ORDER BY t.created_at DESC), '[]'::jsonb)
             FROM (SELECT * FROM point_transactions WHERE client_id = p_client_id ORDER BY created_at DESC LIMIT 100) t),
    'rewards', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', cr.id, 'name', rc.name, 'kind', rc.kind, 'status', cr.status,
               'points_spent', cr.points_spent, 'created_at', cr.created_at, 'expires_at', cr.expires_at, 'redeemed_at', cr.redeemed_at,
               'qr_code', cr.qr_code, 'source', cr.source, 'cancel_reason', cr.cancel_reason) ORDER BY cr.created_at DESC), '[]'::jsonb)
             FROM client_rewards cr JOIN reward_catalog rc ON rc.id = cr.reward_id WHERE cr.client_id = p_client_id),
    'referrals', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status, 'created_at', r.created_at, 'completed_at', r.completed_at,
               'i_am_referrer', r.referrer_client_id = p_client_id,
               'other_name', CASE WHEN r.referrer_client_id = p_client_id THEN (SELECT name FROM clients WHERE id = r.referred_client_id) ELSE (SELECT name FROM clients WHERE id = r.referrer_client_id) END,
               'referrer_points', r.referrer_points, 'referred_points', r.referred_points, 'discount_amount', r.discount_amount, 'visit_id', r.visit_id) ORDER BY r.created_at DESC), '[]'::jsonb)
             FROM referrals r WHERE r.referrer_client_id = p_client_id OR r.referred_client_id = p_client_id),
    'events', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'data', e.data, 'visit_id', e.visit_id, 'created_at', e.created_at) ORDER BY e.created_at DESC), '[]'::jsonb)
             FROM (SELECT * FROM loyalty_events WHERE client_id = p_client_id ORDER BY created_at DESC LIMIT 60) e),
    'recent_visits', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', v.id, 'completed_at', v.completed_at, 'amount', v.amount, 'discount_amount', v.discount_amount,
               'service_name', sv.name, 'branch_name', b.name,
               'lot_points', (SELECT points FROM point_transactions t WHERE t.visit_id = v.id AND t.type = 'earned' AND t.reversed_by IS NULL LIMIT 1)) ORDER BY v.completed_at DESC), '[]'::jsonb)
             FROM (SELECT * FROM visits WHERE client_id = p_client_id ORDER BY completed_at DESC LIMIT 15) v
             LEFT JOIN services sv ON sv.id = v.service_id LEFT JOIN branches b ON b.id = v.branch_id));
END; $$;

-- ----------------------------------------------------------------------------
-- 11. Grants
-- ----------------------------------------------------------------------------
DO $$
DECLARE f text;
BEGIN
  -- Todo restringido por default.
  FOR f IN SELECT format('%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid))
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND (p.proname LIKE 'loyalty\_%' OR p.proname IN (
              'redeem_coupon_for_visit','deliver_reward_by_qr','validate_referral_for_checkout','apply_referral_for_visit',
              'get_my_referral_code','get_client_loyalty','get_client_point_history','get_client_referrals','get_loyalty_catalog',
              'get_client_wallet','get_client_global_points','redeem_points_for_reward'))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM public, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;

-- RPC del cliente (resuelven por auth.uid()).
GRANT EXECUTE ON FUNCTION public.get_client_loyalty() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_client_point_history(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_client_referrals() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_loyalty_catalog() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_referral_code() TO authenticated;
GRANT EXECUTE ON FUNCTION public.loyalty_redeem_reward(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_client_wallet() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_client_global_points() TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_points_for_reward(uuid) TO authenticated;
-- loyalty_render / loyalty_tier_json son puras y las usan las anteriores; con DEFINER no hace falta grant.

-- ----------------------------------------------------------------------------
-- 12. Cron diario (03:00 ART = 06:00 UTC), SQL puro.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'loyalty-daily-maintenance') THEN
      PERFORM cron.schedule('loyalty-daily-maintenance', '0 6 * * *', $cron$SELECT public.loyalty_daily_maintenance()$cron$);
    END IF;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 13. Seed de Monaco (deshabilitado: el dueño lo prende desde el dashboard,
--     que es cuando se fija program_started_at y se enrola a todos).
-- ----------------------------------------------------------------------------
SELECT public.loyalty_seed_org('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');

-- Escalera de premios de referencia (spec §4), INACTIVA: el dueño la activa.
INSERT INTO public.reward_catalog (organization_id, name, description, type, kind, points_cost, discount_pct, is_free_service, stock, is_active, category, sort_order, validity_days)
SELECT 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', x.name, x.descr, 'points_redemption', x.kind, x.pts, x.pct, COALESCE(x.pct, 0) = 100, x.stock, false, x.cat, x.ord, 30
FROM (VALUES
  ('30 % OFF en tu corte',  'Descuento sobre el precio vigente del servicio.', 'descuento', 300,  30,  NULL::integer, 'cortes', 10),
  ('50 % OFF en tu corte',  'Descuento sobre el precio vigente del servicio.', 'descuento', 500,  50,  NULL, 'cortes', 20),
  ('75 % OFF en tu corte',  'Descuento sobre el precio vigente del servicio.', 'descuento', 750,  75,  NULL, 'cortes', 30),
  ('Corte gratis',          'Un servicio sin cargo.',                           'descuento', 1000, 100, NULL, 'cortes', 40),
  ('Gorra Monaco',          'Retirala en cualquier sucursal.',                  'merch',     900,  NULL, 20,  'merch',  50),
  ('Remera Monaco',         'Retirala en cualquier sucursal.',                  'merch',     1200, NULL, 20,  'merch',  60),
  ('Mate Monaco',           'Retiralo en cualquier sucursal.',                  'merch',     1500, NULL, 10,  'merch',  70)
) AS x(name, descr, kind, pts, pct, stock, cat, ord)
WHERE NOT EXISTS (SELECT 1 FROM public.reward_catalog r WHERE r.organization_id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' AND r.name = x.name);
