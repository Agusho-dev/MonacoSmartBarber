/**
 * Firebase Cloud Messaging — HTTP v1.
 *
 * Único transporte de push de la plataforma (la app Flutter registra tokens FCM).
 * Acá viven las dos cosas que no tienen que duplicarse en ningún otro lado:
 *
 *   1. El access token OAuth2 de la service account: JWT RS256 firmado con WebCrypto
 *      (`crypto.subtle.importKey('pkcs8', …)` + `sign`), intercambiado en
 *      `https://oauth2.googleapis.com/token` y cacheado 50 min en memoria del isolate.
 *      Google lo emite por 60 min; pedir uno por mensaje es lento y Google lo limita.
 *
 *   2. El armado del mensaje y la CLASIFICACIÓN de la respuesta de FCM, que es lo que
 *      decide qué hacer con cada token: darlo de baja (`unregistered` / `invalid`),
 *      reintentar más tarde (`retryable`) o rendirse (`fatal`).
 *
 * La API legacy (`fcm.googleapis.com/fcm/send` con server key) está apagada por Google
 * desde 2024: no volver a usarla. Expo tampoco: la app no es Expo.
 *
 * Sin dependencias externas a propósito: se testea con `deno test` sin red.
 */

export const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'
export const GOOGLE_TOKEN_URI = 'https://oauth2.googleapis.com/token'
export const FCM_SEND_BASE = 'https://fcm.googleapis.com/v1/projects'

/** Timeout por request (OAuth2 y envío). */
export const DEFAULT_TIMEOUT_MS = 10_000
/** El access token de Google dura 60 min; lo reutilizamos 50 y pedimos otro. */
export const ACCESS_TOKEN_TTL_MS = 50 * 60 * 1000

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface FcmServiceAccount {
  project_id: string
  client_email: string
  /** PEM PKCS#8 ("-----BEGIN PRIVATE KEY-----"), tal como viene en el JSON de Google. */
  private_key: string
  token_uri?: string
}

export interface FcmNotification {
  title: string
  body: string
  /** URL pública de imagen (JPEG/PNG). En iOS requiere Notification Service Extension. */
  image?: string
}

export interface FcmSendInput {
  projectId: string
  /** Token de registro del dispositivo (lo que guarda `client_device_tokens.token`). */
  token: string
  notification: FcmNotification
  /** Payload de datos. FCM exige map<string,string>; lo que no sea string se convierte. */
  data: Record<string, unknown>
  /** Canal de Android (la app lo tiene que crear; Monaco usa `monaco_default`). */
  androidChannelId: string
  /** Badge de iOS. Default 1. */
  badge?: number
}

export type FcmFailureKind = 'unregistered' | 'invalid' | 'retryable' | 'fatal'

export type FcmSendResult =
  | { ok: true; messageId: string }
  | {
      ok: false
      kind: FcmFailureKind
      /** HTTP status de FCM; `null` en timeout / error de red. */
      status: number | null
      /** Mensaje humano (el de Google si lo hubo). */
      error: string
      /** `error.details[].errorCode` de FCM (UNREGISTERED, INVALID_ARGUMENT, …) o `error.status`. */
      code?: string
    }

export interface FcmSendOptions {
  /** Service account para obtener el access token (cacheado). Si falta, se lee de env. */
  serviceAccount?: FcmServiceAccount
  /** Access token ya resuelto: saltea OAuth2 (el sender lo pide una vez por corrida). */
  accessToken?: string
  /** Inyectable para tests. */
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export interface FcmTokenOptions {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  /** Reloj inyectable (tests de expiración del cache). */
  now?: () => number
}

/** Lector de env inyectable: `Deno.env` en runtime, un objeto plano en tests. */
export interface EnvReader {
  get(key: string): string | undefined
}

/** El JSON de la service account falta o no sirve. No es reintentable. */
export class FcmConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FcmConfigError'
  }
}

/** Google no entregó el access token. `retryable` distingue red/5xx de credenciales malas. */
export class FcmAuthError extends Error {
  retryable: boolean
  status: number | null
  constructor(message: string, opts: { retryable: boolean; status: number | null }) {
    super(message)
    this.name = 'FcmAuthError'
    this.retryable = opts.retryable
    this.status = opts.status
  }
}

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

