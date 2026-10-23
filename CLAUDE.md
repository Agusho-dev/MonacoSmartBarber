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
| Barber panel | `/barbero/*` | PIN → cookie (`barber_session`) | Tema claro "reloj fichador" (DESIGN.md), hora arriba, wake-lock |
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

`/dashboard/rrhh` (gate `rrhh.view`, mutaciones `rrhh.manage`; pestaña "Recursos humanos" del grupo Equipo). Server actions en `src/lib/actions/rrhh.ts`, tipos en `src/lib/types/rrhh.ts`, UI en `src/app/dashboard/rrhh/`.

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

El sistema de turnos y su convivencia con la fila están documentados en detalle en `../.claude/rules/turnos.md` (el motor y la convivencia) y `../.claude/rules/turnos-superficies.md` (turnero, agenda, kiosko y fila). Lo mínimo que hay que saber antes de tocar cualquiera de los dos:

- Al hacer check-in, el turno entra a la fila con **`priority_order` = la hora del turno**, no la de llegada. Es la clave de toda la precedencia.
- `claim_next_for_barber` tiene dos caminos propios para turnos; el FIFO walk-in quedó intacto (sigue filtrando `is_appointment = false`).
- `position` **no ordena nada** (no es único, se recicla, tiene carrera). Todo lo que ordena de verdad usa `priority_order`.
- Las tarjetas de turno no se arrastran desde `/dashboard/fila`: el drag reescribe `priority_order` sintético y le pisaría la hora reservada.

### Programa de fidelización (migraciones 196–206)

La lógica (categorías por frecuencia, lotes de puntos FEFO, canje, referidos, cron) vive en la base y está documentada en `../.claude/rules/fidelizacion.md`. Lo que hay que saber de este repo:

- **`/dashboard/fidelizacion`** (`src/app/dashboard/fidelizacion/`, gate `rewards.view` / mutaciones `rewards.manage`; pestaña "Fidelización" del grupo Clientes, visible sólo si el plan tiene `mobile_app.enabled`, como APP Móvil: `NAV_FEATURE_MAP`). Sub-navegación por `?tab=`: Resumen (interruptor del programa + tarjetas de categoría + KPIs + eventos) · Categorías (slider de 3 manijas para los umbrales + **simulador en vivo** con `loyalty_preview_distribution`) · Puntos (parámetros + calculadora de ejemplo + qué servicios cuentan como visita) · Premios (grilla + vista escalera + editor completo con subida de imagen) · Referidos · Notificaciones (12 reglas con vista previa tipo teléfono) · Clientes (ficha con lotes, beneficios, referidos, historial; ajustar puntos, cancelar beneficio, revertir visita, canjear en nombre del cliente). Server actions en `src/lib/actions/loyalty.ts` (22), tipos en `src/lib/types/loyalty.ts`. Las tablas `loyalty_*` **no tienen policies de staff**: todo va por `createAdminClient()` + `getCurrentOrgId()` + `currentUserCan(...)`, y cada id que llega del cliente se verifica contra la org antes de la RPC.
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
- El acumulado **se deriva** de `transfer_logs` vía `get_transfer_accounts_state(branch)` (sólo `service_role`: la tablet la pide por server action) y `get_payment_accounts_month_income(branch_ids[])`. Desde la tablet: `obtenerCuentasDeCobro(branchId)` devuelve `{ok, cuentas} | {ok:false, error}`; `getTransferAccountsState` quedó con el contrato viejo (array) sólo para bundles viejos. `completeService` y la venta directa rechazan una transferencia sin cuenta cuando la sucursal tiene cuentas activas. No hay contador denormalizado: el viejo (`accumulated_today` + `increment_account_accumulated`) nunca escribió un peso —la RPC fallaba con 42702— y por eso la rotación nunca funcionó.
- Regla de rotación única: `src/lib/payment-accounts.ts → pickTransferAccount()`, compartida por tablet y dashboard.
- **En el panel del barbero la cuenta NO se elige** (dueño, 19/oct/2026): se cobra en la que decide `pickTransferAccount()` al abrir el cobro, y cuando se llena rota sola. `TransferAccountPicker` muestra el desplegable sólo con `puedeElegirCuenta`, que pasa únicamente el cobro del dashboard (el que no recibe `staffIdDelPanel`); la venta directa del panel tampoco lo tiene y ahora muestra el alias. Es un cierre de interfaz: `completeService` acepta la cuenta que le manda el cliente, porque volver a resolverla al cobrar podría registrar una cuenta distinta de la del alias que el cliente ya transfirió.

