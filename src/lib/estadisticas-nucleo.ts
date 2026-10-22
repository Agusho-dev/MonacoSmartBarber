import 'server-only'

// =============================================================================
// src/lib/estadisticas-nucleo.ts
// El cálculo de Estadísticas: el de /dashboard/estadisticas (la server action
// `fetchStats`) y el de la herramienta `estadisticas` de Tex. Mismo motivo que
// `finanzas-nucleo.ts`: la action es viva y no cambia de forma (Known Risk #38),
// y Tex necesita un modo ESTRICTO en el que cualquier lectura que falla TIRA
// (paginado de visitas, `app_settings` y las dos RPC de conteo de clientes), con
// las sucursales ya resueltas por quien llama.
//
// CLIENTES NUEVOS Y TOTAL: A QUIÉN SE LE PREGUNTA
// `count_new_clients_scoped` y `count_clients_scoped` cuentan una sucursal o
// toda la org (`p_branch_id` null). Un rol acotado a VARIAS sucursales (no
// todas) no tiene una llamada equivalente: sumar por sucursal cuenta dos veces a
// quien tuvo visitas en más de una. Por eso quien llama dice qué quiere:
//   { tipo: 'sucursal', id }  una sucursal (elegida, o la única del alcance)
//   { tipo: 'org' }           toda la organización
//   { tipo: 'omitir' }        no se calculan: `clientesCalculados` vuelve false
// =============================================================================

import { createAdminClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetch-all'
import type { BarberRank, HeatmapCell, MethodRevenue, StatsData, TrendPoint } from '@/lib/actions/stats'

export type ClientesDeEstadisticas = { tipo: 'org' } | { tipo: 'sucursal'; id: string } | { tipo: 'omitir' }

export interface OpcionesEstadisticas {
  desdeISO: string
  hastaISO: string
  /** Las sucursales a leer, YA validadas contra la sesión de quien pregunta. */
  sucursalesIds: string[]
  orgId: string | null
  clientesDe: ClientesDeEstadisticas
  tz: string
  /** true = cualquier lectura que falla TIRA (Tex). false = se loguea y se sigue (dashboard). */
  estricto: boolean
}

export interface ResultadoEstadisticas {
  datos: StatsData
  /**
   * false = "clientes nuevos" (`segmentation.new_count`) y "total de clientes"
   * (`segmentation.total`) NO se calcularon y en `datos` van en 0: no se pueden
   * mostrar ni pasar como un dato.
   */
  clientesCalculados: boolean
}

export function estadisticasVacias(): StatsData {
  return {
    heatmap: [],
    ranking: [],
    trends: [],
    revenueByMethod: [],
    segmentation: { new_count: 0, recurring: 0, at_risk: 0, lost: 0, total: 0 },
    retention: { returning_in_period: 0, unique_in_period: 0, rate: 0 },
    totals: { revenue: 0, cuts: 0, avgTicket: 0, clients: 0, productRevenue: 0, productCount: 0 },
  }
}

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

/**
 * Un "corte" es una visita atada a un servicio o a una entrada de la fila. Una visita sin
 * ninguno de los dos es una venta de producto suelta (`directProductSale`): plata real, pero
 * no un corte. Misma definición que usa Finanzas (Known Risk #31).
 */
function esCorte(v: { service_id?: string | null; queue_entry_id?: string | null }): boolean {
  return Boolean(v.service_id || v.queue_entry_id)
}

type ErrorLectura = { message: string } | null | undefined

interface VisitaDeEstadisticas {
  id: string
  branch_id: string
  client_id: string
  barber_id: string
  amount: number
  payment_method: string
  completed_at: string
  commission_amount: number
  service_id: string | null
  queue_entry_id: string | null
  barber: { full_name: string | null } | null
}

export async function calcularEstadisticas(o: OpcionesEstadisticas): Promise<ResultadoEstadisticas> {
  const { desdeISO, hastaISO, sucursalesIds, orgId, clientesDe, tz, estricto } = o
  if (sucursalesIds.length === 0) {
    if (estricto) throw new Error('[estadisticas] no hay sucursales para leer')
    return { datos: estadisticasVacias(), clientesCalculados: false }
  }
  if (estricto && !orgId) throw new Error('[estadisticas] sin organización')

  const supabase = createAdminClient()
  /** Una lectura con error: en modo estricto corta todo; si no, queda en el log y se sigue con lo leído. */
  const revisar = (contexto: string, error: ErrorLectura): void => {
    if (!error) return
    if (estricto) throw new Error(`[estadisticas] ${contexto}: ${error.message}`)
    console.error(`[estadisticas] ${contexto}:`, error.message)
  }

  // Visitas del periodo (paginadas, con desempate por id: sin orden estable, PostgREST puede
  // repetir o saltear filas entre páginas). El barbero va por COLUMNA (`barber_id`) y no por
  // tabla: una segunda FK de visits a staff rompería el embed por tabla con PGRST201 en todas
  // las páginas (Known Risk #15).
  // (El tipo va a mano: sin el esquema generado, supabase-js infiere el embed como lista.)
  const visits = (await fetchAll((from, to) => {
    return supabase
      .from('visits')
      .select(
        'id, branch_id, client_id, barber_id, amount, payment_method, completed_at, commission_amount, service_id, queue_entry_id, barber:barber_id(full_name)'
      )
      .in('branch_id', sucursalesIds)
      .gte('completed_at', desdeISO)
      .lte('completed_at', hastaISO)
      .order('completed_at')
      .order('id')
      .range(from, to)
  }, { estricto, contexto: 'visitas de estadísticas' })) as unknown as VisitaDeEstadisticas[]

  // Settings de la org (Known Risk #36: siempre con el filtro de organización)
  let settingsQuery = supabase.from('app_settings').select('lost_client_days, at_risk_client_days')
  if (orgId) settingsQuery = settingsQuery.eq('organization_id', orgId)
  const settingsRes = await settingsQuery.maybeSingle()
  revisar('configuración de clientes en riesgo', settingsRes.error)
  const settings = settingsRes.data as { lost_client_days: number | null; at_risk_client_days: number | null } | null
  const lostDays = settings?.lost_client_days ?? 40
  const riskDays = settings?.at_risk_client_days ?? 25

  const calcularClientes = Boolean(orgId) && clientesDe.tipo !== 'omitir'
  const branchDeClientes = clientesDe.tipo === 'sucursal' ? clientesDe.id : null

  /** Una RPC de conteo: un número, o el error (estricto: tira; si no, 0 con el error en el log). */
  const contar = (contexto: string, r: { data: unknown; error: ErrorLectura }): number => {
    revisar(contexto, r.error)
    if (r.error) return 0
    if (typeof r.data === 'number' && Number.isFinite(r.data)) return r.data
    if (estricto) throw new Error(`[estadisticas] ${contexto}: la RPC no devolvió un número`)
    return 0
  }

  // Clientes nuevos: clientes cuya primera visita (en la sucursal, o en toda la org) cae en el periodo
  let newCount = 0
  if (calcularClientes) {
    const r = await supabase.rpc('count_new_clients_scoped', {
      p_org_id: orgId,
      p_from: desdeISO,
      p_to: hastaISO,
      p_branch_id: branchDeClientes,
    })
    newCount = contar('clientes nuevos', r)
  }

  // Visitas para segmentación (periodo extendido, paginadas y con orden estable)
  const segFrom = new Date()
  segFrom.setDate(segFrom.getDate() - lostDays * 2)
  const segVisits = await fetchAll<{ client_id: string; completed_at: string }>((from, to) => {
    return supabase
      .from('visits')
      .select('client_id, completed_at')
      .in('branch_id', sucursalesIds)
      .gte('completed_at', segFrom.toISOString())
      .order('completed_at')
      .order('id')
      .range(from, to)
  }, { estricto, contexto: 'visitas de la segmentación' })

  // Total de clientes: en la org, o con al menos una visita en la sucursal
  let totalClients = 0
  if (calcularClientes) {
    const r = await supabase.rpc('count_clients_scoped', {
      p_org_id: orgId,
      p_branch_id: branchDeClientes,
    })
    totalClients = contar('total de clientes', r)
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
      name: v.barber?.full_name ?? '?',
      cuts: 0,
      revenue: 0,
      clients: new Set<string>(),
      commission: 0,
    }
    if (esCorte(v)) existing.cuts++
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
    if (esCorte(v)) d.cuts++
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
    if (esCorte(v)) d.cuts++
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
  const totalCuts = safe.reduce((s, v) => s + (esCorte(v) ? 1 : 0), 0)
  // Ventas de producto sueltas: se muestran aparte en vez de quedar diluidas dentro de
  // "Cortes" e inflando el ticket promedio.
  const productos = safe.filter((v) => !esCorte(v))
  const productRevenue = productos.reduce((s, v) => s + v.amount, 0)
  const serviceRevenue = totalRevenue - productRevenue
  const uniqueClients = new Set(safe.map((v) => v.client_id)).size

  // Tasa de retorno DENTRO del período: clientes con 2+ visitas en el período / clientes
  // únicos del período. A diferencia de `segmentation.recurring` (ventana móvil ~lostDays*2),
  // numerador y denominador comparten la misma ventana.
  const periodVisitCount = new Map<string, number>()
  for (const v of safe) periodVisitCount.set(v.client_id, (periodVisitCount.get(v.client_id) || 0) + 1)
  let returningInPeriod = 0
  for (const count of periodVisitCount.values()) if (count >= 2) returningInPeriod++
  const retentionRate = uniqueClients > 0 ? returningInPeriod / uniqueClients : 0

  return {
    clientesCalculados: calcularClientes,
    datos: {
      heatmap,
      ranking,
      trends,
      revenueByMethod,
      segmentation: {
        new_count: newCount,
        recurring,
        at_risk: atRisk,
        lost,
        total: totalClients,
      },
      retention: {
        returning_in_period: returningInPeriod,
        unique_in_period: uniqueClients,
        rate: retentionRate,
      },
      totals: {
        revenue: totalRevenue,
        cuts: totalCuts,
        avgTicket: totalCuts > 0 ? Math.round(serviceRevenue / totalCuts) : 0,
        clients: uniqueClients,
        productRevenue,
        productCount: productos.length,
      },
    },
  }
}
