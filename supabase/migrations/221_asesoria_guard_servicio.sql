-- APLICADA en prod el 4/10/2026 (schema_migrations «221_asesoria_guard_servicio»).
-- ============================================================================
-- 221 — Una asesoría no se cierra como corte sin decir qué se le hizo
--        (red en la base) + la asesoría visible para el asistente
-- ============================================================================
-- Por qué (hallazgos asesoria-01 y seguridad-y-despliegue-02 de la revisión
-- del 4/10/2026, confirmados contra prod):
--
--   La entrada de una asesoría nace con service_id NULL y pidio_asesoria = true
--   (mig 217). La regla «al cobrar, elegir lo que se le hizo es obligatorio»
--   vive en el completeService NUEVO. Un panel que siga con el bundle viejo
--   (Skew Protection lo rutea al deployment viejo, o simplemente no se
--   recargó) cobra con el completeService VIEJO, que no exige servicio y no
--   conoce la asesoría:
--     * sin elegir nada, la visita queda en $0 (visits no tiene CHECK sobre
--       amount) y nadie se entera;
--     * en Caseros y Paraná todos los principales son 'checkin', así que el
--       diálogo viejo sólo ofrece «Barba (Adiciónalas) $4.000»: un Corte de
--       $18.000 queda registrado como $4.000 en caja, comisión, ARCA y puntos.
--
--   Esta migración pone la regla en la base, donde ningún bundle la saltea:
--   un trigger BEFORE UPDATE OF status rechaza pasar de in_progress a
--   completed una entrada con pidio_asesoria y SIN service_id (salvo un
--   descanso). El panel viejo recibe el error «Esta entrada pidió asesoría:
--   recargá el panel y elegí el servicio que le hiciste.», la entrada queda
--   intacta y, al recargar, el cobro nuevo exige el servicio.
--
--   El código nuevo NO choca con el trigger: completeService exige un servicio
--   PRINCIPAL para una asesoría (los extras solos no alcanzan) y lo escribe en
--   la entrada (service_id) en la MISMA UPDATE que la cierra. Todos los caminos
--   que pasan una entrada a 'completed' se relevaron el 4/10/2026:
--     * TypeScript: sólo completeService (queue.ts, paso 1). Los descansos se
--       terminan BORRANDO la entrada (breaks.ts) y markAppointmentCompleted
--       toca appointments, no queue_entries.
--     * SQL vivo (pg_proc, prosrc): ninguna función pone status 'completed' en
--       queue_entries (claim_next_for_barber → in_progress; check_in_appointment,
--       menor_espera_responder, batch_update_queue_entries → sin status;
--       expire_stale_queue_entries y delete_client_account → cancelled).
--     * cron.job: sólo expire_stale_queue_entries (→ cancelled).
--     * Edge functions y app móvil: no escriben queue_entries.status.
--   La única puerta que queda es la REST (policy queue_entries_manage_by_org,
--   ALL para el staff logueado): el trigger también la cubre.
--
--   cerrarSoloAsesoria pasa la entrada a 'cancelled', no a 'completed': el
--   trigger no la toca.
--
-- De paso (hallazgo asesoria-05): v_assistant_queue suma pidio_asesoria y
-- cancel_reason AL FINAL. CREATE OR REPLACE VIEW sólo admite agregar columnas
-- al final con las existentes iguales; la vista no tiene dependientes y
-- conserva su ACL (postgres, service_role, assistant_ro). Igual se reafirman
-- los grants: si la vista no existiera, Supabase la crearía con ALL para anon
-- y authenticated (default privileges), y es una vista con datos de clientes.
--
-- Qué NO hace, a propósito:
--   * No toca on_queue_completed, ni completeService, ni ninguna RPC viva.
--   * Ninguna FK nueva (Known Risk #15) ni cambios de grants sobre tablas
--     (Known Risk #34).
--   * No crea índices: la tarjeta de métricas de la asesoría lee
--     queue_entries con un seq scan de ~5 ms (19.069 filas al 4/10/2026).
--
-- Cuándo aplicarla: AHORA (antes del deploy). Con HEAD corriendo ninguna
-- entrada puede tener pidio_asesoria = true (HEAD no conoce la columna y la
-- asesoría está apagada en las 4 sucursales de Monaco), así que el trigger no
-- dispara hasta que exista el código nuevo; y el código nuevo ya escribe el
-- servicio al cerrar. CREATE OR REPLACE TRIGGER toma SHARE ROW EXCLUSIVE sobre
-- queue_entries un instante: con lock_timeout falla rápido en vez de encolar
-- a las tablets (aplicarla con los locales cerrados, como la 217).
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1) La regla ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_queue_asesoria_exige_servicio()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Las mismas condiciones que el WHEN del trigger: si alguien lo recrea sin el
  -- WHEN, la función sigue diciendo lo mismo.
  IF OLD.status = 'in_progress'
     AND NEW.status = 'completed'
     AND COALESCE(NEW.pidio_asesoria, false)
     AND NEW.service_id IS NULL
     AND NOT COALESCE(NEW.is_break, false) THEN
    RAISE EXCEPTION 'Esta entrada pidió asesoría: recargá el panel y elegí el servicio que le hiciste.'
      USING ERRCODE = 'P0001',
            DETAIL  = format('queue_entry %s: pidio_asesoria sin service_id al cerrar el cobro', NEW.id),
            HINT    = 'asesoria_sin_servicio';
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_queue_asesoria_exige_servicio() IS
  'Mig 221: rechaza cerrar como cobrada (in_progress -> completed) una entrada que pidió asesoría sin service_id. Red para paneles con bundle viejo: el completeService nuevo exige un servicio principal y lo escribe en la entrada en la misma UPDATE que la cierra.';

-- 2) El trigger: BEFORE, así rechaza antes de que on_queue_completed (AFTER)
--    cree la visita. El WHEN evita llamar a la función en el 99,9 % de las
--    UPDATE de la tabla más caliente del sistema.
CREATE OR REPLACE TRIGGER trg_queue_asesoria_exige_servicio
  BEFORE UPDATE OF status ON public.queue_entries
  FOR EACH ROW
  WHEN (
    OLD.status = 'in_progress'
    AND NEW.status = 'completed'
    AND NEW.pidio_asesoria
    AND NEW.service_id IS NULL
  )
  EXECUTE FUNCTION public.fn_queue_asesoria_exige_servicio();

