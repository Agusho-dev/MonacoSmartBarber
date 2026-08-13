-- =============================================================================
-- 180_fix_cron_process_appointments.sql
-- Repara el cron `process_appointments`, que venía recibiendo 404 desde abril.
--
-- QUÉ ESTABA MAL
-- --------------
-- El job se creó a mano (nunca estuvo en una migración) con DOS cosas escritas
-- literalmente adentro del comando de `cron.job`:
--
--   1. La URL `https://monaco-smart-barber-rosy.vercel.app/...`, que es un
--      alias de Vercel que ya no existe. Todas las corridas daban 404.
--   2. El CRON_SECRET en texto plano.
--
-- Y lo peor: `cron.job_run_details` marcaba **succeeded** en cada corrida,
-- porque pg_net es asincrónico y lo único que reporta ahí es que el request se
-- ENCOLÓ. El resultado real vive en `net._http_response`, que nadie mira. Un
-- cron muerto que se reporta como sano durante cuatro meses es exactamente la
-- familia de bug del Known Risk #13: el error se loguea (o ni eso) y nadie se
-- entera.
--
-- CÓMO QUEDA
-- ----------
-- Igual que los otros cinco: una función que resuelve la URL y el secreto desde
-- Vault. Así, el día que cambie el dominio se toca UN secreto y no seis lugares
-- distintos — que es la razón por la que este job se rompió y los demás no.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.trigger_process_appointments()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_url        text;
  v_secret     text;
  v_request_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets WHERE name = 'app_base_url' LIMIT 1;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;

  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE EXCEPTION 'Faltan secretos en Vault: app_base_url=%, cron_secret=%',
      (v_url IS NOT NULL), (v_secret IS NOT NULL);
  END IF;

  SELECT net.http_post(
    url := v_url || '/api/cron/process-appointments',
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

REVOKE ALL ON FUNCTION public.trigger_process_appointments() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trigger_process_appointments() TO postgres;

COMMENT ON FUNCTION public.trigger_process_appointments() IS
  'Llamado por pg_cron cada minuto. Resuelve URL y secreto desde Vault en vez de tenerlos escritos en cron.job.';

DO $$
BEGIN
  PERFORM cron.unschedule('process_appointments');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'process_appointments',
  '* * * * *',
  $job$SELECT public.trigger_process_appointments();$job$
);
