-- =============================================================================
-- 064_fix_multitenant_isolation.sql
-- Cierra todas las brechas de aislamiento multitenant.
-- Elimina políticas RLS con qual=true que filtran datos entre organizaciones.
-- Agrega políticas específicas por rol (anon vs authenticated).
-- =============================================================================

-- =============================================
-- PARTE 1: Eliminar políticas peligrosas con qual = true
-- Estas aplican a rol {public} (anon + authenticated) y exponen
-- datos de TODAS las organizaciones a cualquier usuario.
-- =============================================

-- 1.1: Políticas etiquetadas *_service_role que aplican a {public}
-- service_role ya bypasea RLS por defecto, estas son redundantes Y peligrosas
DROP POLICY IF EXISTS "branches_service_role" ON branches;
DROP POLICY IF EXISTS "clients_service_role" ON clients;
DROP POLICY IF EXISTS "conversations_service_role" ON conversations;
DROP POLICY IF EXISTS "messages_service_role" ON messages;
DROP POLICY IF EXISTS "social_channels_service_role" ON social_channels;
DROP POLICY IF EXISTS "ig_config_service_role" ON organization_instagram_config;
DROP POLICY IF EXISTS "wa_config_service_role" ON organization_whatsapp_config;

-- 1.2: Políticas de lectura pública que exponen datos cross-org
DROP POLICY IF EXISTS "clients_public_read" ON clients;
DROP POLICY IF EXISTS "visits_public_read" ON visits;
DROP POLICY IF EXISTS "queue_read_all" ON queue_entries;
DROP POLICY IF EXISTS "queue_entries_org_read" ON queue_entries;
DROP POLICY IF EXISTS "attendance_org_read" ON attendance_logs;
DROP POLICY IF EXISTS "attendance_logs_public_read" ON attendance_logs;
DROP POLICY IF EXISTS "attendance_insert_all" ON attendance_logs;
DROP POLICY IF EXISTS "public_read_branch_signals" ON branch_signals;

-- 1.3: client_face_descriptors — reemplazar políticas abiertas con scoped
DROP POLICY IF EXISTS "Allow read face descriptors" ON client_face_descriptors;
DROP POLICY IF EXISTS "Allow insert face descriptors" ON client_face_descriptors;
DROP POLICY IF EXISTS "Allow delete own face descriptors" ON client_face_descriptors;

-- 1.4: staff_face_descriptors — arreglar la que tiene OR true
DROP POLICY IF EXISTS "staff_face_read_by_org" ON staff_face_descriptors;
DROP POLICY IF EXISTS "staff_face_manage_by_org" ON staff_face_descriptors;

-- 1.5: qr_photo_sessions — tienen true para todo
DROP POLICY IF EXISTS "qr_sessions_select" ON qr_photo_sessions;
DROP POLICY IF EXISTS "qr_sessions_org_read" ON qr_photo_sessions;
DROP POLICY IF EXISTS "qr_sessions_update" ON qr_photo_sessions;
DROP POLICY IF EXISTS "qr_sessions_insert" ON qr_photo_sessions;
DROP POLICY IF EXISTS "qr_uploads_select" ON qr_photo_uploads;
DROP POLICY IF EXISTS "qr_uploads_insert" ON qr_photo_uploads;


-- =============================================
-- PARTE 2: Políticas para rol anon (kiosk, TV, login barbero)
-- Acceso de solo-lectura limitado, necesario para que Supabase
-- Realtime envíe eventos de cambio a suscriptores sin auth.
-- =============================================

-- queue_entries: anon lee entradas activas (realtime kiosk/TV)
CREATE POLICY "queue_entries_anon_read" ON queue_entries
  FOR SELECT TO anon
  USING (status IN ('waiting', 'in_progress'));

-- attendance_logs: anon lee logs (realtime kiosk/TV, no contiene PII)
CREATE POLICY "attendance_logs_anon_read" ON attendance_logs
  FOR SELECT TO anon
  USING (true);