-- 3) v_assistant_queue: la asesoría visible para el Modo Pro del asistente ------
CREATE OR REPLACE VIEW public.v_assistant_queue AS
  SELECT id, organization_id, branch_id, client_id, barber_id, status, "position",
         checked_in_at, started_at, completed_at, created_at,
         pidio_asesoria, cancel_reason
  FROM public.queue_entries
  WHERE organization_id = public._assistant_current_org();

COMMENT ON COLUMN public.v_assistant_queue.pidio_asesoria IS
  'Mig 221: el cliente pidió asesoría sin costo en la tablet.';
COMMENT ON COLUMN public.v_assistant_queue.cancel_reason IS
  'Mig 221: por qué salió de la fila. solo_asesoria = se asesoró y no se hizo ningún servicio (cierre sin visita).';

-- Los mismos grants que la mig 155: sólo assistant_ro la lee.
REVOKE ALL ON public.v_assistant_queue FROM anon, authenticated, public;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'assistant_ro') THEN
    GRANT SELECT ON public.v_assistant_queue TO assistant_ro;
  END IF;
END $$;

-- 4) Autoverificación -----------------------------------------------------------
DO $$
DECLARE
  v_def      text;
  v_cols     text[];
  v_esperado text[] := ARRAY['id','organization_id','branch_id','client_id','barber_id','status','position',
                             'checked_in_at','started_at','completed_at','created_at',
                             'pidio_asesoria','cancel_reason'];
  v_rechazo  boolean;
