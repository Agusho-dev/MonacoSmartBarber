-- 152_assistant_rag.sql
-- RAG (Retrieval-Augmented Generation) para el Asistente IA.
-- Documentos fuente + chunks vectorizados (pgvector), RPC de match org-scoped,
-- y cron de embeddings incremental. Todo aditivo e idempotente.
--
-- Decisión de diseño: se vectoriza SOLO texto no estructurado (base de
-- conocimiento, mensajes inbound, notas). Los números/analítica NO se vectorizan
-- (se calculan en vivo vía herramientas). Ver CLAUDE.md / plan del Asistente IA.

create extension if not exists vector;
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── Documentos fuente ────────────────────────────────────────────────
create table if not exists public.assistant_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_type text not null check (source_type in ('kb','message','review','crm','note','visit')),
  source_id text,
  title text,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  content_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Un documento por fila-fuente (permite re-upsert por hash sin duplicar)
create unique index if not exists uq_assistant_documents_source
  on public.assistant_documents(organization_id, source_type, source_id)
  where source_id is not null;
create index if not exists idx_assistant_documents_org on public.assistant_documents(organization_id);
create index if not exists idx_assistant_documents_hash on public.assistant_documents(organization_id, content_hash);

-- ── Chunks vectorizados ──────────────────────────────────────────────
create table if not exists public.assistant_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.assistant_documents(id) on delete cascade,
  organization_id uuid not null,
  chunk_index int not null default 0,
  content text not null,
  embedding vector(1536),
  token_count int,
  created_at timestamptz not null default now()
);

create index if not exists idx_assistant_chunks_org on public.assistant_chunks(organization_id);
-- HNSW para similitud coseno; solo sobre filas ya embebidas
create index if not exists idx_assistant_chunks_embedding
  on public.assistant_chunks using hnsw (embedding vector_cosine_ops)
  where embedding is not null;
-- Pendientes de embeber (el cron los drena)
create index if not exists idx_assistant_chunks_pending
  on public.assistant_chunks(organization_id) where embedding is null;

-- ── RLS deny-all (service_role bypassa; el dashboard usa service role) ─
alter table public.assistant_documents enable row level security;
alter table public.assistant_chunks enable row level security;

-- ── RPC de match semántico (org forzado server-side) ─────────────────
create or replace function public.match_assistant_chunks(
  query_embedding vector(1536),
  p_org_id uuid,
  match_count int default 6,
  similarity_threshold float default 0.25,
  source_filter text[] default null
) returns table (
  chunk_id uuid,
  document_id uuid,
  content text,
  title text,
  source_type text,
  metadata jsonb,
  similarity float
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id, c.document_id, c.content, d.title, d.source_type, d.metadata,
         1 - (c.embedding <=> query_embedding) as similarity
  from public.assistant_chunks c
  join public.assistant_documents d on d.id = c.document_id
  where c.organization_id = p_org_id
    and c.embedding is not null
    and (source_filter is null or d.source_type = any(source_filter))
    and 1 - (c.embedding <=> query_embedding) > similarity_threshold
  order by c.embedding <=> query_embedding
  limit greatest(1, least(match_count, 20));
$$;

revoke execute on function public.match_assistant_chunks(vector,uuid,int,float,text[]) from public, anon, authenticated;
grant execute on function public.match_assistant_chunks(vector,uuid,int,float,text[]) to service_role;

-- ── Cron de embeddings: drena chunks pendientes cada 2 min ───────────
-- Reutiliza el secret 'app_base_url' del Vault (cargado en migración 087).
-- El endpoint /api/cron/embed-pending es idempotente y no requiere auth
-- (convención de crons nuevos, ver CLAUDE.md).
create or replace function public.trigger_assistant_embed_pending()
returns bigint
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_url text;
  v_request_id bigint;
  v_pending int;
begin
  -- Solo dispara si hay trabajo pendiente (evita HTTP innecesario)
  select count(*) into v_pending from public.assistant_chunks where embedding is null;
  if v_pending = 0 then
    return null;
  end if;

  select decrypted_secret into v_url
  from vault.decrypted_secrets where name = 'app_base_url' limit 1;

  if v_url is null then
    raise notice 'assistant embed: app_base_url no configurado en Vault';
    return null;
  end if;

  select net.http_post(
    url := v_url || '/api/cron/embed-pending',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.trigger_assistant_embed_pending() from public;
grant execute on function public.trigger_assistant_embed_pending() to postgres;

do $$ begin
  perform cron.unschedule('assistant-embed-pending');
exception when others then null;
end $$;

select cron.schedule(
  'assistant-embed-pending',
  '*/2 * * * *',
  $job$select public.trigger_assistant_embed_pending();$job$
);

comment on table public.assistant_documents is 'Asistente IA RAG: documentos fuente (KB, mensajes, notas) a vectorizar.';
comment on table public.assistant_chunks is 'Asistente IA RAG: chunks con embedding vector(1536), HNSW cosine. embedding NULL = pendiente de embeber.';
comment on function public.match_assistant_chunks(vector,uuid,int,float,text[]) is 'Búsqueda semántica org-scoped para el Asistente IA. p_org_id se inyecta server-side, nunca desde el modelo.';
