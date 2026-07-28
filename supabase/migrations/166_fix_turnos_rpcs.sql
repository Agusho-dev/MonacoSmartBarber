-- 166_fix_turnos_rpcs.sql
-- ---------------------------------------------------------------------------
-- Repara las tres RPCs del circuito de turnos del KIOSKO, que estaban caídas
-- en producción desde el día uno. Verificado contra prod (gzsfoqpxvnwmvngfoqqk)
-- antes de escribir esto:
--
--   POST /rpc/lookup_appointment_by_phone -> 42703 "column s.name does not exist"
--   POST /rpc/get_available_slots         -> 42703 "column ab.staff_id does not exist"
--   check_in_appointment                  -> INSERT sin `position` (NOT NULL sin default)
--
-- O sea: en modo `appointments`/`hybrid` ningún cliente podía encontrar su
-- turno en la tablet, ni reservar, ni registrar su llegada. Nunca se notó
-- porque todas las sucursales productivas están en `walk_in`.
--
-- Estas funciones se crearon a mano en las migraciones fantasma 119-122 (que
-- nunca se commitearon: el repo salta de 118 a 123). Los cuerpos de acá salen
-- del dump real de prod en db-export/schema/07_functions.sql.
-- ---------------------------------------------------------------------------

-- ── 1. lookup_appointment_by_phone ──────────────────────────────────────────
-- Fixes:
--   a) s.name -> s.full_name  (la columna de `staff` es full_name; era 42703)
--   b) CURRENT_DATE (UTC) -> fecha en la TZ de la sucursal. Después de las
--      21:00 en Argentina el kiosko buscaba los turnos de MAÑANA.
--   c) match de teléfono por últimos 10 dígitos, igual que la mig 149/150.
--      La igualdad de dígitos completos hacía que "1122334455" no matcheara
--      contra "541122334455" y el cliente "no tenía turno".
--   d) jsonb_agg con ORDER BY interno (el ORDER BY suelto no ordenaba nada).

