-- ============================================================
-- Migracion 058: Correccion integral de RLS multi-tenant
-- ============================================================
-- Esta migracion corrige multiples vulnerabilidades de seguridad
-- que quedaron abiertas tras las migraciones 048-051:
--
--   SECCION 1: DROP policies legacy con USING(true) que anulan
--              las nuevas policies org-scoped (OR logic en PG)
--   SECCION 2: Agregar policies a tablas con RLS habilitado
--              pero sin policies (acceso nulo)
--   SECCION 3: Habilitar RLS en tablas sin proteccion
--   SECCION 4: Cerrar policies INSERT/SELECT abiertas sin org scope
--   SECCION 5: Agregar policies INSERT/DELETE faltantes
--
-- NOTA: El dashboard usa createAdminClient() (service role) que
-- bypasea RLS. Estas policies protegen: mobile app, public routes,
-- y cualquier futuro acceso via API.
-- ============================================================


-- ============================================================
-- SECCION 1: DROP POLICIES LEGACY QUE ANULAN AISLAMIENTO
-- ============================================================
-- En PostgreSQL, multiples policies PERMISSIVE en la misma tabla
-- se combinan con OR. Si existe una policy USING(true) junto con
-- una org-scoped, la USING(true) SIEMPRE gana.
--
-- Migraciones 048-051 crearon policies org-scoped pero NO
-- eliminaron las legacy _manage_owner / _manage_staff / etc.
-- ============================================================

-- 1a. fixed_expenses: legacy manage_owner sin org scope
-- 003 creo fixed_expenses_manage_owner FOR ALL USING(is_admin_or_owner())
-- 049 solo elimino fixed_expenses_read_all pero NO el manage
DROP POLICY IF EXISTS "fixed_expenses_manage_owner" ON fixed_expenses;

-- 1b. payment_accounts: legacy manage_owner sin org scope
-- 011 creo payment_accounts_manage_owner FOR ALL USING(...)
-- 049 solo elimino payment_accounts_read_all
DROP POLICY IF EXISTS "payment_accounts_manage_owner" ON payment_accounts;

-- 1c. incentive_rules: legacy manage_owner sin org scope
-- 015 creo incentive_rules_manage_owner FOR ALL
-- 049 solo elimino incentive_rules_read_all
DROP POLICY IF EXISTS "incentive_rules_manage_owner" ON incentive_rules;

-- 1d. incentive_achievements: legacy manage_owner sin org scope
-- 015 creo incentive_achievements_manage_owner FOR ALL
-- 049 solo elimino incentive_achievements_read_all
DROP POLICY IF EXISTS "incentive_achievements_manage_owner" ON incentive_achievements;

-- 1e. staff_schedules: legacy manage_owner sin org scope
-- 012 creo staff_schedules_manage_owner FOR ALL
-- 049 solo elimino staff_schedules_read_all
DROP POLICY IF EXISTS "staff_schedules_manage_owner" ON staff_schedules;

-- 1f. staff_schedule_exceptions: legacy manage_owner sin org scope
-- 012 creo schedule_exceptions_manage_owner FOR ALL
-- 049 solo elimino schedule_exceptions_read_all
DROP POLICY IF EXISTS "schedule_exceptions_manage_owner" ON staff_schedule_exceptions;

-- 1g. staff_service_commissions: legacy manage_admin sin org scope
-- 023 creo ssc_manage_admin FOR ALL
-- 049 solo elimino ssc_read_all
DROP POLICY IF EXISTS "ssc_manage_admin" ON staff_service_commissions;

-- 1h. visit_photos: legacy manage_owner sin org scope
-- 004 creo visit_photos_manage_owner FOR ALL
-- 049 solo elimino visit_photos_read_all
DROP POLICY IF EXISTS "visit_photos_manage_owner" ON visit_photos;

-- 1i. visit_photos: INSERT abierto sin org scope
-- 004 creo visit_photos_insert_anon WITH CHECK(true)
-- Se mantiene el caso de uso QR pero se necesita scope
DROP POLICY IF EXISTS "visit_photos_insert_anon" ON visit_photos;

-- 1j. attendance_logs: legacy manage_owner sin org scope
-- 013 creo attendance_manage_owner FOR UPDATE
DROP POLICY IF EXISTS "attendance_manage_owner" ON attendance_logs;

