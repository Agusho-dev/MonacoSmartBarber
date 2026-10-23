'use client'

// La hoja de los diálogos propios de Mensajería (Nuevo chat y Programar
// mensaje), como en WhatsApp:
// - Celular: la hoja de pantalla entera de iOS, que entra desde abajo, con
//   "Cancelar" en verde a la izquierda, el título centrado y, si hay, la acción
//   a la derecha ("Programar").
// - Compu: el diálogo de WhatsApp para Mac: gris, redondeado, con el título a la
//   izquierda, la X y los botones abajo.
// Es el Dialog de @/components/ui (Known Risk #39: con la hoja abierta, los
// avisos se tocan sin cerrarla) y va en z-[110], encima de las capas y de la
// info. del contacto. Lleva .wa-scope porque el portal sale de la de
// Mensajería: sin ella, los --wa-* no resuelven.

import type { ComponentProps, ReactNode } from 'react'
import { Loader2, X } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

export interface AccionHoja {
  texto: string
  /** Lo que dice mientras corre ("Programando…"). */
  textoCargando?: string
  onClick: () => void
  deshabilitada?: boolean
  cargando?: boolean
}

export function HojaWhatsApp({
  open,
  onOpenChange,
  titulo,
  descripcion,
  accion,
  onOpenAutoFocus,
  children,
}: {
  open: boolean
  onOpenChange: (abierta: boolean) => void
  titulo: string
  /** Para el lector de pantalla (no se ve). */
  descripcion: string
  accion?: AccionHoja
  onOpenAutoFocus?: ComponentProps<typeof DialogContent>['onOpenAutoFocus']
  children: ReactNode
}) {
  const cerrar = () => onOpenChange(false)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(e) => {
          // Con pantalla táctil, el foco no va a un campo al abrir: va a la hoja.
          // La hoja entra deslizando desde abajo, y si un campo toma el foco a
          // mitad de camino, iOS abre el teclado y corre la pantalla para
          // mostrarlo donde está en ese momento. Al terminar de entrar, la hoja
          // quedaba arriba, fuera de la vista, y sobre el teclado sólo se veía
          // negro (probado en la app instalada, iOS 26.3). WhatsApp tampoco abre
          // el teclado solo: se toca el campo.
          if (window.matchMedia('(pointer: coarse)').matches) {
            e.preventDefault()
            if (e.target instanceof HTMLElement) e.target.focus({ preventScroll: true })
            return
          }
          onOpenAutoFocus?.(e)
        }}
        className={cn(
          'wa-scope flex flex-col gap-0 overflow-hidden border-0 p-0 text-[var(--wa-text)] outline-none',
          // max-h-[none] y no max-h-none: tailwind-merge no reconoce el segundo
          // como rival del max-h del Dialog y quedaban los dos.
          'max-h-[none] max-w-none sm:max-w-none',
          // Celular: pantalla entera, entra y sale por abajo (sin el zoom del diálogo).
          'bg-[var(--wa-bg)] max-lg:inset-0 max-lg:translate-x-0 max-lg:translate-y-0 max-lg:rounded-none max-lg:shadow-none',
          'max-lg:data-[state=open]:slide-in-from-bottom max-lg:data-[state=closed]:slide-out-to-bottom',
          'max-lg:data-[state=open]:zoom-in-100 max-lg:data-[state=closed]:zoom-out-100',
          'max-lg:data-[state=open]:fade-in-100 max-lg:data-[state=closed]:fade-out-100',
          // Compu: el diálogo gris de la Mac.
          'lg:max-h-[min(640px,calc(100dvh-4rem))] lg:w-[440px] lg:rounded-2xl lg:bg-[var(--wa-raised)]',
          'lg:shadow-[0_24px_70px_-12px_rgba(0,0,0,0.8),0_0_0_0.5px_rgba(255,255,255,0.08)]',
        )}
      >
        {/* Celular: la barra de la hoja de iOS. */}
        <div className="relative flex h-14 shrink-0 items-center justify-between px-2 lg:hidden">
          <button
            type="button"
            onClick={cerrar}
            className="relative z-10 flex h-11 items-center rounded-lg px-2 text-[17px] text-[var(--wa-accent)] outline-none transition-opacity duration-150 [-webkit-tap-highlight-color:transparent] active:opacity-40 focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60"
          >
            Cancelar
          </button>
          <DialogTitle className="pointer-events-none absolute inset-x-24 truncate text-center text-[17px] font-semibold leading-normal text-[var(--wa-text)]">
            {titulo}
          </DialogTitle>
          {accion && (
            <button
              type="button"
              onClick={accion.onClick}
              disabled={accion.deshabilitada || accion.cargando}
              className="relative z-10 flex h-11 items-center gap-1.5 rounded-lg px-2 text-[17px] font-semibold text-[var(--wa-accent)] outline-none transition-opacity duration-150 [-webkit-tap-highlight-color:transparent] active:opacity-40 disabled:opacity-35 focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60"
            >
              {accion.cargando && <Loader2 aria-hidden className="size-4 animate-spin" />}
              {accion.cargando ? (accion.textoCargando ?? accion.texto) : accion.texto}
            </button>
          )}
        </div>

        {/* Compu: el título a la izquierda y la X. */}
        <div className="hidden h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--wa-divider)] pl-5 pr-3 lg:flex">
          {/* El título de la compu es para la vista: el de Radix es el del celular (siempre en el DOM). */}
          <p aria-hidden className="truncate text-[16px] font-semibold text-[var(--wa-text)]">{titulo}</p>
          <button
            type="button"
            onClick={cerrar}
            aria-label="Cerrar"
            title="Cerrar"
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--wa-text-2)] outline-none transition-colors hover:bg-[var(--wa-hover)] hover:text-[var(--wa-text)] focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60"
          >
            <X aria-hidden className="size-[18px]" />
          </button>
        </div>
        <DialogDescription className="sr-only">{descripcion}</DialogDescription>

        {children}

        {/* Compu: los botones abajo, como en la Mac. */}
        {accion && (
          <div className="hidden shrink-0 items-center justify-end gap-2 border-t border-[var(--wa-divider)] px-5 py-3.5 lg:flex">
            <button
              type="button"
              onClick={cerrar}
              className="h-9 rounded-full px-4 text-[14px] font-medium text-[var(--wa-accent)] outline-none transition-colors hover:bg-[var(--wa-hover)] focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={accion.onClick}
              disabled={accion.deshabilitada || accion.cargando}
              className="flex h-9 items-center gap-2 rounded-full bg-[var(--wa-accent)] px-5 text-[14px] font-semibold text-[var(--wa-on-accent)] outline-none transition-colors hover:bg-[var(--wa-accent-hover)] disabled:opacity-40 disabled:hover:bg-[var(--wa-accent)] focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--wa-raised)]"
            >
              {accion.cargando && <Loader2 aria-hidden className="size-4 animate-spin" />}
              {accion.cargando ? (accion.textoCargando ?? accion.texto) : accion.texto}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
