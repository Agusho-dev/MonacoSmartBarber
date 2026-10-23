'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { CalendarDays, Cog, Link2, Wallet } from 'lucide-react'
import { useTiraConScroll } from './use-tira-con-scroll'

// "Personalización" dejó de ser una pestaña: los colores del turnero son una
// sección de Configuración (la ruta vieja redirige a ese ancla).
const tabs = [
  { href: '/dashboard/turnos/agenda', label: 'Agenda', icon: CalendarDays },
  { href: '/dashboard/turnos/configuracion', label: 'Configuración', icon: Cog },
  { href: '/dashboard/turnos/link-publico', label: 'Link público', icon: Link2 },
  // Sólo para quien tenga `senas.view`. El permiso lo resuelve el layout (que
  // es un server component) y llega como prop: un componente cliente no puede
  // preguntarlo, y esconder una pestaña de plata "por las dudas" no es lo mismo
  // que gatearla — el guard de verdad está en la página.
  { href: '/dashboard/turnos/senas', label: 'Señas', icon: Wallet, permiso: 'senas' as const },
]

// Pestañas de SEGUNDO nivel: el contenedor gris con la activa en relieve, como
// las de Equipo o la Fila. El subrayado quedó para el primer nivel (las
// pestañas del grupo, en el encabezado del shell): así se distinguen.
export function TurnosSubnav({ verSenas = false }: { verSenas?: boolean }) {
  const pathname = usePathname()
  const visibles = tabs.filter(t => t.permiso !== 'senas' || verSenas)
  const activa = visibles.find(t => pathname === t.href || pathname.startsWith(t.href + '/'))?.href ?? null
  const { ref, onScroll, onFocus } = useTiraConScroll<HTMLDivElement>(activa, visibles.map(t => t.href).join('|'))

  return (
    <div
      ref={ref}
      onScroll={onScroll}
      onFocus={onFocus}
      className="relative -mx-3 overflow-x-auto overscroll-x-contain px-3 [scrollbar-width:none] lg:mx-0 lg:px-0 [&::-webkit-scrollbar]:hidden"
    >
      <nav aria-label="Secciones de Turnos" className="flex w-fit flex-nowrap gap-1 rounded-lg border bg-muted/30 p-1">
        {visibles.map((tab) => {
          const isActive = tab.href === activa
          return (
            <Link
              key={tab.href}
              href={tab.href}
              data-marcada={isActive ? '' : undefined}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-all sm:gap-2 sm:px-3 sm:py-2 sm:text-sm',
                isActive
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <tab.icon className="size-3.5 shrink-0 sm:size-4" />
              {tab.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
