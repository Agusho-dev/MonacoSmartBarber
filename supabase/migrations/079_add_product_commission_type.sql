-- ============================================================
-- Migración 079: Agregar tipo product_commission a salary_reports
-- Permite diferenciar comisiones por servicio de comisiones por producto
-- ============================================================

-- 1. Actualizar CHECK constraint para incluir product_commission
ALTER TABLE salary_reports DROP CONSTRAINT IF EXISTS salary_reports_type_check;
ALTER TABLE salary_reports
  ADD CONSTRAINT salary_reports_type_check
  CHECK (type IN ('commission', 'base_salary', 'bonus', 'advance', 'hybrid_deficit', 'product_commission'));

-- 2. Eliminar índice unique que impide tener commission y product_commission el mismo día
DROP INDEX IF EXISTS idx_sr_staff_date_type_unique;

-- 3. Crear índices unique separados por tipo
CREATE UNIQUE INDEX IF NOT EXISTS idx_sr_staff_date_commission_unique
  ON salary_reports(staff_id, report_date, type)
  WHERE type = 'commission';

CREATE UNIQUE INDEX IF NOT EXISTS idx_sr_staff_date_product_commission_unique
  ON salary_reports(staff_id, report_date, type)
  WHERE type = 'product_commission';

-- 4. Generar reportes retroactivos para product_sales existentes sin reporte
INSERT INTO salary_reports (staff_id, branch_id, type, amount, report_date, status, notes)
SELECT
  ps.barber_id,
  ps.branch_id,
  'product_commission',
  SUM(ps.commission_amount),
  v.completed_at::date,
  'pending',
  'Comisión por venta de productos (retroactivo)'
FROM product_sales ps
JOIN visits v ON v.id = ps.visit_id
WHERE ps.commission_amount > 0
  AND NOT EXISTS (
    SELECT 1 FROM salary_reports sr
    WHERE sr.staff_id = ps.barber_id
      AND sr.branch_id = ps.branch_id
      AND sr.type = 'product_commission'
      AND sr.report_date = v.completed_at::date
  )
GROUP BY ps.barber_id, ps.branch_id, v.completed_at::date;
