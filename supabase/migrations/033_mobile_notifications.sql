-- ============================================================
-- 033: Bandeja de notificaciones in-app para clientes
-- Crea: client_notifications con RLS, Realtime y trigger
--       automático al crear review_requests
-- ============================================================

CREATE TABLE IF NOT EXISTS client_notifications (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type               TEXT        NOT NULL
                       CHECK (type IN ('review_request', 'reward', 'promo', 'alert')),
  title              TEXT        NOT NULL,
  body               TEXT        NOT NULL,
  data               JSONB       NOT NULL DEFAULT '{}',
  is_read            BOOLEAN     NOT NULL DEFAULT false,
  review_request_id  UUID        REFERENCES review_requests(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índice para consultas eficientes (no leídas del cliente, más recientes primero)
CREATE INDEX IF NOT EXISTS idx_cn_client_unread
  ON client_notifications(client_id, is_read, created_at DESC);

ALTER TABLE client_notifications ENABLE ROW LEVEL SECURITY;

-- Cliente puede leer y actualizar sus propias notificaciones
CREATE POLICY cn_client_select ON client_notifications
  FOR SELECT
  USING (client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid()));

CREATE POLICY cn_client_update ON client_notifications
  FOR UPDATE
  USING (client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid()))
  WITH CHECK (client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid()));

-- Staff puede insertar notificaciones (para alertas manuales desde dashboard)
CREATE POLICY cn_staff_insert ON client_notifications
  FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid()));

-- Sistema (SECURITY DEFINER functions) puede insertar sin restricción de rol
-- (gestionado por el trigger abajo)

-- Agregar a Realtime para bandeja in-app en tiempo real
ALTER PUBLICATION supabase_realtime ADD TABLE client_notifications;

-- ============================================================
-- Trigger: al crear review_request → crear notificación para cliente
-- ============================================================
CREATE OR REPLACE FUNCTION notify_client_review_request()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO client_notifications (
    client_id,
    type,
    title,
    body,
    review_request_id,
    data
  ) VALUES (
    NEW.client_id,
    'review_request',
    '¿Cómo fue tu visita?',
    'Contanos cómo te atendimos hoy en Monaco. Tu opinión nos ayuda a mejorar.',
    NEW.id,
    jsonb_build_object(
      'review_request_id', NEW.id,
      'token',             NEW.token,
      'branch_id',         NEW.branch_id,
      'barber_id',         NEW.barber_id
    )
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_review_request_notify
  AFTER INSERT ON review_requests
  FOR EACH ROW
  EXECUTE FUNCTION notify_client_review_request();
