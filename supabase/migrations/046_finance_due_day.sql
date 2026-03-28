-- ============================================================
-- Migración 046: Día de vencimiento para gastos fijos
-- ============================================================

-- Agrega el campo due_day a fixed_expenses.
-- Día del mes en que vence este gasto fijo (1-31).
-- Nullable porque los gastos existentes no tienen este dato aún.

ALTER TABLE fixed_expenses
  ADD COLUMN IF NOT EXISTS due_day SMALLINT
  CHECK (due_day BETWEEN 1 AND 31);

COMMENT ON COLUMN fixed_expenses.due_day
  IS 'Día del mes en que vence este gasto fijo (1-31)';