/**
 * Parsea el JSON de la service account. Acepta el JSON crudo o el JSON en base64
 * (cómodo para `supabase secrets set`, que pelea con las comillas y los saltos de línea).
 * Normaliza `\\n` literales dentro de `private_key` (doble escape típico al pegar).
 */
export function parseServiceAccountJson(raw: string): FcmServiceAccount {
  let text = raw.trim()
  if (!text) throw new FcmConfigError('FCM_SERVICE_ACCOUNT_JSON está vacío')
  if (!text.startsWith('{')) {
    try {
      text = new TextDecoder().decode(base64Decode(text)).trim()
    } catch {
      throw new FcmConfigError('FCM_SERVICE_ACCOUNT_JSON no es JSON ni base64 de un JSON')
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    throw new FcmConfigError(`FCM_SERVICE_ACCOUNT_JSON no es JSON válido: ${(e as Error).message}`)
  }
  const obj = (parsed ?? {}) as Record<string, unknown>
  const project_id = typeof obj.project_id === 'string' ? obj.project_id.trim() : ''
  const client_email = typeof obj.client_email === 'string' ? obj.client_email.trim() : ''
  const private_key = typeof obj.private_key === 'string' ? obj.private_key.replace(/\\n/g, '\n').trim() : ''
  const token_uri = typeof obj.token_uri === 'string' && obj.token_uri.trim() ? obj.token_uri.trim() : undefined

  const faltan: string[] = []
  if (!project_id) faltan.push('project_id')
  if (!client_email) faltan.push('client_email')
  if (!private_key) faltan.push('private_key')
  if (faltan.length) throw new FcmConfigError(`A la service account le falta: ${faltan.join(', ')}`)
  if (/BEGIN RSA PRIVATE KEY/.test(private_key)) {
    throw new FcmConfigError('private_key es PKCS#1 ("BEGIN RSA PRIVATE KEY"); WebCrypto necesita PKCS#8 ("BEGIN PRIVATE KEY"), que es lo que descarga Google')
  }
  if (!/BEGIN PRIVATE KEY/.test(private_key)) {
    throw new FcmConfigError('private_key no es un PEM PKCS#8 ("-----BEGIN PRIVATE KEY-----")')
  }
  return { project_id, client_email, private_key, token_uri }
}

/**
 * Lee `FCM_SERVICE_ACCOUNT_JSON` del entorno.
 * - Falta → `null` ("modo sin Firebase": el sender marca todo `failed` y no tira).
 * - Presente pero inservible → `FcmConfigError` (el sender lo trata igual que faltante, con el motivo).
 */
export function loadFcmServiceAccount(env: EnvReader = Deno.env): FcmServiceAccount | null {
  const raw = env.get('FCM_SERVICE_ACCOUNT_JSON')
  if (!raw || !raw.trim()) return null
  return parseServiceAccountJson(raw)
}

/** `FCM_PROJECT_ID` si está seteado; si no, el `project_id` de la service account. */
export function resolveFcmProjectId(sa: FcmServiceAccount, env: EnvReader = Deno.env): string {
  const override = env.get('FCM_PROJECT_ID')
  return override && override.trim() ? override.trim() : sa.project_id
}

// ---------------------------------------------------------------------------
// OAuth2 — access token de la service account
// ---------------------------------------------------------------------------

interface CachedToken {
  token: string
  expiresAt: number
}

// Cache por client_email dentro del isolate. Las Maps son seguras en Deno (single-threaded):
// el "paralelismo" es interleaving de awaits. `inflight` evita que 8 envíos concurrentes
// pidan 8 tokens a la vez cuando el cache está vacío.
const tokenCache = new Map<string, CachedToken>()
const inflight = new Map<string, Promise<string>>()

/** Borra el cache (todos o el de una service account). Lo usa el sender ante un 401. */
export function invalidateFcmAccessToken(sa?: FcmServiceAccount): void {
  if (sa) tokenCache.delete(sa.client_email)
  else tokenCache.clear()
}

/** Sólo para tests: cuántos tokens hay cacheados. */
export function _fcmTokenCacheSize(): number {
  return tokenCache.size
}

/**
 * Devuelve un access token válido para FCM, cacheado ~50 min.
 * Lanza `FcmAuthError` (con `retryable`) si Google no lo entrega; `FcmConfigError` si la clave no importa.
 */
export function getFcmAccessToken(sa: FcmServiceAccount, opts: FcmTokenOptions = {}): Promise<string> {
  const now = opts.now ?? Date.now
  const key = sa.client_email
  const cached = tokenCache.get(key)
  if (cached && cached.expiresAt > now()) return Promise.resolve(cached.token)

  const pending = inflight.get(key)
  if (pending) return pending

  const p = (async () => {
    try {
      const { token, expiresInSec } = await requestAccessToken(sa, opts)
      // Nunca más de 50 min, y siempre 60 s antes de lo que diga Google.
      const ttl = Math.min(ACCESS_TOKEN_TTL_MS, Math.max(0, (expiresInSec - 60) * 1000))
      tokenCache.set(key, { token, expiresAt: now() + ttl })
      return token
    } finally {
      inflight.delete(key)
    }
  })()
  inflight.set(key, p)
  return p
}

async function requestAccessToken(
  sa: FcmServiceAccount,
  opts: FcmTokenOptions,
): Promise<{ token: string; expiresInSec: number }> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const now = opts.now ?? Date.now
  const tokenUri = sa.token_uri ?? GOOGLE_TOKEN_URI

  const iat = Math.floor(now() / 1000)
  const assertion = await signJwtRs256(
    { alg: 'RS256', typ: 'JWT' },
    { iss: sa.client_email, scope: FCM_SCOPE, aud: tokenUri, iat, exp: iat + 3600 },
    sa.private_key,
  )

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  })

  let res: Response
  try {
    res = await fetchWithTimeout(
      fetchImpl,
      tokenUri,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      },
      timeoutMs,
    )
  } catch (e) {
    const msg = isAbortError(e)
      ? `Timeout al pedir el access token a Google (${timeoutMs} ms)`
      : `Error de conexión con Google OAuth2: ${errorMessage(e)}`
    throw new FcmAuthError(msg, { retryable: true, status: null })
  }

  const json = (await parseJsonSafe(res)) as {
    access_token?: unknown
    expires_in?: unknown
    error?: unknown
    error_description?: unknown
  } | null

  if (!res.ok) {
    const detalle = [json?.error, json?.error_description].filter((x) => typeof x === 'string' && x).join(' — ')
    const retryable = res.status === 429 || res.status >= 500
    throw new FcmAuthError(
      `Google OAuth2 rechazó la service account (HTTP ${res.status})${detalle ? ': ' + detalle : ''}`,
      { retryable, status: res.status },
    )
  }
  if (typeof json?.access_token !== 'string' || !json.access_token) {
    throw new FcmAuthError('Google OAuth2 respondió sin access_token', { retryable: false, status: res.status })
  }
  const expiresInSec = typeof json.expires_in === 'number' && json.expires_in > 0 ? json.expires_in : 3600
  return { token: json.access_token, expiresInSec }
}

