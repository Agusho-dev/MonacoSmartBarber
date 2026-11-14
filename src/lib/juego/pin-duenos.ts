// =============================================================================
// El PIN de los dueños de «Corte Final» (mig 239, `juego_pin_duenos`).
//
// En la portada del juego, 5 toques al logo de Monaco abren un teclado
// (src/components/juego/pin-duenos.tsx); con el PIN, `canjearPinDuenos`
// (src/lib/actions/juego.ts) devuelve el mismo pase de dueños que da el
// dashboard (`firmarPaseDuenos`, ./pase.ts). Un PIN por organización, de 4 a 8
// dígitos, compartido por los 4 dueños; lo ponen y lo cambian desde
// Configuración → «Corte Final» (src/lib/actions/juego-config.ts).
//
// Hash: crypto.scrypt con sal propia por fila, `scrypt$<sal>$<hash>` en
// base64url; se compara con timingSafeEqual. La tabla la lee sólo el service
// role (RLS sin policies): NUNCA app_settings, que anon lee entera (Known
// Risk #36), porque un PIN de 6 dígitos se prueba entero offline en segundos.
//
// El canje, en este orden: (1) el formato, sin tocar la base; (2) el tope
// (`check_rate_limit`): 5 intentos cada 10 min por IP y un techo de 30 cada
// 10 min para todos (contra el reparto entre IPs), y cuentan todos los
// intentos, también los buenos; (3) recién entonces se lee el hash y se
// compara. Sin PIN configurado, sin la tabla (la mig 239 sin aplicar) o con
// cualquier falla de la base, la respuesta es la de un PIN incorrecto: falla
// cerrado. El tope también: `rateLimit()` (src/lib/rate-limit.ts) deja pasar
// si la base falla, y para un PIN eso abriría la fuerza bruta, así que acá se
// llama a la RPC directo y una falla es un rechazo.
//
// El PIN no se loguea nunca (ni en los errores).
//
// Cambiar el PIN NO anula los pases ya dados: son sin estado y valen 90 días.
// Para anularlos todos, `:v1` → `:v2` en ./pase.ts.
//
// Server-only y SIN 'use server'. Sin imports `@/` a propósito: se prueba con
// Node tal cual (con un cliente de Supabase de mentira).
// =============================================================================

import 'server-only'
import { randomBytes, scrypt, timingSafeEqual } from 'crypto'
import { firmarPaseDuenos } from './pase'
import { segundosHasta } from './guardado'
import type { RespuestaPinDuenos } from './ui/pase-duenos'

/** 4 a 8 dígitos (en la UI del dashboard se recomiendan 6). */
const FORMATO_PIN = /^[0-9]{4,8}$/
const BASE64URL = /^[A-Za-z0-9_-]+$/

/** Parámetros de scrypt: N = 2^14, r = 8, p = 1 (≈ 16 MB y unas decenas de ms por intento). */
const OPCIONES_SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const
const LARGO_SAL = 16
const LARGO_HASH = 32
const PREFIJO = 'scrypt'

/** Tope por IP: 5 intentos cada 10 min. */
export const LIMITE_PIN_IP = { limit: 5, window: 600 } as const
/** Techo para todos: 30 intentos cada 10 min (alguien que reparte los intentos entre muchas IPs). */
export const LIMITE_PIN_TODOS = { limit: 30, window: 600 } as const
const BUCKET_PIN = 'juego_pin'
export const CLAVE_PIN_TODOS = 'juego-pin:todos'
export function clavePinIp(ip: string): string {
  return `juego-pin:ip:${ip}`
}

/** Códigos de una base sin la tabla (la mig 239 sin aplicar): PostgreSQL y el caché de PostgREST. */
export const SIN_TABLA = new Set(['42P01', 'PGRST205'])

/** ¿Es un PIN con forma válida (un string de 4 a 8 dígitos)? */
export function esFormatoPin(valor: unknown): valor is string {
  return typeof valor === 'string' && FORMATO_PIN.test(valor)
}

function derivar(pin: string, sal: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(pin, sal, LARGO_HASH, OPCIONES_SCRYPT, (error, clave) => (error ? reject(error) : resolve(clave)))
  })
}

/** El hash para guardar: `scrypt$<sal>$<hash>` (base64url), con una sal nueva cada vez. */
export async function hashearPin(pin: string): Promise<string> {
  if (!esFormatoPin(pin)) throw new Error('PIN con formato inválido')
  const sal = randomBytes(LARGO_SAL)
  const hash = await derivar(pin, sal)
  return `${PREFIJO}$${sal.toString('base64url')}$${hash.toString('base64url')}`
}

/** Una sal fija para gastar lo mismo cuando no hay hash contra el cual comparar. */
const SAL_DE_RELLENO = Buffer.alloc(LARGO_SAL, 7)

/**
 * ¿El PIN corresponde a ese hash? Compara en tiempo constante. False ante cualquier cosa rara: PIN
 * mal formado, hash con otro formato, sal o hash del largo equivocado. Nunca tira.
 */
export async function verificarPin(pin: unknown, almacenado: unknown): Promise<boolean> {
  if (!esFormatoPin(pin)) return false
  const partes = typeof almacenado === 'string' ? almacenado.split('$') : []
  if (partes.length !== 3 || partes[0] !== PREFIJO) return false
  const [, salTexto, hashTexto] = partes
  if (!BASE64URL.test(salTexto) || !BASE64URL.test(hashTexto)) return false
  const sal = Buffer.from(salTexto, 'base64url')
  const esperado = Buffer.from(hashTexto, 'base64url')
  if (sal.length < LARGO_SAL || esperado.length !== LARGO_HASH) return false
  try {
    const calculado = await derivar(pin, sal)
    return calculado.length === esperado.length && timingSafeEqual(calculado, esperado)
  } catch {
    return false
  }
}

