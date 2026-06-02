-- 145: UNIQUE (broadcast_id, client_id) en broadcast_recipients.
--
-- Hallazgo (auditoría 02/jun/2026): sendBroadcast() podía insertar destinatarios
-- duplicados si se re-enviaba/condición de carrera. Ya agregamos un claim atómico
-- (draft→sending) en el código, pero este UNIQUE es defensa en profundidad y
-- habilita el upsert idempotente `onConflict: 'broadcast_id,client_id'`.
-- Tabla vacía al aplicar (0 filas) → sin riesgo de violación por datos previos.

ALTER TABLE public.broadcast_recipients
  DROP CONSTRAINT IF EXISTS broadcast_recipients_broadcast_client_uniq;

ALTER TABLE public.broadcast_recipients
  ADD CONSTRAINT broadcast_recipients_broadcast_client_uniq UNIQUE (broadcast_id, client_id);
