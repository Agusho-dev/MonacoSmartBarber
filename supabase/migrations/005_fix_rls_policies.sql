-- ============================================
-- Fix RLS policies for visits and queue_entries
-- Barbers use PIN login (no Supabase Auth session),
-- so policies requiring auth.uid() block their access.
-- ============================================

-- visits: replace restrictive SELECT with permissive
DROP POLICY IF EXISTS "visits_read_staff" ON visits;
CREATE POLICY "visits_read_all" ON visits FOR SELECT USING (true);

-- visits: add UPDATE policy (was missing entirely)
CREATE POLICY "visits_update_all" ON visits FOR UPDATE USING (true);

-- queue_entries: replace restrictive UPDATE with permissive
DROP POLICY IF EXISTS "queue_update_staff" ON queue_entries;
CREATE POLICY "queue_update_all" ON queue_entries FOR UPDATE USING (true);
