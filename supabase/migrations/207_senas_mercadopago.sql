-- =============================================================================
-- 207_senas_mercadopago.sql — Seña del 50% para reservar turno, cobrada por
-- Mercado Pago, con una cuenta de MP por sucursal.
--
-- LA DECISIÓN QUE ORDENA TODO EL DISEÑO: la seña NO vive en `appointments`.
-- ------------------------------------------------------------------------
-- El flujo elegido por el dueño es "paga primero": el horario NO se reserva
-- mientras el cliente paga. Eso permite lo más importante de esta migración:
-- el turno se crea recién cuando el pago está acreditado, ya `confirmed`, por
-- el mismo `createAppointment` de siempre. Consecuencias:
--
--   · NO se toca `appointments_status_check` (no hace falta 'pending_payment').
--   · NO se toca la EXCLUSION GiST `appointments_no_overlap_excl`.
--   · NO hay que auditar los ~8 filtros por status repartidos en kiosko, fila,
--     panel del barbero, TV y agenda: para todos ellos un turno con seña es un
--     turno confirmado común.
--   · No existe el "turno impago inmortal": lo que expira es la intención de
--     pago (esta tabla), no un turno.
--
-- El precio a pagar es la carrera: dos personas pueden pagar el mismo horario
-- con segundos de diferencia. Se resuelve en el webhook (el segundo queda
-- `sin_cupo` y se le devuelve la plata automáticamente) y se le avisa al
-- cliente ANTES de pagar. `hold_minutes` queda como palanca para el día que el
-- dueño quiera reservar el slot durante el checkout: nace en 0 = sin reserva.
--
-- LA SEGUNDA DECISIÓN: la seña NO crea una fila en `visits`.
-- ---------------------------------------------------------
-- El flujo manual que existía (`confirmAppointmentPrepayment`) insertaba una
-- visita cerrada por el monto de la seña. Eso, con el sistema de hoy, rompe
-- seis cosas en silencio: duplica los cortes y parte al medio el ticket
-- promedio (`esCorte = service_id || queue_entry_id`), consume el tope mensual
-- de la cuenta personal de un barbero vía `transfer_logs`, genera DOS
-- comprobantes ARCA por el mismo corte (cada uno por la mitad), acredita DOS
-- lotes de puntos, falsea la tasa de retorno y abre una brecha permanente en
-- /dashboard/comprobantes.
--
-- Acá la seña es un pasivo con vida propia: entra a la contabilidad recién en
-- `completeService`, donde la visita registra el PRECIO COMPLETO (comisión,
-- puntos, ARCA y estadísticas quedan correctos por construcción) y la seña se
-- refleja como partición del cobro en `visits.prepaid_amount`. Lo único que
-- hay que restar es lo que el barbero NO recibió en el mostrador: el efectivo
-- del cierre de turno y el monto que se proyecta al ledger de cuentas.
--
-- APLICADA EN PRODUCCIÓN el 3/9/2026 en tres partes (207a tablas, 207b
-- funciones, 207c RLS y endurecimiento). Este archivo es el contenido completo.
-- Las correcciones posteriores viven en la 208 (cron de conciliación, default
-- de devolución y piso en cero del efectivo del cierre).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. La cuenta de Mercado Pago de cada sucursal
-- ─────────────────────────────────────────────────────────────────────────────
-- Una fila por (sucursal, proveedor, ambiente). Dos ambientes conviven a
-- propósito: 'prueba' es lo que usa el revisor de App Store / Play para poder
-- atravesar el flujo de pago sin plata real, y 'produccion' es lo que ve
-- cualquier cliente.
--
-- Los tokens van CIFRADOS con AES-256-GCM (`cifrarSecreto`, el mismo mecanismo
-- que protege la clave privada fiscal de ARCA, con la clave maestra en Vault).
-- Es deliberado no imitar el patrón de WhatsApp/Instagram, que guarda los
-- tokens en claro: con este token se puede cobrar y devolver plata.

