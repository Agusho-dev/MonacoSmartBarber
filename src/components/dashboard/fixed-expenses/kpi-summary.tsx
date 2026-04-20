'use client'

import { AlertTriangle, CheckCircle2, CircleDollarSign, Clock } from 'lucide-react'
import { formatCurrency } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { PeriodSummary } from '@/lib/actions/fixed-expenses'

interface KpiSummaryProps {
    summary: PeriodSummary
    className?: string
}

interface KpiCardProps {
    label: string
    value: string
    hint?: string
    icon: React.ComponentType<{ className?: string }>
    tone: 'neutral' | 'success' | 'warning' | 'danger'
}

function KpiCard({ label, value, hint, icon: Icon, tone }: KpiCardProps) {
    const toneClass = {
        neutral: 'text-muted-foreground',
        success: 'text-emerald-500',
        warning: 'text-amber-500',
        danger: 'text-red-500',
    }[tone]

    const bgTone = {
        neutral: 'bg-muted/40',
        success: 'bg-emerald-500/10',
        warning: 'bg-amber-500/10',
        danger: 'bg-red-500/10',
    }[tone]

    return (
        <div className="rounded-xl border bg-card p-3 lg:p-4 transition-all hover:shadow-sm">
            <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground truncate">
                    {label}
                </span>
                <div className={cn('flex size-7 shrink-0 items-center justify-center rounded-md', bgTone)}>
                    <Icon className={cn('size-3.5', toneClass)} />
                </div>
            </div>
            <div className="mt-1.5 text-xl lg:text-2xl font-bold tabular-nums tracking-tight">
                {value}
            </div>
            {hint && (
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {hint}
                </div>
            )}
        </div>
    )
}

export function KpiSummary({ summary, className }: KpiSummaryProps) {
    const total = summary.totalPaid + summary.totalPending
    return (
        <div className={cn(
            'grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4',
            className,
        )}>
            <KpiCard
                label="Total del mes"
                value={formatCurrency(total)}
                hint={`${summary.countTotal} gasto${summary.countTotal === 1 ? '' : 's'}`}
                icon={CircleDollarSign}
                tone="neutral"
            />
            <KpiCard
                label="Pagado"
                value={formatCurrency(summary.totalPaid)}
                hint={`${summary.countPaid} de ${summary.countTotal}`}
                icon={CheckCircle2}
                tone="success"
            />
            <KpiCard
                label="Pendiente"
                value={formatCurrency(summary.totalPending)}
                hint={summary.countPending === 0 ? 'Todo al día' : `${summary.countPending} sin pagar`}
                icon={Clock}
                tone={summary.countPending === 0 ? 'success' : 'warning'}
            />
            <KpiCard
                label="Vencido"
                value={formatCurrency(summary.totalOverdue)}
                hint={summary.countOverdue === 0 ? 'Sin atrasos' : `${summary.countOverdue} vencido${summary.countOverdue === 1 ? '' : 's'}`}
                icon={AlertTriangle}
                tone={summary.countOverdue === 0 ? 'success' : 'danger'}
            />
        </div>
    )
}
