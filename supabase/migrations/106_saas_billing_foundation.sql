-- ============================================================
-- Migración 106: Fundamentos de SaaS billing multi-tenant
-- ============================================================
--
-- Introduce el modelo de planes, módulos, suscripciones y uso que
-- habilita la comercialización del producto:
--
--   1. plans                    — catálogo de planes (Free/Start/Pro/Enterprise)
--   2. modules                  — catálogo de features/add-ons con visibility_status
--   3. organization_subscriptions — suscripción activa por org (fact table)
--   4. organization_modules     — overrides/add-ons contratados por una org
--   5. billing_events           — log idempotente de webhooks de pagos
--   6. organization_usage       — contadores rollables mensuales (broadcasts, sms…)
--   7. module_waitlist          — interés en módulos "próximamente"
--   8. entitlement_denials      — denegaciones para analytics de upsell
--
-- Diseño:
--   - plans.features / plans.limits son JSONB editables sin migración.
--   - El source-of-truth del estado comercial de una org pasa a vivir
--     en organization_subscriptions (y no en columnas sueltas de
--     organizations). La 105_saas_backfill_existing_orgs.sql realiza
--     el grandfathering de las orgs actuales antes de limpiar.
--   - Todas las tablas tienen organization_id donde corresponde y RLS
--     habilitada con el patrón estándar de get_user_org_id().
-- ============================================================

BEGIN;

-- ---- 0. ENUMs ------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE public.module_status AS ENUM ('active', 'beta', 'coming_soon', 'hidden');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.subscription_status AS ENUM (
    'trialing', 'active', 'past_due', 'cancelled', 'paused', 'incomplete'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- 1. plans ------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.plans (
  id                  TEXT PRIMARY KEY,                    -- 'free' | 'start' | 'pro' | 'enterprise'
  name                TEXT NOT NULL,
  tagline             TEXT,
  price_ars_monthly   INT NOT NULL DEFAULT 0,              -- en centavos de ARS
  price_ars_yearly    INT NOT NULL DEFAULT 0,
  price_usd_monthly   INT,                                 -- en centavos de USD (opcional)
  price_usd_yearly    INT,
  trial_days          INT NOT NULL DEFAULT 14,
  features            JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {"messaging.whatsapp": true, ...}
  limits              JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {"branches": 3, "staff": 20, ...}
  is_public           BOOLEAN NOT NULL DEFAULT true,
  sort_order          INT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.plans IS
  'Catálogo comercial de planes. Editable en caliente desde /platform sin migración.';

-- ---- 2. modules ----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.modules (
  id                  TEXT PRIMARY KEY,                    -- 'messaging.whatsapp', 'ai', ...
  name                TEXT NOT NULL,
  description         TEXT,
  icon                TEXT,
  category            TEXT,                                -- 'messaging' | 'integrations' | ...
  status              public.module_status NOT NULL DEFAULT 'active',
  teaser_copy         TEXT,
  estimated_release   DATE,
  price_ars_addon     INT,                                 -- null si no es add-on pagable independiente
  included_in_plans   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  feature_key         TEXT NOT NULL,                       -- clave usada en plans.features
  sort_order          INT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT modules_feature_key_unique UNIQUE (feature_key)
);

COMMENT ON TABLE public.modules IS
  'Metadata de cada feature/módulo. visibility_status controla si se muestra activo, beta, próximamente u oculto.';

-- ---- 3. organization_subscriptions ---------------------------------

CREATE TABLE IF NOT EXISTS public.organization_subscriptions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             UUID NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id                     TEXT NOT NULL REFERENCES public.plans(id),
  status                      public.subscription_status NOT NULL DEFAULT 'trialing',
  provider                    TEXT,                        -- 'mercadopago' | 'stripe' | 'manual' | NULL
  provider_customer_id        TEXT,
  provider_subscription_id    TEXT,
  billing_cycle               TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly','yearly')),
  currency                    TEXT NOT NULL DEFAULT 'ARS',
  current_period_start        TIMESTAMPTZ,
  current_period_end          TIMESTAMPTZ,
  trial_ends_at               TIMESTAMPTZ,
  cancel_at_period_end        BOOLEAN NOT NULL DEFAULT false,
  cancelled_at                TIMESTAMPTZ,
  extra_branch_seats          INT NOT NULL DEFAULT 0 CHECK (extra_branch_seats >= 0),
  extra_staff_seats           INT NOT NULL DEFAULT 0 CHECK (extra_staff_seats >= 0),
  grandfathered               BOOLEAN NOT NULL DEFAULT false,
  notes                       TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_subs_status ON public.organization_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_org_subs_trial_ends ON public.organization_subscriptions(trial_ends_at) WHERE status = 'trialing';
CREATE INDEX IF NOT EXISTS idx_org_subs_period_end ON public.organization_subscriptions(current_period_end);

COMMENT ON TABLE public.organization_subscriptions IS
  'Suscripción activa de cada org. Source-of-truth único del estado comercial.';

-- ---- 4. organization_modules ---------------------------------------

CREATE TABLE IF NOT EXISTS public.organization_modules (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  module_id           TEXT NOT NULL REFERENCES public.modules(id) ON DELETE CASCADE,
  enabled             BOOLEAN NOT NULL DEFAULT true,
  source              TEXT NOT NULL DEFAULT 'addon' CHECK (source IN ('addon','grant','trial')),
  activated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, module_id)
);

CREATE INDEX IF NOT EXISTS idx_org_modules_org ON public.organization_modules(organization_id);

COMMENT ON TABLE public.organization_modules IS
  'Overrides/add-ons por org. Complementa los features incluidos en el plan base.';

-- ---- 5. billing_events ---------------------------------------------

CREATE TABLE IF NOT EXISTS public.billing_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  provider            TEXT NOT NULL,
  provider_event_id   TEXT NOT NULL,
  event_type          TEXT NOT NULL,
  raw_payload         JSONB NOT NULL,
  processed_at        TIMESTAMPTZ,
  processing_error    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_events_org ON public.billing_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_billing_events_type ON public.billing_events(event_type);

COMMENT ON TABLE public.billing_events IS
  'Log idempotente de webhooks de pagos. UNIQUE(provider, provider_event_id) garantiza at-least-once sin duplicados.';

-- ---- 6. organization_usage -----------------------------------------

CREATE TABLE IF NOT EXISTS public.organization_usage (
  organization_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  metric              TEXT NOT NULL,                       -- 'broadcasts_sent' | 'sms_sent' | 'ai_messages'
  period_start        DATE NOT NULL,                       -- primer día del ciclo mensual
  count               INT NOT NULL DEFAULT 0 CHECK (count >= 0),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, metric, period_start)
);