create table if not exists public.branch_payment_providers (
    id                  uuid primary key default gen_random_uuid(),
    organization_id     uuid not null references public.organizations(id) on delete cascade,
    branch_id           uuid not null references public.branches(id) on delete cascade,
    provider            text not null default 'mercadopago'
                          check (provider in ('mercadopago')),
    environment         text not null default 'produccion'
                          check (environment in ('produccion', 'prueba')),

    -- 'oauth'  → el dueño apretó "Conectar Mercado Pago" y la sucursal autorizó
    --            nuestra aplicación. Hay refresh_token y el access_token vence.
    -- 'manual' → se pegaron las credenciales del panel de esa cuenta. No vencen.
    connection_mode     text not null default 'oauth'
                          check (connection_mode in ('oauth', 'manual')),

    -- `mp_user_id` es el collector_id de la cuenta: es la clave con la que se
    -- reconoce de QUÉ cuenta vino una notificación (el webhook trae `user_id`).
    mp_user_id          text,
    public_key          text,

    access_token_cifrado   text,
    refresh_token_cifrado  text,
    -- Con OAuth el secreto del webhook es UNO por aplicación (compartido por
    -- las 4 sucursales); con credenciales manuales es uno por cuenta. Por eso
    -- vive acá y no en una variable de entorno.
    webhook_secret_cifrado text,

    token_expires_at    timestamptz,
    live_mode           boolean,

    status              text not null default 'desconectado'
                          check (status in ('desconectado', 'conectado', 'error', 'revocado')),
    last_check_at       timestamptz,
    last_error          text,
    connected_at        timestamptz,
    connected_by        uuid,

    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),

    unique (branch_id, provider, environment)
);

comment on table public.branch_payment_providers is
    'Credenciales de cobro online por sucursal (Mercado Pago). Tokens cifrados con AES-256-GCM (clave maestra en Vault, misma que ARCA). Sólo service_role.';
comment on column public.branch_payment_providers.mp_user_id is
    'collector_id de la cuenta. Es el `user_id` que llega en el webhook: mapea notificación → sucursal.';

create index if not exists idx_bpp_branch on public.branch_payment_providers(branch_id);
create index if not exists idx_bpp_mp_user on public.branch_payment_providers(mp_user_id) where mp_user_id is not null;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. La configuración de la seña, POR SUCURSAL
-- ─────────────────────────────────────────────────────────────────────────────
-- Tabla propia y no columnas nuevas en `appointment_settings` por una razón
-- concreta: `getAppointmentSettings` devuelve el override de sucursal ENTERO
-- (no mergea contra la fila org-level), así que una config escrita "para la
-- organización" es invisible para Rondeau —la única sucursal que toma turnos—
-- y sí la leerían Caseros y Paraná. Acá la sucursal es la clave primaria: no
-- hay forma de prender la seña "sin querer" en las cuatro.