/** Firma `header.claims` con RS256 (RSASSA-PKCS1-v1_5 + SHA-256) usando una clave PKCS#8 en PEM. */
export async function signJwtRs256(
  header: Record<string, unknown>,
  claims: Record<string, unknown>,
  pemPrivateKey: string,
): Promise<string> {
  const enc = new TextEncoder()
  const h = base64UrlEncode(enc.encode(JSON.stringify(header)))
  const c = base64UrlEncode(enc.encode(JSON.stringify(claims)))
  const signingInput = `${h}.${c}`
  const key = await importPkcs8PrivateKey(pemPrivateKey)
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(signingInput))
  return `${signingInput}.${base64UrlEncode(new Uint8Array(sig))}`
}

async function importPkcs8PrivateKey(pem: string): Promise<CryptoKey> {
  let der: Uint8Array
  try {
    der = pemToDer(pem)
  } catch (e) {
    throw new FcmConfigError(`private_key no se pudo decodificar: ${errorMessage(e)}`)
  }
  try {
    return await crypto.subtle.importKey(
      'pkcs8',
      der as BufferSource,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    )
  } catch (e) {
    throw new FcmConfigError(`private_key no es una clave RSA PKCS#8 válida: ${errorMessage(e)}`)
  }
}

// ---------------------------------------------------------------------------
// Mensaje y envío
// ---------------------------------------------------------------------------

