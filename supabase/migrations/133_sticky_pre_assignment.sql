-- Migración 133: Sticky pre-assignment for dynamic queue entries.
--
-- Bug observado (incidente 2026-05-14, Rondeau):
--   Cliente tap "Menor espera" en kiosko a las 10:25.
--   compute_fair_barber predice Rodri (clocked-in 10:17, sin cortes hoy, NULLS FIRST gana).
--   Entry se inserta con barber_id=Rodri, is_dynamic=true.
--   Simon (acababa de terminar a las 10:23:57) tap "Atender" a las 10:28:47.
--   claim_next_for_barber acepta porque el filtro WHERE permite tomar dinámicas ajenas:
--     AND (barber_id = p_barber_id OR barber_id IS NULL OR is_dynamic = true)
--   Resultado: Simon roba al cliente que el algoritmo había asignado a Rodri.
--
-- Causa raíz: la pre-asignación de compute_fair_barber NO era sticky. Cualquier barbero
-- podía robar una entry dinámica aunque su barbero pre-asignado estuviera presente y libre.
--
-- Fix: nuevo invariante "sticky-while-present".
--   Una entry pre-asignada permanece bound al barbero pre-asignado mientras éste esté
--   operativamente presente (clocked-in, no en break, no en shift_end, no oculto).
--   Si el barbero pre-asignado deja de estar presente (logout, break, fin de turno),
--   la entry vuelve a ser claimable por cualquiera (fallback dinámico real).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Helper: is_barber_present_now()
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_barber_present_now(
  p_barber_id uuid,
  p_branch_id uuid,
  p_branch_tz text DEFAULT 'America/Argentina/Buenos_Aires'
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today_start TIMESTAMPTZ;
  v_last_action TEXT;
  v_org_id UUID;
  v_shift_end_margin INTEGER;
BEGIN
  IF p_barber_id IS NULL OR p_branch_id IS NULL THEN
    RETURN false;
  END IF;

  -- Staff activo, no oculto, no soft-deleted
  IF NOT EXISTS (
    SELECT 1 FROM staff
    WHERE id = p_barber_id
      AND is_active = true
      AND COALESCE(hidden_from_checkin, false) = false
      AND deleted_at IS NULL
  ) THEN
    RETURN false;
  END IF;

  v_today_start := date_trunc('day', NOW() AT TIME ZONE p_branch_tz) AT TIME ZONE p_branch_tz;

  -- Último action_type del día. Si no hay registro o el último es clock_out, no está presente.
  SELECT action_type INTO v_last_action
  FROM attendance_logs
  WHERE staff_id = p_barber_id
    AND branch_id = p_branch_id
    AND recorded_at >= v_today_start
  ORDER BY recorded_at DESC
  LIMIT 1;

  IF v_last_action IS NULL OR v_last_action <> 'clock_in' THEN
    RETURN false;
  END IF;

  -- En break activo (ghost in_progress): no está presente para tomar clientes
  IF EXISTS (
    SELECT 1 FROM queue_entries
    WHERE barber_id = p_barber_id
      AND branch_id = p_branch_id
      AND is_break = true
      AND status = 'in_progress'
  ) THEN
    RETURN false;
  END IF;

  -- Bloqueado por fin de turno (margen configurable)
  SELECT organization_id INTO v_org_id FROM branches WHERE id = p_branch_id;
  SELECT shift_end_margin_minutes INTO v_shift_end_margin
  FROM app_settings WHERE organization_id = v_org_id;
  v_shift_end_margin := COALESCE(v_shift_end_margin, 35);

  IF public.is_barber_blocked_by_shift_end(p_barber_id, p_branch_tz, v_shift_end_margin) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.is_barber_present_now IS
'Devuelve true si el barbero está operativamente presente: staff activo+visible, último attendance del día = clock_in, no en break in_progress, no bloqueado por shift_end. Usado por claim_next_for_barber para respetar pre-asignaciones sticky de compute_fair_barber (mig 133).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) claim_next_for_barber con sticky-while-present
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.claim_next_for_barber(
  p_barber_id uuid,
  p_branch_id uuid,
  p_preferred_entry_id uuid DEFAULT NULL
) RETURNS TABLE(entry_id uuid, is_break boolean, was_dynamic boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
  -- 1. Si el barbero ya está en un break in_progress, no avanzar
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

  -- 2. Ghost de descanso pendiente: arranca si no hay clientes asignados antes
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

  -- 3. appointments_only staff no toma walk-ins
  SELECT walkin_mode INTO v_walkin_mode
  FROM appointment_staff WHERE staff_id = p_barber_id;
  IF v_walkin_mode = 'appointments_only' THEN
    RETURN;
  END IF;

  -- 4. Ventana de protección por turno próximo
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

  -- ── 5. CAMBIO CLAVE mig 133: filtro WHERE sticky-while-present ──
  -- Antes:  (barber_id = p_barber_id OR barber_id IS NULL OR is_dynamic = true)
  -- Ahora:  (barber_id = p_barber_id
  --          OR barber_id IS NULL
  --          OR (is_dynamic = true AND NOT is_barber_present_now(barber_id, ...)))
  --
  -- Sólo se permite robar una entry pre-asignada si el barbero original NO está
  -- operativamente presente. Si está clocked-in, no en break, no shift_end, la
  -- entry queda reservada para él hasta que la tome (o se vaya).

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
        OR (is_dynamic = true AND NOT public.is_barber_present_now(barber_id, p_branch_id, v_branch_tz))
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

  -- 6. Fallback FIFO global con mismo filtro sticky
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
      OR (is_dynamic = true AND NOT public.is_barber_present_now(barber_id, p_branch_id, v_branch_tz))
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
$$;

COMMENT ON FUNCTION public.claim_next_for_barber IS
'Asigna atómicamente el próximo cliente a un barbero (FOR UPDATE SKIP LOCKED). Mig 133: implementa sticky-while-present — una entry pre-asignada por compute_fair_barber a otro barbero sólo puede ser tomada si ese barbero NO está operativamente presente.';
