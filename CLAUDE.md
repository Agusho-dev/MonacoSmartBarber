# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Monaco Smart Barber dashboard — internal web app for barber shop management. Built with Next.js 16 (App Router) + Supabase + TypeScript + Tailwind CSS v4. Shares a Supabase backend with the Flutter mobile app at `../Monaco-mobile`.

## Commands

```bash
npm run dev      # Start dev server (port 3000)
npm run build    # Production build
npm run lint     # ESLint
npm start        # Run production build
```

No test framework is configured. Database migrations are applied with `supabase db push`. Edge functions are deployed with `supabase functions deploy <name>`.

## Architecture

### Three distinct user interfaces, one app

| Interface | Route prefix | Auth method | Layout |
|---|---|---|---|
| Admin dashboard | `/dashboard/*` | Supabase Auth (email+password) | Sidebar shell |
| Barber panel | `/barbero/*` | PIN → cookie (`barber_session`) | Dark theme, wake-lock |
| Check-in kiosk | `/(tablet)/checkin` | Public (branch selection) | Fullscreen tablet |
| TV display | `/tv` | Public | Queue monitor |
| Review page | `/review/[token]` | Public token | Standalone |

### Data flow pattern

Pages are **server components** that fetch data via Supabase server client → pass props to **client components** (`'use client'`) for interactivity. Mutations go through **server actions** in `src/lib/actions/`.

### Supabase clients

- `src/lib/supabase/client.ts` — browser client (SSR-safe via `@supabase/ssr`)
- `src/lib/supabase/server.ts` — server client + `createAdminClient()` (service role, bypasses RLS)

The dashboard uses `createAdminClient()` for most server-side data fetching, so RLS policies primarily affect the mobile app and public routes.

### Key directories

```
src/
├── app/                    # Next.js App Router pages
├── components/
│   ├── ui/                 # shadcn/ui primitives
│   ├── dashboard/          # Admin dashboard components
│   ├── barber/             # Barber panel components
│   └── checkin/            # Check-in kiosk components
├── lib/
│   ├── actions/            # Server actions (~35 files, one per domain)
│   ├── supabase/           # Supabase client factories
│   ├── types/database.ts   # All TypeScript interfaces for DB tables
│   ├── permissions.ts      # Role-based permission checks
│   ├── format.ts           # Currency (ARS), date, datetime formatters
│   ├── time-utils.ts       # Timezone/local time helpers
│   └── utils.ts            # cn() helper (clsx + tailwind-merge)
└── stores/
    └── branch-store.ts     # Zustand store for branch filtering
```

### Multi-tenant organizations

Migrations 047+ added a multi-org layer. Each barber shop is an `organizations` row. Staff belong to an org via `organization_id` on the `staff` table; owners/admins can also belong via `organization_members`. `getCurrentOrgId()` in `src/lib/actions/org.ts` resolves the active org from the session cookie. The dashboard layout (`src/app/dashboard/layout.tsx`) uses this to scope all queries.

Role-based access also supports per-branch scoping via the `role_branch_scope` table — non-owner roles can be restricted to specific branch IDs.

### Messaging integrations

Los webhooks inbound de Meta (WhatsApp Cloud API + Instagram) los manejan los **route handlers de Next.js** en `src/app/api/webhooks/whatsapp/route.ts` e `src/app/api/webhooks/instagram/route.ts` (ahí corre el workflow-engine). La edge function `supabase/functions/wa-incoming/` es el path del microservicio **Baileys (no oficial)** y la edge function `meta-webhook` es un handler Meta **legacy** — ninguno de los dos dispara el workflow-engine; ambos están deployados pero NO son el path activo (Meta apunta a las rutas Next.js). `supabase/functions/process-scheduled-messages/` envía los mensajes programados/difusiones/post-servicio en un cron. Server actions for messaging live in `src/lib/actions/messaging.ts`, `whatsapp-meta.ts`, `instagram-meta.ts`, `conversations.ts`, and `tags.ts`.

### El inbox pagina: PostgREST corta en 1000 filas

`/dashboard/mensajeria` pedía las conversaciones con un SELECT **sin `.limit()`** y se comía en silencio el `max-rows` de PostgREST (1000). Con 6.367 conversaciones el inbox mostraba sólo las 1000 más recientes —los últimos 10 días de 5 meses— y el buscador filtraba **en el cliente** sobre ese array: buscar a alguien que escribió en junio no devolvía nada, y no había forma de llegar a esa conversación desde la UI.

