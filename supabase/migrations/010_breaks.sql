-- ============================================
-- Módulo de descansos
-- ============================================

-- Extender enum staff_status con 'blocked'
ALTER TYPE staff_status ADD VALUE IF NOT EXISTS 'blocked';

-- Configuraciones de descanso por sucursal
CREATE TABLE break_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  tolerance_minutes INTEGER NOT NULL DEFAULT 5,
  scheduled_time TIME,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_break_configs_branch ON break_configs(branch_id);

-- Columnas en staff para gestionar descanso activo
ALTER TABLE staff
  ADD COLUMN break_config_id UUID REFERENCES break_configs(id) ON DELETE SET NULL,
  ADD COLUMN break_started_at TIMESTAMPTZ,
  ADD COLUMN break_ends_at TIMESTAMPTZ;

-- Trigger auto updated_at
CREATE TRIGGER trg_break_configs_updated_at BEFORE UPDATE ON break_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE break_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "break_configs_read_all" ON break_configs FOR SELECT USING (true);
CREATE POLICY "break_configs_manage_owner" ON break_configs FOR ALL
  USING (EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid() AND role IN ('owner', 'admin')));

-- Función para verificar y bloquear barberos que excedieron su descanso
CREATE OR REPLACE FUNCTION check_and_block_overdue_breaks()
RETURNS void AS $$
BEGIN
  UPDATE staff
  SET status = 'blocked'
  WHERE status = 'paused'
    AND break_ends_at IS NOT NULL
    AND now() > break_ends_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Función para iniciar descanso de un barbero
CREATE OR REPLACE FUNCTION start_barber_break(p_staff_id UUID, p_break_config_id UUID)
RETURNS void AS $$
DECLARE
  v_duration INTEGER;
  v_tolerance INTEGER;
BEGIN
  SELECT duration_minutes, tolerance_minutes
  INTO v_duration, v_tolerance
  FROM break_configs
  WHERE id = p_break_config_id;

  UPDATE staff
  SET
    status = 'paused',
    break_config_id = p_break_config_id,
    break_started_at = now(),
    break_ends_at = now() + (v_duration + v_tolerance) * INTERVAL '1 minute'
  WHERE id = p_staff_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Función para retorno del descanso
CREATE OR REPLACE FUNCTION end_barber_break(p_staff_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE staff
  SET
    status = 'available',
    break_config_id = NULL,
    break_started_at = NULL,
    break_ends_at = NULL
  WHERE id = p_staff_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Función para desbloquear manualmente un barbero bloqueado
CREATE OR REPLACE FUNCTION unblock_barber(p_staff_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE staff
  SET
    status = 'available',
    break_config_id = NULL,
    break_started_at = NULL,
    break_ends_at = NULL
  WHERE id = p_staff_id AND status = 'blocked';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
