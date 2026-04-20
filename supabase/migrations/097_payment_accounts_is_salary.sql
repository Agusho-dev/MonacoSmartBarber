-- F7: Marca cuentas usadas para pagar sueldos
ALTER TABLE payment_accounts
  ADD COLUMN IF NOT EXISTS is_salary_account boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN payment_accounts.is_salary_account IS 'Si es true, la cuenta se usa para pagos de sueldos (filtrable en caja)';

CREATE INDEX IF NOT EXISTS idx_payment_accounts_is_salary
  ON payment_accounts (branch_id, is_salary_account)
  WHERE is_salary_account = true;
