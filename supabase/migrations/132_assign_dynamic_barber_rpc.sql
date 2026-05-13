-- ============================================================================
-- 132_assign_dynamic_barber_rpc.sql
--
-- Convergencia de "fila dinámica" entre tablets.
--
-- Antes: cuando un cliente elegía "Menor espera" en el kiosko, el server
-- guardaba `queue_entries.barber_id = NULL` con `is_dynamic = true`, y CADA
-- tablet de barbero predecía localmente quién atendería al cliente via
-- `assignDynamicBarbers`. Si una tablet perdía el evento Realtime (tab
-- dormido, WebSocket caído, etc.), su predicción local divergía: dos paneles
-- mostraban DOS barberos distintos para el MISMO cliente, y el botón
-- "Atender" no aparecía en ninguno.
--
-- Ahora: `assign_dynamic_barber(branch_id)` corre server-side al momento del
-- check-in y devuelve el barbero óptimo. El server lo guarda como
-- `barber_id` con `is_dynamic = true`. Todas las tablets leen el MISMO valor
-- de DB → todas muestran el mismo barbero → el predicho ve la entry en su
-- "Mi fila" con el botón Atender.
--
-- Algoritmo (acordado con el dueño del negocio):
--   1. Elegibles: del branch, activos, role barber o is_also_barber, NO
--      hidden_from_checkin, con clock_in registrado hoy (TZ del branch) y
--      sin ghost de descanso in_progress.
--   2. Disponibles: elegibles que NO están atendiendo en este momento
--      (sin queue_entries in_progress no-break).
--   3. Entre disponibles: el de MENOS cortes hoy; tiebreak por last_completed
--      más viejo (longest idle); tiebreak final por id (estabilidad).
--   4. Si nadie disponible: el de last_completed más viejo entre elegibles.
--
-- Si no hay elegibles, devuelve NULL → el server cae al comportamiento previo
-- (entry con barber_id=NULL).
--
-- Idempotencia: CREATE OR REPLACE FUNCTION + GRANT EXECUTE.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.assign_dynamic_barber(p_branch_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch_tz TEXT;
  v_today_start TIMESTAMPTZ;
  v_picked UUID;
BEGIN
  SELECT COALESCE(b.timezone, 'America/Argentina/Buenos_Aires')
    INTO v_branch_tz
  FROM branches b WHERE b.id = p_branch_id;

  IF v_branch_tz IS NULL THEN
    RETURN NULL;
  END IF;

  v_today_start := ((NOW() AT TIME ZONE v_branch_tz)::DATE)::TIMESTAMP
                   AT TIME ZONE v_branch_tz;

  WITH eligible AS (
    SELECT s.id
    FROM staff s
    WHERE s.branch_id = p_branch_id
      AND s.is_active = true
      AND COALESCE(s.hidden_from_checkin, false) = false
      AND (s.role = 'barber' OR s.is_also_barber = true)
      -- Último evento de asistencia de hoy debe ser clock_in.
      -- (NULL si no fichó hoy → excluido por != 'clock_in'.)
      AND (
        SELECT al.action_type
        FROM attendance_logs al
        WHERE al.staff_id = s.id
          AND al.branch_id = p_branch_id
          AND al.recorded_at >= v_today_start
        ORDER BY al.recorded_at DESC
        LIMIT 1
      ) = 'clock_in'
      -- Sin ghost de descanso in_progress.
      AND NOT EXISTS (
        SELECT 1 FROM queue_entries q
        WHERE q.barber_id = s.id
          AND q.branch_id = p_branch_id
          AND q.status = 'in_progress'
          AND q.is_break = true
      )
  ),
  busy AS (
    SELECT DISTINCT q.barber_id AS id
    FROM queue_entries q
    WHERE q.branch_id = p_branch_id
      AND q.status = 'in_progress'
      AND q.is_break = false
      AND q.barber_id IS NOT NULL
  ),
  metrics AS (
    SELECT
      e.id,
      e.id IN (SELECT id FROM busy) AS is_busy,
      (SELECT COUNT(*) FROM visits v
         WHERE v.branch_id = p_branch_id
           AND v.barber_id = e.id
           AND v.completed_at >= v_today_start) AS cuts_today,
      (SELECT MAX(v.completed_at) FROM visits v
         WHERE v.branch_id = p_branch_id
           AND v.barber_id = e.id) AS last_completed
    FROM eligible e
  ),
  pick_available AS (
    SELECT id FROM metrics
    WHERE NOT is_busy
    ORDER BY
      cuts_today ASC,
      COALESCE(last_completed, 'epoch'::timestamptz) ASC,
      id ASC
    LIMIT 1
  ),
  pick_busy AS (
    SELECT id FROM metrics
    WHERE is_busy
    ORDER BY
      COALESCE(last_completed, 'epoch'::timestamptz) ASC,
      id ASC
    LIMIT 1
  )
  SELECT COALESCE(
    (SELECT id FROM pick_available),
    (SELECT id FROM pick_busy)
  ) INTO v_picked;

  RETURN v_picked;
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_dynamic_barber(uuid)
  TO anon, authenticated;

COMMENT ON FUNCTION public.assign_dynamic_barber(uuid) IS
'Devuelve el id del barbero óptimo para una entrada dinámica en el branch.
Algoritmo: elegibles (activos, clocked-in hoy, no en descanso) →
prefiere disponibles (no in_progress) → entre ellos menor cortes hoy y
tiebreak por longest idle → si nadie disponible, longest idle entre
elegibles. NULL si no hay elegibles.';


-- ============================================================================
-- claim_next_for_barber: permitir reclamar entradas is_dynamic=true asignadas
-- a OTRO barbero.
--
-- Antes: el WHERE filtraba `(barber_id = self OR barber_id IS NULL)`.
-- Después de la migración 132, las entradas dinámicas tienen `barber_id`
-- seteado al barbero predicho → bajo el filtro anterior, sólo el predicho
-- podía reclamarlas, dejando "stuck" al cliente si el predicho se ocupaba.
--
-- Ahora: agregamos `OR is_dynamic = true` para que cualquier barbero pueda
-- reclamar una entrada dinámica. El predicho la verá primero en su "Mi fila"
-- (la asignación lo ranquea como dueño), pero si otro pulsa Próximo primero,
-- FOR UPDATE SKIP LOCKED garantiza atomicidad: el primero gana.
--
-- También extiende `was_dynamic` para incluir entradas que ya tenían
-- barber_id pero con is_dynamic=true (no sólo las que tenían barber_id=NULL).
-- ============================================================================

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
BEGIN
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

  SELECT walkin_mode INTO v_walkin_mode
  FROM appointment_staff WHERE staff_id = p_barber_id;
  IF v_walkin_mode = 'appointments_only' THEN
    RETURN;
  END IF;

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

  IF p_preferred_entry_id IS NOT NULL THEN
    SELECT id, priority_order, barber_id, is_dynamic
      INTO v_entry_id, v_entry_priority, v_entry_barber_id, v_entry_is_dynamic
    FROM queue_entries
    WHERE id = p_preferred_entry_id
      AND branch_id = p_branch_id
      AND status = 'waiting'
      AND is_break = false
      AND is_appointment = false
      -- (mig 132) is_dynamic=true permite re-claim por otro barbero.
      AND (barber_id = p_barber_id OR barber_id IS NULL OR is_dynamic = true)
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

      -- (mig 132) was_dynamic = true si la entry venía con is_dynamic=true,
      -- aunque tuviera barber_id seteado (assignación predictiva pre-claim).
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
    -- (mig 132) is_dynamic=true permite re-claim por otro barbero.
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
  SET barber_id = p_barber_id,
      is_dynamic = false,
      status = 'in_progress',
      started_at = v_now
  WHERE id = v_entry_id
    AND status = 'waiting';

  RETURN QUERY SELECT v_entry_id, false, COALESCE(v_entry_is_dynamic, v_entry_barber_id IS NULL);
END;
$function$;
