-- 151_coupon_time_rules.sql
-- Reglas de tiempo para cupones (configurables por reward_catalog):
--   A) activation_delay_minutes: el cupón recién se puede canjear N minutos DESPUÉS
--      de emitido (client_rewards.created_at). Para el cupón de bienvenida = 120 (2h),
--      así nadie lo canjea en el mismo turno en que creó la cuenta (es un "volvé y te
--      hacemos 20%", no un descuento sobre el corte en curso).
--   B) redeemable_weekdays: días de la semana en que se puede canjear (ISO 1=lun..7=dom,
--      evaluado en la TZ de la sucursal). NULL = cualquier día. Bienvenida = {1,2,3}
--      (lunes a miércoles).
-- Ambas se evalúan en el canje (redeem_coupon_for_visit) y en la validación al escanear
-- (validateCouponForCheckout, TS). NULL/0 = sin restricción → no afecta a otros cupones.
-- Todo aditivo e idempotente.

-- ---------------------------------------------------------------------------
-- A. Columnas de reglas en reward_catalog
-- ---------------------------------------------------------------------------
ALTER TABLE public.reward_catalog
  ADD COLUMN IF NOT EXISTS activation_delay_minutes int NOT NULL DEFAULT 0;

ALTER TABLE public.reward_catalog
  ADD COLUMN IF NOT EXISTS redeemable_weekdays smallint[];

-- Vigencia (en días) con la que se emite el cupón: expires_at = created_at + validity_days.
-- La consume la emisión (prode_auth_with_pin). NULL = comportamiento previo de cada path.
ALTER TABLE public.reward_catalog
  ADD COLUMN IF NOT EXISTS validity_days int;

COMMENT ON COLUMN public.reward_catalog.activation_delay_minutes IS
  'Minutos que deben pasar desde la emisión del cupón (client_rewards.created_at) antes '
  'de poder canjearlo. 0 = se puede usar al instante. Ej: 120 = recién a las 2h.';
COMMENT ON COLUMN public.reward_catalog.redeemable_weekdays IS
  'Días de la semana en que se puede canjear (ISO: 1=lunes .. 7=domingo), evaluado en la '
  'TZ de la sucursal. NULL = cualquier día. Ej: {1,2,3} = lunes a miércoles.';
COMMENT ON COLUMN public.reward_catalog.validity_days IS
  'Días de vigencia con que se emite el cupón (expires_at = created_at + validity_days). '
  'Lo lee la emisión (prode_auth_with_pin). NULL = fallback del path emisor.';

-- Cupón de bienvenida: activa a las 2h, canjeable lunes a miércoles, vigencia 15 días.
UPDATE public.reward_catalog
SET activation_delay_minutes = 120,
    redeemable_weekdays = '{1,2,3}'::smallint[],
    validity_days = 15
WHERE id = 'bb46f40a-0969-4767-8a72-3b57318196af';

-- ---------------------------------------------------------------------------
-- B. redeem_coupon_for_visit: aplicar las reglas de tiempo antes de consumir.
-- ---------------------------------------------------------------------------
-- Versión viva (mig 150) + 2 checks nuevos: activación diferida y día permitido.
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
  v_branch_tz   text;
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

  -- Pertenencia tolerante a duplicado por teléfono (misma org + últimos 10 dígitos
  -- NO degenerados). Ver mig 149/150.
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

  -- Activación diferida: recién canjeable N minutos después de emitido (created_at).
  IF COALESCE(v_catalog.activation_delay_minutes, 0) > 0
     AND now() < v_reward.created_at + make_interval(mins => v_catalog.activation_delay_minutes) THEN
    RETURN json_build_object(
      'success', false, 'error', 'not_active_yet',
      'activates_at', v_reward.created_at + make_interval(mins => v_catalog.activation_delay_minutes)
    );
  END IF;

  -- Días de la semana permitidos (en la TZ de la sucursal). NULL = cualquier día.
  IF v_catalog.redeemable_weekdays IS NOT NULL THEN
    SELECT timezone INTO v_branch_tz FROM public.branches WHERE id = v_visit.branch_id;
    v_branch_tz := COALESCE(v_branch_tz, 'America/Argentina/Buenos_Aires');
    IF NOT (extract(isodow FROM (now() AT TIME ZONE v_branch_tz))::smallint = ANY(v_catalog.redeemable_weekdays)) THEN
      RETURN json_build_object(
        'success', false, 'error', 'wrong_weekday',
        'allowed_weekdays', v_catalog.redeemable_weekdays
      );
    END IF;
  END IF;

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
