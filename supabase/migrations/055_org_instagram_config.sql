-- Configuración de Instagram Business API por organización
CREATE TABLE IF NOT EXISTS organization_instagram_config (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  instagram_page_id            TEXT,                          -- Facebook Page ID conectada a la cuenta IG
  instagram_page_access_token  TEXT,                          -- Page Access Token con instagram_manage_messages
  instagram_account_id         TEXT,                          -- Instagram Business Account ID (referencia)
  verify_token                 TEXT NOT NULL DEFAULT encode(gen_random_bytes(20), 'hex'),
  is_active                    BOOLEAN DEFAULT false,
  created_at                   TIMESTAMPTZ DEFAULT now(),
  updated_at                   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(organization_id)
);

-- RLS: solo service role accede (dashboard usa createAdminClient)
ALTER TABLE organization_instagram_config ENABLE ROW LEVEL SECURITY;
