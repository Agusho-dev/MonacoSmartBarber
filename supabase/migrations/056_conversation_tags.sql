-- Etiquetas de conversaciones para CRM
CREATE TABLE IF NOT EXISTS conversation_tags (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  color           TEXT NOT NULL DEFAULT '#22C55E',
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(organization_id, name)
);

-- Asignación de etiquetas a conversaciones
CREATE TABLE IF NOT EXISTS conversation_tag_assignments (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  tag_id          UUID NOT NULL REFERENCES conversation_tags(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (conversation_id, tag_id)
);

ALTER TABLE conversation_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_tag_assignments ENABLE ROW LEVEL SECURITY;
