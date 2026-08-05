-- 170_turnos_convivencia_fixes.sql
-- ---------------------------------------------------------------------------
-- Correcciones a la convivencia turnos↔fila que introdujeron la 168 y la 169.
-- Salieron de una revisión adversarial del propio cambio.
--
-- (1) La app mobile (repo `Monaco-mobile`, MISMO proyecto Supabase) cancela
--     turnos con la anon key: `appointments_repository.dart:100` llama a
--     `cancel_appointment_by_token`. El REVOKE de la 168 —cuyo comentario decía
--     "todas las llamadas del repo salen de 'use server'", cierto para ESTE
--     repo— le rompió la cancelación. Es un endpoint por capability (exige el
--     token secreto de 24 chars y respeta la ventana de cancelación), así que
--     exponerlo a anon es el diseño.
--
-- (2) El trigger de la 169 no cubría `cancelled` porque `cancelQueueEntry`
--     (queue.ts) ya pasa el turno a `no_show`. Pero no es el único camino: el
--     cron `expire_stale_queue_entries()` (mig 139, cada 10 min) hace
--     `UPDATE queue_entries SET status='cancelled'` en SQL crudo sobre todo
--     `waiting` viejo, sin mirar `is_appointment`. Un turno barrido por ahí
--     quedaba en `checked_in` para siempre. El UPDATE nuevo es idempotente.
--
-- (3) EL IMPORTANTE. Los dos caminos de turnos de `claim_next_for_barber`
--     decidían con `priority_order`, y eso deja de significar "la hora del
--     turno" en cuanto la entrada fue ADOPTADA de un walk-in: `check_in_appointment`
--     escribe `LEAST(priority_order, hora_del_turno)` para no quitarle el lugar
--     que el cliente ya tenía en la fila. Con eso, [A] leía "su hora llegó"
--     donde en realidad decía "ya está en el local", y le daba precedencia
--     absoluta sobre walk-ins que habían llegado antes.
--
--       12:30 walk-in A1 · 12:45 walk-in A2 · 13:00 se anota C (turno 15:00)
--       13:02 el mostrador registra el turno de C → adopción → priority 13:00
--       13:05 el barbero toca Atender → [A] veía 13:00 <= 13:05 → atendía a C
--
--     C se atendía 1h55m antes de su hora salteando a dos personas que estaban
--     perfectamente atendibles: exactamente lo contrario de lo que documenta la
--     168 y de lo que el dueño pidió (que la fila no cambie de comportamiento).
--     Ahora los dos caminos leen la hora REAL (`lower(appointments.time_range)`)
--     y `priority_order` queda siendo lo que es: la clave FIFO.
--
--     Además [B] no tenía cota temporal: tomaba el turno presente más temprano
--     de la cola, que no es necesariamente el que activó la ventana de
--     protección. Un cliente de las 19:00 que llegaba a las 13:00 se comía el
--     hueco reservado para el de las 14:30. Ahora [B] sólo atiende turnos que
--     ya están dentro de la ventana.
--
-- Verificado contra prod en transacciones revertidas:
--   turno en 5 min  + walk-in de hace 40  -> atiende el TURNO
--   turno en 90 min + walk-in de hace 40  -> atiende el WALK-IN
--   turno en 2 h (entrada adoptada) + 2 walk-ins anteriores -> atiende el WALK-IN
--   fila sin turnos                       -> sin cambios
-- ---------------------------------------------------------------------------

-- (1) Restaurar el grant a anon: la app mobile cancela con la anon key.
GRANT EXECUTE ON FUNCTION public.cancel_appointment_by_token(text) TO anon, authenticated;

-- (2) El trigger ahora cubre tambien `cancelled` (cron expire_stale_queue_entries).
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

  ELSIF NEW.status = 'cancelled' THEN
    UPDATE appointments
    SET status = 'no_show'
    WHERE id = NEW.appointment_id
      AND status IN ('scheduled','confirmed','checked_in');
  END IF;

  RETURN NEW;
END;
$function$;

