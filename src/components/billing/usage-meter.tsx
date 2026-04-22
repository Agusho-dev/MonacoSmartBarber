import { cn } from '@/lib/utils'

type Props = {
  label: string
  current: number
  limit: number      // -1 = ilimitado
  className?: string
}

export function UsageMeter({ label, current, limit, className }: Props) {
  const unlimited = limit === -1
  const pct = unlimited ? 0 : Math.min(100, Math.round((current / Math.max(limit, 1)) * 100))
  const danger = !unlimited && pct >= 90
  const warn = !unlimited && pct >= 70 && !danger

  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">
          {current}
          {unlimited ? (
            <span className="text-muted-foreground"> / ∞</span>
          ) : (
            <span className="text-muted-foreground"> / {limit}</span>
          )}
        </span>
      </div>
      {!unlimited && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full transition-all',
              danger ? 'bg-destructive' : warn ? 'bg-amber-500' : 'bg-primary',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  )
}
