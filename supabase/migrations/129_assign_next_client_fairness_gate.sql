-- =============================================================================
-- Migración 129: assign_next_client con fairness gate para clientes dinámicos
-- =============================================================================
-- Problema (mayo 2026): cuando hay 2-3 barberos desocupados simultáneamente
-- y llega un cliente dinámico (barber_id IS NULL), el cliente aparece visible
-- en "Mi fila" de varios paneles porque cada tablet ejecuta
-- `assignDynamicBarbers` (barber-utils.ts:222) localmente con datos
-- potencialmente stale. `dailyServiceCounts` y `lastCompletedAt` sólo se
-- refrescan al cambiar staff/schedules o reconectar el WebSocket — NO al
-- completar una visita en otra tablet. El RPC actual sólo arbitra la carrera
-- con `FOR UPDATE SKIP LOCKED`: gana el de la conexión más rápida, no el
-- "más justo" según los criterios del producto.
--
-- Esta migración añade un fairness gate ANTES del UPDATE de claim. Cuando el
-- entry candidato es dinámico (barber_id IS NULL en la fila), el RPC calcula
-- al barbero más justo entre los elegibles y bloquea a los demás. Si el
-- caller NO es el más justo, retorna NULL — la UI ya maneja ese caso vía
-- `handleStartService` ("El cliente fue tomado por otro barbero. Se asignó
-- el siguiente."). Cuando el entry ya está asignado al caller (entry
-- específica), el gate se saltea: el cliente es suyo desde antes.
--
-- Criterios del ranking (mismo orden que `sortByLoad` en barber-utils.ts:313):
--   1) load (entries waiting+in_progress asignados al barbero, ASC)
--   2) busy (1 si tiene corte activo, 0 si no — libres primero)
--   3) último corte completado ASC NULLS FIRST (más viejo gana)
--   4) cortes completados hoy ASC (menos cortes gana)
--   5) staff.id::text ASC (mismo desempate por UUID que el cliente)
--
-- Elegibilidad (replica el filter de assignDynamicBarbers:305-311):
--   - staff.is_active = true
--   - staff.hidden_from_checkin = false
--   - role = 'barber' OR is_also_barber = true
--   - clock-in (último attendance_log del día = 'clock_in')
--   - sin descanso activo (ghost in_progress + is_break)
--   - sin descanso "ready" (ghost waiting cuya priority no está tapada por
--     clientes asignados específicamente al barbero con priority menor)
--   - walkin_mode != 'appointments_only'
--   - sin turno inminente dentro de la ventana de protección
--   - no bloqueado por fin de turno (margen shift_end_margin_minutes)
-- =============================================================================