- La primera página va con `.limit(INBOX_PAGE_SIZE)` (`src/lib/inbox.ts`) explícito, y el resto llega por `loadMoreConversations` con **keyset** sobre `last_message_at` (no `.range(offset)`: en un inbox cada mensaje nuevo empuja su conversación al tope y las páginas por offset se solapan y saltean filas).
- El buscador llama a `searchConversations` → RPC `search_conversations` (mig 195), que consulta la tabla entera con la misma tolerancia que `/dashboard/clientes` (acentos plegados, tokens en cualquier orden, teléfono normalizado) y busca también por `platform_user_name`/`platform_user_id`, porque **una conversación puede no tener `client_id`**. El filtro local se conserva para que escribir se sienta instantáneo, y los dos conjuntos se mezclan.
- **Una conversación abierta desde la búsqueda se ADOPTA en `conversations`.** Todos los handlers de Realtime y el "marcar leído" actualizan con `.map()` sobre ese array: sin adoptarla, la conversación quedaba muda en la lista (el badge no se limpiaba, un mensaje nuevo no la movía). La adopción vive en el `useEffect([activeConv])`, no en el canal de Realtime — ese no se toca.
- **Regla general: cualquier lista que pueda pasar de 1000 filas necesita `.limit()` explícito y paginación.** Sin `.limit()` no hay error ni aviso; simplemente faltan datos. `content-range` en la respuesta lo delata (`0-999/6367`).

### Channels org-scope (migración 103)

`social_channels` es **org-scope**: un canal puede tener `branch_id=NULL` (default org-wide) o un `branch_id` específico (legacy/exclusivo de sucursal). Para resolver canales WhatsApp de una org, usar siempre `.eq('organization_id', orgId)` — **nunca** `.in('branch_id', branchIds)`, porque eso excluye los canales org-wide. Saltarse esta regla rompió todo el flujo de reseñas entre 21/abr y 22/abr 2026 (templates llegaban a Meta pero no se registraban en `messages` ni se creaba `workflow_execution`).

### Post-service automation flow

Cuando una visita se completa (`queue.ts → completeService`; **`completeVisit()` no existe** — la visita la inserta el trigger `on_queue_completed` y `completeService` la UPDATE-a), el sistema busca `automation_workflows` con `trigger_type='post_service'` activos para esa org+sucursal y programa un `scheduled_messages` por workflow matching. El cron `process-scheduled-messages` (corre cada minuto vía pg_cron) hace 3 cosas: envía el template a Meta Cloud API, inserta el mensaje en `messages` (para el inbox), y crea la `workflow_execution` apuntando al siguiente nodo del workflow (status `waiting_reply`). Cuando el cliente responde al template, `/api/webhooks/whatsapp` resuelve la execution activa y avanza al nodo según `condition_value`.

`overlap_policy='skip_if_active'` en `automation_workflows`: `queue.ts` chequea antes de encolar si ya hay un `scheduled_message` pending o una `workflow_execution` activa para ese cliente+workflow, y si hay, no re-encola.

Patrón obligatorio en edge functions: siempre chequear `error` de cada `.insert()/.update()`. Sin eso, fallos silenciosos como el bug de migración 103 son imposibles de detectar desde logs.

### Realtime

Supabase Realtime WebSocket subscriptions on `queue_entries` and `staff` power the live queue in the barber panel and TV display.

### Turnos ↔ fila

El sistema de turnos y su convivencia con la fila están documentados en detalle en el `CLAUDE.md` de la raíz del monorepo (`../CLAUDE.md`), sección "Sistema de turnos (migración 119+, refundado en la 168)". Lo mínimo que hay que saber antes de tocar cualquiera de los dos:

- Al hacer check-in, el turno entra a la fila con **`priority_order` = la hora del turno**, no la de llegada. Es la clave de toda la precedencia.
- `claim_next_for_barber` tiene dos caminos propios para turnos; el FIFO walk-in quedó intacto (sigue filtrando `is_appointment = false`).
- `position` **no ordena nada** (no es único, se recicla, tiene carrera). Todo lo que ordena de verdad usa `priority_order`.
- Las tarjetas de turno no se arrastran desde `/dashboard/fila`: el drag reescribe `priority_order` sintético y le pisaría la hora reservada.

