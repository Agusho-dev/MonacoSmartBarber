'use client'

// =============================================================================
// MonacoCardPreview — la tarjeta de categoría, igual a la de la app.
//
// Proporción de tarjeta de crédito (1.586:1), gradiente 135° de la categoría,
// banda de brillo diagonal, vignette abajo a la derecha y, en platinum, un
// barrido holográfico que gira despacio. Los colores SIEMPRE vienen por props
// (loyalty_tiers): acá no hay ni un hex de categoría hardcodeado.
// =============================================================================

import { cn } from '@/lib/utils'
import type { LoyaltyTierLook } from '@/lib/types/loyalty'

interface Props {
  tier: LoyaltyTierLook
  points: number
  clientName: string
  /** Año (o fecha ISO) de alta del cliente. */
  memberSince: string
  /**
   * Sin categoría (programa apagado o cliente todavía no enrolado): la cara
   * APAGADA de la app (`_CaraApagada` en monaco_card.dart) — vidrio gris, sin
   * chip ni etiqueta de categoría, "TUS PUNTOS". Los colores de `tier` no se
   * pintan. Antes se dibujaba una tarjeta "CLIENTE SIN CATEGORÍA" que no existe.
   */
  apagada?: boolean
  compact?: boolean
  className?: string
}

function anio(v: string): string {
  if (/^\d{4}$/.test(v)) return v
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : String(d.getFullYear())
}

