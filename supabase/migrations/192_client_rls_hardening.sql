-- =============================================================================
-- 192 — Cerrar el acceso org‑wide de los clientes de la app mobile
-- =============================================================================
-- Hasta acá `client-auth` escribía `organization_id` en el `app_metadata` del
-- auth user del cliente y `get_user_org_id()` lo leía (rama 2) — y si no, lo
-- resolvía por `clients.auth_user_id` (rama 5). Resultado: TODAS las policies
-- pensadas para staff (`*_by_org`, `appointments_org`, `visits_read_by_org`,
-- `clients_update_by_org`, …) le daban a un cliente logueado lectura y
-- escritura sobre la organización entera (6.000 clientes con teléfono y
-- notes, todas las visitas con importes, CRUD de turnos).
--
-- Regla nueva:
--   * Un JWT de cliente lleva `app_metadata.user_type = 'client'` (lo escribe
--     la edge function `client-auth` v2) y para él `get_user_org_id()` es NULL.
--   * Desaparece la rama 5 (clients). Un cliente NUNCA obtiene org por acá.
--   * Lo que el cliente necesita leer va por policies "propias" (`auth.uid()`)
--     o por RPC SECURITY DEFINER que resuelve el cliente por `auth.uid()`.
--
-- Autosuficiente e idempotente. Cuerpos completos (no diffs).
-- =============================================================================

-- ── 1. get_user_org_id(): cliente → NULL; sin rama clients ─────────────────
CREATE OR REPLACE FUNCTION public.get_user_org_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    -- JWT de cliente de la app mobile: nunca resuelve organización.
    WHEN COALESCE((SELECT auth.jwt()) -> 'app_metadata' ->> 'user_type', '') = 'client'
      THEN NULL::uuid
    ELSE COALESCE(
      -- 1. Usuario seleccionó org explícita (switchOrganization)
      (NULLIF((SELECT auth.jwt()) -> 'app_metadata' ->> 'active_organization_id', '')::uuid),
      -- 2. organization_id primario en app_metadata (staff)
      (NULLIF((SELECT auth.jwt()) -> 'app_metadata' ->> 'organization_id', '')::uuid),
      -- 3. staff record (dashboard/barber panel)
      (SELECT organization_id FROM public.staff
        WHERE auth_user_id = (SELECT auth.uid()) AND is_active = true
        ORDER BY created_at ASC LIMIT 1),
      -- 4. organization_members (owner/admin via membership) — migración 128
      (SELECT organization_id FROM public.organization_members
        WHERE user_id = (SELECT auth.uid())
        ORDER BY created_at ASC LIMIT 1)
      -- (la rama 5 "clients" se eliminó en la migración 192)
    )
  END;
$function$;

-- ── 2. Helpers para policies/RPC de clientes ────────────────────────────────
CREATE OR REPLACE FUNCTION public.current_client_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id FROM public.clients
   WHERE auth_user_id = (SELECT auth.uid())
   ORDER BY created_at ASC
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_client_org_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT organization_id FROM public.clients
   WHERE auth_user_id = (SELECT auth.uid())
   ORDER BY created_at ASC
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.current_client_id() FROM public;
REVOKE ALL ON FUNCTION public.current_client_org_id() FROM public;
GRANT EXECUTE ON FUNCTION public.current_client_id() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_client_org_id() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.current_client_id() IS
  'Cliente (app mobile) del JWT actual por clients.auth_user_id; NULL si no hay.';

-- ── 3. RPCs de cliente que filtraban por get_user_org_id() ──────────────────
-- Con la regla nueva esas funciones devolvían vacío / "Client not found".
-- `clients.auth_user_id` es UNIQUE, así que alcanza con auth.uid().

