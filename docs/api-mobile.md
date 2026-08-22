# API mobile — `/api/mobile/**`

> **Versión**: 2026-08-20 (rediseño app mobile, CONTRACTS.md §1)
> **Base**: `https://monaco-smart-barber.vercel.app` (la app lo toma de `AppConstants.apiBaseUrl`)
> **Código**: route handlers en `src/app/api/mobile/**`, helpers en `src/lib/mobile/`
> **Alcance**: lo que la app Flutter consume por HTTP. Lo que la app lee directo por
> PostgREST (puntos, premios, notificaciones, "Mis turnos") va por RLS y no está acá.

La API es una capa fina sobre las server actions del dashboard: **no hay un segundo
motor de turnos**. Disponibilidad y creación pasan por `getAvailableSlots` /
`createAppointment` (`src/lib/actions/appointments.ts`), exactamente como el turnero web
y el kiosko. La cancelación pasa por `cancelAppointment(id, 'client')`, que cancela los
WhatsApp pendientes y la entrada de la fila, manda el template de cancelación y avisa a
la lista de espera (la RPC `cancel_appointment_by_token` que usaba la app no hacía nada
de eso).

## Reglas comunes

- **Autenticación**: `Authorization: Bearer <access_token de Supabase del cliente>` en
  TODOS los endpoints. El teléfono y el `client_id` salen del JWT
  (`clients.auth_user_id = auth.uid()`), nunca del body. Helper:
  `requireMobileClient(req)` en `src/lib/mobile/auth.ts`.
  - Sin Bearer o JWT inválido/vencido → `401 { error: 'UNAUTHENTICATED', message: 'Iniciá sesión de nuevo.' }`
  - JWT válido pero sin fila en `clients` → `403 { error: 'NO_CLIENT', message: 'Tu cuenta no está vinculada a un cliente.' }`
- **Respuestas**: siempre JSON, `Cache-Control: no-store`. Errores con forma
  `{ error: CODE, message: texto humano }`. Excepción no controlada →
  `500 { error: 'INTERNAL', message: 'Algo salió mal. Probá de nuevo.' }` (y
  `console.error('[api/mobile] ...')`). Nunca HTML.
- **Rate-limit por usuario** (`auth.uid`), no por IP — la app corre detrás del CGNAT de
  las telcos. Buckets en `RateLimits` (`src/lib/rate-limit.ts`):

  | Helper | bucket | límite | lo usan |
  |---|---|---|---|
  | `mobileBootstrap` | `mobile_bootstrap` | 30 / 60 s | `turnos/branches`, `turnos/[slug]`, `me` (GET/POST), `push/token` (POST/DELETE) |
  | `mobileSlots` | `mobile_slots` | 60 / 60 s | `turnos/[slug]/slots` |
  | `mobileBook` | `mobile_book` | 10 / 60 s | `turnos/[slug]/book` (además sigue el 3/h por teléfono de `createAppointment`) |
  | `mobileCancel` | `mobile_cancel` | 10 / 60 s | `turnos/cancel` |

  Superado → `429 { error: 'RATE_LIMITED', message }`. Además, el motor recibe
  `rateLimitKey = userId` para que su gate interno `public_booking_list` (20/min por
  IP+sucursal en el turnero web) pase a ser 60/min por usuario.
- **Fechas**: `appointment_date` + `start_time` son hora de PARED de la sucursal. La app
  usa el `server_today` que devuelve cada endpoint, no `DateTime.now()`.
- **Mono-org**: los slugs se resuelven acotados a la organización del cliente autenticado.
  Un slug de otra org es `404 BRANCH_NOT_FOUND`.
- **Reservable** = `branches.operation_mode != 'walk_in'` **y**
  `appointment_settings.is_enabled` (settings efectivos org/sucursal). Las dos cosas.
- **Fallar cerrado y con mensaje**: `slots` nunca devuelve `[]` por un error de lectura —
  devuelve `error` (ver abajo). La app distingue "no pudimos leer" de "lleno".

## Endpoints

### `GET /api/mobile/turnos/branches`

Sucursales activas de la organización del cliente, ordenadas por nombre.

```json
{
  "server_today": "2026-08-20",
  "branches": [
    {
      "id": "1264eb6e-bb7e-4c71-9110-a8b3f3acec12", "name": "Rondeau", "slug": "rondeau",
      "address": "Rondeau 30", "phone": null, "timezone": "America/Argentina/Buenos_Aires",
      "latitude": -31.4222508, "longitude": -64.1861401,
      "operation_mode": "hybrid", "bookable": true,
      "open_now": true, "hours_label": "Abierto hasta las 21:00",
      "is_test": false
    }
  ]
}
```

- `open_now` / `hours_label`: `estadoHorario()` de `src/app/turnos/[slug]/horarios.ts`
  (horario comercial `business_hours_*`, en la TZ de la sucursal).
