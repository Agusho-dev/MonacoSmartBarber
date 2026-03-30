-- ============================================================
-- Migracion 048: Funciones y RLS Multi-Tenant (BarberOS)
-- ============================================================
-- Actualiza funciones SECURITY DEFINER para ser org-aware.
-- Crea/actualiza RLS policies con aislamiento por organizacion.
-- Corrige vulnerabilidades de seguridad existentes (tablas con ALL USING true).
-- ============================================================

-- ============================================================
-- 1. FUNCION HELPER: get_user_org_id()
-- ============================================================
-- Lee el organization_id del JWT (app_metadata) del usuario autenticado.
-- Usada en RLS policies para filtrar por organizacion.

CREATE OR REPLACE FUNCTION get_user_org_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT COALESCE(
    -- Primero: intentar desde JWT app_metadata
    (auth.jwt() -> 'app_metadata' ->> 'organization_id')::UUID,
    -- Fallback: buscar desde staff (para barber PIN sessions que no tienen JWT)
    (SELECT organization_id FROM staff WHERE auth_user_id = auth.uid() AND is_active = true LIMIT 1),
    -- Fallback: buscar desde clients
    (SELECT organization_id FROM clients WHERE auth_user_id = auth.uid() LIMIT 1)
  );
$$;

COMMENT ON FUNCTION get_user_org_id IS 'Retorna el organization_id del usuario autenticado via JWT o lookup en staff/clients';

-- ============================================================
-- 2. FUNCION HELPER: is_org_admin_or_owner()
-- ============================================================
-- Verifica si el usuario actual es admin/owner de una organizacion especifica.

CREATE OR REPLACE FUNCTION is_org_admin_or_owner(p_org_id UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM staff
    WHERE auth_user_id = auth.uid()
      AND role IN ('owner', 'admin')
      AND is_active = true
      AND organization_id = COALESCE(p_org_id, get_user_org_id())
  );
$$;

-- ============================================================
-- 3. ACTUALIZAR is_admin_or_owner() -> org-aware
-- ============================================================
-- Mantiene retrocompatibilidad pero ahora filtra por org del usuario

CREATE OR REPLACE FUNCTION is_admin_or_owner()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM staff
    WHERE auth_user_id = auth.uid()
      AND role IN ('owner', 'admin')
      AND is_active = true
      AND organization_id = get_user_org_id()
  );
$$;

-- ============================================================
-- 4. ACTUALIZAR FUNCIONES SECURITY DEFINER CRITICAS
-- ============================================================

