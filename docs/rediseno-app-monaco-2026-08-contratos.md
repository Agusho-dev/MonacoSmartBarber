# Monaco app mobile — rediseño 2026‑08. CONTRATOS COMPARTIDOS

Este documento es la **fuente de verdad** para todos los agentes que trabajan en paralelo. Si algo de acá
no coincide con el código existente, **gana este documento** (y se corrige el código). Si necesitás
desviarte, dejalo anotado en tu informe final con el motivo.

Repos:
- Dashboard Next.js 16: `/Users/ignaciobaldovino/MSB_FULL/MonacoSmartBarber` (repo git propio, deploya Vercel a `https://monaco-smart-barber.vercel.app`).
- App Flutter: `/Users/ignaciobaldovino/MSB_FULL/Monaco-mobile` (repo git propio). Package `monaco_mobile`, Flutter 3.38.4 / Dart 3.10.3.
- Supabase prod `gzsfoqpxvnwmvngfoqqk` (URL `https://gzsfoqpxvnwmvngfoqqk.supabase.co`). Una sola base compartida. MCP `mcp__supabase-MSB__*` disponible (`execute_sql`, `apply_migration`, `deploy_edge_function`, `get_edge_function`, `list_edge_functions`).

Organización Monaco: `organization_id = a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11`, slug `monaco`.
Sucursales reales: Rondeau `1264eb6e-bb7e-4c71-9110-a8b3f3acec12` (slug `rondeau`, **hybrid**, turnos habilitados), Parana `9a9e1dce-a08a-4381-b5bd-7c9aedd9cb2f` (walk_in), Caseros `dfd3e0d2-c3a1-4de2-9de2-de99b9f35b34` (walk_in). Test `c031e1bf-895e-4f5a-9213-cc69f3225816` (slug `test`, hybrid) es **sólo para pruebas**: la app la esconde salvo "modo prueba".
Timezone de todas: `America/Argentina/Buenos_Aires` (UTC‑3 fijo, sin DST).

Idioma: UI y comentarios en español rioplatense. Nada de emojis en UI (íconos). Nada de `TODO` sin dueño.

---

## 0. Principios no negociables

