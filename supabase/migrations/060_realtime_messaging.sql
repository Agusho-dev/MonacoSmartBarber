-- Habilitar Realtime para mensajería
-- Las tablas messages y conversations no estaban en la publicación,
-- por lo que las suscripciones WebSocket del dashboard no recibían eventos.

ALTER PUBLICATION supabase_realtime ADD TABLE IF NOT EXISTS messages;
ALTER PUBLICATION supabase_realtime ADD TABLE IF NOT EXISTS conversations;