- `is_test`: `slug === 'test'`. La app la esconde salvo en "modo prueba".

```bash
curl -s "$BASE/api/mobile/turnos/branches" -H "Authorization: Bearer $TOKEN"
```

### `GET /api/mobile/turnos/[slug]`

Bootstrap del wizard: el MISMO armado que hace `src/app/turnos/[slug]/page.tsx`
para el turnero web, más los datos del cliente.

- `404 { error: 'BRANCH_NOT_FOUND' }` — no existe, inactiva o de otra org.
- `409 { error: 'NOT_BOOKABLE', message }` — walk_in o settings apagados.
- `200`:

```json
{
  "server_today": "2026-08-20",
  "server_now": "2026-08-20T17:43:37.913Z",
  "branch": { "id": "…", "name": "Rondeau", "slug": "rondeau", "address": "Rondeau 30", "phone": null,
              "timezone": "America/Argentina/Buenos_Aires", "latitude": -31.42, "longitude": -64.18,
              "operation_mode": "hybrid" },
  "bookable": true,
  "settings": {
    "max_advance_days": 15,
    "appointment_days": [1, 2, 3, 4, 5, 6],
    "slot_interval_minutes": 45,
    "cancellation_min_hours": 2,
    "lead_time_minutes": 60,
    "buffer_minutes": 10
  },
  "branding": { "logo_url": "https://…/logo.jpeg", "welcome_message": null },
  "services": [ { "id": "…", "name": "Corte", "price": 16000, "duration_minutes": 40,
                  "booking_mode": "self_service", "availability": "checkin" } ],
  "staff": [ { "id": "…", "full_name": "Fabrizio Galeassi", "avatar_url": null,
               "days": [1, 2, 3, 4, 5, 6],
               "windows": { "1": [ { "start": "10:00", "end": "18:00" } ] } } ],
  "walk_in_staff": [ { "id": "…", "full_name": "Chipi", "avatar_url": null } ],
  "client": { "first_name": "Prueba", "last_name": "API Mobile", "phone": "1100000099",
              "upcoming": { "date": "2026-08-25", "time": "10:00" } }
}
```

- `settings.appointment_days` viene **ya recalculado**: si la sucursal tiene franjas
  (`appointment_hours`, mig 172), son los días con al menos una franja; si no,
  `appointment_settings.appointment_days`.
- `staff` = `getPublicBranchAppointmentStaff` (barberos reservables con sus días y
  franjas REALES: el cruce de su ventana con la de la sucursal, o sea lo que el motor va
  a ofrecer). `walk_in_staff` = todos los barberos de cara al cliente menos los
  reservables ("atienden sin turno").
- `client.first_name` / `last_name`: `clients.name` partido por el primer espacio. Un
  nombre que es sólo dígitos (clientes viejos creados como `name || phone`) se devuelve
  vacío. `client.upcoming` = próximo turno vivo del cliente en la org (misma query que
  `publicLookupClient`, sin RPC por teléfono), para avisar "ya tenés un turno ese día"
  ANTES de elegir nada.

```bash
curl -s "$BASE/api/mobile/turnos/rondeau" -H "Authorization: Bearer $TOKEN"
```

### `GET /api/mobile/turnos/[slug]/slots?date=YYYY-MM-DD&service_ids=a,b,c&staff_id=<uuid opcional>`

Mapeo 1:1 de `getAvailableSlots(branchId, date, serviceIds, staffId, undefined,
{ rateLimitKey: userId })`. La duración es la SUMA de los servicios.

- `400 { error: 'BAD_REQUEST', message }` — `date` no es `YYYY-MM-DD` real, `service_ids`
  vacío o con algo que no es UUID, `staff_id` inválido.
- `404 BRANCH_NOT_FOUND`, `409 NOT_BOOKABLE` (ídem bootstrap), `429 RATE_LIMITED`.
- `200`:

```json
{
  "server_today": "2026-08-20",
  "slots": [
    { "staff_id": "…", "staff_name": "Tony ramirez", "staff_avatar_url": "https://…",
      "slots": [ { "time": "10:00", "available": true }, { "time": "10:45", "available": false } ] }
  ],
  "error": "Día no habilitado para turnos"
}
```

- **Si el motor devuelve `error`, la respuesta es 200 con `error` string** (y `slots`
  tal cual vino, normalmente `[]`). No se colapsa a `[]`: la app muestra "no pudimos
  leer / día no habilitado", no "Lleno". Textos posibles del motor: `Día no habilitado
  para turnos`, `Fecha fuera del rango permitido`, `Barbero no disponible para turnos`,
  `Ese barbero no toma turnos ese día`, `No pudimos leer la disponibilidad. Reintentá en
  un momento.`, `Demasiadas consultas, esperá un momento`.
- La grilla trae también los `available: false` (la grilla es completa). `slots: []` sin
  `error` = nadie toma turnos ese día (o la sucursal no tiene `appointment_staff`).

```bash
curl -s "$BASE/api/mobile/turnos/rondeau/slots?date=2026-08-21&service_ids=e3478dc1-3066-4674-ac5c-6239cb907daa" \
  -H "Authorization: Bearer $TOKEN"
