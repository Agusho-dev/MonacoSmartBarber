'use client'

// Lo que la pantalla necesita saber del navegador, leído con
// useSyncExternalStore: en el servidor no hay ventana y la respuesta es la del
// celular (mobile-first), que es lo que se dibuja antes de hidratar.

import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react'
import { useSearchParams } from 'next/navigation'

function suscribirMedia(query: string) {
  return (avisar: () => void) => {
    const mq = window.matchMedia(query)
    mq.addEventListener('change', avisar)
    return () => mq.removeEventListener('change', avisar)
  }
}

export function useMedia(query: string): boolean {
  const suscribir = useMemo(() => suscribirMedia(query), [query])
  return useSyncExternalStore(
    suscribir,
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/** ≥ 1024 px: la grilla de escritorio (veredicto 8/12 + Tex 4/12, tabla de casos). */
export function useEsEscritorio(): boolean {
  return useMedia('(min-width: 1024px)')
}

/** ≥ 640 px: "Conectar cuenta" va en un diálogo de 480; abajo de eso, a pantalla completa. */
export function useEsAncho(): boolean {
  return useMedia('(min-width: 640px)')
}

const nada = () => () => {}

/** false en el servidor y mientras hidrata; true después. */
export function useHidratado(): boolean {
  return useSyncExternalStore(nada, () => true, () => false)
}

/** El origen real del navegador (para avisar si no es el dominio público). null en el servidor. */
export function useOrigen(): string | null {
  return useSyncExternalStore(nada, () => window.location.origin, () => null)
}

// ── El reloj de la pantalla ─────────────────────────────────────────────────
// Uno solo para toda la página, de a 30 s: "leído hace 47 min" se recuenta
// mientras la pantalla está abierta (el texto del servidor queda fijo en la hora
// en que se calculó). Se para cuando nadie lo mira.
let ahoraReloj = 0
const oyentesReloj = new Set<() => void>()
let intervaloReloj: number | null = null

function tic() {
  ahoraReloj = Date.now()
  for (const avisar of oyentesReloj) avisar()
}

/** Al volver a la pestaña no se espera el próximo tic (el navegador los frena en segundo plano). */
function ticAlVolver() {
  if (document.visibilityState === 'visible') tic()
}

function suscribirReloj(avisar: () => void) {
  oyentesReloj.add(avisar)
  if (intervaloReloj === null) {
    // El valor guardado puede ser de otra visita a la pantalla: se pone al día al suscribirse.
    ahoraReloj = Date.now()
    intervaloReloj = window.setInterval(tic, 30_000)
    document.addEventListener('visibilitychange', ticAlVolver)
  }
  return () => {
    oyentesReloj.delete(avisar)
    if (!oyentesReloj.size && intervaloReloj !== null) {
      window.clearInterval(intervaloReloj)
      intervaloReloj = null
      document.removeEventListener('visibilitychange', ticAlVolver)
    }
  }
}

function leerReloj(): number {
  if (!ahoraReloj) ahoraReloj = Date.now()
  return ahoraReloj
}

/** La hora (ms) para contar "hace N min", al día cada 30 s. null en el servidor y mientras hidrata. */
export function useAhora(): number | null {
  return useSyncExternalStore(suscribirReloj, leerReloj, () => null)
}

/**
 * Una hoja abierta que vive en la URL (`?caso=<id>`): así el botón "atrás" de
 * Android la cierra en vez de sacarte de la pantalla, y un enlace puede abrir
 * un caso puntual. Abrir empuja una entrada al historial; cerrar desde la
 * pantalla vuelve atrás (si la empujamos nosotros) o la saca de la URL.
 *
 * Usa la History API nativa, que Next integra con useSearchParams sin pedirle
 * nada al servidor (la página no se vuelve a renderizar en el servidor).
 */
export function useParamEnHistorial(nombre: string): [string | null, (valor: string) => void, () => void] {
  const params = useSearchParams()
  const valor = params.get(nombre)
  const empujada = useRef(false)

  const abrir = useCallback(
    (v: string) => {
      const url = new URL(window.location.href)
      const yaEstaba = url.searchParams.has(nombre)
      url.searchParams.set(nombre, v)
      if (yaEstaba) {
        window.history.replaceState(null, '', url)
      } else {
        window.history.pushState(null, '', url)
        empujada.current = true
      }
    },
    [nombre],
  )

  const cerrar = useCallback(() => {
    const url = new URL(window.location.href)
    if (!url.searchParams.has(nombre)) return
    if (empujada.current) {
      empujada.current = false
      window.history.back()
      return
    }
    url.searchParams.delete(nombre)
    window.history.replaceState(null, '', url)
  }, [nombre])

  return [valor, abrir, cerrar]
}

/** Cambia parámetros de la URL sin navegar ni agregar entradas al historial. */
export function reemplazarParams(cambios: Record<string, string | null>): void {
  const url = new URL(window.location.href)
  for (const [k, v] of Object.entries(cambios)) {
    if (v == null) url.searchParams.delete(k)
    else url.searchParams.set(k, v)
  }
  window.history.replaceState(null, '', url)
}
