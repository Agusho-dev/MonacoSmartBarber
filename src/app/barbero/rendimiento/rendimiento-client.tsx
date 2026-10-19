'use client'

import { useState } from 'react'
import { EncabezadoPantalla } from '@/components/barber/encabezado-pantalla'
import { cn } from '@/lib/utils'

// Sin "Mes": el barbero no tiene que poder ver cuántos cortes lleva en el mes
// (decisión del dueño, 19/oct/2026; ver fetchBarberGoals).
const PERIODS = [
    { id: 'day', label: 'Hoy' },
    { id: 'week', label: 'Semana' },
] as const

type PeriodId = (typeof PERIODS)[number]['id']

interface Stats {
    cuts: number
}

interface RendimientoClientProps {
    session: { staff_id: string; full_name: string; branch_id: string; role: string }
    dayStats: Stats
    weekStats: Stats
}

export function RendimientoClient({ session, dayStats, weekStats }: RendimientoClientProps) {
    const [period, setPeriod] = useState<PeriodId>('day')

    const stats = period === 'day' ? dayStats : weekStats

    return (
        <div>
            <EncabezadoPantalla titulo="Mi rendimiento" detalle={session.full_name} />

            <div className="px-4 py-5 sm:px-6 sm:py-6">
                <div className="mx-auto max-w-3xl space-y-5">
                    <div className="flex gap-1 rounded-2xl border border-border/80 bg-muted/60 p-1">
                        {PERIODS.map((p) => (
                            <button
                                key={p.id}
                                onClick={() => setPeriod(p.id)}
                                aria-pressed={period === p.id}
                                className={cn(
                                    'h-11 flex-1 rounded-xl px-3 text-[0.9375rem] font-semibold transition-colors',
                                    period === p.id
                                        ? 'bg-primary text-primary-foreground'
                                        : 'text-muted-foreground hover:text-foreground',
                                )}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>

                    <div className="rounded-[1.25rem] border border-border/80 bg-card px-6 py-8 text-center">
                        <p className="font-mono text-[4rem] font-semibold leading-none tabular-nums">{stats.cuts}</p>
                        <p className="mt-3 text-lg text-muted-foreground">
                            {stats.cuts === 1 ? 'corte' : 'cortes'}{' '}
                            {period === 'day' ? 'hoy' : 'esta semana'}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    )
}