-- ── Helper: replica isBarberBlockedByShiftEnd (barber-utils.ts:174-220) ──────
CREATE OR REPLACE FUNCTION public.is_barber_blocked_by_shift_end(
  p_staff_id UUID,
  p_branch_tz TEXT,
  p_margin_minutes INTEGER DEFAULT 35
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now_local TIMESTAMP;
  v_now_time TIME;
  v_now_dow INTEGER;
  v_last_end TIME;
  v_block RECORD;
  v_next_start TIME;
  v_margin INTERVAL;
  v_has_blocks BOOLEAN;
BEGIN
  v_margin := (p_margin_minutes || ' minutes')::INTERVAL;
  v_now_local := (NOW() AT TIME ZONE p_branch_tz);
  v_now_time := v_now_local::TIME;
  v_now_dow := EXTRACT(DOW FROM v_now_local)::INTEGER;

  -- Sin schedules para hoy → no bloqueado (mismo default que el cliente)
  SELECT EXISTS(
    SELECT 1 FROM staff_schedules
    WHERE staff_id = p_staff_id
      AND day_of_week = v_now_dow
      AND is_active = true
  ) INTO v_has_blocks;

  IF NOT v_has_blocks THEN
    RETURN false;
  END IF;

  -- Si ya pasó el end_time del último bloque → bloqueado
  SELECT end_time INTO v_last_end
  FROM staff_schedules
  WHERE staff_id = p_staff_id
    AND day_of_week = v_now_dow
    AND is_active = true
  ORDER BY end_time DESC
  LIMIT 1;

  IF v_now_time >= v_last_end THEN
    RETURN true;
  END IF;

  -- Iterar bloques en orden cronológico. El primer bloque "vivo" decide.
  FOR v_block IN
    SELECT start_time, end_time
    FROM staff_schedules
    WHERE staff_id = p_staff_id
      AND day_of_week = v_now_dow
      AND is_active = true
    ORDER BY start_time
  LOOP
    -- Skip bloques ya terminados
    CONTINUE WHEN v_now_time >= v_block.end_time;

    -- ¿Estamos dentro del margen del fin de este bloque?
    IF (v_block.end_time - v_now_time) <= v_margin THEN
      -- Buscar el siguiente bloque del día
      SELECT start_time INTO v_next_start
      FROM staff_schedules
      WHERE staff_id = p_staff_id
        AND day_of_week = v_now_dow
        AND is_active = true
        AND start_time > v_block.end_time
      ORDER BY start_time
      LIMIT 1;

      IF v_next_start IS NULL THEN
        RETURN true;  -- último bloque dentro del margen → cierre real
      END IF;

      IF (v_next_start - v_block.end_time) > v_margin THEN
        RETURN true;  -- gap entre bloques mayor al margen → cierre real
      END IF;
    END IF;

    -- Bloque vivo y todavía con tiempo (o gap chico al siguiente).
    RETURN false;
  END LOOP;

  -- Fallback (no debería alcanzarse: si llegamos acá v_now_time pasó cada bloque
  -- pero el chequeo de "v_now_time >= v_last_end" arriba ya lo cubrió).
  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.is_barber_blocked_by_shift_end(UUID, TEXT, INTEGER) IS
  'Replica isBarberBlockedByShiftEnd de barber-utils.ts. true si el barbero está dentro del margen del fin del último bloque del día sin un próximo bloque útil, o si ya pasó su último end_time.';

-- ── Helper: barbero más justo para un dinámico ──────────────────────────────
CREATE OR REPLACE FUNCTION public.compute_fair_barber(
  p_branch_id UUID,
  p_branch_tz TEXT
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_today_start TIMESTAMPTZ;
  v_today DATE;
  v_org_id UUID;
  v_shift_end_margin INTEGER;
  v_buffer_minutes INTEGER;
  v_protection_window INTERVAL;
  v_avg_service_minutes INTEGER := 45;
  v_fair_id UUID;
BEGIN
  v_today_start := date_trunc('day', v_now AT TIME ZONE p_branch_tz) AT TIME ZONE p_branch_tz;
  v_today := (v_now AT TIME ZONE p_branch_tz)::DATE;

  SELECT organization_id INTO v_org_id FROM branches WHERE id = p_branch_id;

  SELECT shift_end_margin_minutes
    INTO v_shift_end_margin
  FROM app_settings
  WHERE organization_id = v_org_id;
  v_shift_end_margin := COALESCE(v_shift_end_margin, 35);

  SELECT buffer_minutes INTO v_buffer_minutes
  FROM appointment_settings
  WHERE organization_id = v_org_id AND branch_id IS NULL;
  v_buffer_minutes := COALESCE(v_buffer_minutes, 10);
  v_protection_window := ((v_avg_service_minutes + v_buffer_minutes) || ' minutes')::INTERVAL;

  WITH candidates AS (
    SELECT s.id
    FROM staff s
    WHERE s.branch_id = p_branch_id
      AND s.is_active = true
      AND s.hidden_from_checkin = false
      AND (s.role = 'barber' OR s.is_also_barber = true)
  ),
  latest_attendance AS (
    SELECT DISTINCT ON (staff_id) staff_id, action_type
    FROM attendance_logs
    WHERE branch_id = p_branch_id
      AND recorded_at >= v_today_start
    ORDER BY staff_id, recorded_at DESC
  ),
  on_break AS (
    SELECT DISTINCT barber_id
    FROM queue_entries
    WHERE branch_id = p_branch_id
      AND is_break = true
      AND status = 'in_progress'
      AND barber_id IS NOT NULL
  ),
  pending_break_priority AS (
    SELECT DISTINCT ON (barber_id) barber_id, priority_order AS break_pri
    FROM queue_entries
    WHERE branch_id = p_branch_id
      AND is_break = true
      AND status = 'waiting'
      AND barber_id IS NOT NULL
    ORDER BY barber_id, priority_order ASC
  ),
  oldest_assigned_priority AS (
    SELECT barber_id, MIN(priority_order) AS oldest_pri
    FROM queue_entries
    WHERE branch_id = p_branch_id
      AND status = 'waiting'
      AND is_break = false
      AND barber_id IS NOT NULL
    GROUP BY barber_id
  ),
  break_ready AS (
    SELECT pb.barber_id
    FROM pending_break_priority pb
    LEFT JOIN oldest_assigned_priority oa ON oa.barber_id = pb.barber_id
    WHERE oa.oldest_pri IS NULL OR oa.oldest_pri >= pb.break_pri
  ),
  appointments_only_staff AS (
    SELECT staff_id FROM appointment_staff WHERE walkin_mode = 'appointments_only'
  ),
  appointment_protected AS (
    SELECT DISTINCT a.barber_id
    FROM appointments a
    WHERE a.branch_id = p_branch_id
      AND a.appointment_date = v_today
      AND a.status IN ('confirmed', 'checked_in')
      AND a.barber_id IS NOT NULL
      AND ((a.appointment_date + a.start_time) AT TIME ZONE p_branch_tz) > v_now
      AND ((a.appointment_date + a.start_time) AT TIME ZONE p_branch_tz) <= v_now + v_protection_window
  ),
  eligible AS (
    SELECT c.id
    FROM candidates c
    WHERE EXISTS (
            SELECT 1 FROM latest_attendance la
            WHERE la.staff_id = c.id AND la.action_type = 'clock_in'
          )
      AND NOT EXISTS (SELECT 1 FROM on_break ob WHERE ob.barber_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM break_ready br WHERE br.barber_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM appointments_only_staff ao WHERE ao.staff_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM appointment_protected ap WHERE ap.barber_id = c.id)
      AND NOT public.is_barber_blocked_by_shift_end(c.id, p_branch_tz, v_shift_end_margin)
  ),
  loads AS (
    SELECT barber_id, COUNT(*) AS load
    FROM queue_entries
    WHERE branch_id = p_branch_id
      AND status IN ('waiting', 'in_progress')
      AND barber_id IS NOT NULL
    GROUP BY barber_id
  ),
  attending AS (
    SELECT DISTINCT barber_id
    FROM queue_entries
    WHERE branch_id = p_branch_id
      AND status = 'in_progress'
      AND is_break = false
      AND barber_id IS NOT NULL
  ),
  daily_counts AS (
    SELECT barber_id, COUNT(*) AS cnt
    FROM visits
    WHERE branch_id = p_branch_id
      AND completed_at >= v_today_start
      AND barber_id IS NOT NULL
    GROUP BY barber_id
  ),
  last_completed AS (
    SELECT DISTINCT ON (barber_id) barber_id, completed_at
    FROM visits
    WHERE branch_id = p_branch_id
      AND barber_id IS NOT NULL
      AND completed_at IS NOT NULL
    ORDER BY barber_id, completed_at DESC
  )
  SELECT e.id INTO v_fair_id
  FROM eligible e
  LEFT JOIN loads l ON l.barber_id = e.id
  LEFT JOIN attending a ON a.barber_id = e.id
  LEFT JOIN last_completed lc ON lc.barber_id = e.id
  LEFT JOIN daily_counts dc ON dc.barber_id = e.id
  ORDER BY
    COALESCE(l.load, 0) ASC,
    (CASE WHEN a.barber_id IS NOT NULL THEN 1 ELSE 0 END) ASC,
    lc.completed_at ASC NULLS FIRST,
    COALESCE(dc.cnt, 0) ASC,
    e.id::text ASC
  LIMIT 1;

  RETURN v_fair_id;
END;
$$;

COMMENT ON FUNCTION public.compute_fair_barber(UUID, TEXT) IS
  'Devuelve el id del barbero "más justo" elegible para tomar un cliente dinámico en la sucursal. Replica el orden de assignDynamicBarbers (barber-utils.ts:313): load → busy → last_completed_at → daily_count → id. NULL si no hay elegibles.';

-- ── REPLACE de assign_next_client con el fairness gate ──────────────────────
CREATE OR REPLACE FUNCTION public.assign_next_client(
  p_barber_id UUID,
  p_branch_id UUID,
  p_preferred_entry_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entry_id UUID;
  v_entry_barber_id UUID;          -- (mig 129) capturado para detectar dinámicas
  v_branch_tz TEXT;
  v_org_id UUID;
  v_today DATE;
  v_now TIMESTAMPTZ;
  v_walkin_mode TEXT;
  v_buffer_minutes INTEGER;
  v_next_appt_start TIMESTAMPTZ;
  v_protection_window INTERVAL;
  v_avg_service_minutes INTEGER := 45;
  v_pending_break_priority TIMESTAMPTZ;
  v_candidate_priority TIMESTAMPTZ;
  v_fair_barber_id UUID;            -- (mig 129) cacheo del helper
  v_fair_computed BOOLEAN := false; -- (mig 129) evitar llamarlo dos veces
BEGIN
  v_now := NOW();

  -- ── Guard 0a: descanso ACTIVO (mig 127) ──────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM queue_entries
    WHERE barber_id = p_barber_id
      AND branch_id = p_branch_id
      AND is_break = true
      AND status = 'in_progress'
  ) THEN
    RETURN NULL;
  END IF;

  -- ── Guard 0b: descanso PENDIENTE listo para iniciar (mig 128) ────────────
  SELECT priority_order
    INTO v_pending_break_priority
  FROM queue_entries
  WHERE barber_id = p_barber_id
    AND branch_id = p_branch_id
    AND is_break = true
    AND status = 'waiting'
  ORDER BY priority_order ASC
  LIMIT 1;

  IF v_pending_break_priority IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM queue_entries
      WHERE barber_id = p_barber_id
        AND branch_id = p_branch_id
        AND status = 'waiting'
        AND is_break = false
        AND priority_order < v_pending_break_priority
    ) THEN
      RETURN NULL;
    END IF;
  END IF;

  SELECT b.timezone, b.organization_id
    INTO v_branch_tz, v_org_id
  FROM branches b
  WHERE b.id = p_branch_id;

  v_branch_tz := COALESCE(v_branch_tz, 'America/Argentina/Buenos_Aires');
  v_today := (v_now AT TIME ZONE v_branch_tz)::DATE;

  SELECT walkin_mode INTO v_walkin_mode
  FROM appointment_staff
  WHERE staff_id = p_barber_id;

  IF v_walkin_mode = 'appointments_only' THEN
    RETURN NULL;
  END IF;

  SELECT s.buffer_minutes INTO v_buffer_minutes
  FROM appointment_settings s
  WHERE s.organization_id = v_org_id
    AND s.branch_id IS NULL;

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
    RETURN NULL;
  END IF;

  -- ── Path preferido: el caller pasó el entry visible en su UI ────────────
  IF p_preferred_entry_id IS NOT NULL THEN
    SELECT id, priority_order, barber_id
      INTO v_entry_id, v_candidate_priority, v_entry_barber_id
    FROM queue_entries
    WHERE id = p_preferred_entry_id
      AND branch_id = p_branch_id
      AND status = 'waiting'
      AND is_break = false
      AND is_appointment = false
      AND (barber_id = p_barber_id OR barber_id IS NULL)
      AND (checked_in_at AT TIME ZONE v_branch_tz)::DATE = v_today
    FOR UPDATE SKIP LOCKED;

    IF v_entry_id IS NOT NULL THEN
      -- Defensa final 0b
      IF v_pending_break_priority IS NOT NULL
         AND v_candidate_priority >= v_pending_break_priority THEN
        RETURN NULL;
      END IF;

      -- ── Fairness gate (mig 129) ────────────────────────────────────────
      -- Sólo aplica a entries dinámicas (barber_id IS NULL antes del claim).
      -- Si es específica del caller, claim directo: el cliente ya era suyo.
      IF v_entry_barber_id IS NULL THEN
        SELECT public.compute_fair_barber(p_branch_id, v_branch_tz)
          INTO v_fair_barber_id;
        v_fair_computed := true;
        IF v_fair_barber_id IS NULL OR v_fair_barber_id <> p_barber_id THEN
          RETURN NULL;
        END IF;
      END IF;

      UPDATE queue_entries
      SET barber_id = p_barber_id,
          is_dynamic = false
      WHERE id = v_entry_id;
      RETURN v_entry_id;
    END IF;
  END IF;

  -- ── Fallback FIFO ────────────────────────────────────────────────────────
  SELECT id, priority_order, barber_id
    INTO v_entry_id, v_candidate_priority, v_entry_barber_id
  FROM queue_entries
  WHERE branch_id = p_branch_id
    AND status = 'waiting'
    AND is_break = false
    AND is_appointment = false
    AND (barber_id = p_barber_id OR barber_id IS NULL)
    AND (checked_in_at AT TIME ZONE v_branch_tz)::DATE = v_today
  ORDER BY priority_order ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_entry_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_pending_break_priority IS NOT NULL
     AND v_candidate_priority >= v_pending_break_priority THEN
    RETURN NULL;
  END IF;

  -- ── Fairness gate (mig 129) — mismo criterio que en el path preferido ──
  IF v_entry_barber_id IS NULL THEN
    IF NOT v_fair_computed THEN
      SELECT public.compute_fair_barber(p_branch_id, v_branch_tz)
        INTO v_fair_barber_id;
    END IF;
    IF v_fair_barber_id IS NULL OR v_fair_barber_id <> p_barber_id THEN
      RETURN NULL;
    END IF;
  END IF;

  UPDATE queue_entries
  SET barber_id = p_barber_id,
      is_dynamic = false
  WHERE id = v_entry_id;

  RETURN v_entry_id;
END;
$$;

COMMENT ON FUNCTION public.assign_next_client(UUID, UUID, UUID) IS
  'Asigna atómicamente el próximo cliente a un barbero. Retorna NULL si: descanso activo (Guard 0a, mig 127), descanso pendiente listo (Guard 0b, mig 128), modo appointments_only, turno inminente, no hay clientes esperando, o el caller no es el barbero más justo entre los elegibles para una entry dinámica (Guard 0c, mig 129).';