-- 1k. rewards_config: legacy manage_owner sin org scope
-- 001 creo rewards_manage_owner FOR ALL
-- 049 solo elimino rewards_read_all
DROP POLICY IF EXISTS "rewards_manage_owner" ON rewards_config;

-- 1l. client_points: legacy manage_staff sin org scope
-- 001 creo points_manage_staff FOR ALL USING(is staff)
-- 049 solo elimino points_read_all
DROP POLICY IF EXISTS "points_manage_staff" ON client_points;

-- 1m. point_transactions: legacy insert_staff sin org scope
-- 001 creo point_tx_insert_staff FOR INSERT
-- 049 solo elimino point_tx_read_all
DROP POLICY IF EXISTS "point_tx_insert_staff" ON point_transactions;

-- 1n. queue_entries: legacy queue_read_all USING(true) sobrevivio
-- 001 creo queue_read_all FOR SELECT USING(true)
-- 050 elimino queue_select_all, queue_insert_all, queue_update_all,
--     queue_delete_staff, pero NO queue_read_all
DROP POLICY IF EXISTS "queue_read_all" ON queue_entries;

-- 1o. attendance_logs: INSERT abierto (kiosk) - se restringe
-- 013 creo attendance_insert_all WITH CHECK(true)
-- El kiosk/reconocimiento facial necesita insertar pero debe
-- estar scoped a branches de la org
DROP POLICY IF EXISTS "attendance_insert_all" ON attendance_logs;

-- 1p. staff_face_descriptors: SELECT abierto (OR true anula scope)
-- 048 creo staff_face_read_by_org con OR true y staff_face_manage_by_org WITH CHECK(true)
DROP POLICY IF EXISTS "staff_face_read_by_org" ON staff_face_descriptors;
DROP POLICY IF EXISTS "staff_face_manage_by_org" ON staff_face_descriptors;

-- 1q. services: la policy services_manage_by_org de 048 tiene OR true implicito
-- porque el SELECT ya tiene OR true — Corregido en 050.
-- Verificar que no queden policies de 048 abiertas:
DROP POLICY IF EXISTS "services_manage_owner" ON services;

-- 1r. clients: clients_update_own de 035 sobrevivio junto con clients_update_by_org de 048
-- No es critico (self-update) pero limpiamos duplicado
DROP POLICY IF EXISTS "clients_update_own" ON clients;

-- 1s. visits: legacy visits_read_staff de 035 puede sobrevivir
-- 048 creo visits_read_by_org pero 035 tenia visits_read_staff y visits_read_own_client
DROP POLICY IF EXISTS "visits_read_staff" ON visits;
DROP POLICY IF EXISTS "visits_read_own_client" ON visits;


-- ============================================================
-- SECCION 2: POLICIES PARA TABLAS CON RLS HABILITADO SIN POLICIES
-- ============================================================
-- Estas tablas tienen ALTER TABLE ... ENABLE ROW LEVEL SECURITY
-- pero cero policies, lo que bloquea TODO acceso (incluso para
-- el anon key y usuarios autenticados).
-- ============================================================

-- 2a. conversation_tags (056) — tiene organization_id directo
CREATE POLICY "conversation_tags_select_by_org"
  ON conversation_tags FOR SELECT
  USING (organization_id = get_user_org_id());

CREATE POLICY "conversation_tags_insert_by_org"
  ON conversation_tags FOR INSERT
  WITH CHECK (
    organization_id = get_user_org_id()
    AND EXISTS (
      SELECT 1 FROM staff
      WHERE staff.auth_user_id = auth.uid()
        AND staff.is_active = true
        AND staff.organization_id = get_user_org_id()
    )
  );

CREATE POLICY "conversation_tags_update_by_org"
  ON conversation_tags FOR UPDATE
  USING (organization_id = get_user_org_id())
  WITH CHECK (organization_id = get_user_org_id());

CREATE POLICY "conversation_tags_delete_by_org"
  ON conversation_tags FOR DELETE
  USING (
    organization_id = get_user_org_id()
    AND is_org_admin_or_owner()
  );