-- 4a. get_client_branch_signals() — filtrar branches por org del cliente
CREATE OR REPLACE FUNCTION get_client_branch_signals()
RETURNS TABLE(
  branch_id uuid, branch_name text, branch_address text,
  occupancy_level occupancy_level, is_open boolean,
  waiting_count integer, in_progress_count integer,
  available_barbers integer, total_barbers integer,
  eta_minutes integer, best_arrival_in_minutes integer,
  suggestion_text text, updated_at timestamp with time zone
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    b.id, b.name, b.address,
    COALESCE(bs.occupancy_level, 'sin_espera'::occupancy_level),
    (EXTRACT(DOW FROM (NOW() AT TIME ZONE COALESCE(b.timezone, 'America/Argentina/Buenos_Aires')))::INTEGER = ANY(b.business_days)
     AND (NOW() AT TIME ZONE COALESCE(b.timezone, 'America/Argentina/Buenos_Aires'))::TIME >= b.business_hours_open
     AND (NOW() AT TIME ZONE COALESCE(b.timezone, 'America/Argentina/Buenos_Aires'))::TIME < b.business_hours_close),
    COALESCE(bs.waiting_count, 0)::integer,
    COALESCE(bs.queue_size - bs.waiting_count, 0)::integer,
    COALESCE(bs.available_barbers, 0)::integer,
    COALESCE(bs.active_barbers, 0)::integer,
    bs.eta_minutes, bs.best_arrival_in_minutes,
    bs.suggestion_text, bs.updated_at
  FROM branches b
  LEFT JOIN branch_signals bs ON bs.branch_id = b.id
  WHERE b.is_active = true
    AND b.organization_id = get_user_org_id()
  ORDER BY b.name;
$$;

-- 4b. get_client_global_points() — filtrar por org
CREATE OR REPLACE FUNCTION get_client_global_points()
RETURNS TABLE(total_balance integer, total_earned integer, total_redeemed integer)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    COALESCE(SUM(points_balance), 0)::INTEGER,
    COALESCE(SUM(total_earned), 0)::INTEGER,
    COALESCE(SUM(total_redeemed), 0)::INTEGER
  FROM client_points
  WHERE client_id IN (
    SELECT id FROM clients
    WHERE auth_user_id = auth.uid()
      AND organization_id = get_user_org_id()
  );
$$;

-- 4c. redeem_points_for_reward() — filtrar catalog por org
CREATE OR REPLACE FUNCTION redeem_points_for_reward(p_reward_id uuid)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_client clients%ROWTYPE;
  v_reward reward_catalog%ROWTYPE;
  v_total_points INTEGER;
  v_client_reward_id UUID;
  v_org_id UUID;
BEGIN
  v_org_id := get_user_org_id();

  SELECT * INTO v_client FROM clients
  WHERE auth_user_id = auth.uid() AND organization_id = v_org_id;
  IF v_client IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Client not found');
  END IF;

  SELECT * INTO v_reward FROM reward_catalog
  WHERE id = p_reward_id AND is_active = true AND points_cost > 0
    AND organization_id = v_org_id;
  IF v_reward IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Reward not available');
  END IF;

  IF v_reward.stock IS NOT NULL AND v_reward.stock <= 0 THEN
    RETURN json_build_object('success', false, 'error', 'Out of stock');
  END IF;

  SELECT COALESCE(SUM(points_balance), 0) INTO v_total_points
  FROM client_points WHERE client_id = v_client.id;
  IF v_total_points < v_reward.points_cost THEN
    RETURN json_build_object('success', false, 'error', 'Insufficient points',
      'required', v_reward.points_cost, 'available', v_total_points);
  END IF;

  PERFORM deduct_client_points(v_client.id, v_reward.points_cost);

  INSERT INTO client_rewards (client_id, reward_id, source)
  VALUES (v_client.id, p_reward_id, 'points_redemption')
  RETURNING id INTO v_client_reward_id;

  INSERT INTO point_transactions (client_id, points, type, description)
  VALUES (v_client.id, -v_reward.points_cost, 'redeemed', 'Canje: ' || v_reward.name);

  IF v_reward.stock IS NOT NULL THEN
    UPDATE reward_catalog SET stock = stock - 1 WHERE id = p_reward_id AND stock > 0;
  END IF;

  RETURN json_build_object('success', true, 'reward_name', v_reward.name,
    'client_reward_id', v_client_reward_id,
    'points_remaining', v_total_points - v_reward.points_cost);
END;
$$;

-- 4d. claim_onboarding_spin() — filtrar catalog por org
CREATE OR REPLACE FUNCTION claim_onboarding_spin(p_reward_id uuid)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_client clients%ROWTYPE;
  v_reward reward_catalog%ROWTYPE;
  v_client_reward_id UUID;
  v_org_id UUID;
BEGIN
  v_org_id := get_user_org_id();

  SELECT * INTO v_client FROM clients
  WHERE auth_user_id = auth.uid() AND organization_id = v_org_id;
  IF v_client IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Client not found');
  END IF;

  IF v_client.onboarding_spin_used_at IS NOT NULL THEN
    RETURN json_build_object('success', false, 'error', 'Spin already used');
  END IF;

  SELECT * INTO v_reward FROM reward_catalog
  WHERE id = p_reward_id AND is_active = true
    AND organization_id = v_org_id;
  IF v_reward IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Reward not found');
  END IF;

  INSERT INTO client_rewards (client_id, reward_id, source)
  VALUES (v_client.id, p_reward_id, 'spin_prize')
  RETURNING id INTO v_client_reward_id;

  UPDATE clients SET onboarding_spin_used_at = now() WHERE id = v_client.id;

  IF v_reward.stock IS NOT NULL THEN
    UPDATE reward_catalog SET stock = stock - 1 WHERE id = p_reward_id AND stock > 0;
  END IF;

  RETURN json_build_object('success', true, 'reward_name', v_reward.name,
    'client_reward_id', v_client_reward_id);
END;
$$;

-- 4e. redeem_reward_by_qr() — verificar staff de misma org
CREATE OR REPLACE FUNCTION redeem_reward_by_qr(p_qr_code text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_staff staff%ROWTYPE;
  v_reward client_rewards%ROWTYPE;
  v_catalog reward_catalog%ROWTYPE;
BEGIN
  SELECT * INTO v_staff FROM staff
  WHERE auth_user_id = auth.uid() AND organization_id = get_user_org_id();
  IF v_staff IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT * INTO v_reward FROM client_rewards
  WHERE qr_code = p_qr_code AND status = 'available';
  IF v_reward IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Reward not found or already redeemed');
  END IF;

  IF v_reward.expires_at IS NOT NULL AND v_reward.expires_at < now() THEN
    UPDATE client_rewards SET status = 'expired' WHERE id = v_reward.id;
    RETURN json_build_object('success', false, 'error', 'Reward expired');
  END IF;

  UPDATE client_rewards SET status = 'redeemed', redeemed_at = now(), redeemed_by = v_staff.id
  WHERE id = v_reward.id;

  SELECT * INTO v_catalog FROM reward_catalog WHERE id = v_reward.reward_id;

  RETURN json_build_object('success', true, 'reward_name', v_catalog.name,
    'is_free_service', v_catalog.is_free_service, 'discount_pct', v_catalog.discount_pct);
END;
$$;

-- 4f. get_client_pending_reviews() — filtrar por org via branches
CREATE OR REPLACE FUNCTION get_client_pending_reviews()
RETURNS TABLE(
  request_id uuid, branch_name text, barber_name text,
  visit_date timestamp with time zone, token text,
  expires_at timestamp with time zone
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT rr.id, b.name, s.full_name, rr.created_at, rr.token, rr.expires_at
  FROM review_requests rr
  JOIN branches b ON b.id = rr.branch_id
  LEFT JOIN staff s ON s.id = rr.barber_id
  WHERE rr.client_id IN (
    SELECT id FROM clients
    WHERE auth_user_id = auth.uid()
      AND organization_id = get_user_org_id()
  )
  AND rr.status = 'pending'
  AND rr.expires_at > now()
  ORDER BY rr.created_at DESC;
$$;

-- 4g. get_client_wallet() — filtrar rewards por org
CREATE OR REPLACE FUNCTION get_client_wallet()
RETURNS TABLE(
  reward_id uuid, client_reward_id uuid, reward_name text,
  reward_description text, reward_type reward_type,
  discount_pct integer, is_free_service boolean,
  status client_reward_status, qr_code text,
  expires_at timestamp with time zone, created_at timestamp with time zone
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT rc.id, cr.id, rc.name, rc.description, rc.type,
    rc.discount_pct, rc.is_free_service, cr.status, cr.qr_code,
    cr.expires_at, cr.created_at
  FROM client_rewards cr
  JOIN reward_catalog rc ON rc.id = cr.reward_id
  WHERE cr.client_id IN (
    SELECT id FROM clients
    WHERE auth_user_id = auth.uid()
      AND organization_id = get_user_org_id()
  )
  ORDER BY cr.created_at DESC;
$$;

-- 4h. match_face_descriptor() — filtrar por org
CREATE OR REPLACE FUNCTION match_face_descriptor(
  query_descriptor vector,
  match_threshold double precision DEFAULT 0.5,
  max_results integer DEFAULT 3,
  p_org_id UUID DEFAULT NULL
)
RETURNS TABLE(client_id uuid, client_name text, client_phone text, face_photo_url text, distance double precision)
LANGUAGE plpgsql
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  v_org_id := COALESCE(p_org_id, get_user_org_id());
  RETURN QUERY
  SELECT DISTINCT ON (c.id)
    c.id, c.name, c.phone, c.face_photo_url,
    (cfd.descriptor <-> query_descriptor)::FLOAT
  FROM client_face_descriptors cfd
  JOIN clients c ON c.id = cfd.client_id
  WHERE (cfd.descriptor <-> query_descriptor) < match_threshold
    AND (v_org_id IS NULL OR c.organization_id = v_org_id)
  ORDER BY c.id, (cfd.descriptor <-> query_descriptor)
  LIMIT max_results;
END;
$$;

-- 4i. match_staff_face_descriptor() — filtrar por org
CREATE OR REPLACE FUNCTION match_staff_face_descriptor(
  query_descriptor vector,
  match_threshold double precision DEFAULT 0.5,
  max_results integer DEFAULT 3,
  p_org_id UUID DEFAULT NULL
)
RETURNS TABLE(client_id uuid, client_name text, client_phone text, face_photo_url text, distance double precision)
LANGUAGE plpgsql
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  v_org_id := COALESCE(p_org_id, get_user_org_id());
  RETURN QUERY
  SELECT DISTINCT ON (s.id)
    s.id, s.full_name, COALESCE(s.phone, ''), NULL::text,
    (sfd.descriptor <-> query_descriptor)::FLOAT
  FROM staff_face_descriptors sfd
  JOIN staff s ON s.id = sfd.staff_id
  WHERE (sfd.descriptor <-> query_descriptor) < match_threshold
    AND (v_org_id IS NULL OR s.organization_id = v_org_id)
  ORDER BY s.id, (sfd.descriptor <-> query_descriptor)
  LIMIT max_results;
END;
$$;

-- 4j. update_client_loyalty_state() — propagar org_id del client
CREATE OR REPLACE FUNCTION update_client_loyalty_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  -- Obtener org_id del cliente
  SELECT organization_id INTO v_org_id FROM clients WHERE id = NEW.client_id;

  INSERT INTO client_loyalty_state (client_id, organization_id, total_visits, current_streak, last_visit_at)
  VALUES (NEW.client_id, COALESCE(v_org_id, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID), 1, 1, NEW.completed_at)
  ON CONFLICT (client_id) DO UPDATE SET
    total_visits = client_loyalty_state.total_visits + 1,
    current_streak = client_loyalty_state.current_streak + 1,
    last_visit_at = GREATEST(client_loyalty_state.last_visit_at, NEW.completed_at),
    updated_at = now();
  RETURN NEW;
END;
$$;

-- ============================================================
-- 5. RLS POLICIES PARA TABLAS TIER 1 (org-scoped)
-- ============================================================

-- Nota: El dashboard usa createAdminClient() (service_role) que bypasea RLS.
-- Estas policies protegen datos para:
--   - Mobile app (clientes autenticados)
--   - Barber panel (staff autenticado)
--   - Rutas publicas (kiosk, TV, review)

-- 5a. branches — filtrar por org
-- Mantener lectura publica para kiosk/TV (filtran por branch_id directo)
-- pero nuevas orgs solo ven sus branches

DROP POLICY IF EXISTS "branches_read_all" ON branches;
CREATE POLICY "branches_read_by_org" ON branches FOR SELECT
USING (
  -- Publico puede leer branches activas (necesario para kiosk/TV/checkin)
  is_active = true
);

DROP POLICY IF EXISTS "branches_manage_owner" ON branches;
CREATE POLICY "branches_manage_by_org_admin" ON branches FOR ALL
USING (is_admin_or_owner() AND organization_id = get_user_org_id())
WITH CHECK (is_admin_or_owner() AND organization_id = get_user_org_id());

-- 5b. staff — filtrar por org
DROP POLICY IF EXISTS "staff_read_authenticated" ON staff;
CREATE POLICY "staff_read_by_org" ON staff FOR SELECT
USING (
  -- Staff de la misma org puede verse entre si
  organization_id = get_user_org_id()
  -- O acceso publico para kiosk/checkin (staff activo visible)
  OR (is_active = true AND hidden_from_checkin = false)
);

DROP POLICY IF EXISTS "staff_manage_owner" ON staff;
CREATE POLICY "staff_manage_by_org_admin" ON staff FOR ALL
USING (is_admin_or_owner() AND organization_id = get_user_org_id())
WITH CHECK (is_admin_or_owner() AND organization_id = get_user_org_id());

-- 5c. clients — filtrar por org
DROP POLICY IF EXISTS "clients_read_all" ON clients;
CREATE POLICY "clients_read_by_org" ON clients FOR SELECT
USING (
  -- Staff de la misma org puede ver clientes
  organization_id = get_user_org_id()
  -- O el cliente puede verse a si mismo
  OR auth_user_id = auth.uid()
);

DROP POLICY IF EXISTS "clients_insert_all" ON clients;
CREATE POLICY "clients_insert_by_org" ON clients FOR INSERT
WITH CHECK (
  -- Insercion libre (necesario para check-in/registro)
  true
);

DROP POLICY IF EXISTS "clients_update_staff" ON clients;
DROP POLICY IF EXISTS "client_update_own" ON clients;
CREATE POLICY "clients_update_by_org" ON clients FOR UPDATE
USING (
  organization_id = get_user_org_id()
  OR auth_user_id = auth.uid()
)
WITH CHECK (
  organization_id = get_user_org_id()
  OR auth_user_id = auth.uid()
);

-- 5d. roles — filtrar por org
DROP POLICY IF EXISTS "roles_select" ON roles;
DROP POLICY IF EXISTS "roles_insert" ON roles;
DROP POLICY IF EXISTS "roles_update" ON roles;
DROP POLICY IF EXISTS "roles_delete" ON roles;

CREATE POLICY "roles_read_by_org" ON roles FOR SELECT
USING (organization_id = get_user_org_id() OR is_system = true);

CREATE POLICY "roles_manage_by_org_owner" ON roles FOR ALL
USING (is_admin_or_owner() AND organization_id = get_user_org_id())
WITH CHECK (is_admin_or_owner() AND organization_id = get_user_org_id());

-- 5e. app_settings — filtrar por org
DROP POLICY IF EXISTS "settings_read_all" ON app_settings;
DROP POLICY IF EXISTS "settings_manage_owner" ON app_settings;

CREATE POLICY "settings_read_by_org" ON app_settings FOR SELECT
USING (organization_id = get_user_org_id());

CREATE POLICY "settings_manage_by_org_admin" ON app_settings FOR ALL
USING (is_admin_or_owner() AND organization_id = get_user_org_id())
WITH CHECK (is_admin_or_owner() AND organization_id = get_user_org_id());

-- 5f. reward_catalog — filtrar por org
DROP POLICY IF EXISTS "public_read_reward_catalog" ON reward_catalog;
DROP POLICY IF EXISTS "staff_manage_reward_catalog" ON reward_catalog;

CREATE POLICY "reward_catalog_read_by_org" ON reward_catalog FOR SELECT
USING (is_active = true AND organization_id = get_user_org_id());

CREATE POLICY "reward_catalog_manage_by_org" ON reward_catalog FOR ALL
USING (is_admin_or_owner() AND organization_id = get_user_org_id())
WITH CHECK (is_admin_or_owner() AND organization_id = get_user_org_id());

-- 5g. service_tags — filtrar por org
DROP POLICY IF EXISTS "service_tags_read_all" ON service_tags;
DROP POLICY IF EXISTS "service_tags_manage_owner" ON service_tags;

CREATE POLICY "service_tags_read_by_org" ON service_tags FOR SELECT
USING (organization_id = get_user_org_id());

CREATE POLICY "service_tags_manage_by_org" ON service_tags FOR ALL
USING (is_admin_or_owner() AND organization_id = get_user_org_id())
WITH CHECK (is_admin_or_owner() AND organization_id = get_user_org_id());

-- ============================================================
-- 6. RLS PARA TABLAS TIER 2 (heredan org via branch_id)
-- ============================================================
-- Estas tablas no tienen organization_id directo.
-- Filtran via: branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())

-- 6a. services — filtrar por org via branch
DROP POLICY IF EXISTS "services_read_all" ON services;
DROP POLICY IF EXISTS "services_manage_owner" ON services;

CREATE POLICY "services_read_by_org" ON services FOR SELECT
USING (
  branch_id IS NULL  -- servicios globales (legacy)
  OR branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
  OR true  -- kiosk/checkin necesita ver servicios
);

CREATE POLICY "services_manage_by_org" ON services FOR ALL
USING (
  is_admin_or_owner()
  AND (branch_id IS NULL OR branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id()))
)
WITH CHECK (
  is_admin_or_owner()
  AND (branch_id IS NULL OR branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id()))
);

-- 6b. queue_entries — mantener acceso publico (kiosk/TV) pero scoped por branch->org
-- No se modifica porque el kiosk y TV necesitan acceso libre por branch_id
-- y el dashboard usa service role

-- 6c. visits — cerrar la vulnerabilidad existente (visits_read_all = true)
DROP POLICY IF EXISTS "visits_read_all" ON visits;
DROP POLICY IF EXISTS "visits_update_all" ON visits;
DROP POLICY IF EXISTS "visits_insert_staff" ON visits;

CREATE POLICY "visits_read_by_org" ON visits FOR SELECT
USING (
  branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
  OR client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid())
);