```

### `POST /api/mobile/turnos/[slug]/book`

```json
{ "staff_id": null, "date": "2026-08-25", "start_time": "10:00",
  "service_ids": ["5e9842ec-1b84-4885-8c86-5a8ba53d9ef8"], "duration_minutes": 30,
  "name": "Ignacio Baldovino" }
```

- `staff_id`: UUID o `null` (el motor asigna al barbero con menos turnos ese día).
- `name` opcional: se usa si tiene ≥ 2 caracteres; si no, el nombre guardado. El
  **teléfono sale del JWT**.
- Llama `createAppointment({ …, source: 'public', viaApp: true })`: `viaApp` saltea el
  gate por IP (la app ya pasó por `mobileBook`), todo lo demás sigue (3 turnos/h por
  teléfono, revalidación de disponibilidad, un turno activo por día, EXCLUSION GiST,
  WhatsApp de confirmación + recordatorios).
- `400 BAD_REQUEST` (body inválido), `404 BRANCH_NOT_FOUND`, `409 NOT_BOOKABLE`,
  `429 RATE_LIMITED`.
- `409 { error: CODE, message }` con el mismo mapeo que `publicBookAppointment`:
  `INVALID_PHONE`, `PHONE_QUOTA_EXCEEDED`, `SLOT_TAKEN` (incluye "Ese horario ya no está
  disponible, elegí otro"), `ALREADY_BOOKED_TODAY`, `TOO_LATE`, y para todo lo demás
  `BOOKING_FAILED` con el texto crudo del motor en `message` (p. ej. `Turnos no
  habilitados`, `Ese barbero no tiene horario cargado para ese día`).
- `200`:

```json
{
  "ok": true,
  "appointment": { "id": "b7f4011f-…", "organization_id": "…", "branch_id": "…", "client_id": "…",
                   "barber_id": "9eff2e2c-…", "service_id": "…", "appointment_date": "2026-08-25",
                   "start_time": "10:00:00", "end_time": "10:30:00", "duration_minutes": 30,
                   "status": "confirmed", "source": "public", "cancellation_token": "a5fea78cca4b44f096396813",
                   "payment_flag": "postpago", "payment_status": "unpaid", "…": "fila completa de appointments" },
  "cancellation_token": "a5fea78cca4b44f096396813",
  "client_is_new": false,
  "client_has_face": false
}
```

```bash
curl -s -X POST "$BASE/api/mobile/turnos/test/book" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"staff_id":null,"date":"2026-08-25","start_time":"10:00","service_ids":["5e9842ec-1b84-4885-8c86-5a8ba53d9ef8"],"duration_minutes":30}'
```

### `POST /api/mobile/turnos/cancel`

```json
{ "appointment_id": "b7f4011f-901a-4f26-9a88-7d72f955c023" }
```

- Pertenencia: `appointments.client_id` tiene que ser el cliente del JWT; si no (o si no
  existe) → `404 { error: 'NOT_FOUND' }` sin confirmar si existe.
- Llama `cancelAppointment(id, 'client')` (ventana `cancellation_min_hours`).
- `409 ALREADY_CLOSED` ("El turno ya fue cancelado o completado"),
  `409 TOO_LATE_TO_CANCEL` (`message` = "No se puede cancelar con menos de N horas de
  antelación"), `500 CANCEL_FAILED` para el resto.
- `200 { "ok": true }`.

```bash
curl -s -X POST "$BASE/api/mobile/turnos/cancel" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"appointment_id":"b7f4011f-901a-4f26-9a88-7d72f955c023"}'
```

### `GET /api/mobile/me`

Para validar la sesión al arrancar.

```json
{ "client": { "id": "…", "name": "Prueba API Mobile", "phone": "1100000099",
              "organization_id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" },
  "server_today": "2026-08-20" }
