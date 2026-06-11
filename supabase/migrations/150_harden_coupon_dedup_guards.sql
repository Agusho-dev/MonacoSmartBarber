-- 150_harden_coupon_dedup_guards.sql
-- Endurecimiento del fix de dedup de clientes (mig 149), tras review adversarial.
--
-- Problema detectado: el guard `length(digits) >= 8` NO excluye teléfonos placeholder
-- de un solo dígito repetido (ej. '0000000000', que tiene 10 dígitos). En prod hay
-- 5 clientes distintos y NO relacionados (sin nombre / '.' / 'Sin nombre') con phone
-- de puros ceros. Con sólo el guard de largo, esos 5 colisionaban en sus últimos 10
-- dígitos → (a) el check-in podía fusionar walk-ins de personas distintas, y (b) el
-- check de pertenencia del cupón (v_same_person) podía dar TRUE entre dos clientes
-- ajenos → canje cross-cliente. No había explotación activa (esos clientes no tienen
-- cupones), pero es un agujero latente.
--
-- Fix: además del largo, rechazar claves degeneradas (un solo carácter repetido) con
-- el regex `^(.)\1*$` en AMBAS funciones. Más: tie-breaker determinista en el ORDER BY,
-- índice funcional para el lookup por últimos-10, y COMMENT actualizado (CREATE OR
-- REPLACE preserva el comentario viejo). Todo aditivo e idempotente.

-- ---------------------------------------------------------------------------
-- A. find_client_id_by_phone: + guard anti-degenerado + tie-breaker.
-- ---------------------------------------------------------------------------
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
    -- clave = últimos 10 dígitos del input; >= 8 dígitos y NO degenerada (no '0000…').
    AND length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 8
    AND right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10) !~ '^(.)\1*$'
    AND right(regexp_replace(coalesce(c.phone,  ''), '\D', '', 'g'), 10)
      = right(regexp_replace(coalesce(p_phone,  ''), '\D', '', 'g'), 10)
  ORDER BY c.created_at ASC, c.id ASC   -- determinista ante empate exacto de timestamp
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.find_client_id_by_phone(uuid, text) IS
  'Resuelve un client_id existente por teléfono normalizado (últimos 10 dígitos) dentro '
  'de una org, tolerando formatos distintos (con/sin prefijo país). Ignora claves '
  'degeneradas (un solo dígito repetido, ej. 0000000000). Lo usa el check-in para no '
  'duplicar clientes. Service role only. Ver mig 149/150.';

-- Índice funcional para que el lookup por últimos-10 no haga Seq Scan a medida que
-- crece clients (hoy ~4.2k filas, 3ms; barato y a futuro O(1)). regexp_replace/right
-- son IMMUTABLE → indexables.
CREATE INDEX IF NOT EXISTS idx_clients_org_phone_last10
  ON public.clients (
    organization_id,
    (right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10))
  );

-- ---------------------------------------------------------------------------
-- B. redeem_coupon_for_visit: mismo guard anti-degenerado en el fallback por teléfono.
-- ---------------------------------------------------------------------------
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

  -- Pertenencia tolerante a duplicado por teléfono: misma org + mismos últimos 10
  -- dígitos NO degenerados (un placeholder '0000…' no cuenta como misma persona).
  IF v_reward.client_id IS DISTINCT FROM v_visit.client_id THEN
    SELECT cr.organization_id = cv.organization_id
       AND length(regexp_replace(coalesce(cr.phone, ''), '\D', '', 'g')) >= 8
       AND right(regexp_replace(coalesce(cr.phone, ''), '\D', '', 'g'), 10) !~ '^(.)\1*$'
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

  v_discount := LEAST(
    round(GREATEST(p_service_subtotal, 0) * v_pct / 100.0),
    GREATEST(v_visit.amount, 0)
  );

  IF v_pct <= 0 OR v_discount <= 0 THEN
    RETURN json_build_object('success', false, 'error', 'no_discount');
  END IF;

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

REVOKE ALL ON FUNCTION public.redeem_coupon_for_visit(text, uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_coupon_for_visit(text, uuid, numeric) TO service_role;

COMMENT ON FUNCTION public.redeem_coupon_for_visit(text, uuid, numeric) IS
  'Canje atómico de un cupón (client_rewards) al cobrar en el panel de barberos: valida '
  'org + pertenencia (tolerante a cliente duplicado por teléfono normalizado, mig 149/150), '
  'vigencia, consume (lock + guarda anti-doble-canje) y aplica el descuento a la visita en '
  'una sola transacción. No usa auth.uid (sirve en panel PIN). Service role only.';