create table if not exists public.branch_deposit_settings (
    id                  uuid primary key default gen_random_uuid(),
    organization_id     uuid not null references public.organizations(id) on delete cascade,
    branch_id           uuid not null unique references public.branches(id) on delete cascade,

    is_enabled          boolean not null default false,
    percentage          integer not null default 50 check (percentage between 1 and 100),
    -- Si el 50% cae por debajo de esto, no se pide seña (cobrar $300 tiene
    -- más costo de fricción que valor: la comisión de MP se come el sentido).
    min_amount          numeric(12,2) not null default 0 check (min_amount >= 0),
    -- Redondeo del monto que se le muestra al cliente. 100 = "$8.000", no
    -- "$7.987,50", que es lo que sale de un 50% sobre un precio impar.
    round_to            numeric(12,2) not null default 100 check (round_to > 0),

    -- 0 = el horario NO se reserva mientras el cliente paga (decisión del
    -- dueño, 3/9/2026). Subirlo a 10 activa el hold sin tocar código.
    hold_minutes        integer not null default 0 check (hold_minutes between 0 and 120),
    -- Vigencia del link de pago (`expires` de la preferencia de MP).
    expires_minutes     integer not null default 30 check (expires_minutes between 5 and 720),

    -- true = sólo dinero en cuenta / tarjeta guardada de MP (`purpose:
    -- wallet_purchase`). Es el checkout de menor fricción para quien tiene la
    -- app de MP, pero deja afuera al invitado sin cuenta. Nace apagado.
    wallet_only         boolean not null default false,

    -- Canales donde se exige la seña. El turno que carga el staff nunca la
    -- exige (se cobra en el mostrador); puede pedirse con un link aparte.
    channels            text[] not null default array['app', 'web']::text[],

    -- Qué pasa con la plata cuando el CLIENTE cancela a tiempo.
    --   'credito'    → queda a favor del cliente para su próximo turno
    --   'devolucion' → se devuelve por Mercado Pago
    --   'ninguno'    → se pierde igual
    refund_on_early_cancel text not null default 'credito'
                          check (refund_on_early_cancel in ('credito', 'devolucion', 'ninguno')),
    -- Cancelación tardía o ausencia: la seña queda para el negocio. Es el
    -- motivo por el que la seña existe.
    forfeit_on_late_cancel boolean not null default true,

    -- Derecho de revocación del art. 1110 CCyC (contratos a distancia): es
    -- IRRENUNCIABLE y no se puede restringir por contrato (Disp. 377/2026
    -- declara abusiva la cláusula que lo limite). Se modela explícito en vez
    -- de esconderlo: dentro de esta ventana, "devolver" es un botón, no una
    -- discusión. 0 lo desactiva, pero eso es una decisión legal, no técnica.
    arrepentimiento_days integer not null default 10 check (arrepentimiento_days >= 0),

    policy_text         text,

    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

comment on table public.branch_deposit_settings is
    'Config de la seña por sucursal. Separada de appointment_settings porque getAppointmentSettings no mergea org↔sucursal y prender la seña "para la org" no la vería Rondeau.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. La seña
-- ─────────────────────────────────────────────────────────────────────────────
-- Guarda la INTENCIÓN de turno (sucursal, barbero, servicios, día y hora) para
-- poder crearlo cuando el pago se acredite. Mientras la seña está `iniciada` no
-- existe ningún turno: el horario sigue libre para todos.

create table if not exists public.booking_deposits (
    id                  uuid primary key default gen_random_uuid(),
    organization_id     uuid not null references public.organizations(id) on delete cascade,
    branch_id           uuid not null references public.branches(id) on delete cascade,
    client_id           uuid not null references public.clients(id) on delete cascade,

    -- ── Intención de turno ───────────────────────────────────────────────────
    barber_id           uuid references public.staff(id) on delete set null,
    service_ids         uuid[] not null check (array_length(service_ids, 1) >= 1),
    service_names       text,
    appointment_date    date not null,
    start_time          time not null,
    duration_minutes    integer not null check (duration_minutes > 0),

    -- ── Plata ────────────────────────────────────────────────────────────────
    service_total       numeric(12,2) not null check (service_total > 0),
    amount              numeric(12,2) not null check (amount > 0),
    currency            text not null default 'ARS',
    percentage          integer not null default 50,
    constraint booking_deposits_amount_lte_total check (amount <= service_total),

    channel             text not null default 'app'
                          check (channel in ('app', 'web', 'staff')),

    -- ── Estado ───────────────────────────────────────────────────────────────
    --   iniciada  → link de pago creado, esperando que el cliente pague
    --   pagada    → acreditada y turno creado
    --   consumida → el servicio se cobró y la seña se imputó al precio
    --   perdida   → cancelación tardía o ausencia: queda para el negocio
    --   devuelta  → se devolvió por Mercado Pago
    --   sin_cupo  → pagó pero alguien tomó el horario primero (devolución auto)
    --   rechazada / expirada / cancelada → nunca hubo plata
    status              text not null default 'iniciada'
                          check (status in ('iniciada', 'pagada', 'consumida', 'perdida',
                                            'devuelta', 'sin_cupo', 'rechazada',
                                            'expirada', 'cancelada')),

    -- ── Mercado Pago ─────────────────────────────────────────────────────────
    provider            text not null default 'mercadopago',
    environment         text not null default 'produccion'
                          check (environment in ('produccion', 'prueba')),
    mp_preference_id    text,
    mp_payment_id       text,
    mp_status           text,
    mp_status_detail    text,
    mp_payment_method_id text,
    mp_payment_type_id  text,
    mp_collector_id     text,
    -- La comisión de MP (6,29% + IVA con acreditación al instante) sale de la
    -- respuesta del pago, no se estima: es lo que separa "lo que pagó el
    -- cliente" de "lo que entró a la cuenta".
    mp_fee              numeric(12,2),
    mp_net_amount       numeric(12,2),
    mp_money_release_date timestamptz,
    init_point          text,

    expires_at          timestamptz not null,
    -- Sólo se usa si branch_deposit_settings.hold_minutes > 0. Con 0 queda NULL
    -- y el motor de disponibilidad ni lo mira.
    hold_until          timestamptz,
    paid_at             timestamptz,

    -- ── Resultado ────────────────────────────────────────────────────────────
    appointment_id      uuid references public.appointments(id) on delete set null,
    consumed_at         timestamptz,
    refunded_at         timestamptz,
    refunded_amount     numeric(12,2),
    refund_reason       text,
    refunded_by         uuid,
    mp_refund_id        text,

    failure_reason      text,
    raw                 jsonb,

    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

comment on table public.booking_deposits is
    'Seña de un turno. Guarda la intención de reserva: el turno se crea recién cuando el pago se acredita (webhook). NO genera visits: la plata entra a la contabilidad en completeService vía visits.prepaid_amount.';

-- Un pago de MP respalda UNA sola seña. Es el candado real de idempotencia del
-- webhook: MP reintenta cada 15 minutos hasta recibir un 200.
create unique index if not exists idx_booking_deposits_mp_payment
    on public.booking_deposits(mp_payment_id)
    where mp_payment_id is not null;

-- Un doble tap en "Pagar seña" no puede abrir dos checkouts para el mismo
-- horario. El código reusa la seña `iniciada` que no venció.
create unique index if not exists idx_booking_deposits_intento_unico
    on public.booking_deposits(client_id, branch_id, appointment_date, start_time)
    where status = 'iniciada';

-- Un turno tiene a lo sumo UNA seña viva.
create unique index if not exists idx_booking_deposits_una_por_turno
    on public.booking_deposits(appointment_id)
    where appointment_id is not null
      and status in ('pagada', 'consumida');

create index if not exists idx_booking_deposits_vencimiento
    on public.booking_deposits(expires_at)
    where status = 'iniciada';
create index if not exists idx_booking_deposits_branch_status
    on public.booking_deposits(branch_id, status, created_at desc);
create index if not exists idx_booking_deposits_client
    on public.booking_deposits(client_id, created_at desc);
create index if not exists idx_booking_deposits_slot
    on public.booking_deposits(branch_id, appointment_date, start_time)
    where status in ('iniciada', 'pagada');


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Auditoría e idempotencia de webhooks
-- ─────────────────────────────────────────────────────────────────────────────
-- `billing_events` (el webhook de suscripciones SaaS) no sirve: no tiene dónde
-- guardar sucursal ni turno, y nunca procesó un evento real en producción.

create table if not exists public.payment_webhook_events (
    id                  uuid primary key default gen_random_uuid(),
    provider            text not null default 'mercadopago',
    branch_id           uuid references public.branches(id) on delete set null,
    event_type          text,
    action              text,
    resource_id         text not null,
    request_id          text,
    mp_user_id          text,
    signature_ok        boolean not null default false,
    payload             jsonb,
    received_at         timestamptz not null default now(),
    processed_at        timestamptz,
    error               text
);

comment on table public.payment_webhook_events is
    'Toda notificación recibida, válida o no. Es el registro que permite contestar "¿MP nos avisó?" sin reproducir un pago.';

create index if not exists idx_pwe_resource on public.payment_webhook_events(provider, resource_id, received_at desc);
create index if not exists idx_pwe_pendientes on public.payment_webhook_events(received_at desc) where processed_at is null;
-- Dedup de reintentos: MP repite el mismo x-request-id al reintentar.
create unique index if not exists idx_pwe_request
    on public.payment_webhook_events(provider, request_id)
    where request_id is not null;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Estados de OAuth (anti-CSRF de la vinculación)
-- ─────────────────────────────────────────────────────────────────────────────
-- El `redirect_uri` de MP tiene que ser ESTÁTICO y coincidir exactamente con lo
-- configurado en el panel: no se le puede colgar ?branch=. La sucursal viaja en
-- `state`, y de ahí sale esta tabla.

create table if not exists public.payment_oauth_states (
    state               text primary key,
    organization_id     uuid not null references public.organizations(id) on delete cascade,
    branch_id           uuid not null references public.branches(id) on delete cascade,
    provider            text not null default 'mercadopago',
    environment         text not null default 'produccion',
    code_verifier       text,
    created_by          uuid,
    expires_at          timestamptz not null,
    used_at             timestamptz,
    created_at          timestamptz not null default now()
);


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. La partición del cobro en `visits`
-- ─────────────────────────────────────────────────────────────────────────────
-- `amount` sigue siendo el PRECIO COMPLETO del servicio. `prepaid_amount` dice
-- cuánto de eso ya había entrado por Mercado Pago antes del corte.
--
-- Netear `amount` (que es lo que hace hoy el bloque 3.6 de queue.ts para el
-- prepago manual) sería más simple y está mal: subdeclara ARCA, parte el ticket
-- promedio, y le da al cliente la mitad de los puntos que le corresponden.

alter table public.visits
    add column if not exists prepaid_amount numeric(12,2) not null default 0;
alter table public.visits
    add column if not exists deposit_id uuid references public.booking_deposits(id) on delete set null;

comment on column public.visits.prepaid_amount is
    'Parte del `amount` que ya se había cobrado por adelantado (seña de Mercado Pago). El barbero cobró en el mostrador `amount - prepaid_amount`.';

create index if not exists idx_visits_deposit on public.visits(deposit_id) where deposit_id is not null;


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Lo que hay que restar: efectivo del cierre y ledger de cuentas
-- ─────────────────────────────────────────────────────────────────────────────

-- 7.a `transfer_logs` es el ledger de lo que ENTRÓ a una cuenta de cobro. Si el
--     cliente ya había pagado la mitad por MP, a la cuenta del barbero entró
--     sólo el remanente. Sin esto, la seña consumiría el tope mensual de una
--     cuenta personal que nunca la recibió, y adelantaría la rotación de alias.
--
--     Copia textual del cuerpo vivo con UN cambio: el monto proyectado.
create or replace function public.fn_sync_transfer_log_from_visit()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_tip       NUMERIC(12,2);
  v_acct_org  UUID;
  v_visit_org UUID;
  v_amount    NUMERIC(12,2);
BEGIN
  IF NEW.payment_method::text = 'transfer' AND NEW.payment_account_id IS NOT NULL THEN

    SELECT br.organization_id
      INTO v_acct_org
      FROM payment_accounts pa
      JOIN branches br ON br.id = pa.branch_id
     WHERE pa.id = NEW.payment_account_id;

    IF v_acct_org IS NULL THEN
      RAISE EXCEPTION 'La cuenta de cobro % no existe', NEW.payment_account_id;
    END IF;

    v_visit_org := COALESCE(
      NEW.organization_id,
      (SELECT br.organization_id FROM branches br WHERE br.id = NEW.branch_id)
    );

    IF v_visit_org IS DISTINCT FROM v_acct_org THEN
      RAISE EXCEPTION 'La cuenta de cobro pertenece a otra organización';
    END IF;

    v_tip := CASE
               WHEN NEW.tip_payment_method = 'transfer' THEN COALESCE(NEW.tip_amount, 0)
               ELSE 0
             END;

    -- ÚNICO CAMBIO (mig 207): a esta cuenta entró el remanente, no el precio
    -- de lista. La seña ya cayó en la cuenta de Mercado Pago de la sucursal.
    v_amount := GREATEST(COALESCE(NEW.amount, 0) - COALESCE(NEW.prepaid_amount, 0), 0);

    INSERT INTO transfer_logs (visit_id, payment_account_id, amount, tip_amount, branch_id, transferred_at)
    VALUES (
      NEW.id,
      NEW.payment_account_id,
      v_amount,
      v_tip,
      NEW.branch_id,
      COALESCE(NEW.completed_at, now())
    )
    ON CONFLICT (visit_id) WHERE visit_id IS NOT NULL
    DO UPDATE SET
      payment_account_id = EXCLUDED.payment_account_id,
      amount             = EXCLUDED.amount,
      tip_amount         = EXCLUDED.tip_amount,
      branch_id          = EXCLUDED.branch_id;
  ELSE
    DELETE FROM transfer_logs WHERE visit_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$function$;

-- El trigger tiene que despertarse también cuando cambia `prepaid_amount`.
drop trigger if exists trg_visits_sync_transfer_log on public.visits;
create trigger trg_visits_sync_transfer_log
    after insert or update of payment_method, payment_account_id, amount, prepaid_amount,
                              tip_amount, tip_payment_method, branch_id, completed_at
    on public.visits
    for each row execute function public.fn_sync_transfer_log_from_visit();


-- 7.b El cierre de turno le pide al barbero rendir el efectivo que tiene en la
--     mano. La seña nunca pasó por su caja: sin restarla, le falta plata todos
--     los días y la diferencia queda registrada como faltante suyo.
--
--     Copia textual del cuerpo vivo (devuelve shift_closes, hace el clock_out
--     automático, usa `tips_total` y `breakdown`) con UN cambio: los tres
--     totales por medio de pago se miden netos de la seña. `total_revenue`
--     sigue siendo la venta completa: es facturación, no caja.
create or replace function public.close_barber_shift(
    p_staff_id uuid,
    p_branch_id uuid,
    p_cash_counted numeric DEFAULT NULL::numeric,
    p_notes text DEFAULT NULL::text
)
 returns shift_closes
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_tz text;
  v_org_id uuid;
  v_default_opening numeric;
  v_date date;
  v_day_start timestamptz;
  v_summary record;
  v_existing record;
  v_opening_cash numeric;
  v_cash_expected numeric;
  v_cash_diff numeric;
  v_breakdown jsonb;
  v_result public.shift_closes%ROWTYPE;
  v_last_action text;
  v_final_counted numeric;
BEGIN
  SELECT timezone, organization_id, default_opening_cash
    INTO v_tz, v_org_id, v_default_opening
  FROM public.branches WHERE id = p_branch_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Sucursal no encontrada';
  END IF;

  v_tz := COALESCE(v_tz, 'America/Argentina/Buenos_Aires');
  v_date := (now() AT TIME ZONE v_tz)::date;
  v_day_start := (v_date::timestamp AT TIME ZONE v_tz);

  SELECT
    COUNT(*)::int AS cuts,
    COALESCE(SUM(amount), 0)::numeric AS revenue,
    COALESCE(SUM(commission_amount), 0)::numeric AS commission,
    COALESCE(SUM(tip_amount), 0)::numeric AS tips,
    -- (mig 207) netos de la seña: es lo que el barbero recibió en el mostrador.
    COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN amount - COALESCE(prepaid_amount, 0) ELSE 0 END), 0)::numeric AS cash_total,
    COALESCE(SUM(CASE WHEN payment_method = 'transfer' THEN amount - COALESCE(prepaid_amount, 0) ELSE 0 END), 0)::numeric AS transfer_total,
    COALESCE(SUM(CASE WHEN payment_method = 'card' THEN amount - COALESCE(prepaid_amount, 0) ELSE 0 END), 0)::numeric AS card_total,
    COALESCE(SUM(CASE WHEN tip_payment_method = 'cash' THEN tip_amount ELSE 0 END), 0)::numeric AS tips_cash,
    COALESCE(SUM(COALESCE(prepaid_amount, 0)), 0)::numeric AS prepaid_total
  INTO v_summary
  FROM public.visits
  WHERE barber_id = p_staff_id
    AND branch_id = p_branch_id
    AND (completed_at AT TIME ZONE v_tz)::date = v_date;

  SELECT opening_cash, cash_counted INTO v_existing
  FROM public.shift_closes
  WHERE staff_id = p_staff_id AND branch_id = p_branch_id AND local_date = v_date;

  v_opening_cash := COALESCE(v_existing.opening_cash, COALESCE(v_default_opening, 0));
  v_final_counted := COALESCE(p_cash_counted, v_existing.cash_counted);

  v_cash_expected := v_opening_cash + v_summary.cash_total + v_summary.tips_cash;
  v_cash_diff := CASE WHEN v_final_counted IS NULL THEN NULL ELSE v_final_counted - v_cash_expected END;

  v_breakdown := jsonb_build_object(
    'opening_cash', v_opening_cash,
    'cash_total', v_summary.cash_total,
    'transfer_total', v_summary.transfer_total,
    'card_total', v_summary.card_total,
    'tips_cash', v_summary.tips_cash,
    'prepaid_total', v_summary.prepaid_total
  );

  INSERT INTO public.shift_closes (
    organization_id, branch_id, staff_id, local_date,
    total_cuts, total_revenue, total_commission, tips_total,
    opening_cash, cash_expected, cash_counted, cash_diff,
    breakdown, notes
  )
  VALUES (
    v_org_id, p_branch_id, p_staff_id, v_date,
    v_summary.cuts, v_summary.revenue, v_summary.commission, v_summary.tips,
    v_opening_cash, v_cash_expected, v_final_counted, v_cash_diff,
    v_breakdown, p_notes
  )
  ON CONFLICT (staff_id, branch_id, local_date) DO UPDATE
  SET
    total_cuts = EXCLUDED.total_cuts,
    total_revenue = EXCLUDED.total_revenue,
    total_commission = EXCLUDED.total_commission,
    tips_total = EXCLUDED.tips_total,
    opening_cash = EXCLUDED.opening_cash,
    cash_expected = EXCLUDED.cash_expected,
    cash_counted = EXCLUDED.cash_counted,
    cash_diff = EXCLUDED.cash_diff,
    breakdown = EXCLUDED.breakdown,
    notes = COALESCE(EXCLUDED.notes, public.shift_closes.notes),
    closed_at = now()
  RETURNING * INTO v_result;

  SELECT action_type INTO v_last_action
  FROM public.attendance_logs
  WHERE staff_id = p_staff_id
    AND recorded_at >= v_day_start
  ORDER BY recorded_at DESC
  LIMIT 1;

  IF v_last_action = 'clock_in' THEN
    INSERT INTO public.attendance_logs (staff_id, branch_id, action_type, face_verified)
    VALUES (p_staff_id, p_branch_id, 'clock_out', false);
  END IF;

  RETURN v_result;
