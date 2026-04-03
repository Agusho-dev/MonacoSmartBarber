'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { DollarSign, Wallet, Banknote, Receipt, Building2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FinanzasClient } from './finanzas-client'
import type { CommissionSummaryData } from './finanzas-client'
import { CuentasClient } from '../cuentas/cuentas-client'
import { SueldosClient } from '../sueldos/sueldos-client'
import { EgresosClient } from './egresos-client'
import { GastosFijosClient } from './gastos-fijos-client'

const TABS = [
    { id: 'resumen', label: 'Resumen', icon: DollarSign, permission: 'finances.view_summary' },
    { id: 'cuentas', label: 'Cuentas de cobro', icon: Wallet, permission: 'finances.view_accounts' },
    { id: 'sueldos', label: 'Sueldos', icon: Banknote, permission: 'salary.view' },
    { id: 'egresos', label: 'Egresos', icon: Receipt, permission: 'finances.view_expenses' },
    { id: 'gastos-fijos', label: 'Gastos fijos', icon: Building2, permission: 'finances.view_fixed' },
] as const

type TabId = (typeof TABS)[number]['id']

interface FinanzasTabsClientProps {
    initialData: Parameters<typeof FinanzasClient>[0]['initialData']
    branches: Parameters<typeof FinanzasClient>[0]['branches']
    accounts: Parameters<typeof CuentasClient>[0]['accounts']
    barbers: Parameters<typeof SueldosClient>[0]['barbers']
    expenseTickets: Parameters<typeof EgresosClient>[0]['expenseTickets']
    fixedExpenses: Parameters<typeof GastosFijosClient>[0]['fixedExpenses']
    commissionSummary: CommissionSummaryData
    permissions: Record<string, boolean>
}

export function FinanzasTabsClient({
    initialData,
    branches,
    accounts,
    barbers,
    expenseTickets,
    fixedExpenses,
    commissionSummary,
    permissions,
}: FinanzasTabsClientProps) {
    const searchParams = useSearchParams()

    const visibleTabs = TABS.filter(tab => permissions[tab.permission])
    const initialTabId = searchParams.get('tab') as TabId
    const firstAvailableTab = visibleTabs.length > 0 ? visibleTabs[0].id : null

    const defaultTab = visibleTabs.some(t => t.id === initialTabId)
        ? initialTabId
        : firstAvailableTab

    const [activeTab, setActiveTab] = useState<TabId | null>(defaultTab || null)

    // Force activeTab to be valid if permissions change or state is stale
    useEffect(() => {
        if (activeTab && visibleTabs.length > 0 && !visibleTabs.some(t => t.id === activeTab)) {
            setActiveTab(visibleTabs[0].id)
        } else if (!activeTab && visibleTabs.length > 0) {
            setActiveTab(visibleTabs[0].id)
        }
    }, [activeTab, visibleTabs])

    if (visibleTabs.length === 0) {
        return (
            <div className="flex h-[50vh] items-center justify-center">
                <p className="text-muted-foreground">No tienes acceso a ninguna sección de Finanzas.</p>
            </div>
        )
    }

    return (
        <div className="space-y-4 lg:space-y-6">
            <div>
                <h1 className="text-xl lg:text-2xl font-bold tracking-tight">Finanzas</h1>
                <p className="text-sm text-muted-foreground hidden sm:block">
                    Resumen financiero, cuentas de cobro y sueldos
                </p>
            </div>

            {/* Tab navigation — scrollable en mobile */}
            <div className="overflow-x-auto -mx-3 px-3 lg:mx-0 lg:px-0">
                <div className="flex gap-1 rounded-lg border bg-muted/50 p-1 w-fit">
                    {visibleTabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={cn(
                                'flex items-center gap-1.5 sm:gap-2 rounded-md px-2.5 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium whitespace-nowrap transition-all',
                                activeTab === tab.id
                                    ? 'bg-background text-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground'
                            )}
                        >
                            <tab.icon className="size-3.5 sm:size-4" />
                            <span className="hidden sm:inline">{tab.label}</span>
                            <span className="sm:hidden">{tab.label.split(' ')[0]}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Tab content */}
            <div>
                {activeTab === 'resumen' && (
                    <FinanzasClient
                        initialData={initialData}
                        branches={branches}
                        accounts={accounts}
                        expenseTickets={expenseTickets}
                        commissionSummary={commissionSummary}
                    />
                )}
                {activeTab === 'cuentas' && (
                    <CuentasClient accounts={accounts} branches={branches} />
                )}
                {/* SueldosClient siempre montado para preservar estado local */}
                <div className={activeTab !== 'sueldos' ? 'hidden' : ''}>
                    <SueldosClient
                        branches={branches}
                        barbers={barbers}
                    />
                </div>
                {activeTab === 'egresos' && (
                    <EgresosClient
                        expenseTickets={expenseTickets}
                        branches={branches}
                        accounts={accounts}
                    />
                )}
                {activeTab === 'gastos-fijos' && (
                    <GastosFijosClient
                        fixedExpenses={fixedExpenses}
                        branches={branches}
                    />
                )}
            </div>
        </div>
    )
}
