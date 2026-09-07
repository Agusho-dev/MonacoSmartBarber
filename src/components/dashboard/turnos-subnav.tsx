'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { CalendarDays, Cog, Link2, Wallet } from 'lucide-react'

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

export function TurnosSubnav({ verSenas = false }: { verSenas?: boolean }) {
  const pathname = usePathname()
  const visibles = tabs.filter(t => t.permiso !== 'senas' || verSenas)

  return (
    <div className="border-b">
      <nav className="-mb-px flex gap-1 overflow-x-auto">
        {visibles.map((tab) => {
          const isActive = pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              <tab.icon className="size-4" />
              {tab.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
