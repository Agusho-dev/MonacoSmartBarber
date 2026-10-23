'use client'

// Hooks del navegador que usan la página y el panel de Tex. Todos leen con
// useSyncExternalStore: en el servidor devuelven un valor neutro (false, 0,
// null) y el valor real llega después de hidratar, sin setState en efectos.

import { createContext, useContext, useSyncExternalStore } from 'react'

const sinSuscripcion = () => () => {}

/**
 * false en el servidor y en la hidratación; true después. Para lo que sólo
 * tiene sentido con datos del navegador (y no tiene que aparecer en el HTML
 * del servidor para desaparecer al hidratar).
 */
export function useEnCliente(): boolean {
  return useSyncExternalStore(sinSuscripcion, () => true, () => false)
}

// ─────────────────────────────────────────────────────────────────────────────
// Media queries
// ─────────────────────────────────────────────────────────────────────────────

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (avisar) => {
      const mq = window.matchMedia(query)
      mq.addEventListener('change', avisar)
      return () => mq.removeEventListener('change', avisar)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/** ≥ 1024 px: el breakpoint `lg` del shell (sidebar fija, panel lateral como aside). */
export function useEsEscritorio(): boolean {
  return useMediaQuery('(min-width: 1024px)')
}

/** Puntero fino (mouse/trackpad): Enter envía. En táctil, Enter es nueva línea. */
export function punteroFino(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches
}

/**
 * ¿El clic en este enlace navega a otra pantalla del dashboard en esta misma
 * pestaña? (enlace interno, botón principal, sin ⌘/Ctrl/Shift/Alt ni `target`).
 * Con eso la hoja del panel en el celular se cierra al tocar un enlace.
 */
export function esNavegacionInterna(
  e: Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'defaultPrevented'>,
  href: string | null,
  target: string | null,
): boolean {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false
  if (!href || !href.startsWith('/') || href.startsWith('//')) return false
  return !target || target === '_self'
}

// ─────────────────────────────────────────────────────────────────────────────
// Teclado virtual (iOS / Android)
// ─────────────────────────────────────────────────────────────────────────────

function suscribirTeclado(avisar: () => void): () => void {
  const vv = window.visualViewport
  if (!vv) return () => {}
  vv.addEventListener('resize', avisar)
  vv.addEventListener('scroll', avisar)
  return () => {
    vv.removeEventListener('resize', avisar)
    vv.removeEventListener('scroll', avisar)
  }
}

function leerTeclado(): number {
  const vv = window.visualViewport
  if (!vv) return 0
  // Sólo en táctiles: en una compu el zoom con el trackpad también achica el
  // viewport visual y no es un teclado.
  if (!window.matchMedia('(pointer: coarse)').matches) return 0
  // Lo que el teclado tapa del viewport de layout. En iOS el viewport de layout
  // no se achica (y en Android tampoco desde Chrome 108): `dvh` no se entera del
  // teclado y el composer quedaría debajo. Menos de 80 px es la barra de la URL
  // que se esconde, no un teclado.
  const tapado = window.innerHeight - vv.height - vv.offsetTop
  return tapado > 80 ? Math.round(tapado) : 0
}

/** Cuántos px del fondo de la pantalla tapa el teclado virtual (0 si no hay). */
export function useTecladoVirtual(): number {
  return useSyncExternalStore(suscribirTeclado, leerTeclado, () => 0)
}

const hayTeclado = () => leerTeclado() > 0

/**
 * ¿Hay un teclado virtual abierto? Para quien sólo necesita saber si está: con
 * el teclado abierto el viewport visual se mueve en cada scroll y la cantidad
 * de px cambia en cada evento; el sí/no, no (el botón flotante de Tex no se
 * vuelve a dibujar en cada uno).
 */
export function useHayTecladoVirtual(): boolean {
  return useSyncExternalStore(suscribirTeclado, hayTeclado, () => false)
}

// ─────────────────────────────────────────────────────────────────────────────
// Atajo ⌘K / Ctrl K
// ─────────────────────────────────────────────────────────────────────────────

function esApple(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  const plataforma = nav.userAgentData?.platform || nav.platform || nav.userAgent || ''
  return /mac|iphone|ipad|ipod/i.test(plataforma)
}

/** "⌘K" en Mac, "Ctrl K" en el resto. null en el servidor (no se dibuja hasta hidratar). */
export function useAtajoTex(): string | null {
  return useSyncExternalStore(sinSuscripcion, () => (esApple() ? '⌘K' : 'Ctrl K'), () => null)
}

/** ¿El evento es la combinación ⌘K / Ctrl+K (sin Shift ni Alt)? */
export function esAtajoTex(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'k' || e.key === 'K')
}

/**
 * Hay un Dialog/Sheet/AlertDialog (o un menú) abierto: el atajo no abre nada
 * detrás. Radix no pone `aria-modal`: lo que sí hace es marcar el contenido con
 * `data-state="open"` y, con una capa modal, poner `pointer-events: none` en el body.
 */
export function hayModalAbierto(): boolean {
  return (
    document.body.style.pointerEvents === 'none' ||
    document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]') !== null
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Reloj de los pasos de la tarjeta de trabajo
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cuánto tardó cada herramienta, medido en el navegador ("Leyendo las finanzas
 * · 0,8 s"). Es un store chiquito (no estado de React) porque los tiempos se
 * anotan DESPUÉS de dibujar —en un efecto que mira las partes— y sólo los leen
 * las tarjetas de trabajo. Un paso que ya llegó terminado (una conversación
 * reabierta) no se anota: sin inicio real, mostrar "0,0 s" sería inventar.
 */
export type TiemposPasos = Readonly<Record<string, { inicio: number; fin?: number }>>

export interface RelojPasos {
  suscribir: (avisar: () => void) => () => void
  leer: () => TiemposPasos
  observar: (pasos: { id: string; terminado: boolean }[]) => void
}

const SIN_TIEMPOS: TiemposPasos = Object.freeze({})
const leerSinTiempos = () => SIN_TIEMPOS

export function crearRelojPasos(): RelojPasos {
  let tiempos: TiemposPasos = SIN_TIEMPOS
  const oyentes = new Set<() => void>()
  return {
    suscribir: (avisar) => {
      oyentes.add(avisar)
      return () => {
        oyentes.delete(avisar)
      }
    },
    leer: () => tiempos,
    observar: (pasos) => {
      const ahora = performance.now()
      let siguiente: Record<string, { inicio: number; fin?: number }> | null = null
      for (const p of pasos) {
        const actual = (siguiente ?? tiempos)[p.id]
        if (!actual) {
          if (p.terminado) continue
          siguiente = siguiente ?? { ...tiempos }
          siguiente[p.id] = { inicio: ahora }
        } else if (p.terminado && actual.fin === undefined) {
          siguiente = siguiente ?? { ...tiempos }
          siguiente[p.id] = { inicio: actual.inicio, fin: ahora }
        }
      }
      if (siguiente) {
        tiempos = siguiente
        oyentes.forEach((avisar) => avisar())
      }
    },
  }
}

export const RelojPasosContext = createContext<RelojPasos | null>(null)

export function useTiemposPasos(): TiemposPasos {
  const reloj = useContext(RelojPasosContext)
  return useSyncExternalStore(reloj?.suscribir ?? sinSuscripcion, reloj?.leer ?? leerSinTiempos, leerSinTiempos)
}