```

### `POST /api/mobile/me`

```json
{ "name": "Ignacio Baldovino" }
```
`name` se trimea y tiene que tener 2..80 caracteres (`400 BAD_REQUEST` si no). Actualiza
`clients.name`. → `200 { "ok": true, "name": "Ignacio Baldovino" }`.

### `POST /api/mobile/push/token`

```json
{ "token": "<fcm token>", "platform": "android", "device_id": "<id estable del dispositivo>", "app_version": "1.0.0" }
```

- `platform` ∈ `ios | android`; `token` ≤ 4096 chars; `device_id` ≤ 200; `app_version`
  opcional ≤ 50.
- Upsert en `client_device_tokens` **por `(client_id, device_id)`** con `is_active=true`,
  `last_seen_at=now()`, `provider='fcm'`, `app_version`. Antes se borra cualquier fila del
  mismo cliente con el MISMO `token` y otro `device_id` (el UNIQUE `(client_id, token)`
  vivo en prod rompía el upsert tras una reinstalación que regeneró el id).
- Si el dashboard se deployó antes de aplicar la **mig 193** (columnas `provider`,
  `last_seen_at`, `app_version`), el handler lo detecta (`PGRST204`) y guarda con el
  formato legacy, con un `console.warn`. Cuando la mig esté, escribe las columnas nuevas.
- `409 TOKEN_CONFLICT` sólo en una carrera (dos dispositivos registrando el mismo token a
  la vez). → `200 { "ok": true }`.

### `DELETE /api/mobile/push/token`

```json
{ "device_id": "<id estable del dispositivo>" }
```
Baja lógica: `is_active=false` (no borra). Idempotente. → `200 { "ok": true }`.

## Cambios en el motor que hizo esta API (mínimos, compatibles)

- `getAvailableSlots(..., options.rateLimitKey?)` y
  `getPublicBranchAppointmentStaff(branchId, { rateLimitKey? })`: con clave, el gate
  `public_booking_list` es 60/min por esa clave en vez de 20/min por IP+sucursal.
- `CreateAppointmentInput.viaApp?: boolean`: saltea el gate por IP igual que `viaKiosk`.
- `RateLimits.mobileSlots/mobileBook/mobileCancel/mobileBootstrap`.

`public-booking.ts` y el wizard web no se tocaron.

## Cómo probarla a mano

1. Conseguir un `access_token` de cliente (Edge Function `client-auth`, con la anon key).
2. `export BASE=http://localhost:3101 TOKEN=...` y correr los `curl` de arriba.
3. Para probar `book`/`cancel` usar la sucursal **`test`** (slug `test`), nunca una real,
   y dejar la base limpia: el turno cancelado, sus `scheduled_messages`,
   `appointment_reminders` y la conversación/mensaje que haya creado el cron de WhatsApp
   (se ejecuta cada minuto y manda la confirmación enseguida).

## Verificación del 2026-08-20 (dev server local, prod DB)

Cliente de prueba `1100000099` creado con `client-auth` y borrado al final (cliente, auth
user, turnos, mensajes, tokens y `rate_limits`): `0` filas remanentes.

| Caso | Resultado |
|---|---|
| `GET /me` sin Bearer / con Bearer basura | `401 UNAUTHENTICATED` (JSON) |
| `GET /me` | `200` con cliente y `server_today` |
| `GET /turnos/branches` | 4 sucursales; `rondeau`/`test` `bookable: true`, `caseros`/`parana` `false`; `test` `is_test: true` |
| `GET /turnos/rondeau` | `200`, 4 servicios, 4 barberos reservables con `days`/`windows`, 3 walk-in, `max_advance_days 15`, `slot_interval 45` |
| `GET /turnos/rondeau/slots` (mañana, Corte) | `200`, 4 barberos, grilla de 14 con 10–14 libres, sin `error` |
| fecha `2026-13-45` / `service_ids=nope` / sin `service_ids` | `400 BAD_REQUEST` |
| `GET /turnos/caseros` y sus `slots` | `409 NOT_BOOKABLE` |
| `GET /turnos/no-existe` | `404 BRANCH_NOT_FOUND` |
| `POST /turnos/test/book` (staff null, 2026-08-25 10:00, corte 30') | `200`, fila completa, `status confirmed`, barbero asignado; WhatsApp de confirmación encolado y enviado por el cron |
| misma reserva otra vez | `409 ALREADY_BOOKED_TODAY` |
| bootstrap después de reservar | `client.upcoming = { 2026-08-25, 10:00 }`; el slot 10:00 de ese barbero pasa a `available: false` |
| `POST /turnos/cancel` | `200`; en DB `cancelled / cancelled_by=client`, recordatorio WA `cancelled`, template de cancelación encolado |
| cancelar de nuevo | `409 ALREADY_CLOSED` |
| turno a 1 h (insertado por SQL) | `409 TOO_LATE_TO_CANCEL` "No se puede cancelar con menos de 2 horas de antelación" |
| `appointment_id` de OTRO cliente / inexistente / no UUID | `404 NOT_FOUND` (sin tocar el turno ajeno) / `404` / `400` |
| `POST /me` `{name:"A"}` / nombre válido | `400` / `200` y `GET /me` lo refleja |
| `POST /push/token` android / `platform: windows` / mismo token con otro `device_id` / `DELETE` | `200` / `400` / `200` y la fila anterior se borra / `200` y `is_active=false` |