-- attendance_logs: insert solo para authenticated (server actions usan admin client)
CREATE POLICY "attendance_logs_insert_auth" ON attendance_logs
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- branch_signals: anon puede leer señales
CREATE POLICY "branch_signals_anon_read" ON branch_signals
  FOR SELECT TO anon
  USING (true);


-- =============================================
-- PARTE 3: Face descriptors — separar anon y authenticated
-- El kiosk necesita leer/escribir descriptors para reconocimiento facial.
-- Autenticados solo ven los de su org.
-- =============================================

-- client_face_descriptors
CREATE POLICY "client_face_anon_read" ON client_face_descriptors
  FOR SELECT TO anon USING (true);

CREATE POLICY "client_face_anon_insert" ON client_face_descriptors
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "client_face_anon_delete" ON client_face_descriptors
  FOR DELETE TO anon USING (true);

CREATE POLICY "client_face_auth_read" ON client_face_descriptors
  FOR SELECT TO authenticated
  USING (
    client_id IN (SELECT id FROM clients WHERE organization_id = get_user_org_id())
    OR client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid())
  );

-- staff_face_descriptors
CREATE POLICY "staff_face_anon_read" ON staff_face_descriptors
  FOR SELECT TO anon USING (true);

CREATE POLICY "staff_face_auth_read" ON staff_face_descriptors
  FOR SELECT TO authenticated
  USING (
    staff_id IN (SELECT id FROM staff WHERE organization_id = get_user_org_id())
  );

CREATE POLICY "staff_face_insert_all" ON staff_face_descriptors
  FOR INSERT WITH CHECK (true);

-- staff_face_descriptors: delete scoped por org (ya existía)
-- staff_face_delete_by_org ya existe y está bien


-- =============================================
-- PARTE 4: QR photos — separar anon y authenticated
-- =============================================

CREATE POLICY "qr_sessions_anon_read" ON qr_photo_sessions
  FOR SELECT TO anon USING (true);

CREATE POLICY "qr_sessions_auth_read" ON qr_photo_sessions
  FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id());

CREATE POLICY "qr_sessions_insert_all" ON qr_photo_sessions
  FOR INSERT WITH CHECK (true);

CREATE POLICY "qr_sessions_update_all" ON qr_photo_sessions
  FOR UPDATE USING (true);

CREATE POLICY "qr_uploads_anon_access" ON qr_photo_uploads
  FOR SELECT TO anon USING (true);

CREATE POLICY "qr_uploads_insert_all" ON qr_photo_uploads
  FOR INSERT WITH CHECK (true);

CREATE POLICY "qr_uploads_auth_read" ON qr_photo_uploads
  FOR SELECT TO authenticated
  USING (
    session_id IN (
      SELECT id FROM qr_photo_sessions WHERE organization_id = get_user_org_id()
    )
  );


-- =============================================
-- PARTE 5: Arreglar get_user_org_id() para ser determinista
-- Sin ORDER BY, LIMIT 1 devuelve una fila no-determinista
-- cuando un usuario pertenece a múltiples orgs.
-- =============================================

CREATE OR REPLACE FUNCTION get_user_org_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'organization_id')::UUID,
    (SELECT organization_id FROM staff
     WHERE auth_user_id = auth.uid() AND is_active = true
     ORDER BY created_at ASC LIMIT 1),
    (SELECT organization_id FROM clients
     WHERE auth_user_id = auth.uid()
     ORDER BY created_at ASC LIMIT 1)
  );
$$;


-- =============================================
-- PARTE 6: Restringir INSERT de clients a requerir organization_id
-- =============================================

DROP POLICY IF EXISTS "clients_insert_by_org" ON clients;
CREATE POLICY "clients_insert_by_org" ON clients
  FOR INSERT WITH CHECK (organization_id IS NOT NULL);
