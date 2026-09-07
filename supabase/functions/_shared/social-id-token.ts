/**
 * Verificación del `id_token` de Google y de Apple, en el SERVIDOR.
 *
 * Por qué acá y no con `signInWithIdToken` desde Flutter: ese camino crea un
 * usuario de Supabase suelto —sin fila en `clients`, con un JWT válido y sin
 * `app_metadata.user_type='client'`, que es de lo que depende toda la RLS de la
 * migración 192— y después habría que fusionarlo a mano con el usuario-alias
 * del teléfono. Un humano, una cuenta: el proveedor social se verifica acá y la
 * sesión la firma `client-auth` sobre el usuario que ya corresponde al cliente.
 *
 * Qué se valida (los cinco, ninguno es opcional):
 *   1. Firma RS256/ES256 contra la clave pública del proveedor (JWKS por `kid`).
 *   2. `iss` exacto (lista cerrada por proveedor).
 *   3. `aud` ∈ los client IDs / bundle IDs configurados por secreto. Sin esta
 *      validación, un id_token emitido para CUALQUIER otra app de Google
 *      entraría como si fuera nuestro.
 *   4. `exp` (con 60 s de tolerancia de reloj).
 *   5. `nonce`, si la app declaró haber mandado uno.
 *
 * El JWKS se cachea en memoria del isolate con TTL. No es una optimización
 * cosmética: bajarlo en cada login le pone una dependencia de red sincrónica a
 * cada apertura de la app.
 *
 * Un fallo de RED contra el proveedor NO es un token inválido: se devuelve
 * `transitorio: true` y el caller contesta 503, no 401. Decirle "tu cuenta de
 * Google no sirve" a alguien porque Google estaba caído es el peor mensaje
 * posible.
 */

export type ProveedorSocial = 'google' | 'apple'

export const PROVEEDORES_SOCIALES: readonly ProveedorSocial[] = ['google', 'apple']

/** Lo que sacamos del token una vez verificado. */
export interface IdentidadSocial {
  provider: ProveedorSocial
  /** Claim `sub`: el identificador ESTABLE. El email puede cambiar; esto no. */
  subject: string
  email: string | null
  /**
   * `true` si el proveedor dice que verificó el email. Apple manda `"true"` /
   * `"false"` como string; Google, booleano. Acá ya está normalizado.
   */
  emailVerified: boolean
  /**
   * Nombre, si el token lo trae. Apple NO lo manda nunca en el token: llega
   * aparte, en la credencial, y SÓLO en la primera autorización de ese Apple ID
   * para esta app. Si no se guarda en ese momento, no se recupera.
   */
  name: string | null
  /** Subconjunto de claims para auditoría (`client_social_identities.raw`). */
  claims: Record<string, unknown>
}

export type ResultadoIdToken =
  | { ok: true; identidad: IdentidadSocial }
  | { ok: false; motivo: string; transitorio: boolean }

export interface VerificarIdTokenInput {
  provider: ProveedorSocial
  idToken: string
  /**
   * Los `aud` aceptados. Google: los client IDs (iOS, Android, Web) de la app.
   * Apple (flujo nativo): el bundle id. Si viene vacío, se rechaza: es un error
   * de configuración, no del usuario.
   */
  audiencias: string[]
  /**
   * El nonce que la app dice haber mandado, si mandó uno. Se acepta que el
   * claim sea ese valor tal cual o su `sha256` en hex: las dos convenciones se
   * usan en la práctica (iOS suele mandar el hash del nonce crudo) y en las dos
   * la comparación es contra un valor que trae la app, así que no debilita nada.
   */
  nonce?: string | null
  /** Timeout del fetch del JWKS (default 8 s). */
  timeoutMs?: number
}

// ── Configuración por proveedor ─────────────────────────────────────────────

const JWKS_URL: Record<ProveedorSocial, string> = {
  google: 'https://www.googleapis.com/oauth2/v3/certs',
  apple: 'https://appleid.apple.com/auth/keys',
}

const EMISORES: Record<ProveedorSocial, string[]> = {
  // Google emite con las dos formas y las dos son legítimas.
  google: ['accounts.google.com', 'https://accounts.google.com'],
  apple: ['https://appleid.apple.com'],
}

