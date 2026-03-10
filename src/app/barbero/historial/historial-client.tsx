'use client'

import { History, Banknote, CreditCard, ArrowRightLeft } from 'lucide-react'

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

function formatCurrency(n: number) {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
}

export function HistorialClient({ session, history }: HistorialClientProps) {
    // Group by date
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
        <div className="min-h-dvh bg-background">
            <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
                <div className="px-4 py-3">
                    <h1 className="font-semibold text-lg">Mi Historial</h1>
                    <p className="text-xs text-muted-foreground">
                        {session.full_name} · Últimos servicios
                    </p>
                </div>
            </div>

            <div className="space-y-4 p-4">
                {history.visits.length === 0 ? (
                    <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
                        <History className="size-10 mx-auto mb-3 opacity-30" />
                        <p>Todavía no hay servicios este mes.</p>
                    </div>
                ) : (
                    [...grouped.entries()].map(([dateLabel, visits]) => (
                        <div key={dateLabel}>
                            <h2 className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider capitalize">
                                {dateLabel}
                            </h2>
                            <div className="space-y-2">
                                {visits.map((v) => {
                                    const Icon = PAYMENT_ICONS[v.payment_method] ?? Banknote
                                    return (
                                        <div key={v.id} className="rounded-xl border bg-card px-4 py-3">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-medium text-sm truncate">
                                                        {v.client?.name ?? 'Cliente'}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {v.service?.name ?? 'Servicio'}
                                                    </p>
                                                    <div className="mt-1.5 flex items-center gap-1.5">
                                                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                                            <Icon className="size-3" />
                                                            {PAYMENT_LABELS[v.payment_method] ?? v.payment_method}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="text-right shrink-0">
                                                    <p className="font-semibold tabular-nums">{formatCurrency(v.amount)}</p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {new Date(v.completed_at).toLocaleTimeString('es-AR', {
                                                            hour: '2-digit',
                                                            minute: '2-digit',
                                                        })}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    )
}
