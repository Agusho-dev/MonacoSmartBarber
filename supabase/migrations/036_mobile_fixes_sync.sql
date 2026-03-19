-- =============================================================================
-- 036_mobile_fixes_sync.sql
-- Sincroniza el schema de la base de datos con los requerimientos de la app móvil
-- =============================================================================

-- 1. Agregar device_id a client_device_tokens (requerido por Flutter push_service)
ALTER TABLE client_device_tokens
  ADD COLUMN IF NOT EXISTS device_id TEXT;

-- Agregar constraint UNIQUE para upsert por (client_id, device_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'client_device_tokens_client_device_unique'
  ) THEN
    ALTER TABLE client_device_tokens
      ADD CONSTRAINT client_device_tokens_client_device_unique
      UNIQUE (client_id, device_id);
  END IF;
END$$;

-- 2. Agregar image_url a reward_catalog (para mostrar imágenes en la app)
ALTER TABLE reward_catalog
  ADD COLUMN IF NOT EXISTS image_url TEXT;

-- 3. Crear tabla client_notifications (bandeja de notificaciones in-app)
CREATE TABLE IF NOT EXISTS client_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('review_request', 'reward', 'promo', 'alert')),
  title TEXT NOT NULL,
  body TEXT,
  data JSONB DEFAULT '{}',
  is_read BOOLEAN NOT NULL DEFAULT false,
  review_request_id UUID REFERENCES review_requests(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índice para consultas eficientes de notificaciones no leídas
CREATE INDEX IF NOT EXISTS idx_client_notifications_unread
  ON client_notifications (client_id, is_read, created_at DESC);

-- Habilitar RLS
ALTER TABLE client_notifications ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para client_notifications
DO $$
BEGIN
  -- Cliente lee sus propias notificaciones
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'cn_client_select' AND tablename = 'client_notifications') THEN
    CREATE POLICY cn_client_select ON client_notifications
      FOR SELECT USING (
        client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid())
      );
  END IF;

  -- Cliente puede marcar como leídas sus notificaciones
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'cn_client_update' AND tablename = 'client_notifications') THEN
    CREATE POLICY cn_client_update ON client_notifications
      FOR UPDATE USING (
        client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid())
      ) WITH CHECK (
        client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid())
      );
  END IF;

  -- Staff puede insertar notificaciones
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'cn_staff_insert' AND tablename = 'client_notifications') THEN
    CREATE POLICY cn_staff_insert ON client_notifications
      FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid())
      );
  END IF;
END$$;

-- Habilitar Realtime en client_notifications
ALTER PUBLICATION supabase_realtime ADD TABLE client_notifications;

-- 4. Trigger: crear notificación automática al insertar review_request
CREATE OR REPLACE FUNCTION notify_client_review_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_branch_name TEXT;
BEGIN
  SELECT name INTO v_branch_name FROM branches WHERE id = NEW.branch_id;

  INSERT INTO client_notifications (client_id, type, title, body, data, review_request_id)
  VALUES (
    NEW.client_id,
    'review_request',
    '¿Cómo fue tu visita?',
    'Contanos tu experiencia en ' || COALESCE(v_branch_name, 'Monaco'),
    jsonb_build_object('token', NEW.token, 'branch_id', NEW.branch_id),
    NEW.id
  );

  RETURN NEW;
END;
$$;

-- Crear trigger si no existe
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_notify_review_request'
  ) THEN
    CREATE TRIGGER trg_notify_review_request
      AFTER INSERT ON review_requests
      FOR EACH ROW
      EXECUTE FUNCTION notify_client_review_request();
  END IF;
END$$;

-- 5. Crear función get_review_branch_google_maps_url
-- Usada por la app Flutter para redirigir a Google Maps tras reseña 5 estrellas
CREATE OR REPLACE FUNCTION get_review_branch_google_maps_url(p_token TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT b.google_review_url
  FROM review_requests rr
  JOIN branches b ON b.id = rr.branch_id
  WHERE rr.token = p_token
  LIMIT 1;
$$;