CREATE OR REPLACE FUNCTION public.get_client_global_points()
RETURNS TABLE(total_balance integer, total_earned integer, total_redeemed integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT COALESCE(SUM(points_balance), 0)::INTEGER,
         COALESCE(SUM(total_earned), 0)::INTEGER,
         COALESCE(SUM(total_redeemed), 0)::INTEGER
  FROM client_points
  WHERE client_id = public.current_client_id();
$function$;

CREATE OR REPLACE FUNCTION public.get_client_wallet()
RETURNS TABLE(reward_id uuid, client_reward_id uuid, reward_name text, reward_description text,
              reward_type reward_type, discount_pct integer, is_free_service boolean,
              status client_reward_status, qr_code text, expires_at timestamp with time zone,
              created_at timestamp with time zone)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT rc.id, cr.id, rc.name, rc.description, rc.type, rc.discount_pct, rc.is_free_service,
         cr.status, cr.qr_code, cr.expires_at, cr.created_at
  FROM client_rewards cr
  JOIN reward_catalog rc ON rc.id = cr.reward_id
  WHERE cr.client_id = public.current_client_id()
  ORDER BY cr.created_at DESC;
$function$;

CREATE OR REPLACE FUNCTION public.get_client_pending_reviews()
RETURNS TABLE(request_id uuid, branch_name text, barber_name text,
              visit_date timestamp with time zone, token text, expires_at timestamp with time zone)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT rr.id, b.name, s.full_name, rr.created_at, rr.token, rr.expires_at
  FROM review_requests rr
  JOIN branches b ON b.id = rr.branch_id
  LEFT JOIN staff s ON s.id = rr.barber_id
  WHERE rr.client_id = public.current_client_id()
    AND rr.status = 'pending'
    AND rr.expires_at > now()
  ORDER BY rr.created_at DESC;
$function$;

CREATE OR REPLACE FUNCTION public.redeem_points_for_reward(p_reward_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_client clients%ROWTYPE; v_reward reward_catalog%ROWTYPE; v_total_points INTEGER; v_client_reward_id UUID;
BEGIN
  SELECT * INTO v_client FROM clients WHERE auth_user_id = auth.uid() ORDER BY created_at LIMIT 1;
  IF v_client IS NULL THEN RETURN json_build_object('success', false, 'error', 'Client not found'); END IF;
  SELECT * INTO v_reward FROM reward_catalog
   WHERE id = p_reward_id AND is_active = true AND points_cost > 0
     AND organization_id = v_client.organization_id;
  IF v_reward IS NULL THEN RETURN json_build_object('success', false, 'error', 'Reward not available'); END IF;
  IF v_reward.stock IS NOT NULL AND v_reward.stock <= 0 THEN RETURN json_build_object('success', false, 'error', 'Out of stock'); END IF;
  SELECT COALESCE(SUM(points_balance), 0) INTO v_total_points FROM client_points WHERE client_id = v_client.id;
  IF v_total_points < v_reward.points_cost THEN
    RETURN json_build_object('success', false, 'error', 'Insufficient points', 'required', v_reward.points_cost, 'available', v_total_points);
  END IF;
  PERFORM deduct_client_points(v_client.id, v_reward.points_cost);
  INSERT INTO client_rewards (client_id, reward_id, source) VALUES (v_client.id, p_reward_id, 'points_redemption') RETURNING id INTO v_client_reward_id;
  INSERT INTO point_transactions (client_id, points, type, description) VALUES (v_client.id, -v_reward.points_cost, 'redeemed', 'Canje: ' || v_reward.name);
  IF v_reward.stock IS NOT NULL THEN UPDATE reward_catalog SET stock = stock - 1 WHERE id = p_reward_id AND stock > 0; END IF;
  RETURN json_build_object('success', true, 'reward_name', v_reward.name, 'client_reward_id', v_client_reward_id, 'points_remaining', v_total_points - v_reward.points_cost);
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_onboarding_spin(p_reward_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_client clients%ROWTYPE; v_reward reward_catalog%ROWTYPE; v_client_reward_id UUID;
BEGIN
  SELECT * INTO v_client FROM clients WHERE auth_user_id = auth.uid() ORDER BY created_at LIMIT 1;
  IF v_client IS NULL THEN RETURN json_build_object('success', false, 'error', 'Client not found'); END IF;
  IF v_client.onboarding_spin_used_at IS NOT NULL THEN RETURN json_build_object('success', false, 'error', 'Spin already used'); END IF;
  SELECT * INTO v_reward FROM reward_catalog
   WHERE id = p_reward_id AND is_active = true AND organization_id = v_client.organization_id;
  IF v_reward IS NULL THEN RETURN json_build_object('success', false, 'error', 'Reward not found'); END IF;
  INSERT INTO client_rewards (client_id, reward_id, source) VALUES (v_client.id, p_reward_id, 'spin_prize') RETURNING id INTO v_client_reward_id;
  UPDATE clients SET onboarding_spin_used_at = now() WHERE id = v_client.id;
  IF v_reward.stock IS NOT NULL THEN UPDATE reward_catalog SET stock = stock - 1 WHERE id = p_reward_id AND stock > 0; END IF;
  RETURN json_build_object('success', true, 'reward_name', v_reward.name, 'client_reward_id', v_client_reward_id);
END;
$function$;

-- Señales de sucursal "de mi org": para staff sigue siendo get_user_org_id();
-- para un cliente, la org de su ficha.
CREATE OR REPLACE FUNCTION public.get_client_branch_signals()
RETURNS TABLE(branch_id uuid, branch_name text, branch_address text, branch_latitude double precision,
              branch_longitude double precision, occupancy_level occupancy_level, is_open boolean,
              waiting_count integer, in_progress_count integer, available_barbers integer,
              total_barbers integer, eta_minutes integer, best_arrival_in_minutes integer,
              suggestion_text text, updated_at timestamp with time zone)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT
    b.id, b.name, b.address, b.latitude, b.longitude,
    COALESCE(bs.occupancy_level, 'sin_espera'::occupancy_level),
    (EXTRACT(DOW FROM (NOW() AT TIME ZONE COALESCE(b.timezone, 'America/Argentina/Buenos_Aires')))::INTEGER = ANY(b.business_days)
     AND (NOW() AT TIME ZONE COALESCE(b.timezone, 'America/Argentina/Buenos_Aires'))::TIME >= b.business_hours_open
     AND (NOW() AT TIME ZONE COALESCE(b.timezone, 'America/Argentina/Buenos_Aires'))::TIME < b.business_hours_close),
    COALESCE(bs.waiting_count, 0)::integer,
    COALESCE(bs.queue_size - bs.waiting_count, 0)::integer,
    COALESCE(bs.available_barbers, 0)::integer,
    COALESCE(bs.active_barbers, 0)::integer,
    bs.eta_minutes, bs.best_arrival_in_minutes, bs.suggestion_text, bs.updated_at
  FROM branches b
  LEFT JOIN branch_signals bs ON bs.branch_id = b.id
  WHERE b.is_active = true
    AND b.organization_id = COALESCE(public.get_user_org_id(), public.current_client_org_id())
  ORDER BY b.name;
$function$;

-- ── 4. deduct_client_points: sólo uso interno (la llama redeem_points_for_reward) ──
-- Estaba con EXECUTE a PUBLIC: cualquier anon podía vaciarle los puntos a
-- cualquier cliente. Sin call-sites en la app ni en el dashboard.
REVOKE ALL ON FUNCTION public.deduct_client_points(uuid, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_client_points(uuid, integer) TO service_role;

-- ── 5. Policies propias del cliente ─────────────────────────────────────────
-- clients: lectura de la propia ficha (explícita; clients_read_by_org ya tenía el OR).
DROP POLICY IF EXISTS clients_select_own ON public.clients;
CREATE POLICY clients_select_own ON public.clients
  FOR SELECT TO authenticated
  USING (auth_user_id = (SELECT auth.uid()));
-- (Sin policy de UPDATE para clientes: el nombre se edita por /api/mobile/me con service role.)

-- visits: las propias.
DROP POLICY IF EXISTS visits_read_own_client ON public.visits;
CREATE POLICY visits_read_own_client ON public.visits
  FOR SELECT TO authenticated
  USING (client_id = public.current_client_id());

-- reward_catalog: catálogo activo de la org del cliente.
DROP POLICY IF EXISTS reward_catalog_read_client ON public.reward_catalog;
CREATE POLICY reward_catalog_read_client ON public.reward_catalog
  FOR SELECT TO authenticated
  USING (is_active = true AND organization_id = public.current_client_org_id());

-- appointments / appointment_services: las propias (existían en prod desde la
-- ventana 119–122 pero no en el repo; quedan declaradas acá).
DROP POLICY IF EXISTS appointments_select_own_client ON public.appointments;
CREATE POLICY appointments_select_own_client ON public.appointments
  FOR SELECT TO authenticated
  USING (client_id = public.current_client_id());

DROP POLICY IF EXISTS appt_services_select_own_client ON public.appointment_services;
CREATE POLICY appt_services_select_own_client ON public.appointment_services
  FOR SELECT TO authenticated
  USING (appointment_id IN (SELECT a.id FROM public.appointments a WHERE a.client_id = public.current_client_id()));

-- client_device_tokens: del cliente, con WITH CHECK explícito; el staff no
-- necesita leer tokens (los manda la edge function con service role).
DROP POLICY IF EXISTS client_manage_own_tokens ON public.client_device_tokens;
DROP POLICY IF EXISTS staff_read_tokens ON public.client_device_tokens;
DROP POLICY IF EXISTS cdt_client_own ON public.client_device_tokens;
DROP POLICY IF EXISTS cdt_staff_read ON public.client_device_tokens;
DROP POLICY IF EXISTS client_tokens_select_own ON public.client_device_tokens;
DROP POLICY IF EXISTS client_tokens_insert_own ON public.client_device_tokens;
DROP POLICY IF EXISTS client_tokens_update_own ON public.client_device_tokens;
DROP POLICY IF EXISTS client_tokens_delete_own ON public.client_device_tokens;
CREATE POLICY client_tokens_select_own ON public.client_device_tokens
  FOR SELECT TO authenticated USING (client_id = public.current_client_id());
CREATE POLICY client_tokens_insert_own ON public.client_device_tokens
  FOR INSERT TO authenticated WITH CHECK (client_id = public.current_client_id());
CREATE POLICY client_tokens_update_own ON public.client_device_tokens
  FOR UPDATE TO authenticated
  USING (client_id = public.current_client_id())
  WITH CHECK (client_id = public.current_client_id());
CREATE POLICY client_tokens_delete_own ON public.client_device_tokens
  FOR DELETE TO authenticated USING (client_id = public.current_client_id());

-- queue_entries_public_read (mig 140 "no aplicar todavía"): la app ya no lee
-- la cola cruda (usa get_branch_public_detail + branch_signals). Se cierra el
-- leak cross-org a cualquier authenticated.
DROP POLICY IF EXISTS queue_entries_public_read ON public.queue_entries;

-- ── 6. Auth users de clientes existentes: marcar user_type y sacar la org ──
UPDATE auth.users u
   SET raw_app_meta_data =
         (COALESCE(u.raw_app_meta_data, '{}'::jsonb) - 'organization_id' - 'active_organization_id')
         || jsonb_build_object('user_type', 'client')
         || COALESCE(
              (SELECT jsonb_build_object('client_id', c.id) FROM public.clients c WHERE c.auth_user_id = u.id ORDER BY c.created_at LIMIT 1),
              '{}'::jsonb)
 WHERE (u.email LIKE '%@monaco.internal'
        OR EXISTS (SELECT 1 FROM public.clients c WHERE c.auth_user_id = u.id))
   -- nunca tocar a un usuario que además sea staff/miembro de una org
   AND NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.auth_user_id = u.id)
   AND NOT EXISTS (SELECT 1 FROM public.organization_members om WHERE om.user_id = u.id);
