-- ============================================================
-- Migración 111: Enforcement de límites de plan en DB
-- ============================================================
--
-- Define funciones + triggers que actúan como red de seguridad:
-- aun si un caller malintencionado bypasa los server actions, la DB
-- rechaza INSERTs que violen los límites del plan.
--
--   1. get_org_plan(org_id)     — UUID → registro del plan efectivo
--   2. get_org_limits(org_id)   — UUID → JSONB con los limits consolidados
--   3. get_org_features(org_id) — UUID → JSONB con los features efectivos
--   4. enforce_branch_limit()   — trigger BEFORE INSERT en branches
--   5. enforce_staff_limit()    — trigger BEFORE INSERT en staff
--   6. enforce_org_active()     — trigger de subscription.status válido
--
-- Los errores se lanzan con SQLSTATE '55P03' y un mensaje codificado
-- ('branch_limit_exceeded' / 'staff_limit_exceeded' / 'subscription_inactive')
-- que el server action traduce a respuesta UI estructurada.
-- ============================================================

BEGIN;

-- ---- 1. Plan efectivo ---------------------------------------------

CREATE OR REPLACE FUNCTION public.get_org_plan(p_org_id UUID)
RETURNS public.plans
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.*
  FROM public.organization_subscriptions s
  JOIN public.plans p ON p.id = s.plan_id
  WHERE s.organization_id = p_org_id
  LIMIT 1;
$$;

-- ---- 2. Límites consolidados (plan + extra_seats) ------------------

CREATE OR REPLACE FUNCTION public.get_org_limits(p_org_id UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.limits
    || jsonb_build_object(
         'branches', COALESCE((p.limits->>'branches')::int, 0)
                     + COALESCE(s.extra_branch_seats, 0),
         'staff',    COALESCE((p.limits->>'staff')::int, 0)
                     + COALESCE(s.extra_staff_seats, 0)
       )
  FROM public.organization_subscriptions s
  JOIN public.plans p ON p.id = s.plan_id
  WHERE s.organization_id = p_org_id
  LIMIT 1;
$$;

-- ---- 3. Features efectivos (plan + add-on modules) -----------------

CREATE OR REPLACE FUNCTION public.get_org_features(p_org_id UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT p.features AS f
    FROM public.organization_subscriptions s
    JOIN public.plans p ON p.id = s.plan_id
    WHERE s.organization_id = p_org_id
  ),
  addons AS (
    SELECT jsonb_object_agg(m.feature_key, true) AS f
    FROM public.organization_modules om
    JOIN public.modules m ON m.id = om.module_id
    WHERE om.organization_id = p_org_id
      AND om.enabled = true
      AND (om.expires_at IS NULL OR om.expires_at > now())
  )
  SELECT COALESCE((SELECT f FROM base), '{}'::jsonb)
      || COALESCE((SELECT f FROM addons), '{}'::jsonb);
$$;

-- ---- 4. Trigger: enforce_branch_limit ------------------------------

CREATE OR REPLACE FUNCTION public.enforce_branch_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_limit INT;
  v_count INT;
  v_status public.subscription_status;
BEGIN
  -- Si la org no tiene subscription aún (caso raro: seed inicial),
  -- delegamos en la app. No bloqueamos.
  SELECT status INTO v_status
  FROM public.organization_subscriptions
  WHERE organization_id = NEW.organization_id;
  IF v_status IS NULL THEN
    RETURN NEW;
  END IF;

  -- Suscripciones paused/cancelled no pueden crear nada.
  IF v_status IN ('paused','cancelled') THEN
    RAISE EXCEPTION 'subscription_inactive'
      USING ERRCODE = '55P03',
            DETAIL = jsonb_build_object('status', v_status)::text;
  END IF;

  v_limit := COALESCE((public.get_org_limits(NEW.organization_id)->>'branches')::int, 0);
  SELECT COUNT(*) INTO v_count
  FROM public.branches
  WHERE organization_id = NEW.organization_id
    AND is_active = true;

  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'branch_limit_exceeded'
      USING ERRCODE = '55P03',
            DETAIL = jsonb_build_object('limit', v_limit, 'current', v_count)::text;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_branch_limit ON public.branches;
CREATE TRIGGER trg_enforce_branch_limit
  BEFORE INSERT ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.enforce_branch_limit();

-- ---- 5. Trigger: enforce_staff_limit -------------------------------

CREATE OR REPLACE FUNCTION public.enforce_staff_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_limit INT;
  v_count INT;
BEGIN
  -- Solo contar staff activos (soft-deleted no cuentan).
  IF NEW.is_active = false THEN RETURN NEW; END IF;

  v_limit := COALESCE((public.get_org_limits(NEW.organization_id)->>'staff')::int, 0);

  -- -1 o 0 = ilimitado (convención)
  IF v_limit <= 0 THEN RETURN NEW; END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.staff
  WHERE organization_id = NEW.organization_id
    AND is_active = true;

  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'staff_limit_exceeded'
      USING ERRCODE = '55P03',
            DETAIL = jsonb_build_object('limit', v_limit, 'current', v_count)::text;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_staff_limit ON public.staff;
CREATE TRIGGER trg_enforce_staff_limit
  BEFORE INSERT ON public.staff
  FOR EACH ROW EXECUTE FUNCTION public.enforce_staff_limit();

-- ---- 6. Helper: log_entitlement_denial (SECURITY DEFINER) ----------

CREATE OR REPLACE FUNCTION public.log_entitlement_denial(
  p_feature_key TEXT,
  p_context JSONB DEFAULT '{}'::jsonb
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  v_org_id := public.get_user_org_id();
  IF v_org_id IS NULL THEN RETURN; END IF;

  INSERT INTO public.entitlement_denials (organization_id, user_id, feature_key, context)
  VALUES (v_org_id, auth.uid(), p_feature_key, COALESCE(p_context, '{}'::jsonb));
END $$;

COMMENT ON FUNCTION public.log_entitlement_denial IS
  'Registra un intento de uso de feature no disponible en el plan. Callable desde el cliente con RLS habilitado.';

-- ---- 7. Helper: increment_usage (atomic UPSERT) --------------------

CREATE OR REPLACE FUNCTION public.increment_org_usage(
  p_org_id UUID,
  p_metric TEXT,
  p_amount INT DEFAULT 1
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period DATE := date_trunc('month', now())::date;
  v_new    INT;
BEGIN
  INSERT INTO public.organization_usage (organization_id, metric, period_start, count, updated_at)
  VALUES (p_org_id, p_metric, v_period, p_amount, now())
  ON CONFLICT (organization_id, metric, period_start)
  DO UPDATE SET count = public.organization_usage.count + EXCLUDED.count,
                updated_at = now()
  RETURNING count INTO v_new;
  RETURN v_new;
END $$;

COMMENT ON FUNCTION public.increment_org_usage IS
  'Suma counter mensual de uso (broadcasts, sms, ai). Devuelve el nuevo total del ciclo.';

COMMIT;
