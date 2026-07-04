-- ============================================================
-- Migración 159: Validación de FECHA del comprobante (anti-fraude)
-- ============================================================
-- Problema: mostrar un comprobante viejo (o de otro día) pasaba como válido.
-- Fix: el comprobante debe ser RECIENTE (ventana configurable). Si su fecha/hora
-- es vieja o futura → estado nuevo 'date_mismatch' ("Fecha vieja"), no verificado.
-- Combinado con el UNIQUE de operation_number (anti-duplicado exacto), cierra el hueco.
-- Todo aditivo e idempotente.
-- ============================================================

-- Nuevo estado. (PG15: ADD VALUE fuera de uso en la misma tx está permitido.)
ALTER TYPE receipt_status ADD VALUE IF NOT EXISTS 'date_mismatch';

-- Resultado de la validación de frescura: true=reciente, false=vieja/futura, null=no se pudo leer.
ALTER TABLE public.payment_receipts
  ADD COLUMN IF NOT EXISTS date_ok boolean;

-- Ventana de frescura (minutos). Default 180 = 3h: tolera que el cliente haya
-- transferido mientras esperaba en la fila, pero rechaza comprobantes de otro día.
ALTER TABLE public.transfer_receipt_settings
  ADD COLUMN IF NOT EXISTS date_tolerance_minutes integer NOT NULL DEFAULT 180;
