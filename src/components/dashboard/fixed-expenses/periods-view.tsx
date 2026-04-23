'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { ChevronLeft, ChevronRight, Filter, Receipt, RefreshCw, CheckCircle2, Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import type { Branch, FixedExpense, FixedExpensePeriod } from '@/lib/types/database'
import {
    getFixedExpensePeriods,
    getFixedExpensePeriodsSummary,
    type PeriodSummary,
} from '@/lib/actions/fixed-expenses'
import { useBranchStore } from '@/stores/branch-store'
import { KpiSummary } from './kpi-summary'
import { PeriodCard } from './period-card'
import { GeneratePeriodsButton } from './generate-periods-button'
import { cn } from '@/lib/utils'

const ALL_BRANCHES_VALUE = '__all__'

interface PaymentAccountOption {
    id: string
    name: string
    branch_id: string | null
}

interface PeriodsViewProps {
    initialYear: number
    initialMonth: number
    initialPeriods: FixedExpensePeriod[]
    initialSummary: PeriodSummary
    todayLocal: string
    branches: Branch[]
    paymentAccounts: PaymentAccountOption[]
    catalog: FixedExpense[]
    selectedBranchId: string | null
    canManage: boolean
}

const MONTH_NAMES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

type StatusFilter = 'all' | 'pending' | 'paid' | 'cancelled'

function addMonth(year: number, month: number, delta: number): [number, number] {
    let y = year
    let m = month + delta
    while (m > 12) { m -= 12; y += 1 }
    while (m < 1) { m += 12; y -= 1 }
    return [y, m]
}

