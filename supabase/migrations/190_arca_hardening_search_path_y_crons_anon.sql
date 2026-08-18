-- =============================================================================
-- 190 — Endurecimiento: search_path fijo, y los crons dejan de ser disparables
--       por cualquiera con la anon key
--
-- Salió de correr los advisors de Supabase después de aplicar la 188/189.
-- Aplicada el 18/8/2026.
--
-- 1) TRES funciones del módulo ARCA sin `SET search_path`. El resto del módulo lo
--    tiene; estas tres quedaron afuera. Con search_path mutable, quien pueda
--    crear un schema puede sombrear `upper`/`btrim` y cambiar lo que decide una
--    función que clasifica puntos de venta fiscales.
--
-- 2) CINCO de las seis funciones `trigger_*` de cron eran SECURITY DEFINER con
--    EXECUTE para `anon` y `authenticated`. La anon key viaja en el bundle del
--    browser, así que cualquiera podía hacer
--
--        POST /rest/v1/rpc/trigger_arca_facturacion
--
--    y hacer que la base dispare el cron de facturación, leyendo de paso el
--    secreto de Vault con los permisos del definer. Hoy esa corrida es inerte
--    (la mig 186 dejó `auto_emit = false` en todas las políticas y la ruta filtra
--    por esa columna), pero es un gatillo de emisión fiscal abierto a internet
--    esperando el día que alguien prenda la columna.
--
--    Dos son peores que inertes:
--      · `trigger_auto_clockout` ficha la salida de todo el mundo: mutación real.
--      · `trigger_billing_cron(p_endpoint text)` arma la URL como
--        `app_base_url || '/api/cron/' || p_endpoint`. Con el parámetro en manos
--        de cualquiera —y `../` de por medio— la base hace POST a CUALQUIER ruta
--        del dominio de la app. Toda ruta interna que hoy no valida nada "porque
--        sólo la llama el cron" pasaba a ser invocable desde afuera. Es el mismo
--        problema que tenían las RPCs de turnos antes de la mig 168.
--
--    `trigger_process_workflow_delays` YA estaba restringida: la postura correcta
--    ya estaba decidida y estas cinco quedaron sin alinear.
--
--    pg_cron corre los jobs como el usuario que los programó (`postgres`), que
--    conserva EXECUTE por ser el dueño: revocar de anon/authenticated no toca el
--    funcionamiento de ningún cron. Verificado después de aplicar —y verificado
--    donde hay que verificarlo, que es `net._http_response` y no
--    `cron.job_run_details` (Known Risk #26)—: 15 corridas, 9 respuestas HTTP,
--    todas 200, cero fallidas.
-- =============================================================================

-- 1. search_path fijo -------------------------------------------------------
ALTER FUNCTION arca_pv_sirve_para_cae(text)       SET search_path = public, pg_temp;
ALTER FUNCTION arca_policy_prioridad_por_origen() SET search_path = public, pg_temp;
ALTER FUNCTION arca_touch_updated_at()            SET search_path = public, pg_temp;

-- 2. los crons sólo los dispara service_role (y postgres, que es el dueño) ---
REVOKE ALL ON FUNCTION trigger_arca_facturacion()               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION trigger_assistant_embed_pending()        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION trigger_auto_clockout()                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION trigger_billing_cron(text)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION trigger_generate_fixed_expense_periods() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION trigger_arca_facturacion()               TO service_role;
GRANT EXECUTE ON FUNCTION trigger_assistant_embed_pending()        TO service_role;
GRANT EXECUTE ON FUNCTION trigger_auto_clockout()                  TO service_role;
GRANT EXECUTE ON FUNCTION trigger_billing_cron(text)               TO service_role;
GRANT EXECUTE ON FUNCTION trigger_generate_fixed_expense_periods() TO service_role;
