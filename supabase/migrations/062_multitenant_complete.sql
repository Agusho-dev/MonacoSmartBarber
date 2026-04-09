-- =============================================================================
-- 062_multitenant_complete.sql
-- Completa la migración multi-tenant: agrega organization_id a tablas faltantes,
-- habilita RLS, actualiza funciones y vistas para filtrar por org.
-- =============================================================================

-- Constante para backfill: Monaco es la única org con datos
-- a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11

-- =============================================================================
-- PARTE 1: Habilitar RLS en tablas que lo tienen deshabilitado
-- =============================================================================

-- auto_reply_rules (ya tiene organization_id)
ALTER TABLE auto_reply_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auto_reply_rules_read_by_org" ON auto_reply_rules
  FOR SELECT USING (organization_id = get_user_org_id());

CREATE POLICY "auto_reply_rules_manage_by_org" ON auto_reply_rules
  FOR ALL USING (
    is_admin_or_owner() AND organization_id = get_user_org_id()
  ) WITH CHECK (
    is_admin_or_owner() AND organization_id = get_user_org_id()
  );

-- broadcasts (ya tiene organization_id)
ALTER TABLE broadcasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "broadcasts_read_by_org" ON broadcasts
  FOR SELECT USING (organization_id = get_user_org_id());

CREATE POLICY "broadcasts_manage_by_org" ON broadcasts
  FOR ALL USING (
    is_admin_or_owner() AND organization_id = get_user_org_id()
  ) WITH CHECK (
    is_admin_or_owner() AND organization_id = get_user_org_id()
  );

-- broadcast_recipients (hereda org via broadcasts)
ALTER TABLE broadcast_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "broadcast_recipients_read_by_org" ON broadcast_recipients
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM broadcasts b
      WHERE b.id = broadcast_recipients.broadcast_id
        AND b.organization_id = get_user_org_id()
    )
  );

CREATE POLICY "broadcast_recipients_manage_by_org" ON broadcast_recipients
  FOR ALL USING (
    is_admin_or_owner() AND EXISTS (
      SELECT 1 FROM broadcasts b
      WHERE b.id = broadcast_recipients.broadcast_id
        AND b.organization_id = get_user_org_id()
    )
  ) WITH CHECK (
    is_admin_or_owner() AND EXISTS (
      SELECT 1 FROM broadcasts b
      WHERE b.id = broadcast_recipients.broadcast_id
        AND b.organization_id = get_user_org_id()
    )
  );

-- quick_replies (ya tiene organization_id)
ALTER TABLE quick_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quick_replies_read_by_org" ON quick_replies
  FOR SELECT USING (organization_id = get_user_org_id());

CREATE POLICY "quick_replies_manage_by_org" ON quick_replies
  FOR ALL USING (
    is_admin_or_owner() AND organization_id = get_user_org_id()
  ) WITH CHECK (
    is_admin_or_owner() AND organization_id = get_user_org_id()
  );

-- =============================================================================
-- PARTE 2: Agregar organization_id a tablas sin cadena a org
-- =============================================================================

-- 2a. qr_photo_sessions — actualmente sin FK a ninguna tabla scoped
ALTER TABLE qr_photo_sessions
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);

-- Backfill: todas las sesiones existentes son de Monaco
UPDATE qr_photo_sessions
SET organization_id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
WHERE organization_id IS NULL;

ALTER TABLE qr_photo_sessions
  ALTER COLUMN organization_id SET NOT NULL;

-- 2b. point_transactions — actualmente solo tiene client_id + visit_id
ALTER TABLE point_transactions
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);

-- Backfill via client_id → clients.organization_id
UPDATE point_transactions pt
SET organization_id = c.organization_id
FROM clients c
WHERE pt.client_id = c.id
  AND pt.organization_id IS NULL;

-- Para filas huérfanas (sin client match), usar Monaco
UPDATE point_transactions
SET organization_id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
WHERE organization_id IS NULL;

ALTER TABLE point_transactions
  ALTER COLUMN organization_id SET NOT NULL;

-- 2c. client_rewards — actualmente solo client_id + reward_id
ALTER TABLE client_rewards
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);

