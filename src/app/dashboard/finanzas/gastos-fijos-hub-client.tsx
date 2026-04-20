'use client'

import { useState, useEffect } from 'react'
import { Receipt, List } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useBranchStore } from '@/stores/branch-store'
import type { Branch, FixedExpense, FixedExpensePeriod } from '@/lib/types/database'
import type { PeriodSummary } from '@/lib/actions/fixed-expenses'
import { PeriodsView } from '@/components/dashboard/fixed-expenses/periods-view'
import { CatalogView } from '@/components/dashboard/fixed-expenses/catalog-view'

interface PaymentAccountOption {
    id: string
    name: string
    branch_id: string | null
}

interface GastosFijosHubClientProps {
    fixedExpenses: FixedExpense[]
    periods: FixedExpensePeriod[]
    summary: PeriodSummary
    currentYear: number
    currentMonth: number
    todayLocal: string
    branches: Branch[]
    paymentAccounts: PaymentAccountOption[]
    canManage: boolean
}

type SubTab = 'pagos' | 'catalogo'

const SUB_TABS: { id: SubTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'pagos', label: 'Pagos del mes', icon: Receipt },
    { id: 'catalogo', label: 'Catálogo', icon: List },
]

export function GastosFijosHubClient({
    fixedExpenses,
    periods,
    summary,
    currentYear,
    currentMonth,
    todayLocal,
    branches,
    paymentAccounts,
    canManage,
}: GastosFijosHubClientProps) {
    const { selectedBranchId } = useBranchStore()
    const [sub, setSub] = useState<SubTab>('pagos')

    // Persistir sub-tab en localStorage para que sobreviva al cambio de tab padre
    useEffect(() => {
        const saved = localStorage.getItem('gastos-fijos:sub') as SubTab | null
        if (saved && SUB_TABS.some((t) => t.id === saved)) setSub(saved)
    }, [])

    function switchSub(s: SubTab) {
        setSub(s)
        try {
            localStorage.setItem('gastos-fijos:sub', s)
        } catch { /* storage not available */ }
    }

    const counts = {
        pagos: summary.countTotal,
        catalogo: fixedExpenses.length,
    }

    return (
        <div className="space-y-4">
            {/* Sub-tabs pill nav */}
            <div className="flex gap-1 rounded-lg border bg-muted/40 p-1 w-fit">
                {SUB_TABS.map((tab) => {
                    const Icon = tab.icon
                    const active = sub === tab.id
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => switchSub(tab.id)}
                            className={cn(
                                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs sm:text-sm font-medium transition-all',
                                active
                                    ? 'bg-background text-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground',
                            )}
                        >
                            <Icon className="size-3.5" />
                            {tab.label}
                            {counts[tab.id] > 0 && (
                                <span className={cn(
                                    'ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
                                    active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
                                )}>
                                    {counts[tab.id]}
                                </span>
                            )}
                        </button>
                    )
                })}
            </div>

            {/* Contenido */}
            <div>
                {sub === 'pagos' && (
                    <PeriodsView
                        initialYear={currentYear}
                        initialMonth={currentMonth}
                        initialPeriods={periods}
                        initialSummary={summary}
                        todayLocal={todayLocal}
                        branches={branches}
                        paymentAccounts={paymentAccounts}
                        catalog={fixedExpenses}
                        selectedBranchId={selectedBranchId}
                        canManage={canManage}
                    />
                )}
                {sub === 'catalogo' && (
                    <CatalogView
                        fixedExpenses={fixedExpenses}
                        branches={branches}
                        canManage={canManage}
                        selectedBranchId={selectedBranchId}
                    />
                )}
            </div>
        </div>
    )
}
