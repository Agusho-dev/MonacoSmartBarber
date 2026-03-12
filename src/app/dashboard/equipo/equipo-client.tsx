'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { Scissors, Coffee, Trophy, AlertTriangle, Shield, ClipboardList } from 'lucide-react'
import { cn } from '@/lib/utils'

import { BarberosClient } from '../barberos/barberos-client'
import { DescansosDashboard } from '../descansos/descansos-client'
import { IncentivosClient } from '../incentivos/incentivos-client'
import { DisciplinaClient } from '../disciplina/disciplina-client'
import { RolesClient } from './roles-client'
import { HistorialServiciosClient } from './historial-servicios-client'
import type { Role, Branch } from '@/lib/types/database'

const TABS = [
    { id: 'barberos', label: 'Barberos', icon: Scissors, permission: 'staff.view' },
    { id: 'historial-servicios', label: 'Historial de Servicios', icon: ClipboardList, permission: 'staff.view' },
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
    breakRequests: unknown[]
    // Active break entries (currently in-progress breaks)
    activeBreakEntries: unknown[]
    // Completed breaks with overtime (last 30 days)
    breakOvertimeHistory: unknown[]
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
    // Historial de servicios
    serviceHistory: unknown[]
}

export function EquipoClient({
    barbers,
    branches,
    todayVisits,
    breakConfigs,
    breakRequests,
    activeBreakEntries,
    breakOvertimeHistory,
    incentiveRules,
    incentiveAchievements,
    disciplinaryRules,
    disciplinaryEvents,
    defaultPeriod,
    fromDate,
    roles,
    isOwner,
    permissions,
    serviceHistory,
}: EquipoClientProps) {
    const searchParams = useSearchParams()
    const router = useRouter()
    const pathname = usePathname()

    // Filter tabs based on permissions
    const visibleTabs = TABS.filter(tab => {
        if ('ownerOnly' in tab && tab.ownerOnly && !isOwner) return false
        return permissions[tab.permission]
    })

    const branchList = branches as { id: string; name: string }[]
    const firstBranchId = branchList[0]?.id ?? ''

    const initialTabId = searchParams.get('tab') as TabId
    const initialBranchId = searchParams.get('branch') ?? firstBranchId
    const firstAvailableTab = visibleTabs.length > 0 ? visibleTabs[0].id : null

    const defaultTab = visibleTabs.some(t => t.id === initialTabId)
        ? initialTabId
        : firstAvailableTab

    const [activeTab, setActiveTab] = useState<TabId | null>(defaultTab || null)
    const [selectedBranchId, setSelectedBranchId] = useState(
        branchList.some(b => b.id === initialBranchId) ? initialBranchId : firstBranchId
    )

    // Update URL whenever tab or branch changes
    const updateUrl = useCallback((tab: string | null, branch: string) => {
        const params = new URLSearchParams()
        if (tab) params.set('tab', tab)
        if (branch) params.set('branch', branch)
        router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    }, [router, pathname])

    // Force activeTab to be valid if permissions change or state is stale
    useEffect(() => {
        if (activeTab && visibleTabs.length > 0 && !visibleTabs.some(t => t.id === activeTab)) {
            setActiveTab(visibleTabs[0].id)
        } else if (!activeTab && visibleTabs.length > 0) {
            setActiveTab(visibleTabs[0].id)
        }
    }, [activeTab, visibleTabs])

    const handleTabChange = (tab: TabId) => {
        setActiveTab(tab)
        updateUrl(tab, selectedBranchId)
    }

    const handleBranchChange = (branchId: string) => {
        setSelectedBranchId(branchId)
        updateUrl(activeTab, branchId)
    }

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
                            onClick={() => handleTabChange(tab.id)}
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
                {activeTab === 'historial-servicios' && (
                    <HistorialServiciosClient
                        visits={serviceHistory as Parameters<typeof HistorialServiciosClient>[0]['visits']}
                        barbers={
                            (barbers as unknown[])
                                .filter((b: unknown) => (b as { role: string }).role === 'barber' && (b as { is_active: boolean }).is_active)
                                .map((b: unknown) => ({
                                    id: (b as { id: string }).id,
                                    full_name: (b as { full_name: string }).full_name,
                                })) as Parameters<typeof HistorialServiciosClient>[0]['barbers']
                        }
                        selectedBranchId={selectedBranchId}
                        branches={branches as { id: string; name: string }[]}
                        onBranchChange={handleBranchChange}
                    />
                )}
                {activeTab === 'descansos' && (
                    <DescansosDashboard
                        breakConfigs={breakConfigs as Parameters<typeof DescansosDashboard>[0]['breakConfigs']}
                        branches={branches as Parameters<typeof DescansosDashboard>[0]['branches']}
                        breakRequests={breakRequests as Parameters<typeof DescansosDashboard>[0]['breakRequests']}
                        selectedBranchId={selectedBranchId}
                        onBranchChange={handleBranchChange}
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
                        selectedBranchId={selectedBranchId}
                        onBranchChange={handleBranchChange}
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
                        activeBreakEntries={activeBreakEntries as Parameters<typeof DisciplinaClient>[0]['activeBreakEntries']}
                        breakOvertimeHistory={breakOvertimeHistory as Parameters<typeof DisciplinaClient>[0]['breakOvertimeHistory']}
                        selectedBranchId={selectedBranchId}
                        onBranchChange={handleBranchChange}
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