-- 2b. conversation_tag_assignments (056) — hereda org via tag_id -> conversation_tags
CREATE POLICY "conversation_tag_assignments_select_by_org"
  ON conversation_tag_assignments FOR SELECT
  USING (
    tag_id IN (
      SELECT id FROM conversation_tags
      WHERE organization_id = get_user_org_id()
    )
  );

CREATE POLICY "conversation_tag_assignments_insert_by_org"
  ON conversation_tag_assignments FOR INSERT
  WITH CHECK (
    tag_id IN (
      SELECT id FROM conversation_tags
      WHERE organization_id = get_user_org_id()
    )
    AND EXISTS (
      SELECT 1 FROM staff
      WHERE staff.auth_user_id = auth.uid()
        AND staff.is_active = true
        AND staff.organization_id = get_user_org_id()
    )
  );

CREATE POLICY "conversation_tag_assignments_update_by_org"
  ON conversation_tag_assignments FOR UPDATE
  USING (
    tag_id IN (
      SELECT id FROM conversation_tags
      WHERE organization_id = get_user_org_id()
    )
  )
  WITH CHECK (
    tag_id IN (
      SELECT id FROM conversation_tags
      WHERE organization_id = get_user_org_id()
    )
  );

CREATE POLICY "conversation_tag_assignments_delete_by_org"
  ON conversation_tag_assignments FOR DELETE
  USING (
    tag_id IN (
      SELECT id FROM conversation_tags
      WHERE organization_id = get_user_org_id()
    )
  );

-- 2c. organization_instagram_config (055) — tiene organization_id directo
-- Solo staff admin/owner de la org puede acceder
CREATE POLICY "ig_config_select_by_org"
  ON organization_instagram_config FOR SELECT
  USING (organization_id = get_user_org_id());

CREATE POLICY "ig_config_insert_by_org"
  ON organization_instagram_config FOR INSERT
  WITH CHECK (
    organization_id = get_user_org_id()
    AND is_org_admin_or_owner()
  );

CREATE POLICY "ig_config_update_by_org"
  ON organization_instagram_config FOR UPDATE
  USING (organization_id = get_user_org_id() AND is_org_admin_or_owner())
  WITH CHECK (organization_id = get_user_org_id());

CREATE POLICY "ig_config_delete_by_org"
  ON organization_instagram_config FOR DELETE
  USING (organization_id = get_user_org_id() AND is_org_admin_or_owner());

-- 2d. client_loyalty_state (024, 047 agrego organization_id) — tiene organization_id directo
CREATE POLICY "client_loyalty_state_select_by_org"
  ON client_loyalty_state FOR SELECT
  USING (
    organization_id = get_user_org_id()
    OR client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid())
  );

CREATE POLICY "client_loyalty_state_insert_by_org"
  ON client_loyalty_state FOR INSERT
  WITH CHECK (organization_id = get_user_org_id());

CREATE POLICY "client_loyalty_state_update_by_org"
  ON client_loyalty_state FOR UPDATE
  USING (organization_id = get_user_org_id())
  WITH CHECK (organization_id = get_user_org_id());

CREATE POLICY "client_loyalty_state_delete_by_org"
  ON client_loyalty_state FOR DELETE
  USING (organization_id = get_user_org_id() AND is_org_admin_or_owner());


-- ============================================================
-- SECCION 3: HABILITAR RLS EN TABLAS SIN PROTECCION
-- ============================================================

-- 3a. transfer_logs — datos financieros expuestos
-- Tabla creada fuera de migraciones (via MCP/prod).
-- Tiene branch_id, hereda org via branches.organization_id.
ALTER TABLE IF EXISTS transfer_logs ENABLE ROW LEVEL SECURITY;

-- SELECT: solo staff de la org puede ver transferencias
CREATE POLICY "transfer_logs_select_by_org"
  ON transfer_logs FOR SELECT
  USING (
    branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
  );

-- INSERT: solo staff activo de la org
CREATE POLICY "transfer_logs_insert_by_org"
  ON transfer_logs FOR INSERT
  WITH CHECK (
    branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
    AND EXISTS (
      SELECT 1 FROM staff
      WHERE staff.auth_user_id = auth.uid()
        AND staff.is_active = true
        AND staff.organization_id = get_user_org_id()
    )
  );

