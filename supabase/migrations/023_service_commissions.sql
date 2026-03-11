-- ============================================
-- Service Commissions: per-service default + per-barber overrides
-- ============================================

-- 1. Add default commission to services table
ALTER TABLE services ADD COLUMN default_commission_pct NUMERIC(5,2) NOT NULL DEFAULT 0;

-- 2. Per-barber per-service commission overrides
CREATE TABLE staff_service_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  commission_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(staff_id, service_id)
);

CREATE INDEX idx_ssc_staff ON staff_service_commissions(staff_id);
CREATE INDEX idx_ssc_service ON staff_service_commissions(service_id);

-- RLS
ALTER TABLE staff_service_commissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ssc_read_all" ON staff_service_commissions
  FOR SELECT USING (true);

CREATE POLICY "ssc_manage_admin" ON staff_service_commissions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM staff
      WHERE auth_user_id = auth.uid()
        AND role IN ('owner', 'admin')
    )
  );

-- Updated_at trigger
CREATE TRIGGER trg_ssc_updated_at BEFORE UPDATE ON staff_service_commissions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
