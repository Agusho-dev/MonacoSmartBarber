-- =============================================================================
-- 229 — increment_org_usage sólo para el servidor (22/oct/2026)
--
-- La función (mig 111) es SECURITY DEFINER y tenía EXECUTE para PUBLIC, anon y
-- authenticated: con la anon key que viaja en el bundle, cualquiera podía
-- llamarla con cualquier p_org_id y p_amount. Con p_amount = 0 devuelve el total
-- y con −N lo deja en 0 (el CHECK count >= 0 sólo frena que quede negativo):
-- se salteaba el tope mensual de mensajes de Tex o de difusiones, o se le
-- agotaba a otra org con +N.
--
-- El único que la llama es incrementUsage (src/lib/actions/entitlements.ts) con
-- createAdminClient, o sea service_role. Verificado antes de aplicar: ninguna
-- función SQL ni trigger la referencia, y ni la app móvil ni las edge functions
-- la usan. Hay que sacarla de PUBLIC Y de anon/authenticated (los grants
-- explícitos sobreviven al REVOKE de PUBLIC).
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.increment_org_usage(uuid, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_org_usage(uuid, text, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_org_usage(uuid, text, integer) TO service_role;
