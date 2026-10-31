// =============================================================================
// Cola de partidas pendientes de «Corte Final» (localStorage, `cf.pendientes.v1`,
// sólo de este celular).
//
// QUÉ ENTRA (`encolarSiCorresponde`): una partida que el servidor no guardó y
// que se puede volver a mandar SIN duplicarla (ver guardado.ts):
// - frenada por el tope del rate limit (`motivo: 'tope'`): pasó ANTES del
//   insert, no se guardó nada;
// - frenada por el apodo (`motivo: 'apodo'`; `validarApodo` corre antes de
//   tocar la base): entra como «Anónimo», que cuenta para el % de victorias de
//   cada barbero y no para el ranking;
// - una falla que no dice si se guardó (red caída, el timeout de 8 s —corta la
//   respuesta, no la escritura—, un error de la base), SÓLO si la partida lleva
//   `idPartida`: con esa clave (mig 234) el servidor no inserta dos veces la
//   misma pelea. Sin clave (la página de antes del 31/oct o un navegador sin
//   crypto) no entra nunca: pudo haberse guardado y no hay forma de saberlo.
// Los datos inválidos (`motivo: 'datos'`) no entran: se rechazan siempre.
//
// CUÁNDO SE REINTENTA (`reintentarPendientes`): en el próximo resultado, apenas
// su partida se guarda bien (la mejor señal de que el servidor ya acepta a este
// celular), y al volver al inicio. Nunca antes de lo que pidió el servidor
// (`esperarHasta`) ni sin red (`navigator.onLine === false`). Sin clave, cada
// partida se SACA de la cola antes de mandarla: si la página se cierra a mitad
// de camino se pierde, pero nunca se guarda dos veces. Con clave queda en la
// cola hasta la respuesta (si la página se cierra, la manda la próxima vuelta).
// Si vuelve el tope, vuelve a la cola con la espera nueva y la vuelta se corta;
// si el apodo no pasa, vuelve como «Anónimo» y sale enseguida; si vuelve a
// fallar sin decir si se guardó, vuelve con `ESPERA_TRAS_FALLA_SEG` y la vuelta
// se corta (una red caída no la quema entera), y a las `MAX_INTENTOS` fallas se
// descarta (una partida que el servidor no acepta nunca no tapa la cola).
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
import {
  APODO_ANONIMO,
  esRechazoPorApodo,
  esRechazoPorTope,
  pudoHaberseGuardado,
  tieneClave,
} from './guardado'

const CLAVE = 'cf.pendientes.v1'

/** Cuántas partidas guarda la cola como máximo. */
export const MAX_PENDIENTES = 8
/** Una partida pendiente más vieja que esto se tira sin mandarla. */
export const VIDA_PENDIENTE_MS = 6 * 60 * 60 * 1000
/** Fallas que no dicen si se guardó (sólo con clave) antes de descartar la partida. */
export const MAX_INTENTOS = 5
/** Después de una de esas fallas, la cola espera esto antes de la próxima vuelta. */
export const ESPERA_TRAS_FALLA_SEG = 30
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
  /** Cuándo entró a la cola (ms, reloj del celular). Con el id, identifica ESTA versión de la partida. */
  creada: number
  /** Fallas que no dijeron si se guardó (sólo con clave). Sin el campo, 0. */
  intentos?: number
}

export interface ColaPendientes {
  /** No reintentar antes de esto (ms, reloj del celular). 0 = cuando sea. */
  esperarHasta: number
  /** De la más vieja a la más nueva. */
  items: Pendiente[]
}

export type GuardarPartida = (partida: PartidaAGuardar) => Promise<RespuestaGuardado>
/**
 * Lo que pasó con una pendiente que salió de la cola para siempre (guardada o descartada): la
 * respuesta, o null si falló la red o tiró. Una que vuelve a la cola no avisa.
 */
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
    const { id, partida, creada, intentos } = x
    if (typeof id !== 'string' || id.length === 0 || id.length > LARGO_MAXIMO_ID || vistos.has(id)) continue
    if (typeof creada !== 'number' || !Number.isFinite(creada) || !vigente(creada, ahora)) continue
    if (!esObjeto(partida)) continue
    vistos.add(id)
    const n = typeof intentos === 'number' && Number.isFinite(intentos) ? Math.min(MAX_INTENTOS, Math.max(0, Math.floor(intentos))) : 0
    items.push({ id, partida: partida as unknown as PartidaAGuardar, creada, ...(n > 0 ? { intentos: n } : {}) })
  }
  items.sort((a, b) => a.creada - b.creada)
  const espera = crudo.esperarHasta
  const esperarHasta =
    typeof espera === 'number' && Number.isFinite(espera) && espera > ahora ? Math.min(espera, ahora + ESPERA_MAXIMA_MS) : 0
  return { esperarHasta, items: items.slice(-MAX_PENDIENTES) }
}

