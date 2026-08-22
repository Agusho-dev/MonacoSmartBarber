-- =============================================================================
-- 193 — Push notifications a clientes (FCM v1): outbox, campañas, preferencias,
--       configuración por org, recordatorios de turno y cron
-- =============================================================================
-- Hasta acá había tres transportes incompatibles y ninguno funcionaba (la app
-- registraba tokens FCM, la edge function del repo mandaba a Expo y la
-- deployada usaba la API legacy de FCM, apagada en 2024). Esta migración deja
-- UN solo camino:
--
--   productor (campaña del dashboard / recordatorio / cancelación / premio)
--     → push_outbox (pending)
--     → cron `send-push-outbox` cada minuto → trigger_send_push()
--         → enqueue_due_appointment_reminders() + net.http_post a la edge
--           function `send-push` (FCM HTTP v1, service account)
--     → client_notifications (bandeja in-app, Realtime) + contadores.
--
-- Autosuficiente e idempotente. Sólo service_role escribe el outbox.
-- =============================================================================

-- ── 1. client_device_tokens: metadatos del dispositivo ──────────────────────
ALTER TABLE public.client_device_tokens
  ADD COLUMN IF NOT EXISTS provider      text NOT NULL DEFAULT 'fcm',
  ADD COLUMN IF NOT EXISTS last_seen_at  timestamptz,
  ADD COLUMN IF NOT EXISTS app_version   text,
  ADD COLUMN IF NOT EXISTS last_error    text,
  ADD COLUMN IF NOT EXISTS last_error_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_device_tokens_provider_check') THEN
    ALTER TABLE public.client_device_tokens
      ADD CONSTRAINT client_device_tokens_provider_check CHECK (provider IN ('fcm'));
  END IF;
END $$;

-- device_id pasa a ser obligatorio (la tabla está vacía en prod; si hubiera
-- filas sin device_id, se les pone el token como device_id para no perderlas).
UPDATE public.client_device_tokens SET device_id = token WHERE device_id IS NULL;
ALTER TABLE public.client_device_tokens ALTER COLUMN device_id SET NOT NULL;

