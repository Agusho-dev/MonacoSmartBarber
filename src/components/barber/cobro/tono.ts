'use client'

import { useSyncExternalStore } from 'react'
import type { TonoAsesoriaBadge } from '../asesoria-badge'

/**
 * Claro u oscuro, según dónde esté abierto el cobro. El diálogo y sus piezas se
 * usan en el panel del barbero (claro: `barber-theme-root` en <html>, que es lo
 * que también pinta los portales) y en el dashboard (oscuro). No sirve `dark:`:
 * el `@custom-variant` de globals.css exige un ancestro `.dark` y la app nunca
 * lo pone (el oscuro es el default de `:root`). Por eso un `text-sky-700
 * dark:text-sky-300` se veía SIEMPRE en su versión clara, también sobre el
 * fondo negro del dashboard.
 *
 * Un solo observador para toda la pantalla, por más piezas que lo lean.
 */
const oyentes = new Set<() => void>()
let observador: MutationObserver | null = null

function suscribirTema(aviso: () => void): () => void {
  oyentes.add(aviso)
  if (!observador) {
    observador = new MutationObserver(() => oyentes.forEach((o) => o()))
    observador.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  }
  return () => {
    oyentes.delete(aviso)
    if (oyentes.size === 0) {
      observador?.disconnect()
      observador = null
    }
  }
}

const temaDelDocumento = (): TonoAsesoriaBadge =>
  document.documentElement.classList.contains('barber-theme-root') ? 'claro' : 'oscuro'
const temaDelServidor = (): TonoAsesoriaBadge => 'oscuro'

export function useTonoDelTema(): TonoAsesoriaBadge {
  return useSyncExternalStore(suscribirTema, temaDelDocumento, temaDelServidor)
}

/**
 * Los avisos de color del cobro (borde, fondo y texto), legibles en los dos
 * temas. Celeste: seña y cobros conjuntos; ámbar: algo que mirar antes de
 * cobrar; verde: listo (comprobante verificado, beneficio aplicado).
 */
const AVISOS = {
  celeste: {
    claro: 'border-sky-600/30 bg-sky-500/10 text-sky-800',
    oscuro: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  },
  ambar: {
    claro: 'border-amber-500/45 bg-amber-400/15 text-amber-800',
    oscuro: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  },
  verde: {
    claro: 'border-emerald-600/30 bg-emerald-500/10 text-emerald-800',
    oscuro: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  },
} as const

export type ColorAviso = keyof typeof AVISOS

export function claseAviso(color: ColorAviso, tono: TonoAsesoriaBadge): string {
  return AVISOS[color][tono]
}

/** Sólo el color del texto, para una línea suelta (sin caja). */
const TEXTOS: Record<ColorAviso, Record<TonoAsesoriaBadge, string>> = {
  celeste: { claro: 'text-sky-800', oscuro: 'text-sky-300' },
  ambar: { claro: 'text-amber-800', oscuro: 'text-amber-300' },
  verde: { claro: 'text-emerald-700', oscuro: 'text-emerald-300' },
}

export function claseTextoAviso(color: ColorAviso, tono: TonoAsesoriaBadge): string {
  return TEXTOS[color][tono]
}
