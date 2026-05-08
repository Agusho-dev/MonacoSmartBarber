-- =============================================================================
-- Migración 128: assign_next_client respeta descansos pendientes (waiting)
-- =============================================================================
-- Problema (4-may-2026 PM): un barbero con descanso aprobado en `waiting`
-- terminaba su corte, el auto-start del ghost (paso 6 de completeService) no
-- arrancaba si había clientes dinámicos en la cola, y el barbero terminaba
-- tomando otro cliente en lugar de su descanso. El paso 6 ya se corrigió
-- (ahora solo bloquea por clientes ASIGNADOS al barbero, no por dinámicos).
-- Esta migración cierra el último resquicio: el RPC `assign_next_client`
-- también debe rechazar la asignación si el barbero tiene un ghost waiting
-- cuya `priority_order` es <= la del cliente que estaría por tomar. Eso
-- garantiza que aunque la UI mande el request equivocado, el servidor obliga
-- al ghost a iniciarse primero.
--
-- Política: el ghost es válido para iniciarse cuando NO hay otro cliente
-- ASIGNADO ESPECÍFICAMENTE a este barbero con priority_order < ghost.priority_order.
-- Los dinámicos (barber_id IS NULL) no cuentan: van al pool global.
-- =============================================================================

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
BEGIN
  v_now := NOW();

  -- ── Guard 0a: descanso ACTIVO (mig 127) ──────────────────────────────────
  -- Si el barbero está en descanso ahora mismo, no recibe nada.
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
  -- Si el barbero tiene un ghost waiting cuya priority_order ya no está
  -- "tapada" por clientes asignados específicamente a él, ese ghost debe
  -- arrancar primero. No le asignamos nada — el caller (completeService o el
  -- propio barber-panel al tocar atender) verá NULL y la UI/auto-start del
  -- paso 6 del completeService lo iniciará.
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
    -- ¿Hay clientes ASIGNADOS a este barbero con priority menor que el ghost?
    -- Si no, el ghost es el siguiente turno legítimo del barbero → bloquear.
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

  IF p_preferred_entry_id IS NOT NULL THEN
    SELECT id, priority_order INTO v_entry_id, v_candidate_priority
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
      -- Defensa final: si la priority del candidato es >= ghost waiting,
      -- el ghost gana. (Caso borde: el ghost se aprobó entre el guard 0b y
      -- este lookup.) NULL out y dejamos que el caller maneje.
      IF v_pending_break_priority IS NOT NULL
         AND v_candidate_priority >= v_pending_break_priority THEN
        RETURN NULL;
      END IF;

      UPDATE queue_entries
      SET barber_id = p_barber_id,
          is_dynamic = false
      WHERE id = v_entry_id;
      RETURN v_entry_id;
    END IF;
  END IF;

  SELECT id, priority_order INTO v_entry_id, v_candidate_priority
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

  UPDATE queue_entries
  SET barber_id = p_barber_id,
      is_dynamic = false
  WHERE id = v_entry_id;

  RETURN v_entry_id;
END;
$$;

COMMENT ON FUNCTION public.assign_next_client(UUID, UUID, UUID) IS
  'Asigna atómicamente el próximo cliente a un barbero. Retorna NULL si: descanso activo (Guard 0a, mig 127), descanso pendiente listo para iniciar (Guard 0b, mig 128), modo appointments_only, turno inminente, o no hay clientes esperando.';
