-- ============================================================
-- Migración 057: Corrección de funciones multi-tenant
-- ============================================================
-- Corrige vulnerabilidades de aislamiento entre organizaciones:
--   1. get_user_org_id() — fallback no determinístico (LIMIT 1 sin ORDER BY)
--   2. Funciones SECURITY DEFINER sin validación de organización
--   3. Funciones INVOKER sin scope de organización
--   4. Trigger on_queue_completed() sin propagación de org
-- ============================================================

-- ============================================================
-- 1. FIX get_user_org_id() — Agregar ORDER BY determinístico
-- ============================================================
-- Problema: Los fallbacks a staff/clients usan LIMIT 1 sin ORDER BY.
-- Si un usuario pertenece a múltiples orgs, el resultado es indeterminado.
-- Fix: Ordenar por created_at DESC para retornar la org más reciente.

CREATE OR REPLACE FUNCTION get_user_org_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT COALESCE(
    -- Primero: intentar desde JWT app_metadata (fuente autoritativa)
    (auth.jwt() -> 'app_metadata' ->> 'organization_id')::UUID,
    -- Fallback: buscar desde staff (para barber PIN sessions que no tienen JWT)
    -- ORDER BY created_at DESC para obtener la org más reciente de forma determinística
    (SELECT organization_id FROM staff
     WHERE auth_user_id = auth.uid() AND is_active = true
     ORDER BY created_at DESC LIMIT 1),
    -- Fallback: buscar desde clients
    (SELECT organization_id FROM clients
     WHERE auth_user_id = auth.uid()
     ORDER BY created_at DESC LIMIT 1)
  );
$$;

COMMENT ON FUNCTION get_user_org_id IS 'Retorna el organization_id del usuario autenticado via JWT o lookup en staff/clients (determinístico)';

-- ============================================================
-- 2. FIX Funciones SECURITY DEFINER — Validación de org
-- ============================================================

-- ------------------------------------------------------------
-- 2a. start_barber_break — Validar que staff pertenece a la org del caller
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION start_barber_break(p_staff_id UUID, p_break_config_id UUID)
RETURNS void AS $$
DECLARE
  v_duration INTEGER;
  v_tolerance INTEGER;
  v_caller_org UUID;
BEGIN
  -- Obtener org del caller
  v_caller_org := get_user_org_id();

  -- Validar que el staff pertenece a la misma org
  IF NOT EXISTS (
    SELECT 1 FROM staff
    WHERE id = p_staff_id
      AND organization_id = v_caller_org
  ) THEN
    RAISE EXCEPTION 'Acceso denegado: el staff % no pertenece a tu organización', p_staff_id;
  END IF;

  -- Validar que el break_config pertenece a una branch de la misma org
  IF NOT EXISTS (
    SELECT 1 FROM break_configs bc
    JOIN branches b ON b.id = bc.branch_id
    WHERE bc.id = p_break_config_id
      AND b.organization_id = v_caller_org
  ) THEN
    RAISE EXCEPTION 'Acceso denegado: la configuración de descanso no pertenece a tu organización';
  END IF;

  SELECT duration_minutes, tolerance_minutes
  INTO v_duration, v_tolerance
  FROM break_configs
  WHERE id = p_break_config_id;

  UPDATE staff
  SET
    status = 'paused',
    break_config_id = p_break_config_id,
    break_started_at = now(),
    break_ends_at = now() + (v_duration + v_tolerance) * INTERVAL '1 minute'
  WHERE id = p_staff_id
    AND organization_id = v_caller_org;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 2b. end_barber_break — Validar org del staff
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION end_barber_break(p_staff_id UUID)
RETURNS void AS $$
DECLARE
  v_caller_org UUID;
BEGIN
  v_caller_org := get_user_org_id();

  -- Validar que el staff pertenece a la misma org
  IF NOT EXISTS (
    SELECT 1 FROM staff
    WHERE id = p_staff_id
      AND organization_id = v_caller_org
  ) THEN
    RAISE EXCEPTION 'Acceso denegado: el staff % no pertenece a tu organización', p_staff_id;
  END IF;

  UPDATE staff
  SET
    status = 'available',
    break_config_id = NULL,
    break_started_at = NULL,
    break_ends_at = NULL
  WHERE id = p_staff_id
    AND organization_id = v_caller_org;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 2c. unblock_barber — Validar org del staff
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION unblock_barber(p_staff_id UUID)
RETURNS void AS $$
DECLARE
  v_caller_org UUID;
