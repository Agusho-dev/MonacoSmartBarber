import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

type Accent = 'emerald' | 'indigo' | 'amber' | 'rose' | 'zinc'

const ACCENT_STYLES: Record<Accent, { iconBg: string; iconFg: string; valueFg: string }> = {
  emerald: { iconBg: 'bg-emerald-500/10', iconFg: 'text-emerald-400', valueFg: 'text-zinc-100' },
  indigo:  { iconBg: 'bg-indigo-500/10', iconFg: 'text-indigo-400', valueFg: 'text-zinc-100' },
  amber:   { iconBg: 'bg-amber-500/10', iconFg: 'text-amber-400', valueFg: 'text-zinc-100' },
  rose:    { iconBg: 'bg-rose-500/10', iconFg: 'text-rose-400', valueFg: 'text-zinc-100' },
  zinc:    { iconBg: 'bg-zinc-800', iconFg: 'text-zinc-300', valueFg: 'text-zinc-100' },
}

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  accent = 'zinc',
}: {
  label: string
  value: string | number
  hint?: string
  icon?: LucideIcon
  accent?: Accent
}) {
  const styles = ACCENT_STYLES[accent]
  return (
    <div className="group relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 transition-colors hover:border-zinc-700">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-zinc-500">{label}</div>
          <div className={cn('mt-2 text-2xl font-semibold tracking-tight tabular-nums', styles.valueFg)}>
            {value}
          </div>
          {hint && <div className="mt-1 text-[11px] text-zinc-500">{hint}</div>}
        </div>
        {Icon && (
          <div className={cn('flex size-9 items-center justify-center rounded-lg', styles.iconBg)}>
            <Icon className={cn('size-4', styles.iconFg)} />
          </div>
        )}
      </div>
    </div>
  )
}
