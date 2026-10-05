'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getActiveOrganization } from './org'
import { isValidUUID } from '@/lib/validation'
import { TV_QUEUE_SELECT } from '@/lib/tv-queue-select'

/**
 * Valida que los branchIds recibidos pertenecen a la org activa del dispositivo
 * (`getActiveOrganization`: sesión, o las cookies `public_organization` /
 * `active_organization`). La TV es pública pero debe estar acotada a esa org.
 *
 * Devuelve también la org resuelta en el servidor: es la única en la que se
 * puede confiar para el resto de las lecturas (la que manda el browser es un
 * parámetro como cualquier otro).
 */
async function validateTvBranchIds(branchIds: string[]): Promise<{ orgId: string | null; branchIds: string[] }> {
  if (!branchIds.length) return { orgId: null, branchIds: [] }

  // Filtrar primero los que no son UUID válidos
  const validUUIDs = branchIds.filter(id => isValidUUID(id))
  if (!validUUIDs.length) return { orgId: null, branchIds: [] }

  const org = await getActiveOrganization()
  if (!org) return { orgId: null, branchIds: [] }

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('branches')
    .select('id')
    .in('id', validUUIDs)
    .eq('organization_id', org.id)

  return { orgId: org.id, branchIds: (data ?? []).map(b => b.id) }
}

/**
 * Obtiene todos los datos necesarios para la pantalla TV.
 * Usa createAdminClient() para bypasear RLS (TV es público, sin auth).
 * Filtra por branch IDs de la organización activa (cookie).
 *
 * Qué columnas viajan y por qué: ver `TV_QUEUE_SELECT`. Es el mismo select y
 * el mismo orden que la carga inicial de `/tv`, para que la pantalla no cambie
 * de forma entre el primer render y el primer refresco.
 */
export async function refreshTvQueue(branchIds: string[]) {
  const { branchIds: safeBranchIds } = await validateTvBranchIds(branchIds)
  if (!safeBranchIds.length) return { entries: [] }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('queue_entries')
    .select(TV_QUEUE_SELECT)
    .in('status', ['waiting', 'in_progress'])
    .in('branch_id', safeBranchIds)
    .order('priority_order')
    .order('position')

  // Una lectura caída NO es una fila vacía. Devolver `[]` hacía que la TV
  // anunciara "La sala está libre" con gente esperando; con `null` la pantalla
  // conserva lo último que tenía (`if (data)`) hasta el próximo refresco.
  if (error) {
    console.error('[refreshTvQueue]', error.message)
    return { entries: null, error: 'No pudimos leer la fila' }
  }

  return { entries: data ?? [] }
}

export async function refreshTvBarbers(branchIds: string[]) {
  const { branchIds: safeBranchIds } = await validateTvBranchIds(branchIds)
  if (!safeBranchIds.length) return { barbers: [] }

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('staff')
    .select('id, full_name, branch_id, status, is_active, avatar_url')
    .or('role.eq.barber,is_also_barber.eq.true')
    .eq('is_active', true)
    .in('branch_id', safeBranchIds)
    .order('full_name')

  return { barbers: data ?? [] }
}

/**
 * Jornadas, margen de fin de turno y contadores del día para la TV.
 *
 * `_orgId` llega del browser y NO se usa: el margen se lee de la org que
 * resolvió el servidor al validar las sucursales. Queda en la firma porque la
 * TV lo sigue mandando.
 */
export async function refreshTvSchedules(branchIds: string[], _orgId: string) {
  const { orgId, branchIds: safeBranchIds } = await validateTvBranchIds(branchIds)
  if (!orgId || !safeBranchIds.length) return {
    schedules: [],
    shiftEndMargin: 35,
    dailyServiceCounts: {} as Record<string, number>,
    lastCompletedAt: {} as Record<string, string>,
    latestAttendance: {} as Record<string, string>,
  }

  const supabase = createAdminClient()
  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)

  // Jornadas del día SÓLO de los barberos de estas sucursales. Antes se pedían
  // las de todas las organizaciones, sin filtro, y la pantalla pública recibía
  // los horarios del equipo de los otros tenants (la TV las cruza por
  // `staff_id`, así que en pantalla no cambia nada). El corte va por el
  // barbero y no por `staff_schedules.branch_id`, que en NULL significa "todas
  // las sucursales del barbero". Mismo filtro que `refreshTvBarbers`. Las
  // columnas no son el problema (una jornada no tiene nada sensible).
  const jornadasP = (async () => {
    const { data: barberos, error: errBarberos } = await supabase
      .from('staff')
      .select('id')
      .or('role.eq.barber,is_also_barber.eq.true')
      .eq('is_active', true)
      .in('branch_id', safeBranchIds)
    if (errBarberos) return { data: null, error: errBarberos as { message: string } | null }
    const ids = (barberos ?? []).map((b) => b.id as string)
    if (ids.length === 0) return { data: [], error: null as { message: string } | null }
    const { data, error } = await supabase
      .from('staff_schedules')
      .select('*')
      .in('staff_id', ids)
      .eq('day_of_week', new Date().getDay())
      .eq('is_active', true)
    return { data, error: error as { message: string } | null }
  })()

  const [schedRes, settingsRes, todayVisitsRes, lastVisitsRes, attendanceRes] = await Promise.all([
    jornadasP,
    supabase
      .from('app_settings')
      .select('shift_end_margin_minutes')
      .eq('organization_id', orgId)
      .maybeSingle(),
    supabase
      .from('visits')
      .select('barber_id')
      .in('branch_id', safeBranchIds)
      .gte('completed_at', dayStart.toISOString())
      .not('barber_id', 'is', null),
    supabase
      .from('visits')
      .select('barber_id, completed_at')
      .in('branch_id', safeBranchIds)
      .not('barber_id', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(200),
    supabase
      .from('attendance_logs')
      .select('staff_id, action_type')
      .in('branch_id', safeBranchIds)
      .gte('recorded_at', dayStart.toISOString())
      .order('recorded_at', { ascending: false }),
  ])

  // La TV pisa su estado con lo que vuelve acá (no distingue "no hay" de "no se
  // pudo"), así que lo mínimo es que una lectura caída quede en el log y no
  // pase como un día sin jornadas ni fichajes.
  const lecturas: Array<[string, { message: string } | null]> = [
    ['staff_schedules', schedRes.error],
    ['app_settings', settingsRes.error],
    ['visits (hoy)', todayVisitsRes.error],
    ['visits (últimas)', lastVisitsRes.error],
    ['attendance_logs', attendanceRes.error],
  ]
  for (const [origen, error] of lecturas) {
    if (error) console.error(`[refreshTvSchedules] ${origen}`, { orgId, error: error.message })
  }

  const dailyServiceCounts: Record<string, number> = {}
  if (todayVisitsRes?.data) {
    for (const v of todayVisitsRes.data as { barber_id: string }[]) {
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

  const settings = settingsRes.data as { shift_end_margin_minutes?: number } | null

  return {
    schedules: schedRes.data ?? [],
    shiftEndMargin: typeof settings?.shift_end_margin_minutes === 'number' ? settings.shift_end_margin_minutes : 35,
    dailyServiceCounts,
    lastCompletedAt,
    latestAttendance,
  }
}
