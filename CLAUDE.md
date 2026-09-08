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

### Recursos humanos: los barberos que mandan CV por el CRM (migración 213)

`/dashboard/rrhh` (gate `rrhh.view`, mutaciones `rrhh.manage`; ítem "Recursos humanos" del sidebar, pegado a Equipo). Server actions en `src/lib/actions/rrhh.ts`, tipos en `src/lib/types/rrhh.ts`, UI en `src/app/dashboard/rrhh/`.

**Qué resuelve.** El auto-etiquetado con IA ya marcaba "Posible Barbero" a quien escribe buscando trabajo — 206 conversaciones al 8/sep/2026 (123 WhatsApp + 83 Instagram) — pero **ese conjunto no era consultable**: el chip de etiqueta del inbox filtra EN EL CLIENTE sobre las 200 conversaciones ya cargadas (`mensajeria-context.tsx:604` + `INBOX_PAGE_SIZE`), así que mostraba una porción arbitraria sin decir que lo era.

**La etiqueta es la fuente; `rrhh_candidatos` es sólo el overlay.** La tabla guarda lo que agrega una persona (estado, notas, puntaje, teléfono cargado a mano) y el listado es un LEFT JOIN contra las conversaciones etiquetadas: un candidato nuevo aparece solo, sin cron ni import, y la fila del overlay se materializa recién cuando alguien lo toca. `conversation_tags.es_candidato` (mig 213) define qué etiquetas alimentan la pantalla — son varias posibles, por eso va en la etiqueta y no en `app_settings`.

**La difusión NO pasa por `broadcasts`, y no hay que "unificarla".** `scheduled_messages.client_id` y `broadcast_recipients.client_id` son NOT NULL, así que ese camino obliga a fabricar un `clients` por candidato. Ya se hizo una vez: la difusión del 27/07/2026 creó **134 fichas**, 114 quedaron en `broadcast_recipients`, sólo **19 tienen alguna visita**, y **80 son estos mismos candidatos**. Esas fichas suman al total de `/dashboard/clientes`, entran en cualquier campaña "a todos" y serían destinatarias de las reglas de fidelización. Acá el destinatario es la **conversación**: se manda con el mismo primitivo que `sendMetaWhatsAppTemplate` (`sendToMeta`, con reintentos y backoff), se registra en `messages` salga o no salga, y se resuelve todo con `conversation_id`.

