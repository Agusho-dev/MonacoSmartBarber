import { createClient } from '@/lib/supabase/server'
import { EquipoClient } from './equipo-client'
import type { Metadata } from 'next'
import type { Role } from '@/lib/types/database'

export const metadata: Metadata = {
    title: 'Equipo | Monaco Smart Barber',
}

export default async function EquipoPage() {
    const supabase = await createClient()

    const now = new Date()
    const todayStr = now.toISOString().slice(0, 10)
    const tomorrowStr = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
        .toISOString()
        .slice(0, 10)

    const startOfMonth = new Date()
    startOfMonth.setDate(1)
    const fromDate = startOfMonth.toISOString().slice(0, 10)

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
    ] = await Promise.all([
        supabase.from('staff').select('*, branch:branches(*)').order('full_name'),
        supabase.from('branches').select('*').eq('is_active', true).order('name'),
        supabase
            .from('visits')
            .select('barber_id, amount')
            .gte('completed_at', todayStr)
            .lt('completed_at', tomorrowStr),
        supabase.from('break_configs').select('*').order('name'),
        supabase.from('incentive_rules').select('*').order('name'),
        supabase
            .from('incentive_achievements')
            .select('*, rule:incentive_rules(name)')
            .eq('period_label', defaultPeriod),
        supabase
            .from('disciplinary_rules')
            .select('*')
            .order('event_type')
            .order('occurrence_number'),
        supabase
            .from('disciplinary_events')
            .select('*, staff:staff(id, full_name, branch_id)')
            .gte('event_date', fromDate)
            .order('event_date', { ascending: false }),
        supabase
            .from('roles')
            .select('*, role_branch_scope(branch_id)')
            .order('name'),
        supabase
            .from('break_requests')
            .select('*, staff:staff_id(id, full_name), break_config:break_config_id(name, duration_minutes)')
            .in('status', ['pending', 'approved'])
            .order('requested_at', { ascending: true }),
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

    return (
        <EquipoClient
            barbers={barbers ?? []}
            branches={branches ?? []}
            todayVisits={todayVisits ?? []}
            breakConfigs={breakConfigs ?? []}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            breakRequests={(breakRequests ?? []) as any}
            incentiveRules={incentiveRules ?? []}
            incentiveAchievements={incentiveAchievements ?? []}
            disciplinaryRules={disciplinaryRules ?? []}
            disciplinaryEvents={disciplinaryEvents ?? []}
            defaultPeriod={defaultPeriod}
            fromDate={fromDate}
            roles={(roles as Role[]) ?? []}
            isOwner={isOwner}
            permissions={userPermissions}
        />
    )
}
