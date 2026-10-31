// =============================================================================
// Cola de partidas pendientes de «Corte Final» (localStorage, `cf.pendientes.v1`,
// sólo de este celular).
//
// QUÉ ENTRA: sólo una partida que el servidor rechazó por el tope del rate
// limit (`motivo: 'tope'`, ver guardado.ts). Ese rechazo pasa ANTES del insert:
// se sabe que no se guardó nada y reintentarla no duplica. Un error de red, un
// timeout o uno desconocido NO entra nunca: el insert pudo haber pasado igual
// (el timeout de 8 s corta la respuesta, no la escritura) y `juego_partidas` no
// tiene clave de idempotencia.
//
// CUÁNDO SE REINTENTA (`reintentarPendientes`): en el próximo resultado, apenas
// su partida se guarda bien (la mejor señal de que el servidor ya acepta a este
// celular), y al volver al inicio. Nunca antes de lo que pidió el servidor
// (`esperarHasta`) ni sin red (`navigator.onLine === false`). Cada partida se
// SACA de la cola antes de mandarla: si la página se cierra a mitad de camino se
// pierde, pero nunca se guarda dos veces. Si el servidor la vuelve a frenar por
// el tope, vuelve a la cola. Con cualquier otra respuesta que no sea «guardada»
// (red caída, error de la base, datos inválidos) queda afuera y la vuelta se
// corta: las demás esperan a la próxima, así una caída de red pierde una sola.
//
// CHICA Y CON VENCIMIENTO: hasta 8 partidas (si se llena, se va la más vieja)
// y 6 h (la vida del token del QR; además el ranking de «hoy» cuenta la hora en
// que se guarda, no la de la pelea).
//
// Cada acceso al storage va con try/catch: en modo privado o con el storage
// lleno, la cola vive en memoria mientras dure la pestaña. Sin imports de `@/`
// (se prueba con Node tal cual): el guardado llega como parámetro.
// =============================================================================

import type { PartidaAGuardar, RespuestaGuardado } from './guardado'
import { esRechazoPorTope } from './guardado'

const CLAVE = 'cf.pendientes.v1'

/** Cuántas partidas guarda la cola como máximo. */
export const MAX_PENDIENTES = 8
/** Una partida pendiente más vieja que esto se tira sin mandarla. */
export const VIDA_PENDIENTE_MS = 6 * 60 * 60 * 1000
/** Si el servidor no dijo cuánto esperar (no debería pasar). */
const ESPERA_POR_DEFECTO_SEG = 60
/** Más de esto no se espera nunca (un reloj que se atrasó a mano no traba la cola). */
const ESPERA_MAXIMA_MS = 15 * 60 * 1000
/** Un poco más de lo que dijo el servidor: su reloj y el del celular no son el mismo. */
const MARGEN_MS = 2000
const LARGO_MAXIMO_ID = 64

export interface Pendiente {
  /** El id del resultado (único por pelea). */
  id: string
  partida: PartidaAGuardar
  /** Cuándo entró a la cola (ms, reloj del celular). */
  creada: number
}

export interface ColaPendientes {
  /** No reintentar antes de esto (ms, reloj del celular). 0 = cuando sea. */
  esperarHasta: number
  /** De la más vieja a la más nueva. */
  items: Pendiente[]
}

export type GuardarPartida = (partida: PartidaAGuardar) => Promise<RespuestaGuardado>
/** Lo que pasó con una pendiente que se mandó: la respuesta, o null si falló la red o tiró. */
export type AlTerminarPendiente = (item: Pendiente, respuesta: RespuestaGuardado | null) => void