END;
$function$;


-- 7.c Vencimiento de señas impagas: SQL puro, sin HTTP. Un turno impago no
--     existe (nunca se creó), así que expirar es sólo cerrar la intención de
--     pago. Lo dispara el job `expire-booking-deposits` cada 2 minutos.
create or replace function public.expire_booking_deposits()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.booking_deposits
     SET status = 'expirada',
         failure_reason = COALESCE(failure_reason, 'Venció el link de pago sin acreditarse'),
         updated_at = now()
   WHERE status = 'iniciada'
     AND expires_at < now() - interval '2 minutes';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
revoke execute on function public.expire_booking_deposits() from public, anon, authenticated;
grant execute on function public.expire_booking_deposits() to service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 8. RLS
-- ─────────────────────────────────────────────────────────────────────────────
-- Las tablas con tokens y las de auditoría son sólo `service_role`: RLS
-- prendida y CERO policies, igual que las cinco tablas de ARCA.

alter table public.branch_payment_providers  enable row level security;
alter table public.branch_deposit_settings   enable row level security;
alter table public.payment_webhook_events    enable row level security;
alter table public.payment_oauth_states      enable row level security;
alter table public.booking_deposits          enable row level security;

revoke all on public.branch_payment_providers  from anon, authenticated;
revoke all on public.branch_deposit_settings   from anon, authenticated;
revoke all on public.payment_webhook_events    from anon, authenticated;
revoke all on public.payment_oauth_states      from anon, authenticated;

