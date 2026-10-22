'use client'

// El lanzador de Tex en el header del shell. En la compu, un campo-botón
// centrado ("Preguntale a Tex…" + ⌘K); en el celular, un botón de 40×40 con la
// cara. Nada flotante: abajo a la derecha están los toasts, el composer de
// Mensajería y los destinos de arrastre de la Fila.
//
// Liviano a propósito (está en todas las pantallas): sólo pide abrir el panel
// (`abrirTex()`, que además guarda el pedido por si el panel todavía no cargó)
// y precarga el chat cuando el mouse se acerca.

import { cn } from '@/lib/utils'
import { TexIcono } from './tex-icono'
import { abrirTex } from './abrir-tex'
import { useAtajoTex } from './chat/hooks'
import { precargarPanelTex } from './chat/precarga'

export function TexLanzador({ variante, className }: { variante: 'escritorio' | 'movil'; className?: string }) {
  const atajo = useAtajoTex()

  if (variante === 'movil') {
    return (
      <button
        type="button"
        onClick={() => abrirTex()}
        onPointerDown={precargarPanelTex}
        aria-label="Preguntale a Tex"
        title="Preguntale a Tex"
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tex)]/60 lg:hidden',
          className,
        )}
      >
        <TexIcono className="size-7" />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => abrirTex()}
      onPointerEnter={precargarPanelTex}
      onFocus={precargarPanelTex}
      aria-keyshortcuts="Meta+K Control+K"
      className={cn(
        'hidden h-9 w-[360px] max-w-[36vw] items-center gap-2.5 rounded-[10px] border bg-card pl-2 pr-2 text-sm text-muted-foreground shadow-xs transition-colors',
        'hover:border-white/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tex)]/60 lg:flex',
        className,
      )}
    >
      <TexIcono className="size-6" />
      <span className="min-w-0 flex-1 truncate text-left">Preguntale a Tex…</span>
      {atajo && (
        <kbd className="pointer-events-none shrink-0 rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-sans text-[11px] font-medium tabular-nums text-muted-foreground">
          {atajo}
        </kbd>
      )}
    </button>
  )
}
