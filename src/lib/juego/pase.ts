// =============================================================================
// Pase de dueños de «Corte Final» (Configuración → «Jugar como dueño» → ?d=<pase>).
//
// Los personajes de los dueños y jerárquicos (`soloDuenos` en tipos.ts) no los
// ve ningún cliente. El dashboard le da a quien ve la tarjeta del juego
// (`settings.view`, la organización del juego: `crearPaseDuenos`,
// src/lib/actions/juego-config.ts) un link al juego con este pase; el juego lo
// valida en el servidor (`validarPaseDuenos`, src/lib/actions/juego.ts), lo
// guarda en el celular (src/lib/juego/ui/pase-duenos.ts) y, mientras valga,
// ese celular ve a los dueños.
//
// Formato: el mismo que el token del QR (token.ts), `base64url(json).hmac`, con
//   json = {"o": <organization_id>, "u": <auth user id de quien lo pidió>, "x": <vence, unix en s>}
// La firma es sobre el cuerpo YA codificado. Vida: 90 días.
//
// Secreto: el de token.ts (BARBER_SESSION_SECRET si existe, si no la service
// role key), con una clave DERIVADA propia ('juego-duenos'): un token del QR no
// sirve de pase ni al revés. Sin secreto no se firma ni se acepta nada. Para
// anular TODOS los pases de una vez, se sube la versión de la derivación
// (`:v1` → `:v2`): hoy no hay lista de pases revocados.
//
// Esto es de la experiencia, no de seguridad: los clientes juegan con los
// barberos y los dueños entre ellos. El catálogo entero viaja en el bundle.
//
// Server-only y SIN 'use server' (helpers sincrónicos que no deben ser
// endpoints). Sin imports `@/` a propósito: se prueba con Node tal cual.
// =============================================================================

import 'server-only'
import { createHmac, timingSafeEqual } from 'crypto'

/** Vida del pase: 90 días. */
export const VIDA_PASE_DUENOS_SEG = 90 * 24 * 60 * 60

const PROPOSITO = 'juego-duenos'
/** Un pase real mide ~170 caracteres: lo que pase de esto no lo emitimos nosotros. */
const LARGO_MAXIMO = 400
/** Tolerancia de reloj entre instancias del servidor. */
const MARGEN_RELOJ_SEG = 60

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BASE64URL = /^[A-Za-z0-9_-]+$/
/** HMAC-SHA256 en base64url sin relleno: 32 bytes → 43 caracteres. */
const LARGO_FIRMA = 43

/** Lo que viaja dentro del pase (claves cortas: el link también va en un QR). */
interface PayloadPase {
  /** organizations.id */
  o: string
  /** auth.users.id de quien lo pidió desde el dashboard. */
  u: string
  /** Vencimiento (unix, segundos). */
  x: number
}

export interface PaseDuenos {
  orgId: string
  /** Quien lo pidió (auth.users.id). */
  usuarioId: string
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

/** ¿Hay secreto para firmar y validar? Sin él, «no se pudo validar» no es lo mismo que «no vale». */
export function paseConfigurado(): boolean {
  return clave() !== null
}

/**
 * Firma un pase de dueños para esa organización y ese usuario. Null si los ids no son UUID o si no
 * hay secreto configurado. `ahoraMs` existe para las pruebas.
 */
export function firmarPaseDuenos(
  datos: { orgId: string; usuarioId: string },
  ahoraMs: number = Date.now(),
): { pase: string; venceEn: number } | null {
  if (!UUID.test(datos.orgId) || !UUID.test(datos.usuarioId)) return null
  const k = clave()
  if (!k) {
    console.error('[juego/pase] Sin BARBER_SESSION_SECRET ni SUPABASE_SERVICE_ROLE_KEY: no se puede firmar el pase')
    return null
  }
  const payload: PayloadPase = {
    o: datos.orgId.toLowerCase(),
    u: datos.usuarioId.toLowerCase(),
    x: Math.floor(ahoraMs / 1000) + VIDA_PASE_DUENOS_SEG,
  }
  const cuerpo = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return { pase: `${cuerpo}.${firmar(cuerpo, k)}`, venceEn: payload.x }
}

/**
 * Verifica la firma (en tiempo constante), el vencimiento y la organización. Null ante cualquier
 * cosa rara: alterado, vencido, mal formado, firmado con otra clave (un token del QR, por ejemplo),
 * de otra organización o con un vencimiento más lejano que el que emitimos. Nunca tira.
 */
export function leerPaseDuenos(valor: unknown, orgEsperada: string, ahoraMs: number = Date.now()): PaseDuenos | null {
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
  const { o, u, x } = datos as Partial<PayloadPase>
  if (typeof o !== 'string' || !UUID.test(o) || typeof u !== 'string' || !UUID.test(u)) return null
  if (typeof x !== 'number' || !Number.isInteger(x)) return null
  if (typeof orgEsperada !== 'string' || o.toLowerCase() !== orgEsperada.toLowerCase()) return null

  const ahora = Math.floor(ahoraMs / 1000)
  if (x <= ahora) return null
  // Un vencimiento más lejano que la vida del pase no lo emitimos nosotros.
  if (x - ahora > VIDA_PASE_DUENOS_SEG + MARGEN_RELOJ_SEG) return null

  return { orgId: o, usuarioId: u, venceEn: x }
}
