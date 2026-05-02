-- Permitir ventas "de la barbería" (sin barbero asignado).
-- Cuando una venta es de la casa, no hay comisión a barbero ni salary_report.
-- product_sales.barber_id y visits.barber_id se vuelven NULL para esos casos.

ALTER TABLE public.product_sales
  ALTER COLUMN barber_id DROP NOT NULL;

ALTER TABLE public.visits
  ALTER COLUMN barber_id DROP NOT NULL;

COMMENT ON COLUMN public.product_sales.barber_id IS
  'NULL = venta de la barbería (sin comisión a barbero). Caso contrario = barbero que hizo la venta.';

COMMENT ON COLUMN public.visits.barber_id IS
  'NULL = venta de la barbería (visita fantasma sin barbero). Caso contrario = barbero que atendió.';
