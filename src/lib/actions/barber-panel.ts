'use server'

import { createAdminClient } from '@/lib/supabase/server'

// Barber panel usa PIN auth (no JWT), por lo que createClient() devuelve un anon client
// que no puede leer tablas con RLS org-scoped. Usamos createAdminClient() ya que
// los queries estan scoped por staffId + branchId del barber_session cookie.

/**
 * Valida que el staffId pertenece a la misma organización que el branchId.
 * Previene que un barbero de una org acceda a datos de otra org con su staffId.
 * Retorna true si la combinación es válida.
 */
async function validateBarberBranchOwnership(staffId: string, branchId: string): Promise<boolean> {
  const supabase = createAdminClient()
  const [{ data: staff }, { data: branch }] = await Promise.all([
    supabase
      .from('staff')
      .select('organization_id')
      .eq('id', staffId)
      .eq('is_active', true)
      .maybeSingle(),
    supabase
      .from('branches')
      .select('organization_id')
      .eq('id', branchId)
      .eq('is_active', true)
      .maybeSingle(),
  ])

  if (!staff?.organization_id || !branch?.organization_id) return false
  return staff.organization_id === branch.organization_id
}

export async function fetchBarberPerformance(
    staffId: string,
    branchId: string,
    period: 'day' | 'week' | 'month' = 'day'
) {
    // Verificar que el barbero y la sucursal pertenecen a la misma organización
    const isValid = await validateBarberBranchOwnership(staffId, branchId)
    if (!isValid) return { cuts: 0, revenue: 0, commission: 0, avgTicket: 0, visits: [] }

    const supabase = createAdminClient()
    const now = new Date()

    let fromDate: Date
    if (period === 'day') {
        fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    } else if (period === 'week') {
        const day = now.getDay()
        fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (day === 0 ? 6 : day - 1))
    } else {
        fromDate = new Date(now.getFullYear(), now.getMonth(), 1)
    }

    const { data: visits } = await supabase
        .from('visits')
        .select('amount, commission_amount, completed_at, service:services(name)')
        .eq('barber_id', staffId)
        .eq('branch_id', branchId)
        .gte('completed_at', fromDate.toISOString())
        .order('completed_at', { ascending: false })

    const safe = visits ?? []
    const totalRevenue = safe.reduce((s, v) => s + Number(v.amount), 0)
    const totalCommission = safe.reduce((s, v) => s + Number(v.commission_amount), 0)
    const totalCuts = safe.length
    const avgTicket = totalCuts > 0 ? Math.round(totalRevenue / totalCuts) : 0

    return {
        cuts: totalCuts,
        revenue: totalRevenue,
        commission: totalCommission,
        avgTicket,
        visits: safe,
    }
}

export async function fetchBarberGoals(staffId: string, branchId: string) {
    const isValid = await validateBarberBranchOwnership(staffId, branchId)
    if (!isValid) return { rules: [], achievements: [], currentCuts: 0, currentPeriod: '' }

    const supabase = createAdminClient()
    const now = new Date()
    const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

    // Get active incentive rules for this branch
    const { data: rules } = await supabase
        .from('incentive_rules')
        .select('*')
        .eq('branch_id', branchId)
        .eq('is_active', true)

    // Get achievements for current period
    const { data: achievements } = await supabase
        .from('incentive_achievements')
        .select('*')
        .eq('staff_id', staffId)
        .eq('period_label', currentPeriod)

    // Calculate progress for haircut_count rules
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const { count: monthCuts } = await supabase
        .from('visits')
        .select('id', { count: 'exact', head: true })
        .eq('barber_id', staffId)
        .eq('branch_id', branchId)
        .gte('completed_at', startOfMonth.toISOString())

    return {
        rules: rules ?? [],
        achievements: achievements ?? [],
        currentCuts: monthCuts ?? 0,
        currentPeriod,
    }
}

export async function fetchBarberAttendance(staffId: string, branchId: string) {
    const isValid = await validateBarberBranchOwnership(staffId, branchId)
    if (!isValid) return { logs: [], events: [], absences: 0, lates: 0 }

    const supabase = createAdminClient()
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

    const [{ data: logs }, { data: events }] = await Promise.all([
        supabase
            .from('attendance_logs')
            .select('*')
            .eq('staff_id', staffId)
            .eq('branch_id', branchId)
            .gte('recorded_at', startOfMonth.toISOString())
            .order('recorded_at', { ascending: false }),
        supabase
            .from('disciplinary_events')
            .select('*')
            .eq('staff_id', staffId)
            .eq('branch_id', branchId)
            .gte('event_date', startOfMonth.toISOString().slice(0, 10))
            .order('event_date', { ascending: false }),
    ])

    const absences = (events ?? []).filter((e) => e.event_type === 'absence').length
    const lates = (events ?? []).filter((e) => e.event_type === 'late').length

    return {
        logs: logs ?? [],
        events: events ?? [],
        absences,
        lates,
    }
}

export async function fetchBarberHistory(
    staffId: string,
    branchId: string,
    fromISO?: string,
    toISO?: string
) {
    const isValid = await validateBarberBranchOwnership(staffId, branchId)
    if (!isValid) return { visits: [] }

    const supabase = createAdminClient()
    const now = new Date()
    const from = fromISO || new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const to = toISO || now.toISOString()

    const { data: visits } = await supabase
        .from('visits')
        .select('id, amount, payment_method, commission_amount, started_at, completed_at, service:services(name), client:clients(name)')
        .eq('barber_id', staffId)
        .eq('branch_id', branchId)
        .gte('completed_at', from)
        .lte('completed_at', to)
        .order('completed_at', { ascending: false })
        .limit(200)

    return { visits: visits ?? [] }
}
