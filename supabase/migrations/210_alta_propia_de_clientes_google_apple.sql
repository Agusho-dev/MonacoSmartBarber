-- =============================================================================
-- 210 — La app deja de ser sólo para clientes que ya existen.
-- APLICADA EN PRODUCCIÓN el 3/9/2026.
--
-- Hasta hoy el cliente nacía SIEMPRE en la tablet del local: `client-auth`
-- contesta 404 CLIENT_NOT_FOUND si el teléfono no está en `clients`, y la app
-- muestra "¿Aún no sos cliente?". Con publicidad de por medio eso es un embudo
-- tapado, y encima es causal de rechazo en App Review: el revisor prueba con su
-- propio número, no entra, y eso se lee como una app que no funciona.
--
-- LA IDENTIDAD SIGUE SIENDO EL TELÉFONO. Google y Apple son comodidad y
-- recuperación de cuenta, no una identidad paralela: el teléfono es lo que ata
-- la cuenta con la fila del local, con WhatsApp, con los puntos y con el
-- historial, y es lo único que la tablet sabe buscar. Por eso toda cuenta nueva
-- termina con un teléfono verificado por OTP, venga de donde venga.
--
-- Y por eso la verificación del id_token de Google/Apple se hace en el SERVIDOR
-- (edge function), no con `signInWithIdToken` desde Flutter: ese camino crearía
-- un usuario de Supabase suelto —sin fila en `clients`, con un JWT válido y sin
-- `app_metadata.user_type='client'`— que después habría que fusionar a mano con
-- el usuario-alias del teléfono. Un humano, una cuenta.
-- =============================================================================

alter table public.clients add column if not exists email text;
alter table public.clients add column if not exists signup_source text;

comment on column public.clients.email is
    'Email del proveedor social, si lo hay. Puede ser un relay de Apple (@privaterelay.appleid.com), que NO sirve como canal de contacto: el canal es el teléfono.';
comment on column public.clients.signup_source is
    'Por dónde nació el cliente: kiosk | app | web | staff | import. NULL = anterior a la mig 210.';

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'clients_signup_source_check') then
        alter table public.clients add constraint clients_signup_source_check
            check (signup_source is null or signup_source in ('kiosk','app','web','staff','import'));
    end if;
end $$;

-- NO es único a propósito: dos personas de la misma familia pueden compartir un
-- email, y la unicidad tiene que seguir siendo del teléfono.
create index if not exists idx_clients_email
    on public.clients (organization_id, lower(email)) where email is not null;
create index if not exists idx_clients_signup_source
    on public.clients (organization_id, signup_source) where signup_source is not null;

-- El `subject` (claim `sub`) es el identificador estable del proveedor: el email
-- puede cambiar, el sub no. Es lo que permite el login de un toque en el segundo
-- ingreso, sin pedir el código otra vez.
create table if not exists public.client_social_identities (
    id                uuid primary key default gen_random_uuid(),
    organization_id   uuid not null references public.organizations(id) on delete cascade,
    client_id         uuid not null references public.clients(id) on delete cascade,
    provider          text not null check (provider in ('google','apple')),
    subject           text not null,
    email             text,
    -- Apple manda el nombre SÓLO en la primera autorización; si no se guarda en
    -- ese momento, no hay forma de recuperarlo.
    name              text,
    raw               jsonb,
    created_at        timestamptz not null default now(),
    last_login_at     timestamptz,
    unique (provider, subject)
);
comment on table public.client_social_identities is
    'Google/Apple vinculados a un cliente. La identidad del negocio sigue siendo el teléfono; esto es login de un toque y recuperación de cuenta.';
create index if not exists idx_csi_client on public.client_social_identities(client_id);
alter table public.client_social_identities enable row level security;
revoke all on public.client_social_identities from anon, authenticated;

-- Hay 4 organizaciones en esta base: el default es FALSE para que ninguna se
-- abra sola. Monaco se prende explícitamente.
alter table public.organizations
    add column if not exists allow_client_signup boolean not null default false;
comment on column public.organizations.allow_client_signup is
    'Si es true, client-auth deja crear cuentas nuevas desde la app en vez de contestar 404 CLIENT_NOT_FOUND.';
update public.organizations set allow_client_signup = true
 where id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

-- El bono de bienvenida se acredita de forma perezosa "en el primer contacto",
-- y uno de esos contactos es abrir la app. Con el alta cerrada eso estaba bien:
-- para tener cuenta había que haber pisado el local. Con alta propia, cualquiera
-- que instale la app y valide un teléfono cobraría puntos canjeables por cosas
-- reales sin haber sido cliente nunca. Ahora el bono ESPERA a la primera visita
-- cobrada; no se pierde, se difiere.
create or replace function public.loyalty_grant_welcome_bonus(p_client_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
DECLARE v_client clients%ROWTYPE; v_s loyalty_settings%ROWTYPE; v_state client_loyalty_state%ROWTYPE; v_tx uuid;
BEGIN
  SELECT * INTO v_client FROM clients WHERE id = p_client_id;
  IF v_client.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_s FROM loyalty_settings WHERE organization_id = v_client.organization_id;
  IF v_s.organization_id IS NULL OR NOT v_s.is_enabled OR v_s.welcome_bonus_points <= 0 THEN RETURN NULL; END IF;

  -- (mig 210) El que se registró solo desde la app o la web todavía no es
  -- cliente: el bono lo espera hasta su primera visita cobrada.
  IF v_client.signup_source IN ('app','web')
     AND NOT EXISTS (SELECT 1 FROM visits v WHERE v.client_id = p_client_id AND v.completed_at IS NOT NULL)
  THEN
    RETURN NULL;
  END IF;

  INSERT INTO client_loyalty_state (client_id, organization_id)
  VALUES (p_client_id, v_client.organization_id) ON CONFLICT (client_id) DO NOTHING;
  SELECT * INTO v_state FROM client_loyalty_state WHERE client_id = p_client_id FOR UPDATE;
  IF v_state.welcome_bonus_tx_id IS NOT NULL THEN RETURN v_state.welcome_bonus_tx_id; END IF;

  INSERT INTO point_transactions (client_id, organization_id, points, remaining, type, description, expires_at, meta)
  VALUES (p_client_id, v_client.organization_id, v_s.welcome_bonus_points, v_s.welcome_bonus_points, 'welcome_bonus',
          'Bono de bienvenida', now() + make_interval(days => v_s.points_expiry_days), '{}'::jsonb)
  RETURNING id INTO v_tx;
  UPDATE client_loyalty_state SET welcome_bonus_tx_id = v_tx, enrolled_at = COALESCE(enrolled_at, now()), updated_at = now()
   WHERE client_id = p_client_id;
  PERFORM loyalty_log_event(v_client.organization_id, p_client_id, 'welcome_bonus', NULL,
    jsonb_build_object('points', v_s.welcome_bonus_points, 'tx_id', v_tx));
  RETURN v_tx;
END; $function$;

-- "Cliente nuevo" en el programa de referidos se define por AUSENCIA DE VISITAS,
-- no por ausencia de cuenta, así que el alta propia no lo rompe: quien se
-- registra solo sigue contando como nuevo hasta su primera visita. Se deja
-- constancia para que nadie lo "arregle" al revés.