### Oct/2026: asesoría, menor espera, fotos del corte, productos, sucursales (migraciones 216–225)

El detalle (modelo, decisiones y qué NO hacer) está en `../.claude/rules/operacion-local.md`. Mapa del código:

- **Asesoría sin costo**: `src/lib/actions/asesoria.ts` (interruptor por sucursal, «Mi turno», `marcarAsesoriaVista`, métricas), `cerrarSoloAsesoria` y los guards de `completeService` en `queue.ts`, `src/components/checkin/asesoria-kiosk-band.tsx`, `src/components/barber/asesoria-{badge,aviso,inicio-dialog}.tsx`, `src/components/dashboard/asesoria-card.tsx`. Helpers puros del aviso en `barber-utils.ts` (`marcasDeAsesoria`, `asesoriasNuevas`). Trigger de red en la base: `trg_queue_asesoria_exige_servicio` (221).
- **Menor espera por WhatsApp**: `src/lib/menor-espera/*` (el corte del webhook vive en `webhook.ts` y `salvavidas.ts`, y se llama desde `src/app/api/webhooks/whatsapp/route.ts` ANTES del motor), `src/lib/actions/menor-espera.ts`, `src/components/dashboard/menor-espera-card.tsx`. «Mi fila» con los movidos: `armarMiFila` en `barber-utils.ts`.
- **Fotos del corte**: `src/lib/fotos-corte/*` (servidor, contrato, subida, textos), `src/app/api/fotos-corte/entradas/[id]/route.ts` (tablet y dashboard), `src/lib/actions/fotos-corte.ts` (celular), `src/stores/fotos-corte-store.ts`, `src/components/barber/{fotos-del-cobro,qr-fotos-dialog,tira-ultimos-cortes,visor-fotos}.tsx`, `/upload/[token]`. Historial: `getUltimosCortesDelCliente` en `visit-history.ts`. **En el cobro sólo se ofrece el celular (QR)** (dueño, 19/oct/2026: la cámara de las tablets es mala y su galería no tiene fotos); la subida desde el dispositivo (`f.agregar`) sigue en el hook, sin botón.
- **Productos**: `src/lib/productos/{reglas,venta}.ts` (server-only), `listarProductosParaCobro` en `sales.ts`, `useProductosDeSucursal` + `SelectorProductos`. La tablet NO lee `products` con la anon key.
- **Sucursales**: `createBranch`/`updateBranch`/`deleteBranch` en `src/lib/actions/branches.ts` (permiso `branches.manage`). Una sucursal con historial NO se borra: se desactiva. Nada de escribir `branches` desde el browser.
- **Fugas cerradas**: el kiosko, la TV y el cobro de turnos piden columnas explícitas (`STAFF_KIOSKO_COLS`, `TV_QUEUE_SELECT` en `src/lib/tv-queue-select.ts`); identificar y registrar la cara del staff y verificar su PIN va por `src/lib/actions/rostro-staff.ts` (permiso HMAC de 5 min). `client_loyalty_state` se embebe como OBJETO: leer con `leerLoyaltyEmbed` (`src/lib/loyalty-embed.ts`). `app_settings` siempre con `.eq('organization_id', …)`.
- **Permisos nuevos**: `history.delete` (borrar visitas del historial; los roles «Encargado» no lo tienen hasta que el dueño se lo dé).

### Panel del barbero girado 180° (`src/lib/giro-panel`)

