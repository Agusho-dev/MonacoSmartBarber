/**
 * La torre del modo historia (16/nov/2026): qué rival hay en cada piso, en qué arena se pelea y
 * cómo se guarda el torneo en el celular. Puro (sin DOM ni `@/`): el guardado vive en
 * ui/historia-guardada.ts.
 *
 * Los 5 pisos de barberos salen al azar (con la semilla del torneo) entre los 16 que no eligió el
 * jugador, cambiando de sucursal de un piso al otro cuando se puede. Si el cliente vino por el QR y
 * su barbero es uno de los 17 (y no es el que eligió), ése lo espera en el piso 5: el último antes
 * de los Bosses. Arriba, los Bosses en su orden (ORDEN_JEFES).
 */
import { IDS_PARA_CLIENTES, PERSONAJES } from '../personajes'
import type { Dificultad, IdArena, IdPersonaje } from '../tipos'
import { esJefe, ORDEN_JEFES, PISOS_BARBEROS, TOTAL_PISOS, type IdJefe } from './jefes'

export const VERSION_TORRE = 1

/** Dónde pelea cada Boss: cuatro arenas distintas, y la final en Rondeau, la primera sucursal. */
export const ARENA_JEFE: Readonly<Record<IdJefe, IdArena>> = {
  nacho: 'pueyrredon',
  nehuen: 'caseros',
  nico_m: 'parana',
  tony: 'rondeau',
}

const ARENA_DE_SUCURSAL: Readonly<Record<string, IdArena>> = {
  rondeau: 'rondeau',
  caseros: 'caseros',
  parana: 'parana',
  pueyrredon: 'pueyrredon',
}

export interface Torre {
  v: number
  jugador: IdPersonaje
  dificultad: Dificultad
  /** Los TOTAL_PISOS rivales, de abajo hacia arriba. */
  rivales: IdPersonaje[]
  arenas: IdArena[]
  /** El piso que toca pelear (0 = el de abajo). TOTAL_PISOS = torneo ganado. */
  piso: number
  /** Cuántas veces se perdió y se volvió a intentar (todo el torneo). */
  reintentos: number
  /** Derrotas en el piso actual (para «¿Continuar?»). */
  derrotasPiso: number
  /** Cuándo empezó (ms desde 1970, del celular). */
  inicio: number
  /** Tiempo de pelea acumulado (s): sólo las peleas, sin menús. */
  segundosPelea: number
  /** El barbero del QR, si quedó en el piso 5. */
  barberoDelCliente: IdPersonaje | null
}