1. **Un solo motor de disponibilidad/creación de turnos**: `getAvailableSlots` / `createAppointment` de `src/lib/actions/appointments.ts`. La app lo consume a través de route handlers; NO se reimplementa en Dart ni en SQL.
2. **Identidad por JWT**: en la API mobile el teléfono y el `client_id` salen SIEMPRE del usuario autenticado (`clients.auth_user_id = auth.uid()`), nunca del body.
3. **Fallar cerrado y con mensaje**: ningún endpoint devuelve lista vacía ante un error (eso es doble booking / "Lleno" falso). Errores = `{ error: CODE, message: texto humano }`.
4. **Fechas**: `appointment_date` + `start_time` son hora de pared de la sucursal. La app usa `server_today` que devuelve la API, no `DateTime.now()` para "hoy".
5. **RLS de clientes**: un JWT de cliente NO obtiene `organization_id` en `app_metadata`; `get_user_org_id()` devuelve NULL para clientes. Todo lo que el cliente lee directo por PostgREST va por policies "propias" (`auth.uid()`), o por RPC SECURITY DEFINER que resuelve por `auth.uid()`.
6. **Chequear `error` de cada `.insert()/.update()`** en edge functions (Known Risk #5).
7. Ninguna fecha para comparar contra columnas `date` sale de `toISOString()`/`toIso8601String()` (UTC); se usa `getLocalDateStr(tz)` en server y `server_today` en la app.

---

## 1. API mobile — route handlers Next.js (`src/app/api/mobile/**`)

Base: `https://monaco-smart-barber.vercel.app` (la app lo toma de `AppConstants.apiBaseUrl`, override con `--dart-define=API_BASE_URL`).

### 1.1 Autenticación de la API
- Header `Authorization: Bearer <access_token de Supabase del cliente>`.
- Helper `src/lib/mobile/auth.ts` → `export async function requireMobileClient(req: Request): Promise<MobileClientCtx | NextResponse>`:
  - extrae el Bearer, `createAdminClient().auth.getUser(token)`; si falla → 401 `{ error: 'UNAUTHENTICATED', message: 'Iniciá sesión de nuevo.' }`.
  - busca `clients` por `auth_user_id = user.id` (`select id, organization_id, name, phone`); si no hay → 403 `{ error: 'NO_CLIENT', message: 'Tu cuenta no está vinculada a un cliente.' }`.
  - devuelve `{ userId, client: { id, organizationId, name, phone } }`.
- Rate-limit por usuario (no por IP): agregar a `RateLimits` en `src/lib/rate-limit.ts`:
  - `mobileSlots(userId)` → bucket `mobile_slots`, key userId, **60 / 60 s**.
  - `mobileBook(userId)` → bucket `mobile_book`, key userId, **10 / 60 s** (además sigue el límite por teléfono 3/h de `createAppointment`).
  - `mobileCancel(userId)` → bucket `mobile_cancel`, key userId, 10 / 60 s.
  - `mobileBootstrap(userId)` → bucket `mobile_bootstrap`, key userId, 30 / 60 s.
- Cambios mínimos en el motor (`src/lib/actions/appointments.ts`):
  - `getAvailableSlots(..., options?: { excludeAppointmentId?, ignoreLeadTime?, rateLimitKey?: string })`: si viene `rateLimitKey`, en vez de `RateLimits.publicBookingList(branchId)` usa `rateLimit('public_booking_list', rateLimitKey, { limit: 60, window: 60 })`. Nada más cambia.
  - `getPublicBranchAppointmentStaff(branchId, opts?: { rateLimitKey?: string })`: idem.
  - `CreateAppointmentInput.viaApp?: boolean`: si `true`, saltea el gate por IP (`publicBookingCreateByIp`) igual que `viaKiosk`; el límite por teléfono y todo lo demás sigue. Documentar en el JSDoc: "la app mobile ya pasó por rate-limit por usuario y el teléfono viene del JWT".

### 1.2 Endpoints (todos requieren Bearer salvo que se indique; responden `Content-Type: application/json`; `Cache-Control: no-store`)

`GET /api/mobile/turnos/branches`
→ `200 { server_today: 'YYYY-MM-DD', branches: MobileBranch[] }`
```ts
interface MobileBranch {
  id: string; name: string; slug: string; address: string|null; phone: string|null;
  timezone: string; latitude: number|null; longitude: number|null;
  operation_mode: 'walk_in'|'appointments'|'hybrid';
  bookable: boolean;          // operation_mode !== 'walk_in' && settings.is_enabled (settings efectivos org/branch)
  open_now: boolean; hours_label: string; // estadoHorario() de src/app/turnos/[slug]/horarios.ts
  is_test: boolean;           // slug === 'test' (la app lo esconde salvo modo prueba)
}
```
Sólo sucursales `is_active` de la org del cliente (`client.organizationId`), ordenadas por nombre.

`GET /api/mobile/turnos/[slug]` (bootstrap del wizard; mismo armado que `src/app/turnos/[slug]/page.tsx:311-371`)
→ `200 MobileBookingBootstrap` | `404 { error:'BRANCH_NOT_FOUND' }` | `409 { error:'NOT_BOOKABLE', message }`
```ts
interface MobileBookingBootstrap {
  server_today: string; server_now: string; // ISO
  branch: { id, name, slug, address, phone, timezone, latitude, longitude, operation_mode };
  bookable: boolean;
  settings: {
    max_advance_days: number; appointment_days: number[]; // YA recalculados (si hay appointment_hours, días con franja)
    slot_interval_minutes: number; cancellation_min_hours: number; lead_time_minutes: number; buffer_minutes: number;
  };
  branding: { logo_url: string|null; welcome_message: string|null };
  services: PublicService[];          // publicGetBranchServices
  staff: PublicStaff[];               // publicGetAvailableStaff (con rateLimitKey = userId)
  walk_in_staff: PublicWalkInStaff[]; // publicGetBranchBarbers menos los reservables
  client: { first_name: string; last_name: string; phone: string; upcoming: { date: 'YYYY-MM-DD'; time: 'HH:MM' } | null };
}
```
`client.upcoming` = misma query de `publicLookupClient` pero con `client.id` directo (sin RPC por teléfono ni rate‑limit de lookup).

`GET /api/mobile/turnos/[slug]/slots?date=YYYY-MM-DD&service_ids=a,b,c&staff_id=<uuid opcional>`
→ `200 { server_today, slots: PublicSlotGroup[], error?: string }` (mapeo 1:1 de `getAvailableSlots(branchId, date, serviceIds, staffId, undefined, { rateLimitKey: userId })`). `date` validada `^\d{4}-\d{2}-\d{2}$`, `service_ids` UUIDs válidos; si no → 400 `{ error:'BAD_REQUEST' }`.
**Si el motor devuelve `error`, se devuelve 200 con `error` string** (la app distingue "sin datos" de "lleno"). No colapsar a `[]`.

`POST /api/mobile/turnos/[slug]/book`
Body:
```ts
{ staff_id: string|null; date: 'YYYY-MM-DD'; start_time: 'HH:MM'; service_ids: string[]; duration_minutes: number; name?: string }
```
Lógica: rate-limit `mobileBook(userId)`; nombre = `name?.trim()` si tiene ≥2 chars, si no `client.name`; teléfono = `client.phone`; llama `createAppointment({ branchId, clientPhone, clientName, barberId: staff_id, serviceId: service_ids[0], serviceIds: service_ids, appointmentDate: date, startTime: start_time, durationMinutes, source: 'public', viaApp: true })`.
→ `200 { ok: true, appointment: <fila completa>, cancellation_token, client_is_new, client_has_face }`
→ `409 { error: CODE, message }` con el MISMO mapeo de `publicBookAppointment` (`public-booking.ts:387-404`): `INVALID_PHONE`, `PHONE_QUOTA_EXCEEDED`, `SLOT_TAKEN`, `ALREADY_BOOKED_TODAY`, `TOO_LATE`, y para lo demás `error: 'BOOKING_FAILED'` con el texto crudo en `message`. Rate-limit → 429 `{ error:'RATE_LIMITED', message }`.

`POST /api/mobile/turnos/cancel` body `{ appointment_id: string }`
Lógica: verificar que `appointments.client_id === client.id` (si no → 404 `NOT_FOUND`); llamar **`cancelAppointment(appointmentId, 'client')`** (camino TS completo: cancela `scheduled_messages`, queue entry, manda template de cancelación, notifica waitlist). Mapear errores: `'El turno ya fue cancelado o completado'` → 409 `ALREADY_CLOSED`; `'No se puede cancelar con menos de N horas'` → 409 `TOO_LATE_TO_CANCEL` con `message` tal cual; otro → 500 `CANCEL_FAILED`.
→ `200 { ok: true }`.

`GET /api/mobile/me` → `200 { client: { id, name, phone, organization_id }, server_today }` (para que la app valide sesión al arrancar).

`POST /api/mobile/me` body `{ name?: string }` → actualiza `clients.name` (trim, 2..80 chars) → `200 { ok:true, name }`.

`POST /api/mobile/push/token` body `{ token, platform: 'ios'|'android', device_id, app_version? }` → upsert en `client_device_tokens` **por `(client_id, device_id)`**: si existe otra fila del mismo `client_id` con el mismo `token` y otro `device_id`, borrarla primero (el UNIQUE `(client_id, token)` vivo en prod rompe el upsert). `is_active=true, last_seen_at=now(), provider='fcm'`. → `200 { ok:true }`.
`DELETE /api/mobile/push/token` body `{ device_id }` → `is_active=false` (no borra) → `200 { ok:true }`.

Errores generales: JSON `{ error, message }`; nunca HTML. Cualquier excepción no controlada → 500 `{ error:'INTERNAL', message:'Algo salió mal. Probá de nuevo.' }` y `console.error('[api/mobile] ...')`.

---

## 2. Auth de clientes — Edge Function `client-auth` v2 (OTP por WhatsApp)

Archivo: `supabase/functions/client-auth/index.ts` (deploy `--no-verify-jwt`; la función valida a mano). Requiere la tabla §3.1.

### 2.1 Request / responses
`POST /functions/v1/client-auth` con `apikey: <anon>`; body JSON:
```ts
type Req =
  | { action: 'start';  phone: string; device_id: string; device_secret: string; org_id: string }
  | { action: 'verify'; phone: string; device_id: string; device_secret: string; org_id: string; code: string; name?: string }
```
- `phone`: lo que tipeó el usuario (dígitos, sin +54). Normalización en el server (§2.3).
- `device_secret`: ≥32 chars, random generado en el dispositivo (se guarda en Keychain). Es la "contraseña del dispositivo".

Responses (`200`):
```ts
{ status: 'ok', access_token, refresh_token, client_id, name, is_new_client, phone }          // sesión lista
{ status: 'otp_sent', phone_masked: '+54 9 351 ••• 5249', expires_in: 600, resend_in: 45, client_known: boolean, first_name: string|null }
```
Errores (`4xx/5xx` `{ error: CODE, message }`): `BAD_REQUEST`, `INVALID_PHONE` (menos de 8 dígitos), `ORG_NOT_FOUND`, `RATE_LIMITED` (con `retry_in` segundos), `OTP_DELIVERY_FAILED` (Meta rechazó el envío; `message` humano), `OTP_INVALID` (con `attempts_left`), `OTP_EXPIRED`, `OTP_NOT_FOUND` (no hay desafío para ese phone+device: volver a start), `NAME_REQUIRED` (cliente nuevo sin nombre), `AUTH_FAILED` (500), `CONFLICT` (409: el alias de email ya pertenece a otro cliente; no debería pasar).

### 2.2 Lógica
`start`:
1. Validar body; `org_id` debe existir y estar `is_active`.
2. Normalizar teléfono (§2.3) → `{ e164, national10, whatsapp }`.
3. `client = rpc find_client_id_by_phone(org_id, national10 ?? e164)` (service role; match últimos 10 dígitos). Si existe, leer `clients(id, name, auth_user_id)`.
4. **Login silencioso (dispositivo conocido)**: si `client.auth_user_id` → `auth.admin.getUserById` para obtener el email alias → `signInWithPassword({ email, password: device_secret })`. Si OK → `status:'ok'` (actualizar `last_login_at`). Si falla → seguir a OTP. **NUNCA** resetear la password acá.
5. Rate-limit con RPC `check_rate_limit`: `client_otp_phone` key `${org_id}:${national10|e164}` **3/600 s**; `client_otp_ip` key IP **10/3600 s** (IP de `x-forwarded-for`). Si no permitido → 429 `RATE_LIMITED`.
6. Generar código de 6 dígitos con `crypto.getRandomValues`. `code_hash = sha256(`${code}:${pepper}`)` con `pepper = Deno.env.get('OTP_PEPPER') ?? SUPABASE_SERVICE_ROLE_KEY.slice(0,32)`.
7. Invalidar desafíos previos del mismo `(org, phone_tail, device_id)` (`consumed_at = now()` donde pendiente) e insertar uno nuevo (`expires_at = now() + 10 min`).
8. **Teléfonos de prueba**: env `AUTH_TEST_PHONES` = lista `national10=code` separada por comas (ej. `1100000000=123456,1100000001=123456`). Si el teléfono está → no enviar nada, guardar el desafío con el hash del código fijo, responder `otp_sent` normal. (Para el reviewer de Apple/Google y para tests.)
9. Enviar WhatsApp (§2.4). Si falla → borrar el desafío y 502 `OTP_DELIVERY_FAILED`.
10. Responder `otp_sent` con `client_known = !!client`, `first_name = primer token de client.name` (si el nombre no es sólo dígitos).

`verify`:
1. Buscar desafío pendiente por `(org_id, phone_tail, device_id)` con `consumed_at IS NULL` ordenado por `created_at desc limit 1`. No hay → 404 `OTP_NOT_FOUND`. Expirado → 410 `OTP_EXPIRED` (y consumirlo). `attempts >= 5` → 429 `RATE_LIMITED`.
2. Comparar `code_hash` en tiempo constante. Mismatch → `attempts++` → 401 `OTP_INVALID { attempts_left }`.
3. Éxito → `consumed_at = now()`.
4. find‑or‑create cliente: si no existía, **exigir `name`** (trim ≥2, ≤80; si falta → 400 `NAME_REQUIRED`) e insertar `clients { organization_id, phone: national10 ?? e164, name }`. Si existía y viene `name` válido y el nombre guardado es vacío/sólo dígitos → actualizarlo; si no, no tocar.
5. Usuario de Auth:
   - si `client.auth_user_id` → `auth.admin.updateUserById(uid, { password: device_secret, app_metadata: { user_type: 'client', client_id: client.id, organization_id: null } })` (merge: deja `organization_id` en null explícitamente).
   - si no → `auth.admin.createUser({ email: `${national10 ?? e164}@monaco.internal`, password: device_secret, email_confirm: true, app_metadata: { user_type:'client', client_id: client.id, organization_id: null } })`. Si el email ya existe: `listUsers`/`getUserByEmail` → si ese user no está vinculado a otro `clients.auth_user_id` → vincularlo (update password+metadata); si está vinculado a OTRO cliente → crear con alias `${e164}@monaco.internal`. Luego `clients.update({ auth_user_id })` (si falla → `deleteUser` rollback → 500).
6. `signInWithPassword` → sesión. `clients.last_login_at = now()`. Responder `status:'ok'`.

### 2.3 Normalización de teléfono (Argentina por defecto, país `54`)
Función pura `normalizarTelefonoAR(input: string): { e164: string; national10: string|null; whatsapp: string; masked: string } | null`:
- `d = dígitos`. Si `d` empieza con `00` → sacar `00`. Si empieza con `0` → sacar el `0` inicial (troncal).
- Si empieza con `549` y len 13 → `national10 = d.slice(3)`, `e164 = '+' + d`, `whatsapp = d`.
- Si empieza con `54` y len 12 → `national10 = d.slice(2)`, `e164 = '+549' + national10`, `whatsapp = '549' + national10`.
- Si len 11 y empieza con `9` → `national10 = d.slice(1)`.
- Si len 10 → `national10 = d`; `e164 = '+549' + d`; `whatsapp = '549' + d`.
- Si quedan 8–9 dígitos (fijo sin característica) → `national10 = null`, `e164 = '+54' + d`, `whatsapp = '54' + d`.
- Otro país (`+` y no 54): `e164 = '+' + d`, `national10 = null`, `whatsapp = d`. Menos de 8 dígitos → `null` (INVALID_PHONE).
- `masked`: `+54 9 351 ••• 5249` (mostrar prefijo + primeros 3 del nacional + últimos 4).
- `phone_tail` para la tabla = últimos 10 dígitos de `whatsapp`.
La misma función vive en `_shared/phone.ts` y hay una copia Dart en la app sólo para el **masking/formateo** (la validez la decide el server).

### 2.4 Envío del OTP por WhatsApp (Meta Cloud API)
- Credenciales: `organization_whatsapp_config` (`whatsapp_access_token`, `whatsapp_phone_id`, `whatsapp_business_id`) filtrando `organization_id` e `is_active`. Helper compartido `supabase/functions/_shared/meta-wa.ts` → `sendTemplate({ accessToken, phoneId, to, templateName, language, components })` con `META_API_VERSION = 'v21.0'` y manejo de `error.code`/`error.message` de Meta.
- Template AUTHENTICATION: nombre `monaco_codigo_acceso`, idioma `es`, body con 1 variable (el código) y botón OTP `COPY_CODE`. Payload de envío:
```json
{ "messaging_product":"whatsapp","to":"549...","type":"template",
  "template":{ "name":"monaco_codigo_acceso","language":{"code":"es"},
    "components":[
      {"type":"body","parameters":[{"type":"text","text":"123456"}]},
      {"type":"button","sub_type":"url","index":"0","parameters":[{"type":"text","text":"123456"}]}
    ]}}
```
- Nombre y lenguaje del template configurables por env: `AUTH_WA_TEMPLATE` (default `monaco_codigo_acceso`), `AUTH_WA_TEMPLATE_LANG` (default `es`).
- Script para CREAR el template en la WABA (una vez): `scripts/meta/crear-template-otp.mjs` en el dashboard; lee `META_ACCESS_TOKEN` y `META_WABA_ID` de env y hace `POST https://graph.facebook.com/v21.0/{WABA}/message_templates` con:
```json
{ "name":"monaco_codigo_acceso","language":"es","category":"AUTHENTICATION",
  "components":[ {"type":"BODY","add_security_recommendation":true},
                 {"type":"FOOTER","code_expiration_minutes":10},
                 {"type":"BUTTONS","buttons":[{"type":"OTP","otp_type":"COPY_CODE"}]} ] }
```
y después consulta `GET /{WABA}/message_templates?name=monaco_codigo_acceso` e imprime el `status`.

---

## 3. Migraciones SQL (`supabase/migrations/`), numeradas a partir de **191**

Todas idempotentes (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP POLICY IF EXISTS`), autosuficientes (cuerpos completos), comentarios en español, `SECURITY DEFINER` + `SET search_path = public, pg_temp` en toda función nueva, grants explícitos. **Antes de aplicar, leer el cuerpo VIVO** de `get_user_org_id()` con `pg_get_functiondef` y conservar sus ramas (tiene 5: `active_organization_id`, `organization_id`, `staff`, `organization_members`, `clients`).

### 3.1 `191_client_auth_otp.sql`
```sql
create table if not exists public.client_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  phone_e164 text not null,
  phone_tail text not null,          -- últimos 10 dígitos
  device_id text not null,
  code_hash text not null,
  attempts int not null default 0,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  ip text
);
create index if not exists idx_client_otp_lookup on client_otp_challenges (organization_id, phone_tail, device_id, created_at desc) where consumed_at is null;
create index if not exists idx_client_otp_expires on client_otp_challenges (expires_at);
alter table client_otp_challenges enable row level security;
-- grants: revoke all from anon, authenticated; sólo service_role. Policy service_role_only.
```
+ función `cleanup_client_otp_challenges()` (borra `expires_at < now() - interval '1 day'`) y `cron.schedule('cleanup-client-otp', '17 4 * * *', ...)` (idempotente: `cron.unschedule` si existe).

### 3.2 `192_client_rls_hardening.sql` (cerrar el agujero org‑wide de los clientes)
1. `get_user_org_id()`: al principio, `IF coalesce(auth.jwt()->'app_metadata'->>'user_type','') = 'client' THEN RETURN NULL; END IF;` y **eliminar la rama 5** (`clients.auth_user_id`). Conservar TODO lo demás del cuerpo vivo (leerlo con `pg_get_functiondef`).
2. Nueva función helper `public.current_client_id() returns uuid` (`security definer`, `stable`): `select id from clients where auth_user_id = auth.uid() limit 1`; grant execute a authenticated.
3. Policies propias (crear si no existen):
   - `clients`: `clients_update_own` UPDATE TO authenticated USING (auth_user_id = auth.uid()) WITH CHECK (auth_user_id = auth.uid()); `clients_select_own` SELECT USING (auth_user_id = auth.uid()) — (ya lo cubre `clients_read_by_org` con su `OR`, pero dejarla explícita).
   - `visits`: `visits_read_own_client` SELECT TO authenticated USING (client_id = current_client_id()).
   - `reward_catalog`: `reward_catalog_read_client` SELECT TO authenticated USING (is_active AND organization_id = (select organization_id from clients where auth_user_id = auth.uid() limit 1)).
   - `client_points`, `point_transactions`, `client_rewards`, `client_loyalty_state`, `review_requests`, `client_reviews`, `client_notifications`, `client_device_tokens`, `appointments`, `appointment_services`: verificar que exista una policy SELECT propia por `auth.uid()`; crearla si falta (nombres `*_select_own_client`). `appointments_select_own_client` y `appt_services_select_own_client` existen en prod pero NO en el repo: **re-declararlas acá** (idempotente) para que el repo las tenga.
   - `client_device_tokens`: reemplazar `client_manage_own_tokens` por policies SELECT/INSERT/UPDATE/DELETE con USING y WITH CHECK `client_id = current_client_id()`; **drop `staff_read_tokens`**.
   - `partner_benefits`/`partner_benefit_redemptions`: ya scoped por auth.uid(); no tocar.
4. `deduct_client_points(p_client_id, p_amount)`: está con EXECUTE a PUBLIC. Grep call-sites en ambos repos (`Monaco-mobile/lib`, `MonacoSmartBarber/src`, edge functions). Si no la llama nadie desde la app → `revoke execute from public, anon, authenticated` (queda service_role). Si la llama la app, reescribir para que ignore `p_client_id` y use `current_client_id()`.
5. Actualizar los auth users de clientes existentes: `update auth.users set raw_app_meta_data = (coalesce(raw_app_meta_data,'{}'::jsonb) - 'organization_id') || jsonb_build_object('user_type','client') where email like '%@monaco.internal';` y setear `client_id` en app_metadata desde `clients.auth_user_id`.
6. `delete_client_account(p_auth_user_id uuid)` (mig 091 nunca aplicada): crearla acá con el cuerpo de `091_delete_client_account.sql` verificado contra las tablas vivas (todas existen). Grant sólo `service_role`.
7. Verificación obligatoria post‑apply (documentar en el informe): con `set local role authenticated; set local request.jwt.claims = '{"sub":"<uid de un cliente real>","role":"authenticated","app_metadata":{"user_type":"client"}}'` → `select count(*) from visits` debe ser sólo las suyas; `select count(*) from clients` sólo 1 (más los de `clients_anon_read` en fila); `select get_user_org_id()` NULL; `select count(*) from reward_catalog` > 0 (catálogo activo de Monaco); `select count(*) from appointments` sólo los suyos; `update clients set name = name where id <> <suyo>` → 0 filas. Y con un JWT de STAFF real (tomar un `auth_user_id` de `staff` activo) → `get_user_org_id()` sigue devolviendo la org.

### 3.3 `193_push_notifications.sql`
```sql
-- tokens
alter table client_device_tokens
  add column if not exists provider text not null default 'fcm' check (provider in ('fcm')),
  add column if not exists last_seen_at timestamptz,
  add column if not exists app_version text,
  add column if not exists last_error text,
  add column if not exists last_error_at timestamptz;
-- preferencias
create table if not exists client_notification_preferences (
  client_id uuid primary key references clients(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  campaigns boolean not null default true,
  appointment_reminders boolean not null default true,
  appointment_updates boolean not null default true,   -- cancelaciones / cambios hechos por la barbería
  rewards boolean not null default true,
  updated_at timestamptz not null default now()
);  -- RLS: cliente own select/insert/update (client_id = current_client_id()); service_role all.
-- configuración por org (lo que el dueño toca en el dashboard)
create table if not exists push_settings (
  organization_id uuid primary key references organizations(id) on delete cascade,
  reminders_enabled boolean not null default true,
  reminder_hours int[] not null default '{24,2}',
  reminder_title text not null default 'Recordatorio de turno',
  reminder_body_24h text not null default 'Mañana a las {{hora}} te esperamos en {{sucursal}} con {{barbero}}.',
  reminder_body_2h text not null default 'Tu turno es a las {{hora}} en {{sucursal}}. ¡Te esperamos!',
  appointment_cancelled_enabled boolean not null default true,
  appointment_cancelled_body text not null default 'Tu turno del {{fecha}} a las {{hora}} en {{sucursal}} fue cancelado. Podés reservar otro desde la app.',
  rewards_enabled boolean not null default true,
  reward_body text not null default '¡Tenés un premio nuevo! Entrá a la app para verlo.',
  updated_at timestamptz not null default now()
);  -- RLS: org (get_user_org_id()) select/update para staff; service_role all. Insertar fila de Monaco.
-- campañas
create table if not exists push_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  title text not null check (char_length(title) <= 65),
  body text not null check (char_length(body) <= 240),
  image_url text,
  deep_link text,                        -- ruta interna de la app: /home, /turnos, /rewards, /points, /catalog, /billboard, /branch/<uuid>, /convenios
  data jsonb not null default '{}',
  audience_filters jsonb not null default '{}',   -- mismo shape que AudienceFilters de client-segments.ts
  status text not null default 'draft' check (status in ('draft','scheduled','sending','sent','cancelled','failed')),
  scheduled_for timestamptz,
  started_at timestamptz, completed_at timestamptz,
  audience_count int, sent_count int not null default 0, failed_count int not null default 0, no_token_count int not null default 0,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);  -- RLS: org select/insert/update/delete; service_role all. índice (organization_id, created_at desc).
-- outbox
create table if not exists push_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  client_id uuid not null references clients(id) on delete cascade,
  kind text not null check (kind in ('campaign','appointment_reminder','appointment_update','reward','points','manual','test')),
  title text not null, body text not null, image_url text,
  data jsonb not null default '{}', deep_link text,
  campaign_id uuid references push_campaigns(id) on delete set null,
  appointment_reminder_id uuid references appointment_reminders(id) on delete set null,
  appointment_id uuid,
  scheduled_for timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','skipped','cancelled')),
  attempts int not null default 0, last_attempt_at timestamptz, last_error text, sent_at timestamptz,
  created_at timestamptz not null default now()
);  -- índice parcial (scheduled_for) where status='pending'; índice (campaign_id). RLS: sólo service_role. NO agregar a supabase_realtime.
-- bandeja in-app
alter table client_notifications
  add column if not exists organization_id uuid,
  add column if not exists deep_link text,
  add column if not exists read_at timestamptz,
  add column if not exists push_outbox_id uuid;
