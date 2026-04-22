-- =============================================================================
-- Migración 108: Pagos manuales por turno + expiración de tokens
--
-- A) Agregar columnas de pago a appointments. Los pagos se manejan manualmente
--    (efectivo, transferencia, MercadoPago manual, etc.); no hay gateway.
--    Soporta tanto prepago como postpago.
-- B) Expiración de cancellation_token: los tokens no deben ser válidos
--    indefinidamente (ataca replay y elimina links fantasmas).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. Pagos
-- ---------------------------------------------------------------------------

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid', 'paid', 'partial', 'refunded'));

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS payment_amount DECIMAL(12,2);

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS payment_method TEXT
    CHECK (payment_method IS NULL OR payment_method IN (
      'efectivo', 'transferencia', 'mercadopago', 'tarjeta_debito', 'tarjeta_credito', 'otro'
    ));

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS paid_by_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS payment_notes TEXT;

COMMENT ON COLUMN appointments.payment_status IS 'Estado del pago: unpaid (por defecto), paid (cobrado), partial (seña), refunded.';
COMMENT ON COLUMN appointments.payment_amount IS 'Monto cobrado (para partial) o total (para paid). En ARS.';
COMMENT ON COLUMN appointments.payment_flag IS 'Indicativo de cuándo cobrar: prepago (antes) o postpago (después). Se setea al crear el turno según appointment_settings.payment_mode.';

CREATE INDEX IF NOT EXISTS idx_appointments_payment_status
  ON appointments(organization_id, payment_status)
  WHERE payment_status IN ('unpaid', 'partial');

-- ---------------------------------------------------------------------------
-- B. Expiración de tokens
-- ---------------------------------------------------------------------------

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN appointments.token_expires_at IS 'Momento a partir del cual cancellation_token deja de ser válido. Default: fecha del turno + 24h.';

-- Backfill: tokens existentes expiran al día siguiente del turno
UPDATE appointments
SET token_expires_at = (appointment_date + INTERVAL '1 day 23 hours')::TIMESTAMPTZ
WHERE token_expires_at IS NULL
  AND cancellation_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_token_expiration
  ON appointments(cancellation_token, token_expires_at)
  WHERE cancellation_token IS NOT NULL;