-- UPDATE: solo admin/owner de la org
CREATE POLICY "transfer_logs_update_by_org"
  ON transfer_logs FOR UPDATE
  USING (
    branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
    AND is_org_admin_or_owner()
  )
  WITH CHECK (
    branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
  );

-- DELETE: solo admin/owner de la org
CREATE POLICY "transfer_logs_delete_by_org"
  ON transfer_logs FOR DELETE
  USING (
    branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
    AND is_org_admin_or_owner()
  );


-- ============================================================
-- SECCION 4: CERRAR POLICIES ABIERTAS SIN ORG SCOPE
-- ============================================================

-- 4a. client_face_descriptors — SELECT y INSERT completamente abiertos
-- El kiosk necesita leer para reconocimiento facial, pero debe
-- estar scoped a clientes de la misma org via clients.organization_id.
-- NOTA: No existe policy en migraciones para esta tabla (fue creada via MCP).
-- Aseguramos RLS habilitado y creamos policies desde cero.

ALTER TABLE IF EXISTS client_face_descriptors ENABLE ROW LEVEL SECURITY;

-- Eliminar cualquier policy legacy que exista
DROP POLICY IF EXISTS "Allow all access to client_face_descriptors" ON client_face_descriptors;
DROP POLICY IF EXISTS "client_face_descriptors_select" ON client_face_descriptors;
DROP POLICY IF EXISTS "client_face_descriptors_insert" ON client_face_descriptors;
DROP POLICY IF EXISTS "client_face_descriptors_update" ON client_face_descriptors;
DROP POLICY IF EXISTS "client_face_descriptors_delete" ON client_face_descriptors;

-- SELECT: staff de la org o kiosk que accede via branch -> org
CREATE POLICY "client_face_descriptors_select_by_org"
  ON client_face_descriptors FOR SELECT
  USING (
    client_id IN (SELECT id FROM clients WHERE organization_id = get_user_org_id())
  );

-- INSERT: staff activo de la org (kiosk usa service role)
CREATE POLICY "client_face_descriptors_insert_by_org"
  ON client_face_descriptors FOR INSERT
  WITH CHECK (
    client_id IN (SELECT id FROM clients WHERE organization_id = get_user_org_id())
  );

-- UPDATE: staff activo de la org
CREATE POLICY "client_face_descriptors_update_by_org"
  ON client_face_descriptors FOR UPDATE
  USING (
    client_id IN (SELECT id FROM clients WHERE organization_id = get_user_org_id())
  )
  WITH CHECK (
    client_id IN (SELECT id FROM clients WHERE organization_id = get_user_org_id())
  );

-- DELETE: solo admin/owner
CREATE POLICY "client_face_descriptors_delete_by_org"
  ON client_face_descriptors FOR DELETE
  USING (
    client_id IN (SELECT id FROM clients WHERE organization_id = get_user_org_id())
    AND is_org_admin_or_owner()
  );

-- 4b. staff_face_descriptors — INSERT abierto y SELECT con OR true
-- Recreamos policies correctas (ya eliminamos las legacy en seccion 1)
-- Kiosk usa reconocimiento facial = necesita leer, pero debe ir via
-- staff de la misma org. El kiosk usa service role por lo que no afecta.

CREATE POLICY "staff_face_descriptors_select_by_org"
  ON staff_face_descriptors FOR SELECT
  USING (
    staff_id IN (SELECT id FROM staff WHERE organization_id = get_user_org_id())
  );

CREATE POLICY "staff_face_descriptors_insert_by_org"
  ON staff_face_descriptors FOR INSERT
  WITH CHECK (
    staff_id IN (SELECT id FROM staff WHERE organization_id = get_user_org_id())
  );

-- UPDATE: mantener el scope de org
CREATE POLICY "staff_face_descriptors_update_by_org"
  ON staff_face_descriptors FOR UPDATE
  USING (
    staff_id IN (SELECT id FROM staff WHERE organization_id = get_user_org_id())
  )
  WITH CHECK (
    staff_id IN (SELECT id FROM staff WHERE organization_id = get_user_org_id())
  );

-- DELETE: ya existe staff_face_delete_by_org de 048, la dejamos


