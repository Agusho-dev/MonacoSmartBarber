# `client-auth` — login y alta de clientes (OTP de WhatsApp + Google/Apple)

Edge Function que autentica **y da de alta** a los clientes de la app mobile.
Tablas: `client_otp_challenges` (migración `191_client_auth_otp.sql`),
`client_social_identities` + `clients.email` + `clients.signup_source` +
`organizations.allow_client_signup` (migración `210_alta_propia_de_clientes_google_apple.sql`).
Módulos compartidos en `../_shared/` (`phone.ts`, `otp.ts`, `meta-wa.ts`, `cors.ts`,
`social-id-token.ts`, `signup-token.ts`).

## La regla que ordena todo

**La identidad del negocio es el TELÉFONO.** Es lo que ata la cuenta con la fila del
local, con WhatsApp, con los puntos y con el historial, y es lo único que la tablet
sabe buscar. Google y Apple son **login de un toque y recuperación de cuenta**, no
una identidad paralela: toda cuenta nueva termina con un teléfono verificado por OTP,
venga de donde venga.

Por eso el `id_token` se verifica **en el servidor** y no con `signInWithIdToken`
desde Flutter: ese camino crearía un usuario de Supabase suelto —sin fila en
`clients`, con un JWT válido y sin `app_metadata.user_type='client'`, que es de lo que
depende toda la RLS de la migración 192— y después habría que fusionarlo a mano con el
usuario-alias del teléfono. **Un humano, una cuenta.**

El alta propia la habilita `organizations.allow_client_signup` (hoy **sólo Monaco**).
Con `false`, `start`/`verify` contestan el `CLIENT_NOT_FOUND` de siempre y `social`
contesta `SIGNUP_DISABLED`: ninguna otra organización de esta base se abre sola.

## Deploy

```bash
supabase functions deploy client-auth --no-verify-jwt
```

`--no-verify-jwt` es obligatorio: la app llama sin sesión (sólo `apikey: <anon>`) y la
función valida todo a mano.

**Deploy por el MCP de Supabase** (el camino que se usa cuando el CLI de la Mac no
está logueado): hay que mandar también los módulos de `_shared/` como archivos con
ruta `_shared/…` y reescribir los imports de `../_shared/` a `./_shared/`. En el repo
quedan como `../_shared/`, que es lo que usa el CLI. Archivos de esta función:

```
index.ts
_shared/cors.ts
_shared/phone.ts
_shared/otp.ts
_shared/meta-wa.ts
_shared/social-id-token.ts
_shared/signup-token.ts
```

### Secrets

| Secret | Obligatorio | Qué es |
|---|---|---|
| `OTP_PEPPER` | recomendado | Pepper del hash del código (`sha256(code:pepper)`). Cualquier string largo y aleatorio (`openssl rand -hex 32`). Si falta, usa los primeros 32 chars de la service role key. **No rotarlo con códigos en vuelo** (invalida los pendientes). |
| `GOOGLE_CLIENT_IDS` | **sí, para Google** | Client IDs de Google separados por coma (el de iOS, el de Android y el Web/serverClientId que use la app). Es la lista de `aud` aceptados: **sin esto, `social` con `provider:'google'` contesta 503** y no se valida ningún token. Aceptar un `aud` cualquiera sería aceptar el id_token de cualquier app del mundo. |
| `APPLE_BUNDLE_IDS` | **sí, para Apple** | Bundle ids aceptados como `aud`, separados por coma (flujo nativo: es el bundle id de la app; si se usa el flujo web/Services ID, va también ese). Mismo criterio que el de arriba. |
| `SIGNUP_TOKEN_SECRET` | opcional | Secreto del HMAC del `signup_token`. Si falta, se reusa `OTP_PEPPER` (y si ése tampoco está, los 32 chars de la service role key). Rotarlo invalida los `signup_token` en vuelo (15 minutos). |
| `AUTH_TEST_PHONES` | opcional | `national10=code,...`, p. ej. `1100000000=123456`. Esos números **no reciben WhatsApp** y aceptan el código fijo. Para el reviewer de Apple/Google y para tests. |
| `AUTH_WA_TEMPLATE` | opcional | Nombre del template AUTHENTICATION aprobado en Meta. Default `monaco_codigo_acceso`. |
| `AUTH_WA_TEMPLATE_LANG` | opcional | Idioma **registrado en Meta** para ese template. Default `es`. Mandar con otro idioma da 132001 y el código no llega. |

