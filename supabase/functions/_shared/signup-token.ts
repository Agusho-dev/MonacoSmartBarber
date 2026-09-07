/**
 * `signup_token`: el pase de 15 minutos que ata "verifiqué tu Google/Apple" con
 * "ahora verificá tu teléfono".
 *
 * Cuando alguien entra con Google o con Apple y NO tenemos todavía esa
 * identidad vinculada a un cliente, no se crea nada: se le devuelve este token
 * y se le pide el teléfono. El código de WhatsApp que sigue es el que decide
 * quién es; el token sólo transporta, firmado, lo que ya verificamos del
 * proveedor (provider + subject + email + nombre + organización).
 *
 * NO se guarda en la base a propósito: es autocontenido, de un solo propósito y
 * de vida corta. Una tabla más para esto sería una tabla más que limpiar, y el
 * dato que lleva no vale nada sin el OTP que viene después.
 *
 * Formato: `v1.<base64url(json)>.<base64url(hmac-sha256)>`, con el HMAC sobre
 * `v1.<base64url(json)>`. La firma se compara en tiempo constante.
 */

import type { ProveedorSocial } from './social-id-token.ts'

export interface SignupTokenPayload {
  provider: ProveedorSocial
  /** Claim `sub` del proveedor: el identificador estable. */
  subject: string
  email: string | null
  name: string | null
  /** El token vale para UNA organización: se verifica contra el `org_id` del request. */
  orgId: string
}

export type ResultadoSignupToken =
  | { ok: true; payload: SignupTokenPayload; expiraEn: number }
  | { ok: false; motivo: string; vencido: boolean }

const PREFIJO = 'v1'

interface PayloadSerializado {
  v: 1
  p: string
  s: string
  e: string | null
  n: string | null
  o: string
  iat: number
  exp: number
}

/** Firma un `signup_token` que vence en `ttlSegundos`. */
export async function firmarSignupToken(
  payload: SignupTokenPayload,
  secreto: string,
  ttlSegundos: number,
): Promise<string> {
  const ahora = Math.floor(Date.now() / 1000)
  const cuerpo: PayloadSerializado = {
    v: 1,
    p: payload.provider,
    s: payload.subject,
    e: payload.email,
    n: payload.name,
    o: payload.orgId,
    iat: ahora,
    exp: ahora + ttlSegundos,
  }
  const datos = `${PREFIJO}.${aBase64Url(new TextEncoder().encode(JSON.stringify(cuerpo)))}`
  const firma = await hmac(datos, secreto)
  return `${datos}.${firma}`
}

/**
 * Verifica firma y vencimiento. NUNCA tira: un token basura sale como
 * `{ ok: false }`. `vencido` separa "esto no lo firmamos nosotros" de "esto lo
 * firmamos pero pasaron los 15 minutos", que para la app son dos mensajes
 * distintos (rehacer el paso social vs. algo raro).
 */
export async function verificarSignupToken(token: string, secreto: string): Promise<ResultadoSignupToken> {
  const partes = (token ?? '').split('.')
  if (partes.length !== 3 || partes[0] !== PREFIJO) {
    return { ok: false, motivo: 'formato inválido', vencido: false }
  }

  const datos = `${partes[0]}.${partes[1]}`
  let esperada: string
  try {
    esperada = await hmac(datos, secreto)
  } catch (e: unknown) {
    return { ok: false, motivo: `no se pudo calcular el HMAC: ${e instanceof Error ? e.message : String(e)}`, vencido: false }
  }
  if (!igualesEnTiempoConstante(esperada, partes[2])) {
    return { ok: false, motivo: 'firma inválida', vencido: false }
  }

  let cuerpo: PayloadSerializado
  try {
    cuerpo = JSON.parse(new TextDecoder().decode(desdeBase64Url(partes[1]))) as PayloadSerializado
  } catch {
    return { ok: false, motivo: 'payload ilegible', vencido: false }
  }

  if (cuerpo.v !== 1) return { ok: false, motivo: `versión desconocida: ${cuerpo.v}`, vencido: false }
  if (cuerpo.p !== 'google' && cuerpo.p !== 'apple') {
    return { ok: false, motivo: `provider desconocido: ${cuerpo.p}`, vencido: false }
  }
  if (typeof cuerpo.s !== 'string' || !cuerpo.s || typeof cuerpo.o !== 'string' || !cuerpo.o) {
    return { ok: false, motivo: 'payload incompleto', vencido: false }
  }

  const ahora = Math.floor(Date.now() / 1000)
  if (typeof cuerpo.exp !== 'number' || cuerpo.exp <= ahora) {
    return { ok: false, motivo: 'token vencido', vencido: true }
  }

  return {
    ok: true,
    payload: {
      provider: cuerpo.p,
      subject: cuerpo.s,
      email: typeof cuerpo.e === 'string' ? cuerpo.e : null,
      name: typeof cuerpo.n === 'string' ? cuerpo.n : null,
      orgId: cuerpo.o,
    },
    expiraEn: cuerpo.exp,
  }
}

// ── interno ─────────────────────────────────────────────────────────────────

async function hmac(datos: string, secreto: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secreto),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const firma = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(datos) as unknown as BufferSource)
  return aBase64Url(new Uint8Array(firma))
}

function aBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function desdeBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const relleno = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  const bin = atob(b64 + relleno)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Mismo criterio que `_shared/otp.ts`: el largo se mezcla, no se cortocircuita. */
function igualesEnTiempoConstante(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  const len = Math.max(ea.length, eb.length)
  let diff = ea.length ^ eb.length
  for (let i = 0; i < len; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0)
  return diff === 0
}