### Programa de fidelización (migraciones 196–206)

La lógica (categorías por frecuencia, lotes de puntos FEFO, canje, referidos, cron) vive en la base y está documentada en el `CLAUDE.md` de la raíz, sección "Programa de fidelización". Lo que hay que saber de este repo:

- **`/dashboard/fidelizacion`** (`src/app/dashboard/fidelizacion/`, gate `rewards.view` / mutaciones `rewards.manage`; ítem "Fidelización" del sidebar). Sub-navegación por `?tab=`: Resumen (interruptor del programa + tarjetas de categoría + KPIs + eventos) · Categorías (slider de 3 manijas para los umbrales + **simulador en vivo** con `loyalty_preview_distribution`) · Puntos (parámetros + calculadora de ejemplo + qué servicios cuentan como visita) · Premios (grilla + vista escalera + editor completo con subida de imagen) · Referidos · Notificaciones (12 reglas con vista previa tipo teléfono) · Clientes (ficha con lotes, beneficios, referidos, historial; ajustar puntos, cancelar beneficio, revertir visita, canjear en nombre del cliente). Server actions en `src/lib/actions/loyalty.ts` (22), tipos en `src/lib/types/loyalty.ts`. Las tablas `loyalty_*` **no tienen policies de staff**: todo va por `createAdminClient()` + `getCurrentOrgId()` + `currentUserCan(...)`, y cada id que llega del cliente se verifica contra la org antes de la RPC.
- La pestaña **Premios de `/dashboard/app-movil` se reemplazó** por un enlace a Fidelización → Premios (el `CatalogoTab` que escribía `reward_catalog` desde el browser se borró). `reward_catalog` se escribe con `organization_id` explícito: el trigger `set_org_from_session` falla con service role si va NULL.
- `runLoyaltyMaintenanceNow` corre `loyalty_daily_maintenance()`, que es **global** (todas las orgs), igual que el cron.
- **Cobro en la tablet:** un solo escáner (`CouponScanDialog`, `validateBenefitQrForCheckout` en `rewards.ts`) acepta el QR de un beneficio (`client_rewards.qr_code`, 32 hex) y el de una invitación (`MNC-REF:<código>`). `completeService` los distingue por prefijo en el bloque 4.5 (`redeem_coupon_for_visit` vs `apply_referral_for_visit`), al cierre llama `loyalty_finalize_visit` (try/catch: nunca rompe el cobro) y devuelve `loyalty` con puntos ganados / categoría / cambio, que la tablet muestra en `LoyaltyResultCard` (hospedada **global** vía store + `LoyaltyResultHost` en los layouts, porque `/dashboard/fila` y `barber-timeline` desmontan el diálogo al terminar). `COUPONS_ENABLED` volvió a `true`. Merch/especial no descuentan: se marcan entregados en el mismo cobro. La fila muestra la categoría del cliente (`loyalty:client_loyalty_state(total_visits, tier_code, visits_in_window)` + `loyalty_tiers`, de lectura pública para el rol anon de la tablet) **sólo si el programa está encendido** (`src/app/barbero/fila/page.tsx` lee `loyalty_settings.is_enabled` con service role y se lo pasa al panel); nunca `visits(count)` (Known Risk #10). Un premio acotado a un servicio que no está en el cobro se muestra en ámbar y NO se manda a la RPC (no se consume); los **homónimos de otra sucursal cuentan como el mismo servicio** (migs 205/206: `norm_text(btrim(…))` en la RPC, `servicioQueMatcheaBeneficio` en la previa — misma prioridad: id exacto → principal → extras) y la base del descuento es el precio local. `isRewardClaim` ya no existe en `completeService`: el canje en el local va por las RPC del programa. "Entregar premio" en la fila abre el mismo escáner en modo entrega (`deliverRewardByQr` → `deliver_reward_by_qr`) para merch/especial sin cobro.
- `createManualVisit` también llama `loyalty_finalize_visit`; la edición del historial desde el browser dispara el trigger igual (UPDATE de `amount`).
- `supabase/functions/send-push/index.ts` (v4) reutiliza `data.inbox_notification_id`: la bandeja del programa la escribe `loyalty_notify` en SQL, siempre.
- **`point_transactions`/`client_rewards`/`client_loyalty_state` se escriben ÚNICAMENTE por RPC o service_role** (mig 204): no queda ninguna policy de escritura. `on_queue_completed` ya no acredita puntos (`rewards_config` y `services.points_per_service` quedaron inertes; la pestaña Puntos de `/dashboard/app-movil` configura un sistema muerto).
- **`barber_session` va firmada** (`src/lib/barber-cookie.ts`, HMAC con `BARBER_SESSION_SECRET` o fallback a la service role key) y `active_organization` se valida contra el JWT o una fila real de la org antes de usarse (`org.ts`). Ningún lector hace `JSON.parse` crudo de esa cookie.

### Cuentas de cobro: tope mensual y rotación (migración 160+)

Los cobros por transferencia entran a cuentas bancarias personales de los barberos (`payment_accounts`), cada una con `monthly_limit` (tope de acreditaciones del mes). El cobro va a la **primera cuenta activa por `sort_order` que no llegó al tope**, y el sistema rota solo cuando se llena.

- **`transfer_logs` es una proyección de `visits` mantenida por trigger** (`trg_visits_sync_transfer_log`). NO escribir el ledger a mano: cualquier escritura sobre `visits` (incluida la edición del historial, que va DIRECTO desde el browser) lo sincroniza. FK `visit_id` en `ON DELETE CASCADE`.
- Ingreso real de la cuenta = `amount + tip_amount` (la propina transferida entra a la misma cuenta; `amount` queda como la facturación que concilia caja y comprobantes).
- El tope lo consumen **sólo las acreditaciones**. Sueldos/gastos pagados desde la cuenta bajan el saldo (`expense_tickets`), no el tope.
- El acumulado **se deriva** de `transfer_logs` vía `get_transfer_accounts_state(branch)` (grant a `anon`: el panel del barbero se autentica por PIN) y `get_payment_accounts_month_income(branch_ids[])`. No hay contador denormalizado: el viejo (`accumulated_today` + `increment_account_accumulated`) nunca escribió un peso —la RPC fallaba con 42702— y por eso la rotación nunca funcionó.
- Regla de rotación única: `src/lib/payment-accounts.ts → pickTransferAccount()`, compartida por tablet y dashboard.

### Edge Functions

`supabase/functions/` contains three Deno functions:
- `wa-incoming` — inbound webhook del microservicio Baileys (no oficial, API-key auth). NO es el path Meta activo (ver arriba); legacy/sin uso si solo se usa Meta Cloud API
- `process-scheduled-messages` — cron-triggered outbound message sender
- `client-auth` — mobile app client authentication

### Cron jobs

**No usar CRON_SECRET ni `vercel.json` crons en este proyecto.** El plan Vercel Hobby limita crons a 2 entradas con schedule diario y romper esos límites bloquea los deploys. Mantener `vercel.json` como `{}`.

Los crons se disparan desde **pg_cron en Supabase** (ver migración 087) haciendo un HTTP request al route handler correspondiente en `/api/cron/*`. Las rutas deben ser **idempotentes** (safe de ejecutar más de una vez y safe de ser hit manualmente, porque no hay auth). Los crons existentes en `/api/cron/auto-clockout` y `/api/cron/process-appointments` todavía referencian `CRON_SECRET` por legacy, pero las rutas nuevas no deben agregar esa validación.

## Conventions

- **Language**: UI text and code comments in Spanish
- **Path alias**: `@/*` maps to `./src/*`
- **UI components**: shadcn/ui — add new ones with `npx shadcn@latest add <component>`
- **State**: Zustand for global state (branch selection only); React `useState` for local UI; server actions for mutations
- **No middleware.ts**: Auth is checked per-route in layout components
- **React Compiler** is enabled in `next.config.ts`
- **Formatting**: Currency uses ARS locale, dates use `date-fns` with Spanish locale

## SQL Migrations

Located in `supabase/migrations/`, numbered sequentially (currently `001` through `056`). Always use `IF NOT EXISTS`/`IF EXISTS` for idempotency. Comments in Spanish. Migrations 030–036 added mobile app support; 047–051 added multi-tenant org support. Changes to those tables affect the Flutter mobile app (`../Monaco-mobile`).

## Environment Variables

Required in `.env`:
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — public anon key
- `SUPABASE_SERVICE_ROLE_KEY` — server-side only, bypasses RLS
