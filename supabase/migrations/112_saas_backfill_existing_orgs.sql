-- ============================================================
-- Migración 112: Backfill de suscripciones para orgs existentes
-- ============================================================
--
-- Los clientes que ya usan el producto antes de la comercialización
-- quedan "grandfathered" en el plan Enterprise de por vida (gratis o
-- bajo acuerdo comercial manual). Esto evita romper cuentas activas
-- al introducir enforcement.
--
-- Requisitos previos:
--   - Haber ejecutado 106 (tablas plans/subscriptions).
--   - Haber ejecutado supabase/seed_plans.sql (para que exista el plan 'enterprise').
--
-- La migración es idempotente: solo inserta para orgs sin subscription.
-- ============================================================

BEGIN;

-- Seed mínimo del plan 'enterprise' en caso de que seed_plans.sql aún
-- no se haya aplicado — asegura que el INSERT no falle por FK.
INSERT INTO public.plans (id, name, tagline, price_ars_monthly, price_ars_yearly, features, limits, is_public, sort_order)
VALUES (
  'enterprise',
  'Enterprise',
  'Grandfathered — clientes previos a la comercialización',
  13990000, 139900000,
  '{}'::jsonb,
  '{"branches": 10, "staff": -1, "clients": -1, "broadcasts_monthly": -1}'::jsonb,
  true,
  30
) ON CONFLICT (id) DO NOTHING;

-- Crear subscription para cada org que aún no tenga una
INSERT INTO public.organization_subscriptions (
  organization_id, plan_id, status,
  billing_cycle, currency,
  current_period_start, current_period_end,
  grandfathered, notes
)
SELECT
  o.id,
  'enterprise',
  'active',
  'monthly',
  'ARS',
  now(),
  now() + interval '10 years',
  true,
  'Grandfathered - cliente previo a la comercialización SaaS (migración 108)'
FROM public.organizations o
LEFT JOIN public.organization_subscriptions s ON s.organization_id = o.id
WHERE s.id IS NULL
  AND o.is_active = true;

COMMIT;
