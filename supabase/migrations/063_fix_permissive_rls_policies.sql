-- =============================================================================
-- 063_fix_permissive_rls_policies.sql
-- Arregla políticas RLS demasiado permisivas en tablas clave.
-- branches, staff, services, app_settings mostraban datos cross-org.
-- =============================================================================

-- BRANCHES: cambiar de "is_active = true" a org-scoped
-- Kiosk/TV usan createAdminClient() (bypasea RLS), no se ven afectados.
-- Mobile usa get_user_org_id() via auth, funciona correctamente.
DROP POLICY IF EXISTS "branches_read_by_org" ON branches;
CREATE POLICY "branches_read_by_org" ON branches
  FOR SELECT USING (
    organization_id = get_user_org_id()
    OR (is_active = true AND get_user_org_id() IS NULL)  -- fallback solo para anon sin org
  );

-- STAFF: quitar el OR que expone barberos de otras orgs
DROP POLICY IF EXISTS "staff_read_by_org" ON staff;
CREATE POLICY "staff_read_by_org" ON staff
  FOR SELECT USING (
    organization_id = get_user_org_id()
    OR (is_active = true AND hidden_from_checkin = false AND get_user_org_id() IS NULL)
  );

-- SERVICES: quitar services_public_read que muestra todos los servicios activos
DROP POLICY IF EXISTS "services_public_read" ON services;
-- services_read_by_org ya filtra por org via branch, la dejamos

-- APP_SETTINGS: quitar app_settings_public_read que muestra todo
DROP POLICY IF EXISTS "app_settings_public_read" ON app_settings;
-- settings_read_by_org ya filtra por org, la dejamos
