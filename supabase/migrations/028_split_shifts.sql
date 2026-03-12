-- ============================================
-- Horarios cortados: múltiples bloques por día
-- ============================================

-- 1. Add block_index column (0 = first block, 1 = second block, etc.)
ALTER TABLE staff_schedules
  ADD COLUMN block_index SMALLINT NOT NULL DEFAULT 0;

-- 2. Replace the unique constraint to allow multiple blocks per day
ALTER TABLE staff_schedules
  DROP CONSTRAINT staff_schedules_staff_id_day_of_week_key;

ALTER TABLE staff_schedules
  ADD CONSTRAINT staff_schedules_staff_day_block_key
  UNIQUE (staff_id, day_of_week, block_index);

-- 3. Update get_available_barbers_today — no logic change needed because
--    it already uses EXISTS (any active block for today means the barber works).
--    Re-create to ensure it picks up the schema change cleanly.
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