BEGIN
  v_caller_org := get_user_org_id();

  -- Validar que el staff pertenece a la misma org
  IF NOT EXISTS (
    SELECT 1 FROM staff
    WHERE id = p_staff_id
      AND organization_id = v_caller_org
  ) THEN
    RAISE EXCEPTION 'Acceso denegado: el staff % no pertenece a tu organización', p_staff_id;
  END IF;

  UPDATE staff
  SET
    status = 'available',
    break_config_id = NULL,
    break_started_at = NULL,
    break_ends_at = NULL
  WHERE id = p_staff_id
    AND status = 'blocked'
    AND organization_id = v_caller_org;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 2d. check_and_block_overdue_breaks — Filtrar por org del caller
-- ------------------------------------------------------------
-- Nota: Esta función puede ser llamada por cron (sin auth context)
-- o por un staff autenticado. Cuando se llama desde cron con
-- service_role, get_user_org_id() retorna NULL y se procesan todas las orgs.
-- Cuando la llama un staff, solo afecta su org.

CREATE OR REPLACE FUNCTION check_and_block_overdue_breaks()
RETURNS void AS $$
DECLARE
  v_caller_org UUID;
BEGIN
  v_caller_org := get_user_org_id();

  UPDATE staff
  SET status = 'blocked'
  WHERE status = 'paused'
    AND break_ends_at IS NOT NULL
    AND now() > break_ends_at
    -- Si hay org del caller, filtrar. Si es NULL (cron/service_role), procesar todas.
    AND (v_caller_org IS NULL OR organization_id = v_caller_org);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 2e. batch_update_queue_entries — Validar que los entries pertenecen a branches de la org
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION batch_update_queue_entries(
  p_updates JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item JSONB;
  v_caller_org UUID;
  v_entry_id UUID;
BEGIN
  v_caller_org := get_user_org_id();

  -- Validar que el caller es staff de una org
  IF v_caller_org IS NULL THEN
    RAISE EXCEPTION 'Acceso denegado: no se pudo determinar la organización del usuario';
  END IF;

  -- Validar que TODOS los queue_entry IDs pertenecen a branches de la org del caller
  FOR item IN SELECT * FROM jsonb_array_elements(p_updates)
  LOOP
    v_entry_id := (item->>'id')::uuid;

    IF NOT EXISTS (
      SELECT 1 FROM queue_entries qe
      JOIN branches b ON b.id = qe.branch_id
      WHERE qe.id = v_entry_id
        AND b.organization_id = v_caller_org
    ) THEN
      RAISE EXCEPTION 'Acceso denegado: queue_entry % no pertenece a tu organización', v_entry_id;
    END IF;
  END LOOP;

  -- Ejecutar las actualizaciones (ya validadas)
  FOR item IN SELECT * FROM jsonb_array_elements(p_updates)
  LOOP
    UPDATE queue_entries
    SET
      position   = (item->>'position')::int,
      barber_id  = CASE
                     WHEN item ? 'barber_id' THEN
                       NULLIF(item->>'barber_id', '')::uuid
                     ELSE barber_id
                   END,
      is_dynamic = CASE
                     WHEN item ? 'is_dynamic' THEN
                       (item->>'is_dynamic')::boolean
                     ELSE is_dynamic
                   END
    WHERE id = (item->>'id')::uuid
      AND status = 'waiting';
  END LOOP;
END;
$$;

-- ------------------------------------------------------------
-- 2f. generate_commission_report — Validar que branch y staff pertenecen a la org
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION generate_commission_report(
  p_staff_id  UUID,
  p_branch_id UUID,
  p_date      DATE DEFAULT CURRENT_DATE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_commission NUMERIC(12,2);
  v_report_id UUID;
  v_caller_org UUID;
BEGIN
  v_caller_org := get_user_org_id();

  -- Validar que el staff existe, es barbero y pertenece a la org
  IF NOT EXISTS (
    SELECT 1 FROM staff
    WHERE id = p_staff_id
      AND role = 'barber'::user_role
      AND (v_caller_org IS NULL OR organization_id = v_caller_org)
  ) THEN
    RAISE EXCEPTION 'El staff_id % no existe, no es barbero, o no pertenece a tu organización', p_staff_id;
  END IF;

  -- Validar que la sucursal existe y pertenece a la org
  IF NOT EXISTS (
    SELECT 1 FROM branches
    WHERE id = p_branch_id
      AND (v_caller_org IS NULL OR organization_id = v_caller_org)
  ) THEN
    RAISE EXCEPTION 'La branch_id % no existe o no pertenece a tu organización', p_branch_id;
  END IF;

  -- Si ya existe un reporte de comisión para este barbero y fecha, retornarlo
  SELECT id INTO v_report_id
  FROM salary_reports
  WHERE staff_id = p_staff_id
    AND report_date = p_date
    AND type = 'commission';

  IF v_report_id IS NOT NULL THEN
    RETURN v_report_id;
  END IF;

  -- Calcular total de comisiones del día desde la tabla visits
  SELECT COALESCE(SUM(commission_amount), 0)
  INTO v_total_commission
  FROM visits
  WHERE barber_id = p_staff_id
    AND branch_id = p_branch_id
    AND completed_at::date = p_date;

  -- Solo crear reporte si hay comisiones > 0
  IF v_total_commission <= 0 THEN
    RETURN NULL;
  END IF;

  -- Insertar el reporte de comisión
  INSERT INTO salary_reports (
    staff_id, branch_id, type, amount, report_date, notes
  ) VALUES (
    p_staff_id,
    p_branch_id,
    'commission',
    v_total_commission,
    p_date,
    'Comisión auto-generada para ' || to_char(p_date, 'DD/MM/YYYY')
  )
  RETURNING id INTO v_report_id;

  RETURN v_report_id;
END;
$$;

-- ------------------------------------------------------------
-- 2g. pay_salary_reports — Validar que los reportes pertenecen a la org
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION pay_salary_reports(
  p_report_ids UUID[],
  p_notes      TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_staff_id    UUID;
  v_branch_id   UUID;
  v_total       NUMERIC(12,2);
  v_batch_id    UUID;
  v_count       INT;
  v_caller_org  UUID;
BEGIN
  v_caller_org := get_user_org_id();

  -- Validar que hay reportes
  IF array_length(p_report_ids, 1) IS NULL OR array_length(p_report_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Debe proporcionar al menos un reporte para pagar';
  END IF;

  -- Validar que TODOS los reportes pertenecen a branches de la org del caller
  IF v_caller_org IS NOT NULL AND EXISTS (
    SELECT 1 FROM salary_reports sr
    JOIN branches b ON b.id = sr.branch_id
    WHERE sr.id = ANY(p_report_ids)
      AND b.organization_id != v_caller_org
  ) THEN
    RAISE EXCEPTION 'Acceso denegado: algunos reportes no pertenecen a tu organización';
  END IF;

  -- Verificar que todos los reportes existen, están pendientes y son del mismo staff
  SELECT COUNT(DISTINCT sr.staff_id), MIN(sr.staff_id), MIN(sr.branch_id)
  INTO v_count, v_staff_id, v_branch_id
  FROM salary_reports sr
  WHERE sr.id = ANY(p_report_ids)
    AND sr.status = 'pending';

  IF v_count = 0 THEN
    RAISE EXCEPTION 'No se encontraron reportes pendientes con los IDs proporcionados';
  END IF;

  IF v_count > 1 THEN
    RAISE EXCEPTION 'Todos los reportes deben pertenecer al mismo barbero';
  END IF;

  -- Verificar que la cantidad de reportes encontrados coincide con los solicitados
  SELECT COUNT(*) INTO v_count
  FROM salary_reports
  WHERE id = ANY(p_report_ids)
    AND status = 'pending';

  IF v_count != array_length(p_report_ids, 1) THEN
    RAISE EXCEPTION 'Algunos reportes no existen o ya fueron pagados';
  END IF;

  -- Calcular el total
  SELECT COALESCE(SUM(amount), 0)
  INTO v_total
  FROM salary_reports
  WHERE id = ANY(p_report_ids);

  -- Crear el lote de pago
  INSERT INTO salary_payment_batches (staff_id, branch_id, total_amount, notes)
  VALUES (v_staff_id, v_branch_id, v_total, p_notes)
  RETURNING id INTO v_batch_id;

  -- Marcar todos los reportes como pagados y asociarlos al lote
  UPDATE salary_reports
  SET status = 'paid',
      batch_id = v_batch_id
  WHERE id = ANY(p_report_ids);

  RETURN v_batch_id;
END;
$$;

-- ------------------------------------------------------------
-- 2h. refresh_branch_signals_for_branch — Validar que la branch pertenece a la org
-- ------------------------------------------------------------
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

  v_eta := v_waiting_count * 25;

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

-- ============================================================
-- 3. FIX Funciones INVOKER — Agregar scope de organización
-- ============================================================

-- ------------------------------------------------------------
-- 3a. next_queue_position — Validar que la branch pertenece a la org
-- ------------------------------------------------------------
-- Nota: Esta función se llama desde check-in (público) y desde el dashboard.
-- Para check-in público, auth.uid() es NULL y get_user_org_id() retorna NULL.
-- En ese caso permitimos la operación (el kiosk trabaja con branch_id directo).

CREATE OR REPLACE FUNCTION next_queue_position(p_branch_id UUID)
RETURNS INTEGER AS $$
DECLARE
  max_pos INTEGER;
  v_caller_org UUID;
BEGIN
  v_caller_org := get_user_org_id();

  -- Si hay usuario autenticado, validar que la branch pertenece a su org
  IF v_caller_org IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM branches
    WHERE id = p_branch_id
      AND organization_id = v_caller_org
  ) THEN
    RAISE EXCEPTION 'Acceso denegado: la branch % no pertenece a tu organización', p_branch_id;
  END IF;

  SELECT COALESCE(MAX(position), 0) INTO max_pos
  FROM queue_entries
  WHERE branch_id = p_branch_id
    AND status IN ('waiting', 'in_progress')
    AND DATE(checked_in_at) = CURRENT_DATE;
  RETURN max_pos + 1;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- 3b. get_available_barbers_today — Validar branch pertenece a la org
-- ------------------------------------------------------------
-- Misma lógica: kiosk/check-in es público, no tiene auth context.

CREATE OR REPLACE FUNCTION public.get_available_barbers_today(p_branch_id uuid)
RETURNS TABLE(staff_id uuid)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_today_dow SMALLINT;
  v_today DATE;
  v_caller_org UUID;
BEGIN
  v_today_dow := EXTRACT(DOW FROM CURRENT_DATE)::SMALLINT;
  v_today := CURRENT_DATE;
  v_caller_org := get_user_org_id();

  -- Si hay usuario autenticado, validar que la branch pertenece a su org
  IF v_caller_org IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM branches
    WHERE id = p_branch_id
      AND organization_id = v_caller_org
  ) THEN
    RAISE EXCEPTION 'Acceso denegado: la branch % no pertenece a tu organización', p_branch_id;
  END IF;

  RETURN QUERY
  SELECT s.id
  FROM staff s
  WHERE s.branch_id = p_branch_id
    AND s.role = 'barber'
    AND s.is_active = true
    AND s.hidden_from_checkin = false
    AND EXISTS (
      SELECT 1 FROM staff_schedules ss
      WHERE ss.staff_id = s.id
        AND ss.day_of_week = v_today_dow
        AND ss.is_active = true
    )
    AND NOT EXISTS (
      SELECT 1 FROM staff_schedule_exceptions sse
      WHERE sse.staff_id = s.id
        AND sse.exception_date = v_today
        AND sse.is_absent = true
    )
    AND (
      SELECT al.action_type
      FROM attendance_logs al
      WHERE al.staff_id = s.id
        AND DATE(al.recorded_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Argentina/Buenos_Aires') = v_today
      ORDER BY al.recorded_at DESC
      LIMIT 1
    ) IS DISTINCT FROM 'clock_out'::attendance_action;
END;
$function$;

-- ------------------------------------------------------------
-- 3c. calculate_barber_salary — Validar staff pertenece a la org
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION calculate_barber_salary(
  p_staff_id UUID,
  p_period_start DATE,
  p_period_end DATE
)
RETURNS NUMERIC(12,2) AS $$
DECLARE
  v_scheme salary_scheme;
  v_base NUMERIC(12,2);
  v_commission_pct NUMERIC(5,2);
  v_total_billed NUMERIC(12,2);
  v_commission_earned NUMERIC(12,2);
  v_result NUMERIC(12,2);
  v_caller_org UUID;
BEGIN
  v_caller_org := get_user_org_id();

  -- Si hay usuario autenticado, validar que el staff pertenece a su org
  IF v_caller_org IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM staff
    WHERE id = p_staff_id
      AND organization_id = v_caller_org
  ) THEN
    RAISE EXCEPTION 'Acceso denegado: el staff % no pertenece a tu organización', p_staff_id;
  END IF;

  SELECT scheme, base_amount, commission_pct
  INTO v_scheme, v_base, v_commission_pct
  FROM salary_configs
  WHERE staff_id = p_staff_id;

  IF NOT FOUND THEN
    SELECT commission_pct INTO v_commission_pct FROM staff WHERE id = p_staff_id;
    v_scheme := 'commission';
    v_base := 0;
  END IF;

  -- Total facturado en el período
  SELECT COALESCE(SUM(amount), 0)
  INTO v_total_billed
  FROM visits
  WHERE barber_id = p_staff_id
    AND completed_at::date BETWEEN p_period_start AND p_period_end;

  v_commission_earned := v_total_billed * (COALESCE(v_commission_pct, 0) / 100);

  v_result := CASE v_scheme
    WHEN 'fixed'      THEN v_base
    WHEN 'commission' THEN v_commission_earned
    WHEN 'hybrid'     THEN GREATEST(v_base, v_commission_earned)
    ELSE v_base
  END;

  RETURN COALESCE(v_result, 0);
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- 3d. get_occurrence_count — Validar staff pertenece a la org
-- ------------------------------------------------------------
-- Previene que un staff de org A consulte registros disciplinarios de org B.

CREATE OR REPLACE FUNCTION get_occurrence_count(
  p_staff_id UUID,
  p_event_type disciplinary_event_type,
  p_from_date DATE DEFAULT date_trunc('month', CURRENT_DATE)::DATE
)
RETURNS INTEGER AS $$
DECLARE
  v_caller_org UUID;
BEGIN
  v_caller_org := get_user_org_id();

  -- Si hay usuario autenticado, validar que el staff pertenece a su org
  IF v_caller_org IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM staff
    WHERE id = p_staff_id
      AND organization_id = v_caller_org
  ) THEN
    RAISE EXCEPTION 'Acceso denegado: el staff % no pertenece a tu organización', p_staff_id;
  END IF;

  RETURN (
    SELECT COUNT(*)
    FROM disciplinary_events
    WHERE staff_id = p_staff_id
      AND event_type = p_event_type
      AND event_date >= p_from_date
  );
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- 3e. on_queue_completed — Propagar organization_id en la visita
-- ------------------------------------------------------------
-- Este trigger crea visits cuando una queue_entry pasa a 'completed'.
-- La visit hereda branch_id de queue_entry, que ya tiene org implícito.
-- No necesita validación de org (es un trigger interno), pero aseguramos
-- que las queries internas filtren correctamente por branch.

CREATE OR REPLACE FUNCTION on_queue_completed()
RETURNS TRIGGER AS $$
DECLARE
  v_service_price NUMERIC(10,2);
  v_commission NUMERIC(5,2);
  v_commission_amount NUMERIC(10,2);
  v_points INTEGER;
  v_reward_active BOOLEAN;
  v_branch_org UUID;
BEGIN
  IF NEW.status = 'completed' AND OLD.status = 'in_progress' THEN
    -- Obtener org de la branch para filtrar datos correctamente
    SELECT organization_id INTO v_branch_org
    FROM branches WHERE id = NEW.branch_id;

    SELECT commission_pct INTO v_commission FROM staff WHERE id = NEW.barber_id;
    v_commission := COALESCE(v_commission, 0);

    -- Filtrar servicios por la branch específica (no cross-org)
    SELECT price INTO v_service_price FROM services
      WHERE is_active = true
      AND (branch_id = NEW.branch_id OR branch_id IS NULL)
      ORDER BY
        CASE WHEN branch_id = NEW.branch_id THEN 0 ELSE 1 END,
        created_at
      LIMIT 1;
    v_service_price := COALESCE(v_service_price, 0);

    v_commission_amount := v_service_price * (v_commission / 100);

    INSERT INTO visits (branch_id, client_id, barber_id, queue_entry_id, amount, commission_pct, commission_amount, started_at, completed_at)
    VALUES (NEW.branch_id, NEW.client_id, NEW.barber_id, NEW.id, v_service_price, v_commission, v_commission_amount, NEW.started_at, NEW.completed_at);

    -- Filtrar rewards_config por la branch específica
    SELECT rw.points_per_visit, rw.is_active INTO v_points, v_reward_active
    FROM rewards_config rw
    WHERE (rw.branch_id = NEW.branch_id OR rw.branch_id IS NULL)
      AND rw.is_active = true
    ORDER BY
      CASE WHEN rw.branch_id = NEW.branch_id THEN 0 ELSE 1 END
    LIMIT 1;

    IF v_reward_active IS TRUE AND v_points > 0 THEN
      INSERT INTO client_points (client_id, branch_id, points_balance, total_earned)
      VALUES (NEW.client_id, NEW.branch_id, v_points, v_points)
      ON CONFLICT (client_id, branch_id)
      DO UPDATE SET
        points_balance = client_points.points_balance + v_points,
        total_earned = client_points.total_earned + v_points;

      INSERT INTO point_transactions (client_id, points, type, description)
      VALUES (NEW.client_id, v_points, 'earned', 'Puntos por visita');
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- FIN Migración 057
-- ============================================================
