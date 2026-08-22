# `client-auth` — login de clientes por OTP de WhatsApp

Edge Function que autentica a los clientes de la app mobile. Contrato completo en
`CONTRACTS.md` §2; tabla `client_otp_challenges` en la migración `191_client_auth_otp.sql`.
Módulos compartidos en `../_shared/` (`phone.ts`, `otp.ts`, `meta-wa.ts`, `cors.ts`).

## Deploy

```bash
supabase functions deploy client-auth --no-verify-jwt
```

`--no-verify-jwt` es obligatorio: la app llama sin sesión (sólo `apikey: <anon>`) y la
función valida todo a mano.

### Secrets

| Secret | Obligatorio | Qué es |
|---|---|---|
| `OTP_PEPPER` | recomendado | Pepper del hash del código (`sha256(code:pepper)`). Cualquier string largo y aleatorio (`openssl rand -hex 32`). Si falta, usa los primeros 32 chars de la service role key. **No rotarlo con códigos en vuelo** (invalida los pendientes). |
| `AUTH_TEST_PHONES` | opcional | `national10=code,...`, p. ej. `1100000000=123456,1100000001=123456`. Esos números **no reciben WhatsApp** y aceptan el código fijo. Para el reviewer de Apple/Google y para tests. |
| `AUTH_WA_TEMPLATE` | opcional | Nombre del template AUTHENTICATION aprobado en Meta. Default `monaco_codigo_acceso`. |
| `AUTH_WA_TEMPLATE_LANG` | opcional | Idioma **registrado en Meta** para ese template. Default `es`. Mandar con otro idioma da 132001 y el código no llega. |

```bash
supabase secrets set OTP_PEPPER="$(openssl rand -hex 32)" \
  AUTH_TEST_PHONES="1100000000=123456" \
  AUTH_WA_TEMPLATE="monaco_codigo_acceso" AUTH_WA_TEMPLATE_LANG="es"
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` los inyecta Supabase.
Las credenciales de WhatsApp salen de `organization_whatsapp_config` (fila activa de la org).

### Antes del primer deploy

1. Aplicar la migración 191 (tabla de desafíos) y la 192 (RLS de clientes).
2. Crear y aprobar el template AUTHENTICATION en la WABA:
   `META_ACCESS_TOKEN=… META_WABA_ID=… node scripts/meta/crear-template-otp.mjs`
   (mientras esté PENDING, `start` responde `OTP_DELIVERY_FAILED`).

## Contrato

`POST /functions/v1/client-auth` — headers `apikey: <anon>`, `Content-Type: application/json`.

### Request

```ts
{ action: 'start',  phone: string, device_id: string, device_secret: string, org_id: string }
{ action: 'verify', phone: string, device_id: string, device_secret: string, org_id: string, code: string, name?: string }
```

- `phone`: lo que tipeó el usuario. Se normaliza en el server (`_shared/phone.ts`):
  `3512125249`, `0351 212-5249`, `+54 9 351 212 5249`, `5493512125249` → el mismo número.
- `device_secret`: 32–256 chars, aleatorio, generado en el dispositivo y guardado en
  Keychain/EncryptedPrefs. Es la "contraseña del dispositivo" (password del usuario de Auth).
- `device_id`: identificador estable del dispositivo (≤128 chars). El desafío OTP está atado
  a `(org, teléfono, device_id)`.

### Responses 200

```ts
// sesión lista (login silencioso en `start`, o `verify` correcto)
{ status: 'ok', access_token, refresh_token, client_id, name, is_new_client, phone }

// se mandó el código (sólo `start`)
{ status: 'otp_sent', phone_masked: '+54 9 351 ••• 5249', expires_in: 600, resend_in: 45,
  client_known: boolean, first_name: string | null }
```

### Errores `{ error: CODE, message, ...extra }`

