-- ============================================================
-- 030: Soporte de autenticación para app móvil de clientes
-- Agrega: pin_hash en clients, tabla client_device_tokens con RLS
-- ============================================================

-- PIN hash para clientes (fallback de autenticación)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS pin_hash TEXT;

-- ============================================================
-- Tabla: client_device_tokens
-- Almacena tokens de dispositivo para notificaciones y
-- vinculación de sesión por dispositivo.
-- ============================================================
CREATE TABLE IF NOT EXISTS client_device_tokens (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  token       TEXT        NOT NULL,
  platform    TEXT        NOT NULL CHECK (platform IN ('ios', 'android')),
  device_id   TEXT        NOT NULL,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_client  ON client_device_tokens(client_id);
CREATE INDEX IF NOT EXISTS idx_device_tokens_active  ON client_device_tokens(is_active) WHERE is_active = true;

CREATE TRIGGER trg_client_device_tokens_updated_at
  BEFORE UPDATE ON client_device_tokens
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE client_device_tokens ENABLE ROW LEVEL SECURITY;

-- Cliente gestiona sus propios tokens
CREATE POLICY cdt_client_own ON client_device_tokens
  FOR ALL
  USING (
    client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid())
  )
  WITH CHECK (
    client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid())
  );

-- Staff puede leer todos los tokens (admin/owner para gestión)
CREATE POLICY cdt_staff_read ON client_device_tokens
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid()));