-- (3) Los dos caminos de turnos leen la hora REAL del turno, no priority_order.
CREATE OR REPLACE FUNCTION public.claim_next_for_barber(p_barber_id uuid, p_branch_id uuid, p_preferred_entry_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(entry_id uuid, is_break boolean, was_dynamic boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_entry_id UUID;
  v_entry_barber_id UUID;
  v_entry_priority TIMESTAMPTZ;
  v_entry_is_dynamic BOOLEAN;
  v_branch_tz TEXT;
  v_org_id UUID;
  v_today DATE;
  v_walkin_mode TEXT;
  v_buffer_minutes INTEGER;
  v_next_appt_start TIMESTAMPTZ;
  v_protection_window INTERVAL;
  v_avg_service_minutes INTEGER := 45;
  v_pending_break_id UUID;
  v_pending_break_priority TIMESTAMPTZ;
  v_appt_entry_id UUID;
  v_serve_present_appt BOOLEAN := false;
BEGIN
  IF EXISTS (
    SELECT 1 FROM queue_entries
    WHERE barber_id = p_barber_id AND branch_id = p_branch_id
      AND is_break = true AND status = 'in_progress'
  ) THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM queue_entries
    WHERE barber_id = p_barber_id AND branch_id = p_branch_id
      AND is_break = false AND status = 'in_progress'
  ) THEN
    RETURN;
  END IF;

  SELECT b.timezone, b.organization_id INTO v_branch_tz, v_org_id
  FROM branches b WHERE b.id = p_branch_id;
  v_branch_tz := COALESCE(v_branch_tz, 'America/Argentina/Buenos_Aires');
  v_today := (v_now AT TIME ZONE v_branch_tz)::DATE;

  SELECT id, priority_order
    INTO v_pending_break_id, v_pending_break_priority
  FROM queue_entries
  WHERE barber_id = p_barber_id AND branch_id = p_branch_id
    AND is_break = true AND status = 'waiting'
  ORDER BY priority_order ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_pending_break_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM queue_entries
    WHERE barber_id = p_barber_id AND branch_id = p_branch_id
      AND status = 'waiting' AND is_break = false
      AND priority_order < v_pending_break_priority
  ) THEN
    UPDATE queue_entries
    SET status = 'in_progress', started_at = v_now
    WHERE id = v_pending_break_id AND status = 'waiting';

    RETURN QUERY SELECT v_pending_break_id, true, false;
    RETURN;
  END IF;

  -- Ventana de proteccion: se calcula SIEMPRE, porque [B] la usa como cota.
  SELECT s.buffer_minutes INTO v_buffer_minutes
  FROM appointment_settings s
  WHERE s.organization_id = v_org_id
    AND (s.branch_id = p_branch_id OR s.branch_id IS NULL)
  ORDER BY s.branch_id NULLS LAST
  LIMIT 1;
  v_buffer_minutes := COALESCE(v_buffer_minutes, 10);
  v_protection_window := ((v_avg_service_minutes + v_buffer_minutes) || ' minutes')::INTERVAL;

  -- [A] TURNOS: el turno cuya HORA REAL ya llego tiene precedencia absoluta.
  SELECT q.id INTO v_appt_entry_id
  FROM queue_entries q
  JOIN appointments a ON a.id = q.appointment_id
  WHERE q.branch_id = p_branch_id
    AND q.barber_id = p_barber_id
    AND q.status = 'waiting'
    AND q.is_break = false
    AND q.is_appointment = true
    AND lower(a.time_range) <= v_now
    AND (v_pending_break_priority IS NULL OR q.priority_order < v_pending_break_priority)
  ORDER BY lower(a.time_range) ASC
  LIMIT 1
  FOR UPDATE OF q SKIP LOCKED;

  IF v_appt_entry_id IS NOT NULL THEN
    UPDATE queue_entries
    SET status = 'in_progress', started_at = v_now
    WHERE id = v_appt_entry_id AND status = 'waiting';

    UPDATE appointments a
    SET status = 'in_progress'
    FROM queue_entries q
    WHERE q.id = v_appt_entry_id
      AND a.id = q.appointment_id
      AND a.status IN ('scheduled','confirmed','checked_in');

    RETURN QUERY SELECT v_appt_entry_id, false, false;
    RETURN;
  END IF;

  SELECT walkin_mode INTO v_walkin_mode
  FROM appointment_staff WHERE staff_id = p_barber_id;

  IF v_walkin_mode = 'appointments_only' THEN
    v_serve_present_appt := true;
  ELSE
    SELECT (a.appointment_date + a.start_time) AT TIME ZONE v_branch_tz
      INTO v_next_appt_start
    FROM appointments a
    WHERE a.barber_id = p_barber_id
      AND a.branch_id = p_branch_id
      AND a.appointment_date = v_today
      AND a.status IN ('confirmed', 'checked_in')
      AND ((a.appointment_date + a.start_time) AT TIME ZONE v_branch_tz) > v_now
    ORDER BY (a.appointment_date + a.start_time) AT TIME ZONE v_branch_tz ASC
    LIMIT 1;

    IF v_next_appt_start IS NOT NULL
       AND v_next_appt_start <= v_now + v_protection_window THEN
      v_serve_present_appt := true;
    END IF;
  END IF;

  -- [B] El walk-in no entra antes del turno inminente: si ese cliente ya esta
  --     presente se lo atiende en vez de dejar al barbero ocioso. La cota
  --     temporal evita que un turno de dentro de 5 horas, cuyo cliente llego
  --     tempranisimo, se coma el hueco reservado para el que viene ahora.
  IF v_serve_present_appt THEN
    SELECT q.id INTO v_appt_entry_id
    FROM queue_entries q
    JOIN appointments a ON a.id = q.appointment_id
    WHERE q.branch_id = p_branch_id
      AND q.barber_id = p_barber_id
      AND q.status = 'waiting'
      AND q.is_break = false
      AND q.is_appointment = true
      AND lower(a.time_range) <= v_now + v_protection_window
      AND (v_pending_break_priority IS NULL OR q.priority_order < v_pending_break_priority)
    ORDER BY lower(a.time_range) ASC
    LIMIT 1
    FOR UPDATE OF q SKIP LOCKED;

    IF v_appt_entry_id IS NOT NULL THEN
      UPDATE queue_entries
      SET status = 'in_progress', started_at = v_now
      WHERE id = v_appt_entry_id AND status = 'waiting';

      UPDATE appointments a
      SET status = 'in_progress'
      FROM queue_entries q
      WHERE q.id = v_appt_entry_id
        AND a.id = q.appointment_id
        AND a.status IN ('scheduled','confirmed','checked_in');

      RETURN QUERY SELECT v_appt_entry_id, false, false;
    END IF;

    RETURN;
  END IF;

  IF p_preferred_entry_id IS NOT NULL THEN
    SELECT id, priority_order, barber_id, is_dynamic
      INTO v_entry_id, v_entry_priority, v_entry_barber_id, v_entry_is_dynamic
    FROM queue_entries
    WHERE id = p_preferred_entry_id
      AND branch_id = p_branch_id
      AND status = 'waiting'
      AND is_break = false
      AND is_appointment = false
      AND (barber_id = p_barber_id OR barber_id IS NULL OR is_dynamic = true)
      AND (checked_in_at AT TIME ZONE v_branch_tz)::DATE = v_today
    FOR UPDATE SKIP LOCKED;

    IF v_entry_id IS NOT NULL THEN
      IF v_pending_break_priority IS NOT NULL
         AND v_entry_priority >= v_pending_break_priority THEN
        RETURN;
      END IF;

      UPDATE queue_entries
      SET barber_id = p_barber_id, is_dynamic = false,
          status = 'in_progress', started_at = v_now
      WHERE id = v_entry_id AND status = 'waiting';

      RETURN QUERY SELECT v_entry_id, false, COALESCE(v_entry_is_dynamic, v_entry_barber_id IS NULL);
      RETURN;
    END IF;
  END IF;

  SELECT id, priority_order, barber_id, is_dynamic
    INTO v_entry_id, v_entry_priority, v_entry_barber_id, v_entry_is_dynamic
  FROM queue_entries
  WHERE branch_id = p_branch_id
    AND status = 'waiting'
    AND is_break = false
    AND is_appointment = false
    AND (barber_id = p_barber_id OR barber_id IS NULL OR is_dynamic = true)
    AND (checked_in_at AT TIME ZONE v_branch_tz)::DATE = v_today
    AND (v_pending_break_priority IS NULL OR priority_order < v_pending_break_priority)
  ORDER BY priority_order ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_entry_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE queue_entries
  SET barber_id = p_barber_id, is_dynamic = false,
      status = 'in_progress', started_at = v_now
  WHERE id = v_entry_id AND status = 'waiting';

  RETURN QUERY SELECT v_entry_id, false, COALESCE(v_entry_is_dynamic, v_entry_barber_id IS NULL);
END;
$function$;
