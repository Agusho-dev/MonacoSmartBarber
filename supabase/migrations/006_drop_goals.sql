-- ============================================
-- Remove Metas/Goals module
-- ============================================

DROP TRIGGER IF EXISTS trg_goals_updated_at ON goals;
DROP POLICY IF EXISTS "goals_read_all" ON goals;
DROP POLICY IF EXISTS "goals_manage_owner" ON goals;
DROP TABLE IF EXISTS goals;
