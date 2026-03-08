-- Add staff status for pause/available toggle
CREATE TYPE staff_status AS ENUM ('available', 'paused');
ALTER TABLE staff ADD COLUMN status staff_status NOT NULL DEFAULT 'available';

-- Update branch_occupancy view to exclude paused barbers from available count
CREATE OR REPLACE VIEW branch_occupancy AS
SELECT
  b.id AS branch_id,
  b.name AS branch_name,
  COUNT(CASE WHEN qe.status = 'waiting' THEN 1 END) AS clients_waiting,
  COUNT(CASE WHEN qe.status = 'in_progress' THEN 1 END) AS clients_in_progress,
  (SELECT COUNT(*) FROM staff s WHERE s.branch_id = b.id AND s.role = 'barber' AND s.is_active = true) AS total_barbers,
  (SELECT COUNT(*) FROM staff s WHERE s.branch_id = b.id AND s.role = 'barber' AND s.is_active = true
    AND s.status = 'available'
    AND s.id NOT IN (SELECT qe2.barber_id FROM queue_entries qe2 WHERE qe2.branch_id = b.id AND qe2.status = 'in_progress' AND qe2.barber_id IS NOT NULL)
  ) AS available_barbers
FROM branches b
LEFT JOIN queue_entries qe ON qe.branch_id = b.id
  AND qe.status IN ('waiting', 'in_progress')
  AND DATE(qe.checked_in_at) = CURRENT_DATE
WHERE b.is_active = true
GROUP BY b.id, b.name;