-- ============================================================
-- SECCION 5: POLICIES DE REEMPLAZO PARA LEGACY ELIMINADAS
-- ============================================================
-- Las policies eliminadas en seccion 1 dejaron tablas sin
-- coverage de INSERT/UPDATE/DELETE. Creamos reemplazos org-scoped.
-- ============================================================

-- 5a. fixed_expenses — reemplazo de fixed_expenses_manage_owner
CREATE POLICY "fixed_expenses_manage_by_org"
  ON fixed_expenses FOR ALL
  USING (
    branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
    AND is_org_admin_or_owner()
  )
  WITH CHECK (
    branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
    AND is_org_admin_or_owner()
  );

-- 5b. payment_accounts — reemplazo de payment_accounts_manage_owner
CREATE POLICY "payment_accounts_manage_by_org"
  ON payment_accounts FOR ALL
  USING (
    branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
    AND is_org_admin_or_owner()
  )
  WITH CHECK (
    branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
    AND is_org_admin_or_owner()
  );

-- 5c. incentive_rules — reemplazo de incentive_rules_manage_owner
CREATE POLICY "incentive_rules_manage_by_org"
  ON incentive_rules FOR ALL
  USING (
    branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
    AND is_org_admin_or_owner()
  )
  WITH CHECK (
    branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
    AND is_org_admin_or_owner()
  );

-- 5d. incentive_achievements — reemplazo de incentive_achievements_manage_owner
CREATE POLICY "incentive_achievements_manage_by_org"
  ON incentive_achievements FOR ALL
  USING (
    staff_id IN (SELECT id FROM staff WHERE organization_id = get_user_org_id())
    AND is_org_admin_or_owner()
  )
  WITH CHECK (
    staff_id IN (SELECT id FROM staff WHERE organization_id = get_user_org_id())
    AND is_org_admin_or_owner()
  );

-- 5e. staff_schedules — reemplazo de staff_schedules_manage_owner
CREATE POLICY "staff_schedules_manage_by_org"
  ON staff_schedules FOR ALL
  USING (
    staff_id IN (SELECT id FROM staff WHERE organization_id = get_user_org_id())
    AND is_org_admin_or_owner()
  )
  WITH CHECK (
    staff_id IN (SELECT id FROM staff WHERE organization_id = get_user_org_id())
    AND is_org_admin_or_owner()
  );

-- 5f. staff_schedule_exceptions — reemplazo de schedule_exceptions_manage_owner
CREATE POLICY "schedule_exceptions_manage_by_org"
  ON staff_schedule_exceptions FOR ALL
  USING (
    staff_id IN (SELECT id FROM staff WHERE organization_id = get_user_org_id())
    AND is_org_admin_or_owner()
  )
  WITH CHECK (
    staff_id IN (SELECT id FROM staff WHERE organization_id = get_user_org_id())
    AND is_org_admin_or_owner()
  );

-- 5g. staff_service_commissions — reemplazo de ssc_manage_admin
CREATE POLICY "ssc_manage_by_org"
  ON staff_service_commissions FOR ALL
  USING (
    staff_id IN (SELECT id FROM staff WHERE organization_id = get_user_org_id())
    AND is_org_admin_or_owner()
  )
  WITH CHECK (
    staff_id IN (SELECT id FROM staff WHERE organization_id = get_user_org_id())
    AND is_org_admin_or_owner()
  );

-- 5h. visit_photos — reemplazo de manage_owner + insert_anon
-- INSERT: solo staff activo de la org (kiosk QR usa service role)
CREATE POLICY "visit_photos_insert_by_org"
  ON visit_photos FOR INSERT
  WITH CHECK (
    visit_id IN (
      SELECT id FROM visits WHERE branch_id IN (
        SELECT id FROM branches WHERE organization_id = get_user_org_id()
      )
    )
  );

-- UPDATE/DELETE: admin/owner de la org
CREATE POLICY "visit_photos_manage_by_org"
  ON visit_photos FOR ALL
  USING (
    visit_id IN (
      SELECT id FROM visits WHERE branch_id IN (
        SELECT id FROM branches WHERE organization_id = get_user_org_id()
      )
    )
    AND is_org_admin_or_owner()
  )
  WITH CHECK (
    visit_id IN (
      SELECT id FROM visits WHERE branch_id IN (
        SELECT id FROM branches WHERE organization_id = get_user_org_id()
      )
    )
  );

