'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { getCurrentOrgId, getOrgBranchIds } from './org'
import { getActiveTimezone } from '@/lib/i18n'

function toLocalDate(isoString: string, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(isoString))
}

function toDayHour(isoString: string, tz: string): { day: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(isoString))
  const p: Record<string, string> = {}
  for (const part of parts) p[part.type] = part.value
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return { day: dayMap[p.weekday] ?? 0, hour: parseInt(p.hour) }
}


export interface HeatmapCell {
  day: number
  hour: number
  count: number
}

export interface BarberRank {
  id: string
  name: string
  cuts: number
  revenue: number
  clients: number
  commission: number
}

export interface TrendPoint {
  date: string
  revenue: number
  cuts: number
}

export interface MethodRevenue {
  method: string
  amount: number
  cuts: number
}

export interface Segmentation {
  new_count: number
  recurring: number
  at_risk: number
  lost: number
  total: number
}

export interface StatsData {
  heatmap: HeatmapCell[]
  ranking: BarberRank[]
  trends: TrendPoint[]
  revenueByMethod: MethodRevenue[]
  segmentation: Segmentation
  totals: {
    revenue: number
    cuts: number
    avgTicket: number
    clients: number
  }
}

export async function fetchStats(
  fromISO: string,
  toISO: string,
  branchId?: string | null
): Promise<StatsData> {
  const supabase = createAdminClient()
  const tz = await getActiveTimezone()

  const orgId = await getCurrentOrgId()

  // Obtener sucursales de la org
  const orgBranchIds = await getOrgBranchIds()

  // Validar que el branchId solicitado pertenece a la org
  if (branchId && !orgBranchIds.includes(branchId)) {
    return {
      heatmap: [],
      ranking: [],
      trends: [],
      revenueByMethod: [],
      segmentation: { new_count: 0, recurring: 0, at_risk: 0, lost: 0, total: 0 },
      totals: { revenue: 0, cuts: 0, avgTicket: 0, clients: 0 },
    }
  }

  // Visitas del periodo (paginadas)
  const filterBranchIds = branchId ? [branchId] : orgBranchIds
  if (filterBranchIds.length === 0) {
    return {
      heatmap: [],
      ranking: [],
      trends: [],
      revenueByMethod: [],
      segmentation: { new_count: 0, recurring: 0, at_risk: 0, lost: 0, total: 0 },
      totals: { revenue: 0, cuts: 0, avgTicket: 0, clients: 0 },
    }
  }

  const visits = await fetchAll((from, to) => {
    return supabase
      .from('visits')
      .select(
        'id, branch_id, client_id, barber_id, amount, payment_method, completed_at, commission_amount, barber:staff(full_name)'
      )
      .in('branch_id', filterBranchIds)
      .gte('completed_at', fromISO)
      .lte('completed_at', toISO)
      .order('completed_at')
      .range(from, to)
  })

  // Settings de la org
  let settingsQuery = supabase.from('app_settings').select('lost_client_days, at_risk_client_days')
  if (orgId) settingsQuery = settingsQuery.eq('organization_id', orgId)
  const { data: settings } = await settingsQuery.maybeSingle()
  const lostDays = settings?.lost_client_days ?? 40
  const riskDays = settings?.at_risk_client_days ?? 25

  // Clientes nuevos: clientes cuya primera visita (en la sucursal si se filtra, o en toda la org) cae en el periodo
  let newCount = 0
  if (orgId) {
    const { data: newCountData } = await supabase.rpc('count_new_clients_scoped', {
      p_org_id: orgId,
      p_from: fromISO,
      p_to: toISO,
      p_branch_id: branchId ?? null,
    })
    newCount = (newCountData as number | null) ?? 0
  }

  // Visitas para segmentación (periodo extendido, paginadas)
  const segFrom = new Date()
  segFrom.setDate(segFrom.getDate() - lostDays * 2)
  const segVisits = await fetchAll((from, to) => {
    return supabase
      .from('visits')
      .select('client_id, completed_at')
      .in('branch_id', filterBranchIds)
      .gte('completed_at', segFrom.toISOString())
      .range(from, to)
  })

  // Total de clientes: en la org, o con al menos una visita en la sucursal filtrada
  let totalClients = 0
  if (orgId) {
    const { data: totalData } = await supabase.rpc('count_clients_scoped', {
      p_org_id: orgId,
      p_branch_id: branchId ?? null,
    })
    totalClients = (totalData as number | null) ?? 0
  }

  const safe = visits

  // Heatmap
  const heatMap = new Map<string, number>()
  for (const v of safe) {
    const { day, hour } = toDayHour(v.completed_at, tz)
    const key = `${day}-${hour}`
    heatMap.set(key, (heatMap.get(key) || 0) + 1)
  }
  const heatmap: HeatmapCell[] = [...heatMap.entries()].map(([k, count]) => {
    const [day, hour] = k.split('-').map(Number)
    return { day, hour, count }
  })

  // Barber ranking
  const barberAgg = new Map<
    string,
    { name: string; cuts: number; revenue: number; clients: Set<string>; commission: number }
  >()
  for (const v of safe) {
    const existing = barberAgg.get(v.barber_id) || {
      name: (v.barber as unknown as { full_name: string } | null)?.full_name ?? '?',
      cuts: 0,
      revenue: 0,
      clients: new Set<string>(),
      commission: 0,
    }
    existing.cuts++
    existing.revenue += v.amount
    existing.commission += v.commission_amount
    existing.clients.add(v.client_id)
    barberAgg.set(v.barber_id, existing)
  }
  const ranking: BarberRank[] = [...barberAgg.entries()]
    .map(([id, d]) => ({
      id,
      name: d.name,
      cuts: d.cuts,
      revenue: d.revenue,
      clients: d.clients.size,
      commission: d.commission,
    }))
    .sort((a, b) => b.revenue - a.revenue)

  // Daily trends
  const dailyAgg = new Map<string, { revenue: number; cuts: number }>()
  for (const v of safe) {
    const day = toLocalDate(v.completed_at, tz)
    const d = dailyAgg.get(day) || { revenue: 0, cuts: 0 }
    d.revenue += v.amount
    d.cuts++
    dailyAgg.set(day, d)
  }
  const trends: TrendPoint[] = [...dailyAgg.entries()]
    .map(([date, d]) => ({ date, ...d }))
    .sort((a, b) => a.date.localeCompare(b.date))

  // Revenue by payment method
  const methodAgg = new Map<string, { amount: number; cuts: number }>()
  for (const v of safe) {
    const d = methodAgg.get(v.payment_method) || { amount: 0, cuts: 0 }
    d.amount += v.amount
    d.cuts++
    methodAgg.set(v.payment_method, d)
  }
  const revenueByMethod: MethodRevenue[] = [...methodAgg.entries()].map(
    ([method, d]) => ({ method, amount: d.amount, cuts: d.cuts })
  )

  // Segmentation
  const now = Date.now()
  const lastVisitMap = new Map<string, number>()
  const visitCountMap = new Map<string, number>()
  for (const v of segVisits) {
    const ts = new Date(v.completed_at).getTime()
    const prev = lastVisitMap.get(v.client_id) || 0
    if (ts > prev) lastVisitMap.set(v.client_id, ts)
    visitCountMap.set(v.client_id, (visitCountMap.get(v.client_id) || 0) + 1)
  }
  let recurring = 0
  let atRisk = 0
  let lost = 0
  for (const [, count] of visitCountMap) {
    if (count >= 2) recurring++
  }
  for (const [, lastTs] of lastVisitMap) {
    const daysSince = Math.floor((now - lastTs) / 86400000)
    if (daysSince >= riskDays && daysSince < lostDays) atRisk++
    else if (daysSince >= lostDays) lost++
  }

  const totalRevenue = safe.reduce((s, v) => s + v.amount, 0)
  const totalCuts = safe.length
  const uniqueClients = new Set(safe.map((v) => v.client_id)).size

  return {
    heatmap,
    ranking,
    trends,
    revenueByMethod,
    segmentation: {
      new_count: newCount ?? 0,
      recurring,
      at_risk: atRisk,
      lost,
      total: totalClients,
    },
    totals: {
      revenue: totalRevenue,
      cuts: totalCuts,
      avgTicket: totalCuts > 0 ? Math.round(totalRevenue / totalCuts) : 0,
      clients: uniqueClients,
    },
  }
}

export async function fetchWeekHeatmap(
  weekStartISO: string,
  weekEndISO: string,
  branchId?: string | null
): Promise<HeatmapCell[]> {
  const supabase = createAdminClient()
  const tz = await getActiveTimezone()

  const orgBranchIds = await getOrgBranchIds()

  // Validar que el branchId solicitado pertenece a la org
  if (branchId && !orgBranchIds.includes(branchId)) return []

  const filterBranchIds = branchId ? [branchId] : orgBranchIds
  if (filterBranchIds.length === 0) return []

  const data = await fetchAll((from, to) => {
    return supabase
      .from('visits')
      .select('completed_at')
      .in('branch_id', filterBranchIds)
      .gte('completed_at', weekStartISO)
      .lte('completed_at', weekEndISO)
      .range(from, to)
  })

  const heatMap = new Map<string, number>()
  for (const v of data) {
    const { day, hour } = toDayHour(v.completed_at, tz)
    const key = `${day}-${hour}`
    heatMap.set(key, (heatMap.get(key) || 0) + 1)
  }

  return [...heatMap.entries()].map(([k, count]) => {
    const [day, hour] = k.split('-').map(Number)
    return { day, hour, count }
  })
}
