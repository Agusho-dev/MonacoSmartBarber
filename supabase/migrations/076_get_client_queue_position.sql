-- =============================================================================
-- Migración 076: RPC para que el cliente consulte su posición optimista en la fila
-- Considera paralelismo de barberos para dar un estimado realista.
-- Usado por la app móvil y el kiosk post-checkin.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_client_queue_position(p_queue_entry_id UUID)
RETURNS TABLE(
  position INT,
  effective_ahead INT,
  status TEXT,
  label TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
  v_today DATE;
  v_total_ahead INT;
  v_specifics_ahead INT;
  v_dynamics_ahead INT;
  v_active_barbers INT;
  v_effective INT;
BEGIN
  v_today := (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE;

  -- Obtener la entrada del cliente
  SELECT qe.id, qe.branch_id, qe.barber_id, qe.priority_order, qe.status AS entry_status, qe.position AS entry_position
  INTO v_entry
  FROM queue_entries qe
  WHERE qe.id = p_queue_entry_id;

  IF v_entry IS NULL THEN
    RETURN QUERY SELECT 0, 0, 'not_found'::TEXT, 'Turno no encontrado'::TEXT;
    RETURN;
  END IF;

  -- Si ya está en progreso o completado
  IF v_entry.entry_status = 'in_progress' THEN
    RETURN QUERY SELECT v_entry.entry_position, 0, 'in_progress'::TEXT, 'Es tu turno'::TEXT;
    RETURN;
  END IF;

  IF v_entry.entry_status IN ('completed', 'cancelled') THEN
    RETURN QUERY SELECT v_entry.entry_position, 0, v_entry.entry_status::TEXT, ''::TEXT;
    RETURN;
  END IF;

  -- Contar barberos activos en la sucursal
  SELECT COUNT(*) INTO v_active_barbers
  FROM staff s
  WHERE s.branch_id = v_entry.branch_id
    AND s.role = 'barber'
    AND s.is_active = true
    AND s.hidden_from_checkin = false
    AND (
      SELECT al.action_type FROM attendance_logs al
      WHERE al.staff_id = s.id
        AND (al.recorded_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE = v_today
      ORDER BY al.recorded_at DESC LIMIT 1
    ) IS DISTINCT FROM 'clock_out'::attendance_action;

  IF v_active_barbers < 1 THEN
    v_active_barbers := 1;
  END IF;

  IF v_entry.barber_id IS NULL THEN
    -- Cliente dinámico: todos los que están adelante se reparten entre barberos
    SELECT COUNT(*) INTO v_total_ahead
    FROM queue_entries qe
    WHERE qe.branch_id = v_entry.branch_id
      AND qe.status = 'waiting'
      AND qe.is_break = false
      AND qe.id != v_entry.id
      AND qe.priority_order < v_entry.priority_order
      AND (qe.checked_in_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE = v_today;

    v_effective := CEIL(v_total_ahead::numeric / v_active_barbers);
  ELSE
    -- Cliente específico: específicos de su barbero + dinámicos repartidos
    SELECT COUNT(*) INTO v_specifics_ahead
    FROM queue_entries qe
    WHERE qe.branch_id = v_entry.branch_id
      AND qe.status = 'waiting'
      AND qe.is_break = false
      AND qe.id != v_entry.id
      AND qe.barber_id = v_entry.barber_id
      AND qe.priority_order < v_entry.priority_order
      AND (qe.checked_in_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE = v_today;

    SELECT COUNT(*) INTO v_dynamics_ahead
    FROM queue_entries qe
    WHERE qe.branch_id = v_entry.branch_id
      AND qe.status = 'waiting'
      AND qe.is_break = false
      AND qe.id != v_entry.id
      AND qe.barber_id IS NULL
      AND qe.priority_order < v_entry.priority_order
      AND (qe.checked_in_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE = v_today;

    v_effective := v_specifics_ahead + CEIL(v_dynamics_ahead::numeric / v_active_barbers);
  END IF;

  IF v_effective = 0 THEN
    RETURN QUERY SELECT v_entry.entry_position, 0, 'waiting'::TEXT, 'Sos el siguiente'::TEXT;
  ELSIF v_effective = 1 THEN
    RETURN QUERY SELECT v_entry.entry_position, 1, 'waiting'::TEXT, 'Aprox. 1 persona antes'::TEXT;
  ELSE
    RETURN QUERY SELECT v_entry.entry_position, v_effective, 'waiting'::TEXT, ('Aprox. ' || v_effective || ' personas antes')::TEXT;
  END IF;
END;
$$;
