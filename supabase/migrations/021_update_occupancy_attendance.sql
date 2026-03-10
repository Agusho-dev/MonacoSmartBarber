-- Update branch_occupancy view to exclude clocked-out barbers
CREATE OR REPLACE VIEW public.branch_occupancy AS
 SELECT b.id AS branch_id,
    b.name AS branch_name,
    count(
        CASE
            WHEN qe.status = 'waiting'::queue_status THEN 1
            ELSE NULL::integer
        END) AS clients_waiting,
    count(
        CASE
            WHEN qe.status = 'in_progress'::queue_status THEN 1
            ELSE NULL::integer
        END) AS clients_in_progress,
    ( SELECT count(*) AS count
           FROM staff s
          WHERE s.branch_id = b.id AND s.role = 'barber'::user_role AND s.is_active = true 
            AND (
              SELECT al.action_type
              FROM attendance_logs al
              WHERE al.staff_id = s.id
                AND DATE(al.recorded_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Argentina/Buenos_Aires') = CURRENT_DATE
              ORDER BY al.recorded_at DESC
              LIMIT 1
            ) IS DISTINCT FROM 'clock_out'::attendance_action
    ) AS total_barbers,
    ( SELECT count(*) AS count
           FROM staff s
          WHERE s.branch_id = b.id AND s.role = 'barber'::user_role AND s.is_active = true AND s.status = 'available'::staff_status 
            AND NOT (s.id IN ( SELECT qe2.barber_id
                   FROM queue_entries qe2
                  WHERE qe2.branch_id = b.id AND qe2.status = 'in_progress'::queue_status AND qe2.barber_id IS NOT NULL))
            AND (
              SELECT al.action_type
              FROM attendance_logs al
              WHERE al.staff_id = s.id
                AND DATE(al.recorded_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Argentina/Buenos_Aires') = CURRENT_DATE
              ORDER BY al.recorded_at DESC
              LIMIT 1
            ) IS DISTINCT FROM 'clock_out'::attendance_action
    ) AS available_barbers
   FROM branches b
     LEFT JOIN queue_entries qe ON qe.branch_id = b.id AND qe.status = ANY (ARRAY['waiting'::queue_status, 'in_progress'::queue_status]) AND date(qe.checked_in_at) = CURRENT_DATE
  WHERE b.is_active = true
  GROUP BY b.id, b.name;
