/**
 * El modo historia guardado en el celular (localStorage, `cf.historia.v1`): el torneo en curso, la
 * galería «Tus campeones» y si ya vio la intro. Mismo esquema que preferencias.ts: un store chico
 * para `useSyncExternalStore` (el servidor y la hidratación ven el estado vacío; el cliente lee el
 * storage recién después) y cada acceso al storage con try/catch (modo privado de Safari, storage
 * lleno o bloqueado: sigue andando en memoria).
 *
 * Si te llaman a cortarte en el piso 6, el torneo queda acá: la próxima vez la portada dice «Seguir
 * el torneo · Piso 6 de 9».
 */
import { useSyncExternalStore } from 'react'
import { sanearCampeones, sanearTorre, TOPE_CAMPEONES, type Campeon, type Torre } from '../historia/torre'

const CLAVE = 'cf.historia.v1'

export interface HistoriaGuardada {
  torre: Torre | null
  campeones: Campeon[]
  introVista: boolean
}

const VACIA: HistoriaGuardada = { torre: null, campeones: [], introVista: false }

let cache: HistoriaGuardada | null = null
const oyentes = new Set<() => void>()

function sanear(crudo: unknown): HistoriaGuardada {
  if (typeof crudo !== 'object' || crudo === null || Array.isArray(crudo)) return { ...VACIA, campeones: [] }
  const c = crudo as Record<string, unknown>
  return {
    torre: sanearTorre(c.torre),
    campeones: sanearCampeones(c.campeones),
    introVista: c.introVista === true,
  }
}

/** Snapshot estable: el mismo objeto hasta que algo cambie. */
export function leerHistoria(): HistoriaGuardada {
  if (cache) return cache
  if (typeof window === 'undefined') return VACIA
  let crudo: unknown = null
  try {
    const texto = window.localStorage.getItem(CLAVE)
    crudo = texto ? JSON.parse(texto) : null
  } catch {
    crudo = null
  }
  cache = sanear(crudo)
  return cache
}

function guardar(siguiente: HistoriaGuardada): void {
  cache = siguiente
  try {
    window.localStorage.setItem(CLAVE, JSON.stringify(siguiente))
  } catch {
    // Modo privado o storage lleno: queda en memoria hasta que se cierre la pestaña.
  }
  oyentes.forEach((f) => f())
}

/** El torneo en curso (null: no hay o se abandonó). */
export function guardarTorre(torre: Torre | null): void {
  guardar({ ...leerHistoria(), torre })
}

export function marcarIntroVista(): void {
  const h = leerHistoria()
  if (!h.introVista) guardar({ ...h, introVista: true })
}

/** Torneo ganado: se suma a la galería y el torneo en curso se cierra. */
export function sumarCampeon(campeon: Campeon): void {
  const h = leerHistoria()
  guardar({ ...h, torre: null, campeones: [...h.campeones, campeon].slice(-TOPE_CAMPEONES) })
}

function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente)
  // Otra pestaña con el juego abierto: releer.
  const alCambiarStorage = (e: StorageEvent) => {
    if (e.key === CLAVE) {
      cache = null
      oyente()
    }
  }
  window.addEventListener('storage', alCambiarStorage)
  return () => {
    oyentes.delete(oyente)
    window.removeEventListener('storage', alCambiarStorage)
  }
}

function snapshotServidor(): HistoriaGuardada {
  return VACIA
}

export function useHistoria(): HistoriaGuardada {
  return useSyncExternalStore(suscribir, leerHistoria, snapshotServidor)
}
