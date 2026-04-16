-- =============================================================
-- Migration 085: Convenios Comerciales (Partner Benefits)
-- Comercios aliados globales ofrecen beneficios a clientes de
-- organizaciones (barberías). Flujo: invitación → magic link →
-- partner carga beneficio → org aprueba → se muestra en la app.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Tablas
-- -------------------------------------------------------------

create table if not exists public.commercial_partners (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  contact_email text unique,
  contact_phone text,
  logo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.commercial_partners is 'Comercios aliados (globales). Un partner puede relacionarse con múltiples organizaciones.';

create table if not exists public.partner_org_relations (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.commercial_partners(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  status text not null default 'active' check (status in ('active','paused','revoked')),
  invited_by uuid references public.staff(id) on delete set null,
  invited_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (partner_id, organization_id)
);
comment on table public.partner_org_relations is 'Relación M:N entre partners y organizaciones.';

create table if not exists public.partner_benefits (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.commercial_partners(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  description text,
  discount_text text,
  image_url text,
  terms text,
  location_address text,
  location_map_url text,
  valid_from timestamptz,
  valid_until timestamptz,
  status text not null default 'pending' check (status in ('draft','pending','approved','rejected','paused','archived')),
  rejection_reason text,
  approved_by uuid references public.staff(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.partner_benefits is 'Beneficios que un partner ofrece a una organización específica.';

create table if not exists public.partner_benefit_redemptions (
  id uuid primary key default gen_random_uuid(),
  benefit_id uuid not null references public.partner_benefits(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  code text not null,
  status text not null default 'issued' check (status in ('issued','used','expired')),
  used_at timestamptz,
  validated_by_partner_id uuid references public.commercial_partners(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (benefit_id, client_id)
);
comment on table public.partner_benefit_redemptions is 'Canje único por cliente por beneficio. El código se valida desde la landing del partner.';

create table if not exists public.partner_magic_links (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.commercial_partners(id) on delete cascade,
  token_hash text not null unique,
  purpose text not null default 'login' check (purpose in ('invitation','login')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table public.partner_magic_links is 'Tokens de acceso para la landing de partners (invitación + re-login).';

create table if not exists public.partner_sessions (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.commercial_partners(id) on delete cascade,
  session_token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);
comment on table public.partner_sessions is 'Sesiones activas del partner. Cookie httponly partner_session almacena token raw.';

-- -------------------------------------------------------------
-- 2. Índices
-- -------------------------------------------------------------
create index if not exists idx_partner_benefits_org_status on public.partner_benefits (organization_id, status);
create index if not exists idx_partner_benefits_partner on public.partner_benefits (partner_id);
create index if not exists idx_partner_redemptions_client on public.partner_benefit_redemptions (client_id, status);
create index if not exists idx_partner_magic_links_hash on public.partner_magic_links (token_hash) where used_at is null;
create index if not exists idx_partner_sessions_hash on public.partner_sessions (session_token_hash);
create index if not exists idx_partner_org_relations_org on public.partner_org_relations (organization_id, status);

-- -------------------------------------------------------------
-- 3. Triggers: updated_at + reenter-pending
-- -------------------------------------------------------------
create or replace function public.partner_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_commercial_partners_updated on public.commercial_partners;
create trigger trg_commercial_partners_updated
  before update on public.commercial_partners
  for each row execute function public.partner_touch_updated_at();

drop trigger if exists trg_partner_benefits_updated on public.partner_benefits;
create trigger trg_partner_benefits_updated
  before update on public.partner_benefits
  for each row execute function public.partner_touch_updated_at();

-- Si se edita un beneficio aprobado en campos sensibles → vuelve a pending.
create or replace function public.partner_benefits_reenter_pending()
returns trigger language plpgsql as $$
begin
  if old.status = 'approved' and (
    new.title is distinct from old.title or
    new.discount_text is distinct from old.discount_text or
    new.terms is distinct from old.terms or
    new.description is distinct from old.description or
    new.image_url is distinct from old.image_url or
    new.valid_from is distinct from old.valid_from or
    new.valid_until is distinct from old.valid_until
  ) and new.status = old.status then
    new.status := 'pending';
    new.approved_by := null;
    new.approved_at := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_partner_benefits_reenter_pending on public.partner_benefits;
create trigger trg_partner_benefits_reenter_pending
  before update on public.partner_benefits
  for each row execute function public.partner_benefits_reenter_pending();

-- -------------------------------------------------------------
-- 4. RLS
-- -------------------------------------------------------------
alter table public.commercial_partners enable row level security;
alter table public.partner_org_relations enable row level security;
alter table public.partner_benefits enable row level security;
alter table public.partner_benefit_redemptions enable row level security;
alter table public.partner_magic_links enable row level security;
alter table public.partner_sessions enable row level security;

-- Clientes mobile pueden leer beneficios aprobados de su organización.
drop policy if exists "clients view approved benefits" on public.partner_benefits;
create policy "clients view approved benefits"
  on public.partner_benefits for select
  using (
    status = 'approved'
    and (valid_until is null or valid_until >= now())
    and (valid_from is null or valid_from <= now())
    and organization_id in (
      select c.organization_id from public.clients c
      where c.auth_user_id = auth.uid()
    )
  );

-- Clientes mobile pueden leer logo y nombre de partner (join desde benefits).
drop policy if exists "clients view partners of approved benefits" on public.commercial_partners;
create policy "clients view partners of approved benefits"
  on public.commercial_partners for select
  using (
    exists (
      select 1 from public.partner_benefits pb
      join public.clients c on c.organization_id = pb.organization_id
      where pb.partner_id = commercial_partners.id
        and pb.status = 'approved'
        and c.auth_user_id = auth.uid()
    )
  );

-- Clientes ven solo sus propios canjes.
drop policy if exists "clients view own redemptions" on public.partner_benefit_redemptions;
create policy "clients view own redemptions"
  on public.partner_benefit_redemptions for select
  using (
    client_id in (select id from public.clients where auth_user_id = auth.uid())
  );

-- -------------------------------------------------------------
-- 5. Storage bucket para imágenes
-- -------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'partner-benefits',
  'partner-benefits',
  true,
  5 * 1024 * 1024,
  array['image/png','image/jpeg','image/jpg','image/webp']
)
on conflict (id) do nothing;

-- -------------------------------------------------------------
-- 6. RPCs
-- -------------------------------------------------------------

-- Crea (o devuelve el existente) canje para el cliente autenticado.
create or replace function public.issue_benefit_redemption(p_benefit_id uuid)
returns table (redemption_id uuid, code text, status text)
language plpgsql security definer set search_path = public as $$
declare
  v_client_id uuid;
  v_valid boolean;
  v_code text;
begin
  -- Resolver cliente autenticado
  select id into v_client_id from public.clients where auth_user_id = auth.uid() limit 1;
  if v_client_id is null then
    raise exception 'client_not_found';
  end if;

  -- Validar que el beneficio esté aprobado y vigente, y pertenece a la org del cliente
  select true into v_valid
  from public.partner_benefits pb
  join public.clients c on c.id = v_client_id
  where pb.id = p_benefit_id
    and pb.organization_id = c.organization_id
    and pb.status = 'approved'
    and (pb.valid_until is null or pb.valid_until >= now())
    and (pb.valid_from is null or pb.valid_from <= now());

  if v_valid is not true then
    raise exception 'benefit_not_available';
  end if;

  -- Generar código 6 chars alfanuméricos sin O/0/I/1 para legibilidad
  v_code := upper(substr(replace(replace(replace(replace(encode(gen_random_bytes(8), 'hex'),'0',''),'o',''),'i',''),'l',''), 1, 6));
  if length(v_code) < 6 then
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  end if;

  return query
  insert into public.partner_benefit_redemptions (benefit_id, client_id, code)
  values (p_benefit_id, v_client_id, v_code)
  on conflict (benefit_id, client_id) do update
    set code = public.partner_benefit_redemptions.code
  returning id, code, status;
end $$;

grant execute on function public.issue_benefit_redemption(uuid) to anon, authenticated;

-- Validar código desde la landing del partner (usado por service-role action).
create or replace function public.validate_redemption_code(
  p_code text,
  p_partner_id uuid
)
returns table (
  success boolean,
  redemption_id uuid,
  benefit_title text,
  client_name text,
  error text
)
language plpgsql security definer set search_path = public as $$
declare
  v_redemption record;
begin
  select r.id, r.status, r.benefit_id, r.client_id, pb.title, pb.partner_id, c.name
    into v_redemption
  from public.partner_benefit_redemptions r
  join public.partner_benefits pb on pb.id = r.benefit_id
  join public.clients c on c.id = r.client_id
  where upper(r.code) = upper(p_code)
  limit 1;

  if v_redemption.id is null then
    return query select false, null::uuid, null::text, null::text, 'codigo_invalido';
    return;
  end if;

  if v_redemption.partner_id <> p_partner_id then
    return query select false, null::uuid, null::text, null::text, 'codigo_no_pertenece_al_partner';
    return;
  end if;

  if v_redemption.status = 'used' then
    return query select false, v_redemption.id, v_redemption.title::text, v_redemption.name::text, 'ya_canjeado';
    return;
  end if;

  update public.partner_benefit_redemptions
    set status = 'used',
        used_at = now(),
        validated_by_partner_id = p_partner_id
    where id = v_redemption.id;

  return query select true, v_redemption.id, v_redemption.title::text, v_redemption.name::text, null::text;
end $$;

-- No se expone a anon/authenticated: solo service role (via dashboard/landing server actions).
revoke all on function public.validate_redemption_code(text, uuid) from public;
