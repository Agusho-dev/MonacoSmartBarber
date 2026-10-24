'use client'

// El botón "…" de arriba a la izquierda de la lista de chats, como el de
// WhatsApp. En el celular es la única puerta a las otras secciones (la barra
// propia de 8 botones de abajo se fue: abajo está la barra del dashboard). En
// la compu las secciones ya están en la columna de la izquierda, y el menú
// queda con lo que no es una sección: programados, configuración y pantalla
// completa.
//
// El menú es de vidrio, como los de iOS 26 (CLASE_MENU_IOS, lista-ios.tsx):
// translúcido y desenfocado, con el texto blanco arriba de 5:1 aunque abajo
// haya algo claro.

import type { ReactNode } from 'react'
import { CalendarClock, Ellipsis, Maximize2, Minimize2, Settings, type LucideIcon } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useEsCelular } from '@/hooks/use-es-celular'
import { cn } from '@/lib/utils'
import { CLASE_ITEM_MENU_IOS, CLASE_MENU_IOS } from './lista-ios'
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
        {/* Se ve de 36 px (32 en la compu) y se toca en 44: el margen negativo
            lo deja ocupar lo mismo en la barra de la lista. */}
        <button
          type="button"
          aria-label={pendientes ? 'Más opciones (hay alertas o casos pendientes)' : 'Más opciones'}
          className="group/mas relative -m-1 flex size-11 shrink-0 items-center justify-center rounded-full outline-none [-webkit-tap-highlight-color:transparent] lg:m-0 lg:size-8"
        >
          <span
            className={cn(
              'flex size-9 items-center justify-center rounded-full bg-[var(--wa-field)] text-[var(--wa-text)] lg:size-8',
              'transition-[background-color,scale] duration-150 group-active/mas:scale-95 group-active/mas:bg-[var(--wa-raised-2)] lg:group-hover/mas:bg-[var(--wa-raised-2)]',
              'group-focus-visible/mas:ring-2 group-focus-visible/mas:ring-[var(--wa-accent)]/60 group-data-[state=open]/mas:bg-[var(--wa-raised-2)]',
            )}
          >
            <Ellipsis aria-hidden className="size-5 lg:size-[18px]" strokeWidth={2.25} />
          </span>
          {/* En el celular las alertas y los casos viven adentro de este menú:
              el puntito avisa que hay algo esperando. En la compu ya se ven en
              la columna de secciones. */}
          {pendientes && (
            <span aria-hidden className="absolute right-0.5 top-0.5 size-2.5 rounded-full bg-red-500 ring-2 ring-[var(--wa-bg)] lg:hidden" />
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" sideOffset={6} collisionPadding={12} className={CLASE_MENU_IOS}>
        {esCelular &&
          DEL_MENU.map((destino) => {
            const item = ITEMS_SECCIONES.find((i) => i.destino === destino)
            if (!item) return null
            const n = destino === 'alerts' ? alertCount : destino === 'casos' ? casosCount : 0
            return (
              <ItemMenu key={destino} icono={item.icono} onSelect={() => onIr(destino)}>
                {item.etiqueta}
                {n > 0 && (
                  <>
                    <span
                      aria-hidden
                      className={cn(
                        'ml-auto flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1.5 text-[13px] font-semibold leading-none tabular-nums text-white',
                        // Los rojos y naranjas de siempre, un tono más oscuros: el número blanco
                        // queda arriba de 4,5:1 (con bg-red-500 daba 3,8).
                        destino === 'alerts' ? 'bg-[#d32f2f]' : 'bg-[#c2410c]',
                      )}
                    >
                      {numeroCorto(n)}
                    </span>
                    <span className="sr-only">: {n} {destino === 'alerts' ? 'sin leer' : 'pendientes'}</span>
                  </>
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
        <DropdownMenuSeparator className="-mx-1.5 my-1.5 h-[0.5px] bg-white/[0.14] lg:-mx-1 lg:my-1" />
        <ItemMenu icono={isFocusMode ? Minimize2 : Maximize2} onSelect={onToggleFoco}>
          {isFocusMode ? 'Salir de pantalla completa' : 'Pantalla completa'}
        </ItemMenu>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ItemMenu({ icono: Icono, onSelect, children }: { icono: LucideIcon; onSelect: () => void; children: ReactNode }) {
  return (
    <DropdownMenuItem onSelect={onSelect} className={CLASE_ITEM_MENU_IOS}>
      <Icono aria-hidden strokeWidth={1.9} />
      {children}
    </DropdownMenuItem>
  )
}