/** PRNG chico con semilla (mulberry32): la misma semilla arma la misma torre. */
function azar(semilla: number): () => number {
  let a = semilla >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function crearTorre(
  jugador: IdPersonaje,
  dificultad: Dificultad,
  barberoDelCliente: IdPersonaje | null,
  semilla: number,
  ahora: number,
): Torre {
  const r = azar(semilla)
  const delQr =
    barberoDelCliente && barberoDelCliente !== jugador && !esJefe(barberoDelCliente) && IDS_PARA_CLIENTES.includes(barberoDelCliente)
      ? barberoDelCliente
      : null
  const libres = IDS_PARA_CLIENTES.filter((id) => id !== jugador && id !== delQr)
  // Mezcla (Fisher-Yates) y después, piso a piso, el primero que cambie de sucursal.
  for (let i = libres.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[libres[i], libres[j]] = [libres[j], libres[i]]
  }
  const cuantos = delQr ? PISOS_BARBEROS - 1 : PISOS_BARBEROS
  const barberos: IdPersonaje[] = []
  for (let k = 0; k < cuantos; k++) {
    const anterior = barberos[barberos.length - 1]
    const i = libres.findIndex((id) => !anterior || PERSONAJES[id].sucursal !== PERSONAJES[anterior].sucursal)
    barberos.push(libres.splice(i >= 0 ? i : 0, 1)[0])
  }
  if (delQr) barberos.push(delQr)
  const rivales = [...barberos, ...ORDEN_JEFES]
  const arenas = rivales.map((id) =>
    esJefe(id) ? ARENA_JEFE[id] : (ARENA_DE_SUCURSAL[PERSONAJES[id].sucursal] ?? 'rondeau'),
  )
  return {
    v: VERSION_TORRE,
    jugador,
    dificultad,
    rivales,
    arenas,
    piso: 0,
    reintentos: 0,
    derrotasPiso: 0,
    inicio: ahora,
    segundosPelea: 0,
    barberoDelCliente: delQr,
  }
}

export function terminada(t: Torre): boolean {
  return t.piso >= TOTAL_PISOS
}

export interface PisoActual {
  indice: number
  rival: IdPersonaje
  arena: IdArena
  jefe: boolean
  /** 1..4 si es un Boss. */
  numeroJefe: number
  final: boolean
}

export function pisoActual(t: Torre): PisoActual | null {
  if (terminada(t)) return null
  const rival = t.rivales[t.piso]
  const numeroJefe = esJefe(rival) ? ORDEN_JEFES.indexOf(rival) + 1 : 0
  return {
    indice: t.piso,
    rival,
    arena: t.arenas[t.piso],
    jefe: numeroJefe > 0,
    numeroJefe,
    final: t.piso === TOTAL_PISOS - 1,
  }
}

/** Ganó la pelea del piso: sube uno. */
export function subir(t: Torre, segundos: number): Torre {
  return { ...t, piso: t.piso + 1, derrotasPiso: 0, segundosPelea: t.segundosPelea + Math.max(0, segundos) }
}

/** Perdió la pelea del piso: se queda, con un reintento más. */
export function caer(t: Torre, segundos: number): Torre {
  return {
    ...t,
    reintentos: t.reintentos + 1,
    derrotasPiso: t.derrotasPiso + 1,
    segundosPelea: t.segundosPelea + Math.max(0, segundos),
  }
}

const DIFICULTADES: readonly Dificultad[] = ['facil', 'normal', 'dificil']

function esId(v: unknown): v is IdPersonaje {
  return typeof v === 'string' && v in PERSONAJES
}

function natural(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0
}

/**
 * Lo que venga del storage pasa por acá: un JSON viejo, tocado a mano o de una torre que ya no
 * cuadra con el catálogo da null (y el torneo arranca de cero), nunca una torre rota.
 */
export function sanearTorre(crudo: unknown): Torre | null {
  if (typeof crudo !== 'object' || crudo === null) return null
  const c = crudo as Record<string, unknown>
  if (c.v !== VERSION_TORRE) return null
  if (!esId(c.jugador) || esJefe(c.jugador) || !IDS_PARA_CLIENTES.includes(c.jugador)) return null
  const dificultad = DIFICULTADES.includes(c.dificultad as Dificultad) ? (c.dificultad as Dificultad) : null
  if (!dificultad) return null
  const rivales = Array.isArray(c.rivales) ? c.rivales : []
  const arenas = Array.isArray(c.arenas) ? c.arenas : []
  if (rivales.length !== TOTAL_PISOS || arenas.length !== TOTAL_PISOS || !rivales.every(esId)) return null
  if (rivales.slice(PISOS_BARBEROS).join() !== ORDEN_JEFES.join()) return null
  if (rivales.slice(0, PISOS_BARBEROS).some((id) => esJefe(id) || id === c.jugador)) return null
  const validas = Object.values(ARENA_DE_SUCURSAL)
  if (!arenas.every((a) => typeof a === 'string' && validas.includes(a as IdArena))) return null
  return {
    v: VERSION_TORRE,
    jugador: c.jugador,
    dificultad,
    rivales: rivales as IdPersonaje[],
    arenas: arenas as IdArena[],
    piso: Math.min(TOTAL_PISOS, natural(c.piso)),
    reintentos: natural(c.reintentos),
    derrotasPiso: natural(c.derrotasPiso),
    inicio: natural(c.inicio),
    segundosPelea: natural(c.segundosPelea),
    barberoDelCliente: esId(c.barberoDelCliente) ? c.barberoDelCliente : null,
  }
}

/** Un torneo ganado, para la galería «Tus campeones» del celular. */
export interface Campeon {
  id: IdPersonaje
  dificultad: Dificultad
  /** ms desde 1970. */
  fecha: number
  reintentos: number
  segundos: number
}

export const TOPE_CAMPEONES = 60

export function sanearCampeones(crudo: unknown): Campeon[] {
  if (!Array.isArray(crudo)) return []
  const lista: Campeon[] = []
  for (const x of crudo) {
    if (typeof x !== 'object' || x === null) continue
    const c = x as Record<string, unknown>
    if (!esId(c.id) || !DIFICULTADES.includes(c.dificultad as Dificultad)) continue
    lista.push({
      id: c.id,
      dificultad: c.dificultad as Dificultad,
      fecha: natural(c.fecha),
      reintentos: natural(c.reintentos),
      segundos: natural(c.segundos),
    })
  }
  return lista.slice(-TOPE_CAMPEONES)
}