1. Una sola regla, `necesitaCss()` en `nucleo.ts`, espejada a mano en `script-pre-paint.ts` y en el `OFFLINE_HTML` de `public/sw.js`: si cambia una, cambian las tres. Preferencia POR TABLET en `localStorage` (`msb.panel.giro.v1`), sin flag por org.
2. La estructura `#giro-raiz > #giro-scroll + #giro-portales + Toaster` está SIEMPRE en `/barbero` y es inerte sin `html[data-giro='css']`. No hacerla depender de nada: el layout de `/barbero` se vuelve a ejecutar en cada server action que revalida, y un árbol distinto remontaría el panel en pleno cobro.
3. En `/barbero` nunca `createPortal(document.body)`: los overlays van por `Dialog`/`Sheet`/`AlertDialog` de `@/components/ui` (portalean a `#giro-portales`). `Select` y `DropdownMenu` ya invierten lado y alineación; `Popover`, `Tooltip` y `DropdownMenuSubContent` NO giran.
4. En modo CSS se corta la propagación de `touchmove` (react-remove-scroll lee el gesto al revés): usar pointer events.
5. Cámaras: `data-giro-camara` en el visor; sólo los escáneres con la tablet fija enderezan frames (`camara.ts`). Las fotos con la tablet en la mano van por la cámara nativa y nunca se enderezan.
6. Campos de plata o cantidad en el panel: `CampoMontoTablet` / `CampoContadorTablet` (`src/components/barber/campo-tablet.tsx`): el teclado de Android girado invierte el 6 y el 9.
7. El root layout no dibuja Toaster en `/barbero` (`ToasterRaiz`); el panel tiene el suyo. Con un diálogo abierto, los toasts se pueden tocar sin cerrarlo (`src/components/ui/ignorar-avisos.ts` + CSS en `globals.css`).
8. En dev, el SW de `/barbero` cachea los chunks: desregistrarlo para ver cambios.

### Panel del barbero: el "reloj fichador" (rediseño oct/2026)

Sistema visual en `DESIGN.md` (raíz del repo); contexto de producto en `PRODUCT.md`. Lo que hay que saber para tocar el panel:

