'use server'

import { createClient } from '@/lib/supabase/server'

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
  const supabase = await createClient()

  let vq = supabase
    .from('visits')
    .select(
      'id, branch_id, client_id, barber_id, amount, payment_method, completed_at, commission_amount, barber:staff(full_name)'
    )
    .gte('completed_at', fromISO)
    .lte('completed_at', toISO)
    .order('completed_at')
  if (branchId) vq = vq.eq('branch_id', branchId)
  const { data: visits } = await vq

  const { data: settings } = await supabase
    .from('app_settings')
    .select('lost_client_days, at_risk_client_days')
    .single()
  const lostDays = settings?.lost_client_days ?? 40
  const riskDays = settings?.at_risk_client_days ?? 25

  const { count: newCount } = await supabase
    .from('clients')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', fromISO)
    .lte('created_at', toISO)

  const segFrom = new Date()
  segFrom.setDate(segFrom.getDate() - lostDays * 2)
  let sq = supabase
    .from('visits')
    .select('client_id, completed_at')
    .gte('completed_at', segFrom.toISOString())
  if (branchId) sq = sq.eq('branch_id', branchId)
  const { data: segVisits } = await sq

  const { count: totalClients } = await supabase
    .from('clients')
    .select('id', { count: 'exact', head: true })

  const safe = visits ?? []

  // Heatmap
  const heatMap = new Map<string, number>()
  for (const v of safe) {
    const d = new Date(v.completed_at)
    const key = `${d.getDay()}-${d.getHours()}`
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
    const day = v.completed_at.slice(0, 10)
    const d = dailyAgg.get(day) || { revenue: 0, cuts: 0 }
    d.revenue += v.amount
    d.cuts++
    dailyAgg.set(day, d)
  }
  const trends: TrendPoint[] = [...dailyAgg.entries()]
    .map(([date, d]) => ({ date, ...d }))
    .sort((a, b) => a.date.localeCompare(b.date))

  // Revenue by payment method
  const methodAgg = new Map<string, number>()
  for (const v of safe) {
    methodAgg.set(v.payment_method, (methodAgg.get(v.payment_method) || 0) + v.amount)
  }
  const revenueByMethod: MethodRevenue[] = [...methodAgg.entries()].map(
    ([method, amount]) => ({ method, amount })
  )

  // Segmentation
  const now = Date.now()
  const lastVisitMap = new Map<string, number>()
  const visitCountMap = new Map<string, number>()
  for (const v of segVisits ?? []) {
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
      total: totalClients ?? 0,
    },
    totals: {
      revenue: totalRevenue,
      cuts: totalCuts,
      avgTicket: totalCuts > 0 ? Math.round(totalRevenue / totalCuts) : 0,
      clients: uniqueClients,
    },
  }
}
