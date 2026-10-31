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
 *
 * Mientras una combinación carga, la canción del juego no compite por la red (`retenerPista`,
 * audio/pista.ts): en 3G le sumaba ≈ 5 s a la pantalla de carga.
 *
 * Una carga se puede cancelar (`cancelarPrecarga`: «Volver» en la pantalla de carga): se cortan sus
 * pedidos, suelta la red para la canción y la combinación queda como si nunca hubiera empezado (el
 * próximo «¡A pelear!» la pide de nuevo y retoma lo ya bajado, render/recursos.ts). Antes la carga
 * abandonada seguía ≈ 20 s compitiendo por la red y el siguiente «¡A pelear!» esperaba esa bajada
 * colgada hasta que el vigía la cortaba.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { retenerPista } from '../audio/pista'
import { cargarRecursos, esCancelacion } from '../render'
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
  /** La carga en curso (para cancelarla) y su retención de la red. */
  control: AbortController | null
  soltarRed: (() => void) | null
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
    e = { estado: ESPERANDO, iniciada: false, oyentes: new Set(), control: null, soltarRed: null }
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

  const control = new AbortController()
  let ultimoAviso = 0
  const alProgresar = (fraccion: number) => {
    if (e.control !== control || e.estado.estado !== 'cargando' || !Number.isFinite(fraccion)) return
    const f = Math.max(0, Math.min(0.99, fraccion))
    if (f - ultimoAviso < 0.02) return
    ultimoAviso = f
    e.estado = { estado: 'cargando', progreso: f, recursos: null }
    avisar(e)
  }
  const personajes = [...new Set<IdPersonaje>([jugador, rival])]
  const soltarRed = retenerPista()
  e.control = control
  e.soltarRed = soltarRed
  /** Esta carga sigue siendo la de la entrada (no la cancelaron ni la reemplazó otra). */
  const vigente = () => e.control === control
  Promise.resolve()
    .then(() => cargarRecursos(personajes, arena, alProgresar, { senal: control.signal }))
    .then(
      (recursos) => {
        soltarRed()
        if (!vigente()) return
        e.control = null
        e.soltarRed = null
        e.estado = { estado: 'listo', progreso: 1, recursos }
        avisar(e)
      },
      (error: unknown) => {
        soltarRed()
        // Cancelada: el estado ya lo dejó cancelarPrecarga (y no es un error que haya que mostrar).
        if (!vigente() || control.signal.aborted || esCancelacion(error)) return
        e.control = null
        e.soltarRed = null
        console.error('[juego] no se pudieron cargar los recursos', error)
        e.estado = { estado: 'error', progreso: 0, recursos: null }
        avisar(e)
      },
    )
  return clave
}

/**
 * Cancela la carga en curso de una combinación («Volver» mientras carga): corta sus pedidos (los que
 * no comparte con otra carga), le devuelve la red a la canción y la deja sin empezar. Si ya terminó
 * (o falló), no hace nada: lo cargado queda para la revancha.
 */
export function cancelarPrecarga(jugador: IdPersonaje, rival: IdPersonaje, arena: IdArena): void {
  const e = entradas.get(clavePrecarga(jugador, rival, arena))
  if (!e || e.estado.estado !== 'cargando') return
  const control = e.control
  const soltarRed = e.soltarRed
  e.control = null
  e.soltarRed = null
  e.iniciada = false
  e.estado = ESPERANDO
  control?.abort()
  soltarRed?.()
  avisar(e)
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
