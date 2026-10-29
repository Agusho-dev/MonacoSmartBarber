/**
 * Preferencias y récords locales de «Corte Final» (localStorage, sólo de este celular).
 *
 * Es un store chico para `useSyncExternalStore`: el servidor y la hidratación ven los
 * valores iniciales y el cliente lee el storage recién después, sin desfasajes. Cada
 * acceso al storage va con try/catch: en modo privado de Safari, con el storage lleno o
 * bloqueado, el juego sigue andando con lo que tenga en memoria.
 */
import { useSyncExternalStore } from 'react'
import type { Dificultad, IdPersonaje } from '../tipos'

const CLAVE = 'cf.preferencias.v1'

export interface RegistroPersonaje {
  partidas: number
  victorias: number
}

export interface PreferenciasJuego {
  tutorialVisto: boolean
  sonido: boolean
  musica: boolean
  vibracion: boolean
  pantallaCompleta: boolean
  dificultad: Dificultad
  mejorPuntaje: number
  apodo: string
  ultimoPersonaje: IdPersonaje | null
  porPersonaje: Partial<Record<IdPersonaje, RegistroPersonaje>>
}

export const PREFERENCIAS_INICIALES: PreferenciasJuego = {
  tutorialVisto: false,
  sonido: true,
  musica: true,
  vibracion: true,
  pantallaCompleta: true,
  dificultad: 'normal',
  mejorPuntaje: 0,
  apodo: '',
  ultimoPersonaje: null,
  porPersonaje: {},
}

const DIFICULTADES: readonly Dificultad[] = ['facil', 'normal', 'dificil']
const PERSONAJES: readonly IdPersonaje[] = ['simon', 'chipi']

let cache: PreferenciasJuego | null = null
const oyentes = new Set<() => void>()

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function booleano(v: unknown, porDefecto: boolean): boolean {
  return typeof v === 'boolean' ? v : porDefecto
}

function entero(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0
}

/** Lo que haya en el storage pasa por acá: un JSON viejo o tocado a mano no rompe nada. */
function sanear(crudo: unknown): PreferenciasJuego {
  if (!esObjeto(crudo)) return { ...PREFERENCIAS_INICIALES, porPersonaje: {} }
  const i = PREFERENCIAS_INICIALES
  const porPersonaje: Partial<Record<IdPersonaje, RegistroPersonaje>> = {}
  if (esObjeto(crudo.porPersonaje)) {
    for (const id of PERSONAJES) {
      const r = crudo.porPersonaje[id]
      if (esObjeto(r)) {
        const partidas = entero(r.partidas)
        porPersonaje[id] = { partidas, victorias: Math.min(partidas, entero(r.victorias)) }
      }
    }
  }
  return {
    tutorialVisto: booleano(crudo.tutorialVisto, i.tutorialVisto),
    sonido: booleano(crudo.sonido, i.sonido),
    musica: booleano(crudo.musica, i.musica),
    vibracion: booleano(crudo.vibracion, i.vibracion),
    pantallaCompleta: booleano(crudo.pantallaCompleta, i.pantallaCompleta),
    dificultad: DIFICULTADES.includes(crudo.dificultad as Dificultad)
      ? (crudo.dificultad as Dificultad)
      : i.dificultad,
    mejorPuntaje: entero(crudo.mejorPuntaje),
    apodo: typeof crudo.apodo === 'string' ? crudo.apodo.slice(0, 16) : '',
    ultimoPersonaje: PERSONAJES.includes(crudo.ultimoPersonaje as IdPersonaje)
      ? (crudo.ultimoPersonaje as IdPersonaje)
      : null,
    porPersonaje,
  }
}

/** Snapshot estable: el mismo objeto hasta que algo cambie. */
export function leerPreferencias(): PreferenciasJuego {
  if (cache) return cache
  if (typeof window === 'undefined') return PREFERENCIAS_INICIALES
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

export function guardarPreferencias(
  cambio: Partial<PreferenciasJuego> | ((actual: PreferenciasJuego) => Partial<PreferenciasJuego>),
): void {
  const actual = leerPreferencias()
  const parcial = typeof cambio === 'function' ? cambio(actual) : cambio
  cache = { ...actual, ...parcial }
  try {
    window.localStorage.setItem(CLAVE, JSON.stringify(cache))
  } catch {
    // Modo privado o storage lleno: queda en memoria hasta que se cierre la pestaña.
  }
  oyentes.forEach((f) => f())
}

/** Suma una pelea a los récords locales y devuelve el mejor puntaje ANTERIOR. */
export function registrarPelea(personaje: IdPersonaje, gano: boolean, puntaje: number): number {
  const anterior = leerPreferencias().mejorPuntaje
  guardarPreferencias((p) => {
    const r = p.porPersonaje[personaje] ?? { partidas: 0, victorias: 0 }
    return {
      mejorPuntaje: Math.max(p.mejorPuntaje, Math.round(puntaje)),
      porPersonaje: {
        ...p.porPersonaje,
        [personaje]: { partidas: r.partidas + 1, victorias: r.victorias + (gano ? 1 : 0) },
      },
    }
  })
  return anterior
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

function snapshotServidor(): PreferenciasJuego {
  return PREFERENCIAS_INICIALES
}

export function usePreferencias(): PreferenciasJuego {
  return useSyncExternalStore(suscribir, leerPreferencias, snapshotServidor)
}
