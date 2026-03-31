-- =============================================================================
-- Migración 053: Configuración WhatsApp Meta Cloud API por organización
-- Reemplaza el microservicio Baileys por la API oficial de Meta.
-- =============================================================================

CREATE TABLE IF NOT EXISTS organization_whatsapp_config (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  whatsapp_access_token   TEXT,
  whatsapp_phone_id       TEXT,
  whatsapp_business_id    TEXT,
  -- verify_token: token que se configura en Meta Developer Console para validar el webhook
  verify_token            TEXT        NOT NULL DEFAULT encode(gen_random_bytes(20), 'hex'),
  is_active               BOOLEAN     DEFAULT false,
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now(),
  UNIQUE(organization_id)
);

ALTER TABLE organization_whatsapp_config ENABLE ROW LEVEL SECURITY;

-- Solo staff autenticado de la organización puede ver y gestionar la config
CREATE POLICY "wa_config_by_org" ON organization_whatsapp_config
  FOR ALL
  USING (organization_id = get_user_org_id())
  WITH CHECK (organization_id = get_user_org_id());

-- Trigger para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_org_whatsapp_config_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_org_whatsapp_config_updated_at
  BEFORE UPDATE ON organization_whatsapp_config
  FOR EACH ROW EXECUTE FUNCTION update_org_whatsapp_config_updated_at();
