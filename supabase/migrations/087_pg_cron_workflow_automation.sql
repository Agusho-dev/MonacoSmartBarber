-- 087_pg_cron_workflow_automation.sql
-- Automatiza el motor de workflows sin depender de Vercel Cron (no soportado en Hobby).
-- - pg_cron dispara cada minuto /api/cron/process-workflow-delays via pg_net (HTTP).
-- - pg_cron dispara cada 5 min expire_stale_workflow_executions() directo en Postgres.
-- Requisitos previos (ya cargados en Vault):
--   * vault secret 'cron_secret'   → igual a CRON_SECRET en Vercel env.
--   * vault secret 'app_base_url'  → URL de producción del dashboard.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Helper: dispara la llamada HTTP al endpoint de Vercel leyendo secrets desde Vault.
-- SECURITY DEFINER para poder leer vault.decrypted_secrets sin exponerlo a roles anon/authenticated.
CREATE OR REPLACE FUNCTION public.trigger_process_workflow_delays()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  v_url text;
  v_secret text;
  v_request_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets
  WHERE name = 'app_base_url'
  LIMIT 1;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'cron_secret'
  LIMIT 1;

  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE EXCEPTION 'Missing vault secrets: app_base_url=%, cron_secret=%',
      (v_url IS NOT NULL), (v_secret IS NOT NULL);
  END IF;

  SELECT net.http_post(
    url := v_url || '/api/cron/process-workflow-delays',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_process_workflow_delays() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trigger_process_workflow_delays() TO postgres;

-- Idempotencia: borrar el job si ya existía antes de recrearlo.
DO $$
BEGIN
  PERFORM cron.unschedule('process-workflow-delays');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'process-workflow-delays',
  '* * * * *',
  $job$SELECT public.trigger_process_workflow_delays();$job$
);

-- Segundo job: expira executions bloqueadas pasado su wait_reply_timeout_minutes.
-- No necesita HTTP: es SQL puro dentro del mismo Postgres.
DO $$
BEGIN
  PERFORM cron.unschedule('expire-stale-workflow-executions');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'expire-stale-workflow-executions',
  '*/5 * * * *',
  $job$SELECT public.expire_stale_workflow_executions();$job$
);

-- Vista de observabilidad: última corrida de cada job de workflows.
CREATE OR REPLACE VIEW public.workflow_cron_health AS
SELECT
  j.jobname,
  j.schedule,
  j.active,
  r.runid,
  r.status,
  r.return_message,
  r.start_time,
  r.end_time,
  EXTRACT(EPOCH FROM (r.end_time - r.start_time)) AS duration_seconds
FROM cron.job j
LEFT JOIN LATERAL (
  SELECT *
  FROM cron.job_run_details d
  WHERE d.jobid = j.jobid
  ORDER BY d.start_time DESC
  LIMIT 1
) r ON true
WHERE j.jobname IN ('process-workflow-delays', 'expire-stale-workflow-executions');

GRANT SELECT ON public.workflow_cron_health TO service_role;

COMMENT ON FUNCTION public.trigger_process_workflow_delays() IS
  'Llamado por pg_cron cada minuto. POSTea al endpoint /api/cron/process-workflow-delays del dashboard usando CRON_SECRET desde Vault.';

COMMENT ON VIEW public.workflow_cron_health IS
  'Estado de la última corrida de los jobs de workflows. Consultar desde el panel de observabilidad.';
