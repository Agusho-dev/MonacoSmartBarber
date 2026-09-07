-- ============================================================================
-- 200 — Fidelización: get_client_loyalty() expone reward_validity_days y los
--       totales también con el programa apagado
-- ============================================================================
-- La app necesita decir "Válido por 30 días" al confirmar un canje de un
-- premio que no define validity_days propio (usa el default de la org), y la
-- pantalla de puntos muestra Ganados/Canjeados aunque el programa esté apagado.
-- Sólo agrega claves al JSON; nada de lo existente cambia de forma.
-- ============================================================================

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
  SELECT COALESCE(SUM(points) FILTER (WHERE points > 0), 0), COALESCE(-SUM(points) FILTER (WHERE type = 'redeemed'), 0)
    INTO v_earned, v_redeemed FROM point_transactions WHERE client_id = v_client.id;

  IF v_s.organization_id IS NULL OR NOT v_s.is_enabled THEN
    RETURN jsonb_build_object(
      'program', jsonb_build_object('enabled', false, 'reward_validity_days', COALESCE(v_s.reward_validity_days, 30)),
      'client', jsonb_build_object('id', v_client.id, 'name', v_client.name, 'member_since', v_client.created_at),
      'tier', NULL, 'next_tier', NULL, 'visits_in_window', 0, 'grace', NULL,
      'points', jsonb_build_object('balance', loyalty_points_balance(v_client.id), 'expiring_soon_points', 0, 'next_expiry_at', NULL,
                                   'next_expiry_points', 0, 'earned_total', v_earned, 'redeemed_total', v_redeemed),
      'referral', jsonb_build_object('enabled', false), 'tiers', v_tiers);
  END IF;

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
  -- El bono de bienvenida recién acreditado tiene que entrar en los totales.
  SELECT COALESCE(SUM(points) FILTER (WHERE points > 0), 0), COALESCE(-SUM(points) FILTER (WHERE type = 'redeemed'), 0)
    INTO v_earned, v_redeemed FROM point_transactions WHERE client_id = v_client.id;
  SELECT LEAST(v_client.created_at, COALESCE(min(completed_at), v_client.created_at)) INTO v_member FROM visits WHERE client_id = v_client.id;
  SELECT count(*) INTO v_ref_done FROM referrals WHERE referrer_client_id = v_client.id AND status = 'completed';

  RETURN jsonb_build_object(
    'program', jsonb_build_object('enabled', true, 'started_at', v_s.program_started_at, 'base_points', v_s.base_points,
      'expiry_days', v_s.points_expiry_days, 'window_weeks', v_s.window_weeks, 'grace_days', v_s.grace_days,
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

REVOKE ALL ON FUNCTION public.get_client_loyalty() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_client_loyalty() TO authenticated, service_role;
