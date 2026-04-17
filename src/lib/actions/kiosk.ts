'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { isValidUUID } from '@/lib/validation'

export async function getCheckinData(branchId: string) {
  if (!branchId || !isValidUUID(branchId)) return { error: 'No branch provided' }

  const supabase = createAdminClient()

  // Operación pública del kiosko: verificar que la sucursal exista y obtener su org
  const { data: branchCheck } = await supabase
    .from('branches')
    .select('id, organization_id')
    .eq('id', branchId)
    .eq('is_active', true)
    .maybeSingle()

  if (!branchCheck) return { error: 'Sucursal no encontrada o inactiva' }

  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)

  try {
    const [staffRes, queueRes, visitsRes, availableRes, openRes, attendanceRes, servicesRes, schedulesRes, settingsRes, monthlyVisitsRes] = await Promise.all([
      supabase
        .from('staff')
        .select('*')
        .eq('branch_id', branchId)
        .eq('role', 'barber')
        .eq('is_active', true)
        .order('full_name'),
      supabase
        .from('queue_entries')
        .select('*')
        .eq('branch_id', branchId)
        .in('status', ['waiting', 'in_progress']),
      supabase
        .from('visits')
        .select('barber_id, started_at, completed_at')
        .eq('branch_id', branchId)
        .order('completed_at', { ascending: false })
        .limit(200),
      supabase.rpc('get_available_barbers_today', { p_branch_id: branchId }),
      supabase.rpc('get_branch_open_status', { p_branch_id: branchId }),
      supabase
        .from('attendance_logs')
        .select('staff_id, action_type')
        .eq('branch_id', branchId)
        .gte('recorded_at', dayStart.toISOString())
        .order('recorded_at', { ascending: false }),
      supabase
        .from('services')
        .select('*')
        .eq('is_active', true)
        .in('availability', ['checkin', 'both'])
        .or(`branch_id.eq.${branchId},branch_id.is.null`)
        .order('name'),
      supabase
        .from('staff_schedules')
        .select('*')
        .eq('day_of_week', new Date().getDay())
        .eq('is_active', true),
      supabase
        .from('app_settings')
        .select('shift_end_margin_minutes, dynamic_cooldown_seconds')
        .eq('organization_id', branchCheck.organization_id)
        .maybeSingle(),
      supabase
        .from('visits')
        .select('barber_id')
        .eq('branch_id', branchId)
        .gte('completed_at', dayStart.toISOString())
        .not('barber_id', 'is', null),
    ])

    return {
      staff: staffRes.data ?? [],
      queueEntries: queueRes.data ?? [],
      visits: visitsRes.data ?? [],
      availableBarbers: availableRes.data ?? [],
      openStatus: openRes.data ?? [],
      attendance: attendanceRes.data ?? [],
      services: servicesRes.data ?? [],
      schedules: schedulesRes.data ?? [],
      settings: settingsRes.data,
      monthlyVisits: monthlyVisitsRes.data ?? []
    }
  } catch (err: any) {
    return { error: err.message }
  }
}
