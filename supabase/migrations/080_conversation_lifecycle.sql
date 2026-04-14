-- Migración 080: Ciclo de vida de conversaciones
-- Añade estados 'inactive' (12h sin actividad) y trackeo de último inbound/outbound.
-- Meta window (can_reply_until) ya existe; acá solo manejamos la lógica interna de UI.

-- ═══════════════════════════════════════════════════════════════════
-- 1. Columnas nuevas en conversations
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS last_inbound_at         timestamptz,
  ADD COLUMN IF NOT EXISTS last_outbound_at        timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at               timestamptz,
  ADD COLUMN IF NOT EXISTS reopened_at             timestamptz,
  ADD COLUMN IF NOT EXISTS auto_close_after_hours  int NOT NULL DEFAULT 12;

COMMENT ON COLUMN conversations.last_inbound_at     IS 'Último mensaje entrante del cliente.';
COMMENT ON COLUMN conversations.last_outbound_at    IS 'Último mensaje saliente de la barbería.';
COMMENT ON COLUMN conversations.closed_at           IS 'Cuándo se marcó inactive/closed por última vez.';
COMMENT ON COLUMN conversations.reopened_at         IS 'Cuándo un inbound reabrió la conversación.';
COMMENT ON COLUMN conversations.auto_close_after_hours IS 'Horas de inactividad antes de marcar la conv como inactive (default 12).';

-- status posibles: 'open' | 'inactive' | 'closed'
-- 'closed' queda reservado para archivo manual; el cron usa 'inactive'.

-- ═══════════════════════════════════════════════════════════════════
-- 2. Backfill de last_inbound_at / last_outbound_at desde messages
-- ═══════════════════════════════════════════════════════════════════
UPDATE conversations c SET
  last_inbound_at  = sub.last_in,
  last_outbound_at = sub.last_out
FROM (
  SELECT conversation_id,
         MAX(CASE WHEN direction='inbound'  THEN created_at END) AS last_in,
         MAX(CASE WHEN direction='outbound' THEN created_at END) AS last_out
  FROM messages
  GROUP BY conversation_id
) sub
WHERE sub.conversation_id = c.id;

-- ═══════════════════════════════════════════════════════════════════
-- 3. Trigger: al insertar un message, actualizar timestamps y reabrir
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION conversation_on_message_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_old_status text;
  v_now        timestamptz := now();
BEGIN
  SELECT status INTO v_old_status FROM conversations WHERE id = NEW.conversation_id FOR UPDATE;

  IF NEW.direction = 'inbound' THEN
    UPDATE conversations
       SET last_inbound_at = v_now,
           last_message_at = v_now,
           status          = 'open',
           reopened_at     = CASE
                               WHEN v_old_status IN ('inactive','closed') THEN v_now
                               ELSE reopened_at
                             END,
           updated_at      = v_now
     WHERE id = NEW.conversation_id;
  ELSIF NEW.direction = 'outbound' THEN
    UPDATE conversations
       SET last_outbound_at = v_now,
           last_message_at  = v_now,
           updated_at       = v_now
     WHERE id = NEW.conversation_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conversation_on_message_insert ON messages;
CREATE TRIGGER trg_conversation_on_message_insert
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION conversation_on_message_insert();

-- ═══════════════════════════════════════════════════════════════════
-- 4. Función para auto-cerrar conversaciones inactivas
--    Se invoca desde el cron (process-scheduled-messages u otro).
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION auto_close_inactive_conversations()
RETURNS TABLE(closed_count int)
LANGUAGE plpgsql
AS $$
DECLARE
  v_count int;
BEGIN
  WITH upd AS (
    UPDATE conversations
       SET status     = 'inactive',
           closed_at  = now(),
           updated_at = now()
     WHERE status = 'open'
       AND last_message_at IS NOT NULL
       AND last_message_at < now() - (auto_close_after_hours || ' hours')::interval
    RETURNING id
  )
  SELECT count(*)::int INTO v_count FROM upd;

  RETURN QUERY SELECT v_count;
END;
$$;

COMMENT ON FUNCTION auto_close_inactive_conversations IS
  'Marca como inactive las conversaciones open sin actividad por más de auto_close_after_hours (default 12h). Llamar desde cron.';

-- ═══════════════════════════════════════════════════════════════════
-- 5. Índice para el cron de auto-close
-- ═══════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_conversations_auto_close
  ON conversations(last_message_at)
  WHERE status = 'open';
