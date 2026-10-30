/**
 * Lo que queda en ESTE celular de las peleas online (localStorage, con try/catch: en modo
 * privado o con el storage lleno sigue en memoria):
 *  - el número de «Jugador 1234», para que no cambie entre visitas;
 *  - las victorias y peleas online (no van al ranking: el ranking es contra la CPU).
 *
 * El marcador entre dos jugadores («2 – 1») es de la sesión: vive en memoria, por rival.
 */
import { useSyncExternalStore } from 'react'

const CLAVE = 'cf.online.v1'

export interface RegistroOnline {
  numero: number
  victorias: number
  peleas: number
}

let cache: RegistroOnline | null = null
const oyentes = new Set<() => void>()

function entero(v: unknown, min: number, max: number): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null
}

function numeroNuevo(): number {
  return 1000 + Math.floor(Math.random() * 9000)
}

export function leerRegistroOnline(): RegistroOnline {
  if (cache) return cache
  let crudo: Record<string, unknown> | null = null
  if (typeof window !== 'undefined') {
    try {
      const texto = window.localStorage.getItem(CLAVE)
      const v: unknown = texto ? JSON.parse(texto) : null
      crudo = typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
    } catch {
      crudo = null
    }
  }
  const peleas = entero(crudo?.peleas, 0, 1_000_000) ?? 0
  cache = {
    numero: entero(crudo?.numero, 1000, 9999) ?? numeroNuevo(),
    victorias: Math.min(peleas, entero(crudo?.victorias, 0, 1_000_000) ?? 0),
    peleas,
  }
  // Primera vez en este celular: se guarda el número, SIN avisar (esto corre durante el render).
  if (!crudo || crudo.numero !== cache.numero) persistir()
  return cache
}

function persistir(): void {
  if (!cache || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(CLAVE, JSON.stringify(cache))
  } catch {
    // Queda en memoria.
  }
}

function guardar(): void {
  persistir()
  oyentes.forEach((f) => f())
}

/**
 * Lo que cuenta una pelea online contra `rivalId`: `ahora` true = ganó, false = perdió, null =
 * no cuenta (anulada). `antes` es lo que ya se había anotado de ESA pelea (undefined = nada):
 * si los dos celulares concilian y corrigen un abandono, se deshace lo anterior y se anota lo
 * nuevo, en el récord de este celular y en el marcador de la sesión.
 */
export function registrarResultadoOnline(rivalId: string, ahora: boolean | null, antes: boolean | null | undefined): void {
  if (ahora === antes) return
  const r = leerRegistroOnline()
  let peleas = r.peleas
  let victorias = r.victorias
  const m = marcadorCon(rivalId)
  if (antes === true || antes === false) {
    peleas--
    if (antes) {
      victorias--
      m[0]--
    } else m[1]--
  }
  if (ahora === true || ahora === false) {
    peleas++
    if (ahora) {
      victorias++
      m[0]++
    } else m[1]++
  }
  peleas = Math.max(0, peleas)
  cache = { ...r, peleas, victorias: Math.max(0, Math.min(peleas, victorias)) }
  marcadores.set(rivalId, [Math.max(0, m[0]), Math.max(0, m[1])])
  guardar()
}

const SERVIDOR: RegistroOnline = { numero: 0, victorias: 0, peleas: 0 }

export function useRegistroOnline(): RegistroOnline {
  return useSyncExternalStore(
    (oyente) => {
      oyentes.add(oyente)
      return () => {
        oyentes.delete(oyente)
      }
    },
    leerRegistroOnline,
    () => SERVIDOR,
  )
}

// ─── Marcador de la sesión entre dos jugadores ───────────────────────────────

const marcadores = new Map<string, [number, number]>()

/** [yo, rival] desde que se abrió la página (lo actualiza registrarResultadoOnline). */
export function marcadorCon(rivalId: string): [number, number] {
  const m = marcadores.get(rivalId)
  return m ? [m[0], m[1]] : [0, 0]
}