/**
 * Suma una partida (la misma pelea no entra dos veces: la nueva reemplaza a la que estaba) y deja la
 * cola de la más vieja a la más nueva. Si pasa del máximo, se va la más vieja. `devuelta`: la que
 * acaba de volver de un intento va primera entre las de la misma hora, como estaba.
 */
export function agregarPendiente(cola: ColaPendientes, item: Pendiente, devuelta = false): ColaPendientes {
  const otras = cola.items.filter((p) => p.id !== item.id)
  const items = (devuelta ? [item, ...otras] : [...otras, item]).sort((a, b) => a.creada - b.creada)
  return { esperarHasta: cola.esperarHasta, items: items.slice(-MAX_PENDIENTES) }
}

/**
 * La cola sin ESA versión de la partida (mismo id y misma hora). Si mientras viajaba la pantalla dejó
 * otra más nueva de la misma pelea (otro apodo, otro tope), ésa queda.
 */
export function sacarPendiente(cola: ColaPendientes, item: Pendiente): ColaPendientes {
  return { ...cola, items: cola.items.filter((p) => !(p.id === item.id && p.creada === item.creada)) }
}

/** Vuelve a poner una partida que salió, salvo que la pantalla haya dejado otra más nueva de la misma pelea. */
function devolverPendiente(cola: ColaPendientes, item: Pendiente): ColaPendientes {
  const actual = cola.items.find((p) => p.id === item.id)
  if (actual && actual.creada !== item.creada) return cola
  return agregarPendiente(cola, item, true)
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

/**
 * La partida para volver a mandar después de esta respuesta, o null si no se puede (o no hace falta).
 * El tope: la misma. El apodo rechazado: la misma como «Anónimo» (null si ya lo era). Una falla que no
 * dice si se guardó: la misma, sólo con clave. Guardada o con datos inválidos: null.
 */
export function partidaParaReintentar(
  partida: PartidaAGuardar,
  respuesta: RespuestaGuardado | null | undefined,
): PartidaAGuardar | null {
  if (esRechazoPorTope(respuesta)) return partida
  if (esRechazoPorApodo(respuesta)) return partida.apodo === APODO_ANONIMO ? null : { ...partida, apodo: APODO_ANONIMO }
  if (pudoHaberseGuardado(respuesta)) return tieneClave(partida) ? partida : null
  return null
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
 * Deja una partida en la cola con la espera que pidió el servidor. Es la del rechazo por el tope;
 * para cualquier otra respuesta, `encolarSiCorresponde` (que decide si se puede).
 */
export function encolarPendiente(id: string, partida: PartidaAGuardar, esperarSeg: number | null | undefined): void {
  const ahora = Date.now()
  escribirCola(conEspera(agregarPendiente(leerCola(ahora), { id, partida, creada: ahora }), esperarSeg, ahora))
}

/**
 * Deja en la cola la partida de una respuesta que no la guardó, si se puede reintentar sin duplicarla
 * (`partidaParaReintentar`): el tope con su espera; el apodo rechazado como «Anónimo» y una falla
 * ambigua con clave, sin espera nueva. Si ya había una versión de esa pelea, la reemplaza. Devuelve si
 * quedó en la cola.
 */
export function encolarSiCorresponde(
  id: string,
  partida: PartidaAGuardar,
  respuesta: RespuestaGuardado | null | undefined,
): boolean {
  const otra = partidaParaReintentar(partida, respuesta)
  if (!otra) return false
  if (esRechazoPorTope(respuesta)) {
    encolarPendiente(id, otra, respuesta.esperarSeg)
    return true
  }
  const ahora = Date.now()
  escribirCola(agregarPendiente(leerCola(ahora), { id, partida: otra, creada: ahora }))
  return true
}

/** Saca esa pelea de la cola (la pantalla la acaba de guardar: mandarla de nuevo sería un pedido de más). */
export function quitarPendiente(id: string): void {
  const cola = leerCola()
  if (cola.items.some((p) => p.id === id)) escribirCola({ ...cola, items: cola.items.filter((p) => p.id !== id) })
}

let enCurso: Promise<number> | null = null

/**
 * Sin red segura (el navegador lo sabe): no se intenta. Sin clave, una falla de red tira la partida;
 * con clave, gasta uno de sus MAX_INTENTOS.
 */
function sinRed(): boolean {
  try {
    return typeof navigator !== 'undefined' && navigator.onLine === false
  } catch {
    return false
  }
}

function avisar(alTerminar: AlTerminarPendiente | undefined, item: Pendiente, respuesta: RespuestaGuardado | null) {
  try {
    alTerminar?.(item, respuesta)
  } catch {
    // Lo que haga la UI con la respuesta no frena la cola.
  }
}

/**
 * Manda las pendientes, de a una y de la más vieja a la más nueva, si ya pasó
 * la espera que pidió el servidor. Se corta en la primera que vuelve por el
 * tope o por una falla que no dice si se guardó. Devuelve cuántas se guardaron.
 * Si ya hay una vuelta en marcha, devuelve esa (no se mandan dos veces). Nunca
 * tira.
 */
export function reintentarPendientes(guardar: GuardarPartida, alTerminar?: AlTerminarPendiente): Promise<number> {
  if (enCurso) return enCurso
  if (sinRed()) return Promise.resolve(0)
  const vuelta = (async () => {
    let guardadas = 0
    try {
      // Cada pendiente sale a lo sumo dos veces por vuelta (la segunda, como «Anónimo»).
      for (let i = 0; i < 2 * MAX_PENDIENTES; i++) {
        const ahora = Date.now()
        const cola = leerCola(ahora)
        const siguiente = siguientePendiente(cola, ahora)
        if (!siguiente) {
          // Sin nada vigente (o todo vencido): se limpia lo que haya quedado en el storage.
          if (cola.items.length === 0) escribirCola(colaVacia())
          break
        }
        const { item } = siguiente
        // Sin clave se saca ANTES de mandarla: si algo sale mal se pierde, nunca se guarda dos
        // veces. Con clave queda hasta la respuesta: el servidor no la duplica.
        if (!tieneClave(item.partida)) escribirCola(siguiente.resto)
        let respuesta: RespuestaGuardado | null
        try {
          respuesta = await guardar(item.partida)
        } catch {
          respuesta = null
        }
        const despues = Date.now()
        if (respuesta?.ok) {
          escribirCola(sacarPendiente(leerCola(despues), item))
          guardadas++
          avisar(alTerminar, item, respuesta)
          continue
        }
        const otra = partidaParaReintentar(item.partida, respuesta)
        const ambigua = pudoHaberseGuardado(respuesta)
        const intentos = (item.intentos ?? 0) + (ambigua ? 1 : 0)
        if (otra && intentos < MAX_INTENTOS) {
          // No se guardó (o no se sabe, y tiene clave): vuelve a la cola, primera entre las de su hora.
          let nueva = devolverPendiente(leerCola(despues), { ...item, partida: otra, ...(intentos > 0 ? { intentos } : {}) })
          if (esRechazoPorTope(respuesta)) nueva = conEspera(nueva, respuesta.esperarSeg, despues)
          else if (ambigua) nueva = conEspera(nueva, ESPERA_TRAS_FALLA_SEG, despues)
          escribirCola(nueva)
          // El apodo rechazado vuelve como «Anónimo» y sale ya; el tope y la red cortan la vuelta.
          if (esRechazoPorApodo(respuesta)) continue
          break
        }
        // Datos inválidos, una falla ambigua sin clave o la última de MAX_INTENTOS: afuera.
        escribirCola(sacarPendiente(leerCola(despues), item))
        avisar(alTerminar, item, respuesta)
        // Los datos inválidos no dicen nada de la red: siguen las demás. Una red caída corta la vuelta.
        if (ambigua) break
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
