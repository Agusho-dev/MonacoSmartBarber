-- 147_barber_coupon_redemption.sql
-- Canje del cupón de descuento (ej. "Cupón Mundial: Bienvenida" 20%) desde el
-- PANEL DE BARBEROS, integrado al cobro (CompleteServiceDialog).
--
-- Contexto: ya existe `redeem_reward_by_qr(p_qr_code)` pero es SECURITY DEFINER y
-- lee `auth.uid()` para identificar al staff → NO sirve en el panel de barberos,
-- que autentica por cookie PIN (`barber_session`) sin sesión de Supabase Auth.
-- Acá agregamos un path nuevo, invocable con el service role (createAdminClient),
-- que toma la identidad del barbero desde la propia visita (visits.barber_id) y
-- vincula el canje al cliente atendido + la visita resultante.
--
-- Diseño de dos fases:
--   1) VALIDAR (read-only, en el server action) al escanear → muestra el % sin consumir.
--   2) CONSUMIR atómicamente al confirmar el cobro → esta RPC, llamada dentro de
--      completeService una vez creada la visita. Evita "quemar" el cupón si la
--      venta se cancela, y es a prueba de doble-canje (guarda WHERE status='available'
--      + FOR UPDATE).
--
-- Todo aditivo e idempotente: seguro de correr en la DB de prod compartida.

-- ---------------------------------------------------------------------------
-- 1. Columnas de auditoría/descuento (sin reescritura de tabla en PG >= 11)
-- ---------------------------------------------------------------------------

-- En visits: cuánto se descontó y qué cupón se usó. `amount` queda como NETO
-- (lo que entró a caja), así caja/transferencias/reportes siguen leyendo amount
-- sin cambios. El bruto se reconstruye como amount + discount_amount.
ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS discount_amount numeric NOT NULL DEFAULT 0;

ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS client_reward_id uuid REFERENCES public.client_rewards(id);

COMMENT ON COLUMN public.visits.discount_amount IS
  'Monto descontado por un cupón (client_rewards). amount es el neto; bruto = amount + discount_amount.';
COMMENT ON COLUMN public.visits.client_reward_id IS
  'Cupón (client_rewards.id) consumido en esta visita, si hubo descuento por cupón.';

-- En client_rewards: dónde/en qué visita se consumió (la vinculación que pidió
-- el negocio). redeemed_by ya existía (staff que canjea); ahora también la visita
-- y la sucursal.
ALTER TABLE public.client_rewards
  ADD COLUMN IF NOT EXISTS redeemed_visit_id uuid REFERENCES public.visits(id);

ALTER TABLE public.client_rewards
  ADD COLUMN IF NOT EXISTS redeemed_branch_id uuid REFERENCES public.branches(id);

COMMENT ON COLUMN public.client_rewards.redeemed_visit_id IS
  'Visita donde se consumió el cupón (canje en el cobro del barbero).';
COMMENT ON COLUMN public.client_rewards.redeemed_branch_id IS
  'Sucursal donde se consumió el cupón.';

-- Índice para auditar "qué cupones se canjearon en tal sucursal".
CREATE INDEX IF NOT EXISTS idx_client_rewards_redeemed_branch
  ON public.client_rewards (redeemed_branch_id)
  WHERE redeemed_branch_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. RPC atómica: validar + consumir + aplicar el descuento a la visita
-- ---------------------------------------------------------------------------
-- TODO en UNA sola transacción (esta función): consumo del cupón y escritura del
-- descuento sobre la visita son atómicos → nunca divergen (un fallo revierte ambos).
-- Identidad del barbero y cliente atendido salen de la propia visita (autoritativo,
-- no se confía en el cliente). Enforce: mismo cliente (anti-uso de cupón ajeno),
-- misma org (anti cross-tenant), vigencia, y un único canje (guarda + lock).
-- p_service_subtotal = subtotal de servicios (main+extras) bruto; el descuento aplica
-- SOLO a servicios (no productos ni propina) y se clampa al monto de la visita.
DROP FUNCTION IF EXISTS public.redeem_coupon_for_visit(text, uuid);

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
  v_visit    public.visits%ROWTYPE;
  v_reward   public.client_rewards%ROWTYPE;
  v_catalog  public.reward_catalog%ROWTYPE;
  v_pct      numeric;
  v_discount numeric;
  v_net      numeric;
BEGIN
  SELECT * INTO v_visit FROM public.visits WHERE id = p_visit_id;
  IF v_visit.id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'visit_not_found');
  END IF;

  -- Lock de la fila del cupón: cierra la ventana TOCTOU entre el check y el update.
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
  -- El cupón sólo puede usarse para el cliente al que pertenece (el que se registró
  -- en el check-in / Prode). visits.client_id lo hereda del queue_entry vía trigger.
  IF v_reward.client_id IS DISTINCT FROM v_visit.client_id THEN
    RETURN json_build_object('success', false, 'error', 'wrong_client');
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

  -- Descuento sobre el subtotal de servicios, clampeado al monto de la visita
  -- (no descuenta más de lo que se cobra; mantiene amount + discount_amount = bruto).
  v_discount := LEAST(
    round(GREATEST(p_service_subtotal, 0) * v_pct / 100.0),
    GREATEST(v_visit.amount, 0)
  );

  IF v_pct <= 0 OR v_discount <= 0 THEN
    -- Nada que descontar → NO consumimos el cupón (que el cliente no lo pierda).
    RETURN json_build_object('success', false, 'error', 'no_discount');
  END IF;

  -- Consumo + descuento + auditoría, atómicos:
  UPDATE public.client_rewards
  SET status             = 'redeemed',
      redeemed_at        = now(),
      redeemed_by        = v_visit.barber_id,
      redeemed_visit_id  = p_visit_id,
      redeemed_branch_id = v_visit.branch_id
  WHERE id = v_reward.id AND status = 'available';

  IF NOT FOUND THEN
    -- Carrera perdida contra otro canje concurrente.
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

-- Sólo el service role (createAdminClient) debe poder invocarla. NO exponer a
-- anon/authenticated (clientes mobile) para evitar canjes arbitrarios. Supabase
-- otorga EXECUTE a anon/authenticated por default privileges, así que hay que
-- revocarlos EXPLÍCITAMENTE (un REVOKE FROM PUBLIC no alcanza). Ver mig 142.
REVOKE ALL ON FUNCTION public.redeem_coupon_for_visit(text, uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_coupon_for_visit(text, uuid, numeric) TO service_role;

COMMENT ON FUNCTION public.redeem_coupon_for_visit(text, uuid, numeric) IS
  'Canje atómico de un cupón (client_rewards) al cobrar en el panel de barberos: valida '
  'dueño/org/vigencia, consume (lock + guarda anti-doble-canje) y aplica el descuento a '
  'la visita (amount/discount_amount/client_reward_id) en una sola transacción. No usa '
  'auth.uid (sirve en panel PIN). Service role only.';
