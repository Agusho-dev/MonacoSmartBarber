-- Bucket para logos de organizaciones
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'branding',
  'branding',
  true,
  5242880, -- 5MB
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO NOTHING;

-- Politica de lectura publica
CREATE POLICY IF NOT EXISTS "branding_public_read" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'branding');

-- Politica de escritura para usuarios autenticados
CREATE POLICY IF NOT EXISTS "branding_auth_insert" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'branding');

CREATE POLICY IF NOT EXISTS "branding_auth_update" ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'branding');
