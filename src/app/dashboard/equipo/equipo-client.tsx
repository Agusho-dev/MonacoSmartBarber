'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { Scissors, Coffee, Trophy, AlertTriangle, Shield, CalendarDays, LayoutGrid, UserCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useBranchStore } from '@/stores/branch-store'
import { BranchSelector } from '@/components/dashboard/branch-selector'

import { BarberosClient } from '../barberos/barberos-client'
import { DescansosDashboard } from '../descansos/descansos-client'
import { IncentivosClient } from '../incentivos/incentivos-client'
import { DisciplinaClient } from '../disciplina/disciplina-client'
import { RolesClient } from './roles-client'
import { PerfilesClient } from './perfiles-client'
import { CalendarioClient } from '../calendario/calendario-client'
import type { Role, Branch } from '@/lib/types/database'

const ADMIN_TABS = [
    { id: 'barberos', label: 'Barberos', icon: Scissors, permission: 'staff.view' },
    { id: 'calendario', label: 'Calendario', icon: CalendarDays, permission: 'staff.view' },
    { id: 'descansos', label: 'Descansos', icon: Coffee, permission: 'breaks.view' },
    { id: 'incentivos', label: 'Incentivos', icon: Trophy, permission: 'incentives.view' },
    { id: 'disciplina', label: 'Disciplina', icon: AlertTriangle, permission: 'discipline.view' },
    { id: 'roles', label: 'Roles', icon: Shield, ownerOnly: true, permission: 'roles.manage' },
] as const

const PERFIL_TAB = { id: 'perfiles', label: 'Perfiles', permission: 'staff.view' } as const

type AdminTabId = (typeof ADMIN_TABS)[number]['id']
type TabId = AdminTabId | 'perfiles'