BEGIN
  -- 4a) El trigger existe, está habilitado y es el que dice esta migración.
  SELECT pg_get_triggerdef(t.oid) INTO v_def
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.queue_entries'::regclass
     AND t.tgname = 'trg_queue_asesoria_exige_servicio'
     AND NOT t.tgisinternal
     AND t.tgenabled = 'O';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '221: falta (o está deshabilitado) trg_queue_asesoria_exige_servicio';
  END IF;
  IF v_def NOT LIKE '%BEFORE UPDATE OF status ON public.queue_entries%'
     OR v_def NOT LIKE '%fn_queue_asesoria_exige_servicio()%'
     OR v_def NOT LIKE '%pidio_asesoria%'
     OR v_def NOT LIKE '%service_id IS NULL%' THEN
    RAISE EXCEPTION '221: el trigger no quedó como se esperaba: %', v_def;
  END IF;

  -- 4b) La lógica, contra una tabla TEMPORAL con el mismo trigger: no se toca
  --     ninguna fila de queue_entries en prod.
  CREATE TEMP TABLE _t221 (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    status         public.queue_status NOT NULL,
    pidio_asesoria boolean NOT NULL DEFAULT false,
    service_id     uuid,
    is_break       boolean DEFAULT false
  ) ON COMMIT DROP;
  CREATE TRIGGER _t221_trg BEFORE UPDATE OF status ON _t221 FOR EACH ROW
    WHEN (OLD.status = 'in_progress' AND NEW.status = 'completed' AND NEW.pidio_asesoria AND NEW.service_id IS NULL)
    EXECUTE FUNCTION public.fn_queue_asesoria_exige_servicio();
  INSERT INTO _t221 (id, status, pidio_asesoria, service_id, is_break) VALUES
    ('00000000-0000-0000-0000-000000000001', 'in_progress', true,  NULL, false),  -- asesoría sin servicio
    ('00000000-0000-0000-0000-000000000002', 'in_progress', true,  gen_random_uuid(), false), -- con servicio
    ('00000000-0000-0000-0000-000000000003', 'in_progress', false, NULL, false),  -- corte común sin servicio
    ('00000000-0000-0000-0000-000000000004', 'in_progress', true,  NULL, true),   -- descanso (no aplica)
    ('00000000-0000-0000-0000-000000000005', 'in_progress', true,  NULL, false);  -- se cierra como solo asesoría

  v_rechazo := false;
  BEGIN
    UPDATE _t221 SET status = 'completed' WHERE id = '00000000-0000-0000-0000-000000000001';
  EXCEPTION WHEN raise_exception THEN
    v_rechazo := SQLERRM LIKE 'Esta entrada pidió asesoría:%';
  END;
  IF NOT v_rechazo THEN
    RAISE EXCEPTION '221: el trigger NO rechazó cerrar una asesoría sin servicio';
  END IF;

  -- El camino nuevo: el servicio se escribe en la MISMA UPDATE que cierra.
  UPDATE _t221 SET status = 'completed', service_id = gen_random_uuid()
   WHERE id = '00000000-0000-0000-0000-000000000001';
  UPDATE _t221 SET status = 'completed' WHERE id IN ('00000000-0000-0000-0000-000000000002',
                                                     '00000000-0000-0000-0000-000000000003',
                                                     '00000000-0000-0000-0000-000000000004');
  UPDATE _t221 SET status = 'cancelled' WHERE id = '00000000-0000-0000-0000-000000000005';
  IF (SELECT count(*) FROM _t221 WHERE status = 'completed') <> 4
     OR (SELECT status FROM _t221 WHERE id = '00000000-0000-0000-0000-000000000005') <> 'cancelled' THEN
    RAISE EXCEPTION '221: el trigger bloqueó un camino legítimo';
  END IF;
  DROP TABLE _t221;

  -- 4c) La vista: las 11 columnas de siempre, en el mismo orden, y las 2 nuevas al final.
  SELECT array_agg(a.attname::text ORDER BY a.attnum) INTO v_cols
    FROM pg_attribute a
   WHERE a.attrelid = 'public.v_assistant_queue'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols IS DISTINCT FROM v_esperado THEN
    RAISE EXCEPTION '221: v_assistant_queue quedó con columnas inesperadas: %', v_cols;
  END IF;

  -- 4d) Nadie de la API la lee; el asistente sí.
  IF has_table_privilege('anon', 'public.v_assistant_queue', 'SELECT')
     OR has_table_privilege('authenticated', 'public.v_assistant_queue', 'SELECT') THEN
    RAISE EXCEPTION '221: v_assistant_queue quedó legible para anon/authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'assistant_ro')
     AND NOT has_table_privilege('assistant_ro', 'public.v_assistant_queue', 'SELECT') THEN
    RAISE EXCEPTION '221: assistant_ro perdió el SELECT sobre v_assistant_queue';
  END IF;

  RAISE NOTICE '221 OK: trigger activo y probado, vista extendida, grants intactos';
