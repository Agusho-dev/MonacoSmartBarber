-- ============================================
-- Monaco Smart Barber - Schema Inicial
-- ============================================

-- Enums
CREATE TYPE user_role AS ENUM ('owner', 'admin', 'receptionist', 'barber');
CREATE TYPE queue_status AS ENUM ('waiting', 'in_progress', 'completed', 'cancelled');
CREATE TYPE payment_method AS ENUM ('cash', 'card', 'transfer');
CREATE TYPE point_tx_type AS ENUM ('earned', 'redeemed');

-- ============================================
-- Sucursales
-- ============================================
CREATE TABLE branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- Staff (dueño, admin, recepcionista, barbero)
-- Vinculado a auth.users para owner/admin
-- PIN para barberos en dispositivo compartido
-- ============================================
CREATE TABLE staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  role user_role NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  pin TEXT,
  commission_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_staff_branch ON staff(branch_id);
CREATE INDEX idx_staff_auth_user ON staff(auth_user_id);
CREATE INDEX idx_staff_role ON staff(role);

-- ============================================
-- Clientes
-- phone es el identificador universal
-- auth_user_id se llena cuando se registran en la app
-- ============================================
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_clients_phone ON clients(phone);

-- ============================================
-- Servicios (configurables por el dueño)
-- branch_id NULL = disponible en todas las sucursales
-- ============================================
CREATE TABLE services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  duration_minutes INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_services_branch ON services(branch_id);

-- ============================================
-- Cola de espera
-- ============================================
CREATE TABLE queue_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  barber_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  status queue_status NOT NULL DEFAULT 'waiting',
  position INTEGER NOT NULL,
  checked_in_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_queue_branch_status ON queue_entries(branch_id, status);
CREATE INDEX idx_queue_client ON queue_entries(client_id);
CREATE INDEX idx_queue_barber ON queue_entries(barber_id);

-- ============================================
-- Visitas (registro histórico de cada corte)
-- ============================================
CREATE TABLE visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  barber_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  service_id UUID REFERENCES services(id) ON DELETE SET NULL,
  queue_entry_id UUID REFERENCES queue_entries(id) ON DELETE SET NULL,
  payment_method payment_method NOT NULL DEFAULT 'cash',
  amount NUMERIC(10,2) NOT NULL,
  commission_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  commission_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_visits_branch ON visits(branch_id);
CREATE INDEX idx_visits_client ON visits(client_id);
CREATE INDEX idx_visits_barber ON visits(barber_id);
CREATE INDEX idx_visits_completed ON visits(completed_at);

-- ============================================
-- Configuración de recompensas
-- ============================================
CREATE TABLE rewards_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  points_per_visit INTEGER NOT NULL DEFAULT 1,
  redemption_threshold INTEGER NOT NULL DEFAULT 10,
  reward_description TEXT NOT NULL DEFAULT 'Corte gratis',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- Puntos de clientes
-- ============================================
CREATE TABLE client_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  points_balance INTEGER NOT NULL DEFAULT 0,
  total_earned INTEGER NOT NULL DEFAULT 0,
  total_redeemed INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(client_id, branch_id)
);

-- ============================================
-- Transacciones de puntos
-- ============================================
CREATE TABLE point_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  visit_id UUID REFERENCES visits(id) ON DELETE SET NULL,
  points INTEGER NOT NULL,
  type point_tx_type NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_point_tx_client ON point_transactions(client_id);

-- ============================================
-- Función: auto-update updated_at
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_branches_updated_at BEFORE UPDATE ON branches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_staff_updated_at BEFORE UPDATE ON staff
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_clients_updated_at BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_services_updated_at BEFORE UPDATE ON services
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_rewards_config_updated_at BEFORE UPDATE ON rewards_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- Función: calcular siguiente posición en cola
-- ============================================
CREATE OR REPLACE FUNCTION next_queue_position(p_branch_id UUID)
RETURNS INTEGER AS $$
DECLARE
  max_pos INTEGER;
BEGIN
  SELECT COALESCE(MAX(position), 0) INTO max_pos
  FROM queue_entries
  WHERE branch_id = p_branch_id
    AND status IN ('waiting', 'in_progress')
    AND DATE(checked_in_at) = CURRENT_DATE;
  RETURN max_pos + 1;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Función: al completar visita, crear registro
-- y otorgar puntos automáticamente
-- ============================================
CREATE OR REPLACE FUNCTION on_queue_completed()
RETURNS TRIGGER AS $$
DECLARE
  v_service_price NUMERIC(10,2);
  v_commission NUMERIC(5,2);
  v_commission_amount NUMERIC(10,2);
  v_points INTEGER;
  v_reward_active BOOLEAN;
