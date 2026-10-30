/**
 * Protocolo de la sala y de las peleas online de «Corte Final».
 *
 * Todo viaja por canales PÚBLICOS de Supabase Realtime (broadcast y presencia, en la memoria
 * del servidor de Realtime: nada se escribe en la base). Como son públicos, cualquiera podría
 * mandar cualquier cosa: TODO lo que llega pasa por los validadores de acá antes de usarse, y
 * los nombres se sanean y recortan.
 *
 * Sin React y sin imports con `@/` (sólo relativos): se prueba con Node junto al motor.
 */
import { VERSION_APP } from '../../version-app'
import { IDS_PERSONAJES } from '../personajes'
import type { EntradaJugador, IdPersonaje, Lado } from '../tipos'

/**
 * Sube cuando cambia la forma o el sentido de algún mensaje: dos bundles con protocolos distintos
 * no se emparejan. 2 (30/oct/2026): lotes de 4 ticks, el resultado viaja en el «estado» y el
 * adiós «cerro».
 */
export const PROTOCOLO = 2

export const PREFIJO_SALA = 'juego-sala:'
export const PREFIJO_PELEA = 'juego-pelea:'

export const NOMBRE_MAX = 16

/** Versión que va en la presencia: sólo se emparejan jugadores con la misma. */
export function versionJuego(): string {
  return `${VERSION_APP || 'dev'}#${PROTOCOLO}`
}

export type EstadoJugador = 'libre' | 'eligiendo' | 'peleando'

const ESTADOS: readonly EstadoJugador[] = ['libre', 'eligiendo', 'peleando']
/** Los barberos jugables salen del catálogo: uno nuevo se puede elegir online sin tocar esto. */
const PERSONAJES_VALIDOS: readonly IdPersonaje[] = IDS_PERSONAJES

// ─── Validadores chicos ──────────────────────────────────────────────────────

export function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Ids de jugador, desafío y pelea: lo que sale de crypto.randomUUID() (o el respaldo). */
export function esId(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9-]{8,48}$/.test(v)
}

export function esEntero(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
}

export function esPersonaje(v: unknown): v is IdPersonaje {
  return typeof v === 'string' && (PERSONAJES_VALIDOS as readonly string[]).includes(v)
}

function esVersion(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 80
}

/**
 * Nombre visible de un jugador: letras (de cualquier idioma, con tildes), números, espacios y
 * . _ ' - ; sin emojis ni símbolos; máximo 16. null si no queda nada.
 */
export function sanearNombre(crudo: unknown): string | null {
  if (typeof crudo !== 'string') return null
  const limpio = crudo
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} ._'-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NOMBRE_MAX)
    .trim()
  return limpio.length > 0 ? limpio : null
}

export function nuevoId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {
    // Contexto sin crypto.randomUUID (http en una red local): el respaldo alcanza para esto.
  }
  const azar = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0')
  return `${azar()}-${azar().slice(0, 4)}-${azar().slice(0, 4)}-${azar()}${azar().slice(0, 4)}`
}

// ─── Presencia de la sala ────────────────────────────────────────────────────

/** Lo que cada jugador publica en la presencia de la sala (corto: viaja a todos). */
export interface PresenciaJugador {
  id: string
  /** Nombre visible (saneado). */
  n: string
  e: EstadoJugador
  /** versionJuego() del que publica. */
  v: string
}

export function leerPresencia(v: unknown): PresenciaJugador | null {
  if (!esObjeto(v) || !esId(v.id) || !esVersion(v.v)) return null
  if (typeof v.e !== 'string' || !(ESTADOS as readonly string[]).includes(v.e)) return null
  const n = sanearNombre(v.n)
  if (!n) return null
  return { id: v.id, n, e: v.e as EstadoJugador, v: v.v }
}

// ─── Desafíos (broadcast de la sala) ─────────────────────────────────────────

export type MotivoRechazo = 'no' | 'ocupado' | 'version' | 'vencido'
const MOTIVOS_RECHAZO: readonly MotivoRechazo[] = ['no', 'ocupado', 'version', 'vencido']

export interface MsjDesafio {
  de: string
  a: string
  /** Id del desafío. */
  d: string
  /** Id de la pelea (canal propio) si lo aceptan. */
  p: string
  v: string
}

export interface MsjRespuesta {
  de: string
  a: string
  d: string
  ok: boolean
  m: MotivoRechazo | null
}

export interface MsjCancelar {
  de: string
  a: string
  d: string
}

export function leerDesafio(v: unknown): MsjDesafio | null {
  if (!esObjeto(v) || !esId(v.de) || !esId(v.a) || !esId(v.d) || !esId(v.p) || !esVersion(v.v)) return null
  if (v.de === v.a) return null
  return { de: v.de, a: v.a, d: v.d, p: v.p, v: v.v }
}

