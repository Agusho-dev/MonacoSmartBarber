-- ============================================
-- Monaco Smart Barber - Finanzas: Gastos Fijos
-- ============================================

CREATE TABLE fixed_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fixed_expenses_branch ON fixed_expenses(branch_id);
CREATE INDEX idx_fixed_expenses_active ON fixed_expenses(is_active);

CREATE TRIGGER trg_fixed_expenses_updated_at BEFORE UPDATE ON fixed_expenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE fixed_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fixed_expenses_read_all" ON fixed_expenses FOR SELECT USING (true);
CREATE POLICY "fixed_expenses_manage_owner" ON fixed_expenses FOR ALL USING (is_admin_or_owner());