BEGIN
  IF NEW.status = 'completed' AND OLD.status = 'in_progress' THEN
    SELECT commission_pct INTO v_commission FROM staff WHERE id = NEW.barber_id;
    v_commission := COALESCE(v_commission, 0);

    SELECT price INTO v_service_price FROM services
      WHERE is_active = true
      AND (branch_id = NEW.branch_id OR branch_id IS NULL)
      ORDER BY created_at LIMIT 1;
    v_service_price := COALESCE(v_service_price, 0);

    v_commission_amount := v_service_price * (v_commission / 100);

    INSERT INTO visits (branch_id, client_id, barber_id, queue_entry_id, amount, commission_pct, commission_amount, started_at, completed_at)
    VALUES (NEW.branch_id, NEW.client_id, NEW.barber_id, NEW.id, v_service_price, v_commission, v_commission_amount, NEW.started_at, NEW.completed_at);

    SELECT rw.points_per_visit, rw.is_active INTO v_points, v_reward_active
    FROM rewards_config rw
    WHERE (rw.branch_id = NEW.branch_id OR rw.branch_id IS NULL)
      AND rw.is_active = true
    LIMIT 1;

    IF v_reward_active IS TRUE AND v_points > 0 THEN
      INSERT INTO client_points (client_id, branch_id, points_balance, total_earned)
      VALUES (NEW.client_id, NEW.branch_id, v_points, v_points)
      ON CONFLICT (client_id, branch_id)
      DO UPDATE SET
        points_balance = client_points.points_balance + v_points,
        total_earned = client_points.total_earned + v_points;

      INSERT INTO point_transactions (client_id, points, type, description)
      VALUES (NEW.client_id, v_points, 'earned', 'Puntos por visita');
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_queue_completed
  AFTER UPDATE ON queue_entries
  FOR EACH ROW EXECUTE FUNCTION on_queue_completed();

-- ============================================
-- RLS Policies
-- ============================================
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE rewards_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE point_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "branches_read_all" ON branches FOR SELECT USING (true);
CREATE POLICY "branches_manage_owner" ON branches FOR ALL
  USING (EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid() AND role IN ('owner', 'admin')));

CREATE POLICY "staff_read_authenticated" ON staff FOR SELECT USING (true);
CREATE POLICY "staff_manage_owner" ON staff FOR ALL
  USING (EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid() AND role IN ('owner', 'admin')));

CREATE POLICY "clients_read_all" ON clients FOR SELECT USING (true);
CREATE POLICY "clients_insert_all" ON clients FOR INSERT WITH CHECK (true);
CREATE POLICY "clients_update_staff" ON clients FOR UPDATE
  USING (EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid()));

CREATE POLICY "services_read_all" ON services FOR SELECT USING (true);
CREATE POLICY "services_manage_owner" ON services FOR ALL
  USING (EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid() AND role IN ('owner', 'admin')));

CREATE POLICY "queue_read_all" ON queue_entries FOR SELECT USING (true);
CREATE POLICY "queue_insert_all" ON queue_entries FOR INSERT WITH CHECK (true);
CREATE POLICY "queue_update_staff" ON queue_entries FOR UPDATE
  USING (EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid()));

CREATE POLICY "visits_read_staff" ON visits FOR SELECT
  USING (EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid()));
CREATE POLICY "visits_insert_staff" ON visits FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid()));

CREATE POLICY "rewards_read_all" ON rewards_config FOR SELECT USING (true);
CREATE POLICY "rewards_manage_owner" ON rewards_config FOR ALL
  USING (EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid() AND role IN ('owner', 'admin')));

CREATE POLICY "points_read_all" ON client_points FOR SELECT USING (true);
CREATE POLICY "points_manage_staff" ON client_points FOR ALL
  USING (EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid()));

CREATE POLICY "point_tx_read_all" ON point_transactions FOR SELECT USING (true);
CREATE POLICY "point_tx_insert_staff" ON point_transactions FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid()));

-- ============================================
-- Vista: estadísticas de ocupación por sucursal
-- ============================================
CREATE OR REPLACE VIEW branch_occupancy AS
SELECT
  b.id AS branch_id,
  b.name AS branch_name,
  COUNT(CASE WHEN qe.status = 'waiting' THEN 1 END) AS clients_waiting,
  COUNT(CASE WHEN qe.status = 'in_progress' THEN 1 END) AS clients_in_progress,
  (SELECT COUNT(*) FROM staff s WHERE s.branch_id = b.id AND s.role = 'barber' AND s.is_active = true) AS total_barbers,
  (SELECT COUNT(*) FROM staff s WHERE s.branch_id = b.id AND s.role = 'barber' AND s.is_active = true
    AND s.id NOT IN (SELECT qe2.barber_id FROM queue_entries qe2 WHERE qe2.branch_id = b.id AND qe2.status = 'in_progress' AND qe2.barber_id IS NOT NULL)
  ) AS available_barbers
FROM branches b
LEFT JOIN queue_entries qe ON qe.branch_id = b.id
  AND qe.status IN ('waiting', 'in_progress')
  AND DATE(qe.checked_in_at) = CURRENT_DATE
WHERE b.is_active = true
GROUP BY b.id, b.name;
