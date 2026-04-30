'use client'

import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/format'
import { Clock, Check } from 'lucide-react'
import type { PublicService } from '@/lib/actions/public-booking'

interface Props {
  services: PublicService[]
  selected: string[]
  onToggle: (id: string) => void
  branding: { primary: string; bg: string; text: string }
}

export function ServicesStep({ services, selected, onToggle, branding }: Props) {
  if (services.length === 0) {
    return (
      <div
        className="rounded-xl border-2 border-dashed p-10 text-center"
        style={{ borderColor: 'rgba(0,0,0,0.12)', color: branding.text }}
      >
        <p className="text-sm opacity-60">No hay servicios disponibles en esta sucursal.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {services.map(service => {
        const isSelected = selected.includes(service.id)
        return (
          <button
            key={service.id}
            type="button"
            onClick={() => onToggle(service.id)}
            className={cn(
              'relative w-full rounded-xl border-2 p-4 text-left transition-all active:scale-[0.99]',
              'min-h-[56px]'
            )}
            style={{
              borderColor: isSelected ? branding.primary : 'rgba(0,0,0,0.10)',
              backgroundColor: isSelected ? `${branding.primary}10` : 'transparent',
            }}
            aria-pressed={isSelected}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p
                  className="font-semibold leading-tight"
                  style={{ color: branding.text }}
                >
                  {service.name}
                </p>
                {service.duration_minutes && (
                  <p
                    className="mt-0.5 flex items-center gap-1 text-xs"
                    style={{ color: branding.text, opacity: 0.6 }}
                  >
                    <Clock className="h-3 w-3" />
                    {service.duration_minutes} min
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <span
                  className="text-base font-bold"
                  style={{ color: branding.primary }}
                >
                  {formatCurrency(service.price)}
                </span>
                <div
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-full border-2 transition-all',
                  )}
                  style={{
                    borderColor: isSelected ? branding.primary : 'rgba(0,0,0,0.20)',
                    backgroundColor: isSelected ? branding.primary : 'transparent',
                  }}
                >
                  {isSelected && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                </div>
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
