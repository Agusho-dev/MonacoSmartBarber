-- =============================================================================
-- Migración 107: Lista de espera de turnos (appointment_waitlist)
--
-- Permite que clientes se anoten cuando no hay slot disponible para su
-- preferencia (fecha/servicio/barbero). Cuando un turno se cancela, el sistema
-- notifica al primer candidato de la cola vía template WA.
--
-- Diferencial vs AgendaPro — ellos no lo tienen; Booksy sí y es muy valorado.
-- =============================================================================

CREATE TABLE IF NOT EXISTS appointment_waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  service_id UUID REFERENCES services(id) ON DELETE SET NULL,
  barber_id UUID REFERENCES staff(id) ON DELETE SET NULL,

  -- Preferencia de fecha (puede ser un día específico o rango)
  preferred_date_from DATE NOT NULL,
  preferred_date_to DATE NOT NULL,

  -- Preferencia de franja horaria (TIME, opcional)
  preferred_time_from TIME,
  preferred_time_to TIME,

  -- Estado
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'notified', 'booked', 'expired', 'cancelled')),

  -- Token para gestión pública por parte del cliente
  access_token TEXT UNIQUE,

  -- Tracking de notificaciones
  notified_at TIMESTAMPTZ,
  notification_expires_at TIMESTAMPTZ,
  notification_count INTEGER NOT NULL DEFAULT 0,

  -- Si terminó en booking, referencia al turno creado
  booked_appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,

  -- Origen
  source TEXT NOT NULL DEFAULT 'public'
    CHECK (source IN ('public', 'manual')),

  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT appointment_waitlist_valid_date_range CHECK (preferred_date_to >= preferred_date_from),
  CONSTRAINT appointment_waitlist_valid_time_range CHECK (
    preferred_time_from IS NULL OR preferred_time_to IS NULL OR preferred_time_to >= preferred_time_from
  )
);

COMMENT ON TABLE appointment_waitlist IS 'Clientes en espera de slot. Al cancelarse un turno que matchea preferencias, se notifica al primero en la cola.';
COMMENT ON COLUMN appointment_waitlist.notification_expires_at IS 'Si el cliente no responde/reserva en este plazo, se notifica al siguiente de la cola.';
COMMENT ON COLUMN appointment_waitlist.access_token IS 'Token público para que el cliente active su reserva desde el link del mensaje de WhatsApp.';

-- Índices
CREATE INDEX IF NOT EXISTS idx_waitlist_org ON appointment_waitlist(organization_id);
CREATE INDEX IF NOT EXISTS idx_waitlist_branch_status ON appointment_waitlist(branch_id, status);
CREATE INDEX IF NOT EXISTS idx_waitlist_client ON appointment_waitlist(client_id);
CREATE INDEX IF NOT EXISTS idx_waitlist_waiting_fifo
  ON appointment_waitlist(branch_id, preferred_date_from, created_at)
  WHERE status = 'waiting';
CREATE INDEX IF NOT EXISTS idx_waitlist_token
  ON appointment_waitlist(access_token)
  WHERE access_token IS NOT NULL;

-- Trigger updated_at
DROP TRIGGER IF EXISTS trg_appointment_waitlist_updated_at ON appointment_waitlist;
CREATE TRIGGER trg_appointment_waitlist_updated_at
  BEFORE UPDATE ON appointment_waitlist
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE appointment_waitlist ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'appointment_waitlist_org' AND tablename = 'appointment_waitlist') THEN
    CREATE POLICY "appointment_waitlist_org" ON appointment_waitlist FOR ALL
      USING (organization_id = get_user_org_id())
      WITH CHECK (organization_id = get_user_org_id());
  END IF;
END $$;

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE appointment_waitlist;
