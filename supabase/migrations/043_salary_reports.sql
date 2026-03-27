-- ============================================================
-- Migracion 043: Reportes salariales individuales y lotes de pago
-- ============================================================
-- Nuevo modelo de sueldos que reemplaza logicamente a salary_payments.
-- salary_payments NO se elimina (tiene datos existentes).
-- El nuevo flujo:
--   1. Se generan salary_reports individuales (comision, sueldo base, bono, adelanto)
--   2. El admin agrupa reportes pendientes en un salary_payment_batch (liquidacion)
--   3. El historial muestra lotes con sus reportes asociados
-- ============================================================

-- ============================================================
-- 1. Crear tabla: salary_payment_batches (lotes de pago / liquidaciones)
-- ============================================================
CREATE TABLE IF NOT EXISTS salary_payment_batches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id    UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  branch_id   UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE salary_payment_batches IS 'Lote de pago (liquidacion) que agrupa multiples reportes salariales';

-- ============================================================
-- 2. Crear tabla: salary_reports (items individuales de reporte)
-- ============================================================
CREATE TABLE IF NOT EXISTS salary_reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id     UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  branch_id    UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('commission', 'base_salary', 'bonus', 'advance')),
  amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes        TEXT,
  report_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  period_start DATE,
  period_end   DATE,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  batch_id     UUID REFERENCES salary_payment_batches(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE salary_reports IS 'Item individual de reporte salarial: comision, sueldo base, bono o adelanto';
COMMENT ON COLUMN salary_reports.type IS 'commission=comision diaria, base_salary=sueldo fijo, bonus=bono manual, advance=adelanto (monto negativo)';
COMMENT ON COLUMN salary_reports.status IS 'pending=pendiente de pago, paid=incluido en un lote de pago';

-- ============================================================
-- 3. Habilitar RLS en ambas tablas
-- ============================================================
ALTER TABLE salary_payment_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_reports ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 4. Policies para salary_payment_batches
--    Solo owner y admin pueden ver y gestionar lotes de pago
-- ============================================================

-- SELECT: lectura para owner/admin
CREATE POLICY salary_payment_batches_select_staff
  ON salary_payment_batches FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM staff
      WHERE staff.auth_user_id = auth.uid()
        AND staff.role IN ('owner'::user_role, 'admin'::user_role)
    )
  );

-- INSERT: solo owner/admin pueden crear lotes
CREATE POLICY salary_payment_batches_insert_staff
  ON salary_payment_batches FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM staff
      WHERE staff.auth_user_id = auth.uid()
        AND staff.role IN ('owner'::user_role, 'admin'::user_role)
    )
  );

-- UPDATE: solo owner/admin pueden modificar lotes
CREATE POLICY salary_payment_batches_update_staff
  ON salary_payment_batches FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM staff
      WHERE staff.auth_user_id = auth.uid()
        AND staff.role IN ('owner'::user_role, 'admin'::user_role)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM staff
      WHERE staff.auth_user_id = auth.uid()
        AND staff.role IN ('owner'::user_role, 'admin'::user_role)
    )
  );

-- DELETE: solo owner/admin pueden eliminar lotes
CREATE POLICY salary_payment_batches_delete_staff
  ON salary_payment_batches FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM staff
      WHERE staff.auth_user_id = auth.uid()
        AND staff.role IN ('owner'::user_role, 'admin'::user_role)
    )
  );

-- ============================================================
-- 5. Policies para salary_reports
--    Solo owner y admin pueden ver y gestionar reportes
-- ============================================================

-- SELECT: lectura para owner/admin
CREATE POLICY salary_reports_select_staff
  ON salary_reports FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM staff
      WHERE staff.auth_user_id = auth.uid()
        AND staff.role IN ('owner'::user_role, 'admin'::user_role)
    )
  );

