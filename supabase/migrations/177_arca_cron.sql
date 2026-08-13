-- =============================================================================
-- 177_arca_cron.sql
-- Dispara la emisión automática del cupo.
--
-- Corre CADA HORA, no cada minuto: la ruta decide sola si a alguna política le
-- llegó su hora local y si ya corrió hoy. Con emisión diaria, un cron por
-- minuto serían 1.440 llamadas para hacer un trabajo que se hace una vez.
--
-- Sin `cron_secret`: las rutas nuevas de este proyecto no lo llevan (ver el
-- CLAUDE.md del dashboard). Lo que la protege es que sea idempotente —
-- `last_auto_run_at` por día local, más el índice único de una factura por
-- visita. Tocarla a mano no puede duplicar un comprobante.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.trigger_arca_facturacion()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_url        text;
  v_request_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets
  WHERE name = 'app_base_url'
  LIMIT 1;

  IF v_url IS NULL THEN
    RAISE EXCEPTION 'Falta el secreto app_base_url en Vault';
  END IF;

  SELECT net.http_get(
    url := v_url || '/api/cron/arca-facturacion',
    timeout_milliseconds := 60000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_arca_facturacion() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trigger_arca_facturacion() TO postgres;

COMMENT ON FUNCTION public.trigger_arca_facturacion() IS
  'Llamado por pg_cron cada hora. Pega en /api/cron/arca-facturacion, que decide qué políticas corresponde correr.';

DO $$
BEGIN
  PERFORM cron.unschedule('arca-facturacion');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'arca-facturacion',
  '5 * * * *',   -- al minuto 5 de cada hora, para no chocar con los jobs en punto
  $job$SELECT public.trigger_arca_facturacion();$job$
);
