-- ============================================================
-- Migración 115: Cobro manual (sin pasarela de pagos)
-- ============================================================
--
-- Mientras no integremos MercadoPago/Stripe, el equipo BarberOS cobra
-- a las orgs por fuera (transferencia, efectivo, link MP manual) y
-- registra el pago en `manual_payments`. Toda la lógica de planes,
-- entitlements, trials y past_due sigue idéntica — sólo cambia quién
-- escribe en `organization_subscriptions` (un platform_admin, no un
-- webhook).
--
-- Cuando se conecte la pasarela, el path es:
--   - cambiar BILLING_MODE en src/lib/billing/config.ts
--   - empezar a llamar createPreapproval() en requestPlanChange
--   - los webhooks escriben los mismos campos que hoy escribe
--     recordManualPayment()
--   - cero migración de datos
--
-- Idempotente.
-- ============================================================

BEGIN;

-- -------------------------------------------------------------------
-- 1) Columnas nuevas en organization_subscriptions
-- -------------------------------------------------------------------

-- billing_email separado del owner email (para facturación)
ALTER TABLE public.organization_subscriptions
  ADD COLUMN IF NOT EXISTS billing_email TEXT;

-- Cuándo recordarle al cliente que renueve (NULL = ya se notificó o no aplica)
ALTER TABLE public.organization_subscriptions
  ADD COLUMN IF NOT EXISTS next_renewal_reminder_at TIMESTAMPTZ;

-- Cuándo expira la gracia en past_due (NULL = no está en past_due)
ALTER TABLE public.organization_subscriptions
  ADD COLUMN IF NOT EXISTS grace_period_ends_at TIMESTAMPTZ;

-- Datos fiscales (para emitir factura cuando corresponda)
ALTER TABLE public.organization_subscriptions
  ADD COLUMN IF NOT EXISTS billing_legal_name TEXT;
ALTER TABLE public.organization_subscriptions
  ADD COLUMN IF NOT EXISTS billing_tax_id TEXT;
ALTER TABLE public.organization_subscriptions
  ADD COLUMN IF NOT EXISTS billing_address TEXT;
ALTER TABLE public.organization_subscriptions
  ADD COLUMN IF NOT EXISTS billing_whatsapp TEXT;

-- -------------------------------------------------------------------
-- 2) Tabla subscription_requests (solicitudes de cambio de plan)
-- -------------------------------------------------------------------
-- El cliente clickea "Cambiar a Pro" y se crea una request. Un
-- platform_admin la procesa: contactar → cobrar → recordar pago.

DO $$ BEGIN
  CREATE TYPE public.subscription_request_status AS ENUM (
    'pending',     -- recién creada, sin contactar
    'contacted',   -- se contactó al cliente, esperando pago
    'paid',        -- se registró el pago (resuelta)
    'cancelled'    -- el cliente desistió o nosotros descartamos
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.subscription_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requested_plan_id TEXT NOT NULL REFERENCES public.plans(id),
  requested_billing_cycle TEXT NOT NULL DEFAULT 'monthly' CHECK (requested_billing_cycle IN ('monthly','yearly')),
  request_kind TEXT NOT NULL DEFAULT 'plan_change' CHECK (request_kind IN ('plan_change','renewal','module_addon')),
  module_id TEXT REFERENCES public.modules(id),
  status public.subscription_request_status NOT NULL DEFAULT 'pending',
  notes TEXT,
  contact_log JSONB DEFAULT '[]'::jsonb,    -- array de { at, by, channel, note }
  requested_by UUID REFERENCES auth.users(id),
  contacted_at TIMESTAMPTZ,
  contacted_by UUID REFERENCES auth.users(id),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id),
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subreq_org ON public.subscription_requests(organization_id);
CREATE INDEX IF NOT EXISTS idx_subreq_status ON public.subscription_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subreq_pending ON public.subscription_requests(created_at DESC) WHERE status = 'pending';

