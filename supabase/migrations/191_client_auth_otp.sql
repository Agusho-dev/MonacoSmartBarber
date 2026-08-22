-- =============================================================================
-- 191 — Desafíos OTP para el login de clientes de la app mobile
-- =============================================================================
-- La Edge Function `client-auth` v2 manda un código de 6 dígitos por WhatsApp
-- (template AUTHENTICATION) y lo valida contra esta tabla. Reemplaza el
-- esquema anterior, que reseteaba la password al `device_secret` recibido
-- sin verificar nada: cualquiera que supiera un teléfono entraba como ese
-- cliente.
--
-- Sólo la toca el service role (la edge function). Ni anon ni authenticated
-- tienen grant de tabla.
-- =============================================================================

create table if not exists public.client_otp_challenges (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  phone_e164      text not null,
  phone_tail      text not null,            -- últimos 10 dígitos (clave de búsqueda)
  device_id       text not null,
  code_hash       text not null,            -- sha256(code:pepper)
  attempts        int  not null default 0,
  expires_at      timestamptz not null,
  consumed_at     timestamptz,
  created_at      timestamptz not null default now(),
  ip              text
);

comment on table public.client_otp_challenges is
  'Códigos OTP (hash) del login de clientes mobile. Los escribe y lee sólo la edge function client-auth.';

create index if not exists idx_client_otp_lookup
  on public.client_otp_challenges (organization_id, phone_tail, device_id, created_at desc)
  where consumed_at is null;

create index if not exists idx_client_otp_expires
  on public.client_otp_challenges (expires_at);

alter table public.client_otp_challenges enable row level security;

revoke all on public.client_otp_challenges from public, anon, authenticated;
grant all on public.client_otp_challenges to service_role;

drop policy if exists client_otp_service_role_only on public.client_otp_challenges;
create policy client_otp_service_role_only
  on public.client_otp_challenges
  for all to service_role
  using (true) with check (true);

-- Limpieza: los desafíos sirven 10 minutos; un día después no tienen valor.
create or replace function public.cleanup_client_otp_challenges()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  delete from public.client_otp_challenges
   where expires_at < now() - interval '1 day';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.cleanup_client_otp_challenges() from public, anon, authenticated;
grant execute on function public.cleanup_client_otp_challenges() to service_role;

-- Cron diario (idempotente).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'cleanup-client-otp';
    perform cron.schedule(
      'cleanup-client-otp',
      '17 4 * * *',
      $cron$select public.cleanup_client_otp_challenges()$cron$
    );
  end if;
end $$;