- **El envío va por lotes desde el browser** (`enviarLoteDifusion(difusionId, 8)` en bucle): cada request es corta, la barra de progreso es real y el envío es reanudable y pausable. El claim es atómico (`rrhh_claim_destinatarios`, `FOR UPDATE SKIP LOCKED`): dos pestañas abiertas no mandan el mismo mensaje dos veces.
- **Los contadores se DERIVAN** (`rrhh_recalcular_difusion`), no se incrementan. Known Risk #13, y el `delivered_count` de `broadcasts` que es una copia literal de `sent_count`.
- **El idioma de la plantilla sale del sync de Meta y no tiene default en ningún lado** (Known Risk #4: `es_AR` contra una plantilla registrada como `es` da 132001 y el mensaje muere sin reintento).
- **Sólo se admiten plantillas SIN variables.** Una variable de más o de menos es un 132000 que tira el mensaje entero. El botón "Crear la plantilla" la da de alta en Meta por API (mismo endpoint que `ensureDefaultTemplates`; el token de Monaco tiene `whatsapp_business_management`, verificado) con textos sugeridos que incluyen el opt-out que Meta exige en marketing.
- **Al equipo nunca se le manda.** Si el teléfono coincide con un `staff` activo (`phone_tail`), el candidato se marca `es_staff` y queda omitido: la IA los etiqueta de vez en cuando (hoy, 3 casos).
- Un envío exitoso mueve el pipeline con `rrhh_marcar_contactado`, que **sólo avanza desde `nuevo`**: si alguien ya lo puso en entrevista, la difusión no lo retrocede.

**Instagram no se puede difundir, y la pantalla lo dice con palabras.** Meta no tiene plantillas en Instagram; fuera de la ventana de 24 h el único mecanismo es el tag `HUMAN_AGENT` (7 días, respuesta humana a una consulta, requiere App Review), que no cubre prospección. De las 83 conversaciones de IG etiquetadas, **82 tienen la ventana cerrada**. La RPC devuelve `alcance` (`whatsapp` | `instagram` | `no`) y la UI ofrece, para los inalcanzables, abrir el perfil en Instagram o **cargarles el teléfono a mano** — que es lo único que los suma a la difusión de WhatsApp.

**Las fotos viejas de Instagram están perdidas y NO se pueden recuperar.** El webhook guardaba la `payload.url` de `lookaside.fbsbx.com`, que caduca a los ~3 días (medido: una de hoy da 200, una de abril da 404 "Resource has expired"). Probado el 8/sep/2026 contra prod con el token vivo y el scope `instagram_manage_messages`: `graph.instagram.com/v22.0/{message_id}?fields=attachments` devuelve **200 sin el campo**, en todas sus variantes y también por `/me/conversations?fields=messages{attachments}` — y **falla igual con un mensaje de hace 4 horas cuya URL original sigue viva**, así que no es retención: la API de Instagram Login no expone el adjunto. Lo que sí se arregló: `src/app/api/webhooks/instagram/route.ts` ahora baja el binario y lo sube a `chat-media` como el de WhatsApp, y corrige el `content_type` con el MIME real (el fallback marcaba `image` cualquier adjunto no mapeado, y por eso había mensajes tipados como imagen cuyo binario era un mp4). De acá en adelante no se pierde nada.

**La tarjeta muestra el trabajo, no una fila de texto.** Para un barbero el CV son las fotos de sus cortes: 242 imágenes y 41 videos contra 8 documentos vivos. `rrhh_muestras` devuelve hasta 4 miniaturas dentro de la misma consulta (sin N+1 sobre 206 fichas), excluyendo lo vencido y los `instagram.com/...`, que son links a un reel y no archivos. Debajo va su primer mensaje entrante, que es la carta de presentación que efectivamente escribió.

**Contratar no crea el staff desde acá.** El alta son cuatro llamadas encadenadas con decisiones (sucursal, PIN, rol, comisión) que RRHH no tiene: el botón abre `/dashboard/barberos?alta=1&nombre=…&telefono=…&candidato=…` con el diálogo prellenado, y al guardar `marcarContratado` cierra el círculo. Los params se leen en el **server component** y bajan como prop (`useSearchParams` obligaría a un Suspense).

**Grants:** las 8 funciones `rrhh_*` son SECURITY DEFINER sin RLS de contención y tienen EXECUTE **sólo para `service_role`**; `p_org` lo pone `getCurrentOrgId()`, nunca el browser. Las tres tablas tienen RLS prendida y **cero policies**.

**Correcciones de la revisión adversarial (mig 214).** Cinco eran bugs que llegaban a producción:

- **`enviando` era un estado sin salida.** El claim marcaba la fila y sólo el propio lote la liberaba; si el proceso moría después de mandar el WhatsApp y antes del UPDATE, esas filas quedaban trabadas para siempre — el claim sólo tomaba `pendiente`, el reintento sólo `fallido`, `terminado` nunca daba true y el browser giraba 200 veces reclamando 0 filas. Ahora el claim se sella con `claimed_at` y rescata lo que lleve más de 5 minutos en vuelo. El historial además tiene **Terminar de enviar / Reintentar / Cancelar el resto**, que antes era código sin cablear.
- **`terminado` se derivaba de un objeto vacío.** Si `rrhh_recalcular_difusion` fallaba, `data` era null y `(undefined ?? 0) === 0` daba **true**: la pantalla decía "Difusión terminada" con 100 destinatarios sin mandar. Known Risk #5 literal. Ahora el error se propaga.
- **`conversation_tags.es_candidato` lo escribía cualquier staff logueado con la anon key** (la policy `conversation_tags_manage_by_org` es ALL para `public` y el GRANT de UPDATE era a nivel tabla). Esa columna define la audiencia: prendérsela a "Precios / servicios" metía 1.146 conversaciones de clientes en una convocatoria de barberos. Se pasó a permisos **por columna**.
- **`normalizarTelefonoAr` fabricaba un teléfono AJENO.** Con `0351 15 555 1234` —el formato más común de Córdoba— sacaba el 15 por posición, se quedaba con los últimos 10 dígitos y armaba un número **de Buenos Aires perfectamente válido**. Ahora sólo interpreta lo inequívoco y rechaza el resto: mandar marketing al número equivocado es peor que pedirle al usuario que lo reescriba.
- **El conteo de conversaciones por etiqueta mentía** (`.limit(20000)` contra el `db-max-rows` de 1.000 de PostgREST): la pantalla donde se ELIGE la etiqueta decía 69 donde hay 206. Va por `rrhh_conteo_etiquetas`.
- Menores del mismo barrido: la barra de progreso descuenta los omitidos del denominador (una difusión completa mostraba 59 %); `crearYEmpezar`/`crearPlantilla` con `try/finally` (un rechazo dejaba el sheet **sin forma de cerrarse**); la ficha abierta se re-deriva tras cada recarga (cambiar el estado no movía el chip); `page.tsx` usa el mismo tamaño de página que el cliente (el primer "Ver más" repetía 12 fichas); en modo selección el mosaico no captura el toque; el visor navega con teclado y acepta índices de miniaturas ocultas; y **el "Contratar" no marcaba nunca al candidato** porque `candidatoId` venía del prop y `router.replace` re-corría el server component sin los searchParams — ahora se congela en un ref.
- En el webhook de Instagram, la descarga del adjunto quedó **después** del INSERT (no antes): la deduplicación es un read-then-write sin índice único que la respalde —hay 5 filas duplicadas de abril que lo prueban— y meter ~1 s de I/O entre el chequeo y el insert ensanchaba esa carrera. La ruta declara `maxDuration = 30`.

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