-- ── 2. Preferencias del cliente ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_notification_preferences (
  client_id             uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campaigns             boolean NOT NULL DEFAULT true,
  appointment_reminders boolean NOT NULL DEFAULT true,
  appointment_updates   boolean NOT NULL DEFAULT true,
  rewards               boolean NOT NULL DEFAULT true,
  updated_at            timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.client_notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cnp_client_select_own ON public.client_notification_preferences;
DROP POLICY IF EXISTS cnp_client_insert_own ON public.client_notification_preferences;
DROP POLICY IF EXISTS cnp_client_update_own ON public.client_notification_preferences;
DROP POLICY IF EXISTS cnp_service_role ON public.client_notification_preferences;
CREATE POLICY cnp_client_select_own ON public.client_notification_preferences
  FOR SELECT TO authenticated USING (client_id = public.current_client_id());
CREATE POLICY cnp_client_insert_own ON public.client_notification_preferences
  FOR INSERT TO authenticated WITH CHECK (client_id = public.current_client_id());
CREATE POLICY cnp_client_update_own ON public.client_notification_preferences
  FOR UPDATE TO authenticated
  USING (client_id = public.current_client_id())
  WITH CHECK (client_id = public.current_client_id());
CREATE POLICY cnp_service_role ON public.client_notification_preferences
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.client_notification_preferences TO authenticated;
GRANT ALL ON public.client_notification_preferences TO service_role;
REVOKE ALL ON public.client_notification_preferences FROM anon;

DROP TRIGGER IF EXISTS trg_cnp_updated_at ON public.client_notification_preferences;
CREATE TRIGGER trg_cnp_updated_at
  BEFORE UPDATE ON public.client_notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ── 3. Configuración por organización (lo que toca el dueño) ────────────────
CREATE TABLE IF NOT EXISTS public.push_settings (
  organization_id               uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  reminders_enabled             boolean NOT NULL DEFAULT true,
  reminder_hours                int[]   NOT NULL DEFAULT '{24,2}',
  reminder_title                text    NOT NULL DEFAULT 'Recordatorio de turno',
  reminder_body_24h             text    NOT NULL DEFAULT 'Mañana a las {{hora}} te esperamos en {{sucursal}} con {{barbero}}.',
  reminder_body_2h              text    NOT NULL DEFAULT 'Tu turno es a las {{hora}} en {{sucursal}}. ¡Te esperamos!',
  appointment_cancelled_enabled boolean NOT NULL DEFAULT true,
  appointment_cancelled_body    text    NOT NULL DEFAULT 'Tu turno del {{fecha}} a las {{hora}} en {{sucursal}} fue cancelado. Podés reservar otro desde la app.',
  rewards_enabled               boolean NOT NULL DEFAULT true,
  reward_body                   text    NOT NULL DEFAULT '¡Tenés un premio nuevo! Entrá a la app para verlo.',
  updated_at                    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.push_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_settings_org_select ON public.push_settings;
DROP POLICY IF EXISTS push_settings_org_update ON public.push_settings;
DROP POLICY IF EXISTS push_settings_org_insert ON public.push_settings;
DROP POLICY IF EXISTS push_settings_service_role ON public.push_settings;
CREATE POLICY push_settings_org_select ON public.push_settings
  FOR SELECT TO authenticated USING (organization_id = public.get_user_org_id());
CREATE POLICY push_settings_org_insert ON public.push_settings
  FOR INSERT TO authenticated WITH CHECK (organization_id = public.get_user_org_id());
CREATE POLICY push_settings_org_update ON public.push_settings
  FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id())
  WITH CHECK (organization_id = public.get_user_org_id());
CREATE POLICY push_settings_service_role ON public.push_settings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.push_settings TO authenticated;
GRANT ALL ON public.push_settings TO service_role;
REVOKE ALL ON public.push_settings FROM anon;

DROP TRIGGER IF EXISTS trg_push_settings_updated_at ON public.push_settings;
CREATE TRIGGER trg_push_settings_updated_at
  BEFORE UPDATE ON public.push_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Fila de Monaco con los defaults.
INSERT INTO public.push_settings (organization_id)
VALUES ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
ON CONFLICT (organization_id) DO NOTHING;

-- ── 4. Campañas ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_campaigns (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name             text NOT NULL,
  title            text NOT NULL CHECK (char_length(title) <= 65),
  body             text NOT NULL CHECK (char_length(body) <= 240),
  image_url        text,
  deep_link        text,
  data             jsonb NOT NULL DEFAULT '{}'::jsonb,
  audience_filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  status           text NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','scheduled','sending','sent','cancelled','failed')),
  scheduled_for    timestamptz,
  started_at       timestamptz,
  completed_at     timestamptz,
  audience_count   int,
  sent_count       int NOT NULL DEFAULT 0,
  failed_count     int NOT NULL DEFAULT 0,
  no_token_count   int NOT NULL DEFAULT 0,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_campaigns_org_created
  ON public.push_campaigns (organization_id, created_at DESC);
ALTER TABLE public.push_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_campaigns_org ON public.push_campaigns;
DROP POLICY IF EXISTS push_campaigns_service_role ON public.push_campaigns;
CREATE POLICY push_campaigns_org ON public.push_campaigns
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id())
  WITH CHECK (organization_id = public.get_user_org_id());
CREATE POLICY push_campaigns_service_role ON public.push_campaigns
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_campaigns TO authenticated;
GRANT ALL ON public.push_campaigns TO service_role;
REVOKE ALL ON public.push_campaigns FROM anon;

DROP TRIGGER IF EXISTS trg_push_campaigns_updated_at ON public.push_campaigns;
CREATE TRIGGER trg_push_campaigns_updated_at
  BEFORE UPDATE ON public.push_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ── 5. Outbox ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_outbox (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL,
  client_id               uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  kind                    text NOT NULL
                          CHECK (kind IN ('campaign','appointment_reminder','appointment_update','reward','points','manual','test')),
  title                   text NOT NULL,
  body                    text NOT NULL,
  image_url               text,
  data                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  deep_link               text,
  campaign_id             uuid REFERENCES public.push_campaigns(id) ON DELETE SET NULL,
  appointment_reminder_id uuid REFERENCES public.appointment_reminders(id) ON DELETE SET NULL,
  appointment_id          uuid,
  scheduled_for           timestamptz NOT NULL DEFAULT now(),
  status                  text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','processing','sent','failed','skipped','cancelled')),
  attempts                int NOT NULL DEFAULT 0,
  last_attempt_at         timestamptz,
  last_error              text,
  sent_at                 timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_outbox_pending
  ON public.push_outbox (scheduled_for) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_push_outbox_campaign ON public.push_outbox (campaign_id);
CREATE INDEX IF NOT EXISTS idx_push_outbox_client ON public.push_outbox (client_id, created_at DESC);
ALTER TABLE public.push_outbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_outbox_service_role ON public.push_outbox;
CREATE POLICY push_outbox_service_role ON public.push_outbox
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.push_outbox FROM public, anon, authenticated;
GRANT ALL ON public.push_outbox TO service_role;
-- NO agregar push_outbox a supabase_realtime (Known Risk #9).

-- ── 6. Bandeja in-app: organización, deep link, lectura, origen ─────────────
ALTER TABLE public.client_notifications
  ADD COLUMN IF NOT EXISTS organization_id uuid,
  ADD COLUMN IF NOT EXISTS deep_link       text,
  ADD COLUMN IF NOT EXISTS read_at         timestamptz,
  ADD COLUMN IF NOT EXISTS push_outbox_id  uuid;

UPDATE public.client_notifications cn
   SET organization_id = c.organization_id
  FROM public.clients c
 WHERE c.id = cn.client_id AND cn.organization_id IS NULL;

UPDATE public.client_notifications
   SET read_at = COALESCE(read_at, created_at)
 WHERE is_read = true AND read_at IS NULL;

ALTER TABLE public.client_notifications DROP CONSTRAINT IF EXISTS client_notifications_type_check;
ALTER TABLE public.client_notifications
  ADD CONSTRAINT client_notifications_type_check
  CHECK (type IN ('review_request','reward','promo','alert','appointment_reminder','appointment_update','campaign','points','test'));

CREATE INDEX IF NOT EXISTS idx_client_notifications_org
  ON public.client_notifications (organization_id, created_at DESC);

-- ── 7. appointment_reminders: estado 'skipped' + trigger también en UPDATE ──
ALTER TABLE public.appointment_reminders DROP CONSTRAINT IF EXISTS appointment_reminders_status_check;
ALTER TABLE public.appointment_reminders
  ADD CONSTRAINT appointment_reminders_status_check
  CHECK (status IN ('pending','sent','failed','cancelled','skipped'));

-- Cuerpo vivo conservado + respeta push_settings.reminder_hours (kinds push_24h/push_2h).
CREATE OR REPLACE FUNCTION public.fn_enqueue_appointment_reminders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_has_wa boolean;
  v_hours  int[];
BEGIN
  SELECT COALESCE(ps.reminder_hours, '{24,2}')
    INTO v_hours
    FROM public.push_settings ps
   WHERE ps.organization_id = NEW.organization_id;
  IF v_hours IS NULL THEN v_hours := '{24,2}'; END IF;

  -- Push: 24h y 2h, sólo si la org los tiene habilitados en push_settings
  IF 24 = ANY(v_hours) THEN
    INSERT INTO appointment_reminders (appointment_id, organization_id, kind, scheduled_for)
    VALUES (NEW.id, NEW.organization_id, 'push_24h', lower(NEW.time_range) - INTERVAL '24 hours')
    ON CONFLICT (appointment_id, kind) DO NOTHING;
  END IF;
  IF 2 = ANY(v_hours) THEN
    INSERT INTO appointment_reminders (appointment_id, organization_id, kind, scheduled_for)
    VALUES (NEW.id, NEW.organization_id, 'push_2h', lower(NEW.time_range) - INTERVAL '2 hours')
    ON CONFLICT (appointment_id, kind) DO NOTHING;
  END IF;

  -- WA solo si la org tiene canal whatsapp activo (los manda scheduled_messages;
  -- estas filas quedan como registro/compatibilidad)
  SELECT EXISTS (
    SELECT 1 FROM social_channels
    WHERE organization_id = NEW.organization_id
      AND platform = 'whatsapp'
      AND is_active = true
  ) INTO v_has_wa;

  IF v_has_wa THEN
    INSERT INTO appointment_reminders (appointment_id, organization_id, kind, scheduled_for)
    VALUES
      (NEW.id, NEW.organization_id, 'wa_24h', lower(NEW.time_range) - INTERVAL '24 hours'),
      (NEW.id, NEW.organization_id, 'wa_2h',  lower(NEW.time_range) - INTERVAL '2 hours')
    ON CONFLICT (appointment_id, kind) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

-- Dos triggers (TG_OP no está disponible en la cláusula WHEN): al insertar, y
-- al pasar a scheduled/confirmed por UPDATE (caso prepago → confirmed).
DROP TRIGGER IF EXISTS trg_enqueue_appointment_reminders ON public.appointments;
CREATE TRIGGER trg_enqueue_appointment_reminders
  AFTER INSERT ON public.appointments
  FOR EACH ROW
  WHEN (NEW.status IN ('scheduled','confirmed'))
  EXECUTE FUNCTION public.fn_enqueue_appointment_reminders();

DROP TRIGGER IF EXISTS trg_enqueue_appointment_reminders_upd ON public.appointments;
CREATE TRIGGER trg_enqueue_appointment_reminders_upd
  AFTER UPDATE OF status ON public.appointments
  FOR EACH ROW
  WHEN (NEW.status IN ('scheduled','confirmed') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.fn_enqueue_appointment_reminders();

-- ── 8. Plantillas: {{nombre}} {{hora}} {{fecha}} {{sucursal}} {{barbero}} ──
CREATE OR REPLACE FUNCTION public.push_render_template(
  p_tpl text, p_nombre text, p_hora text, p_fecha text, p_sucursal text, p_barbero text
) RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT replace(replace(replace(replace(replace(COALESCE(p_tpl,''),
           '{{nombre}}',   COALESCE(p_nombre,'')),
           '{{hora}}',     COALESCE(p_hora,'')),
           '{{fecha}}',    COALESCE(p_fecha,'')),
           '{{sucursal}}', COALESCE(p_sucursal,'')),
           '{{barbero}}',  COALESCE(p_barbero,'el equipo'));
$$;

-- Primer nombre "humano" (si el nombre es sólo dígitos, vacío).
CREATE OR REPLACE FUNCTION public.push_first_name(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN COALESCE(p_name,'') ~ '^\s*\d+\s*$' OR COALESCE(p_name,'') = '' THEN ''
              ELSE split_part(btrim(p_name), ' ', 1) END;
$$;

-- ── 9. claim_pending_push (patrón de claim_pending_messages) ────────────────
CREATE OR REPLACE FUNCTION public.claim_pending_push(p_batch_size integer DEFAULT 100)
RETURNS SETOF public.push_outbox
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.push_outbox po
     SET status = 'processing',
         last_attempt_at = now(),
         attempts = po.attempts + 1
   WHERE po.id IN (
     SELECT id FROM public.push_outbox
      WHERE status = 'pending'
        AND scheduled_for <= now()
      ORDER BY scheduled_for ASC
      LIMIT p_batch_size
      FOR UPDATE SKIP LOCKED
   )
  RETURNING po.*;
$$;
REVOKE ALL ON FUNCTION public.claim_pending_push(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_push(integer) TO service_role;

-- ── 10. Recordatorios de turno → outbox ─────────────────────────────────────
-- Mueve los appointment_reminders push_* vencidos al outbox. El reminder queda
-- 'sent' al encolar (el outbox lleva el estado real de entrega y la edge
-- function lo propaga a failed/skipped si corresponde).
CREATE OR REPLACE FUNCTION public.enqueue_due_appointment_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  v_count integer := 0;
  v_tpl text;
  v_title text;
  v_body text;
  v_hora text;
  v_fecha text;
  v_tz text;
BEGIN
  FOR r IN
    SELECT ar.id AS reminder_id, ar.kind, ar.organization_id,
           a.id AS appointment_id, a.client_id, a.appointment_date, a.start_time, a.branch_id, a.barber_id,
           b.name AS branch_name, b.timezone,
           s.full_name AS barber_name,
           c.name AS client_name,
           ps.reminders_enabled, ps.reminder_title, ps.reminder_body_24h, ps.reminder_body_2h,
           COALESCE(cnp.appointment_reminders, true) AS pref_ok
      FROM public.appointment_reminders ar
      JOIN public.appointments a ON a.id = ar.appointment_id
      JOIN public.branches b ON b.id = a.branch_id
      JOIN public.clients c ON c.id = a.client_id
      LEFT JOIN public.staff s ON s.id = a.barber_id
      LEFT JOIN public.push_settings ps ON ps.organization_id = ar.organization_id
      LEFT JOIN public.client_notification_preferences cnp ON cnp.client_id = a.client_id
     WHERE ar.status = 'pending'
       AND ar.kind IN ('push_24h','push_2h')
       AND ar.scheduled_for <= now()
       AND a.status IN ('scheduled','confirmed','checked_in')
     ORDER BY ar.scheduled_for
     LIMIT 500
     FOR UPDATE OF ar SKIP LOCKED
  LOOP
    IF COALESCE(r.reminders_enabled, true) = false OR r.pref_ok = false THEN
      UPDATE public.appointment_reminders SET status = 'skipped' WHERE id = r.reminder_id;
      CONTINUE;
    END IF;

    v_tz := COALESCE(r.timezone, 'America/Argentina/Buenos_Aires');
    v_hora := to_char(r.start_time, 'HH24:MI');
    v_fecha := to_char(r.appointment_date, 'DD/MM');
    v_tpl := CASE WHEN r.kind = 'push_24h'
                  THEN COALESCE(r.reminder_body_24h, 'Mañana a las {{hora}} te esperamos en {{sucursal}} con {{barbero}}.')
                  ELSE COALESCE(r.reminder_body_2h, 'Tu turno es a las {{hora}} en {{sucursal}}. ¡Te esperamos!') END;
    v_title := COALESCE(r.reminder_title, 'Recordatorio de turno');
    v_body := public.push_render_template(v_tpl, public.push_first_name(r.client_name), v_hora, v_fecha, r.branch_name, r.barber_name);

    INSERT INTO public.push_outbox (organization_id, client_id, kind, title, body, data, deep_link,
                                    appointment_reminder_id, appointment_id, scheduled_for)
    VALUES (r.organization_id, r.client_id, 'appointment_reminder', v_title, v_body,
            jsonb_build_object('type','appointment_reminder','value', r.appointment_id::text, 'kind', r.kind),
            '/turnos', r.reminder_id, r.appointment_id, now());

    UPDATE public.appointment_reminders SET status = 'sent', sent_at = now() WHERE id = r.reminder_id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_due_appointment_reminders() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_due_appointment_reminders() TO service_role;

-- ── 11. Cancelación por la barbería → push ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_push_on_appointment_cancelled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_enabled boolean;
  v_tpl text;
  v_branch text;
  v_client_name text;
  v_pref boolean;
BEGIN
  SELECT ps.appointment_cancelled_enabled, ps.appointment_cancelled_body
    INTO v_enabled, v_tpl
    FROM public.push_settings ps WHERE ps.organization_id = NEW.organization_id;
  IF COALESCE(v_enabled, true) = false THEN RETURN NEW; END IF;

  SELECT COALESCE(cnp.appointment_updates, true) INTO v_pref
    FROM public.client_notification_preferences cnp WHERE cnp.client_id = NEW.client_id;
  IF COALESCE(v_pref, true) = false THEN RETURN NEW; END IF;

  SELECT b.name INTO v_branch FROM public.branches b WHERE b.id = NEW.branch_id;
  SELECT c.name INTO v_client_name FROM public.clients c WHERE c.id = NEW.client_id;

  INSERT INTO public.push_outbox (organization_id, client_id, kind, title, body, data, deep_link, appointment_id)
  VALUES (
    NEW.organization_id, NEW.client_id, 'appointment_update',
    'Turno cancelado',
    public.push_render_template(
      COALESCE(v_tpl, 'Tu turno del {{fecha}} a las {{hora}} en {{sucursal}} fue cancelado. Podés reservar otro desde la app.'),
      public.push_first_name(v_client_name),
      to_char(NEW.start_time, 'HH24:MI'),
      to_char(NEW.appointment_date, 'DD/MM'),
      v_branch, NULL),
    jsonb_build_object('type','appointment_update','value', NEW.id::text, 'reason','cancelled_by_staff'),
    '/turnos', NEW.id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_push_on_appointment_cancelled ON public.appointments;
CREATE TRIGGER trg_push_on_appointment_cancelled
  AFTER UPDATE OF status ON public.appointments
  FOR EACH ROW
  WHEN (NEW.status = 'cancelled'
        AND OLD.status IS DISTINCT FROM 'cancelled'
        AND NEW.cancelled_by IN ('staff','system'))
  EXECUTE FUNCTION public.fn_push_on_appointment_cancelled();

-- ── 12. Premio nuevo → push ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_push_on_client_reward()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_enabled boolean;
  v_tpl text;
  v_pref boolean;
  v_reward_name text;
  v_client_name text;
  v_org uuid;
BEGIN
  v_org := NEW.organization_id;
  IF v_org IS NULL THEN
    SELECT c.organization_id INTO v_org FROM public.clients c WHERE c.id = NEW.client_id;
  END IF;
  IF v_org IS NULL THEN RETURN NEW; END IF;

  SELECT ps.rewards_enabled, ps.reward_body INTO v_enabled, v_tpl
    FROM public.push_settings ps WHERE ps.organization_id = v_org;
  IF COALESCE(v_enabled, true) = false THEN RETURN NEW; END IF;

  SELECT COALESCE(cnp.rewards, true) INTO v_pref
    FROM public.client_notification_preferences cnp WHERE cnp.client_id = NEW.client_id;
  IF COALESCE(v_pref, true) = false THEN RETURN NEW; END IF;

  SELECT rc.name INTO v_reward_name FROM public.reward_catalog rc WHERE rc.id = NEW.reward_id;
  SELECT c.name INTO v_client_name FROM public.clients c WHERE c.id = NEW.client_id;

  INSERT INTO public.push_outbox (organization_id, client_id, kind, title, body, data, deep_link)
  VALUES (
    v_org, NEW.client_id, 'reward',
    COALESCE(NULLIF(v_reward_name,''), 'Tenés un premio nuevo'),
    public.push_render_template(
      COALESCE(v_tpl, '¡Tenés un premio nuevo! Entrá a la app para verlo.'),
      public.push_first_name(v_client_name), NULL, NULL, NULL, NULL),
    jsonb_build_object('type','reward','value', NEW.id::text),
    '/rewards'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_push_on_client_reward ON public.client_rewards;
CREATE TRIGGER trg_push_on_client_reward
  AFTER INSERT ON public.client_rewards
  FOR EACH ROW
  WHEN (NEW.status = 'available')
  EXECUTE FUNCTION public.fn_push_on_client_reward();

-- ── 13. Cron: trigger_send_push() (mismo mecanismo que el job 1) ────────────
CREATE OR REPLACE FUNCTION public.trigger_send_push()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'vault'
AS $$
DECLARE
  v_key text;
  v_request_id bigint;
  v_enqueued integer;
BEGIN
  -- 1) recordatorios vencidos → outbox
  v_enqueued := public.enqueue_due_appointment_reminders();

  -- 2) si no hay nada para mandar, no gastamos una invocación
  IF NOT EXISTS (SELECT 1 FROM public.push_outbox WHERE status = 'pending' AND scheduled_for <= now()) THEN
    RETURN 0;
  END IF;

  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
   WHERE name = 'service_role_key'
   LIMIT 1;
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'Missing vault secret: service_role_key';
  END IF;

  SELECT net.http_post(
    url := 'https://gzsfoqpxvnwmvngfoqqk.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;
REVOKE ALL ON FUNCTION public.trigger_send_push() FROM public, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- el job 14 (process_appointment_reminders) estaba inactivo y roto (GUCs sin setear)
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'process_appointment_reminders';
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'send-push-outbox';
    PERFORM cron.schedule('send-push-outbox', '* * * * *', $cron$SELECT public.trigger_send_push()$cron$);
  END IF;
END $$;

-- ── 14. Permisos de roles ───────────────────────────────────────────────────
UPDATE public.roles
   SET permissions = permissions || jsonb_build_object('notifications.view', true, 'notifications.manage', true)
 WHERE COALESCE((permissions ->> 'comprobantes.manage')::boolean, false) = true
   AND COALESCE((permissions ->> 'notifications.manage')::boolean, false) = false;

UPDATE public.roles
   SET permissions = permissions || jsonb_build_object('notifications.view', true)
 WHERE COALESCE((permissions ->> 'comprobantes.view')::boolean, false) = true
   AND COALESCE((permissions ->> 'notifications.view')::boolean, false) = false;

-- ── 15. delete_client_account (mig 091 nunca aplicada) + tablas nuevas ──────
CREATE OR REPLACE FUNCTION public.delete_client_account(p_auth_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_client_id uuid;
BEGIN
  SELECT id INTO v_client_id FROM public.clients WHERE auth_user_id = p_auth_user_id ORDER BY created_at LIMIT 1;
  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'client_not_found';
  END IF;

  -- PII y datos del cliente
  DELETE FROM public.client_face_descriptors          WHERE client_id = v_client_id;
  DELETE FROM public.client_device_tokens             WHERE client_id = v_client_id;
  DELETE FROM public.client_notifications             WHERE client_id = v_client_id;
  DELETE FROM public.client_notification_preferences  WHERE client_id = v_client_id;
  DELETE FROM public.push_outbox                      WHERE client_id = v_client_id;
  DELETE FROM public.client_goals                     WHERE client_id = v_client_id;
  DELETE FROM public.client_loyalty_state             WHERE client_id = v_client_id;
  DELETE FROM public.client_points                    WHERE client_id = v_client_id;
  DELETE FROM public.client_rewards                   WHERE client_id = v_client_id;
  DELETE FROM public.crm_cases                        WHERE client_id = v_client_id;
  DELETE FROM public.broadcast_recipients             WHERE client_id = v_client_id;
  DELETE FROM public.review_requests                  WHERE client_id = v_client_id;
  DELETE FROM public.scheduled_messages               WHERE client_id = v_client_id;
  DELETE FROM public.appointments                     WHERE client_id = v_client_id;
  DELETE FROM public.partner_benefit_redemptions      WHERE client_id = v_client_id;
  DELETE FROM public.client_reviews                   WHERE client_id = v_client_id;
  DELETE FROM public.point_transactions               WHERE client_id = v_client_id;
  DELETE FROM public.conversations                    WHERE client_id = v_client_id;

  -- Valor contable del negocio: se anonimiza
  UPDATE public.visits        SET client_id = NULL WHERE client_id = v_client_id;
  UPDATE public.queue_entries SET client_id = NULL WHERE client_id = v_client_id;

  DELETE FROM public.clients WHERE id = v_client_id;
  RETURN v_client_id;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_client_account(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_client_account(uuid) TO service_role;
COMMENT ON FUNCTION public.delete_client_account(uuid) IS
  'Apple 5.1.1(v): elimina la cuenta del cliente y sus datos. La llama la edge function delete-client-account con service role.';
