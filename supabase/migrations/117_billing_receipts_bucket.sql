-- ============================================================
-- Migración 117: Bucket privado para recibos de pagos manuales
-- ============================================================
--
-- Estructura de paths: billing-receipts/{organization_id}/{payment_id}.{ext}
-- Sólo platform_admins suben/borran. Las orgs leen sólo lo suyo.
-- ============================================================

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'billing-receipts',
  'billing-receipts',
  false,
  5242880,    -- 5 MB
  ARRAY['image/jpeg','image/png','image/webp','application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Policies — las storage.objects ya tiene RLS habilitado por Supabase
DROP POLICY IF EXISTS billing_receipts_admin_write ON storage.objects;
CREATE POLICY billing_receipts_admin_write ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'billing-receipts'
    AND EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
  )
  WITH CHECK (
    bucket_id = 'billing-receipts'
    AND EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
  );

-- Las orgs leen sólo archivos en su propio prefix (org_id/...)
DROP POLICY IF EXISTS billing_receipts_org_read ON storage.objects;
CREATE POLICY billing_receipts_org_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'billing-receipts'
    AND (
      EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
      OR (
        -- El primer segmento del path es el organization_id
        (storage.foldername(name))[1]::uuid IN (
          SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
        )
      )
    )
  );

COMMIT;