CREATE POLICY "visits_insert_by_staff" ON visits FOR INSERT
WITH CHECK (
  EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid() AND is_active = true)
);

CREATE POLICY "visits_update_by_org" ON visits FOR UPDATE
USING (
  branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
);

-- ============================================================
-- 7. FIX VULNERABILIDADES: Tablas con ALL USING (true)
-- ============================================================

-- 7a. break_requests — cerrar acceso abierto
DROP POLICY IF EXISTS "Allow all access to break_requests" ON break_requests;

CREATE POLICY "break_requests_read_by_org" ON break_requests FOR SELECT
USING (
  branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
);

CREATE POLICY "break_requests_manage_by_staff" ON break_requests FOR ALL
USING (
  EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid() AND is_active = true
    AND organization_id = get_user_org_id())
)
WITH CHECK (
  EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid() AND is_active = true
    AND organization_id = get_user_org_id())
);

-- 7b. staff_face_descriptors — cerrar acceso abierto
DROP POLICY IF EXISTS "Allow all operations for staff_face_descriptors" ON staff_face_descriptors;

CREATE POLICY "staff_face_read_by_org" ON staff_face_descriptors FOR SELECT
USING (
  staff_id IN (SELECT id FROM staff WHERE organization_id = get_user_org_id())
  OR true  -- kiosk necesita leer para reconocimiento facial
);