-- backfill organization_id desde clients; reemplazar CHECK de type por ('review_request','reward','promo','alert','appointment_reminder','appointment_update','campaign','points','test').
-- appointment_reminders: CHECK status agregar 'skipped'; trigger trg_enqueue_appointment_reminders pasar a AFTER INSERT OR UPDATE OF status con WHEN (NEW.status IN ('scheduled','confirmed') AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status)). Leer antes el cuerpo vivo de fn_enqueue_appointment_reminders() y conservarlo; que respete push_settings.reminder_hours (kinds push_24h/push_2h siguen existiendo; si reminder_hours no incluye 24 o 2, no crear ese kind).
```
Funciones:
- `claim_pending_push(p_batch_size int default 100) returns setof push_outbox` (copiar patrón de `claim_pending_messages`: `FOR UPDATE SKIP LOCKED`, `status='processing', attempts+1, last_attempt_at=now()`). Grant service_role.
- `enqueue_due_appointment_reminders() returns int`: mueve `appointment_reminders` `pending` con `scheduled_for <= now()` de kind `push_24h|push_2h` cuyo turno sigue `confirmed|scheduled|checked_in` a `push_outbox` (kind `appointment_reminder`, título/cuerpo desde `push_settings` con reemplazo de `{{hora}}`,`{{fecha}}`,`{{sucursal}}`,`{{barbero}}`,`{{nombre}}`, `deep_link='/turnos'`, `data = {type:'appointment_reminder', value: appointment_id}`), respetando `push_settings.reminders_enabled` y `client_notification_preferences.appointment_reminders` (si false → reminder `skipped`). Marca el reminder `sent` al encolar (el outbox lleva el estado real) — documentarlo.
- Trigger `trg_push_on_appointment_cancelled` AFTER UPDATE OF status ON appointments WHEN (NEW.status='cancelled' AND NEW.cancelled_by IN ('staff','system') AND OLD.status <> 'cancelled') → inserta en `push_outbox` kind `appointment_update` si `push_settings.appointment_cancelled_enabled` y preferencia del cliente.
- Trigger `trg_push_on_client_reward` AFTER INSERT ON client_rewards WHEN (NEW.status='available') → outbox kind `reward` (`deep_link='/rewards'`) si `push_settings.rewards_enabled` y preferencia.
- `trigger_send_push()` (SECURITY DEFINER, igual que `trigger_process_workflow_delays`): `perform enqueue_due_appointment_reminders();` y luego `net.http_post(url := <supabase_url>/functions/v1/send-push, headers := Bearer vault service_role_key)`. La URL de Supabase: leerla de vault (`supabase_url` — crear el secreto si no existe con `https://gzsfoqpxvnwmvngfoqqk.supabase.co`) o derivarla como hace el job 1 (`process-scheduled-messages`): **copiar exactamente el mecanismo del job 1** (leer `cron.job` jobid 1 con `select command from cron.job where jobid=1`).
- `cron.schedule('send-push-outbox', '* * * * *', $$select public.trigger_send_push()$$)`; `cron.unschedule('process_appointment_reminders')` (job 14, inactivo y roto).
- Permisos de roles: agregar claves `notifications.view` / `notifications.manage` a los roles que tengan `comprobantes.manage` (patrón de mig 138 / role-templates).

