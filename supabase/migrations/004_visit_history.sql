-- ============================================
-- Monaco Smart Barber - Visit History & Client Profile
-- ============================================

-- Add notes and tags to visits
ALTER TABLE visits ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE visits ADD COLUMN IF NOT EXISTS tags TEXT[];

-- Visit photos
CREATE TABLE visit_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_visit_photos_visit ON visit_photos(visit_id);

ALTER TABLE visit_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "visit_photos_read_all" ON visit_photos FOR SELECT USING (true);
CREATE POLICY "visit_photos_manage_owner" ON visit_photos FOR ALL USING (is_admin_or_owner());
CREATE POLICY "visit_photos_insert_anon" ON visit_photos FOR INSERT WITH CHECK (true);

-- Configurable service tags
CREATE TABLE service_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE service_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_tags_read_all" ON service_tags FOR SELECT USING (true);
CREATE POLICY "service_tags_manage_owner" ON service_tags FOR ALL USING (is_admin_or_owner());

-- Supabase Storage bucket for visit photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('visit-photos', 'visit-photos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "visit_photos_storage_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'visit-photos');

CREATE POLICY "visit_photos_storage_insert" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'visit-photos');

CREATE POLICY "visit_photos_storage_delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'visit-photos' AND is_admin_or_owner());