// ── El canje ────────────────────────────────────────────────────────────────

interface ErrorBase {
  code?: string
  message?: string
}
interface RespuestaBase {
  data: unknown
  error: ErrorBase | null
}

/**
 * Lo que el canje usa del cliente de Supabase (el admin, service role). Estructural: el cliente real
 * entra tal cual y las pruebas pasan uno de mentira.
 */
export interface ClientePin {
  rpc(
    funcion: 'check_rate_limit',
    args: { p_bucket: string; p_key: string; p_limit: number; p_window_seconds: number },
  ): PromiseLike<RespuestaBase>
  from(tabla: 'juego_pin_duenos'): {
    select(columnas: string): {
      eq(columna: string, valor: string): { maybeSingle(): PromiseLike<RespuestaBase> }
    }
  }
}

export interface ContextoCanje {
  /** La IP del pedido (getClientIP). */
  ip: string
  /** La organización del juego (orgDelJuego). */
  orgDelJuego: () => Promise<string>
  /** Para las pruebas. */
  ahoraMs?: () => number
}

const RECHAZO_PIN: RespuestaPinDuenos = { ok: false, motivo: 'pin' }

/**
 * Un paso del tope. 'pasa'; los segundos de espera si lo frenó; null si la RPC falló (y entonces
 * el canje se rechaza: falla cerrado).
 */
async function tope(
  admin: ClientePin,
  clave: string,
  limite: { limit: number; window: number },
  ahoraMs: number,
): Promise<'pasa' | number | null> {
  const { data, error } = await admin.rpc('check_rate_limit', {
    p_bucket: BUCKET_PIN,
    p_key: clave,
    p_limit: limite.limit,
    p_window_seconds: limite.window,
  })
  const fila = Array.isArray(data) ? (data[0] as { allowed?: unknown; reset_at?: unknown } | undefined) : undefined
  if (error || !fila || typeof fila.allowed !== 'boolean') {
    console.error('[juego/pin] check_rate_limit:', error?.code ?? '', error?.message ?? 'sin fila')
    return null
  }
  if (fila.allowed) return 'pasa'
  return segundosHasta(typeof fila.reset_at === 'string' ? fila.reset_at : null, ahoraMs, limite.window)
}

/**
 * Canjea el PIN por un pase de dueños (el mismo que da el dashboard, ./pase.ts). Ver el encabezado:
 * formato → tope por IP → techo para todos → hash. `{ ok: false, motivo: 'pin' }` también sin PIN
 * configurado, sin la tabla o con la base caída; `'tope'` con los segundos que faltan. Nunca tira.
 */
export async function canjearPin(admin: ClientePin, pin: unknown, ctx: ContextoCanje): Promise<RespuestaPinDuenos> {
  // 1. El formato, antes de todo: sin tocar la base ni el tope.
  if (!esFormatoPin(pin)) return RECHAZO_PIN
  const ahora = ctx.ahoraMs ?? Date.now
  try {
    // 2. El tope: primero la IP y después el techo de todos. Así una IP sola no gasta el techo de
    //    todos (lo que frena la IP no llega a sumarle).
    const porIp = await tope(admin, clavePinIp(ctx.ip), LIMITE_PIN_IP, ahora())
    if (porIp === null) return RECHAZO_PIN
    if (porIp !== 'pasa') return { ok: false, motivo: 'tope', esperarSeg: porIp }
    const porTodos = await tope(admin, CLAVE_PIN_TODOS, LIMITE_PIN_TODOS, ahora())
    if (porTodos === null) return RECHAZO_PIN
    if (porTodos !== 'pasa') return { ok: false, motivo: 'tope', esperarSeg: porTodos }

    // 3. El hash de la organización del juego.
    const orgId = await ctx.orgDelJuego()
    const { data, error } = await admin
      .from('juego_pin_duenos')
      .select('pin_hash, actualizado_por')
      .eq('organization_id', orgId)
      .maybeSingle()
    if (error) {
      if (SIN_TABLA.has(error.code ?? '')) console.error('[juego/pin] falta la tabla juego_pin_duenos (mig 239)')
      else console.error('[juego/pin] juego_pin_duenos:', error.code ?? '', error.message ?? '')
      return RECHAZO_PIN
    }
    const fila = data as { pin_hash?: unknown; actualizado_por?: unknown } | null
    if (!fila || typeof fila.pin_hash !== 'string') {
      // Sin PIN configurado: lo mismo que uno incorrecto, y gastando lo mismo.
      await verificarPin(pin, `${PREFIJO}$${SAL_DE_RELLENO.toString('base64url')}$${Buffer.alloc(LARGO_HASH).toString('base64url')}`)
      return RECHAZO_PIN
    }
    if (!(await verificarPin(pin, fila.pin_hash))) return RECHAZO_PIN

    const firmado = firmarPaseDuenos({ orgId, usuarioId: String(fila.actualizado_por ?? '') }, ahora())
    if (!firmado) {
      console.error('[juego/pin] no se pudo firmar el pase (secreto o actualizado_por)')
      return RECHAZO_PIN
    }
    console.info('[juego/pin] pase de dueños por PIN', { vence: new Date(firmado.venceEn * 1000).toISOString() })
    return { ok: true, pase: firmado.pase, venceEn: firmado.venceEn }
  } catch (e) {
    console.error('[juego/pin] canje:', e instanceof Error ? e.message : String(e))
    return RECHAZO_PIN
  }
}