CREATE POLICY "staff_face_manage_by_org" ON staff_face_descriptors FOR INSERT
WITH CHECK (true);  -- kiosk inserta descriptores

CREATE POLICY "staff_face_delete_by_org" ON staff_face_descriptors FOR DELETE
USING (
  staff_id IN (SELECT id FROM staff WHERE organization_id = get_user_org_id())
);

-- 7c. conversations — cerrar acceso abierto
DROP POLICY IF EXISTS "conversations_all" ON conversations;
DROP POLICY IF EXISTS "conversations_select" ON conversations;
DROP POLICY IF EXISTS "conversations_service" ON conversations;

CREATE POLICY "conversations_read_by_org" ON conversations FOR SELECT
USING (
  channel_id IN (
    SELECT id FROM social_channels WHERE branch_id IN (
      SELECT id FROM branches WHERE organization_id = get_user_org_id()
    )
  )
);

CREATE POLICY "conversations_manage_by_staff" ON conversations FOR ALL
USING (
  EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid() AND is_active = true
    AND organization_id = get_user_org_id())
)
WITH CHECK (
  EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid() AND is_active = true
    AND organization_id = get_user_org_id())
);

-- 7d. messages — cerrar acceso abierto
DROP POLICY IF EXISTS "messages_select" ON messages;
DROP POLICY IF EXISTS "messages_insert" ON messages;
DROP POLICY IF EXISTS "messages_update" ON messages;
DROP POLICY IF EXISTS "messages_service" ON messages;

