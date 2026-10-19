'use client'

import { History, Banknote, CreditCard, ArrowRightLeft } from 'lucide-react'
import { EncabezadoPantalla } from '@/components/barber/encabezado-pantalla'
import { formatCurrency } from '@/lib/format'

interface HistoryData {
    visits: {
        id: string
        amount: number
        payment_method: string
        commission_amount: number
        started_at: string
        completed_at: string
        service: { name: string } | null
        client: { name: string } | null
    }[]
}

interface HistorialClientProps {
    session: { staff_id: string; full_name: string; branch_id: string; role: string }
    history: HistoryData
}

const PAYMENT_ICONS: Record<string, React.ElementType> = {
    cash: Banknote,
    card: CreditCard,
    transfer: ArrowRightLeft,
}

const PAYMENT_LABELS: Record<string, string> = {
    cash: 'Efectivo',
    card: 'Tarjeta',
    transfer: 'Transferencia',
}

function formatTime(iso: string) {
    return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

function getDurationMinutes(startIso: string, endIso: string): number {
    return Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000)
}

function formatDuration(minutes: number): string {
    if (minutes < 60) return `${minutes} min`
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return m > 0 ? `${h} h ${m} min` : `${h} h`
}

/**
 * El libro de marcas: cada corte del mes como un renglón (hora de cierre,
 * cliente y servicio, cuánto duró y cómo se cobró), agrupado por día.
 */
export function HistorialClient({ session, history }: HistorialClientProps) {
    const grouped = new Map<string, typeof history.visits>()
    for (const v of history.visits) {
        const dateKey = new Date(v.completed_at).toLocaleDateString('es-AR', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
        })
        if (!grouped.has(dateKey)) grouped.set(dateKey, [])
        grouped.get(dateKey)!.push(v)
    }

    return (
        <div>
            <EncabezadoPantalla titulo="Mi historial" detalle={`${session.full_name} · últimos servicios`} />

            <div className="px-4 py-5 sm:px-6 sm:py-6">
                <div className="mx-auto max-w-3xl space-y-6">
                    {history.visits.length === 0 ? (
                        <div className="rounded-[1.25rem] border-2 border-dashed border-foreground/15 px-6 py-12 text-center">
                            <History className="mx-auto size-9 text-muted-foreground/60" aria-hidden />
                            <p className="mt-3 text-lg font-semibold">Todavía no hay servicios este mes</p>
                            <p className="mt-1 text-[0.9375rem] text-muted-foreground">Cada corte que cobres aparece acá.</p>
                        </div>
                    ) : (
                        [...grouped.entries()].map(([dateLabel, visits]) => (
                            <section key={dateLabel} aria-label={dateLabel} className="space-y-2.5">
                                <div className="flex items-baseline justify-between gap-3">
                                    <h2 className="text-[1.0625rem] font-semibold first-letter:uppercase">{dateLabel}</h2>
                                    <span className="font-mono text-[0.9375rem] font-semibold tabular-nums text-muted-foreground">
                                        {visits.length} {visits.length === 1 ? 'corte' : 'cortes'}
                                    </span>
                                </div>
                                <ol className="overflow-hidden rounded-[1.25rem] border border-border/80 bg-card">
                                    {visits.map((v) => {
                                        const Icon = PAYMENT_ICONS[v.payment_method] ?? Banknote
                                        const duration =
                                            v.started_at && v.completed_at
                                                ? getDurationMinutes(v.started_at, v.completed_at)
                                                : null
                                        return (
                                            <li
                                                key={v.id}
                                                className="flex items-center gap-4 border-b border-border/60 px-4 py-3.5 last:border-b-0 sm:px-5"
                                            >
                                                <span className="w-12 shrink-0 font-mono text-[0.9375rem] font-semibold tabular-nums">
                                                    {formatTime(v.completed_at)}
                                                </span>
                                                <div className="min-w-0 flex-1">
                                                    <p className="truncate text-base font-semibold">{v.client?.name ?? 'Cliente'}</p>
                                                    <p className="truncate text-sm text-muted-foreground">
                                                        {v.service?.name ?? 'Servicio'}
                                                        {duration !== null && duration > 0 && (
                                                            <>
                                                                {' · '}
                                                                {formatDuration(duration)}
                                                            </>
                                                        )}
                                                    </p>
                                                </div>
                                                <div className="shrink-0 text-right">
                                                    <p className="font-mono text-base font-semibold tabular-nums">{formatCurrency(v.amount)}</p>
                                                    <p className="mt-0.5 flex items-center justify-end gap-1 text-[0.8125rem] text-muted-foreground">
                                                        <Icon className="size-3.5" aria-hidden />
                                                        {PAYMENT_LABELS[v.payment_method] ?? v.payment_method}
                                                    </p>
                                                </div>
                                            </li>
                                        )
                                    })}
                                </ol>
                            </section>
                        ))
                    )}
                </div>
            </div>
        </div>
    )
}