COMMENT ON TABLE public.organization_usage IS
  'Contadores mensuales rollables para métricas con cap en el plan (broadcasts/mes, sms/mes, etc.).';

-- ---- 7. module_waitlist --------------------------------------------

CREATE TABLE IF NOT EXISTS public.module_waitlist (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  module_id           TEXT NOT NULL REFERENCES public.modules(id) ON DELETE CASCADE,
  user_id             UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email               TEXT,
  notified_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, module_id)
);

CREATE INDEX IF NOT EXISTS idx_module_waitlist_module ON public.module_waitlist(module_id);

COMMENT ON TABLE public.module_waitlist IS
  'Interés registrado en módulos en status coming_soon. Se notifica al cambiar a active.';

-- ---- 8. entitlement_denials ----------------------------------------

CREATE TABLE IF NOT EXISTS public.entitlement_denials (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id             UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  feature_key         TEXT NOT NULL,
  context             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entitlement_denials_org_feature
  ON public.entitlement_denials(organization_id, feature_key);
CREATE INDEX IF NOT EXISTS idx_entitlement_denials_created
  ON public.entitlement_denials(created_at DESC);

COMMENT ON TABLE public.entitlement_denials IS
  'Auditoría de intentos de uso de features no disponibles. Alimenta métricas de upsell.';

-- ============================================================
-- Trigger genérico updated_at (reutiliza el patrón del proyecto si existe)
-- ============================================================

CREATE OR REPLACE FUNCTION public.tg_saas_billing_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_plans_updated ON public.plans;
CREATE TRIGGER trg_plans_updated BEFORE UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.tg_saas_billing_touch_updated_at();

DROP TRIGGER IF EXISTS trg_modules_updated ON public.modules;
CREATE TRIGGER trg_modules_updated BEFORE UPDATE ON public.modules
  FOR EACH ROW EXECUTE FUNCTION public.tg_saas_billing_touch_updated_at();

DROP TRIGGER IF EXISTS trg_org_subs_updated ON public.organization_subscriptions;
CREATE TRIGGER trg_org_subs_updated BEFORE UPDATE ON public.organization_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.tg_saas_billing_touch_updated_at();

DROP TRIGGER IF EXISTS trg_org_modules_updated ON public.organization_modules;
CREATE TRIGGER trg_org_modules_updated BEFORE UPDATE ON public.organization_modules
  FOR EACH ROW EXECUTE FUNCTION public.tg_saas_billing_touch_updated_at();

-- ============================================================
-- Row Level Security
-- ============================================================

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.module_waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entitlement_denials ENABLE ROW LEVEL SECURITY;

-- plans: lectura pública (visibles en /pricing)
DROP POLICY IF EXISTS "plans_read_public" ON public.plans;
CREATE POLICY "plans_read_public" ON public.plans FOR SELECT
  USING (is_public = true OR auth.role() = 'service_role');

-- modules: lectura pública de active/beta/coming_soon (hidden solo service_role)
DROP POLICY IF EXISTS "modules_read_visible" ON public.modules;
CREATE POLICY "modules_read_visible" ON public.modules FOR SELECT
  USING (status <> 'hidden' OR auth.role() = 'service_role');

-- organization_subscriptions: leer las de mi org
DROP POLICY IF EXISTS "org_subs_read_own" ON public.organization_subscriptions;
CREATE POLICY "org_subs_read_own" ON public.organization_subscriptions FOR SELECT
  USING (organization_id = public.get_user_org_id());

-- organization_modules: leer/gestionar los de mi org (gestión desde service role / owner)
DROP POLICY IF EXISTS "org_modules_read_own" ON public.organization_modules;
CREATE POLICY "org_modules_read_own" ON public.organization_modules FOR SELECT
  USING (organization_id = public.get_user_org_id());

-- organization_usage: leer propias
DROP POLICY IF EXISTS "org_usage_read_own" ON public.organization_usage;
CREATE POLICY "org_usage_read_own" ON public.organization_usage FOR SELECT
  USING (organization_id = public.get_user_org_id());

-- module_waitlist: insertar y leer las propias
DROP POLICY IF EXISTS "waitlist_read_own" ON public.module_waitlist;
CREATE POLICY "waitlist_read_own" ON public.module_waitlist FOR SELECT
  USING (organization_id IS NULL OR organization_id = public.get_user_org_id());
DROP POLICY IF EXISTS "waitlist_insert_own" ON public.module_waitlist;
CREATE POLICY "waitlist_insert_own" ON public.module_waitlist FOR INSERT
  WITH CHECK (organization_id IS NULL OR organization_id = public.get_user_org_id());

-- billing_events: solo service_role (nunca clientes)
-- entitlement_denials: solo service_role puede leer; todos los roles pueden insertar vía SECURITY DEFINER helper

COMMIT;