export function colaVacia(): ColaPendientes {
  return { esperarHasta: 0, items: [] }
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function vigente(creada: number, ahora: number): boolean {
  return Math.abs(ahora - creada) <= VIDA_PENDIENTE_MS
}

/** Lo que haya en el storage pasa por acá: un JSON viejo, roto o tocado a mano no rompe nada. */
export function sanearCola(crudo: unknown, ahora: number): ColaPendientes {
  if (!esObjeto(crudo)) return colaVacia()
  const items: Pendiente[] = []
  const vistos = new Set<string>()
  for (const x of Array.isArray(crudo.items) ? crudo.items : []) {
    if (!esObjeto(x)) continue
    const { id, partida, creada } = x
    if (typeof id !== 'string' || id.length === 0 || id.length > LARGO_MAXIMO_ID || vistos.has(id)) continue
    if (typeof creada !== 'number' || !Number.isFinite(creada) || !vigente(creada, ahora)) continue
    if (!esObjeto(partida)) continue
    vistos.add(id)
    items.push({ id, partida: partida as unknown as PartidaAGuardar, creada })
  }
  items.sort((a, b) => a.creada - b.creada)
  const espera = crudo.esperarHasta
  const esperarHasta =
    typeof espera === 'number' && Number.isFinite(espera) && espera > ahora ? Math.min(espera, ahora + ESPERA_MAXIMA_MS) : 0
  return { esperarHasta, items: items.slice(-MAX_PENDIENTES) }
}

/**
 * Suma una partida (la misma pelea no entra dos veces) y deja la cola de la más vieja a la más
 * nueva. Si pasa del máximo, se va la más vieja. `devuelta`: la que acaba de volver de un intento
 * (otro tope) va primera entre las de la misma hora, como estaba.
 */
export function agregarPendiente(cola: ColaPendientes, item: Pendiente, devuelta = false): ColaPendientes {
  const otras = cola.items.filter((p) => p.id !== item.id)
  const items = (devuelta ? [item, ...otras] : [...otras, item]).sort((a, b) => a.creada - b.creada)
  return { esperarHasta: cola.esperarHasta, items: items.slice(-MAX_PENDIENTES) }
}

/** El servidor pidió esperar `esperarSeg`: no se reintenta antes (nunca más que ESPERA_MAXIMA_MS). */
export function conEspera(cola: ColaPendientes, esperarSeg: number | null | undefined, ahora: number): ColaPendientes {
  const seg =
    typeof esperarSeg === 'number' && Number.isFinite(esperarSeg) && esperarSeg > 0 ? esperarSeg : ESPERA_POR_DEFECTO_SEG
  const hasta = Math.min(ahora + seg * 1000 + MARGEN_MS, ahora + ESPERA_MAXIMA_MS)
  return { ...cola, esperarHasta: Math.max(cola.esperarHasta, hasta) }
}

/** La próxima para mandar (la más vieja vigente) y la cola sin ella; null si no hay o si hay que esperar. */
export function siguientePendiente(
  cola: ColaPendientes,
  ahora: number,
): { item: Pendiente; resto: ColaPendientes } | null {
  if (ahora < cola.esperarHasta) return null
  const items = cola.items.filter((p) => vigente(p.creada, ahora))
  const item = items[0]
  if (!item) return null
  return { item, resto: { esperarHasta: 0, items: items.slice(1) } }
}

// ── Storage ─────────────────────────────────────────────────────────────────

let memoria: ColaPendientes = colaVacia()
/** El storage falló al escribir: desde ahí la cola vive sólo en memoria (ver escribirCola). */
let soloMemoria = false

function storage(): Storage | null {
  if (soloMemoria) return null
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** La cola de este celular (la del storage si se puede leer; si no, la de memoria). */
export function leerCola(ahora: number = Date.now()): ColaPendientes {
  const s = storage()
  if (!s) return (memoria = sanearCola(memoria, ahora))
  let texto: string | null
  try {
    texto = s.getItem(CLAVE)
  } catch {
    return (memoria = sanearCola(memoria, ahora))
  }
  let crudo: unknown = null
  try {
    crudo = texto ? JSON.parse(texto) : null
  } catch {
    crudo = null
  }
  return (memoria = sanearCola(crudo, ahora))
}

function escribirCola(cola: ColaPendientes): void {
  memoria = cola
  const s = storage()
  if (!s) return
  try {
    if (cola.items.length === 0) s.removeItem(CLAVE)
    else s.setItem(CLAVE, JSON.stringify(cola))
  } catch {
    // Storage lleno o bloqueado: la cola sigue en memoria mientras dure la pestaña, y se
    // borra la copia del storage. Si quedara, la próxima visita mandaría otra vez una
    // partida que ya salió de la cola (y quizás se guardó): se prefiere perderla.
    soloMemoria = true
    try {
      s.removeItem(CLAVE)
    } catch {
      // Nada más para hacer.
    }
  }
}

// ── Lo que usa la UI ────────────────────────────────────────────────────────

/**
 * Deja una partida en la cola. Llamarla SÓLO con un rechazo por el tope
 * (`esRechazoPorTope`): con cualquier otro error la partida pudo haberse
 * guardado y reintentarla la duplicaría.
 */
export function encolarPendiente(id: string, partida: PartidaAGuardar, esperarSeg: number | null | undefined): void {
  const ahora = Date.now()
  escribirCola(conEspera(agregarPendiente(leerCola(ahora), { id, partida, creada: ahora }), esperarSeg, ahora))
}

let enCurso: Promise<number> | null = null

/** Sin red segura (el navegador lo sabe): no se intenta, porque una falla de red tira la partida. */
function sinRed(): boolean {
  try {
    return typeof navigator !== 'undefined' && navigator.onLine === false
  } catch {
    return false
  }
}

/**
 * Manda las pendientes, de a una y de la más vieja a la más nueva, si ya pasó
 * la espera que pidió el servidor. Se corta en la primera que no se guarda.
 * Devuelve cuántas se guardaron. Si ya hay una vuelta en marcha, devuelve esa
 * (no se mandan dos veces). Nunca tira.
 */
export function reintentarPendientes(guardar: GuardarPartida, alTerminar?: AlTerminarPendiente): Promise<number> {
  if (enCurso) return enCurso
  if (sinRed()) return Promise.resolve(0)
  const vuelta = (async () => {
    let guardadas = 0
    try {
      for (let i = 0; i < MAX_PENDIENTES; i++) {
        const ahora = Date.now()
        const cola = leerCola(ahora)
        const siguiente = siguientePendiente(cola, ahora)
        if (!siguiente) {
          // Sin nada vigente (o todo vencido): se limpia lo que haya quedado en el storage.
          if (cola.items.length === 0) escribirCola(colaVacia())
          break
        }
        // Se saca ANTES de mandarla: si algo sale mal se pierde, nunca se guarda dos veces.
        escribirCola(siguiente.resto)
        let respuesta: RespuestaGuardado | null
        try {
          respuesta = await guardar(siguiente.item.partida)
        } catch {
          respuesta = null
        }
        if (esRechazoPorTope(respuesta)) {
          // No se guardó nada: vuelve a la cola y se espera lo que pidió el servidor.
          const despues = Date.now()
          escribirCola(conEspera(agregarPendiente(leerCola(despues), siguiente.item, true), respuesta.esperarSeg, despues))
          break
        }
        try {
          alTerminar?.(siguiente.item, respuesta)
        } catch {
          // Lo que haga la UI con la respuesta no frena la cola.
        }
        // Red caída, error o datos inválidos: esa queda afuera (pudo haberse guardado) y las
        // demás esperan a la próxima vuelta.
        if (!respuesta?.ok) break
        guardadas++
      }
    } catch {
      // El storage o algo inesperado: lo que quedó en la cola se intenta la próxima vez.
    }
    return guardadas
  })()
  enCurso = vuelta.finally(() => {
    enCurso = null
  })
  return enCurso
}