```bash
supabase secrets set \
  OTP_PEPPER="$(openssl rand -hex 32)" \
  SIGNUP_TOKEN_SECRET="$(openssl rand -hex 32)" \
  GOOGLE_CLIENT_IDS="123-ios.apps.googleusercontent.com,123-android.apps.googleusercontent.com,123-web.apps.googleusercontent.com" \
  APPLE_BUNDLE_IDS="com.monaco.app" \
  AUTH_TEST_PHONES="1100000000=123456" \
  AUTH_WA_TEMPLATE="monaco_codigo_acceso" AUTH_WA_TEMPLATE_LANG="es"
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` los inyecta Supabase.
Las credenciales de WhatsApp salen de `organization_whatsapp_config` (fila activa de la org).

## Contrato

`POST /functions/v1/client-auth` — headers `apikey: <anon>`, `Content-Type: application/json`.
Tres acciones.

### Campos comunes

| Campo | Tipo | Notas |
|---|---|---|
| `org_id` | uuid | Monaco: `a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11`. |
| `device_id` | string ≤128 | Identificador estable del dispositivo. El desafío OTP está atado a `(org, teléfono, device_id)`. |
| `device_secret` | string 32–256 | Aleatorio del dispositivo, guardado en Keychain / EncryptedSharedPreferences. Es la "contraseña del dispositivo" (password del usuario de Auth). |

---

### 1. `social` — entrar o empezar a registrarse con Google/Apple

```jsonc
{
  "action": "social",
  "provider": "google",            // 'google' | 'apple'
  "id_token": "eyJhbGciOi...",     // el id_token del proveedor, sin tocar
  "nonce": "abc123",               // opcional; ver abajo
  "org_id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  "device_id": "ios-8F3A...",
  "device_secret": "0f9a...64hex",
  "name": "Nacho Baldovino"        // opcional pero IMPORTANTE en Apple
}
```

- **`name` en Apple no es opcional en la práctica.** Apple manda el nombre **sólo en
  la primera autorización** de ese Apple ID para esta app, y **fuera del token**
  (`givenName` / `familyName` de la credencial). Si la app no lo manda acá, no se
  recupera nunca y el alta va a pedirlo a mano. En Google el nombre viene en el token
  y `name` sobra (si viene, gana el de la app).
- **`nonce`**: mandalo si la app generó uno. Se acepta que el claim del token sea ese
  valor tal cual **o su `sha256` en hex** (iOS suele mandar el hash del nonce crudo);
  las dos comparaciones son contra el valor que manda la app.

**Respuesta A — ya conocíamos esta cuenta (login de un toque, sin código ni WhatsApp):**

```jsonc
{
  "status": "ok",
  "access_token": "...",
  "refresh_token": "...",
  "client_id": "uuid",
  "name": "Nacho Baldovino",
  "is_new_client": false,
  "phone": "3512125249"
}
```

**Respuesta B — no la conocíamos: falta el teléfono.** No se creó nada.

```jsonc
{
  "status": "need_phone",
  "signup_token": "v1.eyJ2Ijox....abc",
  "expires_in": 900,
  "suggested_name": "Nacho Baldovino",   // puede ser null
  "email": "n@gmail.com",                // puede ser null o un relay de Apple
  "provider": "google"
}
```

