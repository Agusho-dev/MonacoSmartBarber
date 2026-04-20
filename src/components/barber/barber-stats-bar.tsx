'use client'

import { useEffect, useState } from 'react'
import { Scissors, Sparkles, Timer, TrendingUp } from 'lucide-react'
import { formatCurrency } from '@/lib/format'
import { cn } from '@/lib/utils'

interface BarberStatsBarProps {
  servicesCount: number
  revenue: number
  /** Duración promedio de corte en minutos (opcional). */
  avgMinutes?: number | null
  /** Ranking del barbero (ej. "1 de 4"). Opcional. */
  ranking?: { position: number; total: number } | null
  className?: string
}

/**
 * Mini-barra de KPIs del día visible en el header del panel.
 * Efecto "count-up" suave al montar para dar sensación premium.
 */
export function BarberStatsBar({
  servicesCount,
  revenue,
  avgMinutes,
  ranking,
  className,
}: BarberStatsBarProps) {
  const cuts = useCountUp(servicesCount, 500)
  const money = useCountUp(revenue, 650)

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12px] font-semibold',
        className,
      )}
      aria-label="Tu día en números"
    >
      <StatChip icon={Scissors} label="Cortes">
        <span className="tabular-nums">{Math.round(cuts)}</span>
      </StatChip>
      <StatChip icon={Sparkles} label="Facturado">
        <span className="tabular-nums">{formatCurrency(Math.round(money))}</span>
      </StatChip>
      {avgMinutes != null && avgMinutes > 0 && (
        <StatChip icon={Timer} label="Prom">
          <span className="tabular-nums">{Math.round(avgMinutes)} min</span>
        </StatChip>
      )}
      {ranking && ranking.total > 1 && (
        <StatChip icon={TrendingUp} label="Ranking" highlight={ranking.position === 1}>
          <span className="tabular-nums">#{ranking.position} de {ranking.total}</span>
        </StatChip>
      )}
    </div>
  )
}

function StatChip({
  icon: Icon,
  label,
  children,
  highlight,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  children: React.ReactNode
  highlight?: boolean
}) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5',
        highlight && 'text-amber-600 dark:text-amber-400',
      )}
    >
      <Icon className="size-3.5 opacity-60" aria-hidden />
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-black">{children}</span>
    </div>
  )
}

/** Hook count-up simple con requestAnimationFrame. Re-anima al cambiar target. */
function useCountUp(target: number, durationMs: number): number {
  const [value, setValue] = useState(target)
  useEffect(() => {
    // Si el target es 0 o no cambió, no animamos.
    if (!Number.isFinite(target)) {
      setValue(0)
      return
    }
    const start = value
    const delta = target - start
    if (delta === 0) return
    const t0 = performance.now()
    let rafId = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / durationMs)
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(start + delta * eased)
      if (t < 1) rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
    // Intencionalmente sin `value` en deps: sólo re-animamos al cambiar el target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs])
  return value
}