-- -------------------------------------------------------------------
-- 3) Tabla manual_payments (registro de cobros offline)
-- -------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE public.manual_payment_method AS ENUM (
    'transferencia',
    'efectivo',
    'mp_link',     -- link de pago MP enviado a mano (sin preapproval)
    'usdt',
    'otro'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.manual_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES public.organization_subscriptions(id) ON DELETE SET NULL,
  request_id UUID REFERENCES public.subscription_requests(id) ON DELETE SET NULL,
  plan_id TEXT NOT NULL REFERENCES public.plans(id),
  billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('monthly','yearly')),
  amount_ars BIGINT NOT NULL CHECK (amount_ars >= 0),    -- en centavos (consistente con plans.price_ars_monthly)
  currency TEXT NOT NULL DEFAULT 'ARS',
  payment_method public.manual_payment_method NOT NULL,
  reference TEXT,                                         -- nro de transferencia / comprobante / link
  receipt_url TEXT,                                       -- foto/PDF en Storage
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  recorded_by UUID NOT NULL REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT manual_payments_period_valid CHECK (period_end > period_start)
);

CREATE INDEX IF NOT EXISTS idx_manualpay_org ON public.manual_payments(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_manualpay_period ON public.manual_payments(period_end);

-- -------------------------------------------------------------------
-- 4) Trigger: cuando se inserta manual_payment, sincroniza la sub
-- -------------------------------------------------------------------
-- El platform_admin sólo se preocupa por registrar el pago — el trigger
-- mueve plan_id, status, current_period_*, next_renewal_reminder_at,
-- grace_period_ends_at automáticamente.

CREATE OR REPLACE FUNCTION public.sync_subscription_from_manual_payment()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_sub_id UUID;
  v_current_end TIMESTAMPTZ;
BEGIN
  -- Buscar la suscripción de la org (asumimos 1:1 — UNIQUE en org_subs)
  SELECT id, current_period_end
    INTO v_sub_id, v_current_end
    FROM public.organization_subscriptions
   WHERE organization_id = NEW.organization_id;

  IF v_sub_id IS NULL THEN
    RAISE EXCEPTION 'No existe organization_subscriptions para org %', NEW.organization_id
      USING ERRCODE = '23503';
  END IF;

  -- Actualizar la sub con los datos del pago
  -- Si el pago extiende más allá del período actual, lo aplicamos.
  -- Si es un pago "atrasado" (period_end < current_end), no movemos
  -- el período pero sí dejamos status=active.
  UPDATE public.organization_subscriptions
     SET plan_id = NEW.plan_id,
         billing_cycle = NEW.billing_cycle,
         status = 'active',
         current_period_start = LEAST(current_period_start, NEW.period_start),
         current_period_end = GREATEST(COALESCE(current_period_end, NEW.period_end), NEW.period_end),
         next_renewal_reminder_at = GREATEST(COALESCE(current_period_end, NEW.period_end), NEW.period_end) - INTERVAL '7 days',
         grace_period_ends_at = NULL,
         cancel_at_period_end = false,
         cancelled_at = NULL,
         updated_at = now()
   WHERE id = v_sub_id;

  -- Setear subscription_id en el manual_payment si no estaba
  NEW.subscription_id := v_sub_id;

  -- Si vino con request_id, marcar el request como paid
  IF NEW.request_id IS NOT NULL THEN
    UPDATE public.subscription_requests
       SET status = 'paid',
           resolved_at = now(),
           resolved_by = NEW.recorded_by,
           updated_at = now()
     WHERE id = NEW.request_id
       AND status <> 'paid';
  END IF;

  -- Log idempotente en billing_events para tener un único feed
  INSERT INTO public.billing_events (
    organization_id, provider, provider_event_id, event_type,
    raw_payload, processed_at
  ) VALUES (
    NEW.organization_id,
    'manual',
    NEW.id::text,
    'manual_payment.recorded',
    jsonb_build_object(
      'manual_payment_id', NEW.id,
      'plan_id', NEW.plan_id,
      'amount_ars', NEW.amount_ars,
      'period_start', NEW.period_start,
      'period_end', NEW.period_end,
      'method', NEW.payment_method
    ),
    now()
  )
  ON CONFLICT (provider, provider_event_id) DO NOTHING;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_sub_from_manual_payment ON public.manual_payments;
