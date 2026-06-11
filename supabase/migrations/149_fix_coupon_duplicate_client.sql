-- 149_fix_coupon_duplicate_client.sql
-- Fix raíz + red de seguridad para el bug "Este cupón pertenece a otro cliente" al
-- canjear el cupón de bienvenida desde el panel de barberos.
--
-- CAUSA RAÍZ: una misma persona termina con DOS filas en `clients` (misma org) por
-- normalización de teléfono inconsistente entre paths:
--   · Prode (prode_auth_with_pin) guarda clients.phone = regexp_replace(phone,'\D','','g')
--     (dígitos crudos, conservando el prefijo país/celular que tipeó el usuario).
--   · El check-in del kiosko (checkinClient) buscaba con match EXACTO de string
--     (.eq('phone', phone)) y, si no matcheaba por formato, INSERTABA un cliente nuevo.
-- Resultado: el cupón de bienvenida queda atado al client_id de Prode y la
-- queue_entry/visita al client_id del check-in. Al cobrar, redeem_coupon_for_visit
-- (y la validación al escanear) comparan reward.client_id != visit.client_id → como
-- son IDs distintos de la MISMA persona, rechazan con "wrong_client".
--
-- Este parche, todo aditivo e idempotente (seguro en la DB de prod compartida):
--   A) find_client_id_by_phone(): resuelve el cliente por teléfono NORMALIZADO
--      (últimos 10 dígitos = número local AR), para que el check-in encuentre al
--      cliente existente en vez de duplicarlo. Lo usa checkinClient.
--   B) redeem_coupon_for_visit(): el check de pertenencia tolera el duplicado ya
--      existente — si el cupón y la visita son de la misma org y el mismo teléfono
--      normalizado, es la misma persona y el canje procede. Desbloquea los duplicados
--      históricos SIN mover el cupón (sigue visible en la app del cliente).
--
-- NOTA: el merge/dedup de las filas duplicadas ya existentes (consolidar puntos,
-- visitas e identidad de Prode) es un follow-up de datos con decisión de producto;
-- NO se hace acá. (B) ya las desbloquea para canjear.