CREATE OR REPLACE FUNCTION public.lookup_appointment_by_phone(p_branch_id uuid, p_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org_id uuid;
  v_tz text;
  v_today date;
  v_normalized text;
  v_digits10 text;
  v_appt jsonb;
BEGIN
  SELECT organization_id, COALESCE(timezone, 'America/Argentina/Buenos_Aires')
    INTO v_org_id, v_tz
  FROM branches WHERE id = p_branch_id AND is_active;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('found', false, 'error', 'BRANCH_NOT_FOUND');
  END IF;

  v_today := (now() AT TIME ZONE v_tz)::date;

  v_normalized := normalize_phone_e164(p_phone);
  IF v_normalized IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  v_digits10 := right(regexp_replace(v_normalized, '\D', '', 'g'), 10);
  IF length(v_digits10) < 10 THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT jsonb_build_object(
    'id', a.id,
    'starts_at', lower(a.time_range),
    'ends_at', upper(a.time_range),
    'barber_id', a.barber_id,
    'barber_name', s.full_name,
    'service_id', a.service_id,
    'duration_minutes', a.duration_minutes,
    'status', a.status,
    'client_id', a.client_id,
    'client_name', c.name,
    'client_phone', c.phone,
    'services', (
      SELECT jsonb_agg(
               jsonb_build_object('id', sv.id, 'name', sv.name, 'duration', sv.duration_minutes)
               ORDER BY aps.sort_order
             )
      FROM appointment_services aps
      JOIN services sv ON sv.id = aps.service_id
      WHERE aps.appointment_id = a.id
    )
  ) INTO v_appt
  FROM appointments a
  JOIN clients c ON c.id = a.client_id
  LEFT JOIN staff s ON s.id = a.barber_id
  WHERE a.branch_id = p_branch_id
    AND a.organization_id = v_org_id
    AND a.appointment_date = v_today
    AND a.status IN ('scheduled','confirmed')
    AND right(regexp_replace(c.phone, '\D', '', 'g'), 10) = v_digits10
  ORDER BY a.start_time ASC
  LIMIT 1;

  IF v_appt IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object('found', true, 'appointment', v_appt);
END;
$function$;

-- ── 2. check_in_appointment ─────────────────────────────────────────────────
-- Fix: el INSERT en queue_entries omitía `position`, que es NOT NULL sin
-- default -> toda confirmación de llegada moría con 23502. Se calcula con
-- next_queue_position(), la misma función TZ-aware que usa el kiosko walk-in
-- (mig 135), así el turno se intercala en la fila con la numeración correcta.

CREATE OR REPLACE FUNCTION public.check_in_appointment(p_appointment_id uuid, p_staff_id_assign uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_appt appointments%ROWTYPE;
  v_settings appointment_settings%ROWTYPE;
  v_starts_at timestamptz;
  v_tolerance int;
  v_queue_entry_id uuid;
  v_final_staff uuid;
BEGIN
  SELECT * INTO v_appt FROM appointments WHERE id = p_appointment_id FOR UPDATE;

  IF v_appt.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
  END IF;

  -- Idempotencia: si ya se hizo check-in, devolver la entry existente en vez
  -- de fallar. El kiosko puede reintentar por doble tap o red intermitente.
  IF v_appt.status = 'checked_in' AND v_appt.queue_entry_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'queue_entry_id', v_appt.queue_entry_id,
      'staff_id', v_appt.barber_id,
      'already_checked_in', true
    );
  END IF;

  IF v_appt.status NOT IN ('scheduled','confirmed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS');
  END IF;

  -- Resolver staff: si appointment.barber_id es NULL ("cualquiera"), usar p_staff_id_assign
  v_final_staff := COALESCE(v_appt.barber_id, p_staff_id_assign);
  IF v_final_staff IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'STAFF_REQUIRED');
  END IF;

  -- Validar tolerancia (no permitir check-in muy adelantado/tardío)
  SELECT * INTO v_settings FROM appointment_settings
  WHERE organization_id = v_appt.organization_id
    AND (branch_id = v_appt.branch_id OR branch_id IS NULL)
  ORDER BY branch_id NULLS LAST LIMIT 1;

  v_tolerance := COALESCE(v_settings.no_show_tolerance_minutes, 15);
  v_starts_at := lower(v_appt.time_range);

  IF v_starts_at > now() + INTERVAL '1 hour' THEN
    RETURN jsonb_build_object('success', false, 'error', 'TOO_EARLY');
  END IF;

  IF v_starts_at < now() - (v_tolerance || ' minutes')::interval THEN
    RETURN jsonb_build_object('success', false, 'error', 'TOO_LATE');
  END IF;

  -- Crear queue_entry vinculado
  INSERT INTO queue_entries (
    organization_id, branch_id, client_id, barber_id, service_id,
    status, is_appointment, appointment_id, priority_order, "position"
  ) VALUES (
    v_appt.organization_id, v_appt.branch_id, v_appt.client_id, v_final_staff, v_appt.service_id,
    'waiting', true, v_appt.id, v_starts_at, next_queue_position(v_appt.branch_id)
  ) RETURNING id INTO v_queue_entry_id;

  -- Actualizar appointment
  UPDATE appointments
  SET status = 'checked_in',
      barber_id = v_final_staff,
      queue_entry_id = v_queue_entry_id
  WHERE id = p_appointment_id;

  RETURN jsonb_build_object('success', true, 'queue_entry_id', v_queue_entry_id, 'staff_id', v_final_staff);
END;
$function$;

