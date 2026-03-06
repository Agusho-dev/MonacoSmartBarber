-- ============================================
-- Monaco Smart Barber - Fase 2: Settings & Goals
-- ============================================

-- ============================================
-- Configuración general de la app
-- ============================================
CREATE TABLE app_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lost_client_days INTEGER NOT NULL DEFAULT 40,
  at_risk_client_days INTEGER NOT NULL DEFAULT 25,
  business_hours_open TIME NOT NULL DEFAULT '09:00',
  business_hours_close TIME NOT NULL DEFAULT '21:00',
  business_days INTEGER[] NOT NULL DEFAULT '{1,2,3,4,5,6}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_app_settings_updated_at BEFORE UPDATE ON app_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

INSERT INTO app_settings DEFAULT VALUES;

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings_read_all" ON app_settings FOR SELECT USING (true);
CREATE POLICY "settings_manage_owner" ON app_settings FOR ALL USING (is_admin_or_owner());

-- ============================================
-- Metas mensuales (por sucursal y/o barbero)
-- ============================================
CREATE TABLE goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  barber_id UUID REFERENCES staff(id) ON DELETE CASCADE,
  month DATE NOT NULL,
  target_cuts INTEGER NOT NULL DEFAULT 0,
  target_revenue NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT goals_unique_branch_month UNIQUE (branch_id, barber_id, month)
);

CREATE INDEX idx_goals_month ON goals(month);
CREATE INDEX idx_goals_branch ON goals(branch_id);
CREATE INDEX idx_goals_barber ON goals(barber_id);

CREATE TRIGGER trg_goals_updated_at BEFORE UPDATE ON goals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "goals_read_all" ON goals FOR SELECT USING (true);
CREATE POLICY "goals_manage_owner" ON goals FOR ALL USING (is_admin_or_owner());
