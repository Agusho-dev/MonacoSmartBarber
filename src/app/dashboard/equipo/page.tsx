import { createClient } from '@/lib/supabase/server'
import { EquipoClient } from './equipo-client'
import type { Metadata } from 'next'

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

    const [
        { data: barbers },
        { data: branches },
        { data: todayVisits },
        { data: breakConfigs },
        { data: breakBarbers },
        { data: incentiveRules },
        { data: incentiveAchievements },
        { data: disciplinaryRules },
        { data: disciplinaryEvents },
    ] = await Promise.all([
        supabase.from('staff').select('*, branch:branches(*)').order('full_name'),
        supabase.from('branches').select('*').eq('is_active', true).order('name'),
        supabase
            .from('visits')
            .select('barber_id, amount')
            .gte('completed_at', todayStr)
            .lt('completed_at', tomorrowStr),
        supabase.from('break_configs').select('*').order('name'),
        supabase
            .from('staff')
            .select(
                'id, full_name, status, break_config_id, break_started_at, break_ends_at, branch_id, break_configs:break_config_id(name, duration_minutes, tolerance_minutes)'
            )
            .eq('role', 'barber')
            .eq('is_active', true)
            .order('full_name'),
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
    ])

    return (
        <EquipoClient
            barbers={barbers ?? []}
            branches={branches ?? []}
            todayVisits={todayVisits ?? []}
            breakConfigs={breakConfigs ?? []}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            breakBarbers={(breakBarbers ?? []) as any}
            incentiveRules={incentiveRules ?? []}
            incentiveAchievements={incentiveAchievements ?? []}
            disciplinaryRules={disciplinaryRules ?? []}
            disciplinaryEvents={disciplinaryEvents ?? []}
            defaultPeriod={defaultPeriod}
            fromDate={fromDate}
        />
    )
}
