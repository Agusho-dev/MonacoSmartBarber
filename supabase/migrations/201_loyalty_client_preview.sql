-- ============================================================================
-- 201 — Fidelización: vista previa POR CLIENTE con el programa apagado
-- ============================================================================
-- El dueño/desarrollador quiere ver las tarjetas de categoría en su propio
-- teléfono sin encender el programa para los 6.000 clientes. Mientras
-- `client_loyalty_state.preview_until` esté vigente, get_client_loyalty() y el
-- canje tratan a ESE cliente como si el programa estuviera activo, leyendo la
-- categoría directamente del estado (que se fija a mano). Nada más cambia:
-- el trigger de visitas y el cron siguen mirando loyalty_settings.is_enabled,
-- así que ningún otro cliente se entera. Cuando el programa se prenda de
-- verdad, la recalculación normal manda y conviene poner preview_until en NULL.
-- ============================================================================

ALTER TABLE public.client_loyalty_state ADD COLUMN IF NOT EXISTS preview_until timestamptz;
COMMENT ON COLUMN public.client_loyalty_state.preview_until IS 'Vista previa por cliente: hasta esta fecha el cliente ve el programa como activo aunque loyalty_settings.is_enabled sea false (demo/desarrollo).';

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
  SELECT COALESCE(SUM(points) FILTER (WHERE points > 0), 0), COALESCE(-SUM(points) FILTER (WHERE type = 'redeemed'), 0)
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

  -- Con el programa encendido de verdad: enrolar y bono (una sola vez). En
  -- vista previa las dos son no-op (miran is_enabled) y la categoría es la
  -- que se fijó a mano en el estado.
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
  SELECT COALESCE(SUM(points) FILTER (WHERE points > 0), 0), COALESCE(-SUM(points) FILTER (WHERE type = 'redeemed'), 0)
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

-- El canje también respeta la vista previa (para poder probar el QR en el cobro).
CREATE OR REPLACE FUNCTION public.loyalty_redeem_reward_for_client(p_client_id uuid, p_reward_id uuid, p_channel text DEFAULT 'app')
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_client clients%ROWTYPE; v_s loyalty_settings%ROWTYPE; v_state client_loyalty_state%ROWTYPE; v_reward reward_catalog%ROWTYPE;
  v_balance integer; v_tx uuid; v_cr client_rewards%ROWTYPE; v_required_tier text; v_validity integer; v_preview boolean;
BEGIN
  SELECT * INTO v_client FROM clients WHERE id = p_client_id;
  IF v_client.id IS NULL THEN RETURN json_build_object('success', false, 'error', 'client_not_found'); END IF;
  SELECT * INTO v_s FROM loyalty_settings WHERE organization_id = v_client.organization_id;
  IF v_s.organization_id IS NULL THEN RETURN json_build_object('success', false, 'error', 'program_disabled'); END IF;

  INSERT INTO client_loyalty_state (client_id, organization_id) VALUES (p_client_id, v_client.organization_id) ON CONFLICT (client_id) DO NOTHING;
  SELECT * INTO v_state FROM client_loyalty_state WHERE client_id = p_client_id FOR UPDATE;
  v_preview := v_state.preview_until IS NOT NULL AND v_state.preview_until > now();
  IF NOT v_s.is_enabled AND NOT v_preview THEN RETURN json_build_object('success', false, 'error', 'program_disabled'); END IF;

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
