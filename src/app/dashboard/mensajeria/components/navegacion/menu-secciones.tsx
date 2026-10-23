'use client'

// El botón "…" de arriba a la izquierda de la lista de chats, como el de
// WhatsApp. En el celular es la única puerta a las otras secciones (la barra
// propia de 8 botones de abajo se fue: abajo está la barra del dashboard). En
// la compu las secciones ya están en la columna de la izquierda, y el menú
// queda con lo que no es una sección: programados, configuración y pantalla
// completa.

import type { ReactNode } from 'react'
import { CalendarClock, Ellipsis, Maximize2, Minimize2, Settings, type LucideIcon } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useEsCelular } from '@/hooks/use-es-celular'
import { cn } from '@/lib/utils'
import { ITEMS_SECCIONES, numeroCorto, type DestinoMensajeria } from './secciones'

// Las secciones que en el celular se abren desde el menú, en este orden.
const DEL_MENU: readonly DestinoMensajeria[] = ['broadcasts', 'automations', 'alerts', 'casos', 'quick-replies']

export function MenuSecciones({
  alertCount,
  casosCount,
  isFocusMode,
  onIr,
  onConfig,
  onToggleFoco,
  onAbrir,
}: {
  alertCount: number
  casosCount: number
  isFocusMode: boolean
  onIr: (destino: DestinoMensajeria) => void
  onConfig: () => void
  onToggleFoco: () => void
  /** Al abrirse: para volver a contar alertas y casos. */
  onAbrir?: () => void
}) {
  // El contenido se dibuja recién al abrir, con la página ya hidratada: acá
  // useEsCelular ya dice la verdad.
  const esCelular = useEsCelular()
  const pendientes = alertCount > 0 || casosCount > 0

  return (
    <DropdownMenu onOpenChange={(abierto) => { if (abierto) onAbrir?.() }}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={pendientes ? 'Más opciones (hay alertas o casos pendientes)' : 'Más opciones'}
          className={cn(
            'relative flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--wa-field)] text-[var(--wa-text)] outline-none [-webkit-tap-highlight-color:transparent]',
            'transition-[background-color,scale] duration-150 active:scale-95 active:bg-[var(--wa-raised-2)] lg:size-8 lg:hover:bg-[var(--wa-raised-2)]',
            'focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60 data-[state=open]:bg-[var(--wa-raised-2)]',
          )}
        >
          <Ellipsis aria-hidden className="size-5 lg:size-[18px]" strokeWidth={2.25} />
          {/* En el celular las alertas y los casos viven adentro de este menú:
              el puntito avisa que hay algo esperando. En la compu ya se ven en
              la columna de secciones. */}
          {pendientes && (
            <span aria-hidden className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-red-500 ring-2 ring-[var(--wa-bg)] lg:hidden" />
          )}
        </button>
      </DropdownMenuTrigger>

      {/* El menú va a un portal fuera de .wa-scope: la clase va de nuevo acá
          para que sus colores (--wa-*) y la letra del sistema resuelvan. */}
      <DropdownMenuContent
        align="start"
        sideOffset={8}
        collisionPadding={12}
        className="wa-scope w-64 rounded-[14px] border-0 bg-[var(--wa-raised)]/95 p-1.5 text-[var(--wa-text)] shadow-[0_18px_50px_-12px_rgba(0,0,0,0.75),0_0_0_0.5px_rgba(255,255,255,0.08)] backdrop-blur-2xl lg:w-60"
      >
        {esCelular &&
          DEL_MENU.map((destino) => {
            const item = ITEMS_SECCIONES.find((i) => i.destino === destino)
            if (!item) return null
            const n = destino === 'alerts' ? alertCount : destino === 'casos' ? casosCount : 0
            return (
              <ItemMenu key={destino} icono={item.icono} onSelect={() => onIr(destino)}>
                {item.etiqueta}
                {n > 0 && (
                  <span
                    className={cn(
                      'ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[12px] font-semibold leading-none tabular-nums text-white',
                      destino === 'alerts' ? 'bg-red-500' : 'bg-orange-500',
                    )}
                  >
                    {numeroCorto(n)}
                  </span>
                )}
              </ItemMenu>
            )
          })}
        <ItemMenu icono={CalendarClock} onSelect={() => onIr('programados')}>
          Mensajes programados
        </ItemMenu>
        <ItemMenu icono={Settings} onSelect={onConfig}>
          Configuración
        </ItemMenu>
        <DropdownMenuSeparator className="-mx-1.5 my-1.5 h-[0.5px] bg-[var(--wa-divider)]" />
        <ItemMenu icono={isFocusMode ? Minimize2 : Maximize2} onSelect={onToggleFoco}>
          {isFocusMode ? 'Salir de pantalla completa' : 'Pantalla completa'}
        </ItemMenu>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ItemMenu({ icono: Icono, onSelect, children }: { icono: LucideIcon; onSelect: () => void; children: ReactNode }) {
  return (
    <DropdownMenuItem
      onSelect={onSelect}
      className="h-11 gap-3 rounded-[10px] px-3 text-[16px] text-[var(--wa-text)] focus:bg-[var(--wa-raised-2)] focus:text-[var(--wa-text)] lg:h-9 lg:text-[14px]"
    >
      <Icono aria-hidden className="size-5 text-[var(--wa-text)] lg:size-[18px]" strokeWidth={1.9} />
      {children}
    </DropdownMenuItem>
  )
}
