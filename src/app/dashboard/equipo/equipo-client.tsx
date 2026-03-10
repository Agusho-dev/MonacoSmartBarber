'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { Scissors, Coffee, Trophy, AlertTriangle, Shield } from 'lucide-react'
import { cn } from '@/lib/utils'

// Re-use existing client components
import { BarberosClient } from '../barberos/barberos-client'
import { DescansosDashboard } from '../descansos/descansos-client'
import { IncentivosClient } from '../incentivos/incentivos-client'
import { DisciplinaClient } from '../disciplina/disciplina-client'
import { RolesClient } from './roles-client'
import type { Role, Branch } from '@/lib/types/database'

const TABS = [
    { id: 'barberos', label: 'Barberos', icon: Scissors, permission: 'staff.view' },
    { id: 'descansos', label: 'Descansos', icon: Coffee, permission: 'breaks.view' },
    { id: 'incentivos', label: 'Incentivos', icon: Trophy, permission: 'incentives.view' },
    { id: 'disciplina', label: 'Disciplina', icon: AlertTriangle, permission: 'discipline.view' },
    { id: 'roles', label: 'Roles', icon: Shield, ownerOnly: true, permission: 'roles.manage' },
] as const

type TabId = (typeof TABS)[number]['id']

interface EquipoClientProps {
    // Barberos
    barbers: unknown[]
    branches: unknown[]
    todayVisits: unknown[]
    // Descansos
    breakConfigs: unknown[]
    breakBarbers: unknown[]
    // Incentivos
    incentiveRules: unknown[]
    incentiveAchievements: unknown[]
    // Disciplina
    disciplinaryRules: unknown[]
    disciplinaryEvents: unknown[]
    defaultPeriod: string
    fromDate: string
    // Roles
    roles: Role[]
    isOwner: boolean
    permissions: Record<string, boolean>
}

export function EquipoClient({
    barbers,
    branches,
    todayVisits,
    breakConfigs,
    breakBarbers,
    incentiveRules,
    incentiveAchievements,
    disciplinaryRules,
    disciplinaryEvents,
    defaultPeriod,
    fromDate,
    roles,
    isOwner,
    permissions,
}: EquipoClientProps) {
    const searchParams = useSearchParams()

    // Filter tabs based on permissions
    const visibleTabs = TABS.filter(tab => {
        if ('ownerOnly' in tab && tab.ownerOnly && !isOwner) return false
        return permissions[tab.permission]
    })

    const initialTabId = searchParams.get('tab') as TabId
    const firstAvailableTab = visibleTabs.length > 0 ? visibleTabs[0].id : null

    // If requested tab is not visible or no tab requested, use the first available one
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
                <p className="text-muted-foreground">No tienes acceso a ninguna sección de Equipo.</p>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Equipo</h1>
                <p className="text-muted-foreground">
                    Gestión de barberos, descansos, incentivos y disciplina
                </p>
            </div>

            {/* Tab navigation */}
            <div className="flex gap-1 rounded-lg border bg-muted/50 p-1">
                {visibleTabs.map((tab) => {
                    return (
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
                    )
                })}
            </div>

            {/* Tab content */}
            <div>
                {activeTab === 'barberos' && (
                    <BarberosClient
                        barbers={barbers as Parameters<typeof BarberosClient>[0]['barbers']}
                        branches={branches as Parameters<typeof BarberosClient>[0]['branches']}
                        todayVisits={todayVisits as Parameters<typeof BarberosClient>[0]['todayVisits']}
                        roles={roles}
                    />
                )}
                {activeTab === 'descansos' && (
                    <DescansosDashboard
                        breakConfigs={breakConfigs as Parameters<typeof DescansosDashboard>[0]['breakConfigs']}
                        branches={branches as Parameters<typeof DescansosDashboard>[0]['branches']}
                        barbers={breakBarbers as Parameters<typeof DescansosDashboard>[0]['barbers']}
                    />
                )}
                {activeTab === 'incentivos' && (
                    <IncentivosClient
                        branches={branches as Parameters<typeof IncentivosClient>[0]['branches']}
                        rules={incentiveRules as Parameters<typeof IncentivosClient>[0]['rules']}
                        barbers={
                            (barbers as unknown[])
                                .filter((b: unknown) => (b as { role: string }).role === 'barber' && (b as { is_active: boolean }).is_active)
                                .map((b: unknown) => ({
                                    id: (b as { id: string }).id,
                                    full_name: (b as { full_name: string }).full_name,
                                    branch_id: (b as { branch_id: string }).branch_id,
                                })) as Parameters<typeof IncentivosClient>[0]['barbers']
                        }
                        achievements={incentiveAchievements as Parameters<typeof IncentivosClient>[0]['achievements']}
                        defaultPeriod={defaultPeriod}
                    />
                )}
                {activeTab === 'disciplina' && (
                    <DisciplinaClient
                        branches={branches as Parameters<typeof DisciplinaClient>[0]['branches']}
                        rules={disciplinaryRules as Parameters<typeof DisciplinaClient>[0]['rules']}
                        barbers={
                            (barbers as unknown[])
                                .filter((b: unknown) => (b as { role: string }).role === 'barber' && (b as { is_active: boolean }).is_active)
                                .map((b: unknown) => ({
                                    id: (b as { id: string }).id,
                                    full_name: (b as { full_name: string }).full_name,
                                    branch_id: (b as { branch_id: string }).branch_id,
                                })) as Parameters<typeof DisciplinaClient>[0]['barbers']
                        }
                        events={disciplinaryEvents as Parameters<typeof DisciplinaClient>[0]['events']}
                        fromDate={fromDate}
                    />
                )}
                {activeTab === 'roles' && isOwner && (
                    <RolesClient
                        roles={roles}
                        branches={branches as Branch[]}
                    />
                )}
            </div>
        </div>
    )
}