END $$;

COMMIT;

-- ============================================================================
-- Verificación post-aplicación (solo lectura)
-- ============================================================================
-- 1) El trigger está y es BEFORE UPDATE OF status con el WHEN:
--    SELECT tgname, tgenabled, pg_get_triggerdef(oid)
--      FROM pg_trigger
--     WHERE tgrelid = 'public.queue_entries'::regclass
--       AND tgname = 'trg_queue_asesoria_exige_servicio';
--
-- 2) Ninguna entrada quedó en el estado que el trigger impide (tiene que dar 0;
--    antes de prender la asesoría en una sucursal, también):
--    SELECT count(*) FROM public.queue_entries
--     WHERE status = 'completed' AND pidio_asesoria AND service_id IS NULL
--       AND NOT COALESCE(is_break, false);
--
-- 3) La vista expone las columnas nuevas y conserva su ACL:
--    SELECT attname FROM pg_attribute
--     WHERE attrelid = 'public.v_assistant_queue'::regclass AND attnum > 0 ORDER BY attnum;
--    SELECT relacl FROM pg_class WHERE oid = 'public.v_assistant_queue'::regclass;
--    -- esperado: {postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,assistant_ro=r/postgres}
--
-- 4) Después del deploy, los cobros de asesoría escriben el servicio en la
--    entrada (cuando haya alguna):
--    SELECT q.id, q.service_id, v.service_id AS servicio_visita, v.amount
--      FROM public.queue_entries q JOIN public.visits v ON v.queue_entry_id = q.id
--     WHERE q.pidio_asesoria AND q.status = 'completed'
--     ORDER BY q.completed_at DESC LIMIT 20;
--
-- 5) postgres_logs: un panel viejo que choque con el trigger deja el mensaje
--    «Esta entrada pidió asesoría» (P0001). Es la señal de que hay que recargar
--    las tablets de esa sucursal.
--
-- ============================================================================
-- Rollback (no deja datos: el trigger no escribe nada)
-- ============================================================================
-- BEGIN;
-- SET LOCAL lock_timeout = '5s';
-- DROP TRIGGER IF EXISTS trg_queue_asesoria_exige_servicio ON public.queue_entries;
-- DROP FUNCTION IF EXISTS public.fn_queue_asesoria_exige_servicio();
-- -- CREATE OR REPLACE VIEW no puede sacar columnas: se recrea (no tiene dependientes).
-- DROP VIEW IF EXISTS public.v_assistant_queue;
-- CREATE VIEW public.v_assistant_queue AS
--   SELECT id, organization_id, branch_id, client_id, barber_id, status, "position",
--          checked_in_at, started_at, completed_at, created_at
--   FROM public.queue_entries
--   WHERE organization_id = public._assistant_current_org();
-- REVOKE ALL ON public.v_assistant_queue FROM anon, authenticated, public;
-- GRANT SELECT ON public.v_assistant_queue TO assistant_ro;
-- COMMIT;