UPDATE client_rewards cr
SET organization_id = c.organization_id
FROM clients c
WHERE cr.client_id = c.id
  AND cr.organization_id IS NULL;

UPDATE client_rewards
SET organization_id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
WHERE organization_id IS NULL;

ALTER TABLE client_rewards
  ALTER COLUMN organization_id SET NOT NULL;

-- =============================================================================
-- PARTE 3: Desnormalizar organization_id en tablas Tier 2 de alto volumen
-- =============================================================================

-- 3a. visits
ALTER TABLE visits
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);

UPDATE visits v
SET organization_id = b.organization_id
FROM branches b
WHERE v.branch_id = b.id
  AND v.organization_id IS NULL;

ALTER TABLE visits
  ALTER COLUMN organization_id SET NOT NULL;

-- 3b. queue_entries
ALTER TABLE queue_entries
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);

UPDATE queue_entries qe
SET organization_id = b.organization_id
FROM branches b
WHERE qe.branch_id = b.id
  AND qe.organization_id IS NULL;

ALTER TABLE queue_entries
  ALTER COLUMN organization_id SET NOT NULL;

-- 3c. attendance_logs
ALTER TABLE attendance_logs
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);

UPDATE attendance_logs al
SET organization_id = b.organization_id
FROM branches b
WHERE al.branch_id = b.id
  AND al.organization_id IS NULL;

ALTER TABLE attendance_logs
  ALTER COLUMN organization_id SET NOT NULL;

-- =============================================================================
-- PARTE 4: Triggers para auto-poblar organization_id en INSERTs
-- =============================================================================

-- Función genérica: dado un branch_id, resuelve organization_id
CREATE OR REPLACE FUNCTION set_org_from_branch()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.organization_id IS NULL AND NEW.branch_id IS NOT NULL THEN
    SELECT organization_id INTO NEW.organization_id
    FROM branches WHERE id = NEW.branch_id;
  END IF;
  RETURN NEW;
END;
$$;

-- Función para point_transactions: resuelve via client_id
CREATE OR REPLACE FUNCTION set_org_from_client()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.organization_id IS NULL AND NEW.client_id IS NOT NULL THEN
    SELECT organization_id INTO NEW.organization_id
    FROM clients WHERE id = NEW.client_id;
  END IF;
  RETURN NEW;
END;
$$;

-- Función para client_rewards: resuelve via client_id
-- (reutiliza set_org_from_client)

-- Triggers
CREATE OR REPLACE TRIGGER trg_visits_set_org
  BEFORE INSERT ON visits
  FOR EACH ROW EXECUTE FUNCTION set_org_from_branch();

CREATE OR REPLACE TRIGGER trg_queue_entries_set_org
  BEFORE INSERT ON queue_entries
  FOR EACH ROW EXECUTE FUNCTION set_org_from_branch();

CREATE OR REPLACE TRIGGER trg_attendance_logs_set_org
  BEFORE INSERT ON attendance_logs
  FOR EACH ROW EXECUTE FUNCTION set_org_from_branch();

CREATE OR REPLACE TRIGGER trg_point_transactions_set_org
  BEFORE INSERT ON point_transactions
  FOR EACH ROW EXECUTE FUNCTION set_org_from_client();

CREATE OR REPLACE TRIGGER trg_client_rewards_set_org
  BEFORE INSERT ON client_rewards
  FOR EACH ROW EXECUTE FUNCTION set_org_from_client();

-- =============================================================================
-- PARTE 5: Actualizar vista branch_occupancy (DROP + CREATE con organization_id)
-- =============================================================================

DROP VIEW IF EXISTS branch_occupancy;

