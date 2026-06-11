-- Migración 148: Auto-cierre de conversaciones a 24h (antes 12h)
--
-- Contexto / reporte (11-jun-2026): en el CRM aparecía el botón "Reabrir" en
-- conversaciones cuyo último mensaje era de hace ~12-20h, y se confundía con la
-- "ventana de 24h" de Meta. Son DOS relojes distintos:
--   - conversations.can_reply_until      -> ventana real de Meta (24h):
--       define texto libre vs. solo templates aprobados.
--   - conversations.auto_close_after_hours -> housekeeping interno del inbox
--       (estaba en 12h): el cron `auto_close_inactive_conversations()` marca la
--       conv como 'inactive' (lo que dispara el "Reabrir") tras N horas sin
--       NINGÚN mensaje (inbound u outbound, usa last_message_at).
--
-- Subimos el auto-cierre interno de 12h -> 24h para que el inbox no marque
-- "reabrir" hasta cumplirse un día completo de inactividad. NO se toca
-- can_reply_until (ventana Meta), que es independiente.

-- 1. Default para conversaciones nuevas: 24h
ALTER TABLE conversations
  ALTER COLUMN auto_close_after_hours SET DEFAULT 24;

-- 2. Conversaciones existentes que seguían en el default viejo (12) -> 24.
--    Filtramos por =12 para no pisar eventuales overrides custom (hoy no
--    existen, pero mantiene la migración segura e idempotente al re-correr).
UPDATE conversations
   SET auto_close_after_hours = 24
 WHERE auto_close_after_hours = 12;

-- 3. Doc de la columna
COMMENT ON COLUMN conversations.auto_close_after_hours IS
  'Horas de inactividad (sin ningún mensaje) antes de que el cron auto_close_inactive_conversations marque la conv como inactive y aparezca "Reabrir" en el CRM. Default 24h. Independiente de can_reply_until (ventana Meta de 24h para texto libre).';
