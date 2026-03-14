-- ============================================
-- Allow barbers to hide from the check-in listA
-- ============================================

-- 1. Add hidden_from_checkin column to staff
ALTER TABLE staff
  ADD COLUMN hidden_from_checkin BOOLEAN NOT NULL DEFAULT false;

-- 2. Recreate get_available_barbers_today to exclude hidden barbers
CREATE OR REPLACE FUNCTION public.get_available_barbers_today(p_branch_id uuid)
 RETURNS TABLE(staff_id uuid)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_today_dow SMALLINT;
  v_today DATE;
BEGIN
  v_today_dow := EXTRACT(DOW FROM CURRENT_DATE)::SMALLINT;
  v_today := CURRENT_DATE;

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