| HTTP | `error` | Cuándo |
|---|---|---|
| 400 | `BAD_REQUEST` | body inválido (action, device_id, device_secret, org_id, code) |
| 400 | `INVALID_PHONE` | menos de 8 dígitos o forma irreconocible |
| 404 | `ORG_NOT_FOUND` | `org_id` inexistente o inactiva |
| 429 | `RATE_LIMITED` (+`retry_in`) | 3 códigos / 10 min por teléfono, 10 / hora por IP, o 5 intentos fallidos con el mismo código |
| 502 | `OTP_DELIVERY_FAILED` | Meta rechazó el envío (o la org no tiene WhatsApp configurado). El desafío se borra. |
| 401 | `OTP_INVALID` (+`attempts_left`) | código incorrecto |
| 410 | `OTP_EXPIRED` | pasaron 10 minutos (el desafío se consume) |
| 404 | `OTP_NOT_FOUND` | no hay desafío pendiente para ese teléfono+dispositivo: volver a `start` |
| 400 | `NAME_REQUIRED` | cliente nuevo sin `name` (2–80 chars). El código **sigue vigente**: la app pide el nombre y reintenta `verify`. |
| 409 | `CONFLICT` | el alias de email ya pertenece a otro cliente (no debería pasar) |
| 500 | `AUTH_FAILED` | error de base/Auth (ver logs `[client-auth]`) |

### Flujo

```
start ──► ¿cliente con auth_user_id y device_secret == password? ──sí──► ok (sesión)
   │                                                                   (no toca la password)
   no
   ▼
 rate-limit ► código 6 dígitos ► hash en client_otp_challenges ► WhatsApp template ► otp_sent

verify ──► desafío pendiente (últimos 10 dígitos + device_id) ► expiración / intentos / hash
        ► find-or-create clients (nombre si es nuevo)
        ► auth user: password = device_secret, app_metadata = { user_type:'client', client_id, organization_id: null }
        ► signInWithPassword ► ok (sesión)
```

Dos invariantes que no hay que "arreglar":

- **La password nunca se resetea sin un código verificado.** Si el `device_secret` no coincide,
  `start` va a OTP. Eso es lo que convierte al teléfono en prueba de identidad.
- **Un JWT de cliente NO lleva `organization_id`** en `app_metadata` (`organization_id: null`
  borra la clave en GoTrue). `get_user_org_id()` devuelve NULL para clientes y las policies
  org-wide del staff no los alcanzan. Lo que el cliente lee va por policies propias (`auth.uid()`).

## Prueba con curl

```bash
URL="https://gzsfoqpxvnwmvngfoqqk.supabase.co/functions/v1/client-auth"
ANON="<anon key>"
ORG="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
SECRET="$(openssl rand -hex 32)"   # guardalo: es la "password" de este dispositivo

# 1) start → otp_sent (o status:'ok' si el device_secret ya es la password)
curl -s -X POST "$URL" -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d "{\"action\":\"start\",\"phone\":\"1100000000\",\"device_id\":\"curl-test\",\"device_secret\":\"$SECRET\",\"org_id\":\"$ORG\"}"

# 2) verify con el código recibido (para un teléfono de AUTH_TEST_PHONES, el fijo)
curl -s -X POST "$URL" -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d "{\"action\":\"verify\",\"phone\":\"1100000000\",\"device_id\":\"curl-test\",\"device_secret\":\"$SECRET\",\"org_id\":\"$ORG\",\"code\":\"123456\",\"name\":\"Prueba Curl\"}"

# 3) start de nuevo con el MISMO secret → status:'ok' sin WhatsApp (login silencioso)
```

Usar un teléfono de `AUTH_TEST_PHONES` para no gastar envíos ni crear clientes reales.
Un `start` repetido con un `device_secret` distinto al verificado **no** devuelve sesión:
vuelve a mandar un código (ese es el punto).

## Tests locales

```bash
deno test supabase/functions/_shared/        # normalización de teléfono + OTP
deno check supabase/functions/client-auth/index.ts
deno lint --rules-exclude=no-import-prefix supabase/functions/_shared supabase/functions/client-auth
```