### 3.4 Verificación de 193
Insertar un `push_outbox` de prueba kind `test` para un cliente sin tokens → `send-push` debe marcarlo `skipped` (sin tokens) y NO fallar. Chequear `net._http_response` 200 después de un minuto del cron.

---

## 4. Edge functions (Deno) — `supabase/functions/`

Estructura: `_shared/meta-wa.ts` (envío de templates WA), `_shared/phone.ts` (normalización), `_shared/fcm.ts` (OAuth2 service account + envío FCM v1), `_shared/cors.ts`.

### 4.1 `send-push` (reescritura total; mismo slug; deploy `--no-verify-jwt`, auth por `Authorization: Bearer <SERVICE_ROLE_KEY>` como `process-scheduled-messages:76-80`)
- `claim_pending_push(100)` → por fila: preferencias → tokens `client_device_tokens` activos del cliente → por token `POST https://fcm.googleapis.com/v1/projects/{PROJECT_ID}/messages:send` con access token OAuth2 (JWT RS256 firmado con `FCM_SERVICE_ACCOUNT_JSON`, scope `https://www.googleapis.com/auth/firebase.messaging`, cacheado 50 min en memoria del isolate). Mensaje: `{ message: { token, notification: { title, body, image? }, data: { type, value, deep_link, notification_id } /* todo string */, android: { priority: 'HIGH', notification: { channel_id: 'monaco_default', sound: 'default' } }, apns: { headers: { 'apns-priority': '10' }, payload: { aps: { sound: 'default', badge: 1 } } } } }`.
- Resultados: `UNREGISTERED`/`INVALID_ARGUMENT` (en `error.details[].errorCode` o status 404/400) → token `is_active=false, last_error`; 429/5xx/timeout → `pending` con backoff (`scheduled_for = now() + 5/15/45 min` según attempts), `MAX_ATTEMPTS=3` → `failed`; éxito en ≥1 token → `sent` + insertar `client_notifications` (type según kind: `campaign|appointment_reminder|appointment_update|reward|points|test`, `organization_id`, `deep_link`, `data`, `push_outbox_id`). Sin tokens → `skipped`. Concurrencia acotada (8). Al terminar, si `campaign_id`, actualizar contadores de `push_campaigns` (sent/failed/no_token) y si no quedan pending de esa campaña → `status='sent', completed_at`.
- **Modo sin Firebase**: si falta `FCM_SERVICE_ACCOUNT_JSON` → marcar todo `failed` con `last_error='FCM no configurado'` y responder `{ ok:false, reason:'FCM_NOT_CONFIGURED' }` (200). No tirar.
- Respuesta `{ processed, sent, failed, skipped }`.

