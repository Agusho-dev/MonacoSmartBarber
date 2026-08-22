# `send-push` — sender único de push a clientes (FCM HTTP v1)

Procesa la cola `push_outbox` y entrega cada fila a los dispositivos del cliente por
**Firebase Cloud Messaging HTTP v1** (el único transporte: la app Flutter registra tokens FCM).
No decide a quién mandarle nada — eso lo hace quien encola (campañas del dashboard, triggers de
turnos y premios, `enqueue_due_appointment_reminders()`) — sólo entrega lo pendiente y registra
qué pasó. Es el espejo del patrón que ya funciona para WhatsApp
(`scheduled_messages` + `claim_pending_messages` + `process-scheduled-messages`).

Contrato completo: `CONTRACTS.md` §3.3 (tablas) y §4.1 (esta función). Helper FCM:
[`../_shared/fcm.ts`](../_shared/fcm.ts) (OAuth2 de la service account + armado + clasificación).

## Qué hace en cada corrida

1. `rpc('claim_pending_push', { p_batch_size: 100 })` — claim atómico (`FOR UPDATE SKIP LOCKED`,
   `status='processing'`, `attempts+1`). Dos crons solapados no se pisan.
2. Por fila, 8 en vuelo (`processWithConcurrency`):
   - **Preferencia** del cliente en `client_notification_preferences` según `kind`
     (`campaign→campaigns`, `appointment_reminder→appointment_reminders`,
     `appointment_update→appointment_updates`, `reward`/`points→rewards`; `manual` y `test` siempre).
     Sin fila = todo en `true`. Apagada → `skipped`.
   - **Tokens** activos en `client_device_tokens`. Ninguno → `skipped`.
   - Inserta la fila en **`client_notifications`** ANTES de enviar (su `id` viaja en el payload como
     `notification_id`, para que la app la marque leída al tocar). Si al final no salió por ningún
     token, se borra.
   - Un POST a FCM por token, con `data = { type, value, deep_link, notification_id }` (todo string,
     más lo que traiga `push_outbox.data`), `android.priority=HIGH` + canal `monaco_default` +
     `sound=default`, `apns-priority=10` + `sound=default` + `badge` = no leídas del cliente.
   - Resultado:
     - éxito en ≥1 token → `sent`, `sent_at`;
     - `UNREGISTERED` / token inválido / `SENDER_ID_MISMATCH` → ese token pasa a
       `is_active=false` (+ `last_error`, `last_error_at`); si no quedó ningún dispositivo válido → `skipped`;
     - 429 / 5xx / timeout / 401 → vuelve a `pending` con `scheduled_for = now() + 5/15 min`
       (según `attempts`); al tercer intento, `failed`;
     - cualquier otra cosa (payload rechazado, `PERMISSION_DENIED`, …) → `failed` con `last_error`.
3. Al final:
   - **Campañas** (`push_outbox.campaign_id`): recalcula `sent_count` / `failed_count` /
     `no_token_count` desde el outbox (no acumula) y, si no quedan `pending|processing`, cierra la
     campaña (`status='sent'`, `completed_at`) — sólo si seguía `sending` (una cancelada no revive).
   - **Recordatorios** (`push_outbox.appointment_reminder_id`): `appointment_reminders.status` =
     `sent` / `failed` / `skipped` + `sent_at` / `error_message`. Mientras se reintenta no se toca.
4. Responde `{ ok: true, processed, sent, failed, skipped, retrying }`.

**Modo sin Firebase**: si falta `FCM_SERVICE_ACCOUNT_JSON` (o no sirve), cada fila reclamada queda
`failed` con `last_error='FCM no configurado'` (o el motivo), los recordatorios `failed`, y la
respuesta es **200** `{ ok: false, reason: 'FCM_NOT_CONFIGURED', processed, … }`. No tira: tirar
dejaría el lote en `processing` para siempre. Si Google rechaza la service account al pedir el
access token, la respuesta es `{ ok: false, reason: 'FCM_AUTH_FAILED' }` (filas en `pending` con
backoff si el fallo fue de red/5xx, `failed` si fueron las credenciales).

Todo insert/update chequea `error` y loguea con prefijo `[send-push]` (Known Risk #5).

## Deploy

```bash
supabase functions deploy send-push --no-verify-jwt
```

`--no-verify-jwt` es obligatorio: la función se autentica a mano con
`Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` (no es un JWT de usuario), igual que
`process-scheduled-messages`. Sin el flag, el gateway rechaza al cron con 401 antes de llegar al handler.

## Secrets

| Secret | Obligatorio | Qué es |
|---|---|---|
| `FCM_SERVICE_ACCOUNT_JSON` | sí (sin él, modo sin Firebase) | El JSON completo de la service account de Firebase (Consola Firebase → Configuración del proyecto → Cuentas de servicio → *Generar nueva clave privada*). Se acepta el JSON crudo **o en base64**. |
| `FCM_PROJECT_ID` | no | Sobrescribe el `project_id` del JSON (sólo si el proyecto FCM es otro). |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | los inyecta Supabase | — |

Cargar el JSON en base64 evita pelear con comillas y saltos de línea:

```bash
supabase secrets set FCM_SERVICE_ACCOUNT_JSON="$(base64 -i monaco-firebase-adminsdk.json | tr -d '\n')"
# opcional
supabase secrets set FCM_PROJECT_ID=monaco-barber-xxxxx
```

La service account necesita el rol **Firebase Cloud Messaging API Admin** (o *Editor*) y la API
*Firebase Cloud Messaging API (V1)* habilitada en el proyecto. El access token OAuth2 se pide una vez
por corrida y se cachea 50 min en memoria del isolate.

## Probar a mano

```bash
SRK='<SUPABASE_SERVICE_ROLE_KEY>'
curl -s -X POST 'https://gzsfoqpxvnwmvngfoqqk.supabase.co/functions/v1/send-push' \
  -H "Authorization: Bearer $SRK" \
  -H 'Content-Type: application/json' \
  -d '{}'
# → {"ok":true,"processed":0,"sent":0,"failed":0,"skipped":0,"retrying":0}
```

Para probar el circuito entero sin Firebase, insertar un `push_outbox` de `kind='test'` para un
cliente **sin tokens** y volver a llamar: tiene que quedar `skipped` (no `failed`) y la función no
debe tirar (CONTRACTS §3.4):

```sql
insert into push_outbox (organization_id, client_id, kind, title, body, deep_link)
values ('<org_id>', '<client_id sin tokens>', 'test', 'Prueba', 'Hola desde send-push', '/home');
```

Con un token real (la app instalada y `client_device_tokens` con una fila activa), la misma
inserción tiene que terminar `sent`, con una fila nueva en `client_notifications` (`push_outbox_id`
apuntando al outbox) y la notificación en el teléfono.

Un `401 Unauthorized` en el curl = Bearer incorrecto o deploy sin `--no-verify-jwt`.

## Quién la invoca

El cron **`send-push-outbox`** (pg_cron, `* * * * *`, mig 193) llama a `trigger_send_push()`, que
primero corre `enqueue_due_appointment_reminders()` (mueve los `appointment_reminders` vencidos al
outbox) y después hace `net.http_post` a esta función con la service role key de Vault — nunca con
URL ni secreto hardcodeados en el job (Known Risk #26). Para saber si el cron anda, mirar
`net._http_response` (status 200), no `cron.job_run_details`.

La edge function `appointment-reminders` (Expo) que había en el repo **se borró**: su trabajo lo
hacen `enqueue_due_appointment_reminders()` + esta función, y Expo no sirve para una app Flutter
con tokens FCM.
