-- =============================================================================
-- Migración 085: Sistema de turnos (appointments)
-- Agrega tablas para gestión de turnos/citas: configuración por organización,
-- staff habilitado para turnos, y la tabla principal de turnos.
-- Modifica queue_entries para distinguir fila walk-in de fila de turnos.
-- Modifica services para agregar booking_mode.
-- Actualiza assign_next_client para excluir entries de turnos del FIFO walk-in.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tabla appointment_settings (configuración por organización)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointment_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  is_enabled BOOLEAN NOT NULL DEFAULT false,

  -- Horario de turnos (subconjunto del horario de negocio)
  appointment_hours_open TIME NOT NULL DEFAULT '09:00',
  appointment_hours_close TIME NOT NULL DEFAULT '20:00',
  appointment_days INTEGER[] NOT NULL DEFAULT '{1,2,3,4,5,6}',

  -- Intervalos y configuración de slots
  slot_interval_minutes INTEGER NOT NULL DEFAULT 30,
  max_advance_days INTEGER NOT NULL DEFAULT 30,

  -- Tolerancia y cancelación
  no_show_tolerance_minutes INTEGER NOT NULL DEFAULT 15,
  cancellation_min_hours INTEGER NOT NULL DEFAULT 2,

  -- Mensajería automática
  confirmation_template_name TEXT,
  reminder_template_name TEXT,
  reminder_hours_before INTEGER NOT NULL DEFAULT 24,

  -- Flag de pago (solo indicativo, sin gateway)
  payment_mode TEXT NOT NULL DEFAULT 'postpago' CHECK (payment_mode IN ('prepago', 'postpago')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id)
);

COMMENT ON TABLE appointment_settings IS 'Configuración del sistema de turnos por organización';
COMMENT ON COLUMN appointment_settings.appointment_days IS 'Días habilitados para turnos (0=Domingo, 6=Sábado)';
COMMENT ON COLUMN appointment_settings.slot_interval_minutes IS 'Intervalo fijo entre slots de turnos (en minutos)';
COMMENT ON COLUMN appointment_settings.cancellation_min_hours IS 'Horas mínimas de antelación para que el cliente cancele';
COMMENT ON COLUMN appointment_settings.payment_mode IS 'Flag indicativo: prepago o postpago';

-- ---------------------------------------------------------------------------
-- 2. Tabla appointment_staff (staff habilitado para turnos)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointment_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (staff_id)
);

COMMENT ON TABLE appointment_staff IS 'Staff habilitado para recibir turnos';

-- ---------------------------------------------------------------------------
-- 3. Tabla appointments (turnos)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  barber_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  service_id UUID REFERENCES services(id) ON DELETE SET NULL,

  -- Scheduling
  appointment_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  duration_minutes INTEGER NOT NULL,

  -- Estado y origen
  status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show')),
  source TEXT NOT NULL DEFAULT 'public'
    CHECK (source IN ('public', 'manual')),

  -- Token para gestión por parte del cliente (cancelar/ver turno)
  cancellation_token TEXT UNIQUE,

  -- Flag de pago (indicativo)
  payment_flag TEXT CHECK (payment_flag IS NULL OR payment_flag IN ('prepago', 'postpago')),

  -- Integración con fila
  queue_entry_id UUID REFERENCES queue_entries(id) ON DELETE SET NULL,

  -- Staff que creó el turno (para turnos manuales desde mensajería)
  created_by_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,

  -- Metadata de cancelación
  cancelled_at TIMESTAMPTZ,
  cancelled_by TEXT CHECK (cancelled_by IS NULL OR cancelled_by IN ('client', 'staff', 'system')),

  -- Metadata de no-show
  no_show_marked_at TIMESTAMPTZ,
  no_show_marked_by UUID REFERENCES staff(id) ON DELETE SET NULL,

  -- Notas
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE appointments IS 'Turnos/citas agendadas por clientes o staff';
COMMENT ON COLUMN appointments.source IS 'public = autogestionado por cliente, manual = creado por staff desde mensajería';
COMMENT ON COLUMN appointments.cancellation_token IS 'Token único para que el cliente gestione su turno desde un link público';
COMMENT ON COLUMN appointments.duration_minutes IS 'Duración definida al momento de agendar (puede diferir del duration_minutes del servicio)';

-- Constraint: un barbero no puede tener dos turnos activos en el mismo horario
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_no_overlap
  ON appointments (barber_id, appointment_date, start_time)
  WHERE status NOT IN ('cancelled', 'no_show') AND barber_id IS NOT NULL;

