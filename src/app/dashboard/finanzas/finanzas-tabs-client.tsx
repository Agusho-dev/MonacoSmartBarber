'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { DollarSign, Wallet, Banknote, Receipt } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FinanzasClient } from './finanzas-client'
import { CuentasClient } from '../cuentas/cuentas-client'
import { SueldosClient } from '../sueldos/sueldos-client'
import { EgresosClient } from './egresos-client'

const TABS = [
    { id: 'resumen', label: 'Resumen', icon: DollarSign, permission: 'finances.view' },
    { id: 'cuentas', label: 'Cuentas de cobro', icon: Wallet, permission: 'finances.view' },
    { id: 'sueldos', label: 'Sueldos', icon: Banknote, permission: 'salary.view' },
    { id: 'egresos', label: 'Egresos', icon: Receipt, permission: 'finances.view' },
] as const

type TabId = (typeof TABS)[number]['id']

interface FinanzasTabsClientProps {
    initialData: Parameters<typeof FinanzasClient>[0]['initialData']
    initialExpenses: Parameters<typeof FinanzasClient>[0]['initialExpenses']
    branches: Parameters<typeof FinanzasClient>[0]['branches']
    accounts: Parameters<typeof CuentasClient>[0]['accounts']
    barbers: Parameters<typeof SueldosClient>[0]['barbers']
    payments: Parameters<typeof SueldosClient>[0]['payments']
    expenseTickets: Parameters<typeof EgresosClient>[0]['expenseTickets']
    permissions: Record<string, boolean>
}

export function FinanzasTabsClient({
    initialData,
    initialExpenses,
    branches,
    accounts,
    barbers,
    payments,
    expenseTickets,
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
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Finanzas</h1>
                <p className="text-muted-foreground">
                    Resumen financiero, cuentas de cobro y sueldos
                </p>
            </div>

            {/* Tab navigation */}
            <div className="flex gap-1 rounded-lg border bg-muted/50 p-1">
                {visibleTabs.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={cn(
                            'flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all',
                            activeTab === tab.id
                                ? 'bg-background text-foreground shadow-sm'
                                : 'text-muted-foreground hover:text-foreground'
                        )}
                    >
                        <tab.icon className="size-4" />
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Tab content */}
            <div>
                {activeTab === 'resumen' && (
                    <FinanzasClient
                        initialData={initialData}
                        initialExpenses={initialExpenses}
                        branches={branches}
                    />
                )}
                {activeTab === 'cuentas' && (
                    <CuentasClient accounts={accounts} branches={branches} />
                )}
                {activeTab === 'sueldos' && (
                    <SueldosClient
                        branches={branches}
                        barbers={barbers}
                        payments={payments}
                    />
                )}
                {activeTab === 'egresos' && (
                    <EgresosClient
                        expenseTickets={expenseTickets}
                        branches={branches}
                    />
                )}
            </div>
        </div>
    )
}