const JWKS_TTL_MS = 60 * 60 * 1000
/** Mínimo entre dos bajadas del JWKS ante un `kid` desconocido (anti-martilleo). */
const JWKS_REFRESCO_MIN_MS = 60 * 1000
const SKEW_SEGUNDOS = 60
const DEFAULT_TIMEOUT_MS = 8_000

// ── Cache del JWKS (memoria del isolate) ────────────────────────────────────

interface Jwk {
  kty: string
  kid?: string
  alg?: string
  use?: string
  n?: string
  e?: string
  crv?: string
  x?: string
  y?: string
}

interface CacheJwks {
  claves: Jwk[]
  expiraEn: number
  bajadoEn: number
}

const cacheJwks = new Map<ProveedorSocial, CacheJwks>()

/** Sólo para tests: vacía el cache del isolate. */
export function olvidarJwksEnMemoria(): void {
  cacheJwks.clear()
}

// ── API ─────────────────────────────────────────────────────────────────────

/**
 * Verifica un `id_token` y devuelve la identidad, o el motivo del rechazo.
 *
 * NUNCA tira: todo error (red, JSON, cripto) sale como `{ ok: false }`. El
 * `motivo` es para el log del servidor, no para el usuario — no se lo devuelve
 * a la app, que sólo ve `SOCIAL_TOKEN_INVALID`.
 */
export async function verificarIdTokenSocial(input: VerificarIdTokenInput): Promise<ResultadoIdToken> {
  const { provider, idToken } = input

  if (!input.audiencias || input.audiencias.length === 0) {
    // Configuración faltante, no culpa del usuario: sin `aud` esperado, aceptar
    // el token sería aceptar el de cualquier app del mundo.
    return { ok: false, motivo: `no hay audiencias configuradas para ${provider}`, transitorio: true }
  }

  const partes = (idToken ?? '').split('.')
  if (partes.length !== 3) return { ok: false, motivo: 'el token no tiene 3 segmentos', transitorio: false }

  let header: { kid?: string; alg?: string }
  let payload: Record<string, unknown>
  try {
    header = JSON.parse(textoDesdeBase64Url(partes[0])) as { kid?: string; alg?: string }
    payload = JSON.parse(textoDesdeBase64Url(partes[1])) as Record<string, unknown>
  } catch (e: unknown) {
    return { ok: false, motivo: `header/payload ilegible: ${mensaje(e)}`, transitorio: false }
  }

  const alg = header.alg ?? ''
  if (alg !== 'RS256' && alg !== 'ES256') {
    // `none` y compañía: rechazo explícito. El algoritmo lo decidimos nosotros,
    // no el token.
    return { ok: false, motivo: `alg no soportado: ${alg || '(vacío)'}`, transitorio: false }
  }
  if (!header.kid) return { ok: false, motivo: 'el header no trae kid', transitorio: false }

  // 1. Firma.
  const firmaOk = await verificarFirma(provider, header.kid, alg, partes, input.timeoutMs)
  if (!firmaOk.ok) return firmaOk

  // 2. Emisor.
  const iss = typeof payload.iss === 'string' ? payload.iss : ''
  if (!EMISORES[provider].includes(iss)) {
    return { ok: false, motivo: `iss inesperado: ${JSON.stringify(iss)}`, transitorio: false }
  }

  // 3. Audiencia.
  const auds = Array.isArray(payload.aud)
    ? payload.aud.filter((a): a is string => typeof a === 'string')
    : typeof payload.aud === 'string'
      ? [payload.aud]
      : []
  if (!auds.some((a) => input.audiencias.includes(a))) {
    return { ok: false, motivo: 'aud fuera de la lista configurada', transitorio: false }
  }

  // 4. Vencimiento.
  const exp = typeof payload.exp === 'number' ? payload.exp : NaN
  if (!Number.isFinite(exp)) return { ok: false, motivo: 'sin exp', transitorio: false }
  const ahora = Math.floor(Date.now() / 1000)
  if (exp + SKEW_SEGUNDOS < ahora) return { ok: false, motivo: 'token vencido', transitorio: false }
  const iat = typeof payload.iat === 'number' ? payload.iat : null
  if (iat !== null && iat - SKEW_SEGUNDOS > ahora) {
    return { ok: false, motivo: 'iat en el futuro', transitorio: false }
  }

  // 5. Nonce (sólo si la app declaró uno).
  if (input.nonce) {
    const claim = typeof payload.nonce === 'string' ? payload.nonce : ''
    if (!claim) return { ok: false, motivo: 'se esperaba nonce y el token no lo trae', transitorio: false }
    const hash = await sha256Hex(input.nonce)
    if (!igualesEnTiempoConstanteTexto(claim, input.nonce) && !igualesEnTiempoConstanteTexto(claim, hash)) {
      return { ok: false, motivo: 'nonce no coincide', transitorio: false }
    }
  }

  const sub = typeof payload.sub === 'string' ? payload.sub.trim() : ''
  if (!sub) return { ok: false, motivo: 'sin sub', transitorio: false }

  const email = typeof payload.email === 'string' && payload.email.trim() ? payload.email.trim().toLowerCase() : null
  const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : null

  return {
    ok: true,
    identidad: {
      provider,
      subject: sub,
      email,
      emailVerified: aBooleano(payload.email_verified),
      name,
      // Subconjunto acotado: `client_social_identities` es una tabla privada
      // (RLS sin policies, sólo service_role), pero igual no guardamos el token
      // ni claims que no usemos.
      claims: {
        iss,
        aud: auds.length === 1 ? auds[0] : auds,
        sub,
        email,
        email_verified: aBooleano(payload.email_verified),
        name,
        iat,
        exp,
        is_private_email: aBooleano(payload.is_private_email),
      },
    },
  }
}

