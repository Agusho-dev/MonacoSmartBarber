-- Soporte para envío de templates en mensajes programados
-- review_template_name: nombre del template de Meta a usar post-servicio
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS review_template_name text DEFAULT NULL;

-- template_name/language: para que el edge function envíe templates directamente
ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS template_name text DEFAULT NULL;
ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS template_language text DEFAULT 'es_AR';