-- ── 3. get_available_slots ──────────────────────────────────────────────────
-- Fixes:
--   a) ab.staff_id -> ab.barber_id (era 42703: la columna de appointment_blocks
--      se llama barber_id).
--   b) Los bloqueos con alcance amplio no bloqueaban nada: branch_id NULL
--      ("todas las sucursales") quedaba fuera del WHERE, y barber_id NULL
--      ("todos los barberos") nunca matcheaba en la comparación de igualdad.
--   c) La ventana de bloqueos miraba sólo `start_at` dentro del día: un
--      bloqueo que arrancaba ayer y seguía hoy se ignoraba. Ahora se compara
--      por solapamiento de rangos.
--   d) Se ofrecían horarios fuera del turno real del barbero: alcanzaba con
--      que tuviera UNA fila en staff_schedules ese día y después la grilla se
--      generaba sobre el horario completo del local. Ahora cada slot tiene que
--      caer dentro de alguno de sus bloques horarios.
--   e) Entraban barberos no habilitados para turnos: el LEFT JOIN a
--      appointment_staff no filtraba `is_active`.
--   f) Se ofrecían slots ya pasados cuando la fecha es hoy.
--
-- NOTA: esta RPC quedó como segundo motor de disponibilidad en paralelo al de
-- TypeScript (src/lib/actions/appointments.ts → getAvailableSlots), que es el
-- que usan la agenda, el turnero público y ahora también el kiosko. Se repara
-- para que no sea una mina, pero el motor canónico es el de TS.