CREATE VIEW branch_occupancy AS
SELECT
  b.id AS branch_id,
  b.name AS branch_name,
  b.organization_id,
  COUNT(CASE WHEN qe.status = 'waiting'::queue_status THEN 1 END) AS clients_waiting,
  COUNT(CASE WHEN qe.status = 'in_progress'::queue_status THEN 1 END) AS clients_in_progress,
  (
    SELECT COUNT(*)
    FROM staff s
    WHERE s.branch_id = b.id
      AND s.role = 'barber'::user_role
      AND s.is_active = true
      AND s.hidden_from_checkin IS DISTINCT FROM true
      AND (
        SELECT al.action_type
        FROM attendance_logs al
        WHERE al.staff_id = s.id
          AND (al.recorded_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
              = (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
        ORDER BY al.recorded_at DESC
        LIMIT 1
      ) IS DISTINCT FROM 'clock_out'::attendance_action
  ) AS total_barbers,
  (
    SELECT COUNT(*)
    FROM staff s
    WHERE s.branch_id = b.id
      AND s.role = 'barber'::user_role
      AND s.is_active = true
      AND s.hidden_from_checkin IS DISTINCT FROM true
      AND s.status = 'available'::staff_status
      AND NOT (s.id IN (
        SELECT qe2.barber_id
        FROM queue_entries qe2
        WHERE qe2.branch_id = b.id
          AND qe2.status = 'in_progress'::queue_status
          AND qe2.barber_id IS NOT NULL
      ))
      AND (
        SELECT al.action_type
        FROM attendance_logs al
        WHERE al.staff_id = s.id
          AND (al.recorded_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
              = (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
        ORDER BY al.recorded_at DESC
        LIMIT 1
      ) IS DISTINCT FROM 'clock_out'::attendance_action
  ) AS available_barbers
FROM branches b
LEFT JOIN queue_entries qe ON (
  qe.branch_id = b.id
  AND qe.status = ANY(ARRAY['waiting'::queue_status, 'in_progress'::queue_status])
  AND (qe.checked_in_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
      = (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
)
WHERE b.is_active = true
GROUP BY b.id, b.name, b.organization_id;

-- =============================================================================
-- PARTE 6: Actualizar funciones DB con validación de org
-- =============================================================================

-- 6a. batch_update_queue_entries — agregar validación de branch_id → org
CREATE OR REPLACE FUNCTION public.batch_update_queue_entries(p_updates jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  item JSONB;
  v_branch_id UUID;
  v_org_id UUID;
BEGIN
  -- Obtener branch_id y org del primer elemento para validar
  IF jsonb_array_length(p_updates) > 0 THEN
    SELECT qe.branch_id, b.organization_id
    INTO v_branch_id, v_org_id
    FROM queue_entries qe
    JOIN branches b ON b.id = qe.branch_id
    WHERE qe.id = ((p_updates->0)->>'id')::uuid;

    IF v_org_id IS NULL THEN
      RAISE EXCEPTION 'Entrada de cola no encontrada';
    END IF;
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(p_updates)
  LOOP
    UPDATE queue_entries
    SET
      position   = (item->>'position')::int,
      barber_id  = CASE
                     WHEN item ? 'barber_id' THEN
                       NULLIF(item->>'barber_id', '')::uuid
                     ELSE barber_id
                   END,
      is_dynamic = CASE
                     WHEN item ? 'is_dynamic' THEN
                       (item->>'is_dynamic')::boolean
                     ELSE is_dynamic
                   END
    WHERE id = (item->>'id')::uuid
      AND status = 'waiting'
      AND branch_id IN (SELECT id FROM branches WHERE organization_id = v_org_id);
  END LOOP;
END;
$function$;

-- 6b. deduct_client_points — agregar parámetro de org para validación
CREATE OR REPLACE FUNCTION public.deduct_client_points(p_client_id uuid, p_amount integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  r RECORD;
  remaining INTEGER := p_amount;
  v_client_org UUID;
BEGIN
  -- Verificar que el cliente existe y obtener su org
  SELECT organization_id INTO v_client_org
  FROM clients WHERE id = p_client_id;

  IF v_client_org IS NULL THEN
    RAISE EXCEPTION 'Cliente no encontrado: %', p_client_id;
  END IF;

  FOR r IN
    SELECT id, points_balance
    FROM client_points
    WHERE client_id = p_client_id AND points_balance > 0
    ORDER BY points_balance DESC
  LOOP
    IF remaining <= 0 THEN EXIT; END IF;
    IF r.points_balance >= remaining THEN
      UPDATE client_points
      SET points_balance = points_balance - remaining,
          total_redeemed = total_redeemed + remaining
      WHERE id = r.id;
      remaining := 0;
    ELSE
      remaining := remaining - r.points_balance;
      UPDATE client_points
      SET total_redeemed = total_redeemed + points_balance,
          points_balance = 0
      WHERE id = r.id;
    END IF;
  END LOOP;
END;
$function$;

-- 6c. generate_commission_report — validar que staff y branch pertenecen a la misma org
CREATE OR REPLACE FUNCTION public.generate_commission_report(p_staff_id uuid, p_branch_id uuid, p_date date DEFAULT CURRENT_DATE)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_total_commission NUMERIC(12,2);
  v_report_id UUID;
  v_staff_org UUID;
  v_branch_org UUID;
BEGIN
  -- Verificar que staff existe, es barbero, y obtener su org
  SELECT organization_id INTO v_staff_org
  FROM staff
  WHERE id = p_staff_id
    AND role = 'barber'::user_role;

  IF v_staff_org IS NULL THEN
    RAISE EXCEPTION 'El staff_id % no existe o no es barbero', p_staff_id;
  END IF;

  -- Verificar que la sucursal existe y obtener su org
  SELECT organization_id INTO v_branch_org
  FROM branches WHERE id = p_branch_id;

  IF v_branch_org IS NULL THEN
    RAISE EXCEPTION 'La branch_id % no existe', p_branch_id;
  END IF;

  -- Validar que pertenecen a la misma organización
  IF v_staff_org != v_branch_org THEN
    RAISE EXCEPTION 'El barbero y la sucursal no pertenecen a la misma organización';
  END IF;

  -- Si ya existe un reporte de comisión para este barbero y fecha, retornarlo
  SELECT id INTO v_report_id
  FROM salary_reports
  WHERE staff_id = p_staff_id
    AND report_date = p_date
    AND type = 'commission';

  IF v_report_id IS NOT NULL THEN
    RETURN v_report_id;
  END IF;

  -- Calcular total de comisiones del día
  SELECT COALESCE(SUM(commission_amount), 0)
  INTO v_total_commission
  FROM visits
  WHERE barber_id = p_staff_id
    AND branch_id = p_branch_id
    AND completed_at::date = p_date;

  IF v_total_commission <= 0 THEN
    RETURN NULL;
  END IF;

  INSERT INTO salary_reports (
    staff_id, branch_id, type, amount, report_date, notes
  ) VALUES (
    p_staff_id,
    p_branch_id,
    'commission',
    v_total_commission,
    p_date,
    'Comision auto-generada para ' || to_char(p_date, 'DD/MM/YYYY')
  )
  RETURNING id INTO v_report_id;

  RETURN v_report_id;
END;
$function$;

-- 6d. pay_salary_reports — validar que todos los reportes pertenecen a la misma org
CREATE OR REPLACE FUNCTION public.pay_salary_reports(p_report_ids uuid[], p_notes text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_staff_id    UUID;
  v_branch_id   UUID;
  v_total       NUMERIC(12,2);
  v_batch_id    UUID;
  v_count       INT;
  v_org_count   INT;
BEGIN
  IF array_length(p_report_ids, 1) IS NULL OR array_length(p_report_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Debe proporcionar al menos un reporte para pagar';
  END IF;

  -- Verificar que todos los reportes pertenecen al mismo staff y misma org
  SELECT COUNT(DISTINCT sr.staff_id), MIN(sr.staff_id), MIN(sr.branch_id),
         COUNT(DISTINCT b.organization_id)
  INTO v_count, v_staff_id, v_branch_id, v_org_count
  FROM salary_reports sr
  JOIN branches b ON b.id = sr.branch_id
  WHERE sr.id = ANY(p_report_ids)
    AND sr.status = 'pending';

  IF v_count = 0 THEN
    RAISE EXCEPTION 'No se encontraron reportes pendientes con los IDs proporcionados';
  END IF;

  IF v_count > 1 THEN
    RAISE EXCEPTION 'Todos los reportes deben pertenecer al mismo barbero';
  END IF;

  IF v_org_count > 1 THEN
    RAISE EXCEPTION 'Todos los reportes deben pertenecer a la misma organización';
  END IF;

  -- Verificar cantidad
  SELECT COUNT(*) INTO v_count
  FROM salary_reports
  WHERE id = ANY(p_report_ids)
    AND status = 'pending';

  IF v_count != array_length(p_report_ids, 1) THEN
    RAISE EXCEPTION 'Algunos reportes no existen o ya fueron pagados';
  END IF;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_total
  FROM salary_reports
  WHERE id = ANY(p_report_ids);

  INSERT INTO salary_payment_batches (staff_id, branch_id, total_amount, notes)
  VALUES (v_staff_id, v_branch_id, v_total, p_notes)
  RETURNING id INTO v_batch_id;

  UPDATE salary_reports
  SET status = 'paid',
      batch_id = v_batch_id
  WHERE id = ANY(p_report_ids);

  RETURN v_batch_id;
END;
$function$;

-- 6e. on_queue_completed — propagar organization_id a visit y point_transactions
CREATE OR REPLACE FUNCTION public.on_queue_completed()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_commission NUMERIC(5,2);
  v_visit_id UUID;
  v_points INTEGER;
  v_reward_active BOOLEAN;
  v_service_points INTEGER;
  v_org_id UUID;
BEGIN
  IF NEW.status = 'completed' AND OLD.status = 'in_progress' THEN
    -- Obtener org_id de la branch
    SELECT organization_id INTO v_org_id FROM branches WHERE id = NEW.branch_id;

    -- Get barber commission percentage
    SELECT commission_pct INTO v_commission FROM staff WHERE id = NEW.barber_id;
    v_commission := COALESCE(v_commission, 0);

    -- Create visit with organization_id
    INSERT INTO visits (branch_id, client_id, barber_id, queue_entry_id, amount, commission_pct, commission_amount, started_at, completed_at, organization_id)
    VALUES (NEW.branch_id, NEW.client_id, NEW.barber_id, NEW.id, 0, v_commission, 0, NEW.started_at, NEW.completed_at, v_org_id)
    RETURNING id INTO v_visit_id;

    -- Check service-specific points first
    v_service_points := 0;
    IF NEW.service_id IS NOT NULL THEN
      SELECT COALESCE(points_per_service, 0) INTO v_service_points
      FROM services WHERE id = NEW.service_id;
    END IF;

    IF v_service_points > 0 THEN
      v_points := v_service_points;
      v_reward_active := true;
    ELSE
      SELECT rw.points_per_visit, rw.is_active INTO v_points, v_reward_active
      FROM rewards_config rw
      WHERE (rw.branch_id = NEW.branch_id OR rw.branch_id IS NULL)
        AND rw.is_active = true
      LIMIT 1;
    END IF;

    IF v_reward_active IS TRUE AND v_points > 0 AND NEW.client_id IS NOT NULL THEN
      INSERT INTO client_points (client_id, branch_id, points_balance, total_earned)
      VALUES (NEW.client_id, NEW.branch_id, v_points, v_points)
      ON CONFLICT (client_id, branch_id)
      DO UPDATE SET
        points_balance = client_points.points_balance + v_points,
        total_earned = client_points.total_earned + v_points;

      INSERT INTO point_transactions (client_id, visit_id, points, type, description, organization_id)
      VALUES (NEW.client_id, v_visit_id, v_points, 'earned', 'Puntos por visita', v_org_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- =============================================================================
-- PARTE 7: Índices compuestos para queries filtradas por org
-- =============================================================================

-- Tier 1 (organization_id directo)
CREATE INDEX IF NOT EXISTS idx_branches_org ON branches(organization_id);
CREATE INDEX IF NOT EXISTS idx_staff_org ON staff(organization_id);
CREATE INDEX IF NOT EXISTS idx_clients_org ON clients(organization_id);
CREATE INDEX IF NOT EXISTS idx_roles_org ON roles(organization_id);
CREATE INDEX IF NOT EXISTS idx_app_settings_org ON app_settings(organization_id);
CREATE INDEX IF NOT EXISTS idx_reward_catalog_org ON reward_catalog(organization_id);
CREATE INDEX IF NOT EXISTS idx_service_tags_org ON service_tags(organization_id);
CREATE INDEX IF NOT EXISTS idx_client_loyalty_state_org ON client_loyalty_state(organization_id);
CREATE INDEX IF NOT EXISTS idx_client_goals_org ON client_goals(organization_id);
CREATE INDEX IF NOT EXISTS idx_conversation_tags_org ON conversation_tags(organization_id);
CREATE INDEX IF NOT EXISTS idx_auto_reply_rules_org ON auto_reply_rules(organization_id);
CREATE INDEX IF NOT EXISTS idx_broadcasts_org ON broadcasts(organization_id);
CREATE INDEX IF NOT EXISTS idx_quick_replies_org ON quick_replies(organization_id);

-- Tablas recién desnormalizadas
CREATE INDEX IF NOT EXISTS idx_visits_org ON visits(organization_id);
CREATE INDEX IF NOT EXISTS idx_visits_org_branch ON visits(organization_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_visits_org_completed ON visits(organization_id, completed_at);
CREATE INDEX IF NOT EXISTS idx_queue_entries_org ON queue_entries(organization_id);
CREATE INDEX IF NOT EXISTS idx_queue_entries_org_branch ON queue_entries(organization_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_attendance_logs_org ON attendance_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_attendance_logs_org_branch ON attendance_logs(organization_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_point_transactions_org ON point_transactions(organization_id);
CREATE INDEX IF NOT EXISTS idx_client_rewards_org ON client_rewards(organization_id);
CREATE INDEX IF NOT EXISTS idx_qr_photo_sessions_org ON qr_photo_sessions(organization_id);

-- Compuestos para queries frecuentes
CREATE INDEX IF NOT EXISTS idx_staff_org_branch ON staff(organization_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_staff_org_active ON staff(organization_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_clients_org_phone ON clients(organization_id, phone);

-- =============================================================================
-- PARTE 8: Actualizar RLS en tablas desnormalizadas (para mobile/público)
-- =============================================================================

-- visits: agregar política org-aware si no existe
DO $$
BEGIN
  -- Drop old policies that don't filter by org (if they exist)
  DROP POLICY IF EXISTS "visits_org_read" ON visits;
  DROP POLICY IF EXISTS "visits_org_insert" ON visits;
END $$;

CREATE POLICY "visits_org_read" ON visits
  FOR SELECT USING (
    organization_id = get_user_org_id()
    OR
    -- Acceso público via token de review (el trigger on_queue_completed crea la visita)
    EXISTS (
      SELECT 1 FROM review_requests rr
      WHERE rr.visit_id = visits.id
    )
  );

-- queue_entries: actualizar políticas
DO $$
BEGIN
  DROP POLICY IF EXISTS "queue_entries_org_read" ON queue_entries;
END $$;

CREATE POLICY "queue_entries_org_read" ON queue_entries
  FOR SELECT USING (true);  -- Cola es pública (TV, kiosk)

-- attendance_logs
DO $$
BEGIN
  DROP POLICY IF EXISTS "attendance_org_read" ON attendance_logs;
END $$;

CREATE POLICY "attendance_org_read" ON attendance_logs
  FOR SELECT USING (
    organization_id = get_user_org_id()
    OR
    -- Acceso público desde kiosk (busca clock_in/out del día)
    true
  );

-- point_transactions
DO $$
BEGIN
  DROP POLICY IF EXISTS "point_transactions_org_read" ON point_transactions;
END $$;

CREATE POLICY "point_transactions_org_read" ON point_transactions
  FOR SELECT USING (
    organization_id = get_user_org_id()
    OR client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid())
  );

-- client_rewards
DO $$
BEGIN
  DROP POLICY IF EXISTS "client_rewards_org_read" ON client_rewards;
END $$;

CREATE POLICY "client_rewards_org_read" ON client_rewards
  FOR SELECT USING (
    organization_id = get_user_org_id()
    OR client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid())
  );

-- qr_photo_sessions
DO $$
BEGIN
  DROP POLICY IF EXISTS "qr_sessions_org_read" ON qr_photo_sessions;
END $$;

CREATE POLICY "qr_sessions_org_read" ON qr_photo_sessions
  FOR SELECT USING (true);  -- Público por diseño (acceso por token QR)
