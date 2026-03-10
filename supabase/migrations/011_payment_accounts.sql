-- ============================================
-- Cuentas de cobro configurables por el dueño
-- ============================================

CREATE TABLE payment_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  alias_or_cbu TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payment_accounts_branch ON payment_accounts(branch_id);

CREATE TRIGGER trg_payment_accounts_updated_at BEFORE UPDATE ON payment_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Imputar cobro a una cuenta en cada visita
ALTER TABLE visits ADD COLUMN payment_account_id UUID REFERENCES payment_accounts(id) ON DELETE SET NULL;

-- RLS
ALTER TABLE payment_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payment_accounts_read_all" ON payment_accounts FOR SELECT USING (true);
CREATE POLICY "payment_accounts_manage_owner" ON payment_accounts FOR ALL
  USING (EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid() AND role IN ('owner', 'admin')));
