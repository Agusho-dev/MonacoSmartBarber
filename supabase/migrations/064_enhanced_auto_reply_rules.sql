-- Migración 064: Mejorar auto_reply_rules con tipos de trigger y etiquetado
-- Soporta: keyword (existente), post_service (reemplaza Auto tab), days_after_visit (seguimiento)

-- Agregar columnas de trigger
ALTER TABLE auto_reply_rules
  ADD COLUMN IF NOT EXISTS trigger_type text NOT NULL DEFAULT 'keyword',
  ADD COLUMN IF NOT EXISTS trigger_config jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tag_client_id uuid REFERENCES conversation_tags(id) ON DELETE SET NULL;

-- trigger_type: 'keyword' | 'post_service' | 'days_after_visit'
-- trigger_config: { "delay_days": 7 } para days_after_visit, { "delay_minutes": 10 } para post_service
-- tag_client_id: tag a aplicar al cliente cuando la regla matchea

-- keywords ya no es obligatorio para trigger_type != 'keyword'
ALTER TABLE auto_reply_rules ALTER COLUMN keywords DROP NOT NULL;
ALTER TABLE auto_reply_rules ALTER COLUMN keywords SET DEFAULT '{}';

-- Índice para buscar reglas por trigger_type
CREATE INDEX IF NOT EXISTS idx_auto_reply_rules_trigger_type
  ON auto_reply_rules(organization_id, trigger_type, is_active);

-- Índice para buscar reglas activas por org (para el cron de days_after_visit)
CREATE INDEX IF NOT EXISTS idx_auto_reply_rules_active_org
  ON auto_reply_rules(organization_id, is_active) WHERE is_active = true;

COMMENT ON COLUMN auto_reply_rules.trigger_type IS 'keyword: por palabra clave en mensaje. post_service: cuando el cliente termina un servicio. days_after_visit: X días después de la última visita.';
COMMENT ON COLUMN auto_reply_rules.trigger_config IS 'Config específica del trigger. post_service: { delay_minutes }. days_after_visit: { delay_days }.';
COMMENT ON COLUMN auto_reply_rules.tag_client_id IS 'Tag a asignar automáticamente a la conversación cuando la regla matchea.';

-- Habilitar pg_cron y pg_net si no están habilitados (para el cron de process-scheduled-messages)
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