export function PeriodsView({
    initialYear,
    initialMonth,
    initialPeriods,
    initialSummary,
    todayLocal,
    branches,
    paymentAccounts,
    catalog,
    selectedBranchId,
    canManage,
}: PeriodsViewProps) {
    const { setSelectedBranchId, allowedBranchIds } = useBranchStore()
    const canFilterBranches = allowedBranchIds === null
    const visibleBranches = canFilterBranches
        ? branches
        : branches.filter((b) => allowedBranchIds?.includes(b.id))

    const [year, setYear] = useState(initialYear)
    const [month, setMonth] = useState(initialMonth)
    const [periods, setPeriods] = useState(initialPeriods)
    const [summary, setSummary] = useState(initialSummary)
    const [status, setStatus] = useState<StatusFilter>('all')
    const [category, setCategory] = useState<string>('all')
    const [isPending, startTransition] = useTransition()

    // Re-fetch cuando cambian año/mes/branch
    useEffect(() => {
        startTransition(async () => {
            const [fresh, freshSummary] = await Promise.all([
                getFixedExpensePeriods({
                    year,
                    month,
                    branchId: selectedBranchId,
                    status: 'all',
                }),
                getFixedExpensePeriodsSummary(year, month, selectedBranchId),
            ])
            setPeriods(fresh)
            setSummary(freshSummary)
        })
    }, [year, month, selectedBranchId])

    // Filtros client-side sobre el dataset del mes (status y categoría)
    const filtered = useMemo(() => {
        return periods.filter((p) => {
            if (status !== 'all' && p.status !== status) return false
            if (category !== 'all' && p.snapshot_category !== category) return false
            return true
        }).sort((a, b) => {
            // Pendientes primero, luego pagados, luego cancelados
            const weight = (p: FixedExpensePeriod) => p.status === 'pending' ? 0 : p.status === 'paid' ? 1 : 2
            const w = weight(a) - weight(b)
            if (w !== 0) return w
            if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date)
            if (a.due_date) return -1
            if (b.due_date) return 1
            return a.snapshot_name.localeCompare(b.snapshot_name)
        })
    }, [periods, status, category])

    const categories = useMemo(() => {
        const set = new Set<string>()
        for (const p of periods) {
            if (p.snapshot_category) set.add(p.snapshot_category)
        }
        return [...set].sort()
    }, [periods])

    const budgetByExpense = useMemo(() => {
        const map = new Map<string, number>()
        for (const c of catalog) {
            map.set(c.id, Number(c.amount) || 0)
        }
        return map
    }, [catalog])

    const branchNameById = useMemo(() => {
        const map = new Map<string, string>()
        for (const b of branches) map.set(b.id, b.name)
        return map
    }, [branches])

    const filteredAccounts = useMemo(() => {
        return paymentAccounts.map((a) => ({ id: a.id, name: a.name }))
    }, [paymentAccounts])

    const activeCatalogCount = catalog.filter((c) => c.is_active && (
        !selectedBranchId || c.branch_id === selectedBranchId || c.branch_id === null
    )).length
    const hasMissingPeriods = activeCatalogCount > summary.countTotal
    const allPaid = summary.countTotal > 0 && summary.countPaid === summary.countTotal

    const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`
    const isCurrentMonth = year === initialYear && month === initialMonth

    return (
        <div className="space-y-4 lg:space-y-5">
            {/* ── Header con navegación de mes ── */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="icon-sm"
                        onClick={() => {
                            const [ny, nm] = addMonth(year, month, -1)
                            setYear(ny); setMonth(nm)
                        }}
                        aria-label="Mes anterior"
                    >
                        <ChevronLeft className="size-4" />
                    </Button>
                    <div className="min-w-[180px] text-center">
                        <div className="text-sm lg:text-base font-bold tracking-tight capitalize">
                            {monthLabel}
                        </div>
                        {!isCurrentMonth && (
                            <button
                                onClick={() => { setYear(initialYear); setMonth(initialMonth) }}
                                className="text-[10px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                            >
                                Volver al mes actual
                            </button>
                        )}
                    </div>
                    <Button
                        variant="outline"
                        size="icon-sm"
                        onClick={() => {
                            const [ny, nm] = addMonth(year, month, 1)
                            setYear(ny); setMonth(nm)
                        }}
                        aria-label="Mes siguiente"
                    >
                        <ChevronRight className="size-4" />
                    </Button>
                </div>

                {canManage && hasMissingPeriods && (
                    <GeneratePeriodsButton
                        year={year}
                        month={month}
                        variant="primary"
                    />
                )}
            </div>

            {/* ── KPIs ── */}
            <KpiSummary summary={summary} />

            {/* ── Banner "todo al día" ── */}
            {allPaid && (
                <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
                    <div className="flex size-9 items-center justify-center rounded-full bg-emerald-500/20">
                        <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div className="min-w-0">
                        <div className="text-sm font-bold">Todo al día</div>
                        <div className="text-[11px] text-muted-foreground">
                            Los {summary.countPaid} gastos fijos del mes ya fueron pagados. Buen trabajo.
                        </div>
                    </div>
                </div>
            )}

            {/* ── Filtros ── */}
            {periods.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                        <Filter className="size-3.5" />
                        Filtrar:
                    </div>
                    <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
                        <SelectTrigger className="h-8 w-[160px] text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todos los estados</SelectItem>
                            <SelectItem value="pending">Solo pendientes</SelectItem>
                            <SelectItem value="paid">Solo pagados</SelectItem>
                            <SelectItem value="cancelled">Cancelados</SelectItem>
                        </SelectContent>
                    </Select>

                    {canFilterBranches && visibleBranches.length > 1 && (
                        <Select
                            value={selectedBranchId ?? ALL_BRANCHES_VALUE}
                            onValueChange={(v) =>
                                setSelectedBranchId(v === ALL_BRANCHES_VALUE ? null : v)
                            }
                        >
                            <SelectTrigger className="h-8 w-[200px] text-xs">
                                <span className="flex items-center gap-1.5 min-w-0">
                                    <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
                                    <SelectValue />
                                </span>
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ALL_BRANCHES_VALUE}>Todas las sucursales</SelectItem>
                                {visibleBranches.map((b) => (
                                    <SelectItem key={b.id} value={b.id}>
                                        {b.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}

                    {categories.length > 0 && (
                        <Select value={category} onValueChange={setCategory}>
                            <SelectTrigger className="h-8 w-[180px] text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todas las categorías</SelectItem>
                                {categories.map((c) => (
                                    <SelectItem key={c} value={c}>
                                        {c}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}

                    {(status !== 'all' || category !== 'all') && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { setStatus('all'); setCategory('all') }}
                            className="h-8 text-xs"
                        >
                            Limpiar
                        </Button>
                    )}

                    <Badge variant="outline" className="ml-auto text-xs">
                        {filtered.length} / {periods.length}
                    </Badge>

                    {isPending && (
                        <RefreshCw className="size-3.5 animate-spin text-muted-foreground" />
                    )}
                </div>
            )}

            {/* ── Lista de periods ── */}
            {periods.length === 0 ? (
                <div className="rounded-xl border border-dashed bg-muted/20 py-12 px-4 text-center">
                    <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted mb-3">
                        <Receipt className="size-6 text-muted-foreground" />
                    </div>
                    <h4 className="font-semibold text-sm">
                        No hay pagos generados para {monthLabel.toLowerCase()}
                    </h4>
                    <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                        {activeCatalogCount === 0
                            ? 'Primero cargá tus gastos fijos en el catálogo.'
                            : 'Los pagos se generan automáticamente el día 1 de cada mes. Podés generarlos manualmente ahora.'}
                    </p>
                    {activeCatalogCount > 0 && canManage && (
                        <div className="mt-4">
                            <GeneratePeriodsButton year={year} month={month} variant="primary" size="default" />
                        </div>
                    )}
                </div>
            ) : filtered.length === 0 ? (
                <div className="rounded-xl border border-dashed bg-muted/20 py-10 px-4 text-center">
                    <p className="text-sm text-muted-foreground">
                        Ningún pago coincide con estos filtros
                    </p>
                </div>
            ) : (
                <div className={cn(
                    'grid gap-3',
                    'lg:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3',
                    isPending && 'opacity-60 pointer-events-none transition-opacity',
                )}>
                    {filtered.map((period) => (
                        <PeriodCard
                            key={period.id}
                            period={period}
                            paymentAccounts={filteredAccounts}
                            todayLocal={todayLocal}
                            budgetAmount={budgetByExpense.get(period.fixed_expense_id)}
                            branchName={period.branch_id ? branchNameById.get(period.branch_id) : null}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}