export function MonacoCardPreview({ tier, points, clientName, memberSince, apagada = false, compact = false, className }: Props) {
  const esPlatinum = tier.code === 'platinum'
  const nombre = (clientName || 'Cliente').toUpperCase()

  if (apagada) {
    return (
      <div
        className={cn(
          'relative w-full select-none overflow-hidden rounded-[22px] border border-white/15 bg-white/[0.09] text-white shadow-[0_18px_40px_-18px_rgba(0,0,0,.8)] backdrop-blur-xl',
          'aspect-[1.586/1]',
          className,
        )}
        aria-label="Tarjeta sin categoría"
        role="img"
      >
        {/* Vidrio: velo blanco tenue y borde interno, sin gradiente de categoría */}
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden
          style={{ backgroundImage: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 100%)' }}
        />
        <div className="pointer-events-none absolute inset-0 rounded-[22px] ring-1 ring-inset ring-white/10" aria-hidden />

        <div className={cn('relative flex h-full flex-col justify-between', compact ? 'p-4' : 'p-5 sm:p-6')}>
          <div className="flex items-start justify-between gap-3">
            <span className={cn('block font-black tracking-[0.35em]', compact ? 'text-[11px]' : 'text-[13px] sm:text-sm')}>
              MONACO
            </span>
            <span className={cn('font-extrabold uppercase tracking-[0.22em] text-white/55', compact ? 'text-[9px]' : 'text-[10px] sm:text-[11px]')}>
              Tus puntos
            </span>
          </div>

          <div className="leading-none">
            <span className={cn('block font-black tabular-nums tracking-tight', compact ? 'text-[26px]' : 'text-[38px] sm:text-[44px]')}>
              {points.toLocaleString('es-AR')}
            </span>
            <span className={cn('mt-1 block font-extrabold uppercase tracking-[0.28em] text-white/70', compact ? 'text-[8px]' : 'text-[10px]')}>
              Puntos
            </span>
          </div>

          <div className="flex items-end justify-between gap-3">
            <span
              className={cn(
                'truncate font-bold uppercase tracking-[0.12em] text-white/90',
                '[text-shadow:0_1px_0_rgba(255,255,255,.18),0_-1px_0_rgba(0,0,0,.35)]',
                compact ? 'text-[10px]' : 'text-xs sm:text-sm',
              )}
            >
              {nombre}
            </span>
            <span className={cn('shrink-0 font-semibold uppercase tracking-[0.18em] text-white/60', compact ? 'text-[8px]' : 'text-[9px] sm:text-[10px]')}>
              Miembro desde {anio(memberSince)}
            </span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'relative w-full select-none overflow-hidden rounded-[22px] shadow-[0_18px_40px_-18px_rgba(0,0,0,.8)]',
        'aspect-[1.586/1]',
        className,
      )}
      style={{
        backgroundImage: `linear-gradient(135deg, ${tier.color_primary} 0%, ${tier.color_secondary} 100%)`,
        color: tier.text_color,
      }}
      aria-label={`Tarjeta ${tier.name}`}
      role="img"
    >
      {/* Barrido holográfico (sólo platinum) */}
      {esPlatinum && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          <div
            className="absolute left-1/2 top-1/2 size-[220%] -translate-x-1/2 -translate-y-1/2 animate-[spin_16s_linear_infinite] opacity-[0.14] mix-blend-screen"
            style={{
              backgroundImage:
                'conic-gradient(from 0deg, #ff8a8a, #ffd28a, #d8ff8a, #8affd0, #8ac6ff, #c58aff, #ff8ae6, #ff8a8a)',
            }}
          />
        </div>
      )}

      {/* Banda de brillo diagonal */}
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{ backgroundImage: 'linear-gradient(115deg, rgba(255,255,255,0) 32%, rgba(255,255,255,0.16) 50%, rgba(255,255,255,0) 68%)' }}
      />
      {/* Vignette abajo a la derecha */}
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{ backgroundImage: 'radial-gradient(120% 90% at 100% 100%, rgba(0,0,0,0.38) 0%, rgba(0,0,0,0) 55%)' }}
      />
      {/* Borde interno sutil */}
      <div className="pointer-events-none absolute inset-0 rounded-[22px] ring-1 ring-inset ring-white/15" aria-hidden />

      <div className={cn('relative flex h-full flex-col justify-between', compact ? 'p-4' : 'p-5 sm:p-6')}>
        {/* Arriba: wordmark + etiqueta de categoría */}
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2.5">
            <span className={cn('block font-black tracking-[0.35em]', compact ? 'text-[11px]' : 'text-[13px] sm:text-sm')}>
              MONACO
            </span>
            {/* Chip EMV */}
            <div
              className={cn('relative overflow-hidden rounded-[6px] border border-black/25 shadow-[inset_0_1px_0_rgba(255,255,255,.45)]', compact ? 'h-[22px] w-[29px]' : 'h-[26px] w-[34px]')}
              style={{ backgroundImage: 'linear-gradient(135deg, #E8C46A 0%, #B8892B 100%)' }}
              aria-hidden
            >
              <div className="absolute inset-x-0 top-1/3 h-px bg-black/25" />
              <div className="absolute inset-x-0 top-2/3 h-px bg-black/25" />
              <div className="absolute inset-y-0 left-1/3 w-px bg-black/25" />
              <div className="absolute inset-y-0 left-2/3 w-px bg-black/25" />
              <div className="absolute left-1/3 top-1/3 h-1/3 w-1/3 rounded-[2px] border border-black/25" />
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full" style={{ backgroundColor: tier.text_color }} aria-hidden />
            <span className={cn('font-semibold uppercase tracking-[0.22em] opacity-90', compact ? 'text-[9px]' : 'text-[10px] sm:text-[11px]')}>
              Cliente {tier.name}
            </span>
          </div>
        </div>

        {/* Centro: puntos */}
        <div className="leading-none">
          <span className={cn('block font-black tabular-nums tracking-tight', compact ? 'text-[26px]' : 'text-[38px] sm:text-[44px]')}>
            {points.toLocaleString('es-AR')}
          </span>
          <span className={cn('mt-1 block font-semibold uppercase tracking-[0.28em] opacity-80', compact ? 'text-[8px]' : 'text-[10px]')}>
            Puntos
          </span>
        </div>

        {/* Abajo: nombre embossed + miembro desde */}
        <div className="flex items-end justify-between gap-3">
          <span
            className={cn(
              'truncate font-bold uppercase tracking-[0.12em]',
              '[text-shadow:0_1px_0_rgba(255,255,255,.25),0_-1px_0_rgba(0,0,0,.35)]',
              compact ? 'text-[10px]' : 'text-xs sm:text-sm',
            )}
          >
            {nombre}
          </span>
          <span className={cn('shrink-0 font-semibold uppercase tracking-[0.18em] opacity-80', compact ? 'text-[8px]' : 'text-[9px] sm:text-[10px]')}>
            Miembro desde {anio(memberSince)}
          </span>
        </div>
      </div>
    </div>
  )
}
