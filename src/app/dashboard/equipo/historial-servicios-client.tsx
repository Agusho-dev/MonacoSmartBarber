'use client'

import { useState, useMemo, useSyncExternalStore } from 'react'
import { Clock, Banknote, CreditCard, ArrowRightLeft, Search } from 'lucide-react'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'

import { useBranchStore } from '@/stores/branch-store'

interface ServiceVisit {
    id: string
    amount: number
    payment_method: string
    commission_amount: number
    started_at: string | null
    completed_at: string
    branch_id: string
    service: { name: string } | null
    client: { name: string } | null
    barber: { id: string; full_name: string } | null
}

interface HistorialServiciosClientProps {
    visits: ServiceVisit[]
    barbers: { id: string; full_name: string; branch_id: string }[]
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

function formatTime(iso: string) {
    return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

function getDurationMinutes(startIso: string, endIso: string): number {
    return Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000)
}

function formatDuration(minutes: number): string {
    if (minutes < 60) return `${minutes}min`
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return m > 0 ? `${h}h ${m}min` : `${h}h`
}

// SSR-safe mounted detector — evita setState-in-effect.
const subscribeNoop = () => () => {}

export function HistorialServiciosClient({
    visits,
    barbers,
}: HistorialServiciosClientProps) {
    const { selectedBranchId } = useBranchStore()
    const [selectedBarberId, setSelectedBarberId] = useState<string>('all')
    const [searchQuery, setSearchQuery] = useState('')
    const isMounted = useSyncExternalStore(
        subscribeNoop,
        () => true,
        () => false,
    )

    const filtered = useMemo(() => {
        // Return unfiltered on server/first-render to match SSR
        if (!isMounted) return visits

        let result = selectedBranchId ? visits.filter((v) => v.branch_id === selectedBranchId) : visits

        if (selectedBarberId !== 'all') {
            result = result.filter((v) => v.barber?.id === selectedBarberId)
        }
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase()
            result = result.filter(
                (v) =>
                    v.client?.name?.toLowerCase().includes(q) ||
                    v.service?.name?.toLowerCase().includes(q) ||
                    v.barber?.full_name?.toLowerCase().includes(q)
            )
        }
        return result
    }, [visits, selectedBarberId, searchQuery, isMounted, selectedBranchId])

    const grouped = useMemo(() => {
        const map = new Map<string, ServiceVisit[]>()
        for (const v of filtered) {
            const dateKey = new Date(v.completed_at).toLocaleDateString('es-AR', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
            })
            if (!map.has(dateKey)) map.set(dateKey, [])
            map.get(dateKey)!.push(v)
        }
        return map
    }, [filtered])

    const totalRevenue = filtered.reduce((s, v) => s + Number(v.amount), 0)
    const avgDuration = useMemo(() => {
        const durations = filtered
            .filter((v) => v.started_at && v.completed_at)
            .map((v) => getDurationMinutes(v.started_at!, v.completed_at))
            .filter((d) => d > 0 && d < 300)
        if (durations.length === 0) return 0
        return Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    }, [filtered])

    return (
        <div className="space-y-4">
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3">
                <Select value={selectedBarberId} onValueChange={setSelectedBarberId}>
                    <SelectTrigger className="w-[200px]">
                        <SelectValue placeholder="Filtrar barbero" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Todos los barberos</SelectItem>
                        {barbers
                            .filter((b) => !selectedBranchId || b.branch_id === selectedBranchId)
                            .map((b) => (
                            <SelectItem key={b.id} value={b.id}>{b.full_name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input
                        placeholder="Buscar por cliente, servicio o barbero..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9"
                    />
                </div>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border bg-card p-3 text-center">
                    <p className="text-2xl font-bold tabular-nums">{filtered.length}</p>
                    <p className="text-xs text-muted-foreground">Servicios</p>
                </div>
                <div className="rounded-lg border bg-card p-3 text-center">
                    <p className="text-2xl font-bold tabular-nums">{formatCurrency(totalRevenue)}</p>
                    <p className="text-xs text-muted-foreground">Ingresos</p>
                </div>
                <div className="rounded-lg border bg-card p-3 text-center">
                    <p className="text-2xl font-bold tabular-nums">{avgDuration > 0 ? formatDuration(avgDuration) : '—'}</p>
                    <p className="text-xs text-muted-foreground">Duración promedio</p>
                </div>
            </div>

            {/* Visit list */}
            <div className="space-y-4">
                {filtered.length === 0 ? (
                    <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
                        <Clock className="size-10 mx-auto mb-3 opacity-30" />
                        <p>No se encontraron servicios con los filtros seleccionados.</p>
                    </div>
                ) : (
                    [...grouped.entries()].map(([dateLabel, dayVisits]) => (
                        <div key={dateLabel}>
                            <h3 className="mb-2 text-xs font-semibold text-muted-foreground tracking-wider capitalize">
                                {dateLabel}
                            </h3>
                            <div className="space-y-2">
                                {dayVisits.map((v) => {
                                    const Icon = PAYMENT_ICONS[v.payment_method] ?? Banknote
                                    const duration =
                                        v.started_at && v.completed_at
                                            ? getDurationMinutes(v.started_at, v.completed_at)
                                            : null
                                    return (
                                        <div key={v.id} className="rounded-xl border bg-card px-4 py-3">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-medium text-sm truncate">
                                                        {v.client?.name ?? 'Cliente'}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {v.service?.name ?? 'Servicio'}
                                                        {' · '}
                                                        <span className="font-medium text-foreground/70">
                                                            {v.barber?.full_name ?? 'Barbero'}
                                                        </span>
                                                    </p>
                                                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                                                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                                            <Icon className="size-3" />
                                                            {PAYMENT_LABELS[v.payment_method] ?? v.payment_method}
                                                        </span>
                                                        {v.started_at && (
                                                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                                                <Clock className="size-3" />
                                                                {formatTime(v.started_at)} – {formatTime(v.completed_at)}
                                                            </span>
                                                        )}
                                                        {duration !== null && duration > 0 && (
                                                            <span className="text-xs font-medium text-primary/80">
                                                                Duración: {formatDuration(duration)}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="text-right shrink-0">
                                                    <p className="font-semibold tabular-nums">{formatCurrency(v.amount)}</p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {formatTime(v.completed_at)}
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
