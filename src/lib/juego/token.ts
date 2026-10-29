// =============================================================================
// Token del QR de «Corte Final» (kiosko → /juego?t=<token>).
//
// El cartel de éxito del kiosko muestra un QR con este token. Prueba que el
// celular viene de una entrada REAL de la fila (para saludar por el nombre de
// pila, mostrar el turno y atar la partida a la sucursal) sin exponer nada:
// lleva sólo dos ids y el vencimiento, y la firma impide fabricarlo.
//
// Formato: `base64url(json).hmac_sha256_base64url`, con
//   json = {"e": <queue_entry_id>, "b": <branch_id>, "x": <vence, unix en s>}
// La firma es sobre el cuerpo YA codificado (no sobre el JSON): así no hay dos
// cadenas distintas que pasen por el mismo token.
//
// Secreto: el mismo criterio que la cookie del panel (src/lib/barber-cookie.ts):
// BARBER_SESSION_SECRET si existe, si no la service role key. La clave se
// DERIVA con el propósito (como src/lib/actions/rostro-staff.ts) para que un
// valor firmado para otra cosa no sirva acá. Sin secreto no se firma ni se
// acepta nada: falla cerrado.
//
// Server-only y SIN 'use server': exporta helpers sincrónicos que no deben ser
// endpoints. Sin imports `@/` a propósito (se prueba con Node tal cual).
// =============================================================================

import 'server-only'
import { createHmac, timingSafeEqual } from 'crypto'

/** Vida del token: una espera larga y el rato de después (6 h). */
export const VIDA_TOKEN_JUEGO_SEG = 6 * 60 * 60

const PROPOSITO = 'juego-qr'
/** Un token real mide ~180 caracteres: lo que pase de esto no lo emitimos nosotros. */
const LARGO_MAXIMO = 400
/** Tolerancia de reloj entre instancias del servidor. */
const MARGEN_RELOJ_SEG = 60

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BASE64URL = /^[A-Za-z0-9_-]+$/
/** HMAC-SHA256 en base64url sin relleno: 32 bytes → 43 caracteres. */
const LARGO_FIRMA = 43

/** Lo que viaja dentro del token (claves cortas: el QR tiene que quedar liviano). */
interface PayloadTokenJuego {
  /** queue_entries.id */
  e: string
  /** branches.id */
  b: string
  /** Vencimiento (unix, segundos). */
  x: number
}

export interface TokenJuego {
  queueEntryId: string
  branchId: string
  /** Vencimiento (unix, segundos). */
  venceEn: number
}

function clave(): Buffer | null {
  const base = process.env.BARBER_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base) return null
  return createHmac('sha256', base).update(`monaco:${PROPOSITO}:v1`).digest()
}

function firmar(cuerpo: string, k: Buffer): string {
  return createHmac('sha256', k).update(cuerpo).digest('base64url')
}

/**
 * Firma el token de una entrada de la fila. Null si los ids no son UUID o si
 * no hay secreto configurado. `ahoraMs` existe para las pruebas.
 */
export function firmarTokenJuego(
  datos: { queueEntryId: string; branchId: string },
  ahoraMs: number = Date.now(),
): string | null {
  if (!UUID.test(datos.queueEntryId) || !UUID.test(datos.branchId)) return null
  const k = clave()
  if (!k) {
    console.error('[juego/token] Sin BARBER_SESSION_SECRET ni SUPABASE_SERVICE_ROLE_KEY: no se puede firmar el QR')
    return null
  }
  const payload: PayloadTokenJuego = {
    e: datos.queueEntryId.toLowerCase(),
    b: datos.branchId.toLowerCase(),
    x: Math.floor(ahoraMs / 1000) + VIDA_TOKEN_JUEGO_SEG,
  }
  const cuerpo = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${cuerpo}.${firmar(cuerpo, k)}`
}

/**
 * Verifica la firma (en tiempo constante) y el vencimiento. Null ante
 * cualquier cosa rara: adulterado, vencido, mal formado, firmado con otra
 * clave o con un vencimiento más lejano que el que emitimos. Nunca tira.
 */
export function leerTokenJuego(valor: unknown, ahoraMs: number = Date.now()): TokenJuego | null {
  if (typeof valor !== 'string' || valor.length === 0 || valor.length > LARGO_MAXIMO) return null
  const punto = valor.indexOf('.')
  if (punto <= 0 || punto !== valor.lastIndexOf('.')) return null
  const cuerpo = valor.slice(0, punto)
  const firmaRecibida = valor.slice(punto + 1)
  if (!BASE64URL.test(cuerpo) || firmaRecibida.length !== LARGO_FIRMA || !BASE64URL.test(firmaRecibida)) {
    return null
  }

  const k = clave()
  if (!k) return null
  const esperada = Buffer.from(firmar(cuerpo, k), 'utf8')
  const recibida = Buffer.from(firmaRecibida, 'utf8')
  if (esperada.length !== recibida.length) return null
  try {
    if (!timingSafeEqual(esperada, recibida)) return null
  } catch {
    return null
  }

  let datos: unknown
  try {
    datos = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!datos || typeof datos !== 'object') return null
  const { e, b, x } = datos as Partial<PayloadTokenJuego>
  if (typeof e !== 'string' || !UUID.test(e) || typeof b !== 'string' || !UUID.test(b)) return null
  if (typeof x !== 'number' || !Number.isInteger(x)) return null

  const ahora = Math.floor(ahoraMs / 1000)
  if (x <= ahora) return null
  // Un vencimiento más lejano que la vida del token no lo emitimos nosotros.
  if (x - ahora > VIDA_TOKEN_JUEGO_SEG + MARGEN_RELOJ_SEG) return null

  return { queueEntryId: e, branchId: b, venceEn: x }
}
