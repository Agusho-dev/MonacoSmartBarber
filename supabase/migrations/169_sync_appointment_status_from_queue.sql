-- 169_sync_appointment_status_from_queue.sql
-- ---------------------------------------------------------------------------
-- Sincroniza `appointments.status` desde `queue_entries`.
--
-- Un turno con check-in hecho vive en las dos tablas a la vez, y cada camino
-- que arranca o termina el servicio tenía que acordarse de escribir las dos
-- puntas. Varios no lo hacían: `startService` (el botón Play del dashboard y
-- del panel de la fila) pasa la queue_entry a `in_progress` y NO tocaba el
-- turno, que se quedaba en `checked_in` en la agenda para siempre. Lo mismo al
-- completar el corte.
--
-- Es el patrón del Known Risk #13: si el invariante depende de que todos los
-- call-sites se acuerden, tarde o temprano uno se olvida. Lo garantiza la DB.
--
-- Deliberadamente NO cubre `cancelled`: `cancelQueueEntry` (queue.ts) ya define
-- su propia semántica ahí (pasa el turno a `no_show` y limpia la
-- back-reference), y duplicarla desde un trigger crearía dos fuentes de verdad
-- para el mismo evento.
--
-- Verificado contra prod en transacción revertida:
--   tras check-in           -> turno: checked_in
--   tras Play en la fila    -> turno: in_progress
--   tras finalizar el corte -> turno: completed  (+ visita con appointment_id)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_sync_appointment_status_from_queue()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.appointment_id IS NULL OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'in_progress' THEN
    UPDATE appointments
    SET status = 'in_progress'
    WHERE id = NEW.appointment_id
      AND status IN ('scheduled','confirmed','checked_in');

  ELSIF NEW.status = 'completed' THEN
    UPDATE appointments
    SET status = 'completed'
    WHERE id = NEW.appointment_id
      AND status IN ('scheduled','confirmed','checked_in','in_progress');
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_queue_sync_appointment_status ON public.queue_entries;

-- AFTER: no altera la fila de la cola, sólo propaga. Si el UPDATE de la cola
-- falla, no queremos haber tocado el turno.
CREATE TRIGGER trg_queue_sync_appointment_status
  AFTER UPDATE OF status ON public.queue_entries
  FOR EACH ROW
  WHEN (NEW.appointment_id IS NOT NULL)
  EXECUTE FUNCTION public.fn_sync_appointment_status_from_queue();

COMMENT ON FUNCTION public.fn_sync_appointment_status_from_queue() IS
  'Propaga in_progress/completed de queue_entries a su appointment. No cubre cancelled: eso lo define cancelQueueEntry.';