- **La hora va arriba en TODAS las pantallas** (`src/components/barber/reloj/banda-reloj.tsx`, montada en `src/app/barbero/layout.tsx`, en todas las ramas). Existe porque el panel corre en pantalla completa y eso esconde el reloj de Android: los barberos salían de pantalla completa sólo para ver la hora. Es la hora del DISPOSITIVO, se actualiza al borde de cada minuto y al volver de reposo, y en el servidor no se pinta (`useSyncExternalStore` con snapshot de servidor null). Decisión del dueño: al lado de la hora no va nada. En el PIN no hay banda: esa pantalla es la de bloqueo, con `VisorHora tamano="grande"`.
- **Alturas:** `--alto-banda` y `--alto-nav` (en `.barber-theme`, `globals.css`, con override en celular). La fila mide `100dvh − --alto-banda − --alto-nav − safe-area` y el documento no scrollea; las otras pantallas usan `EncabezadoPantalla` (`src/components/barber/encabezado-pantalla.tsx`), que se pega con `top-[var(--alto-banda)]`. Un `sticky top-0` nuevo queda tapado por la banda.
- **La fila no tiene pestañas:** "Tu fila", "En el local" y "Cortando ahora" en una columna (apaisada: silla a la izquierda). La pestaña "General" era un cajón que nadie abría. Componentes en `src/components/barber/fila/*`; `queue-panel.tsx` es el contenedor (datos, efectos, acciones, diálogos) y arma las fichas con `propsDeFicha`.
- **Los botones de cada ficha los decide `accionDe` en `queue-panel.tsx`**, con las mismas reglas que tenía la tarjeta vieja (turnos por su hora real, `descansoListo`, rescate de dinámicos con "Reclamar"). La silla y el tarjetero leen de ahí: no duplicar esa lógica en un componente.
- **La silla:** libre, sube lo primero de "Mi fila" (el cliente con Atender a todo el ancho, o el descanso que arranca solo); con "Mi fila" vacía sube el primero del local SIN barbero que se pueda atender (`accionDe(e, true)?.tipo === 'atender'`). Lo que sube no se repite abajo.
- **El corte se mide en minutos ("32 min"), no "32:01"** (`fila/minutos-en-vivo.tsx`): con la hora arriba, un m:ss se leía como otra hora. Sin duración del servicio ni línea de progreso en el corte (el dueño la sacó: el cliente sentado ve la tablet y siente que el barbero se apura); la regla de minutos queda sólo en el descanso.
- **El barbero no ve cuántos cortes lleva en el mes** (dueño, 19/oct/2026). `fetchBarberGoals` no devuelve el total: cada meta trae su avance ya acotado a su umbral (`progreso`). Historial va sin conteo por día y Rendimiento (ruta sin enlace en la barra) sin la pestaña "Mes". Lo de hoy ("N cortes hoy" en la cabecera) sí se ve. No volver a agregar un total mensual en ninguna pantalla del panel.
- **Metas se apaga por sucursal** (`branches.metas_en_panel`, mig 226; el dueño la apagó en Rondeau y Paraná el 19/oct/2026). El layout de `/barbero` lo lee con `metasVisiblesEnSucursal` (`src/lib/metas-en-panel.ts`, falla cerrado) y se lo pasa a `BarberNav`; `/barbero/metas` redirige a la fila si está apagada. Se cambia desde `/dashboard/incentivos` (y la pestaña Incentivos de Equipo) con `guardarMetasEnPanel`. Apagarla no toca reglas ni logros.
- **El cobro** (`complete-service-dialog.tsx`, compartido con `/dashboard/fila`, agenda y turnos) se arma con `cobro/piezas-cobro.tsx` (`TituloCobro`, `PasoDelCobro`, `VisorMonto`, `CLASE_OPCION`) y `cobro/tono.ts`. Como también se abre en el dashboard oscuro, los colores de aviso salen de `claseAviso(color, useTonoDelTema())`: **`dark:` no funciona en esta app** (el `@custom-variant dark` exige un ancestro `.dark` que nunca se pone; hay ~300 usos muertos fuera del panel).
- **El semáforo y el fondo claro son intocables** (dueño). Pendiente de su decisión: el texto chico sobre la etapa azul da 3,5:1 (ver DESIGN.md).
- Sin teléfono del cliente en las fichas (el cliente de la silla ve la pantalla); la ficha completa se abre tocando el nombre.

### Fila del dashboard (`/dashboard/fila`): se queda el tablero por barbero

El 19/oct/2026 se probó una "fila única" (una lista en orden de llegada más una columna de sillas, commit `b73aefb`) y **el dueño la rechazó el mismo día**: el tablero de carriles por barbero le resulta mucho más intuitivo, y arrastrar la tarjeta de un cliente al carril de un barbero es la gracia de la pantalla. Se revirtió el diseño; no volver a proponer reemplazar los carriles. Quedaron los arreglos que corregían problemas del tablero de carriles:

- **Soltar fuera de los carriles no hace nada.** `kanbanCollisionDetection` ya no cae a `closestCenter`, que siempre encontraba un destino: soltar una tarjeta en el encabezado o en un costado vacío la pasaba al carril más cercano. Sin destino, `handleDragEnd` relee la fila y la tarjeta vuelve a su lugar.
- **Los botones de la tarjeta (▶, X) frenan `mousedown`/`touchstart`.** Los sensores de dnd-kit escuchan esos eventos, no `pointerdown`: apretar un botón moviendo apenas el mouse, o un toque largo en la tablet, arrastraba la tarjeta en vez de apretar el botón.
- **Con "todas las sucursales" no se puede soltar a alguien en un barbero (ni junto a una tarjeta) de otra sucursal** (`esDeOtraSucursal`): la entrada seguía en su sucursal con un barbero que no atiende ahí.
- **`html[data-arrastrando]` mientras se arrastra**: el shell del dashboard cambia de sección deslizando el dedo de costado en el celular (`dashboard-shell.tsx`) y, sin la marca, un arrastre horizontal podía terminar navegando a otra pantalla. Se saca un tick después de soltar, para que el `touchend` todavía la vea.
- **La etiqueta TURNO muestra la hora reservada de la agenda** (`HoraDeTurnoContext`), no `priority_order`: en una entrada adoptada de un walk-in ése es la hora de llegada (mig 170).
- **`startService` deja el turno "en curso" también en la agenda** (antes seguía `checked_in` durante el corte arrancado desde el tablero).
- La lectura de la agenda del día ya no deja una promesa rechazada sin atrapar cuando falla la red.