-- 5i. attendance_logs — reemplazo de manage_owner + insert_all
-- INSERT: solo para branches de la org (kiosk facial clock-in usa service role)
CREATE POLICY "attendance_insert_by_org"
  ON attendance_logs FOR INSERT
  WITH CHECK (
    branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
  );

-- UPDATE: admin/owner de la org
CREATE POLICY "attendance_update_by_org"
  ON attendance_logs FOR UPDATE
  USING (
    branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
    AND is_org_admin_or_owner()
  )
  WITH CHECK (
    branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
  );

-- DELETE: admin/owner de la org
CREATE POLICY "attendance_delete_by_org"
  ON attendance_logs FOR DELETE
  USING (
    branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
    AND is_org_admin_or_owner()
  );

-- 5j. rewards_config — reemplazo de rewards_manage_owner
CREATE POLICY "rewards_config_manage_by_org"
  ON rewards_config FOR ALL
  USING (
    (branch_id IS NULL OR branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id()))
    AND is_org_admin_or_owner()
  )
  WITH CHECK (
    (branch_id IS NULL OR branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id()))
    AND is_org_admin_or_owner()
  );

-- 5k. client_points — reemplazo de points_manage_staff
-- INSERT/UPDATE/DELETE: staff activo de la org
CREATE POLICY "client_points_manage_by_org"
  ON client_points FOR ALL
  USING (
    client_id IN (SELECT id FROM clients WHERE organization_id = get_user_org_id())
    AND EXISTS (
      SELECT 1 FROM staff
      WHERE staff.auth_user_id = auth.uid()
        AND staff.is_active = true
        AND staff.organization_id = get_user_org_id()
    )
  )
  WITH CHECK (
    client_id IN (SELECT id FROM clients WHERE organization_id = get_user_org_id())
  );

-- 5l. point_transactions — reemplazo de point_tx_insert_staff
-- INSERT: staff activo de la org
CREATE POLICY "point_tx_insert_by_org"
  ON point_transactions FOR INSERT
  WITH CHECK (
    client_id IN (SELECT id FROM clients WHERE organization_id = get_user_org_id())
    AND EXISTS (
      SELECT 1 FROM staff
      WHERE staff.auth_user_id = auth.uid()
        AND staff.is_active = true
        AND staff.organization_id = get_user_org_id()
    )
  );

-- UPDATE/DELETE: admin/owner (para correcciones)
CREATE POLICY "point_tx_manage_by_org"
  ON point_transactions FOR ALL
  USING (
    client_id IN (SELECT id FROM clients WHERE organization_id = get_user_org_id())
    AND is_org_admin_or_owner()
  )
  WITH CHECK (
    client_id IN (SELECT id FROM clients WHERE organization_id = get_user_org_id())
  );


-- ============================================================
-- SECCION 6: POLICIES INSERT/DELETE FALTANTES EN TABLAS
-- ============================================================
-- Muchas tablas solo tienen SELECT (y a veces UPDATE) policies.
-- Agregamos INSERT y DELETE org-scoped donde faltan.
-- ============================================================

-- 6a. organizations — falta INSERT/DELETE explicito
-- INSERT: solo para onboarding (setup_organization es SECURITY DEFINER)
-- Negamos INSERT/DELETE directo via RLS; solo via funciones DEFINER
DROP POLICY IF EXISTS "organizations_insert_deny" ON organizations;
CREATE POLICY "organizations_insert_deny"
  ON organizations FOR INSERT
  WITH CHECK (false);

DROP POLICY IF EXISTS "organizations_delete_deny" ON organizations;
CREATE POLICY "organizations_delete_deny"
  ON organizations FOR DELETE
  USING (false);

-- 6b. organization_members — falta INSERT/DELETE explicito
-- Manejo via org_members_manage_owner que ya tiene FOR ALL (047)
-- Pero necesitamos DELETE explicito para que el owner pueda remover
-- Verificamos que no sea redundante con el FOR ALL existente
-- El FOR ALL de 047 ya cubre INSERT/UPDATE/DELETE — OK

