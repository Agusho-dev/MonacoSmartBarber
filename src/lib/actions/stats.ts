'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { calcularEstadisticas, estadisticasVacias } from '@/lib/estadisticas-nucleo'
import { getCurrentOrgId } from './org'
import { getScopedBranchIds } from './branch-access'
import { getActiveTimezone } from '@/lib/i18n'

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

export interface Retention {
  /** Clientes con 2+ visitas DENTRO del período [desde, hasta]. */
  returning_in_period: number
  /** Clientes únicos atendidos en el período. */
  unique_in_period: number
  /** returning_in_period / unique_in_period (0-1). Numerador y denominador en la MISMA ventana. */
  rate: number
}

export interface StatsData {
  heatmap: HeatmapCell[]
  ranking: BarberRank[]
  trends: TrendPoint[]
  revenueByMethod: MethodRevenue[]
  segmentation: Segmentation
  /** Tasa de retorno calculada dentro del período consultado (a diferencia de segmentation, que usa ventana móvil). */
  retention: Retention
  totals: {
    /** Todo lo cobrado, servicios + productos. Es el número que cuadra contra Finanzas y Caja. */
    revenue: number
    /**
     * Cortes REALES. Excluye las ventas de producto sueltas, que son visitas sin `service_id`
     * ni `queue_entry_id` creadas por `directProductSale`. Antes se contaban como cortes
     * (`safe.length`) y por eso esta pantalla nunca coincidía con Finanzas: julio en Paraná
     * decía 1216 cuando los cortes eran 1200 y las otras 16 eran ceras y cremas.
     */
    cuts: number
    /**
     * Ticket promedio de SERVICIO: `(revenue - productRevenue) / cuts`. Antes era
     * `revenue / totalVisitas`, que mezclaba dos cosas: metía la plata de los productos en el
     * numerador y las ventas de producto en el denominador. Julio en Paraná daba $16.477 y el
     * ticket de servicio es $16.484.
     */
    avgTicket: number
    clients: number
    /** Plata de ventas de producto sueltas, mostrada aparte para que no quede diluida. */
    productRevenue: number
    productCount: number
  }
}

export async function fetchStats(
  fromISO: string,
  toISO: string,
  branchId?: string | null
): Promise<StatsData> {
  // El cálculo vive en `src/lib/estadisticas-nucleo.ts`, compartido con Tex (`estadisticas`).
  // Esta action resuelve el alcance desde la sesión y lo llama en modo NO estricto: ante una
  // lectura que falla, la pantalla sigue con lo que pudo leer y el error queda en el log.
  const tz = await getActiveTimezone()
  const orgId = await getCurrentOrgId()

  // Sucursales que la persona puede ver
  const orgBranchIds = await getScopedBranchIds()

  // Validar que el branchId solicitado pertenece a la org (y al alcance del rol)
  if (branchId && !orgBranchIds.includes(branchId)) return estadisticasVacias()

  const filterBranchIds = branchId ? [branchId] : orgBranchIds
  if (filterBranchIds.length === 0) return estadisticasVacias()

  const { datos } = await calcularEstadisticas({
    desdeISO: fromISO,
    hastaISO: toISO,
    sucursalesIds: filterBranchIds,
    orgId,
    // Clientes nuevos y total: de la sucursal elegida o de toda la org, como siempre en la pantalla.
    clientesDe: branchId ? { tipo: 'sucursal', id: branchId } : { tipo: 'org' },
    tz,
    estricto: false,
  })
  return datos
}

export async function fetchWeekHeatmap(
  weekStartISO: string,
  weekEndISO: string,
  branchId?: string | null
): Promise<HeatmapCell[]> {
  const supabase = createAdminClient()
  const tz = await getActiveTimezone()

  const orgBranchIds = await getScopedBranchIds()

  // Validar que el branchId solicitado pertenece a la org
  if (branchId && !orgBranchIds.includes(branchId)) return []

  const filterBranchIds = branchId ? [branchId] : orgBranchIds
  if (filterBranchIds.length === 0) return []

  // Con orden estable (y `id` de desempate): sin `.order()`, Postgres no garantiza que las
  // páginas de 1000 no se pisen o se salteen visitas.
  const data = await fetchAll<{ completed_at: string }>((from, to) => {
    return supabase
      .from('visits')
      .select('completed_at')
      .in('branch_id', filterBranchIds)
      .gte('completed_at', weekStartISO)
      .lte('completed_at', weekEndISO)
      .order('completed_at')
      .order('id')
      .range(from, to)
  }, { contexto: 'mapa de calor de la semana' })

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