/**
 * Claves que FCM no acepta en `data`. Google rechaza el mensaje entero si aparecen,
 * así que se filtran en vez de dejar que un `data.from` tire abajo un push.
 */
const RESERVED_DATA_KEYS = new Set(['from', 'notification', 'message_type', 'collapse_key'])

export function sanitizeFcmData(data: Record<string, unknown> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!data || typeof data !== 'object') return out
  for (const [k, v] of Object.entries(data)) {
    if (!k || RESERVED_DATA_KEYS.has(k) || k.startsWith('google.') || k.startsWith('gcm.')) continue
    if (v === undefined || v === null) continue
    out[k] = typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v)
  }
  return out
}

export interface FcmMessageEnvelope {
  message: {
    token: string
    notification: { title: string; body: string; image?: string }
    data: Record<string, string>
    android: { priority: 'HIGH'; notification: { channel_id: string; sound: 'default' } }
    apns: { headers: { 'apns-priority': '10' }; payload: { aps: { sound: 'default'; badge: number } } }
  }
}

/** Arma el cuerpo EXACTO que se manda a `messages:send`. Pura: se testea sin red. */
export function buildFcmMessage(input: FcmSendInput): FcmMessageEnvelope {
  const notification: FcmMessageEnvelope['message']['notification'] = {
    title: input.notification.title,
    body: input.notification.body,
  }
  if (input.notification.image && input.notification.image.trim()) {
    notification.image = input.notification.image.trim()
  }
  return {
    message: {
      token: input.token,
      notification,
      data: sanitizeFcmData(input.data),
      android: {
        priority: 'HIGH',
        notification: { channel_id: input.androidChannelId, sound: 'default' },
      },
      apns: {
        headers: { 'apns-priority': '10' },
        payload: { aps: { sound: 'default', badge: input.badge ?? 1 } },
      },
    },
  }
}

interface GoogleErrorBody {
  error?: {
    code?: number
    message?: string
    status?: string
    details?: Array<Record<string, unknown>>
  }
}

/**
 * Clasifica la respuesta HTTP de `messages:send`.
 *
 * Lee `error.details[].errorCode` (el `FcmError` de Google) y cae al HTTP status:
 *   - UNREGISTERED / 404            → `unregistered` (el token murió: desactivar)
 *   - SENDER_ID_MISMATCH            → `invalid` (token de otro proyecto: desactivar)
 *   - INVALID_ARGUMENT / 400        → `invalid` si el problema es el TOKEN; `fatal` si es el
 *                                     PAYLOAD (`google.rpc.BadRequest.fieldViolations` sobre otro
 *                                     campo). Desactivar todos los tokens por un mensaje mal armado
 *                                     sería apagar el push de toda la base por un bug nuestro.
 *   - 429 / QUOTA_EXCEEDED / 5xx / UNAVAILABLE / INTERNAL / 401 → `retryable`
 *   - resto (403 PERMISSION_DENIED, THIRD_PARTY_AUTH_ERROR, …)   → `fatal`
 */
