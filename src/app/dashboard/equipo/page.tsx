import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getScopedBranchIds } from '@/lib/actions/branch-access'
import { redirect } from 'next/navigation'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { EquipoClient } from './equipo-client'
import type { Metadata } from 'next'
import type { Role } from '@/lib/types/database'

export const metadata: Metadata = {
    title: 'Equipo | BarberOS',
}

export default async function EquipoPage() {
    const orgId = await getCurrentOrgId()
    if (!orgId) redirect('/login')
    const branchIds = await getScopedBranchIds()

    const supabase = await createClient()

    const now = new Date()
    const todayStr = now.toISOString().slice(0, 10)
    const tomorrowStr = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
        .toISOString()
        .slice(0, 10)

    const startOfMonth = new Date()
    startOfMonth.setDate(1)
    const fromDate = startOfMonth.toISOString().slice(0, 10)

    const thirtyDaysAgo = new Date(now)
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString()

    const today = new Date()
    const defaultPeriod = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`

    // Check if current user is owner
    const {
        data: { user: authUser },
    } = await supabase.auth.getUser()

    let isOwner = false
    let currentStaff = null
    if (authUser) {
        const { data: staffData } = await supabase
            .from('staff')
            .select('*')
            .eq('auth_user_id', authUser.id)
            .eq('is_active', true)
            .single()
        currentStaff = staffData
        isOwner = currentStaff?.role === 'owner'
    }

    // Date 12 months ago for profile history
    const twelveMonthsAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1)
    const twelveMonthsAgoStr = twelveMonthsAgo.toISOString().slice(0, 10)

    const [
        { data: barbers },
        { data: branches },
        { data: todayVisits },
        { data: breakConfigs },
        { data: incentiveRules },
        { data: incentiveAchievements },
        { data: disciplinaryRules },
        { data: disciplinaryEvents },
        { data: roles },
        { data: breakRequests },
        { data: activeBreakEntries },
        { data: breakOvertimeHistory },
        serviceHistory,
        { data: attendanceLogs },
        { data: salaryConfigs },
        { data: calendarBarbers },
    ] = await Promise.all([
        branchIds.length > 0
            ? supabase.from('staff').select('*, branch:branches(*)').eq('organization_id', orgId).in('branch_id', branchIds).is('deleted_at', null).order('full_name')
            : Promise.resolve({ data: [] }),
        branchIds.length > 0
            ? supabase.from('branches').select('*').eq('organization_id', orgId).in('id', branchIds).eq('is_active', true).order('name')
            : Promise.resolve({ data: [] }),
        branchIds.length > 0
            ? supabase.from('visits').select('barber_id, amount').in('branch_id', branchIds).gte('completed_at', todayStr).lt('completed_at', tomorrowStr)
            : Promise.resolve({ data: [] }),
        branchIds.length > 0
            ? supabase.from('break_configs').select('*').in('branch_id', branchIds).order('name')
            : Promise.resolve({ data: [] }),
        branchIds.length > 0
            ? supabase.from('incentive_rules').select('*').in('branch_id', branchIds).order('name')
            : Promise.resolve({ data: [] }),
        supabase
            .from('incentive_achievements')
            .select('*, rule:incentive_rules(name)')
            .eq('period_label', defaultPeriod),
        branchIds.length > 0
            ? supabase.from('disciplinary_rules').select('*').in('branch_id', branchIds).order('event_type').order('occurrence_number')
            : Promise.resolve({ data: [] }),
        branchIds.length > 0
            ? supabase.from('disciplinary_events').select('*, staff:staff(id, full_name, branch_id)').in('branch_id', branchIds).gte('event_date', fromDate).order('event_date', { ascending: false })
            : Promise.resolve({ data: [] }),
        supabase
            .from('roles')
            .select('*, role_branch_scope(branch_id)')
            .eq('organization_id', orgId)
            .order('name'),
        branchIds.length > 0
            ? supabase.from('break_requests').select('*, staff:staff_id(id, full_name), break_config:break_config_id(name, duration_minutes)').in('branch_id', branchIds).in('status', ['pending', 'approved']).order('requested_at', { ascending: true })
            : Promise.resolve({ data: [] }),
        branchIds.length > 0
            ? supabase.from('queue_entries').select('id, barber_id, branch_id, started_at, break_request_id, barber:staff(id, full_name, branch_id), break_request:break_requests(id, branch_id, break_config:break_configs(name, duration_minutes))').in('branch_id', branchIds).eq('is_break', true).eq('status', 'in_progress')
            : Promise.resolve({ data: [] }),
        branchIds.length > 0
            ? supabase.from('break_requests').select('*, staff:staff_id(id, full_name, branch_id), break_config:break_config_id(name, duration_minutes)').in('branch_id', branchIds).eq('status', 'completed').gt('overtime_seconds', 0).gte('actual_completed_at', thirtyDaysAgoStr).order('actual_completed_at', { ascending: false })
            : Promise.resolve({ data: [] }),
        branchIds.length > 0
            ? fetchAll((from, to) =>
                createAdminClient()
                    .from('visits')
                    .select('id, amount, payment_method, commission_amount, started_at, completed_at, branch_id, service:services(name), client:clients(name), barber:staff(id, full_name)')
                    .eq('organization_id', orgId)
                    .in('branch_id', branchIds)
                    .gte('completed_at', twelveMonthsAgoStr)
                    .order('completed_at', { ascending: false })
                    .range(from, to)
            )
            : Promise.resolve([]),
        branchIds.length > 0
            ? supabase.from('attendance_logs').select('id, staff_id, branch_id, action_type, recorded_at, face_verified').in('branch_id', branchIds).gte('recorded_at', fromDate).order('recorded_at', { ascending: false })
            : Promise.resolve({ data: [] }),
        branchIds.length > 0
            ? supabase.from('salary_configs').select('*, staff!inner(organization_id, branch_id)').eq('staff.organization_id', orgId).in('staff.branch_id', branchIds)
            : Promise.resolve({ data: [] }),
        branchIds.length > 0
            ? supabase
                .from('staff')
                .select('id, full_name, branch_id, staff_schedules(*), staff_schedule_exceptions(*)')
                .eq('organization_id', orgId)
                .in('branch_id', branchIds)
                .or('role.eq.barber,is_also_barber.eq.true')
                .eq('is_active', true)
                .order('full_name')
            : Promise.resolve({ data: [] }),
    ])

    // Get user permissions
    let roleData = null
    if (currentStaff?.role_id) {
        const { data: role } = await supabase
            .from('roles')
            .select('permissions')
            .eq('id', currentStaff.role_id)
            .single()
        roleData = role
    }

    const { getEffectivePermissions } = await import('@/lib/permissions')
    const isOwnerOrAdmin = ['owner', 'admin'].includes(currentStaff?.role || '')
    const userPermissions = getEffectivePermissions(
        roleData?.permissions as Record<string, boolean> | undefined,
        isOwnerOrAdmin
    )

    // Obtener nombre de la organización activa (para PDFs de boletín)
    const { data: orgRow } = await createAdminClient()
        .from('organizations')
        .select('name')
        .eq('id', orgId)
        .maybeSingle()
    const orgName = orgRow?.name ?? 'BarberOS'

    return (
        <EquipoClient
            barbers={barbers ?? []}
            branches={branches ?? []}
            todayVisits={todayVisits ?? []}
            breakConfigs={breakConfigs ?? []}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            breakRequests={(breakRequests ?? []) as any}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            activeBreakEntries={(activeBreakEntries ?? []) as any}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            breakOvertimeHistory={(breakOvertimeHistory ?? []) as any}
            incentiveRules={incentiveRules ?? []}
            incentiveAchievements={incentiveAchievements ?? []}
            disciplinaryRules={disciplinaryRules ?? []}
            disciplinaryEvents={disciplinaryEvents ?? []}
            attendanceLogs={attendanceLogs ?? []}
            defaultPeriod={defaultPeriod}
            fromDate={fromDate}
            roles={(roles as Role[]) ?? []}
            isOwner={isOwner}
            permissions={userPermissions}
            serviceHistory={serviceHistory}
            salaryConfigs={salaryConfigs ?? []}
            calendarBarbers={calendarBarbers ?? []}
            orgName={orgName}
        />
    )
}