### 4.2 `client-auth` → §2.
### 4.3 `delete-client-account` → deployar la que está en el repo (verify_jwt: false; valida el Bearer a mano con `auth.getUser`). Probar con un cliente de prueba creado ad hoc y borrarlo.
### 4.4 `appointment-reminders` (repo, no deployada): **borrar el directorio** — su trabajo lo hace `enqueue_due_appointment_reminders()` + `send-push`. Actualizar docs.

---

## 5. Dashboard — `/dashboard/app-movil` → pestaña **Notificaciones**

> 22/ago/2026: el dueño pidió que TODO lo de la app se gestione desde App Móvil. La pantalla es la pestaña `notificaciones` de `src/app/dashboard/app-movil/` (`?tab=notificaciones`); los componentes siguen en `src/app/dashboard/notificaciones/` y esa ruta **redirige**. No hay ítem propio en el menú.

- Permisos: `notifications.view` / `notifications.manage` en `src/lib/permissions.ts` (categoría "Notificaciones push") + `src/lib/role-templates.ts` (owner/admin todo; recepcionista view).
- Nav: no tiene ítem propio — se entra por "APP Móvil" (`rewards.view`); la pestaña se gatea aparte por `notifications.view` (sin permiso se muestra bloqueada con el nombre del permiso que falta).
- Página `src/app/dashboard/notificaciones/page.tsx` (server component) + `notificaciones-client.tsx`. Tres bloques:
  1. **Campañas**: tabla (nombre, título, audiencia, estado, enviados/fallidos/sin app, fecha) + botón "Nueva campaña" → hoja/dialog con: título (contador 65), cuerpo (contador 240), imagen opcional (`src/lib/actions/uploads.ts` o URL), destino (select: Inicio `/home`, Mis turnos `/turnos`, Premios `/rewards`, Puntos `/points`, Catálogo `/catalog`, Cartelera `/billboard`, Convenios `/convenios`, Sucursal → `/branch/<id>` con select de sucursal), audiencia = reutilizar el componente de filtros de difusiones de `/dashboard/mensajeria` (o un subconjunto: segmentos + sucursal + última visita) con `previewAudience` **más** el conteo "con la app y notificaciones activas" (clientes del filtro con token activo y `campaigns=true`), programar (fecha+hora en TZ de la org) o enviar ahora, "Enviarme una prueba" (al cliente cuyo teléfono es el del staff logueado, si existe) . Vista previa estilo notificación de iOS.
  2. **Automáticas** (`push_settings`): toggles + textos editables con las variables `{{nombre}} {{hora}} {{fecha}} {{sucursal}} {{barbero}}`, horas de recordatorio (chips 24h / 2h / custom), guardar.
  3. **Dispositivos**: "N clientes con la app instalada (tokens activos)", últimos registros (sin tokens en claro).