-- Índices para consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_appointments_org ON appointments(organization_id);
CREATE INDEX IF NOT EXISTS idx_appointments_branch_date ON appointments(branch_id, appointment_date);
CREATE INDEX IF NOT EXISTS idx_appointments_barber_date ON appointments(barber_id, appointment_date);
CREATE INDEX IF NOT EXISTS idx_appointments_client ON appointments(client_id);
CREATE INDEX IF NOT EXISTS idx_appointments_active_status ON appointments(status)
  WHERE status NOT IN ('cancelled', 'no_show', 'completed');
CREATE INDEX IF NOT EXISTS idx_appointments_queue_entry ON appointments(queue_entry_id)
  WHERE queue_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_appointments_token ON appointments(cancellation_token)
  WHERE cancellation_token IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Triggers de updated_at
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_appointment_settings_updated_at
  BEFORE UPDATE ON appointment_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_appointments_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Alteraciones a queue_entries
-- ---------------------------------------------------------------------------
ALTER TABLE queue_entries
  ADD COLUMN IF NOT EXISTS is_appointment BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE queue_entries
  ADD COLUMN IF NOT EXISTS appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL;

COMMENT ON COLUMN queue_entries.is_appointment IS 'true = entry creada desde un turno, false = walk-in';
COMMENT ON COLUMN queue_entries.appointment_id IS 'Referencia al turno que originó esta entry';

-- ---------------------------------------------------------------------------
-- 6. Agregar booking_mode a services
-- ---------------------------------------------------------------------------
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS booking_mode TEXT NOT NULL DEFAULT 'self_service'
    CHECK (booking_mode IN ('self_service', 'manual_only', 'both'));

COMMENT ON COLUMN services.booking_mode IS 'self_service = agendable por cliente, manual_only = solo por staff, both = ambos';

-- ---------------------------------------------------------------------------
-- 7. Actualizar assign_next_client para excluir entries de turnos
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS assign_next_client(UUID, UUID, UUID);

CREATE OR REPLACE FUNCTION assign_next_client(
  p_barber_id UUID,
  p_branch_id UUID,
  p_preferred_entry_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry_id UUID;
  v_today DATE;
BEGIN
  v_today := (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE;

  -- Si hay preferencia, intentar tomar ese cliente específico
  IF p_preferred_entry_id IS NOT NULL THEN
    SELECT id INTO v_entry_id
    FROM queue_entries
    WHERE id = p_preferred_entry_id
      AND branch_id = p_branch_id
      AND status = 'waiting'
      AND is_break = false
      AND is_appointment = false
      AND (barber_id = p_barber_id OR barber_id IS NULL)
      AND (checked_in_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE = v_today
    FOR UPDATE SKIP LOCKED;

    IF v_entry_id IS NOT NULL THEN
      UPDATE queue_entries
      SET barber_id = p_barber_id,
          is_dynamic = false
      WHERE id = v_entry_id;

      RETURN v_entry_id;
    END IF;
  END IF;

  -- Fallback: FIFO global, excluyendo entries de turnos
  SELECT id INTO v_entry_id
  FROM queue_entries
  WHERE branch_id = p_branch_id
    AND status = 'waiting'
    AND is_break = false
    AND is_appointment = false
    AND (barber_id = p_barber_id OR barber_id IS NULL)
    AND (checked_in_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE = v_today
  ORDER BY priority_order ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_entry_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE queue_entries
  SET barber_id = p_barber_id,
      is_dynamic = false
  WHERE id = v_entry_id;

  RETURN v_entry_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. RLS Policies
-- ---------------------------------------------------------------------------
ALTER TABLE appointment_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

-- appointment_settings: lectura/escritura por org
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'appt_settings_org' AND tablename = 'appointment_settings') THEN
    CREATE POLICY "appt_settings_org" ON appointment_settings FOR ALL
      USING (organization_id = get_user_org_id());
  END IF;
END $$;

-- appointment_staff: lectura/escritura por org
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'appt_staff_org' AND tablename = 'appointment_staff') THEN
    CREATE POLICY "appt_staff_org" ON appointment_staff FOR ALL
      USING (organization_id = get_user_org_id());
  END IF;
END $$;

-- appointments: lectura/escritura por org
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'appointments_org' AND tablename = 'appointments') THEN
    CREATE POLICY "appointments_org" ON appointments FOR ALL
      USING (organization_id = get_user_org_id());
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 9. Auto-crear etiqueta "Ausente" para organizaciones existentes
-- ---------------------------------------------------------------------------
INSERT INTO conversation_tags (organization_id, name, color, description)
SELECT o.id, 'Ausente', '#ef4444', 'Cliente no se presentó a su turno'
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM conversation_tags ct
  WHERE ct.organization_id = o.id AND ct.name = 'Ausente'
);

-- ---------------------------------------------------------------------------
-- 10. Habilitar Realtime para appointments
-- ---------------------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE appointments;
