-- ============================================================================
-- 206: Fidelización — ronda 3 adversarial (homónimos con espacios de borde y
--      prioridad del match servicio↔premio en redeem_coupon_for_visit)
--
-- (1) norm_text NO trimea (cuerpo vivo: lower(unaccent(t))) y los tres
--     normalizadores TS sí lo hacen (normalizarNombreServicio en
--     loyalty-checkout.ts y normNombre del editor de premios). En prod había
--     dos servicios ACTIVOS con espacio final, los dos de Rondeau: "Corte "
--     ($16.000) y "Corte + Barba " ($20.000). Con un premio acotado a "Corte"
--     la previa de la tablet matcheaba por nombre trimeado y mostraba el
--     precio CON descuento, y la RPC contestaba wrong_service → el cobro
--     salía a precio LLENO con un warning tardío. Arreglo mínimo y seguro:
--     btrim EN EL CALL-SITE del JOIN + trim del dato.
--     NO se redefine norm_text: es IMMUTABLE y su semántica está horneada en
--     search_clients_page / quick_search_clients / search_conversations
--     (ningún índice la usa, verificado en pg_index, pero cambiarla alteraría
--     esas features en silencio). El btrim en el call-site es el cambio más
--     chico que restablece la equivalencia con el lado TS.
--
-- (2) La previa TS (servicioQueMatcheaBeneficio) prioriza el id exacto del
--     premio en TODO el cobro y recién después matchea por nombre en orden
--     main → extras; la RPC ordenaba sólo por (s2.id = v_visit.service_id)
--     DESC, sin más desempate. Con homónimos de precios distintos en la misma
--     sucursal (caso real de Paraná: "Corte" checkin $16.000 y "Corte" upsell
--     $10.000), un premio anclado al upsell en un cobro con el checkin de
--     main hacía que la previa mostrara −$10.000 y la visita quedara con
--     −$16.000. Además, dos extras homónimos sin main que matchee empataban
--     sin criterio (resultado no determinista). El ORDER BY nuevo replica
--     EXACTAMENTE la regla de la previa: id exacto → main → extras en su
--     orden de selección.
--
-- Autosuficiente (regla mig 168 / Known Risk #23): cuerpo COMPLETO de la
-- función, tomado de pg_get_functiondef contra el cuerpo VIVO de prod, no
-- del repo. CREATE OR REPLACE conserva los grants existentes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) El dato: sacar los espacios de borde de services.name para que no vuelva
--    a divergir de la equivalencia trimeada. Verificado: exactamente 2 filas
--    ("Corte " y "Corte + Barba ", ambas de Rondeau) y ningún UNIQUE sobre
--    services.name (sólo la PK y un índice por branch), así que este UPDATE
--    no puede chocar con nada.
-- ----------------------------------------------------------------------------
UPDATE services SET name = btrim(name) WHERE name <> btrim(name);

-- ----------------------------------------------------------------------------
-- 2) redeem_coupon_for_visit: btrim en el JOIN de homónimos + prioridad del
--    match espejada con la previa TS. Sólo cambian el JOIN y el ORDER BY del
--    bloque "IF v_catalog.service_id IS NOT NULL"; el resto es idéntico al
--    cuerpo vivo que dejó la mig 205.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redeem_coupon_for_visit(p_qr_code text, p_visit_id uuid, p_service_subtotal numeric)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- Premio acotado a un servicio: buscar en el cobro (main + extras) un
  -- servicio equivalente por id o por nombre normalizado.
  -- (Ronda 3, cambio 1) btrim en los DOS lados del JOIN: norm_text no trimea
  -- (y no se toca: la comparten la búsqueda de clientes y conversaciones)
  -- pero los normalizadores TS de la previa y del editor de premios sí
  -- trimean — "Corte " de Rondeau tiene que equivaler a "Corte".
  -- (Ronda 3, cambio 2) La prioridad replica EXACTAMENTE la de la previa TS
  -- (servicioQueMatcheaBeneficio, src/lib/loyalty-checkout.ts):
  --   1º el id exacto del premio, esté donde esté en el cobro;
  --   2º fallback por nombre: el servicio principal primero;
  --   3º los extras en su orden de selección (determinista; antes dos extras
  --      homónimos empataban sin criterio definido).
  IF v_catalog.service_id IS NOT NULL THEN
    SELECT s2.id, s2.price INTO v_matched_id, v_matched_price
      FROM services s1
      JOIN services s2 ON norm_text(btrim(s2.name)) = norm_text(btrim(s1.name))
     WHERE s1.id = v_catalog.service_id
       AND (s2.id = v_visit.service_id OR s2.id = ANY (COALESCE(v_visit.extra_services, '{}'::uuid[])))
     ORDER BY (s2.id = v_catalog.service_id) DESC,
              (s2.id = v_visit.service_id) DESC,
              array_position(COALESCE(v_visit.extra_services, '{}'::uuid[]), s2.id) NULLS LAST
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
END; $function$;

-- La regla de match queda documentada en la función: es el espejo canónico de
-- servicioQueMatcheaBeneficio (src/lib/loyalty-checkout.ts).
COMMENT ON FUNCTION public.redeem_coupon_for_visit(text, uuid, numeric) IS
  'Canje de cupón contra una visita. Match del servicio acotado: homónimos por norm_text(btrim(name)); prioridad id exacto del premio → servicio principal → extras en orden de selección (espejo exacto de servicioQueMatcheaBeneficio, loyalty-checkout.ts; mig 206).';