-- 6c. branches — falta INSERT/DELETE explicito
-- branches_manage_by_org_admin de 048 usa FOR ALL — ya cubre
-- Pero necesitamos policy explicita para INSERT que valide org_id
DROP POLICY IF EXISTS "branches_insert_by_org" ON branches;
CREATE POLICY "branches_insert_by_org"
  ON branches FOR INSERT
  WITH CHECK (
    organization_id = get_user_org_id()
    AND is_org_admin_or_owner()
  );

DROP POLICY IF EXISTS "branches_delete_by_org" ON branches;
CREATE POLICY "branches_delete_by_org"
  ON branches FOR DELETE
  USING (
    organization_id = get_user_org_id()
    AND is_org_admin_or_owner()
  );

-- 6d. staff — falta INSERT/DELETE explicito
DROP POLICY IF EXISTS "staff_insert_by_org" ON staff;
CREATE POLICY "staff_insert_by_org"
  ON staff FOR INSERT
  WITH CHECK (
    organization_id = get_user_org_id()
    AND is_org_admin_or_owner()
  );

DROP POLICY IF EXISTS "staff_delete_by_org" ON staff;
CREATE POLICY "staff_delete_by_org"
  ON staff FOR DELETE
  USING (
    organization_id = get_user_org_id()
    AND is_org_admin_or_owner()
  );

-- 6e. roles — roles_manage_by_org_owner de 048 usa FOR ALL — OK
-- Pero agregamos INSERT y DELETE explicitos por claridad
DROP POLICY IF EXISTS "roles_insert_by_org" ON roles;
CREATE POLICY "roles_insert_by_org"
  ON roles FOR INSERT
  WITH CHECK (
    organization_id = get_user_org_id()
    AND is_org_admin_or_owner()
  );

DROP POLICY IF EXISTS "roles_delete_by_org" ON roles;
CREATE POLICY "roles_delete_by_org"
  ON roles FOR DELETE
  USING (
    organization_id = get_user_org_id()
    AND is_org_admin_or_owner()
  );

-- 6f. services — services_manage_by_org de 048 usa FOR ALL — OK
-- Pero tiene branch_id scope, necesitamos INSERT y DELETE
DROP POLICY IF EXISTS "services_insert_by_org" ON services;
CREATE POLICY "services_insert_by_org"
  ON services FOR INSERT
  WITH CHECK (
    (branch_id IS NULL OR branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id()))
    AND is_org_admin_or_owner()
  );

DROP POLICY IF EXISTS "services_delete_by_org" ON services;
CREATE POLICY "services_delete_by_org"
  ON services FOR DELETE
  USING (
    (branch_id IS NULL OR branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id()))
    AND is_org_admin_or_owner()
  );

-- 6g. reward_catalog — reward_catalog_manage_by_org de 048 usa FOR ALL — OK
-- Pero agregar INSERT y DELETE explicitos
DROP POLICY IF EXISTS "reward_catalog_insert_by_org" ON reward_catalog;
CREATE POLICY "reward_catalog_insert_by_org"
  ON reward_catalog FOR INSERT
  WITH CHECK (
    organization_id = get_user_org_id()
    AND is_org_admin_or_owner()
  );

DROP POLICY IF EXISTS "reward_catalog_delete_by_org" ON reward_catalog;
CREATE POLICY "reward_catalog_delete_by_org"
  ON reward_catalog FOR DELETE
  USING (
    organization_id = get_user_org_id()
    AND is_org_admin_or_owner()
  );

-- 6h. organization_whatsapp_config — wa_config_by_org de 053 usa FOR ALL
-- Pero el FOR ALL no tiene admin check. Recreamos con proper scope.
DROP POLICY IF EXISTS "wa_config_by_org" ON organization_whatsapp_config;

CREATE POLICY "wa_config_select_by_org"
  ON organization_whatsapp_config FOR SELECT
  USING (organization_id = get_user_org_id());

CREATE POLICY "wa_config_insert_by_org"
  ON organization_whatsapp_config FOR INSERT
  WITH CHECK (
    organization_id = get_user_org_id()
    AND is_org_admin_or_owner()
  );

CREATE POLICY "wa_config_update_by_org"
  ON organization_whatsapp_config FOR UPDATE
  USING (organization_id = get_user_org_id() AND is_org_admin_or_owner())
  WITH CHECK (organization_id = get_user_org_id());

