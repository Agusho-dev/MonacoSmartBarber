-- Add avatar_url column to staff table
ALTER TABLE staff ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Create the staff-avatars storage bucket (public)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'staff-avatars',
  'staff-avatars',
  true,
  5242880, -- 5 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access to staff avatars
CREATE POLICY "Staff avatars are publicly accessible"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'staff-avatars');

-- Allow authenticated users to upload/update staff avatars
CREATE POLICY "Authenticated users can upload staff avatars"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'staff-avatars' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update staff avatars"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'staff-avatars' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete staff avatars"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'staff-avatars' AND auth.role() = 'authenticated');
