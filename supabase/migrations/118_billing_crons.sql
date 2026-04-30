-- ============================================================
-- Migración 118: pg_cron jobs para billing manual
-- ============================================================
--
-- Programa dos cron jobs vía pg_cron + pg_net:
--   - expire-trials: diario 04:00 UTC (01:00 ART)
--   - notify-renewals: diario 13:00 UTC (10:00 ART, antes del horario laboral)
--
-- Ambos endpoints son idempotentes y no requieren CRON_SECRET (ver
-- README de cron jobs en CLAUDE.md). Hacen un POST sin body al route
-- handler correspondiente.
--
-- Requisitos previos:
--   * vault secret 'app_base_url' → URL del dashboard productivo.
--     (Si no existe el secret, el cron loguea pero no falla.)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- -----------------------------------------------------------------
-- Helper: trigger genérico para HTTP POST a /api/cron/<endpoint>
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trigger_billing_cron(p_endpoint TEXT)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  v_url text;
  v_request_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets
  WHERE name = 'app_base_url'
  LIMIT 1;

  IF v_url IS NULL THEN
    RAISE WARNING 'Vault secret "app_base_url" no configurado — billing cron salteado.';
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := v_url || '/api/cron/' || p_endpoint,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_billing_cron(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trigger_billing_cron(TEXT) TO postgres;

-- -----------------------------------------------------------------
-- Job: expire-trials (diario 04:00 UTC)
-- -----------------------------------------------------------------
DO $$
BEGIN
  PERFORM cron.unschedule('billing-expire-trials');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'billing-expire-trials',
  '0 4 * * *',
  $job$SELECT public.trigger_billing_cron('expire-trials');$job$
);

-- -----------------------------------------------------------------
-- Job: notify-renewals (diario 13:00 UTC ≈ 10:00 ART)
-- -----------------------------------------------------------------
DO $$
BEGIN
  PERFORM cron.unschedule('billing-notify-renewals');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'billing-notify-renewals',
  '0 13 * * *',
  $job$SELECT public.trigger_billing_cron('notify-renewals');$job$
);

-- -----------------------------------------------------------------
-- Vista de salud
-- -----------------------------------------------------------------
CREATE OR REPLACE VIEW public.billing_cron_health AS
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
  FROM cron.job_run_details
  WHERE jobid = j.jobid
  ORDER BY start_time DESC
  LIMIT 1
) r ON true
WHERE j.jobname IN ('billing-expire-trials','billing-notify-renewals');