type Segment = 'administracion' | 'perfiles'

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
    attendanceLogs: unknown[]
    defaultPeriod: string
    fromDate: string
    // Roles
    roles: Role[]
    isOwner: boolean
    permissions: Record<string, boolean>
    // Historial de servicios
    serviceHistory: unknown[]
    // Perfiles
    salaryConfigs: unknown[]
    calendarBarbers: unknown[]
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
    attendanceLogs,
    defaultPeriod,
    fromDate,
    roles,
    isOwner,
    permissions,
    serviceHistory,
    salaryConfigs,
    calendarBarbers,
}: EquipoClientProps) {
    const searchParams = useSearchParams()
    const router = useRouter()
    const pathname = usePathname()

    // Filtrar tabs de administración según permisos
    const visibleAdminTabs = ADMIN_TABS.filter(tab => {
        if ('ownerOnly' in tab && tab.ownerOnly && !isOwner) return false
        return permissions[tab.permission]
    })

    const hasPerfilAccess = permissions[PERFIL_TAB.permission]

    const branchList = branches as { id: string; name: string }[]
    const firstBranchId = branchList[0]?.id ?? ''

    const initialTabId = searchParams.get('tab') as TabId | null
    const firstAvailableAdminTab = visibleAdminTabs.length > 0 ? visibleAdminTabs[0].id : null

    // Determinar el tab inicial evitando mismatch de hidratación SSR
    const [activeTab, setActiveTab] = useState<TabId | null>(firstAvailableAdminTab)

    // Sincronizar activeTab con los parámetros de URL después de la hidratación
    useEffect(() => {
        if (initialTabId === 'perfiles' && hasPerfilAccess) {
            setActiveTab('perfiles')
        } else if (initialTabId && visibleAdminTabs.some(t => t.id === initialTabId)) {
            setActiveTab(initialTabId as AdminTabId)
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialTabId])

    const { selectedBranchId, setSelectedBranchId } = useBranchStore()

    // Inicializar branch en el store si no está seleccionado
    useEffect(() => {
        if (!selectedBranchId && firstBranchId) {
            setSelectedBranchId(firstBranchId)
        }
    }, [selectedBranchId, firstBranchId, setSelectedBranchId])

    const effectiveBranchId = selectedBranchId ?? firstBranchId

    // Forzar activeTab válido si cambian los permisos o el estado queda obsoleto
    useEffect(() => {
        if (!activeTab) {
            if (firstAvailableAdminTab) setActiveTab(firstAvailableAdminTab)
            return
        }
        if (activeTab === 'perfiles') {
            if (!hasPerfilAccess && firstAvailableAdminTab) setActiveTab(firstAvailableAdminTab)
            return
        }
        if (!visibleAdminTabs.some(t => t.id === activeTab)) {
            if (firstAvailableAdminTab) setActiveTab(firstAvailableAdminTab)
            else if (hasPerfilAccess) setActiveTab('perfiles')
        }
    }, [activeTab, visibleAdminTabs, firstAvailableAdminTab, hasPerfilAccess])

    // Actualizar la URL cuando cambia el tab
    const updateUrl = useCallback((tab: string | null) => {
        const params = new URLSearchParams()
        if (tab) params.set('tab', tab)
        router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    }, [router, pathname])

    const handleTabChange = (tab: TabId) => {
        setActiveTab(tab)
        updateUrl(tab)
    }

    const handleSegmentChange = (segment: Segment) => {
        if (segment === 'perfiles') {
            handleTabChange('perfiles')
        } else {
            // Al cambiar a administración, activar el primer sub-tab disponible
            if (firstAvailableAdminTab) {
                handleTabChange(firstAvailableAdminTab)
            }
        }
    }

    // Derivar el segmento activo del tab activo
    const activeSegment: Segment = activeTab === 'perfiles' ? 'perfiles' : 'administracion'

    const noAccess = visibleAdminTabs.length === 0 && !hasPerfilAccess

    if (noAccess) {
        return (
            <div className="flex h-[50vh] items-center justify-center">
                <p className="text-muted-foreground">No tienes acceso a ninguna sección de Equipo.</p>
            </div>
        )
    }

    return (
        <div className="space-y-4 lg:space-y-6">
            {/* Header con BranchSelector */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-xl lg:text-2xl font-bold tracking-tight">Equipo</h1>
                    <p className="text-sm text-muted-foreground hidden sm:block">
                        Gestión de barberos, descansos, incentivos y disciplina
                    </p>
                </div>
                <BranchSelector branches={branches as { id: string; name: string }[]} />
            </div>

            {/* Segmented control — Administración / Perfiles */}
            <div className="flex gap-1 p-1 bg-muted/50 rounded-xl border w-full sm:w-fit">
                {visibleAdminTabs.length > 0 && (
                    <button
                        onClick={() => handleSegmentChange('administracion')}
                        aria-pressed={activeSegment === 'administracion'}
                        className={cn(
                            'flex flex-1 sm:flex-none items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-5 py-2 sm:py-2.5 rounded-lg text-xs sm:text-sm font-semibold transition-all duration-200',
                            activeSegment === 'administracion'
                                ? 'bg-background text-foreground shadow-sm'
                                : 'text-muted-foreground hover:text-foreground'
                        )}
                    >
                        <LayoutGrid className="size-3.5 sm:size-4" />
                        Administración
                    </button>
                )}
                {hasPerfilAccess && (
                    <button
                        onClick={() => handleSegmentChange('perfiles')}
                        aria-pressed={activeSegment === 'perfiles'}
                        className={cn(
                            'flex flex-1 sm:flex-none items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-5 py-2 sm:py-2.5 rounded-lg text-xs sm:text-sm font-semibold transition-all duration-200',
                            activeSegment === 'perfiles'
                                ? 'bg-background text-foreground shadow-sm'
                                : 'text-muted-foreground hover:text-foreground'
                        )}
                    >
                        <UserCircle2 className="size-3.5 sm:size-4" />
                        Perfiles
                    </button>
                )}
            </div>

            {/* Sub-tabs solo visibles en el segmento Administración */}
            {activeSegment === 'administracion' && visibleAdminTabs.length > 0 && (
                <div className="overflow-x-auto -mx-3 px-3 lg:mx-0 lg:px-0 scrollbar-hide">
                    <div className="flex gap-1 rounded-lg border bg-muted/30 p-1 flex-nowrap w-fit">
                        {visibleAdminTabs.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => handleTabChange(tab.id)}
                                title={tab.label}
                                className={cn(
                                    'flex items-center gap-1.5 sm:gap-2 rounded-md px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-medium transition-all whitespace-nowrap',
                                    activeTab === tab.id
                                        ? 'bg-background text-foreground shadow-sm'
                                        : 'text-muted-foreground hover:text-foreground'
                                )}
                            >
                                <tab.icon className="size-3.5 sm:size-4 shrink-0" />
                                <span className="hidden sm:inline">{tab.label}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Contenido del tab activo */}
            <div key={activeTab} className="animate-in fade-in-0 duration-200">
                {activeTab === 'barberos' && (
                    <BarberosClient
                        barbers={barbers as Parameters<typeof BarberosClient>[0]['barbers']}
                        branches={branches as Parameters<typeof BarberosClient>[0]['branches']}
                        todayVisits={todayVisits as Parameters<typeof BarberosClient>[0]['todayVisits']}
                        roles={roles}
                        serviceHistory={serviceHistory as Parameters<typeof BarberosClient>[0]['serviceHistory']}
                        canHideStaff={isOwner || !!permissions['staff.hide']}
                    />
                )}
                {activeTab === 'perfiles' && (
                    <PerfilesClient
                        barbers={barbers as Parameters<typeof PerfilesClient>[0]['barbers']}
                        roles={roles}
                        todayVisits={todayVisits as Parameters<typeof PerfilesClient>[0]['todayVisits']}
                        serviceHistory={serviceHistory as Parameters<typeof PerfilesClient>[0]['serviceHistory']}
                        disciplinaryEvents={disciplinaryEvents as Parameters<typeof PerfilesClient>[0]['disciplinaryEvents']}
                        breakOvertimeHistory={breakOvertimeHistory as Parameters<typeof PerfilesClient>[0]['breakOvertimeHistory']}
                        salaryConfigs={salaryConfigs as Parameters<typeof PerfilesClient>[0]['salaryConfigs']}
                        calendarBarbers={calendarBarbers as Parameters<typeof PerfilesClient>[0]['calendarBarbers']}
                    />
                )}
                {activeTab === 'calendario' && (
                    <CalendarioClient
                        branches={branches as Parameters<typeof CalendarioClient>[0]['branches']}
                        barbers={calendarBarbers as Parameters<typeof CalendarioClient>[0]['barbers']}
                    />
                )}
                {activeTab === 'descansos' && (
                    <DescansosDashboard
                        breakConfigs={breakConfigs as Parameters<typeof DescansosDashboard>[0]['breakConfigs']}
                        breakRequests={breakRequests as Parameters<typeof DescansosDashboard>[0]['breakRequests']}
                    />
                )}
                {activeTab === 'incentivos' && (
                    <IncentivosClient
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
                        rules={disciplinaryRules as Parameters<typeof DisciplinaClient>[0]['rules']}
                        barbers={
                            (barbers as unknown[])
                                .filter((b: unknown) => (b as { is_active: boolean }).is_active)
                                .map((b: unknown) => ({
                                    id: (b as { id: string }).id,
                                    full_name: (b as { full_name: string }).full_name,
                                    branch_id: (b as { branch_id: string }).branch_id,
                                    role: (b as { role: string }).role,
                                })) as Parameters<typeof DisciplinaClient>[0]['barbers']
                        }
                        events={disciplinaryEvents as Parameters<typeof DisciplinaClient>[0]['events']}
                        fromDate={fromDate}
                        activeBreakEntries={activeBreakEntries as Parameters<typeof DisciplinaClient>[0]['activeBreakEntries']}
                        breakOvertimeHistory={breakOvertimeHistory as Parameters<typeof DisciplinaClient>[0]['breakOvertimeHistory']}
                        attendanceLogs={attendanceLogs as Parameters<typeof DisciplinaClient>[0]['attendanceLogs']}
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
