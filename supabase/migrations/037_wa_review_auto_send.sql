-- =============================================================================
-- 037_wa_review_auto_send.sql
-- Agrega configuración de mensajes automáticos de reseña por WhatsApp
-- y columna phone a scheduled_messages para envío directo sin canal Meta
-- =============================================================================

-- 1. Agregar columnas de configuración WA a app_settings
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS review_auto_send boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS review_delay_minutes integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS review_message_template text DEFAULT '¡Hola {nombre}! Gracias por visitarnos en Monaco Smart Barber 💈. Nos encantaría saber qué te pareció tu experiencia. Dejanos tu opinión acá: {link_resena} ⭐',
  ADD COLUMN IF NOT EXISTS wa_api_url text DEFAULT NULL;

-- 2. Hacer channel_id nullable en scheduled_messages
--    (necesario para mensajes enviados directamente vía WA Microservice sin canal Meta)
ALTER TABLE scheduled_messages
  ALTER COLUMN channel_id DROP NOT NULL;

-- 3. Agregar columna phone para envío directo por WA Microservice
ALTER TABLE scheduled_messages
  ADD COLUMN IF NOT EXISTS phone text DEFAULT NULL;

-- Índice para procesar mensajes pendientes eficientemente
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_pending
  ON scheduled_messages (scheduled_for)
  WHERE status = 'pending';

-- 4. Habilitar Realtime en scheduled_messages si no está habilitado
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename = 'scheduled_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE scheduled_messages;
  END IF;
END$$;