**Rediseño visual con la misma estructura** (19/oct/2026, pedido del dueño: «mejorarlo pero manteniendo la misma estructura»): las mismas piezas (Dinámicos a la izquierda, un carril por barbero con su celda fija, barra de descansos, tres números arriba) con otra piel:
- La tarjeta muestra el nombre entero, la espera con los colores del panel (ámbar a los 40 min, rojo a los 70) y una barra por el borde de abajo que se llena a las 2 h.
- **"Sigue"** marca al próximo de cada carril con las reglas de `claim_next_for_barber` (`quienSigue`): un descanso pendiente adelante va primero, un turno cuya hora llegó antes que los walk-ins, y con un turno dentro de la ventana de protección el del turno (o nadie). La hora del turno sale de la agenda (`TableroContext.inicioDeTurno`).
- El corte en curso mide los minutos como el panel (`computeMinutes`, sin las pausas) con el semáforo (ámbar desde 35, rojo desde 45).
- El carril sobre el que se arrastra se ilumina (`carrilDestino`).
- Las tarjetas son `shrink-0`: en Dinámicos, una columna de alto fijo, se aplastaban y cortaban su segundo renglón (pasaba también antes).
- Al soltar se limpia también el descanso en la mano: si quedaba puesto, el arrastre siguiente de un cliente dibujaba las dos fichas juntas.

### Recarga por versión (después de cada deploy)