El `signup_token` es un HMAC autocontenido de **15 minutos** que ata
provider + subject + email + nombre + organización. **No se guarda en la base.**
La app tiene que mandarlo en **`start` y en `verify`**: en `start` habilita el envío
del código a un número que todavía no es cliente, y en `verify` es lo que vincula la
identidad social con la cuenta.

---

### 2. `start` — pedir el código por WhatsApp

```jsonc
{
  "action": "start",
  "phone": "0351 212-5249",
  "org_id": "...",
  "device_id": "...",
  "device_secret": "...",
  "signup_token": "v1....."     // opcional: sólo si se viene de `social`
}
```

`phone` es lo que tipeó el usuario. Se normaliza en el server (`_shared/phone.ts`):
`3512125249`, `0351 212-5249`, `+54 9 351 212 5249`, `5493512125249` → el mismo número.

**Respuesta A — sesión sin mandar nada** (login silencioso: el `device_secret` sigue
siendo la password del usuario de Auth). Misma forma que la respuesta A de `social`.

**Respuesta B — código enviado:**

```jsonc
{
  "status": "otp_sent",
  "phone_masked": "+54 9 351 ••• 5249",
  "expires_in": 600,
  "resend_in": 45,
  "client_known": false,      // false = este teléfono todavía no es cliente
  "name_required": true,      // true = pedí el nombre ANTES de mandar `verify`
  "first_name": null          // nombre de pila si ya lo sabemos
}
```

`name_required` existe para que la app no se coma un `NAME_REQUIRED` con el código ya
tipeado: si es `true`, el formulario del código tiene que pedir también el nombre.

---

### 3. `verify` — validar el código y quedar adentro

```jsonc
{
  "action": "verify",
  "phone": "0351 212-5249",
  "code": "123456",
  "org_id": "...",
  "device_id": "...",
  "device_secret": "...",
  "name": "Nacho Baldovino",   // obligatorio si el teléfono es nuevo
  "signup_token": "v1....."    // opcional: si se viene de `social`
}
```

**Respuesta:**

```jsonc
{
  "status": "ok",
  "access_token": "...",
  "refresh_token": "...",
  "client_id": "uuid",
  "name": "Nacho Baldovino",
  "is_new_client": true,       // true = la ficha se creó en esta llamada
  "phone": "3512125249"
}
```

Qué hace `verify` según el caso:

| Situación | Resultado |
|---|---|
| El teléfono ya es cliente | Sesión sobre la ficha que ya existía. |
| El teléfono ya es cliente **y vino `signup_token`** | Se le pega la identidad social **encima de la cuenta que ya tenía**. No se duplica nada. Éste es el caso de los ~6.400 clientes históricos que un día entran con Google. |
| El teléfono es nuevo y la org tiene el alta abierta (o vino `signup_token`) | Se crea la ficha (`signup_source='app'`, `email` del proveedor si lo hay) y se devuelve la sesión con `is_new_client: true`. |
| El teléfono es nuevo y la org **no** tiene el alta abierta | `404 CLIENT_NOT_FOUND`. |

---

### Errores — `{ "error": CODE, "message": "...", ...extra }`

