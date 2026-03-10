-- ============================================
-- Sistema de sueldos configurable
-- ============================================

CREATE TYPE salary_scheme AS ENUM ('fixed', 'commission', 'hybrid');

-- Configuración del esquema salarial por barbero
CREATE TABLE salary_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL UNIQUE REFERENCES staff(id) ON DELETE CASCADE,
  scheme salary_scheme NOT NULL DEFAULT 'fixed',
  base_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  commission_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_salary_configs_staff ON salary_configs(staff_id);

CREATE TRIGGER trg_salary_configs_updated_at BEFORE UPDATE ON salary_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Registro de períodos de pago
CREATE TABLE salary_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  calculated_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_paid BOOLEAN NOT NULL DEFAULT false,
  paid_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_salary_payments_staff ON salary_payments(staff_id);
CREATE INDEX idx_salary_payments_period ON salary_payments(period_start, period_end);

CREATE TRIGGER trg_salary_payments_updated_at BEFORE UPDATE ON salary_payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE salary_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "salary_configs_read_owner" ON salary_configs FOR SELECT
  USING (EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid() AND role IN ('owner', 'admin')));
CREATE POLICY "salary_configs_manage_owner" ON salary_configs FOR ALL
  USING (EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid() AND role IN ('owner', 'admin')));

ALTER TABLE salary_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "salary_payments_read_owner" ON salary_payments FOR SELECT
  USING (EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid() AND role IN ('owner', 'admin')));
CREATE POLICY "salary_payments_manage_owner" ON salary_payments FOR ALL
  USING (EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid() AND role IN ('owner', 'admin')));

-- Función: calcula el sueldo de un barbero para un período dado
CREATE OR REPLACE FUNCTION calculate_barber_salary(
  p_staff_id UUID,
  p_period_start DATE,
  p_period_end DATE
)
RETURNS NUMERIC(12,2) AS $$
DECLARE
  v_scheme salary_scheme;
  v_base NUMERIC(12,2);
  v_commission_pct NUMERIC(5,2);
  v_total_billed NUMERIC(12,2);
  v_commission_earned NUMERIC(12,2);
  v_result NUMERIC(12,2);
BEGIN
  SELECT scheme, base_amount, commission_pct
  INTO v_scheme, v_base, v_commission_pct
  FROM salary_configs
  WHERE staff_id = p_staff_id;

  IF NOT FOUND THEN
    -- Sin config: usar commission_pct de staff si existe
    SELECT commission_pct INTO v_commission_pct FROM staff WHERE id = p_staff_id;
    v_scheme := 'commission';
    v_base := 0;
  END IF;

  -- Total facturado en el período
  SELECT COALESCE(SUM(amount), 0)
  INTO v_total_billed
  FROM visits
  WHERE barber_id = p_staff_id
    AND completed_at::date BETWEEN p_period_start AND p_period_end;

  v_commission_earned := v_total_billed * (COALESCE(v_commission_pct, 0) / 100);

  v_result := CASE v_scheme
    WHEN 'fixed'      THEN v_base
    WHEN 'commission' THEN v_commission_earned
    WHEN 'hybrid'     THEN GREATEST(v_base, v_commission_earned)
    ELSE v_base
  END;

  RETURN COALESCE(v_result, 0);
END;
$$ LANGUAGE plpgsql;