CREATE OR REPLACE FUNCTION public.get_available_slots(p_branch_id uuid, p_date date, p_total_duration_minutes integer, p_staff_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(slot_start timestamp with time zone, available_staff_ids uuid[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org_id uuid;
  v_tz text;
  v_business_open time;
  v_business_close time;
  v_business_days int[];
  v_dow int;
  v_settings appointment_settings%ROWTYPE;
  v_step_minutes int;
  v_total_minutes int;
  v_open time;
  v_close time;
  v_days int[];
  v_min_start timestamptz;
BEGIN
  SELECT b.organization_id, COALESCE(b.timezone, 'America/Argentina/Buenos_Aires'),
         b.business_hours_open, b.business_hours_close, b.business_days
    INTO v_org_id, v_tz, v_business_open, v_business_close, v_business_days
  FROM branches b
  WHERE b.id = p_branch_id AND b.is_active;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'BRANCH_NOT_FOUND';
  END IF;

  -- day_of_week del proyecto: 0=Domingo .. 6=Sábado (igual que staff_schedules
  -- y appointment_days). EXTRACT(DOW) ya usa esa convención; ISODOW —lo que
  -- había antes— devuelve 7 para el domingo y nunca matcheaba.
  v_dow := EXTRACT(DOW FROM p_date)::int;

  -- Settings efectivos (override branch sobre org)
  SELECT * INTO v_settings FROM appointment_settings
  WHERE organization_id = v_org_id AND (branch_id = p_branch_id OR branch_id IS NULL)
  ORDER BY branch_id NULLS LAST LIMIT 1;

  -- La ventana de turnos manda sobre el horario comercial del local.
  v_open  := COALESCE(v_settings.appointment_hours_open,  v_business_open);
  v_close := COALESCE(v_settings.appointment_hours_close, v_business_close);
  v_days  := COALESCE(v_settings.appointment_days, v_business_days);

  IF v_open IS NULL OR v_close IS NULL OR v_days IS NULL THEN
    RETURN;
  END IF;

  IF NOT (v_dow = ANY(v_days)) THEN
    RETURN;
  END IF;

  v_step_minutes  := GREATEST(COALESCE(v_settings.slot_interval_minutes, 15), 1);
  v_total_minutes := p_total_duration_minutes + COALESCE(v_settings.buffer_minutes, 0);

  -- Anticipación mínima para reservar (sólo aplica si la fecha es hoy).
  v_min_start := now() + (COALESCE(v_settings.lead_time_minutes, 0) || ' minutes')::interval;

  RETURN QUERY
  WITH staff_candidates AS (
    SELECT DISTINCT s.id AS staff_id
    FROM staff s
    JOIN appointment_staff aps
      ON aps.staff_id = s.id
     AND aps.is_active
     AND aps.organization_id = v_org_id
    WHERE s.organization_id = v_org_id
      AND s.is_active
      AND (p_staff_id IS NULL OR s.id = p_staff_id)
      AND EXISTS (
        SELECT 1 FROM staff_schedules sch
        WHERE sch.staff_id = s.id
          AND sch.day_of_week = v_dow
          AND sch.is_active
          AND (sch.branch_id = p_branch_id OR sch.branch_id IS NULL)
      )
      AND NOT EXISTS (
        SELECT 1 FROM staff_schedule_exceptions sse
        WHERE sse.staff_id = s.id
          AND sse.exception_date = p_date
          AND COALESCE(sse.is_absent, true)
          AND (sse.exception_type IS NULL OR sse.exception_type IN ('absence','vacation','closed'))
      )
  ),
  slot_times AS (
    SELECT generate_series(
      (p_date + v_open)::timestamp AT TIME ZONE v_tz,
      ((p_date + v_close)::timestamp - (v_total_minutes || ' minutes')::interval) AT TIME ZONE v_tz,
      (v_step_minutes || ' minutes')::interval
    ) AS s_start
  ),
  busy_appointments AS (
    SELECT a.barber_id, a.time_range
    FROM appointments a
    WHERE a.branch_id = p_branch_id
      AND a.appointment_date = p_date
      AND a.status IN ('confirmed','checked_in','in_progress')
      AND a.barber_id IS NOT NULL
  ),
  busy_blocks AS (
    SELECT ab.barber_id, tstzrange(ab.start_at, ab.end_at, '[)') AS block_range
    FROM appointment_blocks ab
    WHERE ab.organization_id = v_org_id
      AND (ab.branch_id IS NULL OR ab.branch_id = p_branch_id)
      AND ab.start_at < ((p_date + 1)::timestamp AT TIME ZONE v_tz)
      AND ab.end_at   > ((p_date)::timestamp AT TIME ZONE v_tz)
  )
  SELECT
    st.s_start AS slot_start,
    array_agg(sc.staff_id ORDER BY sc.staff_id) AS available_staff_ids
  FROM slot_times st
  CROSS JOIN staff_candidates sc
  WHERE st.s_start >= v_min_start
  -- El slot completo tiene que caer dentro de algún bloque horario del barbero.
  AND EXISTS (
    SELECT 1 FROM staff_schedules sch
    WHERE sch.staff_id = sc.staff_id
      AND sch.day_of_week = v_dow
      AND sch.is_active
      AND (sch.branch_id = p_branch_id OR sch.branch_id IS NULL)
      AND (st.s_start AT TIME ZONE v_tz)::time >= sch.start_time
      AND ((st.s_start + (v_total_minutes || ' minutes')::interval) AT TIME ZONE v_tz)::time <= sch.end_time
  )
  AND NOT EXISTS (
    SELECT 1 FROM busy_appointments ba
    WHERE ba.barber_id = sc.staff_id
      AND ba.time_range && tstzrange(st.s_start, st.s_start + (v_total_minutes||' min')::interval, '[)')
  )
  AND NOT EXISTS (
    SELECT 1 FROM busy_blocks bb
    WHERE (bb.barber_id IS NULL OR bb.barber_id = sc.staff_id)
      AND bb.block_range && tstzrange(st.s_start, st.s_start + (v_total_minutes||' min')::interval, '[)')
  )
  GROUP BY st.s_start
  ORDER BY st.s_start;
END;
$function$;

COMMENT ON FUNCTION public.lookup_appointment_by_phone(uuid, text) IS
  'Kiosko: busca el turno de hoy (TZ de la sucursal) por teléfono, matcheando por últimos 10 dígitos.';
COMMENT ON FUNCTION public.check_in_appointment(uuid, uuid) IS
  'Kiosko/panel: registra la llegada de un turno creando su queue_entry. Idempotente si ya se hizo check-in.';
COMMENT ON FUNCTION public.get_available_slots(uuid, date, integer, uuid) IS
  'Disponibilidad server-side. Motor secundario: el canónico es getAvailableSlots en src/lib/actions/appointments.ts.';
