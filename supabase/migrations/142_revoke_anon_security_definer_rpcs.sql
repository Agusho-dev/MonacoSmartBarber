-- 142: Cerrar ejecución anónima de RPCs SECURITY DEFINER sensibles.
--
-- Hallazgo (auditoría 02/jun/2026): `save_workflow_graph` y
-- `trigger_process_workflow_delays` son SECURITY DEFINER (bypassean RLS) y tenían
-- EXECUTE para `anon` y PUBLIC. `save_workflow_graph(p_organization_id, p_nodes,
-- p_edges, ...)` recibe el org_id por parámetro: cualquiera con la anon key podía
-- SOBREESCRIBIR el grafo de workflows de CUALQUIER organización. Escalada de
-- privilegios + escritura cross-tenant.
--
-- Ambas se invocan sólo server-side con service_role (createAdminClient) / pg_cron,
-- así que revocar anon/authenticated/PUBLIC no rompe nada.
--
-- IMPORTANTE: `submit_client_review` SÍ debe seguir siendo anon-ejecutable
-- (la página pública /review/[token] la usa) — NO se toca.

REVOKE EXECUTE ON FUNCTION public.save_workflow_graph(uuid, uuid, jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.save_workflow_graph(uuid, uuid, jsonb, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.save_workflow_graph(uuid, uuid, jsonb, jsonb) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.save_workflow_graph(uuid, uuid, jsonb, jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.trigger_process_workflow_delays() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trigger_process_workflow_delays() FROM anon;
REVOKE EXECUTE ON FUNCTION public.trigger_process_workflow_delays() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.trigger_process_workflow_delays() TO service_role;