CREATE TRIGGER trg_sync_sub_from_manual_payment
  BEFORE INSERT ON public.manual_payments
  FOR EACH ROW EXECUTE FUNCTION public.sync_subscription_from_manual_payment();

-- -------------------------------------------------------------------
-- 5) Trigger updated_at en subscription_requests
-- -------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_subreq_updated_at ON public.subscription_requests;
CREATE TRIGGER trg_subreq_updated_at
  BEFORE UPDATE ON public.subscription_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- -------------------------------------------------------------------
-- 6) RLS
-- -------------------------------------------------------------------

ALTER TABLE public.subscription_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_payments ENABLE ROW LEVEL SECURITY;

-- Orgs ven sus propios requests
DROP POLICY IF EXISTS subreq_select_own ON public.subscription_requests;
CREATE POLICY subreq_select_own ON public.subscription_requests
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
  );

-- Orgs crean requests para sí mismas
DROP POLICY IF EXISTS subreq_insert_own ON public.subscription_requests;
CREATE POLICY subreq_insert_own ON public.subscription_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
    )
  );

-- Sólo platform_admins editan/cancelan/borran
DROP POLICY IF EXISTS subreq_update_admin ON public.subscription_requests;
CREATE POLICY subreq_update_admin ON public.subscription_requests
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid()));

-- manual_payments: orgs ven los suyos, sólo platform_admins escriben
DROP POLICY IF EXISTS manualpay_select_own ON public.manual_payments;
CREATE POLICY manualpay_select_own ON public.manual_payments
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
  );

DROP POLICY IF EXISTS manualpay_insert_admin ON public.manual_payments;
CREATE POLICY manualpay_insert_admin ON public.manual_payments
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid()));

-- -------------------------------------------------------------------
-- 7) Vista de conveniencia: vencimientos próximos
-- -------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_subscription_renewals_due AS
SELECT
  s.id AS subscription_id,
  s.organization_id,
  o.name AS org_name,
  o.slug,
  s.plan_id,
  s.status,
  s.current_period_end,
  s.grace_period_ends_at,
  s.next_renewal_reminder_at,
  s.billing_email,
  s.billing_whatsapp,
  GREATEST(0, EXTRACT(DAY FROM (s.current_period_end - now()))::INT) AS days_until_renewal,
  CASE
    WHEN s.status = 'past_due' AND s.grace_period_ends_at IS NOT NULL
      THEN GREATEST(0, EXTRACT(DAY FROM (s.grace_period_ends_at - now()))::INT)
    ELSE NULL
  END AS days_grace_left
FROM public.organization_subscriptions s
JOIN public.organizations o ON o.id = s.organization_id
WHERE s.grandfathered = false
  AND s.provider IS NOT DISTINCT FROM 'manual';

GRANT SELECT ON public.v_subscription_renewals_due TO authenticated;

-- -------------------------------------------------------------------
-- 8) Comentarios
-- -------------------------------------------------------------------

COMMENT ON TABLE public.subscription_requests IS
  'Solicitudes de cambio/renovación creadas desde /dashboard/billing por orgs en modo manual. Las procesa un platform_admin coordinando pago por fuera del sistema.';

COMMENT ON TABLE public.manual_payments IS
  'Cobros offline registrados a mano por platform_admins. Su INSERT dispara trigger que actualiza organization_subscriptions y crea un billing_event con provider=''manual''.';

COMMENT ON COLUMN public.organization_subscriptions.next_renewal_reminder_at IS
  'Cuándo el cron notify-renewals debe enviar recordatorio. Se setea en period_end - 7d al registrar pago. Se anula tras enviar.';

COMMENT ON COLUMN public.organization_subscriptions.grace_period_ends_at IS
  'Cuándo expira la gracia tras entrar en past_due. Si NULL no está en gracia. Tras vencer, expire-trials baja a free.';

COMMIT;
