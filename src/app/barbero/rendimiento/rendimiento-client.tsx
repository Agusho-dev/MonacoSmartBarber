'use client'

import { useState } from 'react'
import { TrendingUp, Scissors, Percent } from 'lucide-react'
import { cn } from '@/lib/utils'

const PERIODS = [
    { id: 'day', label: 'Hoy' },
    { id: 'week', label: 'Semana' },
    { id: 'month', label: 'Mes' },
] as const

type PeriodId = (typeof PERIODS)[number]['id']

interface Stats {
    cuts: number
    revenue: number
    commission: number
    avgTicket: number
}

interface RendimientoClientProps {
    session: { staff_id: string; full_name: string; branch_id: string; role: string }
    dayStats: Stats
    weekStats: Stats
    monthStats: Stats
}

function formatCurrency(n: number) {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
}

export function RendimientoClient({ session, dayStats, weekStats, monthStats }: RendimientoClientProps) {
    const [period, setPeriod] = useState<PeriodId>('day')

    const stats = period === 'day' ? dayStats : period === 'week' ? weekStats : monthStats

    const cards = [
        {
            label: 'Cortes',
            value: stats.cuts.toString(),
            icon: Scissors,
            color: 'text-blue-400',
            bg: 'bg-blue-500/10',
        },
        {
            label: 'Comisión',
            value: formatCurrency(stats.commission),
            icon: Percent,
            color: 'text-purple-400',
            bg: 'bg-purple-500/10',
        },
        {
            label: 'Ticket Promedio',
            value: formatCurrency(stats.avgTicket),
            icon: TrendingUp,
            color: 'text-amber-400',
            bg: 'bg-amber-500/10',
        },
    ]

    return (
        <div className="min-h-dvh bg-background">
            <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
                <div className="px-4 py-3">
                    <h1 className="font-semibold text-lg">Mi Rendimiento</h1>
                    <p className="text-xs text-muted-foreground">{session.full_name}</p>
                </div>
            </div>

            <div className="space-y-4 p-4">
                {/* Period selector */}
                <div className="flex gap-1 rounded-lg border bg-muted/50 p-1">
                    {PERIODS.map((p) => (
                        <button
                            key={p.id}
                            onClick={() => setPeriod(p.id)}
                            className={cn(
                                'flex-1 rounded-md px-3 py-2 text-sm font-medium transition-all',
                                period === p.id
                                    ? 'bg-background text-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground'
                            )}
                        >
                            {p.label}
                        </button>
                    ))}
                </div>

                {/* Stats cards */}
                <div className="grid grid-cols-2 gap-3">
                    {cards.map((card) => (
                        <div
                            key={card.label}
                            className="rounded-xl border bg-card p-4 space-y-2"
                        >
                            <div className="flex items-center gap-2">
                                <div className={cn('rounded-lg p-2', card.bg)}>
                                    <card.icon className={cn('size-4', card.color)} />
                                </div>
                                <span className="text-xs text-muted-foreground">{card.label}</span>
                            </div>
                            <p className="text-2xl font-bold tabular-nums">{card.value}</p>
                        </div>
                    ))}
                </div>

                {/* Highlight card */}
                {stats.cuts > 0 && (
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5">
                        <p className="text-sm text-emerald-300 font-medium">
                            {period === 'day' && `¡Llevas ${stats.cuts} ${stats.cuts === 1 ? 'corte' : 'cortes'} hoy!`}
                            {period === 'week' && `${stats.cuts} cortes esta semana`}
                            {period === 'month' && `${stats.cuts} cortes este mes`}
                        </p>
                        <p className="text-xs text-emerald-400/70 mt-1">
                            Comisión acumulada: {formatCurrency(stats.commission)}
                        </p>
                    </div>
                )}
            </div>
        </div>
    )
}