-- La app SÍ tiene que poder ver su propia seña: es lo que le permite mostrar
-- "confirmando tu pago…" y actualizarse sola por Realtime. Lectura y nada más.
revoke all on public.booking_deposits from anon, authenticated;
grant select on public.booking_deposits to authenticated;

drop policy if exists booking_deposits_select_own_client on public.booking_deposits;
create policy booking_deposits_select_own_client
    on public.booking_deposits for select
    to authenticated
    using (client_id = public.current_client_id());


-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Realtime
-- ─────────────────────────────────────────────────────────────────────────────
-- Tabla de bajísima frecuencia (una fila por intento de reserva) y el cliente
-- se suscribe filtrado por su propia fila, contenido además por la policy de
-- arriba. No es el caso del Known Risk #9 (attendance_logs/break_requests).
do $$
begin
    if not exists (
        select 1 from pg_publication_tables
         where pubname = 'supabase_realtime'
           and schemaname = 'public'
           and tablename = 'booking_deposits'
    ) then
        alter publication supabase_realtime add table public.booking_deposits;
    end if;
end $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Endurecimiento de `appointments` (cierra la puerta por la que se podía
--     marcar una seña como cobrada sin pagarla)
-- ─────────────────────────────────────────────────────────────────────────────
-- `appointments_org` era una policy ALL para el rol `public` con
-- `organization_id = get_user_org_id()`: cualquier staff logueado podía hacer
-- `PATCH /rest/v1/appointments {"payment_status":"paid"}` con la anon key y
-- saltear todas las server actions. Con seña eso es plata.
--
-- Todas las escrituras del sistema pasan por server actions con service role
-- (verificado: 29 usos de createAdminClient en appointments.ts, cero
-- `.from('appointments')` con el cliente del browser), así que revocar no
-- rompe ningún camino vivo. Es el mismo criterio de la mig 204.

