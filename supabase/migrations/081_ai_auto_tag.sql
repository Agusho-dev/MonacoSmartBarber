-- Auto-etiquetado con IA para conversaciones
-- Debe ejecutarse después de 080_organization_ai_config.sql (tabla organization_ai_config).
-- Agrega descripción semántica a las etiquetas y configuración global de auto-tag

-- 1. Agregar campos a conversation_tags
ALTER TABLE conversation_tags
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS ai_auto_assign BOOLEAN DEFAULT false;

COMMENT ON COLUMN conversation_tags.description IS 'Descripción semántica para que la IA entienda cuándo aplicar esta etiqueta';
COMMENT ON COLUMN conversation_tags.ai_auto_assign IS 'Si esta etiqueta participa en el auto-etiquetado con IA';

-- 2. Agregar configuración de auto-tag a organization_ai_config
ALTER TABLE organization_ai_config
  ADD COLUMN IF NOT EXISTS auto_tag_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_tag_model TEXT DEFAULT 'gpt-4o-mini';

COMMENT ON COLUMN organization_ai_config.auto_tag_enabled IS 'Switch global para activar auto-etiquetado con IA';
COMMENT ON COLUMN organization_ai_config.auto_tag_model IS 'Modelo de IA a usar para auto-tag (por defecto el más económico)';
