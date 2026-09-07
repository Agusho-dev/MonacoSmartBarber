'use client'

// Sub-navegación pegajosa del módulo. El tab activo vive en `?tab=` para que
// un link pueda abrir una pestaña puntual (por ejemplo desde App Móvil).

import { BellRing, Coins, Gift, Layers, LayoutDashboard, UserPlus, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Tab } from './helpers'

const ITEMS: { id: Tab; label: string; icon: typeof Gift }[] = [
  { id: 'resumen', label: 'Resumen', icon: LayoutDashboard },
  { id: 'categorias', label: 'Categorías', icon: Layers },
  { id: 'puntos', label: 'Puntos', icon: Coins },
  { id: 'premios', label: 'Premios', icon: Gift },
  { id: 'referidos', label: 'Referidos', icon: UserPlus },
  { id: 'notificaciones', label: 'Notificaciones', icon: BellRing },
  { id: 'clientes', label: 'Clientes', icon: Users },
]

interface Props {
  active: Tab
  onChange: (tab: Tab) => void
  /** Puntito rojo en Resumen cuando hay errores recientes del programa. */
  alerta?: boolean
}

export function FidelizacionSubnav({ active, onChange, alerta }: Props) {
  return (
    <nav
      aria-label="Secciones de fidelización"
      className="sticky top-0 z-20 -mx-3 border-b border-white/[0.06] bg-zinc-950/85 px-3 backdrop-blur-xl lg:-mx-6 lg:px-6"
    >
      <div className="-mb-px flex gap-1 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {ITEMS.map(item => {
          const activo = item.id === active
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              aria-current={activo ? 'page' : undefined}
              className={cn(
                'relative flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                activo ? 'bg-white/[0.08] text-foreground' : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground',
              )}
            >
              <item.icon className="size-4" />
              {item.label}
              {item.id === 'resumen' && alerta && (
                <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-red-500" aria-label="Hay errores recientes" />
              )}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
