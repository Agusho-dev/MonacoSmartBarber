-- F11: Método de pago y cuenta debitada para cada lote de sueldos
ALTER TABLE salary_payment_batches
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'cash'
    CHECK (payment_method IN ('cash','transfer','card','other'));

ALTER TABLE salary_payment_batches
  ADD COLUMN IF NOT EXISTS payment_account_id uuid REFERENCES payment_accounts(id) ON DELETE SET NULL;

ALTER TABLE salary_payment_batches
  ADD COLUMN IF NOT EXISTS expense_ticket_id uuid REFERENCES expense_tickets(id) ON DELETE SET NULL;

COMMENT ON COLUMN salary_payment_batches.payment_method IS 'Método: cash, transfer, card, other';
COMMENT ON COLUMN salary_payment_batches.payment_account_id IS 'Cuenta debitada si payment_method=transfer';
COMMENT ON COLUMN salary_payment_batches.expense_ticket_id IS 'expense_ticket generado automáticamente para reflejar el egreso en caja';

CREATE INDEX IF NOT EXISTS idx_salary_batches_payment_account
  ON salary_payment_batches (payment_account_id)
  WHERE payment_account_id IS NOT NULL;
