/**
 * Sign in with Apple — canje del `authorization_code` y revocación del acceso.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 * ---------------------------
 * Apple exige, desde el 30/6/2022, que una app que ofrece Sign in with Apple
 * **revoque los tokens del usuario cuando éste borra su cuenta** (guideline
 * 5.1.1(v) + "Offering account deletion in your app"). Sin eso, la persona
 * sigue viendo a Monaco en Ajustes → su Apple ID → "Iniciar sesión con Apple"
 * para siempre, y App Review lo rechaza.
 *
 * `POST /auth/revoke` de Apple NO acepta el `id_token` ni el
 * `authorization_code`: acepta un **refresh token**, y el refresh token sólo se
 * consigue canjeando el `authorization_code` en `POST /auth/token`. Ese código
 * llega UNA sola vez, en la respuesta de la hoja del sistema, y dura 5 minutos.
 * De ahí el orden: la app lo manda en el alta → acá se canjea en el acto → el
 * refresh token queda guardado en `client_social_identities.apple_refresh_token`
 * (tabla que sólo lee y escribe el service role) hasta el día de la baja.
 *
 * EL `client_secret` NO ES UN SECRETO FIJO: es un JWT firmado con ES256 con la
 * clave `.p8` que Apple entrega al crear una key de tipo "Sign in with Apple".
 * Se arma en el momento y dura minutos. Por eso hacen falta TRES secrets y no
 * uno: `APPLE_TEAM_ID` (el emisor), `APPLE_KEY_ID` (qué clave firmó, va en el
 * header `kid`) y `APPLE_PRIVATE_KEY` (el PEM del `.p8`).
 *
 * TODO ESTO ES BEST-EFFORT Y FALLA ABIERTO. Si los secrets no están cargados
 * —hoy no lo están— `estaConfigurado()` da false y las dos funciones devuelven
 * un resultado "no configurado" que el caller loguea y sigue de largo. Un
 * cliente NUNCA se puede quedar sin entrar, ni sin poder borrar su cuenta,
 * porque a Apple se le cayó un endpoint o porque falta una variable.
 */

const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token'
const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke'

/** El `client_id` de Apple para el flujo nativo es el bundle id de la app. */
const CLIENT_ID_POR_DEFECTO = 'com.monacobarber.monacoMobile'

/**
 * Apple acepta hasta 6 meses de vigencia para el `client_secret`. Se usan 5
 * minutos: el JWT se arma para UNA llamada y no se cachea, así que una vida
 * larga sólo agrandaría la ventana de un token filtrado en un log.
 */
const CLIENT_SECRET_TTL_SEGUNDOS = 300

export interface CredencialesApple {
  teamId: string
  keyId: string
  /** Contenido del `.p8`, con o sin las líneas `-----BEGIN PRIVATE KEY-----`. */
  privateKeyPem: string
  clientId: string
}

export type ResultadoCanje =
  | { ok: true; refreshToken: string }
  | { ok: false; motivo: string; noConfigurado?: boolean }

export type ResultadoRevocacion =
  | { ok: true }
  | { ok: false; motivo: string; noConfigurado?: boolean }

/** Lee los tres secrets. Devuelve `null` si falta cualquiera de ellos. */
export function credencialesApple(
  env: (k: string) => string | undefined = Deno.env.get,
): CredencialesApple | null {
  const teamId = (env('APPLE_TEAM_ID') ?? '').trim()
  const keyId = (env('APPLE_KEY_ID') ?? '').trim()
  const privateKeyPem = (env('APPLE_PRIVATE_KEY') ?? '').trim()
  const clientId = (env('APPLE_CLIENT_ID') ?? '').trim() || CLIENT_ID_POR_DEFECTO
  if (!teamId || !keyId || !privateKeyPem) return null
  return { teamId, keyId, privateKeyPem, clientId }
}

export function estaConfigurado(
  env: (k: string) => string | undefined = Deno.env.get,
): boolean {
  return credencialesApple(env) !== null
}

// ── JWT ES256 ──────────────────────────────────────────────────────────────

function base64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlDeTexto(texto: string): string {
  return base64url(new TextEncoder().encode(texto))
}

/**
 * El `.p8` de Apple es PKCS#8 en PEM. `crypto.subtle.importKey` quiere los
 * bytes DER crudos, así que hay que sacarle las cabeceras y el base64.
 *
 * Se toleran los `\n` escritos como `\\n`: pegar un PEM multilínea en el panel
 * de secrets de Supabase es incómodo y es habitual que llegue en una sola línea
 * con los saltos escapados.
 */
