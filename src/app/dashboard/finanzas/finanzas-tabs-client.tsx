'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { DollarSign, Wallet, Banknote } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FinanzasClient } from './finanzas-client'
import { CuentasClient } from '../cuentas/cuentas-client'
import { SueldosClient } from '../sueldos/sueldos-client'

const TABS = [
    { id: 'resumen', label: 'Resumen', icon: DollarSign },
    { id: 'cuentas', label: 'Cuentas de cobro', icon: Wallet },
    { id: 'sueldos', label: 'Sueldos', icon: Banknote },
] as const

type TabId = (typeof TABS)[number]['id']

interface FinanzasTabsClientProps {
    initialData: Parameters<typeof FinanzasClient>[0]['initialData']
    initialExpenses: Parameters<typeof FinanzasClient>[0]['initialExpenses']
    branches: Parameters<typeof FinanzasClient>[0]['branches']
    accounts: Parameters<typeof CuentasClient>[0]['accounts']
    barbers: Parameters<typeof SueldosClient>[0]['barbers']
    payments: Parameters<typeof SueldosClient>[0]['payments']
}

export function FinanzasTabsClient({
    initialData,
    initialExpenses,
    branches,
    accounts,
    barbers,
    payments,
}: FinanzasTabsClientProps) {
    const searchParams = useSearchParams()
    const initialTab = (searchParams.get('tab') as TabId) || 'resumen'
    const [activeTab, setActiveTab] = useState<TabId>(initialTab)

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
                {TABS.map((tab) => (
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
            </div>
        </div>
    )
}