`/api/version` devuelve el commit del deployment y `NEXT_PUBLIC_VERSION_APP` (next.config) lo hornea en el bundle. `RecargaPorVersion` (montado en el panel, el kiosko, la TV y `/dashboard/fila`) recarga con `src/lib/recarga-version.ts` SÓLO en reposo: visible, online, sin `[role=dialog]`/`[role=alertdialog]` abiertos (salvo `data-recarga-permitida`), sin foco en un campo, sin `html[data-subiendo-fotos]`, 60 s sin tocar; el kiosko además exige `html[data-kiosko-en-reposo]`. Una recarga por versión cada 10 min como máximo. En los `catch` de server actions: `esErrorDeVersion(e)` → `avisarYRecargarPorVersion()` (o `TEXTO_RECARGA_MANUAL` si la guarda no deja). No fijar `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` (ver Known Risk #38 del CLAUDE.md raíz).

### Listas que se recargan por Realtime

Una lista que se vuelve a leer en cada evento de Realtime NO se reemplaza por un spinner mientras recarga. Con `loading ? spinner : lista`, la lista —y cualquier diálogo que viva adentro— se desmonta bajo el dedo en cada cambio de la fila. El spinner va sólo en la primera carga (`loading && items.length === 0`). Pasaba en el paso de barbero del kiosko y en sus dos «Cambiar barbero» (arreglado el 4/oct/2026); la banda de asesoría del kiosko sigue la misma regla.

### Escáner facial del kiosko (rediseño 19/oct/2026)

`src/lib/escaneo-facial/` (motor, geometría, dibujo, filtro, textos) + `src/components/checkin/escaner-facial.tsx`. `FaceCamera` (identificar cliente o staff) y `FaceEnrollment` (registrar) son capas finas encima: el escáner lee la cara y les pasa la lectura; ellas deciden (buscar en la base, guardar). Lo que hay que saber antes de tocarlo:

- **Dos caminos de face-api, a propósito.** El rastreo (`rastrearCara`, 10–20 Hz) sube el cuadro UNA vez a la GPU y trabaja con tensores: detector sobre el 720p reducido 2×2 y los 68 puntos sobre un recorte de tamaño FIJO (`cropAndResize` a 224 → promedio 2×2 → 112). Los descriptores que se COMPARAN contra la base salen SÓLO de `detectFace`, el camino por canvas con el que se calcularon los ~31.000 guardados. No mezclar: el rastreo da puntos casi iguales, que para dibujar alcanzan.
- **No prender `WEBGL_USE_SHAPES_UNIFORMS`.** Con tfjs 4.22 el detector deja de encontrar caras con entradas distintas de 320 y no tira error (medido). Las recompilaciones se evitan con los recortes de tamaño fijo: con un `slice` del tamaño de la cara, cada tamaño nuevo compilaba shaders y trababa la pantalla.
- **Una lectura = el promedio de 2 muestras coherentes** (a menos de 0,4 entre sí), en UN viaje a la base; 2 intentos y después `onNoMatch` (el teléfono le guarda esa cara al cliente). Antes: muestras sueltas, dos coincidencias seguidas y 2 s de cartel por intento (un cliente nuevo esperaba ~8 s). El contrato con la base no cambió (`match_face_descriptor`, umbral 0,48, 1 resultado). El registro toma 3 muestras con límites más exigentes (`LIMITES_REGISTRAR`).
- **Cada límite que frena la lectura tiene su guía en pantalla** (`evaluarCara` → acercate/alejate/de frente/…): no hay zonas muertas donde la persona espera sin saber qué hacer. Sin nadie a la vista, el detector mira el cuadro entero con entrada 416 (ve caras a más de un metro); una cara lejana se sigue en una ventana a resolución completa.
- **Cámara a 1280×720** (antes 480×640). La lente encuadra a la cara con un transform sobre el video (la sigue, como el Center Stage) y la malla usa el mismo encuadre, así quedan pegadas. React se entera sólo de los cambios de momento: el canvas se dibuja a la tasa de la pantalla, con los puntos suavizados (One Euro + predicción) y sin `shadowBlur` (era lo que trababa la malla vieja). Si la tablet no llega a ~40 fps, `aliviar()` baja la densidad y saca los halos.
- **Precalentado**: `usePrecalentarReconocimiento(step === 'home')` baja los modelos y compila los shaders mientras el inicio espera. Sin eso, la carga la pagaba el primero que tocaba "Sí".
- El botón manual dice lo que hace: "Ingresar con mi teléfono" (clientes) / "Ingresar con mi PIN" (staff, pantalla "Fichaje"); antes era "Soy Nuevo" en las dos, y la del staff tenía dos títulos.
- Para probarlo sin tablet: Chrome headless con `--use-file-for-fake-video-capture=<video.mjpeg>` contra una página que monte `FaceCamera`, interceptando `rest/v1/rpc/match_face_descriptor`. Medido así (19/oct/2026): 60 fps estables también con la CPU frenada ×6, cero tareas largas durante el escaneo, sin fugas de tensores, ~0,7 s de la cara lista a "¡Hola, Nacho!".

### Menú del dashboard: 5 grupos con pestañas (22/oct/2026)

El detalle está en `../.claude/rules/navegacion-dashboard.md`. Lo mínimo: los grupos y sus pestañas salen de `src/lib/navegacion/grupos.ts` (módulo puro; las URLs no cambiaron y la coincidencia es por segmento), una página nueva en `/dashboard` va como pestaña o como alias ahí, las pestañas internas de una pantalla usan el contenedor gris (el subrayado es del nivel 1, en el header) y la clave vieja `nav-order-<nombre>` se lee para migrar pero no se escribe. Tex salió del menú: botón flotante (`src/components/tex/tex-boton-flotante.tsx`).

### El dashboard como app instalada (23/oct/2026)

El detalle está en `../.claude/rules/navegacion-dashboard.md`. Lo mínimo:
- El manifest es `public/dashboard.webmanifest`, con alcance `/` para que el login quede adentro. Lo enlazan sólo `src/app/dashboard/layout.tsx` y `src/app/(auth)/layout.tsx`, vía `METADATA_APP_INSTALABLE` (`src/lib/app-instalable.ts`). Sin manifest, iOS 26 abría todo lo que estaba fuera del alcance en la hoja de Safari, con la X y las barras.
- La barra de estado va `black`, nunca `black-translucent`.
- iOS lee el manifest al agregar el ícono: un cambio exige borrar el ícono y volver a agregarlo.
- Toda descarga pasa por `guardarArchivo` (`src/lib/guardar-archivo.ts`), porque la app instalada de iOS no tiene gestor de descargas.
- Recarga después de un deploy: la Fila se recarga sola cuando está ociosa. En la app instalada, las demás pantallas muestran «Actualizar» y nunca recargan solas, porque hay cambios sin guardar fuera de los diálogos y Safari de iOS no tiene `beforeunload`.
- El shell usa `h-dvh` sólo en la app instalada.
- Las barras fijas de abajo llevan el área segura.
- Una dirección inexistente bajo `/dashboard` cae en `[...resto]` y muestra el 404 adentro del menú.

### Tex y la conciliación con Mercado Pago (oct/2026, migraciones 227–230)

El detalle está en `../.claude/rules/tex.md` y `../.claude/rules/conciliacion-mp.md`. Mapa del código:

- **Tex** (la IA del dashboard, Claude Haiku 5.5): ruta `/api/tex/chat`, servidor en `src/lib/tex/*` (motor, turno, historial, prompt, herramientas), actions en `src/lib/actions/tex.ts`, UI en `src/components/tex/*` (cara animada, chat, panel ⌘K, bloques, lienzo) y `src/app/dashboard/asistente/**`, PDF en `src/lib/tex/pdf.ts` + `pdf-dibujo.ts`, imágenes en `public/tex/`. El asistente viejo (`/api/asistente/chat`, `src/lib/asistente/*`) queda en el repo para bundles viejos (Known Risk #38 del CLAUDE.md raíz).
- **Conciliación**: motor y sincronización en `src/lib/conciliacion-mp/*` (el motor y la narrativa son puros), actions en `src/lib/actions/conciliacion-mp.ts`, pantalla `src/app/dashboard/conciliacion/**`, página pública del titular `src/app/conectar-mp/**`, callback de OAuth `src/app/api/mercadopago/conciliacion/callback`, cron `src/app/api/cron/mp-movimientos` (su `pg_cron` es la `migrations_pendientes/228b`, que va DESPUÉS del deploy).
- Permisos nuevos: `conciliacion.view` / `conciliacion.manage`.

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

Located in `supabase/migrations/`, numbered sequentially (through `230` at oct/2026). Las escritas pero NO aplicadas (con gate) viven en `supabase/migrations_pendientes/` con un README del orden: no moverlas a `migrations/` hasta aplicarlas. Always use `IF NOT EXISTS`/`IF EXISTS` for idempotency. Comments in Spanish. Migrations 030–036 added mobile app support; 047–051 added multi-tenant org support. Changes to those tables affect the Flutter mobile app (`../Monaco-mobile`).

## Environment Variables

Required in `.env`:
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — public anon key
- `SUPABASE_SERVICE_ROLE_KEY` — server-side only, bypasses RLS

Opcionales de Tex y la conciliación: `ANTHROPIC_API_KEY` (clave de plataforma si la org no cargó la suya), `MP_CONCILIACION_CLIENT_ID`, `MP_CONCILIACION_CLIENT_SECRET` y `MP_CONCILIACION_REDIRECT_URI` (la app de OAuth de Mercado Pago de la conciliación, separada de la de señas).