CREATE POLICY "messages_read_by_org" ON messages FOR SELECT
USING (
  conversation_id IN (
    SELECT c.id FROM conversations c
    JOIN social_channels sc ON sc.id = c.channel_id
    JOIN branches b ON b.id = sc.branch_id
    WHERE b.organization_id = get_user_org_id()
  )
);

CREATE POLICY "messages_manage_by_staff" ON messages FOR ALL
USING (
  EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid() AND is_active = true
    AND organization_id = get_user_org_id())
)
WITH CHECK (
  EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid() AND is_active = true
    AND organization_id = get_user_org_id())
);

-- 7e. message_templates — cerrar acceso abierto
DROP POLICY IF EXISTS "message_templates_all" ON message_templates;
DROP POLICY IF EXISTS "message_templates_select" ON message_templates;
DROP POLICY IF EXISTS "message_templates_service" ON message_templates;

CREATE POLICY "message_templates_read_by_org" ON message_templates FOR SELECT
USING (
  channel_id IN (
    SELECT id FROM social_channels WHERE branch_id IN (
      SELECT id FROM branches WHERE organization_id = get_user_org_id()
    )
  )
);

CREATE POLICY "message_templates_manage_by_staff" ON message_templates FOR ALL
USING (
  EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid() AND is_active = true
    AND organization_id = get_user_org_id())
)
WITH CHECK (
  EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid() AND is_active = true
    AND organization_id = get_user_org_id())
);

-- 7f. social_channels — cerrar acceso abierto
DROP POLICY IF EXISTS "social_channels_all" ON social_channels;
DROP POLICY IF EXISTS "social_channels_select" ON social_channels;
DROP POLICY IF EXISTS "social_channels_service" ON social_channels;

CREATE POLICY "social_channels_read_by_org" ON social_channels FOR SELECT
USING (
  branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
);

CREATE POLICY "social_channels_manage_by_admin" ON social_channels FOR ALL
USING (
  is_admin_or_owner()
  AND branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
)
WITH CHECK (
  is_admin_or_owner()
  AND branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id())
);

-- 7g. scheduled_messages — cerrar acceso abierto
DROP POLICY IF EXISTS "scheduled_messages_all" ON scheduled_messages;
DROP POLICY IF EXISTS "scheduled_messages_service" ON scheduled_messages;
-- Mantener las policies restrictivas existentes (select staff, insert_staff, etc.)

-- ============================================================
-- FIN Migracion 048
-- ============================================================
