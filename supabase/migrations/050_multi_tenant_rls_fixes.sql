-- ============================================================
-- Migracion 050: Fixes RLS (queue_entries & services)
-- ============================================================
-- Se eliminan los accesos publicos totales (USING true o OR true)
-- para queue_entries y services.
-- ============================================================

-- ============================================================
-- 1. queue_entries
-- ============================================================
DROP POLICY IF EXISTS "queue_select_all" ON queue_entries;
DROP POLICY IF EXISTS "queue_insert_all" ON queue_entries;
DROP POLICY IF EXISTS "queue_update_all" ON queue_entries;
DROP POLICY IF EXISTS "queue_delete_staff" ON queue_entries;
DROP POLICY IF EXISTS "Allow all access to queue_entries" ON queue_entries;
DROP POLICY IF EXISTS "public_queue_entries_read" ON queue_entries;

CREATE POLICY "queue_entries_read_by_org" ON queue_entries FOR SELECT
USING (
  branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
);

CREATE POLICY "queue_entries_manage_by_org" ON queue_entries FOR ALL
USING (
  branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
)
WITH CHECK (
  branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
);

-- ============================================================
-- 2. services
-- ============================================================
DROP POLICY IF EXISTS "services_read_by_org" ON services;

CREATE POLICY "services_read_by_org" ON services FOR SELECT
USING (
  branch_id IS NULL
  OR branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
);
