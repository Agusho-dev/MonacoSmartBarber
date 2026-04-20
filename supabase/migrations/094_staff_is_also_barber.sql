-- 094_staff_is_also_barber.sql
-- Distingue a los owners/admins que además atienden clientes como barbero,
-- sin cambiar su rol (preserva permisos administrativos).
-- Uso: todos los listados de "barberos activos" incluyen role='barber' OR is_also_barber=true.

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS is_also_barber BOOLEAN NOT NULL DEFAULT false;

-- Índice parcial: acelera los filtros `role='barber' OR is_also_barber=true`
-- dentro de una organización.
CREATE INDEX IF NOT EXISTS idx_staff_is_also_barber
  ON public.staff (organization_id)
  WHERE is_also_barber = true;

COMMENT ON COLUMN public.staff.is_also_barber IS
  'True cuando un owner/admin también atiende clientes como barbero. Los listados de barberos deben incluir (role=''barber'' OR is_also_barber=true).';