-- INSERT: solo owner/admin pueden crear reportes
CREATE POLICY salary_reports_insert_staff
  ON salary_reports FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM staff
      WHERE staff.auth_user_id = auth.uid()
        AND staff.role IN ('owner'::user_role, 'admin'::user_role)
    )
  );

-- UPDATE: solo owner/admin pueden modificar reportes
CREATE POLICY salary_reports_update_staff
  ON salary_reports FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM staff
      WHERE staff.auth_user_id = auth.uid()
        AND staff.role IN ('owner'::user_role, 'admin'::user_role)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM staff
      WHERE staff.auth_user_id = auth.uid()
        AND staff.role IN ('owner'::user_role, 'admin'::user_role)
    )
  );

-- DELETE: solo owner/admin pueden eliminar reportes
CREATE POLICY salary_reports_delete_staff
  ON salary_reports FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM staff
      WHERE staff.auth_user_id = auth.uid()
        AND staff.role IN ('owner'::user_role, 'admin'::user_role)
    )
  );

-- ============================================================
-- 6. Indices para rendimiento
-- ============================================================

-- salary_payment_batches: busquedas por staff y branch
CREATE INDEX IF NOT EXISTS idx_spb_staff_id
  ON salary_payment_batches(staff_id);

CREATE INDEX IF NOT EXISTS idx_spb_branch_id
  ON salary_payment_batches(branch_id);

CREATE INDEX IF NOT EXISTS idx_spb_paid_at
  ON salary_payment_batches(paid_at DESC);

-- salary_reports: busquedas frecuentes
CREATE INDEX IF NOT EXISTS idx_sr_staff_id
  ON salary_reports(staff_id);

CREATE INDEX IF NOT EXISTS idx_sr_branch_id
  ON salary_reports(branch_id);

CREATE INDEX IF NOT EXISTS idx_sr_batch_id
  ON salary_reports(batch_id);

CREATE INDEX IF NOT EXISTS idx_sr_status
  ON salary_reports(status);

CREATE INDEX IF NOT EXISTS idx_sr_report_date
  ON salary_reports(report_date DESC);

-- Indice compuesto para prevenir duplicados de comision y queries frecuentes
CREATE UNIQUE INDEX IF NOT EXISTS idx_sr_staff_date_type_unique
  ON salary_reports(staff_id, report_date, type)
  WHERE type = 'commission';

