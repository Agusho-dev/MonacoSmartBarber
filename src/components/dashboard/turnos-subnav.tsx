'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { CalendarDays, Cog, Palette, Link2 } from 'lucide-react'

const tabs = [
  { href: '/dashboard/turnos/agenda', label: 'Agenda', icon: CalendarDays },
  { href: '/dashboard/turnos/configuracion', label: 'Configuración', icon: Cog },
  { href: '/dashboard/turnos/personalizacion', label: 'Personalización', icon: Palette },
  { href: '/dashboard/turnos/link-publico', label: 'Link público', icon: Link2 },
]

export function TurnosSubnav() {
  const pathname = usePathname()

  return (
    <div className="border-b">
      <nav className="-mb-px flex gap-1 overflow-x-auto">
        {tabs.map((tab) => {
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
