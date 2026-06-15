-- 153_assistant_persistence.sql
-- Persistencia del Asistente IA: conversaciones, mensajes y auditoría.
-- RLS deny-all (el dashboard accede vía service role). Aditivo e idempotente.

create table if not exists public.assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid,
  title text,
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_assistant_conv_org_user
  on public.assistant_conversations(organization_id, user_id, updated_at desc);

create table if not exists public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.assistant_conversations(id) on delete cascade,
  organization_id uuid not null,
  role text not null check (role in ('user','assistant','system','tool')),
  content text,
  parts jsonb,
  tool_calls jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_assistant_msg_conv
  on public.assistant_messages(conversation_id, created_at);

-- Auditoría: cada invocación de tool / SQL / RAG y cada denegación de permiso.
create table if not exists public.assistant_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid,
  kind text not null,                 -- 'tool' | 'sql' | 'rag' | 'denied' | 'chat'
  tool_name text,
  detail jsonb,
  allowed boolean,
  created_at timestamptz not null default now()
);
create index if not exists idx_assistant_audit_org
  on public.assistant_audit_log(organization_id, created_at desc);

alter table public.assistant_conversations enable row level security;
alter table public.assistant_messages enable row level security;
alter table public.assistant_audit_log enable row level security;

comment on table public.assistant_conversations is 'Hilos de conversación del Asistente IA (por org + usuario).';
comment on table public.assistant_messages is 'Mensajes del Asistente IA. parts = UIMessage parts del AI SDK.';
comment on table public.assistant_audit_log is 'Auditoría del Asistente IA: tools, SQL Pro, RAG y denegaciones.';
