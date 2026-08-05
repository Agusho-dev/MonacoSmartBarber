'use client'

import { formatCurrency } from '@/lib/format'
import { Clock, Check, Scissors } from 'lucide-react'
import type { PublicService } from '@/lib/actions/public-booking'

interface Props {
  services: PublicService[]
  selected: string[]
  onToggle: (id: string) => void
}

export function ServicesStep({ services, selected, onToggle }: Props) {
  if (services.length === 0) {
    return (
      <div
        className="rounded-2xl border p-10 text-center"
        style={{ backgroundColor: 'var(--t-surface)', borderColor: 'var(--t-border)' }}
      >
        <Scissors className="mx-auto h-8 w-8 text-[var(--t-text-faint)]" />
        <p className="mt-3 text-sm text-[var(--t-text-muted)]">
          No hay servicios disponibles en esta sucursal.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2.5">
      {services.map(service => {
        const elegido = selected.includes(service.id)
        return (
          <button
            key={service.id}
            type="button"
            onClick={() => onToggle(service.id)}
            aria-pressed={elegido}
            className="w-full rounded-2xl border p-4 text-left transition-[background-color,border-color,transform] duration-150 active:scale-[0.99]"
            style={{
              backgroundColor: 'var(--t-surface)',
              // El único refuerzo del estado elegido es el borde de acento + el
              // check: teñir el fondo con el primario a baja opacidad no se veía
              // sobre un fondo de luminancia parecida.
              borderColor: elegido ? 'var(--t-accent)' : 'var(--t-border)',
              boxShadow: elegido ? 'inset 0 0 0 1px var(--t-accent)' : undefined,
            }}
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
                  className="flex h-7 w-7 items-center justify-center rounded-full border-2 transition-colors duration-150"
                  style={{
                    borderColor: elegido ? 'var(--t-primary)' : 'var(--t-text-faint)',
                    backgroundColor: elegido ? 'var(--t-primary)' : 'transparent',
                    color: 'var(--t-on-primary)',
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