drop policy if exists appointments_org on public.appointments;
create policy appointments_read_org
    on public.appointments for select
    using (organization_id = public.get_user_org_id());

drop policy if exists appt_settings_org on public.appointment_settings;
create policy appt_settings_read_org
    on public.appointment_settings for select
    using (organization_id = public.get_user_org_id());

revoke insert, update, delete on public.appointments        from anon, authenticated;
revoke insert, update, delete on public.appointment_settings from anon, authenticated;

-- `cancel_appointment_by_token` tenía EXECUTE para `anon` y CERO call-sites en
-- los dos repos (la app cancela por POST /api/mobile/turnos/cancel desde el
-- 20/ago). Con el UUID del turno —que viaja al browser en la agenda— o con el
-- token, un anónimo podía cancelar salteando toda la lógica de retención de la
-- seña. El camino TS sigue siendo el único.
revoke execute on function public.cancel_appointment_by_token(p_token text) from anon;


-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Bug vivo, no relacionado con la seña pero que la seña necesita resuelto
-- ─────────────────────────────────────────────────────────────────────────────
-- Rondeau —la única sucursal que toma turnos— tiene su fila branch-level de
-- `appointment_settings` con los tres templates en NULL, y
-- `getAppointmentSettings` devuelve el override ENTERO sin mergear contra la
-- fila org-level (que sí los tiene). Resultado: hoy no sale ni una confirmación
-- ni una cancelación por WhatsApp. Con seña eso sería peor: el cliente paga y
-- no recibe nada.
--
-- El merge se agrega en TypeScript; acá se repara el dato, que es lo que
-- destraba las sucursales ya cargadas.
update public.appointment_settings s
   set confirmation_template_id  = coalesce(s.confirmation_template_id,  org.confirmation_template_id),
       reminder_template_id      = coalesce(s.reminder_template_id,      org.reminder_template_id),
       cancellation_template_id  = coalesce(s.cancellation_template_id,  org.cancellation_template_id),
       reschedule_template_id    = coalesce(s.reschedule_template_id,    org.reschedule_template_id),
       waitlist_template_id      = coalesce(s.waitlist_template_id,      org.waitlist_template_id),
       payment_request_template_id = coalesce(s.payment_request_template_id, org.payment_request_template_id),
       updated_at = now()
  from public.appointment_settings org
 where s.branch_id is not null
   and org.organization_id = s.organization_id
   and org.branch_id is null
   and (s.confirmation_template_id is null or s.cancellation_template_id is null
        or s.reminder_template_id is null or s.reschedule_template_id is null);


-- ─────────────────────────────────────────────────────────────────────────────
-- 12. updated_at
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.fn_touch_updated_at()
returns trigger language plpgsql as $$
begin
    NEW.updated_at := now();
    return NEW;
end $$;

drop trigger if exists trg_bpp_touch on public.branch_payment_providers;
create trigger trg_bpp_touch before update on public.branch_payment_providers
    for each row execute function public.fn_touch_updated_at();

drop trigger if exists trg_bds_touch on public.branch_deposit_settings;
create trigger trg_bds_touch before update on public.branch_deposit_settings
    for each row execute function public.fn_touch_updated_at();

drop trigger if exists trg_bd_touch on public.booking_deposits;
create trigger trg_bd_touch before update on public.booking_deposits
    for each row execute function public.fn_touch_updated_at();