function derDesdePem(pem: string): Uint8Array {
  const limpio = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '')
  const bin = atob(limpio)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Arma el `client_secret` que pide Apple: un JWT ES256 con `iss` = Team ID,
 * `sub` = client id (el bundle), `aud` = `https://appleid.apple.com` y el
 * `kid` de la clave en el header.
 *
 * `ahoraSegundos` se puede inyectar para poder testear la forma del token sin
 * depender del reloj.
 */
export async function armarClientSecret(
  cred: CredencialesApple,
  ahoraSegundos?: number,
): Promise<string> {
  const iat = ahoraSegundos ?? Math.floor(Date.now() / 1000)
  const header = { alg: 'ES256', kid: cred.keyId, typ: 'JWT' }
  const payload = {
    iss: cred.teamId,
    iat,
    exp: iat + CLIENT_SECRET_TTL_SEGUNDOS,
    aud: 'https://appleid.apple.com',
    sub: cred.clientId,
  }
  const datos = `${base64urlDeTexto(JSON.stringify(header))}.${base64urlDeTexto(JSON.stringify(payload))}`

  const key = await crypto.subtle.importKey(
    'pkcs8',
    derDesdePem(cred.privateKeyPem) as unknown as BufferSource,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  // WebCrypto devuelve la firma ES256 en formato IEEE P1363 (r||s, 64 bytes),
  // que es EXACTAMENTE lo que pide JWS. No hay que convertir a DER.
  const firma = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(datos) as unknown as BufferSource,
  )
  return `${datos}.${base64url(new Uint8Array(firma))}`
}

// ── Canje y revocación ─────────────────────────────────────────────────────

/**
 * Canjea el `authorization_code` de la hoja de Sign in with Apple por un
 * refresh token. Devuelve `noConfigurado: true` (no un error) cuando faltan los
 * secrets: es el estado normal hasta que el dueño cree la key en
 * developer.apple.com.
 */
export async function canjearAuthorizationCode(
  authorizationCode: string,
  opciones: { cred?: CredencialesApple | null; fetchImpl?: typeof fetch } = {},
): Promise<ResultadoCanje> {
  const cred = opciones.cred !== undefined ? opciones.cred : credencialesApple()
  if (!cred) return { ok: false, motivo: 'faltan APPLE_TEAM_ID/APPLE_KEY_ID/APPLE_PRIVATE_KEY', noConfigurado: true }
  if (!authorizationCode) return { ok: false, motivo: 'authorization_code vacío' }

  const doFetch = opciones.fetchImpl ?? fetch
  let clientSecret: string
  try {
    clientSecret = await armarClientSecret(cred)
  } catch (e) {
    return { ok: false, motivo: `no se pudo firmar el client_secret: ${(e as Error).message}` }
  }

  const body = new URLSearchParams({
    client_id: cred.clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code: authorizationCode,
  })

  try {
    const res = await doFetch(APPLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    })
    const texto = await res.text()
    if (!res.ok) return { ok: false, motivo: `Apple ${res.status}: ${texto.slice(0, 200)}` }
    const json = JSON.parse(texto) as { refresh_token?: string }
    if (!json.refresh_token) return { ok: false, motivo: 'Apple no devolvió refresh_token' }
    return { ok: true, refreshToken: json.refresh_token }
  } catch (e) {
    return { ok: false, motivo: `red: ${(e as Error).message}` }
  }
}

/**
 * Revoca el acceso de la app a esa cuenta de Apple. Apple contesta **200 con
 * cuerpo vacío** cuando sale bien.
 */
export async function revocarRefreshToken(
  refreshToken: string,
  opciones: { cred?: CredencialesApple | null; fetchImpl?: typeof fetch } = {},
): Promise<ResultadoRevocacion> {
  const cred = opciones.cred !== undefined ? opciones.cred : credencialesApple()
  if (!cred) return { ok: false, motivo: 'faltan APPLE_TEAM_ID/APPLE_KEY_ID/APPLE_PRIVATE_KEY', noConfigurado: true }
  if (!refreshToken) return { ok: false, motivo: 'refresh_token vacío' }

  const doFetch = opciones.fetchImpl ?? fetch
  let clientSecret: string
  try {
    clientSecret = await armarClientSecret(cred)
  } catch (e) {
    return { ok: false, motivo: `no se pudo firmar el client_secret: ${(e as Error).message}` }
  }

  const body = new URLSearchParams({
    client_id: cred.clientId,
    client_secret: clientSecret,
    token: refreshToken,
    token_type_hint: 'refresh_token',
  })

  try {
    const res = await doFetch(APPLE_REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    })
    if (res.ok) return { ok: true }
    const texto = await res.text()
    return { ok: false, motivo: `Apple ${res.status}: ${texto.slice(0, 200)}` }
  } catch (e) {
    return { ok: false, motivo: `red: ${(e as Error).message}` }
  }
}