CREATE POLICY "wa_config_delete_by_org"
  ON organization_whatsapp_config FOR DELETE
  USING (organization_id = get_user_org_id() AND is_org_admin_or_owner());

-- 6i. salary_reports — tiene policies de 043 pero sin org scope
-- Las policies de 043 (salary_reports_select_staff, etc.) no filtran por org.
-- Un admin de org A puede ver reportes de org B.
DROP POLICY IF EXISTS "salary_reports_select_staff" ON salary_reports;
DROP POLICY IF EXISTS "salary_reports_insert_staff" ON salary_reports;
DROP POLICY IF EXISTS "salary_reports_update_staff" ON salary_reports;
DROP POLICY IF EXISTS "salary_reports_delete_staff" ON salary_reports;

CREATE POLICY "salary_reports_select_by_org"
  ON salary_reports FOR SELECT
  USING (
    branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
    AND EXISTS (
      SELECT 1 FROM staff
      WHERE staff.auth_user_id = auth.uid()
        AND staff.role IN ('owner', 'admin')
        AND staff.organization_id = get_user_org_id()
    )
  );

CREATE POLICY "salary_reports_insert_by_org"
  ON salary_reports FOR INSERT
  WITH CHECK (
    branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
    AND is_org_admin_or_owner()
  );

CREATE POLICY "salary_reports_update_by_org"
  ON salary_reports FOR UPDATE
  USING (
    branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
    AND is_org_admin_or_owner()
  )
  WITH CHECK (
    branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
  );

CREATE POLICY "salary_reports_delete_by_org"
  ON salary_reports FOR DELETE
  USING (
    branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
    AND is_org_admin_or_owner()
  );

-- 6j. salary_payment_batches — misma situacion que salary_reports
DROP POLICY IF EXISTS "salary_payment_batches_select_staff" ON salary_payment_batches;
DROP POLICY IF EXISTS "salary_payment_batches_insert_staff" ON salary_payment_batches;
DROP POLICY IF EXISTS "salary_payment_batches_update_staff" ON salary_payment_batches;
DROP POLICY IF EXISTS "salary_payment_batches_delete_staff" ON salary_payment_batches;

CREATE POLICY "salary_payment_batches_select_by_org"
  ON salary_payment_batches FOR SELECT
  USING (
    branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
    AND is_org_admin_or_owner()
  );

CREATE POLICY "salary_payment_batches_insert_by_org"
  ON salary_payment_batches FOR INSERT
  WITH CHECK (
    branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
    AND is_org_admin_or_owner()
  );

CREATE POLICY "salary_payment_batches_update_by_org"
  ON salary_payment_batches FOR UPDATE
  USING (
    branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
    AND is_org_admin_or_owner()
  )
  WITH CHECK (
    branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
  );

CREATE POLICY "salary_payment_batches_delete_by_org"
  ON salary_payment_batches FOR DELETE
  USING (
    branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
    AND is_org_admin_or_owner()
  );

-- 6k. clients — falta DELETE policy
DROP POLICY IF EXISTS "clients_delete_by_org" ON clients;
CREATE POLICY "clients_delete_by_org"
  ON clients FOR DELETE
  USING (
    organization_id = get_user_org_id()
    AND is_org_admin_or_owner()
  );


-- ============================================================
-- SECCION 7: INDICES PARA PERFORMANCE DE SUBQUERIES EN POLICIES
-- ============================================================
-- Las policies org-scoped usan subqueries frecuentes como:
--   branch_id IN (SELECT id FROM branches WHERE organization_id = ...)
-- Asegurar que idx_branches_org_id exista (creado en 047).
-- Agregar indices compuestos para los joins mas comunes.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_conversation_tags_org_id
  ON conversation_tags(organization_id);

CREATE INDEX IF NOT EXISTS idx_conversation_tag_assignments_tag_id
  ON conversation_tag_assignments(tag_id);

CREATE INDEX IF NOT EXISTS idx_transfer_logs_branch_id
  ON transfer_logs(branch_id);

CREATE INDEX IF NOT EXISTS idx_client_face_descriptors_client_id
  ON client_face_descriptors(client_id);


-- ============================================================
-- FIN Migracion 058
-- ============================================================
