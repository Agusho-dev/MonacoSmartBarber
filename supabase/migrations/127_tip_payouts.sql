-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 127 — Reportes de propinas (tips) para sueldos.
--
-- visits.tip_amount existe desde mig 101 pero las propinas nunca se
-- liquidaban al barbero. Las propinas son 100% del barbero (no comisión).
-- Este patch:
--   1. Suma 'tip' al CHECK de salary_reports.type.
--   2. Agrega columnas tip_payment_method + source_visit_id.
--   3. Unique parcial sobre source_visit_id WHERE type='tip' (idempotencia).
--   4. Backfill atómico de visits con tip_amount > 0.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1) Extender el CHECK de type
ALTER TABLE public.salary_reports
  DROP CONSTRAINT IF EXISTS salary_reports_type_check;

ALTER TABLE public.salary_reports
  ADD CONSTRAINT salary_reports_type_check
  CHECK (type IN (
    'commission',
    'base_salary',
    'bonus',
    'advance',
    'hybrid_deficit',
    'product_commission',
    'tip'
  ));

-- 2) Columnas nuevas para propinas
ALTER TABLE public.salary_reports
  ADD COLUMN IF NOT EXISTS tip_payment_method text NULL
    CHECK (tip_payment_method IS NULL OR tip_payment_method IN ('cash','card','transfer')),
  ADD COLUMN IF NOT EXISTS source_visit_id uuid NULL
    REFERENCES public.visits(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.salary_reports.tip_payment_method IS
  'Método con que el cliente pagó la propina. Solo aplica a type=tip.';
COMMENT ON COLUMN public.salary_reports.source_visit_id IS
  'Si el reporte proviene de una visita específica (caso típico: type=tip), referencia trazable.';

-- 3) Idempotencia del backfill: una visita = a lo sumo UN report de tip
CREATE UNIQUE INDEX IF NOT EXISTS uniq_tip_per_visit
  ON public.salary_reports (source_visit_id)
  WHERE type = 'tip' AND source_visit_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_salary_reports_tip_pending
  ON public.salary_reports (staff_id, branch_id, status)
  WHERE type = 'tip';

-- 4) Backfill histórico — TZ-aware por sucursal, idempotente vía NOT EXISTS
INSERT INTO public.salary_reports (
  staff_id,
  branch_id,
  type,
  amount,
  notes,
  report_date,
  status,
  tip_payment_method,
  source_visit_id
)
SELECT
  v.barber_id,
  v.branch_id,
  'tip',
  v.tip_amount,
  CASE v.tip_payment_method
    WHEN 'cash'     THEN 'Propina del cliente — efectivo'
    WHEN 'card'     THEN 'Propina del cliente — tarjeta'
    WHEN 'transfer' THEN 'Propina del cliente — transferencia'
    ELSE 'Propina del cliente'
  END,
  (v.completed_at AT TIME ZONE COALESCE(b.timezone, 'America/Argentina/Buenos_Aires'))::date,
  'pending',
  v.tip_payment_method,
  v.id
FROM public.visits v
JOIN public.branches b ON b.id = v.branch_id
WHERE v.tip_amount > 0
  AND v.completed_at IS NOT NULL
  AND v.barber_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.salary_reports sr
    WHERE sr.type = 'tip' AND sr.source_visit_id = v.id
  );

COMMIT;
