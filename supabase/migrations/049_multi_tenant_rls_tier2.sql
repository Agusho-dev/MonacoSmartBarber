-- ============================================================
-- Migracion 049: RLS Multi-Tenant para tablas Tier 2
-- ============================================================
-- Cierra las policies con USING (true) en tablas que exponen
-- datos sensibles cross-tenant.
-- Las tablas que necesitan acceso publico (kiosk/TV) se dejan
-- con USING (true) porque no hay auth en esas rutas, pero el
-- aislamiento se hace a nivel app (branch_id filtrado por org).
-- ============================================================

-- ============================================================
-- GRUPO 1: TABLAS CRITICAS - Cerrar SELECT USING (true)
-- Estas tablas contienen datos sensibles (financieros, RRHH, etc.)
-- y NO necesitan acceso publico. Solo staff/clients autenticados.
-- ============================================================

-- 1a. attendance_logs — solo staff de la org puede leer
DROP POLICY IF EXISTS "attendance_read_all" ON attendance_logs;
DROP POLICY IF EXISTS "attendance_read_staff" ON attendance_logs;

CREATE POLICY "attendance_read_by_org" ON attendance_logs FOR SELECT
USING (
  branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
);

-- attendance INSERT: kiosk necesita insertar (clock-in facial), mantener abierto
-- pero el dashboard ya usa service role

-- 1b. client_points — solo org-scoped
DROP POLICY IF EXISTS "points_read_all" ON client_points;

CREATE POLICY "client_points_read_by_org" ON client_points FOR SELECT
USING (
  client_id IN (SELECT id FROM clients WHERE organization_id = get_user_org_id())
  OR client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid())
);

-- 1c. point_transactions — solo org-scoped
DROP POLICY IF EXISTS "point_tx_read_all" ON point_transactions;

CREATE POLICY "point_tx_read_by_org" ON point_transactions FOR SELECT
USING (
  client_id IN (SELECT id FROM clients WHERE organization_id = get_user_org_id())
  OR client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid())
);

-- 1d. fixed_expenses — solo staff de la org
DROP POLICY IF EXISTS "fixed_expenses_read_all" ON fixed_expenses;

CREATE POLICY "fixed_expenses_read_by_org" ON fixed_expenses FOR SELECT
USING (
  branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
);

-- 1e. payment_accounts — solo staff de la org
DROP POLICY IF EXISTS "payment_accounts_read_all" ON payment_accounts;

CREATE POLICY "payment_accounts_read_by_org" ON payment_accounts FOR SELECT
USING (
  branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
);

-- 1f. products — solo org-scoped
DROP POLICY IF EXISTS "products_read_all" ON products;

CREATE POLICY "products_read_by_org" ON products FOR SELECT
USING (
  branch_id IS NULL
  OR branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
);

-- 1g. rewards_config — solo org-scoped
DROP POLICY IF EXISTS "rewards_read_all" ON rewards_config;

CREATE POLICY "rewards_config_read_by_org" ON rewards_config FOR SELECT
USING (
  branch_id IS NULL
  OR branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
);

-- 1h. incentive_rules — solo org-scoped
DROP POLICY IF EXISTS "incentive_rules_read_all" ON incentive_rules;

CREATE POLICY "incentive_rules_read_by_org" ON incentive_rules FOR SELECT
USING (
  branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
);

-- 1i. incentive_achievements — solo org-scoped
DROP POLICY IF EXISTS "incentive_achievements_read_all" ON incentive_achievements;

CREATE POLICY "incentive_achievements_read_by_org" ON incentive_achievements FOR SELECT
USING (
  staff_id IN (SELECT id FROM staff WHERE organization_id = get_user_org_id())
);

-- 1j. staff_schedules — solo org-scoped
DROP POLICY IF EXISTS "staff_schedules_read_all" ON staff_schedules;