export function classifyFcmResponse(status: number, body: unknown): FcmSendResult {
  if (status >= 200 && status < 300) {
    const name = (body as { name?: unknown } | null)?.name
    return { ok: true, messageId: typeof name === 'string' ? name : '' }
  }

  const err = (body as GoogleErrorBody | null)?.error
  const message = typeof err?.message === 'string' && err.message ? err.message : `HTTP ${status} de FCM`
  const googleStatus = typeof err?.status === 'string' ? err.status : undefined
  const details = Array.isArray(err?.details) ? err.details : []
  const fcmErrorCode = details
    .map((d) => (typeof d?.errorCode === 'string' ? d.errorCode : undefined))
    .find((c): c is string => !!c)
  const fieldViolations = details
    .filter((d) => typeof d?.['@type'] === 'string' && (d['@type'] as string).endsWith('google.rpc.BadRequest'))
    .flatMap((d) => (Array.isArray(d.fieldViolations) ? (d.fieldViolations as Array<{ field?: unknown }>) : []))
    .map((v) => (typeof v.field === 'string' ? v.field : ''))
    .filter(Boolean)

  const code = fcmErrorCode ?? googleStatus
  const fail = (kind: FcmFailureKind): FcmSendResult => ({ ok: false, kind, status, error: message, code })

  if (code === 'UNREGISTERED' || (status === 404 && !code) || (status === 404 && code === 'NOT_FOUND')) {
    return fail('unregistered')
  }
  if (code === 'SENDER_ID_MISMATCH') return fail('invalid')
  if (code === 'INVALID_ARGUMENT' || (status === 400 && !code)) {
    const tokenViolation = fieldViolations.some((f) => f === 'message.token' || f.endsWith('.token') || f === 'token')
    if (fieldViolations.length > 0 && !tokenViolation) return fail('fatal')
    return fail('invalid')
  }
  if (status === 429 || code === 'QUOTA_EXCEEDED' || code === 'RESOURCE_EXHAUSTED') return fail('retryable')
  if (status >= 500 || code === 'UNAVAILABLE' || code === 'INTERNAL') return fail('retryable')
  if (status === 401 || code === 'UNAUTHENTICATED') return fail('retryable')
  return fail('fatal')
}

/**
 * Envía UN mensaje a UN token por FCM v1. Nunca lanza por la respuesta de FCM: devuelve
 * `FcmSendResult`. Sólo lanza `FcmConfigError` si no hay forma de autenticarse.
 */
export async function sendFcmMessage(input: FcmSendInput, opts: FcmSendOptions = {}): Promise<FcmSendResult> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

  let accessToken = opts.accessToken
  if (!accessToken) {
    const sa = opts.serviceAccount ?? loadFcmServiceAccount()
    if (!sa) throw new FcmConfigError('FCM no configurado: falta FCM_SERVICE_ACCOUNT_JSON')
    try {
      accessToken = await getFcmAccessToken(sa, { fetchImpl, timeoutMs })
    } catch (e) {
      if (e instanceof FcmAuthError) {
        return { ok: false, kind: e.retryable ? 'retryable' : 'fatal', status: e.status, error: e.message }
      }
      throw e
    }
  }

  const url = `${FCM_SEND_BASE}/${encodeURIComponent(input.projectId)}/messages:send`
  const body = JSON.stringify(buildFcmMessage(input))

  let res: Response
  try {
    res = await fetchWithTimeout(
      fetchImpl,
      url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body,
      },
      timeoutMs,
    )
  } catch (e) {
    return {
      ok: false,
      kind: 'retryable',
      status: null,
      error: isAbortError(e)
        ? `Timeout al contactar FCM (${timeoutMs} ms)`
        : `Error de conexión con FCM: ${errorMessage(e)}`,
    }
  }

  const parsed = await parseJsonSafe(res)
  const result = classifyFcmResponse(res.status, parsed)
  // Un 401 es un access token vencido o revocado: que el próximo envío pida uno nuevo.
  if (!result.ok && res.status === 401) invalidateFcmAccessToken()
  return result
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function parseJsonSafe(res: Response): Promise<unknown> {
  let text = ''
  try {
    text = await res.text()
  } catch {
    return null
  }
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    // FCM siempre contesta JSON; si no, devolvemos el texto como mensaje.
    return { error: { message: text.slice(0, 500) } }
  }
}

function isAbortError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: string }).name === 'AbortError'
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64UrlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  return base64Decode(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
}

function base64Decode(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function pemToDer(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '')
  if (!b64) throw new Error('PEM vacío')
  return base64Decode(b64)
}
