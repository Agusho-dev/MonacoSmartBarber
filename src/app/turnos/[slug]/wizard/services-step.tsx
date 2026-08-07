'use client'

import { formatCurrency } from '@/lib/format'
import { Clock, Check, Scissors } from 'lucide-react'
import { cn } from '@/lib/utils'
import { glassPanel, glassInteractive } from '../glass'
import type { PublicService } from '@/lib/actions/public-booking'

interface Props {
  services: PublicService[]
  selected: string[]
  onToggle: (id: string) => void
}

/** Tope del escalonado: con 12 servicios el último no puede tardar medio segundo. */
const STAGGER_MAX = 8

export function ServicesStep({ services, selected, onToggle }: Props) {
  if (services.length === 0) {
    return (
      <div className={cn(glassPanel, 'p-10 text-center')}>
        <Scissors className="mx-auto h-8 w-8 text-[var(--t-text-faint)]" />
        <p className="mt-3 text-sm text-[var(--t-text-muted)]">
          No hay servicios disponibles en esta sucursal.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2.5">
      {services.map((service, i) => {
        const elegido = selected.includes(service.id)
        return (
          <button
            key={service.id}
            type="button"
            onClick={() => onToggle(service.id)}
            aria-pressed={elegido}
            className={cn(
              glassInteractive,
              't-rise w-full p-4 text-left',
              // El único refuerzo del estado elegido es el borde de acento + el
              // check: teñir el fondo con el primario a baja opacidad no se veía
              // sobre un fondo de luminancia parecida.
              elegido && 't-glass-sel'
            )}
            style={{ '--t-i': Math.min(i, STAGGER_MAX) } as React.CSSProperties}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-base font-bold leading-tight text-[var(--t-text)]">
                  {service.name}
                </p>
                {service.duration_minutes ? (
                  <p className="mt-1 flex items-center gap-1 text-xs text-[var(--t-text-muted)]">
                    <Clock className="h-3 w-3" />
                    {service.duration_minutes} min
                  </p>
                ) : null}
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <span className="text-base font-bold text-[var(--t-accent)]">
                  {formatCurrency(service.price)}
                </span>
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-full border-2 transition-[background-color,border-color,transform] duration-200"
                  style={{
                    borderColor: elegido ? 'var(--t-primary)' : 'var(--t-text-faint)',
                    backgroundColor: elegido ? 'var(--t-primary)' : 'transparent',
                    color: 'var(--t-on-primary)',
                    transform: elegido ? 'scale(1.08)' : 'scale(1)',
                  }}
                >
                  {elegido && <Check className="h-4 w-4" strokeWidth={3} />}
                </span>
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
