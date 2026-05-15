-- 134_decouple_dynamic_pool.sql
-- ---------------------------------------------------------------------------
-- FIX ESTRUCTURAL: desacoplar el binding sticky de los clientes dinámicos.
--
-- Contexto (auditoría + Monte Carlo, ver docs/sim/fila_montecarlo.py):
--   El modelo mig 132/133 pre-asignaba cada dinámico a un barbero en el
--   check-in (compute_fair_barber) y lo dejaba "sticky-while-present":
--   claim_next_for_barber solo permitía robar un dinámico si su barbero
--   pre-asignado NO estaba presente. Un barbero presente pero ocupado
--   congelaba al dinámico => barbero libre + cliente dinámico esperando.
--   Monte Carlo (43.200 turnos): 20–71 min/turno de barbero ocioso con
--   dinámico esperando, en 71–98% de los turnos. Violaba el invariante
--   "si hay dinámicos, ningún barbero desocupado".
--
-- Fix: pool compartido NO bloqueante. Un dinámico (is_dynamic = true,
--   normalmente barber_id IS NULL) lo puede reclamar CUALQUIER barbero
--   libre, FIFO por priority_order. Los específicos (is_dynamic = false)
--   siguen restringidos a su barbero. Sin fairness gate — la atomicidad
--   la garantiza FOR UPDATE SKIP LOCKED (igual que mig 131).
--
-- Compatibilidad: el predicado incluye `OR is_dynamic = true`, así que
--   filas legacy con barber_id pre-asignado (mig 132/133) también caen al
--   pool sin necesidad de redeploy del dashboard. La normalización de datos
--   de abajo limpia las filas en vuelo a barber_id = NULL.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_next_for_barber(
  p_barber_id uuid,
  p_branch_id uuid,
  p_preferred_entry_id uuid DEFAULT NULL::uuid
)
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
BEGIN
  -- Guard 0a: barbero en descanso activo -> no recibe nada
  IF EXISTS (
    SELECT 1 FROM queue_entries
    WHERE barber_id = p_barber_id
      AND branch_id = p_branch_id
      AND is_break = true
      AND status = 'in_progress'
  ) THEN
    RETURN;
  END IF;

  SELECT b.timezone, b.organization_id INTO v_branch_tz, v_org_id
  FROM branches b WHERE b.id = p_branch_id;
  v_branch_tz := COALESCE(v_branch_tz, 'America/Argentina/Buenos_Aires');
  v_today := (v_now AT TIME ZONE v_branch_tz)::DATE;

  -- Guard 0b: ghost de descanso listo (sin clientes asignados antes) -> arranca
  SELECT id, priority_order
    INTO v_pending_break_id, v_pending_break_priority
  FROM queue_entries
  WHERE barber_id = p_barber_id
    AND branch_id = p_branch_id
    AND is_break = true
    AND status = 'waiting'
  ORDER BY priority_order ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_pending_break_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM queue_entries
    WHERE barber_id = p_barber_id
      AND branch_id = p_branch_id
      AND status = 'waiting'
      AND is_break = false
      AND priority_order < v_pending_break_priority
  ) THEN
    UPDATE queue_entries
    SET status = 'in_progress', started_at = v_now
    WHERE id = v_pending_break_id
      AND status = 'waiting';

    RETURN QUERY SELECT v_pending_break_id, true, false;
    RETURN;
  END IF;

  -- Guard 1: barbero solo-turnos no toma walk-ins
  SELECT walkin_mode INTO v_walkin_mode
  FROM appointment_staff WHERE staff_id = p_barber_id;
  IF v_walkin_mode = 'appointments_only' THEN
    RETURN;
  END IF;

  -- Guard 2: turno inminente -> proteger la ventana del barbero
  SELECT s.buffer_minutes INTO v_buffer_minutes
  FROM appointment_settings s
  WHERE s.organization_id = v_org_id AND s.branch_id IS NULL;
  v_buffer_minutes := COALESCE(v_buffer_minutes, 10);
  v_protection_window := ((v_avg_service_minutes + v_buffer_minutes) || ' minutes')::INTERVAL;

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
    RETURN;
  END IF;

  -- Path preferred (el barbero tocó un entry puntual en su panel).
  -- Pool NO bloqueante: específico mío | dinámico de pool (NULL) |
  -- dinámico legacy con barber_id viejo (is_dynamic = true) — robable por
  -- cualquier barbero libre. Sin is_barber_present_now (mig 134).
  IF p_preferred_entry_id IS NOT NULL THEN
    SELECT id, priority_order, barber_id, is_dynamic
      INTO v_entry_id, v_entry_priority, v_entry_barber_id, v_entry_is_dynamic
    FROM queue_entries
    WHERE id = p_preferred_entry_id
      AND branch_id = p_branch_id
      AND status = 'waiting'
      AND is_break = false
      AND is_appointment = false
      AND (
        barber_id = p_barber_id
        OR barber_id IS NULL
        OR is_dynamic = true
      )
      AND (checked_in_at AT TIME ZONE v_branch_tz)::DATE = v_today
    FOR UPDATE SKIP LOCKED;

    IF v_entry_id IS NOT NULL THEN
      IF v_pending_break_priority IS NOT NULL
         AND v_entry_priority >= v_pending_break_priority THEN
        RETURN;
      END IF;

      UPDATE queue_entries
      SET barber_id = p_barber_id,
          is_dynamic = false,
          status = 'in_progress',
          started_at = v_now
      WHERE id = v_entry_id
        AND status = 'waiting';

      RETURN QUERY SELECT v_entry_id, false, COALESCE(v_entry_is_dynamic, v_entry_barber_id IS NULL);
      RETURN;
    END IF;
  END IF;

  -- Fallback FIFO global: el más viejo entre (mis específicos + pool dinámico),
  -- excluyendo los que están detrás de un ghost de descanso pendiente.
  SELECT id, priority_order, barber_id, is_dynamic
    INTO v_entry_id, v_entry_priority, v_entry_barber_id, v_entry_is_dynamic
  FROM queue_entries
  WHERE branch_id = p_branch_id
    AND status = 'waiting'
    AND is_break = false
    AND is_appointment = false
    AND (
      barber_id = p_barber_id
      OR barber_id IS NULL
      OR is_dynamic = true
    )
    AND (checked_in_at AT TIME ZONE v_branch_tz)::DATE = v_today
    AND (v_pending_break_priority IS NULL OR priority_order < v_pending_break_priority)
  ORDER BY priority_order ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_entry_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE queue_entries
  SET barber_id = p_barber_id,
      is_dynamic = false,
      status = 'in_progress',
      started_at = v_now
  WHERE id = v_entry_id
    AND status = 'waiting';

  RETURN QUERY SELECT v_entry_id, false, COALESCE(v_entry_is_dynamic, v_entry_barber_id IS NULL);
END;
$function$;

-- Normalización idempotente: limpiar los dinámicos en vuelo que el check-in
-- buggy (mig 132/133) pre-asignó a un barbero. Vuelven al pool (barber_id NULL).
-- Seguro: los específicos son is_dynamic=false; los in_progress también
-- (el claim setea is_dynamic=false); los ghosts son is_break=true.
UPDATE public.queue_entries
SET barber_id = NULL
WHERE is_dynamic = true
  AND status = 'waiting'
  AND is_break = false
  AND barber_id IS NOT NULL;
