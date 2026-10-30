/**
 * Precarga de recursos (atlas, caras y arena) con progreso real.
 *
 * Con 13 luchadores, SÓLO se bajan los dos atlas de la pelea que va a empezar: la carga
 * arranca con «¡A pelear!» (el VS dura lo que tarda en llegar, y si no alcanza aparece la
 * pantalla de carga), con la elección de los dos en una pelea online, o con el atajo de
 * pruebas. Recorrer la grilla no baja nada más que caras y el retrato del enfocado (≈ 1,3 MB
 * por atlas: tocar las 13 caras eran 15 MB de datos del celular). Un caché chico por
 * combinación (personajes + arena): la revancha no vuelve a bajar nada, y los recursos que no
 * se usan se sueltan (un atlas decodificado pesa varios MB en un celular).
 */
import { useEffect, useSyncExternalStore } from 'react'
import { cargarRecursos } from '../render'
import type { IdArena, IdPersonaje, RecursosJuego } from '../tipos'

export interface EstadoPrecarga {
  estado: 'esperando' | 'cargando' | 'listo' | 'error'
  /** 0..1 */
  progreso: number
  recursos: RecursosJuego | null
}

interface Entrada {
  estado: EstadoPrecarga
  iniciada: boolean
  oyentes: Set<() => void>
}

const MAX_ENTRADAS = 2
const ESPERANDO: EstadoPrecarga = { estado: 'esperando', progreso: 0, recursos: null }
const entradas = new Map<string, Entrada>()

export function clavePrecarga(jugador: IdPersonaje, rival: IdPersonaje, arena: IdArena): string {
  return `${[...new Set([jugador, rival])].sort().join('+')}@${arena}`
}

function avisar(e: Entrada) {
  e.oyentes.forEach((f) => f())
}

/** Suelta las combinaciones viejas que nadie mira (la más vieja primero). */
function podar() {
  if (entradas.size <= MAX_ENTRADAS) return
  for (const [clave, e] of entradas) {
    if (entradas.size <= MAX_ENTRADAS) break
    if (e.oyentes.size === 0 && e.estado.estado !== 'cargando') entradas.delete(clave)
  }
}

function entradaDe(clave: string): Entrada {
  let e = entradas.get(clave)
  if (!e) {
    e = { estado: ESPERANDO, iniciada: false, oyentes: new Set() }
    entradas.set(clave, e)
  }
  return e
}

/** Arranca (o reintenta, si falló) la carga de una combinación. Idempotente. */
export function precargar(jugador: IdPersonaje, rival: IdPersonaje, arena: IdArena): string {
  const clave = clavePrecarga(jugador, rival, arena)
  const e = entradaDe(clave)
  // La más reciente al final del Map: es la última que se poda.
  entradas.delete(clave)
  entradas.set(clave, e)
  if (e.iniciada && e.estado.estado !== 'error') return clave

  e.iniciada = true
  e.estado = { estado: 'cargando', progreso: 0, recursos: null }
  avisar(e)
  podar()

  let ultimoAviso = 0
  const alProgresar = (fraccion: number) => {
    if (e.estado.estado !== 'cargando' || !Number.isFinite(fraccion)) return
    const f = Math.max(0, Math.min(0.99, fraccion))
    if (f - ultimoAviso < 0.02) return
    ultimoAviso = f
    e.estado = { estado: 'cargando', progreso: f, recursos: null }
    avisar(e)
  }
  const personajes = [...new Set<IdPersonaje>([jugador, rival])]
  Promise.resolve()
    .then(() => cargarRecursos(personajes, arena, alProgresar))
    .then(
      (recursos) => {
        e.estado = { estado: 'listo', progreso: 1, recursos }
        avisar(e)
      },
      (error: unknown) => {
        console.error('[juego] no se pudieron cargar los recursos', error)
        e.estado = { estado: 'error', progreso: 0, recursos: null }
        avisar(e)
      },
    )
  return clave
}

/** Para leer fuera del render (handlers): el estado actual de una combinación. */
export function estadoPrecarga(jugador: IdPersonaje, rival: IdPersonaje, arena: IdArena): EstadoPrecarga {
  return entradas.get(clavePrecarga(jugador, rival, arena))?.estado ?? ESPERANDO
}

function suscribir(clave: string, oyente: () => void): () => void {
  const e = entradaDe(clave)
  e.oyentes.add(oyente)
  return () => {
    e.oyentes.delete(oyente)
  }
}

function servidor(): EstadoPrecarga {
  return ESPERANDO
}

/**
 * Estado de la precarga de una combinación. Con `arrancar` (la pelea ya está decidida) la
 * arranca si hace falta; sin él sólo mira (en la selección no se baja ningún atlas).
 */
export function usePrecarga(
  jugador: IdPersonaje,
  rival: IdPersonaje,
  arena: IdArena,
  arrancar = true,
): EstadoPrecarga {
  const clave = clavePrecarga(jugador, rival, arena)
  const estado = useSyncExternalStore(
    (oyente) => suscribir(clave, oyente),
    () => entradas.get(clave)?.estado ?? ESPERANDO,
    servidor,
  )
  useEffect(() => {
    if (arrancar) precargar(jugador, rival, arena)
  }, [jugador, rival, arena, arrancar])
  return estado
}
