-- CRM: Reglas de auto-respuesta, difusiones masivas y mensajes rapidos

-- Auto-reply rules
CREATE TABLE IF NOT EXISTS public.auto_reply_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  keywords text[] NOT NULL,
  match_mode text NOT NULL DEFAULT 'contains',
  response_type text NOT NULL DEFAULT 'text',
  response_text text,
  response_template_name text,
  response_template_language text DEFAULT 'es_AR',
  is_active boolean NOT NULL DEFAULT true,
  platform text DEFAULT 'all',
  priority integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_auto_reply_rules_org ON public.auto_reply_rules(organization_id) WHERE is_active = true;

-- Broadcasts (difusiones masivas)
CREATE TABLE IF NOT EXISTS public.broadcasts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  message_type text NOT NULL DEFAULT 'template',
  template_name text,
  template_language text DEFAULT 'es_AR',
  template_components jsonb,
  text_content text,
  audience_filters jsonb NOT NULL DEFAULT '{}',
  audience_count integer DEFAULT 0,
  sent_count integer DEFAULT 0,
  delivered_count integer DEFAULT 0,
  failed_count integer DEFAULT 0,
  scheduled_for timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_broadcasts_org ON public.broadcasts(organization_id);

-- Broadcast recipients (destinatarios individuales)
CREATE TABLE IF NOT EXISTS public.broadcast_recipients (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  broadcast_id uuid NOT NULL REFERENCES public.broadcasts(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  phone text,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  sent_at timestamptz,
  platform_message_id text,
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_broadcast ON public.broadcast_recipients(broadcast_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_pending ON public.broadcast_recipients(broadcast_id) WHERE status = 'pending';

-- Quick replies (mensajes rapidos predefinidos)
CREATE TABLE IF NOT EXISTS public.quick_replies (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  content text NOT NULL,
  shortcut text,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_quick_replies_org ON public.quick_replies(organization_id);

-- Agregar broadcast_id a scheduled_messages para trackeo de difusiones
ALTER TABLE public.scheduled_messages ADD COLUMN IF NOT EXISTS broadcast_id uuid REFERENCES public.broadcasts(id) ON DELETE SET NULL;
