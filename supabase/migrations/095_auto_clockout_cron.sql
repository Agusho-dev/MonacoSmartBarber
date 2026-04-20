-- 095_auto_clockout_cron.sql
-- Cierra automáticamente la jornada (clock_out) a las 23:59 hora local de cada
-- organización, para todos los staff que marcaron clock_in hoy y aún no
-- marcaron salida. El endpoint /api/cron/auto-clockout hace la lógica
-- "¿es 23:59 en la timezone de esta org?" porque Postgres no conoce los
-- timezones de cada organización sin una query — es más simple dejar que
-- el endpoint la ejecute cada minuto.
--
-- Requisitos previos (ya cargados en Vault por migración 087):
--   * vault secret 'cron_secret'  → igual a CRON_SECRET en Vercel env.
--   * vault secret 'app_base_url' → URL de producción del dashboard.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Dispara la llamada HTTP al endpoint de Vercel leyendo secrets desde Vault.
CREATE OR REPLACE FUNCTION public.trigger_auto_clockout()
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
    url := v_url || '/api/cron/auto-clockout',
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

REVOKE ALL ON FUNCTION public.trigger_auto_clockout() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trigger_auto_clockout() TO postgres;

-- Idempotencia: borrar el job si ya existía antes de recrearlo.
DO $$
BEGIN
  PERFORM cron.unschedule('auto-clockout');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'auto-clockout',
  '* * * * *',
  $job$SELECT public.trigger_auto_clockout();$job$
);

-- Extiende la vista de observabilidad existente para cubrir este job también.
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
WHERE j.jobname IN (
  'process-workflow-delays',
  'expire-stale-workflow-executions',
  'auto-clockout'
);

GRANT SELECT ON public.workflow_cron_health TO service_role;

COMMENT ON FUNCTION public.trigger_auto_clockout() IS
  'Llamado por pg_cron cada minuto. POSTea al endpoint /api/cron/auto-clockout. El endpoint cierra con clock_out a los staff cuya organización está en la ventana 23:58–23:59 hora local.';
