'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getActiveOrganization } from './org'
import { isValidUUID } from './guard'

/**
 * Valida que los branchIds recibidos pertenecen a la org activa (cookie active_organization).
 * La TV es pública pero debe estar acotada a la org del dispositivo.
 */
async function validateTvBranchIds(branchIds: string[]): Promise<string[]> {
  if (!branchIds.length) return []

  // Filtrar primero los que no son UUID válidos
  const validUUIDs = branchIds.filter(id => isValidUUID(id))
  if (!validUUIDs.length) return []

  const org = await getActiveOrganization()
  if (!org) return []

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('branches')
    .select('id')
    .in('id', validUUIDs)
    .eq('organization_id', org.id)

  return (data ?? []).map(b => b.id)
}

/**
 * Obtiene todos los datos necesarios para la pantalla TV.
 * Usa createAdminClient() para bypasear RLS (TV es público, sin auth).
 * Filtra por branch IDs de la organización activa (cookie).
 */
export async function refreshTvQueue(branchIds: string[]) {
  const safeBranchIds = await validateTvBranchIds(branchIds)
  if (!safeBranchIds.length) return { entries: [] }
  branchIds = safeBranchIds
  if (!branchIds.length) return { entries: [] }

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('queue_entries')
    .select('*, client:clients(*), barber:staff(*)')
    .in('status', ['waiting', 'in_progress'])
    .in('branch_id', branchIds)
    .order('position')

  return { entries: data ?? [] }
}

export async function refreshTvBarbers(branchIds: string[]) {
  const safeBranchIds = await validateTvBranchIds(branchIds)
  if (!safeBranchIds.length) return { barbers: [] }
  branchIds = safeBranchIds
  if (!branchIds.length) return { barbers: [] }

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('staff')
    .select('id, full_name, branch_id, status, is_active, avatar_url')
    .eq('role', 'barber')
    .eq('is_active', true)
    .in('branch_id', branchIds)
    .order('full_name')

  return { barbers: data ?? [] }
}

export async function refreshTvSchedules(branchIds: string[], orgId: string) {
  const safeBranchIds = await validateTvBranchIds(branchIds)
  branchIds = safeBranchIds
  if (!branchIds.length) return {
    schedules: [],
    shiftEndMargin: 35,
    dynamicCooldownSeconds: 60,
    dailyServiceCounts: {} as Record<string, number>,
    lastCompletedAt: {} as Record<string, string>,
    latestAttendance: {} as Record<string, string>,
  }

  const supabase = createAdminClient()
  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)

  const [schedRes, settingsRes, monthlyVisitsRes, lastVisitsRes, attendanceRes] = await Promise.all([
    supabase
      .from('staff_schedules')
      .select('*')
      .eq('day_of_week', new Date().getDay())
      .eq('is_active', true),
    supabase
      .from('app_settings')
      .select('shift_end_margin_minutes, dynamic_cooldown_seconds')
      .eq('organization_id', orgId)
      .maybeSingle(),
    supabase
      .from('visits')
      .select('barber_id')
      .in('branch_id', branchIds)
      .gte('completed_at', dayStart.toISOString())
      .not('barber_id', 'is', null),
    supabase
      .from('visits')
      .select('barber_id, completed_at')
      .in('branch_id', branchIds)
      .not('barber_id', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(200),
    supabase
      .from('attendance_logs')
      .select('staff_id, action_type')
      .in('branch_id', branchIds)
      .gte('recorded_at', dayStart.toISOString())
      .order('recorded_at', { ascending: false }),
  ])

  const dailyServiceCounts: Record<string, number> = {}
  if (monthlyVisitsRes?.data) {
    for (const v of monthlyVisitsRes.data as { barber_id: string }[]) {
      dailyServiceCounts[v.barber_id] = (dailyServiceCounts[v.barber_id] || 0) + 1
    }
  }

  const lastCompletedAt: Record<string, string> = {}
  if (lastVisitsRes?.data) {
    for (const v of lastVisitsRes.data as { barber_id: string; completed_at: string }[]) {
      if (!lastCompletedAt[v.barber_id]) {
        lastCompletedAt[v.barber_id] = v.completed_at
      }
    }
  }

  const latestAttendance: Record<string, string> = {}
  if (attendanceRes.data) {
    attendanceRes.data.forEach((log: { staff_id: string; action_type: string }) => {
      if (!latestAttendance[log.staff_id]) {
        latestAttendance[log.staff_id] = log.action_type
      }
    })
  }

  const settings = settingsRes.data as { shift_end_margin_minutes?: number; dynamic_cooldown_seconds?: number } | null

  return {
    schedules: schedRes.data ?? [],
    shiftEndMargin: typeof settings?.shift_end_margin_minutes === 'number' ? settings.shift_end_margin_minutes : 35,
    dynamicCooldownSeconds: typeof settings?.dynamic_cooldown_seconds === 'number' ? settings.dynamic_cooldown_seconds : 60,
    dailyServiceCounts,
    lastCompletedAt,
    latestAttendance,
  }
}