| HTTP | `error` | Cuándo |
|---|---|---|
| 400 | `BAD_REQUEST` | body inválido (`action`, `provider`, `id_token`, `device_id`, `device_secret`, `org_id`, `code`, `nonce`, `signup_token`, `name`) |
| 400 | `INVALID_PHONE` | menos de 8 dígitos o forma irreconocible |
| 400 | `NAME_REQUIRED` | el teléfono es nuevo y no vino `name` (2–80 chars) ni nombre en el `signup_token`. **El código sigue vigente**: la app pide el nombre y reintenta `verify` con el mismo código. |
| 400 | `SIGNUP_TOKEN_INVALID` (+`expired`) | el `signup_token` no lo firmamos nosotros, está roto, es de otra organización, o pasaron los 15 minutos (`expired: true` → rehacer el paso `social`) |
| 401 | `OTP_INVALID` (+`attempts_left`) | código incorrecto |
| 401 | `SOCIAL_TOKEN_INVALID` | el `id_token` no valida: firma, `iss`, `aud`, `exp` o `nonce`. El motivo exacto va **sólo al log** (`[client-auth] id_token rechazado …`), nunca a la app. |
| 403 | `SIGNUP_DISABLED` | `social` con una identidad desconocida en una org con `allow_client_signup = false`. Mismo mensaje que `CLIENT_NOT_FOUND`. |
| 404 | `CLIENT_NOT_FOUND` | el teléfono no es de ningún cliente de la org (últimos 10 dígitos) **y la org no tiene el alta abierta**. `start` lo devuelve sin mandar WhatsApp. |
| 404 | `ORG_NOT_FOUND` | `org_id` inexistente o inactiva |
| 404 | `OTP_NOT_FOUND` | no hay desafío pendiente para ese teléfono+dispositivo: volver a `start` |
| 409 | `SOCIAL_ALREADY_LINKED` | ese (provider, subject) ya está vinculado a otro cliente, o a otra organización. `UNIQUE(provider, subject)` es global. |
| 409 | `CONFLICT` | el alias de email de Auth ya pertenece a otro cliente (no debería pasar) |
| 410 | `OTP_EXPIRED` | pasaron 10 minutos (el desafío se consume) |
| 429 | `RATE_LIMITED` (+`retry_in`) | ver la tabla de abajo, o 5 intentos fallidos con el mismo código |
| 502 | `OTP_DELIVERY_FAILED` | Meta rechazó el envío (o la org no tiene WhatsApp configurado). El desafío se borra. |
| 503 | `SOCIAL_VERIFY_UNAVAILABLE` | no se pudo bajar el JWKS del proveedor, o falta configurar `GOOGLE_CLIENT_IDS` / `APPLE_BUNDLE_IDS`. **No es "tu cuenta no sirve"**: es un problema nuestro o de red, y por eso no sale como 401. |
| 500 | `AUTH_FAILED` | error de base/Auth (ver logs `[client-auth]`) |

### Rate limits

| Bucket | Límite | Clave |
|---|---|---|
| `client_otp_phone` | 3 / 10 min | org + teléfono |
| `client_otp_device` | 5 / hora | org + `device_id` — **nuevo en v3**: con el alta abierta el teléfono deja de acotar (antes sólo se le podía pedir código a un número que YA era cliente), así que el dispositivo pasa a ser la unidad que hay que limitar. |
| `client_otp_ip` | 10 / hora | IP |
| `client_social_ip` | 30 / hora | IP (la acción `social` no manda WhatsApp ni escribe, pero baja un JWKS y hace criptografía) |

Los tres primeros se evalúan **antes** del chequeo de existencia del cliente, para que
no se pueda enumerar qué números son clientes a velocidad de máquina.

## Flujos

```
social ──► verifica id_token contra Google/Apple (firma, iss, aud, exp, nonce)
    │
    ├─ identidad ya vinculada ─────────────► ok (sesión, sin código ni WhatsApp)
    │
    └─ identidad desconocida ─┬─ org sin alta ──► 403 SIGNUP_DISABLED
                              └─ org con alta ──► need_phone + signup_token (15 min)
                                                           │
start (+signup_token) ─► ¿device_secret == password? ──sí──► ok (sesión; vincula lo social)
   │                                                        (no toca la password)
   no
   ▼
 rate-limits ► ¿cliente o alta habilitada? ► código 6 dígitos ► hash en
 client_otp_challenges ► WhatsApp template AUTHENTICATION ► otp_sent

verify (+signup_token) ─► desafío pendiente (últimos 10 dígitos + device_id)
        ► expiración / intentos / hash en tiempo constante
        ► NAME_REQUIRED y SOCIAL_ALREADY_LINKED se contestan ANTES de consumir el código
        ► consumo idempotente del desafío
        ► crea `clients` si hace falta (signup_source='app'), o usa la ficha existente
        ► vincula client_social_identities (upsert por provider+subject)
        ► auth user: password = device_secret, app_metadata = { user_type:'client', client_id, organization_id: null }
        ► signInWithPassword ► ok (sesión)
```

