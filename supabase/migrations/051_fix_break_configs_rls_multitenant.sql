-- =============================================================================
-- Migración 051: Corrige RLS de break_configs para multi-tenant
-- Las políticas anteriores no filtraban por organización.
-- Ahora se filtran a través de branches.organization_id.
-- =============================================================================

-- Eliminar políticas viejas que no eran org-aware
DROP POLICY IF EXISTS "break_configs_read_all" ON break_configs;
DROP POLICY IF EXISTS "break_configs_manage_owner" ON break_configs;

-- Lectura: solo configs de branches de la misma organización
CREATE POLICY "break_configs_read_by_org" ON break_configs FOR SELECT
USING (
  branch_id IN (
    SELECT id FROM branches WHERE organization_id = get_user_org_id()
  )
);

-- Gestión completa: solo staff activo owner/admin de la misma organización
CREATE POLICY "break_configs_manage_by_org" ON break_configs FOR ALL
USING (
  branch_id IN (
    SELECT id FROM branches WHERE organization_id = get_user_org_id()
  )
  AND EXISTS (
    SELECT 1 FROM staff
    WHERE staff.auth_user_id = auth.uid()
      AND staff.is_active = true
      AND staff.organization_id = get_user_org_id()
      AND staff.role IN ('owner', 'admin')
  )
)
WITH CHECK (
  branch_id IN (
    SELECT id FROM branches WHERE organization_id = get_user_org_id()
  )
  AND EXISTS (
    SELECT 1 FROM staff
    WHERE staff.auth_user_id = auth.uid()
      AND staff.is_active = true
      AND staff.organization_id = get_user_org_id()
      AND staff.role IN ('owner', 'admin')
  )
);
