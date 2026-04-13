-- Configuración de proveedores de IA por organización
-- Permite que cada org tenga sus propias API keys de OpenAI/Anthropic

CREATE TABLE IF NOT EXISTS organization_ai_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- OpenAI
  openai_api_key TEXT,
  -- Anthropic
  anthropic_api_key TEXT,
  -- Defaults
  default_model TEXT DEFAULT 'gpt-4o-mini',
  default_system_prompt TEXT DEFAULT '',
  default_temperature NUMERIC(3,2) DEFAULT 0.7,
  default_max_tokens INTEGER DEFAULT 500,
  -- Estado
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(organization_id)
);

-- RLS: solo el org owner/admin vía service role
ALTER TABLE organization_ai_config ENABLE ROW LEVEL SECURITY;

-- Política para lectura/escritura vía service role (el dashboard usa createAdminClient)
CREATE POLICY "service_role_full_access" ON organization_ai_config
  FOR ALL
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE organization_ai_config IS 'Configuración de IA por organización — API keys de OpenAI y Anthropic';
