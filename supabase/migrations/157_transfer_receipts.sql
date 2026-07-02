-- ============================================================
-- Migración 157: Comprobantes de transferencia + Conciliación
-- ============================================================
--
-- Circuito de integridad de pagos por transferencia:
--   1) Al cobrar por transferencia en la tablet del barbero se escanea el
--      comprobante (cámara frontal o fallback QR). La imagen + los datos
--      extraídos (IA Claude vision o motor OCR) se guardan en `payment_receipts`.
--   2) El dashboard admin (/dashboard/comprobantes) concilia cada cobro
--      `visits.payment_method='transfer'` contra su comprobante.
--
-- Todo ADITIVO. No toca ninguna fila existente. Idempotente.
-- ============================================================

-- ── Enum de estado del comprobante ─────────────────────────
-- verified       : leído, monto coincide con lo cobrado.
-- amount_mismatch: leído, pero el monto NO coincide.
-- duplicate      : el nº de operación ya se usó en otro cobro (mismo comprobante reusado).
-- needs_review   : no se pudo leer / baja confianza. La imagen quedó guardada ("en revisión").
-- manual_ok      : un admin lo dio por válido a mano desde conciliación.
-- overridden     : el barbero forzó el cobro pese a un problema (queda registrado).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'receipt_status') THEN
    CREATE TYPE receipt_status AS ENUM (
      'verified', 'amount_mismatch', 'duplicate', 'needs_review', 'manual_ok', 'overridden'
    );
  END IF;
END$$;

-- ── Tabla principal ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payment_receipts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id             uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,

  -- Vínculos con el cobro (nullables: el comprobante puede escanearse antes de
  -- finalizar la visita, y puede quedar huérfano si no matchea ningún cobro).
  visit_id              uuid REFERENCES public.visits(id) ON DELETE SET NULL,
  transfer_log_id       uuid REFERENCES public.transfer_logs(id) ON DELETE SET NULL,
  payment_account_id    uuid REFERENCES public.payment_accounts(id) ON DELETE SET NULL,
  barber_id             uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  client_id             uuid REFERENCES public.clients(id) ON DELETE SET NULL,

  -- Evidencia. Bucket PRIVADO 'transfer-receipts', path {org_id}/{receipt_id}.webp
  image_path            text,
  capture_method        text NOT NULL DEFAULT 'front_camera',  -- front_camera | qr_upload | gallery
  extraction_engine     text,                                   -- ai | ocr_mistral | ocr_local

  status                receipt_status NOT NULL DEFAULT 'needs_review',

  -- Datos extraídos (columnas para filtrar + jsonb crudo para auditar)
  extracted_amount      numeric,
  extracted_datetime    timestamptz,
  operation_number      text,
  sender_name           text,
  sender_cbu_alias      text,
  recipient_name        text,
  recipient_cbu_alias   text,
  bank_or_wallet        text,
  canal                 text,          -- banco | mercado_pago | billetera_virtual | otro
  confidence            numeric,       -- 0..1 autoevaluación del motor
  raw_extraction        jsonb,

  -- Verificación (snapshot al momento del cobro)
  expected_amount       numeric,
  amount_matches        boolean,
  alias_matches         boolean,

  -- Revisión manual desde conciliación
  reconciled_at         timestamptz,
  reconciled_by         uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  review_note           text,

  created_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.payment_receipts IS
  'Comprobantes de transferencia escaneados en el cobro. Evidencia + extracción (IA/OCR) para conciliar contra visits.payment_method=transfer. Mig 157.';

-- ── Anti-fraude: un nº de operación no puede respaldar dos cobros ──
-- Sólo aplica a estados que "cuentan como respaldo válido". Los 'duplicate'/'needs_review'
-- quedan fuera del índice para poder REGISTRARLOS sin chocar con el original.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_receipts_operation
  ON public.payment_receipts (organization_id, operation_number)
  WHERE operation_number IS NOT NULL
    AND status IN ('verified', 'amount_mismatch', 'manual_ok', 'overridden');

-- ── Índices de lectura para conciliación ───────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_receipts_visit
  ON public.payment_receipts (visit_id) WHERE visit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_receipts_org_created
  ON public.payment_receipts (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_branch_created
  ON public.payment_receipts (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_account
  ON public.payment_receipts (payment_account_id);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_status
  ON public.payment_receipts (organization_id, status);

-- ── RLS (defensa en profundidad; el dashboard usa service role) ──
ALTER TABLE public.payment_receipts ENABLE ROW LEVEL SECURITY;

-- Miembros de la org leen sólo lo suyo. Escrituras: sólo service role (bypass RLS).
DROP POLICY IF EXISTS payment_receipts_org_read ON public.payment_receipts;
CREATE POLICY payment_receipts_org_read ON public.payment_receipts
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
  );

-- ── Config por organización ────────────────────────────────
-- is_enabled=false por DEFAULT: la feature arranca APAGADA para no romper el
-- checkout de transferencia de otras barberías (multi-tenant). El dueño la
-- prende desde Configuración, lo que setea required_since=now().
-- extraction_engine: 'ai' (Claude, default) | 'ocr_mistral' | 'ocr_local'.
CREATE TABLE IF NOT EXISTS public.transfer_receipt_settings (
  organization_id     uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  is_enabled          boolean NOT NULL DEFAULT false,
  extraction_engine   text NOT NULL DEFAULT 'ai',
  required_since       timestamptz,   -- desde cuándo un cobro transfer exige comprobante
  amount_tolerance    numeric NOT NULL DEFAULT 1,  -- ARS de tolerancia en el match de monto
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.transfer_receipt_settings IS
  'Config org-scope de comprobantes de transferencia. is_enabled arranca false (safe multi-tenant). Mig 157.';

ALTER TABLE public.transfer_receipt_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS transfer_receipt_settings_org_read ON public.transfer_receipt_settings;
CREATE POLICY transfer_receipt_settings_org_read ON public.transfer_receipt_settings
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
  );

-- ── Bucket privado para las imágenes de comprobantes ───────
-- Path: transfer-receipts/{organization_id}/{receipt_id}.webp
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'transfer-receipts',
  'transfer-receipts',
  false,
  8388608,  -- 8 MB
  ARRAY['image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Lectura sólo para miembros de la org (primer segmento del path = org_id) o admins.
-- Escrituras: sólo service role (el barbero no es usuario Supabase auth → sube por route handler).
DROP POLICY IF EXISTS transfer_receipts_org_read ON storage.objects;
CREATE POLICY transfer_receipts_org_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'transfer-receipts'
    AND (
      EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
      OR (storage.foldername(name))[1]::uuid IN (
        SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
      )
    )
  );