## Invariantes que no hay que "arreglar"

- **La password nunca se resetea sin una prueba de identidad verificada**: un código de
  WhatsApp, o un `id_token` válido del proveedor. Si el `device_secret` no coincide y no
  hay ninguna de las dos, `start` va a OTP. Eso es lo que convierte al teléfono en prueba
  de identidad. La v1 reseteaba ante cualquier mismatch: cualquiera que supiera un
  teléfono entraba como ese cliente con un `curl`.
- **Un JWT de cliente NO lleva `organization_id`** en `app_metadata` (`organization_id: null`
  borra la clave en GoTrue). `get_user_org_id()` devuelve NULL para clientes y las policies
  org-wide del staff no los alcanzan. Lo que el cliente lee va por policies propias (`auth.uid()`).
- **El `aud` del `id_token` se valida contra una lista cerrada.** Sin `GOOGLE_CLIENT_IDS`
  la función contesta 503 en vez de aceptar el token: un id_token emitido para cualquier
  otra app de Google entraría como si fuera nuestro.
- **`clients.phone` se guarda en la forma NACIONAL de 10 dígitos**, que es lo que tiene toda
  la base y lo que el kiosko y el turnero buscan por igualdad exacta antes de caer al match
  por últimos 10 dígitos. Guardarlo en E.164 haría que la tablet no lo encuentre y cree un
  DUPLICADO — el bug que arreglaron las migraciones 149/150.
- **Mandarle el código a alguien que nunca habló con el negocio está permitido**: es un
  opt-in explícito hecho fuera de WhatsApp (el usuario tocó "Enviarme el código"), que es
  el caso que Meta acepta para los templates AUTHENTICATION. No agregar un chequeo de
  "¿ya nos escribió?": rompería el alta.
- **El bono de bienvenida del programa de fidelización NO se acredita al registrarse** desde
  la app (mig 210): `loyalty_grant_welcome_bonus` lo difiere hasta la primera visita cobrada
  cuando `signup_source in ('app','web')`. Sin eso, cualquiera que instale la app cobraría
  puntos canjeables por cosas reales sin haber sido cliente nunca.

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

# 4) social con un id_token inválido → 401 SOCIAL_TOKEN_INVALID (o 503 si faltan los secrets)
curl -s -X POST "$URL" -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d "{\"action\":\"social\",\"provider\":\"google\",\"id_token\":\"no.es.un.token\",\"device_id\":\"curl-test\",\"device_secret\":\"$SECRET\",\"org_id\":\"$ORG\"}"
```

Usar un teléfono de `AUTH_TEST_PHONES` para no gastar envíos ni crear clientes reales.
Un `start` repetido con un `device_secret` distinto al verificado **no** devuelve sesión:
vuelve a mandar un código (ese es el punto).

Para probar el alta de verdad hace falta un teléfono real que **no** esté en `clients`:
`start` va a contestar `client_known: false, name_required: true` y `verify` con `name`
va a crear la ficha con `signup_source='app'`.

## Tests locales

```bash
deno test --allow-net supabase/functions/_shared/    # teléfono, OTP, signup_token, id_token social
deno check supabase/functions/client-auth/index.ts
deno lint --rules-exclude=no-import-prefix supabase/functions/_shared supabase/functions/client-auth
```

`social_id_token_test.ts` firma tokens de verdad con una clave RSA generada en el
momento y stubbea el `fetch` del JWKS: cubre firma, `iss`, `aud`, `exp`, `nonce`
(crudo y hasheado), `alg: none`, `kid` desconocido y JWKS caído.