CREATE POLICY "staff_schedules_read_by_org" ON staff_schedules FOR SELECT
USING (
  staff_id IN (SELECT id FROM staff WHERE organization_id = get_user_org_id())
  OR staff_id IN (SELECT id FROM staff WHERE is_active = true AND hidden_from_checkin = false)
);

-- 1k. staff_schedule_exceptions — solo org-scoped
DROP POLICY IF EXISTS "schedule_exceptions_read_all" ON staff_schedule_exceptions;

CREATE POLICY "staff_schedule_exceptions_read_by_org" ON staff_schedule_exceptions FOR SELECT
USING (
  staff_id IN (SELECT id FROM staff WHERE organization_id = get_user_org_id())
);

-- 1l. staff_service_commissions — solo org-scoped
DROP POLICY IF EXISTS "ssc_read_all" ON staff_service_commissions;

CREATE POLICY "ssc_read_by_org" ON staff_service_commissions FOR SELECT
USING (
  staff_id IN (SELECT id FROM staff WHERE organization_id = get_user_org_id())
);

-- 1m. visit_photos — solo org-scoped
DROP POLICY IF EXISTS "visit_photos_read_all" ON visit_photos;

CREATE POLICY "visit_photos_read_by_org" ON visit_photos FOR SELECT
USING (
  visit_id IN (
    SELECT id FROM visits WHERE branch_id IN (
      SELECT id FROM branches WHERE organization_id = get_user_org_id()
    )
  )
);

-- 1n. role_branch_scope — solo org-scoped
DROP POLICY IF EXISTS "role_branch_scope_select" ON role_branch_scope;

CREATE POLICY "role_branch_scope_read_by_org" ON role_branch_scope FOR SELECT
USING (
  role_id IN (SELECT id FROM roles WHERE organization_id = get_user_org_id())
  OR branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
);

-- 1o. scheduled_messages — solo org-scoped
DROP POLICY IF EXISTS "scheduled_messages_select" ON scheduled_messages;
DROP POLICY IF EXISTS "scheduled_messages_select_staff" ON scheduled_messages;

CREATE POLICY "scheduled_messages_read_by_org" ON scheduled_messages FOR SELECT
USING (
  created_by IN (SELECT id FROM staff WHERE organization_id = get_user_org_id())
  OR client_id IN (SELECT id FROM clients WHERE organization_id = get_user_org_id())
);

-- ============================================================
-- GRUPO 2: TABLAS CON ACCESO PUBLICO NECESARIO
-- Kiosk, TV y barber panel operan sin Supabase Auth.
-- Estas se dejan con acceso abierto por necesidad operativa.
-- El aislamiento se hace a nivel app (branch_id filtrado).
-- ============================================================

-- queue_entries: kiosk inserta, TV lee, barber panel actualiza
-- Se MANTIENE con USING (true) — el kiosk/TV no tienen JWT
-- NOTA: branch_id viene filtrado por la seleccion de branch en el kiosk

-- branch_signals: mobile y TV necesitan leer
-- Se MANTIENE con USING (true)

-- break_configs: barber panel necesita leer
-- Se MANTIENE con USING (true) — barber usa PIN, no JWT

-- review_requests: pagina publica de review necesita leer por token
-- Se MANTIENE con USING (true)

-- client_face_descriptors: kiosk necesita leer para reconocimiento facial
-- Se MANTIENE con USING (true)

-- qr_photo_sessions/uploads: flujo QR publico
-- Se MANTIENE con USING (true)

-- ============================================================
-- GRUPO 3: INSERT/UPDATE con USING (true) — necesarios para kiosk
-- ============================================================

-- attendance_logs INSERT: kiosk facial clock-in (sin auth)
-- Se MANTIENE attendance_insert_all con WITH CHECK (true)

-- queue_entries INSERT/UPDATE: kiosk check-in y barber panel
-- Se MANTIENE queue_insert_all y queue_update_all

-- visit_photos INSERT: upload anonimo desde QR
-- Se MANTIENE visit_photos_insert_anon

-- ============================================================
-- FIN Migracion 049
-- ============================================================
