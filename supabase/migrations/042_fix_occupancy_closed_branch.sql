-- Corrige el nivel de ocupación cuando la sucursal no tiene barberos activos:
-- sin barberos activos + sin cola = sin_espera (no hay tiempo de espera)
CREATE OR REPLACE FUNCTION public.refresh_branch_signals_for_branch(p_branch_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_waiting_count     INT;
  v_in_progress_count INT;
  v_active_barbers    INT;
  v_available_barbers INT;
  v_eta               INT;
  v_occupancy         occupancy_level;
  v_today             DATE;
BEGIN
  v_today := (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE;

  SELECT COUNT(*) INTO v_waiting_count
    FROM queue_entries qe
   WHERE qe.branch_id = p_branch_id
     AND qe.status = 'waiting'
     AND (qe.checked_in_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE = v_today;

  SELECT COUNT(*) INTO v_in_progress_count
    FROM queue_entries qe
   WHERE qe.branch_id = p_branch_id
     AND qe.status = 'in_progress'
     AND (qe.checked_in_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE = v_today;

  SELECT COUNT(*) INTO v_active_barbers
    FROM staff s
   WHERE s.branch_id = p_branch_id
     AND s.role = 'barber'
     AND s.is_active = true
     AND s.hidden_from_checkin = false
     AND (
       SELECT al.action_type FROM attendance_logs al
        WHERE al.staff_id = s.id
          AND (al.recorded_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE = v_today
        ORDER BY al.recorded_at DESC LIMIT 1
     ) IS DISTINCT FROM 'clock_out'::attendance_action;

  SELECT COUNT(*) INTO v_available_barbers
    FROM staff s
   WHERE s.branch_id = p_branch_id
     AND s.role = 'barber'
     AND s.is_active = true
     AND s.hidden_from_checkin = false
     AND (
       SELECT al.action_type FROM attendance_logs al
        WHERE al.staff_id = s.id
          AND (al.recorded_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE = v_today
        ORDER BY al.recorded_at DESC LIMIT 1
     ) IS DISTINCT FROM 'clock_out'::attendance_action
     AND s.id NOT IN (
       SELECT qe.barber_id FROM queue_entries qe
        WHERE qe.branch_id = p_branch_id
          AND qe.status = 'in_progress'
          AND qe.barber_id IS NOT NULL
     );

  v_eta := v_waiting_count * 25;

  -- Lógica de ocupación:
  -- sin barberos activos y sin cola = sin_espera (sucursal cerrada/vacía)
  -- barbero disponible = sin_espera
  -- todos ocupados, nadie esperando = baja
  -- < 2 esperando por barbero = media
  -- >= 2 esperando por barbero = alta
  IF v_active_barbers = 0 AND v_waiting_count = 0 THEN
    v_occupancy := 'sin_espera';
  ELSIF v_available_barbers >= 1 THEN
    v_occupancy := 'sin_espera';
  ELSIF v_waiting_count = 0 THEN
    v_occupancy := 'baja';
  ELSIF v_waiting_count < (2 * v_active_barbers) THEN
    v_occupancy := 'media';
  ELSE
    v_occupancy := 'alta';
  END IF;

  INSERT INTO branch_signals (
    branch_id, queue_size, active_barbers, waiting_count, available_barbers,
    eta_minutes, occupancy_level, updated_at
  )
  VALUES (
    p_branch_id, v_waiting_count + v_in_progress_count,
    v_active_barbers, v_waiting_count, v_available_barbers,
    v_eta, v_occupancy, NOW()
  )
  ON CONFLICT (branch_id) DO UPDATE
    SET queue_size        = EXCLUDED.queue_size,
        active_barbers    = EXCLUDED.active_barbers,
        waiting_count     = EXCLUDED.waiting_count,
        available_barbers = EXCLUDED.available_barbers,
        eta_minutes       = EXCLUDED.eta_minutes,
        occupancy_level   = EXCLUDED.occupancy_level,
        updated_at        = EXCLUDED.updated_at;
END;
$$;