export function leerRespuesta(v: unknown): MsjRespuesta | null {
  if (!esObjeto(v) || !esId(v.de) || !esId(v.a) || !esId(v.d) || typeof v.ok !== 'boolean') return null
  const m =
    typeof v.m === 'string' && (MOTIVOS_RECHAZO as readonly string[]).includes(v.m) ? (v.m as MotivoRechazo) : null
  return { de: v.de, a: v.a, d: v.d, ok: v.ok, m }
}

export function leerCancelar(v: unknown): MsjCancelar | null {
  if (!esObjeto(v) || !esId(v.de) || !esId(v.a) || !esId(v.d)) return null
  return { de: v.de, a: v.a, d: v.d }
}

// ─── Mensajes del canal de una pelea ─────────────────────────────────────────

/** En qué anda cada uno fuera de la pelea en sí (se repite cada segundo: si uno se pierde, no pasa nada). */
export type FaseEstado = 'eligiendo' | 'preparando' | 'peleando' | 'resultado'
const FASES_ESTADO: readonly FaseEstado[] = ['eligiendo', 'preparando', 'peleando', 'resultado']

/**
 * Cómo terminó la pelea k para el que manda, en lados del MUNDO (el otro lo lee igual):
 *  - 'pelea': la terminó el motor (es la verdad: los dos simularon lo mismo);
 *  - 'abandono': ganó `g` porque el otro se fue, se desconectó o lo llamaron;
 *  - 'desync' | 'corte': anulada (los hashes no coincidieron / los dos perdieron la conexión).
 */
export type MotivoFinal = 'pelea' | 'abandono' | 'desync' | 'corte'
const MOTIVOS_FINAL: readonly MotivoFinal[] = ['pelea', 'abandono', 'desync', 'corte']

export interface ResumenFinal {
  /** Lado del mundo que ganó (null = nadie). */
  g: Lado | null
  m: MotivoFinal
  /** Rounds ganados por lado del mundo. */
  r: [number, number]
}

function leerResumenFinal(v: unknown): ResumenFinal | null | undefined {
  if (v === undefined || v === null) return null
  if (!esObjeto(v)) return undefined
  if (!(v.g === null || v.g === 0 || v.g === 1)) return undefined
  if (typeof v.m !== 'string' || !(MOTIVOS_FINAL as readonly string[]).includes(v.m)) return undefined
  if (!Array.isArray(v.r) || v.r.length !== 2 || !esEntero(v.r[0], 0, 9) || !esEntero(v.r[1], 0, 9)) return undefined
  return { g: v.g as Lado | null, m: v.m as MotivoFinal, r: [v.r[0], v.r[1]] }
}

export interface MsjEstado {
  t: 'estado'
  de: string
  /** Número de pelea dentro del duelo (1, 2, … con las revanchas). */
  k: number
  f: FaseEstado
  n: string
  v: string
  /** Barbero elegido (null = todavía ninguno). */
  p: IdPersonaje | null
  /** Confirmó la elección. */
  c: boolean
  /** Recursos cargados y VS visto: listo para arrancar la pelea k. */
  l: boolean
  /** Quiere la revancha (después de la pelea k). */
  r: boolean
  /** Sólo el lado 0, cuando decide arrancar la pelea k: semilla, demora y los barberos por lado. */
  i: { s: number; d: number; pj: [IdPersonaje, IdPersonaje] } | null
  /** Con f = 'resultado': cómo terminó la pelea k para el que manda (ver ResumenFinal). */
  x: ResumenFinal | null
}

export interface MsjPing {
  t: 'ping' | 'pong'
  de: string
  i: number
}

/** Lote de entradas: los ticks n-b.length+1 … n del que lo manda, como bits. */
export interface MsjEntradas {
  t: 'e'
  de: string
  k: number
  n: number
  b: number[]
  /** Colchón del que manda: ticks del rival que ya tiene más allá del suyo. */
  c: number
  /** Pares [tick, hash] para detectar desincronización. */
  h: number[] | null
}

export interface MsjPedido {
  t: 'pide'
  de: string
  k: number
  desde: number
}

/** Se va del duelo: abandonó, lo llamaron a cortarse, volvió a la sala o cerró el juego (la página). */
export type MotivoAdios = 'abandono' | 'turno' | 'salir' | 'cerro'
const MOTIVOS_ADIOS: readonly MotivoAdios[] = ['abandono', 'turno', 'salir', 'cerro']

export interface MsjAdios {
  t: 'adios'
  de: string
  m: MotivoAdios
}

/** El que manda cierra la pelea k: ganó por abandono del otro o se detectó desincronización. */
export interface MsjFin {
  t: 'fin'
  de: string
  k: number
  m: 'abandono' | 'desync'
}

export type MensajePelea = MsjEstado | MsjPing | MsjEntradas | MsjPedido | MsjAdios | MsjFin

export const MAX_TICKS_LOTE = 64
const MAX_TICK = 1 << 22
const MAX_BITS = (1 << 10) - 1