- Server actions `src/lib/actions/push-notifications.ts` (`'use server'`, `createAdminClient`, `getCurrentOrgId`, `currentUserCan`): `getPushOverview()`, `listPushCampaigns()`, `previewPushAudience(filters)`, `createPushCampaign(input)`, `sendPushCampaign(id)` (claim atómico `draft|scheduled → sending`; `getFilteredClientIds(filters)`; filtrar clientes con token activo y preferencia `campaigns`; insertar `push_outbox` en chunks de 500 con `scheduled_for = campaign.scheduled_for ?? now()`; actualizar `audience_count`, `no_token_count`), `cancelPushCampaign(id)` (outbox pending → cancelled), `sendTestPush()`, `getPushSettings()`, `savePushSettings(input)` (Zod). Programadas: el cron `trigger_send_push` sólo envía `push_outbox` con `scheduled_for <= now()`, así que "programar" = encolar ahora con `scheduled_for` futuro; `cancelPushCampaign` lo deshace.
- Vista previa de la cuenta de audiencia NO puede tardar: una sola query con `in` de ids en chunks.

---

## 6. App Flutter — arquitectura del rediseño

### 6.1 Decisiones
- **Mono‑org**: `AppConstants.organizationId/organizationSlug` fijos. Se elimina `features/org_selection`. La **sucursal** se elige en el onboarding (después del OTP) y se puede cambiar desde Home (pill) y Perfil. `AuthState` pierde `selectedOrg*` y gana `clientPhone`, y `AuthStatus.needsBranch`.
- **Auth OTP**: flujo `/login` (teléfono) → `start` → si `ok` → home; si `otp_sent` → `/login/codigo` (6 casillas, auto‑submit, reenviar con countdown `resend_in`, "Cambiar número") → si `client_known=false` → `/login/nombre` ANTES de verify (el nombre viaja en `verify`) → home. Biometría/PIN = gates locales opcionales (pantalla `/pin` de verificación NUEVA, PIN local hasheado en SecureStorage; los RPC `set_client_pin/verify_client_pin` dejan de usarse).
- **Sesión**: `Supabase.initialize(..., authOptions: FlutterAuthClientOptions(localStorage: SecureLocalStorage()))` con `flutter_secure_storage` (clase en `core/auth/secure_local_storage.dart`).
- **Turnos nativos**: `core/api/mobile_api.dart` (cliente HTTP con Bearer, timeouts, errores tipados `MobileApiException(code, message, status)`), `features/appointments/**` (modelos, repositorio, providers, wizard). Se borra `booking_webview_screen.dart` y la dependencia `webview_flutter`.
- **Push**: `core/push/push_service.dart` (registro de token vía `POST /api/mobile/push/token`, refresh, baja en logout), `core/push/push_handler.dart` (deep links `data.deep_link`/`type`), `features/notifications/**` (bandeja `client_notifications` con Realtime + preferencias). Firebase sigue en placeholders hasta que el dueño corra `flutterfire configure`; TODO el código tolera `Firebase.apps.isEmpty`.
- **Dock**: 5 items → Inicio `/home`, Turnos `/turnos`, Sucursales `/occupancy`, Premios `/rewards`, Perfil `/profile`.
- **Estética**: Liquid Glass en TODAS las pantallas (se retira el "legacy Material" con `MonacoColors.gold`): fondo `MonacoColors.background` (#0A0A0A) uniforme, láminas glass, acento `monacoGreen`, tipografía Poppins (bundleada en `assets/fonts/`), íconos Material `_rounded`, animaciones `liquidEnter`. Marca: monograma "M" y wordmark MONACO [BARBER STUDIO] (assets `assets/images/monaco_m.png`, `assets/images/monaco_wordmark.png`). Onboarding/splash/login pueden usar `LiquidBackdrop(orbColors: [monacoGreen, deepBlue, deepViolet], intensity: 0.55)`; Home se mantiene sobrio (sin orbes) como está hoy.
- Widgets glass nuevos en `lib/app/widgets/glass/` (los escribe el coordinador, NO los agentes): `LiquidTextField`, `LiquidSheet` (`showLiquidSheet`), `LiquidToast` (`showLiquidToast`), `LiquidDialog` (`showLiquidDialog`), `LiquidSkeleton`, `LiquidEmptyState`, `LiquidErrorState`, `LiquidChip`, `LiquidAvatar`, `MonacoLogo`. Usarlos; no duplicar.

### 6.2 Archivos que SÓLO escribe el coordinador (no tocar): `pubspec.yaml`, `lib/main.dart`, `lib/app/app.dart`, `lib/core/router/app_router.dart`, `lib/core/utils/constants.dart`, `lib/app/theme/*`, `lib/app/widgets/glass/*`. Si necesitás una ruta/dep/token nuevo: anotalo en tu informe final y seguí con un stub local.

### 6.3 Rutas (go_router) — nombres de clase y paths de archivo EXACTOS
| Path | Clase | Archivo |
|---|---|---|
| `/splash` | `SplashScreen` | `lib/features/onboarding/presentation/screens/splash_screen.dart` |
| `/welcome` | `WelcomeScreen` | `.../onboarding/presentation/screens/welcome_screen.dart` |
| `/login` | `LoginPhoneScreen` | `.../onboarding/presentation/screens/login_phone_screen.dart` |
| `/login/codigo` | `LoginCodeScreen` | `.../onboarding/presentation/screens/login_code_screen.dart` |
| `/login/nombre` | `LoginNameScreen` | `.../onboarding/presentation/screens/login_name_screen.dart` |
| `/biometric` | `BiometricGateScreen` | `.../onboarding/presentation/screens/biometric_gate_screen.dart` |
| `/pin` | `PinVerifyScreen` | `lib/features/profile/presentation/screens/pin_verify_screen.dart` |
| `/pin-setup` | `PinSetupScreen` | `lib/features/profile/presentation/screens/pin_setup_screen.dart` |
| `/elegir-sucursal` (query `?onboarding=1`) | `BranchPickerScreen({required bool onboarding})` | `lib/features/branch_selection/presentation/screens/branch_picker_screen.dart` |
| shell `/home` | `HomeScreen` | `lib/features/home/presentation/screens/home_screen.dart` |
| shell `/turnos` | `MyAppointmentsScreen` | `lib/features/appointments/presentation/my_appointments_screen.dart` |
| shell `/occupancy` | `OccupancyScreen` | existente |
| shell `/rewards` | `RewardsScreen` | existente |
| shell `/profile` | `ProfileScreen` | existente |
| `/turnos/reservar` (query `?branch=<slug>` opcional) | `BookingWizardScreen({String? branchSlug})` | `lib/features/appointments/presentation/booking_wizard_screen.dart` |
| `/turnos/:id` | `AppointmentDetailScreen({required String appointmentId})` | `lib/features/appointments/presentation/appointment_detail_screen.dart` |
| `/notificaciones` | `NotificationsScreen` | `lib/features/notifications/presentation/screens/notifications_screen.dart` |
| `/notificaciones/preferencias` | `NotificationPreferencesScreen` | `lib/features/notifications/presentation/screens/notification_preferences_screen.dart` |
| `/branch/:id`, `/points`, `/catalog`, `/reviews`, `/review/:token`, `/reward-qr/:id`, `/billboard`, `/convenios`, `/convenio/:id`, `/mis-canjes`, `/visits` | existentes (mismos nombres) | existentes |
Rutas eliminadas: `/select-org`, `/select-branch`, `/appointments`, `/appointments/book`.

### 6.4 AuthState (lib/core/auth/auth_provider.dart) — API que los demás consumen
```dart
enum AuthStatus { initial, unauthenticated, needsBiometric, needsBranch, authenticated }
class AuthState {
  final AuthStatus status; final String? clientId; final String? clientName; final String? clientPhone;
  final String? selectedBranchId; final String? selectedBranchName; final String? selectedBranchSlug;
  final String? selectedBranchOperationMode; final bool isNewClient; final String? error;
  bool get hasBranch; bool get acceptsAppointments; bool get acceptsWalkIn; String get firstName;
}
// AuthNotifier: Future<StartResult> startLogin(String phone); Future<void> verifyCode(String code, {String? name});
// Future<void> setSelectedBranch(...); Future<void> logout(); Future<String?> deleteAccount(); completeBiometric();
// void updateClientName(String name);  (actualiza estado + SecureStorage, la persistencia remota la hace quien llama)
// Providers auxiliares existentes: selectedBranchIdProvider, selectedBranchNameProvider (core/branch/selected_branch_provider.dart) se mantienen; agregar selectedBranchSlugProvider y selectedBranchProvider (objeto).
```
`StartResult { final bool sessionReady; final bool otpSent; final String? phoneMasked; final int expiresIn; final int resendIn; final bool clientKnown; final String? firstName; }`

### 6.5 `MobileApi` (lib/core/api/mobile_api.dart) — la escribe el agente de turnos; la usan push y perfil
```dart
final mobileApiProvider = Provider<MobileApi>((ref) => MobileApi(ref.watch(supabaseClientProvider)));
class MobileApi {
  Future<Map<String, dynamic>> getJson(String path, {Map<String, String>? query});
  Future<Map<String, dynamic>> postJson(String path, Map<String, dynamic> body);
  Future<Map<String, dynamic>> deleteJson(String path, Map<String, dynamic> body);
  // Bearer = Supabase.instance.client.auth.currentSession?.accessToken (refresca si está por vencer); timeout 15 s; lanza MobileApiException(code, message, status).
}
```

### 6.6 Modo prueba (sucursal Test)
`SecureStorageService.isTestModeEnabled()` / `setTestModeEnabled(bool)`. Se activa tocando 7 veces la "Versión x.y.z" en Perfil (muestra toast "Modo prueba activado"). `branchesProvider` filtra `is_test` salvo que esté activo.

### 6.7 Push — contrato de datos del payload
`data = { type: 'campaign'|'appointment_reminder'|'appointment_update'|'reward'|'points'|'test', value?: string, deep_link?: string, notification_id?: string }`. `PushHandler` navega con `deep_link` si existe (sólo paths internos que empiecen con `/`), si no por `type`: `appointment_*` → `/turnos`, `reward` → `/rewards`, `points` → `/points`, `campaign`/default → `/home`; y marca `client_notifications.read_at` si viene `notification_id`.

### 6.8 Calidad
- `dart analyze lib/` sin errores ni warnings en los archivos que tocás (infos de `withOpacity` existentes se toleran, pero en código NUEVO usá `withValues(alpha: x)`).
- Nada de `print`; `debugPrint` con prefijo `[modulo]`.
- Toda pantalla con lista: estados loading (skeleton), vacío (`LiquidEmptyState`), error (`LiquidErrorState` con reintentar), y `RefreshIndicator`.
- Accesibilidad básica: `Semantics`/`tooltip` en íconos sin texto; tamaños táctiles ≥ 44.
- Dentro del shell (`extendBody: true`) el padding inferior de las listas es 120 (el dock tapa).