/**
 * `true` si el email es un relay de Apple. Es un identificador válido pero NO
 * un canal de contacto: el canal es el teléfono.
 */
export function esEmailRelayDeApple(email: string | null | undefined): boolean {
  return (email ?? '').toLowerCase().endsWith('@privaterelay.appleid.com')
}

/** `"a,b , c"` → `['a','b','c']`. Para `GOOGLE_CLIENT_IDS` / `APPLE_BUNDLE_IDS`. */
export function parsearListaDeIds(env: string | undefined): string[] {
  if (!env) return []
  return Array.from(
    new Set(
      env
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  )
}

// ── interno ─────────────────────────────────────────────────────────────────

async function verificarFirma(
  provider: ProveedorSocial,
  kid: string,
  alg: 'RS256' | 'ES256',
  partes: string[],
  timeoutMs: number | undefined,
): Promise<{ ok: true } | { ok: false; motivo: string; transitorio: boolean }> {
  const claves = await obtenerJwks(provider, kid, timeoutMs)
  if (!claves.ok) return claves

  const jwk = claves.claves.find((k) => k.kid === kid)
  if (!jwk) {
    // Ya se intentó refrescar dentro de `obtenerJwks`: si el kid sigue sin
    // aparecer, el token no lo firmó este proveedor.
    return { ok: false, motivo: `kid ${kid} no está en el JWKS de ${provider}`, transitorio: false }
  }

  const datos = new TextEncoder().encode(`${partes[0]}.${partes[1]}`)
  let firma: Uint8Array
  try {
    firma = bytesDesdeBase64Url(partes[2])
  } catch (e: unknown) {
    return { ok: false, motivo: `firma ilegible: ${mensaje(e)}`, transitorio: false }
  }

  try {
    const algImport: AlgorithmIdentifier | RsaHashedImportParams | EcKeyImportParams =
      alg === 'RS256'
        ? { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
        : { name: 'ECDSA', namedCurve: 'P-256' }
    const algVerify: AlgorithmIdentifier | EcdsaParams =
      alg === 'RS256' ? { name: 'RSASSA-PKCS1-v1_5' } : { name: 'ECDSA', hash: 'SHA-256' }

    // `alg` y `use` del JWK sobran para importKey y algunos runtimes son
    // quisquillosos: se importa sólo el material de la clave.
    const material = alg === 'RS256'
      ? { kty: jwk.kty, n: jwk.n, e: jwk.e }
      : { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }

    const key = await crypto.subtle.importKey('jwk', material as JsonWebKey, algImport, false, ['verify'])
    const ok = await crypto.subtle.verify(algVerify, key, firma as unknown as BufferSource, datos as unknown as BufferSource)
    if (!ok) return { ok: false, motivo: 'firma inválida', transitorio: false }
    return { ok: true }
  } catch (e: unknown) {
    return { ok: false, motivo: `no se pudo verificar la firma: ${mensaje(e)}`, transitorio: false }
  }
}

/**
 * Claves del proveedor, del cache si sirven. Si el `kid` buscado no está en lo
 * cacheado (rotación de claves), se vuelve a bajar — como mucho una vez por
 * minuto, para que un token basura con un kid inventado no nos convierta en un
 * cliente de martilleo contra Google.
 */
async function obtenerJwks(
  provider: ProveedorSocial,
  kid: string,
  timeoutMs: number | undefined,
): Promise<{ ok: true; claves: Jwk[] } | { ok: false; motivo: string; transitorio: boolean }> {
  const ahora = Date.now()
  const cache = cacheJwks.get(provider)

  const vigente = cache && cache.expiraEn > ahora
  const tieneElKid = !!cache?.claves.some((k) => k.kid === kid)
  const puedeRefrescar = !cache || cache.bajadoEn + JWKS_REFRESCO_MIN_MS <= ahora

  if (vigente && tieneElKid) return { ok: true, claves: cache.claves }
  if (vigente && !puedeRefrescar) return { ok: true, claves: cache.claves }

  const bajado = await bajarJwks(provider, timeoutMs)
  if (!bajado.ok) {
    // Si teníamos algo cacheado —aunque esté vencido— es mejor que nada: un
    // corte de red de Google no puede dejar a todos los clientes afuera.
    if (cache) {
      console.warn('[social-id-token]', `JWKS de ${provider} no se pudo refrescar, se usa el cache viejo:`, bajado.motivo)
      return { ok: true, claves: cache.claves }
    }
    return bajado
  }

  cacheJwks.set(provider, { claves: bajado.claves, expiraEn: ahora + JWKS_TTL_MS, bajadoEn: ahora })
  return { ok: true, claves: bajado.claves }
}

async function bajarJwks(
  provider: ProveedorSocial,
  timeoutMs: number | undefined,
): Promise<{ ok: true; claves: Jwk[] } | { ok: false; motivo: string; transitorio: boolean }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const res = await fetch(JWKS_URL[provider], { signal: controller.signal })
    if (!res.ok) {
      return { ok: false, motivo: `JWKS de ${provider}: HTTP ${res.status}`, transitorio: true }
    }
    const body = (await res.json()) as { keys?: Jwk[] }
    const claves = (body.keys ?? []).filter((k) => !!k && typeof k.kty === 'string')
    if (claves.length === 0) return { ok: false, motivo: `JWKS de ${provider} vino vacío`, transitorio: true }
    return { ok: true, claves }
  } catch (e: unknown) {
    return { ok: false, motivo: `JWKS de ${provider}: ${mensaje(e)}`, transitorio: true }
  } finally {
    clearTimeout(timer)
  }
}

function textoDesdeBase64Url(s: string): string {
  return new TextDecoder().decode(bytesDesdeBase64Url(s))
}

function bytesDesdeBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const relleno = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  const bin = atob(b64 + relleno)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  let out = ''
  for (const b of new Uint8Array(digest)) out += b.toString(16).padStart(2, '0')
  return out
}

/** Comparación sin cortocircuito (mismo criterio que `_shared/otp.ts`). */
function igualesEnTiempoConstanteTexto(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  const len = Math.max(ea.length, eb.length)
  let diff = ea.length ^ eb.length
  for (let i = 0; i < len; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0)
  return diff === 0
}

/** Apple manda `"true"`/`"false"` como string; Google, booleano. */
function aBooleano(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') return v.toLowerCase() === 'true'
  return false
}

function mensaje(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
