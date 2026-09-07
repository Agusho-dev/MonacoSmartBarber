'use client'

import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { tierGradient, visitasRecientesLabel, type LoyaltyTierLite } from '@/lib/loyalty-checkout'

interface LoyaltyTierChipProps {
  /** Categoría del cliente, tal como viene de `loyalty_tiers` (nombre y colores del dueño). */
  tier: LoyaltyTierLite
  /** Visitas en la ventana móvil: si viene, el chip dice "Oro · 7 visitas recientes". */
  visits?: number | null
  size?: 'sm' | 'md'
  className?: string
}

/**
 * Chip chico de categoría para la fila y el cobro. Pinta con el gradiente y el
 * color de texto de la categoría — los mismos que la tarjeta de la app — así el
 * barbero reconoce de un vistazo lo que el cliente ve en su celular. Sin
 * categoría no se renderiza nada: eso lo decide el padre (`findLoyaltyTier`).
 */
export function LoyaltyTierChip({ tier, visits, size = 'sm', className }: LoyaltyTierChipProps) {
  const style: CSSProperties = {
    backgroundImage: tierGradient(tier.color_primary, tier.color_secondary),
    color: tier.text_color,
  }
  const label = visits == null ? tier.name : `${tier.name} · ${visitasRecientesLabel(visits)}`
  return (
    <span
      style={style}
      title={label}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full font-bold uppercase tracking-[0.12em]',
        'shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_1px_2px_rgba(0,0,0,0.35)] ring-1 ring-black/20',
        size === 'sm' ? 'h-5 px-2 text-[10px]' : 'h-6 px-2.5 text-[11px]',
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current opacity-80" aria-hidden />
      <span>{tier.name}</span>
      {visits != null && (
        <span className="font-semibold normal-case tracking-normal opacity-90">
          · {visitasRecientesLabel(visits)}
        </span>
      )}
    </span>
  )
}