-- ============================================================
-- 7. Trigger de updated_at para salary_reports
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_salary_reports_updated_at'
  ) THEN
    CREATE TRIGGER trg_salary_reports_updated_at
      BEFORE UPDATE ON salary_reports
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ============================================================
-- 8. Funcion: generate_commission_report
--    Genera un reporte de comision para un barbero en una fecha dada.
--    Suma commission_amount de todas las visitas completadas ese dia
--    y crea un salary_report de tipo 'commission'.
--    Retorna el id del reporte creado (o existente si ya habia uno).
-- ============================================================
CREATE OR REPLACE FUNCTION generate_commission_report(
  p_staff_id  UUID,
  p_branch_id UUID,
  p_date      DATE DEFAULT CURRENT_DATE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_commission NUMERIC(12,2);
  v_report_id UUID;
BEGIN
  -- Verificar que el staff existe y es barbero
  IF NOT EXISTS (
    SELECT 1 FROM staff
    WHERE id = p_staff_id
      AND role = 'barber'::user_role
  ) THEN
    RAISE EXCEPTION 'El staff_id % no existe o no es barbero', p_staff_id;
  END IF;

  -- Verificar que la sucursal existe
  IF NOT EXISTS (
    SELECT 1 FROM branches WHERE id = p_branch_id
  ) THEN
    RAISE EXCEPTION 'La branch_id % no existe', p_branch_id;
  END IF;

  -- Si ya existe un reporte de comision para este barbero y fecha, retornarlo
  SELECT id INTO v_report_id
  FROM salary_reports
  WHERE staff_id = p_staff_id
    AND report_date = p_date
    AND type = 'commission';

  IF v_report_id IS NOT NULL THEN
    RETURN v_report_id;
  END IF;

  -- Calcular total de comisiones del dia desde la tabla visits
  SELECT COALESCE(SUM(commission_amount), 0)
  INTO v_total_commission
  FROM visits
  WHERE barber_id = p_staff_id
    AND branch_id = p_branch_id
    AND completed_at::date = p_date;

  -- Solo crear reporte si hay comisiones > 0
  IF v_total_commission <= 0 THEN
    RETURN NULL;
  END IF;

  -- Insertar el reporte de comision
  INSERT INTO salary_reports (
    staff_id, branch_id, type, amount, report_date, notes
  ) VALUES (
    p_staff_id,
    p_branch_id,
    'commission',
    v_total_commission,
    p_date,
    'Comision auto-generada para ' || to_char(p_date, 'DD/MM/YYYY')
  )
  RETURNING id INTO v_report_id;

  RETURN v_report_id;
END;
$$;

COMMENT ON FUNCTION generate_commission_report IS 'Genera un reporte de comision diaria para un barbero sumando commission_amount de visits';

-- ============================================================
-- 9. Funcion: pay_salary_reports
--    Crea un lote de pago y marca los reportes seleccionados como pagados.
--    Recibe un array de report_ids, valida que sean del mismo staff,
--    calcula el total, crea el batch y actualiza los reportes.
-- ============================================================
CREATE OR REPLACE FUNCTION pay_salary_reports(
  p_report_ids UUID[],
  p_notes      TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_staff_id    UUID;
  v_branch_id   UUID;
  v_total       NUMERIC(12,2);
  v_batch_id    UUID;
  v_count       INT;
BEGIN
  -- Validar que hay reportes
  IF array_length(p_report_ids, 1) IS NULL OR array_length(p_report_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Debe proporcionar al menos un reporte para pagar';
  END IF;

  -- Verificar que todos los reportes existen, estan pendientes y son del mismo staff
  SELECT COUNT(DISTINCT sr.staff_id), MIN(sr.staff_id), MIN(sr.branch_id)
  INTO v_count, v_staff_id, v_branch_id
  FROM salary_reports sr
  WHERE sr.id = ANY(p_report_ids)
    AND sr.status = 'pending';

  -- Verificar que encontramos todos los reportes
  IF v_count = 0 THEN
    RAISE EXCEPTION 'No se encontraron reportes pendientes con los IDs proporcionados';
  END IF;

  IF v_count > 1 THEN
    RAISE EXCEPTION 'Todos los reportes deben pertenecer al mismo barbero';
  END IF;

  -- Verificar que la cantidad de reportes encontrados coincide con los solicitados
  SELECT COUNT(*) INTO v_count
  FROM salary_reports
  WHERE id = ANY(p_report_ids)
    AND status = 'pending';

  IF v_count != array_length(p_report_ids, 1) THEN
    RAISE EXCEPTION 'Algunos reportes no existen o ya fueron pagados';
  END IF;

  -- Calcular el total (puede ser negativo si hay muchos adelantos)
  SELECT COALESCE(SUM(amount), 0)
  INTO v_total
  FROM salary_reports
  WHERE id = ANY(p_report_ids);

  -- Crear el lote de pago
  INSERT INTO salary_payment_batches (staff_id, branch_id, total_amount, notes)
  VALUES (v_staff_id, v_branch_id, v_total, p_notes)
  RETURNING id INTO v_batch_id;

  -- Marcar todos los reportes como pagados y asociarlos al lote
  UPDATE salary_reports
  SET status = 'paid',
      batch_id = v_batch_id
  WHERE id = ANY(p_report_ids);

  RETURN v_batch_id;
END;
$$;

COMMENT ON FUNCTION pay_salary_reports IS 'Crea un lote de pago agrupando reportes pendientes y los marca como pagados';