-- ---------------------------------------------------------------------------
-- A. Resolver cliente por teléfono normalizado (últimos 10 dígitos), dentro de org.
-- ---------------------------------------------------------------------------
-- Read-only. Devuelve el client_id existente que matchea, o NULL. El guard
-- length(digits) >= 8 evita deduplicar sobre números basura/cortos (ej '0000').
-- Determinista: el más antiguo (created_at ASC) = perfil establecido.
CREATE OR REPLACE FUNCTION public.find_client_id_by_phone(
  p_org uuid,
  p_phone text
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT c.id
  FROM public.clients c
  WHERE c.organization_id = p_org
    AND length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 8
    AND right(regexp_replace(coalesce(c.phone,  ''), '\D', '', 'g'), 10)
      = right(regexp_replace(coalesce(p_phone,  ''), '\D', '', 'g'), 10)
  ORDER BY c.created_at ASC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.find_client_id_by_phone(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_client_id_by_phone(uuid, text) TO service_role;

COMMENT ON FUNCTION public.find_client_id_by_phone(uuid, text) IS
  'Resuelve un client_id existente por teléfono normalizado (últimos 10 dígitos) dentro '
  'de una org, tolerando formatos distintos (con/sin prefijo país). Lo usa el check-in '
  'para no duplicar clientes. Service role only. Ver mig 149.';

-- ---------------------------------------------------------------------------
-- B. Canje tolerante a cliente duplicado por teléfono (red de seguridad).
-- ---------------------------------------------------------------------------
-- Reemplaza redeem_coupon_for_visit (versión viva de coupon_atomic_discount_fix)
-- agregando SÓLO el fallback por teléfono en el check de pertenencia. El resto es
-- idéntico (lock + guarda anti-doble-canje + descuento atómico).
CREATE OR REPLACE FUNCTION public.redeem_coupon_for_visit(
  p_qr_code text,
  p_visit_id uuid,
  p_service_subtotal numeric
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_visit       public.visits%ROWTYPE;
  v_reward      public.client_rewards%ROWTYPE;
  v_catalog     public.reward_catalog%ROWTYPE;
  v_pct         numeric;
  v_discount    numeric;
  v_net         numeric;
  v_same_person boolean;
BEGIN
  SELECT * INTO v_visit FROM public.visits WHERE id = p_visit_id;
  IF v_visit.id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'visit_not_found');
  END IF;

  -- Lock de la fila del cupón: cierra la ventana TOCTOU entre check y update.
  SELECT * INTO v_reward
  FROM public.client_rewards
  WHERE qr_code = p_qr_code
  FOR UPDATE;

  IF v_reward.id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'not_found');
  END IF;
  IF v_reward.organization_id IS DISTINCT FROM v_visit.organization_id THEN
    RETURN json_build_object('success', false, 'error', 'wrong_org');
  END IF;

  -- Pertenencia: el cupón es del cliente al que pertenece. PERO una misma persona
  -- puede tener DOS filas en clients por teléfono normalizado distinto (Prode guarda
  -- dígitos crudos; el check-in, otro formato) → cupón en un client_id y visita en
  -- otro. Si difieren pero son la misma persona (misma org + mismos últimos 10
  -- dígitos de teléfono), es válido. Si no, es cupón ajeno. Ver mig 149.
  IF v_reward.client_id IS DISTINCT FROM v_visit.client_id THEN
    SELECT cr.organization_id = cv.organization_id
       AND length(regexp_replace(coalesce(cr.phone, ''), '\D', '', 'g')) >= 8
       AND right(regexp_replace(coalesce(cr.phone, ''), '\D', '', 'g'), 10)
         = right(regexp_replace(coalesce(cv.phone, ''), '\D', '', 'g'), 10)
      INTO v_same_person
    FROM public.clients cr, public.clients cv
    WHERE cr.id = v_reward.client_id AND cv.id = v_visit.client_id;

    IF NOT COALESCE(v_same_person, false) THEN
      RETURN json_build_object('success', false, 'error', 'wrong_client');
    END IF;
  END IF;

  IF v_reward.status = 'redeemed' THEN
    RETURN json_build_object('success', false, 'error', 'already_redeemed');
  END IF;
  IF v_reward.status <> 'available' THEN
    RETURN json_build_object('success', false, 'error', 'not_available');
  END IF;
  IF v_reward.expires_at IS NOT NULL AND v_reward.expires_at < now() THEN
    UPDATE public.client_rewards SET status = 'expired' WHERE id = v_reward.id;
    RETURN json_build_object('success', false, 'error', 'expired');
  END IF;

  SELECT * INTO v_catalog FROM public.reward_catalog WHERE id = v_reward.reward_id;
  v_pct := CASE WHEN v_catalog.is_free_service THEN 100 ELSE COALESCE(v_catalog.discount_pct, 0) END;

  -- Descuento sobre el subtotal de SERVICIOS (no productos ni propina), clampeado al
  -- monto actual de la visita (no puede descontar más de lo que se cobra; mantiene
  -- el invariante amount + discount_amount = bruto incluso con prepagos).
  v_discount := LEAST(
    round(GREATEST(p_service_subtotal, 0) * v_pct / 100.0),
    GREATEST(v_visit.amount, 0)
  );

  IF v_pct <= 0 OR v_discount <= 0 THEN
    -- Nada que descontar → NO consumimos el cupón (que el cliente no lo pierda).
    RETURN json_build_object('success', false, 'error', 'no_discount');
  END IF;

  -- Consumo + descuento + auditoría EN UNA SOLA TRANSACCIÓN (esta función):
  UPDATE public.client_rewards
  SET status             = 'redeemed',
      redeemed_at        = now(),
      redeemed_by        = v_visit.barber_id,
      redeemed_visit_id  = p_visit_id,
      redeemed_branch_id = v_visit.branch_id
  WHERE id = v_reward.id AND status = 'available';

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'already_redeemed');
  END IF;

  v_net := GREATEST(v_visit.amount - v_discount, 0);

  UPDATE public.visits
  SET amount           = v_net,
      discount_amount  = v_discount,
      client_reward_id = v_reward.id
  WHERE id = p_visit_id;

  RETURN json_build_object(
    'success', true,
    'client_reward_id', v_reward.id,
    'reward_name', v_catalog.name,
    'discount_pct', v_catalog.discount_pct,
    'is_free_service', v_catalog.is_free_service,
    'discount_amount', v_discount,
    'net_amount', v_net
  );
END;
$$;

-- Re-aplica los grants (CREATE OR REPLACE preserva ACL, pero somos explícitos).
REVOKE ALL ON FUNCTION public.redeem_coupon_for_visit(text, uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_coupon_for_visit(text, uuid, numeric) TO service_role;
