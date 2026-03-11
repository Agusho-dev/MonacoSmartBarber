-- Fix client_loyalty_state: add trigger + backfill

-- 1. Create trigger function to upsert client_loyalty_state after a visit is completed
CREATE OR REPLACE FUNCTION update_client_loyalty_state()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO client_loyalty_state (client_id, total_visits, current_streak, last_visit_at)
  VALUES (
    NEW.client_id,
    1,
    1,
    NEW.completed_at
  )
  ON CONFLICT (client_id) DO UPDATE SET
    total_visits = client_loyalty_state.total_visits + 1,
    current_streak = client_loyalty_state.current_streak + 1,
    last_visit_at = GREATEST(client_loyalty_state.last_visit_at, NEW.completed_at),
    updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Add unique constraint on client_id if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_loyalty_state_client_id_key'
  ) THEN
    ALTER TABLE client_loyalty_state ADD CONSTRAINT client_loyalty_state_client_id_key UNIQUE (client_id);
  END IF;
END $$;

-- 3. Create the trigger
CREATE TRIGGER trg_update_loyalty_after_visit
  AFTER INSERT ON visits
  FOR EACH ROW
  WHEN (NEW.completed_at IS NOT NULL)
  EXECUTE FUNCTION update_client_loyalty_state();

-- 4. Backfill existing data from visits
INSERT INTO client_loyalty_state (client_id, total_visits, current_streak, last_visit_at)
SELECT
  v.client_id,
  COUNT(*)::int,
  COUNT(*)::int,
  MAX(v.completed_at)
FROM visits v
WHERE v.client_id IS NOT NULL AND v.completed_at IS NOT NULL
GROUP BY v.client_id
ON CONFLICT (client_id) DO UPDATE SET
  total_visits = EXCLUDED.total_visits,
  current_streak = EXCLUDED.current_streak,
  last_visit_at = EXCLUDED.last_visit_at,
  updated_at = now();
