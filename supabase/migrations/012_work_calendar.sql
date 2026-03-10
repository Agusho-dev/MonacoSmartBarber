-- ============================================
-- Calendario laboral de barberos
-- ============================================

-- Horario base por día de semana (0=domingo, 1=lunes, ..., 6=sábado)
CREATE TABLE staff_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (staff_id, day_of_week)
);

CREATE INDEX idx_staff_schedules_staff ON staff_schedules(staff_id);
CREATE INDEX idx_staff_schedules_day ON staff_schedules(day_of_week);

-- Excepciones puntuales (feriados, ausencias programadas)
CREATE TABLE staff_schedule_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  exception_date DATE NOT NULL,
  is_absent BOOLEAN NOT NULL DEFAULT true,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (staff_id, exception_date)
);

CREATE INDEX idx_schedule_exceptions_staff ON staff_schedule_exceptions(staff_id);
CREATE INDEX idx_schedule_exceptions_date ON staff_schedule_exceptions(exception_date);

CREATE TRIGGER trg_staff_schedules_updated_at BEFORE UPDATE ON staff_schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_schedule_exceptions_updated_at BEFORE UPDATE ON staff_schedule_exceptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE staff_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_schedules_read_all" ON staff_schedules FOR SELECT USING (true);
CREATE POLICY "staff_schedules_manage_owner" ON staff_schedules FOR ALL
  USING (EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid() AND role IN ('owner', 'admin')));

ALTER TABLE staff_schedule_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "schedule_exceptions_read_all" ON staff_schedule_exceptions FOR SELECT USING (true);
CREATE POLICY "schedule_exceptions_manage_owner" ON staff_schedule_exceptions FOR ALL
  USING (EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid() AND role IN ('owner', 'admin')));

-- Función: devuelve barberos disponibles hoy según calendario
CREATE OR REPLACE FUNCTION get_available_barbers_today(p_branch_id UUID)
RETURNS TABLE(staff_id UUID) AS $$
DECLARE
  v_today_dow SMALLINT;
  v_today DATE;
BEGIN
  v_today_dow := EXTRACT(DOW FROM CURRENT_DATE)::SMALLINT;
  v_today := CURRENT_DATE;

  RETURN QUERY
  SELECT s.id
  FROM staff s
  WHERE s.branch_id = p_branch_id
    AND s.role = 'barber'
    AND s.is_active = true
    AND EXISTS (
      SELECT 1 FROM staff_schedules ss
      WHERE ss.staff_id = s.id
        AND ss.day_of_week = v_today_dow
        AND ss.is_active = true
    )
    AND NOT EXISTS (
      SELECT 1 FROM staff_schedule_exceptions sse
      WHERE sse.staff_id = s.id
        AND sse.exception_date = v_today
        AND sse.is_absent = true
    );
END;
$$ LANGUAGE plpgsql;
