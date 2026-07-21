-- ============================================================
-- 164 — Cobro conjunto (una transferencia paga varios cortes)
-- ============================================================
-- Caso real: dos clientes vienen juntos, se hacen dos cortes (a veces con
-- barberos distintos) y UNO solo paga el total por transferencia a una cuenta.
-- Con el comprobante obligatorio, el 2º barbero quedaba BLOQUEADO: su corte le
-- exige un comprobante propio, y si escaneaba el mismo salía "duplicado".
--
-- Modelo:
--   • El barbero que recibe la transferencia escanea el comprobante marcándolo
--     como "pago conjunto" → payment_receipts.covers_group = true. Ese comprobante
--     es el ANCLA del grupo (su monto = total transferido, cubre varios cortes).
--   • Cada corte del grupo apunta al ancla con visits.covering_receipt_id. El corte
--     que escaneó apunta a su propio comprobante; los demás se "cuelgan" del ancla
--     SIN crear un comprobante nuevo (por eso no chocan con el UNIQUE por nº de op.
--     ni piden escaneo → el 2º barbero deja de estar bloqueado).
--   • La plata sigue siendo transfer real a la cuenta del ancla: el trigger
--     fn_sync_transfer_log_from_visit crea el transfer_log de cada corte contra esa
--     cuenta → el acumulado del mes = suma de los cortes = depósito real (sin doble
--     conteo). La comisión de cada corte queda con SU barbero.
--
-- La conciliación (dashboard) valida que la suma de los cortes del grupo no supere
-- el monto del comprobante, y muestra el grupo como aviso interno "Cobro conjunto".

-- Comprobante ancla de un pago conjunto.
ALTER TABLE payment_receipts
  ADD COLUMN IF NOT EXISTS covers_group boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN payment_receipts.covers_group IS
  'true = este comprobante cubre varios cortes (pago conjunto). Su monto se concilia contra la SUMA de los cortes del grupo, no contra un solo corte.';

-- Corte que se paga dentro de un grupo → apunta al comprobante ancla.
ALTER TABLE visits
  ADD COLUMN IF NOT EXISTS covering_receipt_id uuid REFERENCES payment_receipts(id) ON DELETE SET NULL;

COMMENT ON COLUMN visits.covering_receipt_id IS
  'Comprobante (ancla) que respalda este corte cuando se cobró junto con otros en una sola transferencia. NULL = cobro normal (comprobante propio o sin comprobante).';

-- Suma del grupo por ancla (conciliación) + attach del 2º barbero.
CREATE INDEX IF NOT EXISTS idx_visits_covering_receipt
  ON visits (covering_receipt_id)
  WHERE covering_receipt_id IS NOT NULL;

-- Listado de comprobantes-ancla abiertos por sucursal (picker del barbero).
CREATE INDEX IF NOT EXISTS idx_payment_receipts_covers_group
  ON payment_receipts (branch_id, created_at DESC)
  WHERE covers_group;
