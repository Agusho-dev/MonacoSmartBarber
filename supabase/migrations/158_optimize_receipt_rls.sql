-- ============================================================
-- Migración 158: Optimizar RLS de comprobantes (auth_rls_initplan)
-- ============================================================
-- Best practice Supabase: envolver auth.uid() en (SELECT auth.uid()) para que
-- se evalúe UNA vez por query en vez de por fila. Impacto real bajo (el dashboard
-- usa service role), pero limpia el advisor y es correcto. Idempotente.
-- ============================================================

DROP POLICY IF EXISTS payment_receipts_org_read ON public.payment_receipts;
CREATE POLICY payment_receipts_org_read ON public.payment_receipts
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_members WHERE user_id = (SELECT auth.uid())
    )
    OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS transfer_receipt_settings_org_read ON public.transfer_receipt_settings;
CREATE POLICY transfer_receipt_settings_org_read ON public.transfer_receipt_settings
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_members WHERE user_id = (SELECT auth.uid())
    )
    OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS transfer_receipts_org_read ON storage.objects;
CREATE POLICY transfer_receipts_org_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'transfer-receipts'
    AND (
      EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = (SELECT auth.uid()))
      OR (storage.foldername(name))[1]::uuid IN (
        SELECT organization_id FROM public.organization_members WHERE user_id = (SELECT auth.uid())
      )
    )
  );
