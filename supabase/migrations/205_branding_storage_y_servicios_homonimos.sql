-- ============================================================================
-- 205 — Fidelización: bucket branding sólo service_role + homónimos por nombre
-- ============================================================================
-- 1. `branding` es un bucket PÚBLICO de lectura con policies de escritura para
--    CUALQUIER `authenticated` (sin scope de org ni de path): un cliente de la
--    app podía subir o PISAR el logo de la org, imágenes de push o fotos de
--    premios. Todos los caminos legítimos ya escriben con service role
--    (`uploadOrgLogo`, `uploadPushImage`, `uploadRewardImage`: createAdminClient),
--    así que las policies de escritura se dropean. Además se saca `image/svg+xml`
--    de los MIME permitidos: un SVG servido desde un bucket público es un vector
--    de XSS almacenado y ninguna pantalla sube SVG.
-- 2. El editor de premios agrupa servicios HOMÓNIMOS de distintas sucursales
--    ("Corte · todas las sucursales") pero `redeem_coupon_for_visit` comparaba
--    por id exacto: un "Corte gratis" atado al Corte de Paraná se rechazaba con
--    `wrong_service` al cobrar en Caseros. El guard pasa a aceptar cualquier
--    servicio del cobro con el MISMO nombre normalizado (`norm_text`, mig 167)
--    que el servicio del premio, y la base del descuento es el precio del
--    servicio REALMENTE cobrado en esa sucursal (fallback: el del catálogo).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Storage
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS branding_auth_insert ON storage.objects;
DROP POLICY IF EXISTS branding_auth_update ON storage.objects;
UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp']
 WHERE id = 'branding';

-- ----------------------------------------------------------------------------
-- 2. Servicios homónimos en el canje del cobro
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redeem_coupon_for_visit(p_qr_code text, p_visit_id uuid, p_service_subtotal numeric)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_visit visits%ROWTYPE; v_reward client_rewards%ROWTYPE; v_catalog reward_catalog%ROWTYPE;
  v_pct numeric; v_discount numeric; v_net numeric; v_same_person boolean; v_branch_tz text; v_has_benefit boolean;
  v_base numeric; v_matched_id uuid; v_matched_price numeric;
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

  -- Servicio acotado: se acepta el mismo id O un homónimo (mismo nombre
  -- normalizado) entre los servicios del cobro. El editor del catálogo agrupa
  -- por nombre; este guard honra esa equivalencia.
  IF v_catalog.service_id IS NOT NULL THEN
    SELECT s2.id, s2.price INTO v_matched_id, v_matched_price
      FROM services s1
      JOIN services s2 ON norm_text(s2.name) = norm_text(s1.name)
     WHERE s1.id = v_catalog.service_id
       AND (s2.id = v_visit.service_id OR s2.id = ANY (COALESCE(v_visit.extra_services, '{}'::uuid[])))
     ORDER BY (s2.id = v_visit.service_id) DESC
     LIMIT 1;
    IF v_matched_id IS NULL AND v_visit.service_id IS NOT NULL THEN
      RETURN json_build_object('success', false, 'error', 'wrong_service',
        'service_name', (SELECT name FROM services WHERE id = v_catalog.service_id));
    END IF;
  END IF;

  v_has_benefit := COALESCE(v_visit.discount_amount, 0) > 0 OR v_visit.client_reward_id IS NOT NULL
                   OR EXISTS (SELECT 1 FROM referrals WHERE visit_id = p_visit_id AND status IN ('pending','completed'));
  IF v_has_benefit AND NOT v_catalog.allow_stacking THEN
    RETURN json_build_object('success', false, 'error', 'no_stacking');
  END IF;

  v_pct := CASE WHEN v_catalog.is_free_service THEN 100 ELSE COALESCE(v_catalog.discount_pct, 0) END;
  -- Base del descuento: el precio del servicio realmente cobrado (homónimo de
  -- ESTA sucursal) → el precio vigente del servicio del catálogo → el subtotal.
  v_base := GREATEST(p_service_subtotal, 0);
  IF v_catalog.service_id IS NOT NULL THEN
    IF v_matched_price IS NULL THEN
      SELECT price INTO v_matched_price FROM services WHERE id = v_catalog.service_id;
    END IF;
    v_base := LEAST(COALESCE(v_matched_price, v_base), v_base);
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
    jsonb_build_object('client_reward_id', v_reward.id, 'reward_name', v_catalog.name, 'kind', v_catalog.kind,
                       'discount_amount', v_discount, 'base', v_base, 'matched_service_id', v_matched_id));

  RETURN json_build_object('success', true, 'client_reward_id', v_reward.id, 'reward_name', v_catalog.name, 'kind', v_catalog.kind,
    'discount_pct', v_catalog.discount_pct, 'is_free_service', v_catalog.is_free_service, 'discount_amount', v_discount, 'net_amount', v_net,
    'service_id', v_catalog.service_id, 'base_amount', v_base);
END; $$;