function leerHashes(v: unknown): number[] | null {
  if (v === undefined || v === null) return null
  if (!Array.isArray(v) || v.length > 8 || v.length % 2 !== 0) return null
  for (let i = 0; i < v.length; i += 2) {
    if (!esEntero(v[i], 1, MAX_TICK) || !esEntero(v[i + 1], 0, 0xffffffff)) return null
  }
  return v as number[]
}

/** Valida y normaliza un mensaje del canal de la pelea. null = se ignora. */
export function leerMensajePelea(v: unknown): MensajePelea | null {
  if (!esObjeto(v) || typeof v.t !== 'string' || !esId(v.de)) return null
  switch (v.t) {
    case 'estado': {
      const n = sanearNombre(v.n)
      if (!n || !esVersion(v.v) || !esEntero(v.k, 1, 10_000)) return null
      if (typeof v.f !== 'string' || !(FASES_ESTADO as readonly string[]).includes(v.f)) return null
      if (typeof v.c !== 'boolean' || typeof v.l !== 'boolean' || typeof v.r !== 'boolean') return null
      const p = v.p === null || v.p === undefined ? null : esPersonaje(v.p) ? v.p : undefined
      if (p === undefined) return null
      let i: MsjEstado['i'] = null
      if (v.i !== null && v.i !== undefined) {
        const x = v.i
        if (!esObjeto(x) || !esEntero(x.s, 0, 0x7fffffff) || !esEntero(x.d, 1, 60)) return null
        if (!Array.isArray(x.pj) || x.pj.length !== 2 || !esPersonaje(x.pj[0]) || !esPersonaje(x.pj[1])) return null
        i = { s: x.s, d: x.d, pj: [x.pj[0], x.pj[1]] }
      }
      const x = leerResumenFinal(v.x)
      if (x === undefined) return null
      return { t: 'estado', de: v.de, k: v.k, f: v.f as FaseEstado, n, v: v.v, p, c: v.c, l: v.l, r: v.r, i, x }
    }
    case 'ping':
    case 'pong':
      if (!esEntero(v.i, 0, 1_000_000)) return null
      return { t: v.t, de: v.de, i: v.i }
    case 'e': {
      if (!esEntero(v.k, 1, 10_000) || !esEntero(v.n, 1, MAX_TICK) || !esEntero(v.c, -MAX_TICK, MAX_TICK)) return null
      if (!Array.isArray(v.b) || v.b.length < 1 || v.b.length > MAX_TICKS_LOTE || v.b.length > v.n) return null
      for (const x of v.b) if (!esEntero(x, 0, MAX_BITS)) return null
      const h = leerHashes(v.h)
      if (v.h !== undefined && v.h !== null && h === null) return null
      return { t: 'e', de: v.de, k: v.k, n: v.n, b: v.b as number[], c: v.c, h }
    }
    case 'pide':
      if (!esEntero(v.k, 1, 10_000) || !esEntero(v.desde, 1, MAX_TICK)) return null
      return { t: 'pide', de: v.de, k: v.k, desde: v.desde }
    case 'adios':
      if (typeof v.m !== 'string' || !(MOTIVOS_ADIOS as readonly string[]).includes(v.m)) return null
      return { t: 'adios', de: v.de, m: v.m as MotivoAdios }
    case 'fin':
      if (!esEntero(v.k, 1, 10_000) || (v.m !== 'abandono' && v.m !== 'desync')) return null
      return { t: 'fin', de: v.de, k: v.k, m: v.m }
    default:
      return null
  }
}

// ─── Entradas como bits ──────────────────────────────────────────────────────

/** Orden fijo de los 10 botones (bit 0 = izquierda … bit 9 = dash). Cambiarlo es cambiar PROTOCOLO. */
export const BOTONES = [
  'izquierda',
  'derecha',
  'arriba',
  'abajo',
  'golpe',
  'herramienta',
  'guardia',
  'especial1',
  'especial2',
  'dash',
] as const satisfies readonly (keyof EntradaJugador)[]

// Si EntradaJugador suma un botón y BOTONES no, esto no compila.
type FaltanBotones = Exclude<keyof EntradaJugador, (typeof BOTONES)[number]>
const _sinFaltantes: FaltanBotones extends never ? true : never = true
void _sinFaltantes

export function codificarEntrada(e: EntradaJugador): number {
  let bits = 0
  for (let i = 0; i < BOTONES.length; i++) if (e[BOTONES[i]]) bits |= 1 << i
  return bits
}

/** Un objeto congelado por combinación: el motor sólo los lee (copia los campos a su `prev`). */
const CACHE_ENTRADAS: (Readonly<EntradaJugador> | undefined)[] = []

export function entradaDesdeBits(bits: number): Readonly<EntradaJugador> {
  const b = bits & MAX_BITS
  let e = CACHE_ENTRADAS[b]
  if (!e) {
    const nueva = {} as EntradaJugador
    for (let i = 0; i < BOTONES.length; i++) nueva[BOTONES[i]] = (b & (1 << i)) !== 0
    e = Object.freeze(nueva)
    CACHE_ENTRADAS[b] = e
  }
  return e
}
