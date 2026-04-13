-- =============================================================================
-- Migración 075: Fix fórmula ETA — usa tiempo promedio real y paralelismo
-- ANTES: eta = waiting_count * 25 (hardcodeado, ignora barberos activos)
-- DESPUÉS: eta = ceil(waiting / barberos_activos) * avg_service_time_real
-- =============================================================================

CREATE OR REPLACE FUNCTION public.refresh_branch_signals_for_branch(p_branch_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_waiting_count     INT;
  v_in_progress_count INT;
  v_active_barbers    INT;
  v_available_barbers INT;
  v_avg_service_time  INT;
  v_eta               INT;
  v_occupancy         occupancy_level;
  v_today             DATE;
  v_caller_org        UUID;
BEGIN
  v_caller_org := get_user_org_id();

  -- Validar que la branch pertenece a la org del caller
  -- (si v_caller_org es NULL, es service_role/cron, se permite)
  IF v_caller_org IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM branches
    WHERE id = p_branch_id
      AND organization_id = v_caller_org
  ) THEN
    RAISE EXCEPTION 'Acceso denegado: la branch % no pertenece a tu organización', p_branch_id;
  END IF;

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

  -- Calcular tiempo promedio real de servicio (últimos 30 días, rango 5-120 min)
  SELECT COALESCE(
    ROUND(AVG(
      EXTRACT(EPOCH FROM (v.completed_at - v.started_at)) / 60
    ))::INT,
    25  -- fallback si no hay datos históricos
  ) INTO v_avg_service_time
  FROM visits v
  WHERE v.branch_id = p_branch_id
    AND v.started_at IS NOT NULL
    AND v.completed_at IS NOT NULL
    AND EXTRACT(EPOCH FROM (v.completed_at - v.started_at)) / 60 BETWEEN 5 AND 120
    AND v.completed_at >= NOW() - INTERVAL '30 days';

  -- Fórmula corregida: ceil(espera / barberos_activos) * tiempo_promedio_real
  v_eta := CEIL(v_waiting_count::numeric / GREATEST(v_active_barbers, 1)) * v_avg_service_time;

  -- Lógica de ocupación (sin cambios)
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
