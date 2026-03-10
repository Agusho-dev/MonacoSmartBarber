-- ============================================
-- Sistema de faltas y llegadas tarde
-- ============================================

CREATE TYPE disciplinary_event_type AS ENUM ('absence', 'late');
CREATE TYPE consequence_type AS ENUM (
  'none',
  'presentismo_loss',
  'warning',
  'incentive_loss',
  'salary_deduction'
);

-- Reglas disciplinarias configurables por sucursal
CREATE TABLE disciplinary_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  event_type disciplinary_event_type NOT NULL,
  occurrence_number INTEGER NOT NULL,
  consequence consequence_type NOT NULL DEFAULT 'none',
  deduction_amount NUMERIC(12,2),
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_id, event_type, occurrence_number)
);

CREATE INDEX idx_disciplinary_rules_branch ON disciplinary_rules(branch_id);

CREATE TRIGGER trg_disciplinary_rules_updated_at BEFORE UPDATE ON disciplinary_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Eventos disciplinarios individuales por barbero
CREATE TABLE disciplinary_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  event_type disciplinary_event_type NOT NULL,
  event_date DATE NOT NULL DEFAULT CURRENT_DATE,
  occurrence_number INTEGER NOT NULL DEFAULT 1,
  consequence_applied consequence_type,
  deduction_amount NUMERIC(12,2),
  notes TEXT,
  created_by UUID REFERENCES staff(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_disciplinary_events_staff ON disciplinary_events(staff_id);
CREATE INDEX idx_disciplinary_events_date ON disciplinary_events(event_date);
CREATE INDEX idx_disciplinary_events_type ON disciplinary_events(staff_id, event_type);

-- RLS
ALTER TABLE disciplinary_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "disciplinary_rules_read_owner" ON disciplinary_rules FOR SELECT
  USING (EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid() AND role IN ('owner', 'admin')));
CREATE POLICY "disciplinary_rules_manage_owner" ON disciplinary_rules FOR ALL
  USING (EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid() AND role IN ('owner', 'admin')));

ALTER TABLE disciplinary_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "disciplinary_events_read_owner" ON disciplinary_events FOR SELECT
  USING (EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid() AND role IN ('owner', 'admin')));
CREATE POLICY "disciplinary_events_manage_owner" ON disciplinary_events FOR ALL
  USING (EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid() AND role IN ('owner', 'admin')));

-- Función: cuenta ocurrencias del período (mes actual o año, configurable)
-- Devuelve el número de ocurrencia actual para determinar qué consecuencia aplicar
CREATE OR REPLACE FUNCTION get_occurrence_count(
  p_staff_id UUID,
  p_event_type disciplinary_event_type,
  p_from_date DATE DEFAULT date_trunc('month', CURRENT_DATE)::DATE
)
RETURNS INTEGER AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)
    FROM disciplinary_events
    WHERE staff_id = p_staff_id
      AND event_type = p_event_type
      AND event_date >= p_from_date
  );
END;
$$ LANGUAGE plpgsql;

-- Reglas por defecto para Monaco (configuración inicial del negocio)
-- Estas son insertadas como referencia; el admin puede modificarlas desde el panel.
-- Se insertan con un branch_id placeholder que debe ser reemplazado luego en el seed.
-- Las reglas se documentan aquí para referencia:
-- Faltas: ocurrencia 4 → descuento salarial
-- Tardanzas: 1=none, 2=presentismo_loss, 3=warning, 4=incentive_loss+salary_deduction(50000)
