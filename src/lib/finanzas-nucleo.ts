import 'server-only'

// =============================================================================
// src/lib/finanzas-nucleo.ts
// El cálculo del resumen financiero: el de /dashboard/finanzas (la server action
// `fetchFinancialData`) y el de la herramienta `finanzas_pyl` de Tex. Una sola
// definición de ingresos, egresos, resultado y variación para los dos.
//
// POR QUÉ ESTÁ SEPARADO DE LA ACTION
// `fetchFinancialData` es una server action viva (la llama Finanzas): su firma y
// su forma no se tocan (Known Risk #38). Pero para Tex tenía dos problemas:
//  1. Se tragaba los errores. `fetchAll` cortaba el paginado y devolvía lo que
//     había juntado, y de las consultas de egresos sólo se leía `data`. Ante un
//     timeout (Known Risk #12) Tex informaba en negrita un resultado armado con
//     la mitad de las visitas y los gastos en $0 (Known Risk #15). En modo
//     ESTRICTO cualquier lectura que falla TIRA y la herramienta dice "no pude
//     leer". El modo NO estricto (el del dashboard) se queda como siempre:
//     loguea y sigue con lo leído.
//  2. Volvía a resolver el alcance desde la sesión. Acá las sucursales llegan YA
//     resueltas y validadas por quien llama: la action las saca de la sesión
//     (`validateBranchAccess` / `getScopedBranchIds`) y Tex de su contexto.
//
// "¿EL MES DE REFERENCIA ESTÁ EN CURSO?" SE DECIDE CON LA FECHA REAL
// Con `endMonth`, el ancla del período es el día 15 de ese mes (así un
// corrimiento de huso no empuja la referencia al mes vecino). Ese ancla sirve
// para los LÍMITES del período y para armar los meses, nunca para saber si un
// mes está en curso: antes se usaba también para eso, y cualquier mes final
// —septiembre cerrado, o el actual pasado explícito— salía "en curso, día 15":
// la variación comparaba quincenas y la pantalla decía "15 de 31 días".
// =============================================================================

import { createAdminClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { getLocalNow, getMonthBoundsStr, getPeriodBoundsStr } from '@/lib/time-utils'
import type {
  BarberPerformance,
  FinancialSummary,
  MoMChange,
  MonthlyFinancial,
  ServiceRevenue,
} from '@/lib/actions/finances'

export interface OpcionesResumenFinanciero {
  /** Cuántos meses, terminando en `endMonth` (o en el actual). 0 = desde el primer registro. */
  monthsBack: number
  /** Las sucursales a leer, YA validadas contra la sesión de quien pregunta. */
  sucursalesIds: string[]
  /**
   * true = una sucursal elegida. Los gastos fijos pagados de toda la org
   * (`fixed_expense_periods.branch_id` null) entran sólo cuando se mira el
   * alcance entero, como siempre en la pantalla.
   */
  unaSucursal: boolean
  orgId: string | null
  /** "YYYY-MM": el mes final en vez del actual. */
  endMonth?: string | null
  tz: string
  /** true = cualquier lectura que falla TIRA (Tex). false = se loguea y se sigue (dashboard). */
  estricto: boolean
  /** "Ahora" en hora de pared (el formato de `getLocalNow`). Sólo para las pruebas. */
  ahoraLocal?: Date
}

const MONTH_SHORT: Record<string, string> = {
  '01': 'Ene',
  '02': 'Feb',
  '03': 'Mar',
  '04': 'Abr',
  '05': 'May',
  '06': 'Jun',
  '07': 'Jul',
  '08': 'Ago',
  '09': 'Sep',
  '10': 'Oct',
  '11': 'Nov',
  '12': 'Dic',
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-')
  return `${MONTH_SHORT[m] ?? m} '${y.slice(2)}`
}

/** "YYYY-MM" de un Date de pared (los campos UTC son la hora local, como devuelve `getLocalNow`). */
function mesDe(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Resultado vacío para cuando el alcance no autoriza nada. Mismo patrón que
 * `fetchStats`: un `branchId` que no pertenece a la org no devuelve datos ajenos.
 */
export function resumenFinancieroVacio(): FinancialSummary {
  return {
    months: [],
    breakEven: { cutsNeeded: 0, avgRevenuePerCut: 0, avgCommissionPerCut: 0, netPerCut: 0, monthlyFixedExpenses: 0 },
    totals: {
      revenue: 0, commissions: 0, fixedExpenses: 0, variableExpenses: 0,
      bonuses: 0, advances: 0, salaryPayments: 0, totalExpenses: 0, netProfit: 0, cuts: 0,
    },
    momChange: { revenue: null, commissions: null, variableExpenses: null, netProfit: null, cuts: null, isPartial: false, daysElapsed: 0, daysInMonth: 0 },
    currentMonthCuts: 0,
    currentMonthRevenue: 0,
    barberPerformance: [],
    serviceRevenue: [],
  }
}

type ErrorLectura = { message: string } | null | undefined

export async function calcularResumenFinanciero(o: OpcionesResumenFinanciero): Promise<FinancialSummary> {
  const { sucursalesIds, unaSucursal, orgId, endMonth, tz, estricto } = o
  if (sucursalesIds.length === 0) {
    // Quien llama ya validó el alcance: sin sucursales no hay nada que leer. En modo
    // estricto no se devuelve un resumen en cero que parezca cierto.
    if (estricto) throw new Error('[finanzas] no hay sucursales para leer')
    return resumenFinancieroVacio()
  }

  // `createAdminClient()`, como TODO el resto del camino financiero (`stats.ts`,
  // `paymentAccounts.ts`, `salary.ts`, `tips.ts`, `caja.ts`, `fixed-expenses.ts` y
  // `fetchExpensesByCategory`). Era el último fetch de plata que quedaba con el cliente
  // RLS, y la policy de `expense_tickets` resuelve sucursales por `staff.branch_id` dando
  // el total SÓLO a `role='owner'` o `manage_all_branches`: un ADMIN pedía 4 sucursales y
  // la RLS devolvía 2, sin ningún aviso (Known Risk #32).
  const supabase = createAdminClient()

  /** Una lectura con error: en modo estricto corta todo; si no, queda en el log y se sigue con lo leído. */
  const revisar = (contexto: string, error: ErrorLectura): void => {
    if (!error) return
    if (estricto) throw new Error(`[finanzas] ${contexto}: ${error.message}`)
    console.error(`[finanzas] ${contexto}:`, error.message)
  }

  // La fecha REAL: decide si el mes de referencia está en curso.
  const ahora = o.ahoraLocal ?? getLocalNow(tz)
  const mesReal = mesDe(ahora)
  // El ANCLA del período: con un mes final, el día 15 de ese mes. Sólo para los
  // límites y para armar los meses (ver el encabezado).
  let ancla = ahora
  if (endMonth) {
    const [ey, em] = endMonth.split('-').map(Number)
    if (Number.isFinite(ey) && Number.isFinite(em)) ancla = new Date(Date.UTC(ey, em - 1, 15))
  }

  const branchFilter = <T extends { eq: (col: string, val: string) => T; in: (col: string, vals: string[]) => T }>(q: T, col = 'branch_id') =>
    unaSucursal ? q.eq(col, sucursalesIds[0]) : q.in(col, sucursalesIds)

  // Si monthsBack === 0, detectar el primer mes con registros para mostrar todo el historial
  let actualMonthsBack = o.monthsBack
  if (o.monthsBack === 0) {
    const eq = branchFilter(
      supabase
        .from('visits')
        .select('completed_at')
        .order('completed_at', { ascending: true })
        .limit(1),
    )
    const { data: earliest, error } = await eq
    revisar('primer registro', error)
    if (earliest && earliest.length > 0) {
      const firstDate = new Date(earliest[0].completed_at)
      const monthsDiff =
        (ancla.getUTCFullYear() - firstDate.getUTCFullYear()) * 12 +
        (ancla.getUTCMonth() - firstDate.getUTCMonth()) + 1
      actualMonthsBack = Math.max(monthsDiff, 1)
    } else {
      actualMonthsBack = 12
    }
  }

  // Misma ventana que piden "Saldo por cuenta" y "Egresos por categoría": una sola
  // definición de período para toda la pantalla (`getPeriodBoundsStr`, Known Risk #22).
  // Sin mes final se le pasa el mes del ancla (el de hoy): la ventana depende sólo del
  // año y el mes de la referencia, así que es la misma que con `endMonth` vacío.
  const { start: startDateStr, end: endDateStr } =
    getPeriodBoundsStr(actualMonthsBack, tz, endMonth || mesDe(ancla)) ??
    getMonthBoundsStr(actualMonthsBack, tz, ancla)

  // ── Queries paralelas: todas las fuentes de datos del rango ──

  // visits puede superar el cap default de PostgREST (1000 filas) en rangos largos
  // o sucursales con alto volumen → paginar con range() para drenar todas las filas.
  // El `id` desempata: con sólo `completed_at`, dos visitas del mismo instante podían
  // repetirse o saltearse entre páginas.
  const visitsPromise = fetchAll<{
    amount: number
    commission_amount: number
    completed_at: string
    branch_id: string
    service_id: string | null
    queue_entry_id: string | null
    barber_id: string | null
  }>((from, to) => {
    let q = supabase
      .from('visits')
      .select('amount, commission_amount, completed_at, branch_id, service_id, queue_entry_id, barber_id')
      .gte('completed_at', startDateStr)
      .lte('completed_at', endDateStr)
      .order('completed_at')
      .order('id')
    q = branchFilter(q)
    return q.range(from, to)
  }, { estricto, contexto: 'visitas de finanzas' })

  let fq = supabase
    .from('fixed_expenses')
    .select('amount, branch_id, created_at, is_active')
  fq = branchFilter(fq)

  // Pagos REALES de gastos fijos (fixed_expense_periods con status=paid) en el rango
  let fpq = supabase
    .from('fixed_expense_periods')
    .select('paid_amount, paid_at, branch_id, organization_id, period_year, period_month')
    .eq('status', 'paid')
    .gte('paid_at', startDateStr.slice(0, 10))
    .lte('paid_at', endDateStr.slice(0, 10))
  // El filtro de organización es lo que hace segura la rama `branch_id.is.null` de abajo.
  // Hasta acá lo aportaba la RLS (`fep_select_by_org`); con service role, sin esto, TODA fila
  // org-wide de CUALQUIER organización entraría en los egresos de esta org.
  if (orgId) fpq = fpq.eq('organization_id', orgId)
  if (unaSucursal) {
    fpq = fpq.eq('branch_id', sucursalesIds[0])
  } else {
    // Incluye gastos org-wide (branch_id null pero organization_id = org, ya filtrado arriba).
    fpq = fpq.or(`branch_id.in.(${sucursalesIds.join(',')}),branch_id.is.null`)
  }

  // Gastos variables reales: solo tickets "manuales" (no duplicar pagos de gastos fijos)
  let eq = supabase
    .from('expense_tickets')
    .select('amount, expense_date, branch_id')
    .eq('source', 'manual')
    .gte('expense_date', startDateStr.slice(0, 10))
    .lte('expense_date', endDateStr.slice(0, 10))
  eq = branchFilter(eq)

  // OJO con los tipos que entran acá: cada uno se SUMA a los egresos del mes.
  //
  // `commission` y `product_commission` quedaron AFUERA a propósito. La comisión ya se cuenta
  // como DEVENGADA desde `visits.commission_amount` (más abajo, `m.commissions`), que es además
  // el input de `avgCommissionPerCut` y del punto de equilibrio. Tenerla también acá la restaba
  // dos veces (Known Risk #28). La base contable es el DEVENGADO: la fuente es `visits` y punto.
  let sq = supabase
    .from('salary_reports')
    .select('type, amount, report_date, status')
    .in('type', ['bonus', 'advance', 'base_salary', 'hybrid_deficit'])
    .eq('status', 'paid')
    .gte('report_date', startDateStr.slice(0, 10))
    .lte('report_date', endDateStr.slice(0, 10))
  sq = branchFilter(sq)

  const [visits, fijosRes, pagosFijosRes, variablesRes, sueldosRes] = await Promise.all([visitsPromise, fq, fpq, eq, sq])
  revisar('gastos fijos', fijosRes.error)
  revisar('pagos de gastos fijos', pagosFijosRes.error)
  revisar('gastos variables', variablesRes.error)
  revisar('sueldos pagados', sueldosRes.error)
  const allFixedExpenses = fijosRes.data as { amount: number | string; branch_id: string; created_at: string; is_active: boolean }[] | null
  const fixedExpensePayments = pagosFijosRes.data as { paid_amount: number | string | null; paid_at: string | null }[] | null
  const variableExpenses = variablesRes.data as { amount: number | string; expense_date: string; branch_id: string }[] | null
  const salaryReports = sueldosRes.data as { type: string; amount: number | string; report_date: string; status: string }[] | null

  // Gastos fijos REALES pagados por mes (desde fixed_expense_periods.status='paid').
  // Agrupado por YYYY-MM del paid_at (fecha local ya viene en esa forma).
  const paidFixedByMonth = new Map<string, number>()
  for (const p of fixedExpensePayments ?? []) {
    if (!p.paid_at) continue
    const key = p.paid_at.slice(0, 7)
    paidFixedByMonth.set(key, (paidFixedByMonth.get(key) ?? 0) + Number(p.paid_amount ?? 0))
  }

  // Fallback: si para un mes no hay registros reales (catálogo recién instalado
  // o antes de la migración 102), usamos el snapshot histórico del catálogo
  // como referencia. Una vez que se adopte la nueva modalidad, paidFixedByMonth
  // domina.
  function getHistoricalFixedForMonth(ym: string): number {
    const realPaid = paidFixedByMonth.get(ym)
    if (realPaid !== undefined && realPaid > 0) return realPaid
    const [y, m] = ym.split('-')
    const monthEnd = new Date(Number(y), Number(m), 0, 23, 59, 59, 999)
    return (allFixedExpenses ?? [])
      .filter(e => new Date(e.created_at) <= monthEnd)
      .reduce((s, e) => s + Number(e.amount), 0)
  }

  // Para break-even: solo gastos fijos activos actualmente
  const currentMonthlyFixed = (allFixedExpenses ?? [])
    .filter(e => e.is_active)
    .reduce((s, e) => s + Number(e.amount), 0)

  // Inicializar todos los meses (desde el ancla) usando hora local para agrupar
  const monthMap = new Map<string, { revenue: number; commissions: number; cuts: number; variableExp: number; bonuses: number; advances: number; salaryPayments: number; baseSalaryPaid: number }>()
  for (let i = 0; i < actualMonthsBack; i++) {
    let year = ancla.getUTCFullYear()
    let monthIndex = ancla.getUTCMonth() - i
    while (monthIndex < 0) {
      monthIndex += 12
      year -= 1
    }
    const d = new Date(year, monthIndex, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    monthMap.set(key, { revenue: 0, commissions: 0, cuts: 0, variableExp: 0, bonuses: 0, advances: 0, salaryPayments: 0, baseSalaryPaid: 0 })
  }

  // Un solo `Intl.DateTimeFormat` reutilizado: instanciarlo dentro del loop creaba un
  // formateador por visita (6.271 en el histórico de una sola sucursal).
  const fmtLocalDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }) // "YYYY-MM-DD"

  /** Visitas con su mes y día LOCALES ya resueltos, para reusar en la comparación por tramo. */
  const visitasLocales: { ym: string; day: number; amount: number; commission: number; esCorte: boolean }[] = []

  // Agrupar visitas por mes local.
  //
  // LA SEÑA NO SE TOCA ACÁ, a propósito (mig 207). `visits.amount` sigue siendo el
  // precio completo del servicio y la seña es sólo una PARTICIÓN del cobro: la
  // misma venta, pagada en dos tiempos. Lo único que cambia es POR DÓNDE entró la
  // plata, y de eso se ocupa `getAllAccountBalanceTotals`.
  for (const v of visits) {
    const localDate = fmtLocalDate.format(new Date(v.completed_at))
    const key = localDate.slice(0, 7)
    const day = Number(localDate.slice(8, 10))
    // Solo cuenta como "corte" si estaba asociado a un servicio o entrada de cola: las
    // visitas sin ninguno de los dos son ventas de producto sueltas (`directProductSale`).
    const esCorte = Boolean(v.service_id || v.queue_entry_id)
    visitasLocales.push({
      ym: key,
      day,
      amount: Number(v.amount),
      commission: Number(v.commission_amount),
      esCorte,
    })
    const m = monthMap.get(key)
    if (m) {
      m.revenue += Number(v.amount)
      m.commissions += Number(v.commission_amount)
      if (esCorte) m.cuts++
    }
  }

  // Agrupar gastos variables por mes local
  for (const e of variableExpenses ?? []) {
    // expense_date ya es "YYYY-MM-DD"
    const key = e.expense_date.slice(0, 7) // "YYYY-MM"
    const m = monthMap.get(key)
    if (m) {
      m.variableExp += Number(e.amount)
    }
  }

  // Agrupar reportes salariales por mes local
  for (const sr of salaryReports ?? []) {
    const key = sr.report_date.slice(0, 7) // "YYYY-MM"
    const m = monthMap.get(key)
    if (!m) continue
    const amt = Math.abs(Number(sr.amount))
    if (sr.type === 'bonus') {
      // Bonos: dinero que sale del negocio hacia el barbero → egreso
      m.bonuses += amt
      m.salaryPayments += amt
    } else if (sr.type === 'advance') {
      // Adelantos: dinero ya entregado, se descuenta del barbero → a favor del negocio
      m.advances += amt
    } else {
      // base_salary, hybrid_deficit pagados → egreso salarial
      m.salaryPayments += amt
      if (sr.type === 'base_salary' || sr.type === 'hybrid_deficit') {
        m.baseSalaryPaid += amt
      }
    }
  }

  const months: MonthlyFinancial[] = [...monthMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ym, d]) => {
      // Gastos fijos históricos: solo los que existían al final de este mes
      const historicalFixed = getHistoricalFixedForMonth(ym)

      // Egresos = comisiones DEVENGADAS + fijos + variables + pagos salariales.
      //
      // UNA SOLA FUENTE POR CONCEPTO (Known Risk #28). Los dos términos que no están:
      //  · `d.bonuses` — el bono se acumula en `bonuses` (desglose) Y en `salaryPayments`
      //    (total real). Sumar las dos variables contaba cada bono dos veces.
      //  · `+ d.advances` en el neto — el adelanto es un anticipo del `base_salary`, que se
      //    cuenta entero como egreso, y el total del lote ya viene neto de él.
      const totalExp = d.commissions + historicalFixed + d.variableExp + d.salaryPayments
      const net = d.revenue - totalExp
      return {
        month: ym,
        label: monthLabel(ym),
        revenue: d.revenue,
        commissions: d.commissions,
        fixedExpenses: historicalFixed,
        variableExpenses: d.variableExp,
        bonuses: d.bonuses,
        advances: d.advances,
        salaryPayments: d.salaryPayments,
        baseSalaryPaid: d.baseSalaryPaid,
        totalExpenses: totalExp,
        netProfit: net,
        cuts: d.cuts,
      }
    })

  const totalRevenue = months.reduce((s, m) => s + m.revenue, 0)
  const totalCuts = months.reduce((s, m) => s + m.cuts, 0)
  const totalCommissions = months.reduce((s, m) => s + m.commissions, 0)
  // Suma real de fijos históricos mes a mes (en lugar de multiplicar fijos actuales × meses)
  const totalFixedAll = months.reduce((s, m) => s + m.fixedExpenses, 0)
  const totalVariable = months.reduce((s, m) => s + m.variableExpenses, 0)
  const totalBonuses = months.reduce((s, m) => s + m.bonuses, 0)
  const totalAdvances = months.reduce((s, m) => s + m.advances, 0)
  const totalSalaryPayments = months.reduce((s, m) => s + m.salaryPayments, 0)
  // Egresos y neto del período = SUMA DE LOS MESES, no una re-derivación a partir de las
  // variables sueltas de arriba: la tarjeta y el gráfico nunca pueden decir cosas distintas
  // sobre la misma plata.
  const totalExpensesAll = months.reduce((s, m) => s + m.totalExpenses, 0)
  const totalNetProfit = months.reduce((s, m) => s + m.netProfit, 0)

  // El ticket promedio es de SERVICIO (Known Risk #31): la plata de las ventas de producto
  // sueltas sale del numerador, porque esas visitas tampoco están en el denominador.
  const totalProductRevenue = visitasLocales.reduce((s, v) => s + (v.esCorte ? 0 : v.amount), 0)
  const avgRevPerCut = totalCuts > 0 ? (totalRevenue - totalProductRevenue) / totalCuts : 0
  const avgCommPerCut = totalCuts > 0 ? totalCommissions / totalCuts : 0
  const netPerCut = avgRevPerCut - avgCommPerCut

  // ── Rendimiento por barbero ──
  const barberMap = new Map<string, { revenue: number; commissions: number; cuts: number }>()
  for (const v of visits) {
    if (!v.barber_id) continue
    const b = barberMap.get(v.barber_id) ?? { revenue: 0, commissions: 0, cuts: 0 }
    b.revenue += Number(v.amount)
    b.commissions += Number(v.commission_amount)
    if (v.service_id || v.queue_entry_id) b.cuts++
    barberMap.set(v.barber_id, b)
  }

  // ── Ingresos por servicio ──
  //
  // Las visitas sin `service_id` van a DOS buckets distintos, no a uno:
  //  · `__venta_producto__` — sin servicio y sin fila: es una venta de producto suelta
  //    (`directProductSale`). Se cuentan las VENTAS, no cortes.
  //  · `__sin_servicio__`   — salió de la fila pero nadie eligió el servicio.
  const serviceMap = new Map<string, { revenue: number; cuts: number }>()
  for (const v of visits) {
    const esVentaProducto = !v.service_id && !v.queue_entry_id
    const key = v.service_id ?? (esVentaProducto ? '__venta_producto__' : '__sin_servicio__')
    const s = serviceMap.get(key) ?? { revenue: 0, cuts: 0 }
    s.revenue += Number(v.amount)
    // Cada fila de este bucket cuenta 1: para servicios y para la fila sin servicio es un
    // corte; para producto es una venta. En los tres casos el divisor del promedio es correcto.
    s.cuts++
    serviceMap.set(key, s)
  }

  // Fetch paralelo: nombres de barberos + nombres de servicios
  const barberIds = [...barberMap.keys()]
  const serviceIds = [...serviceMap.keys()].filter(
    (id): id is string => id !== '__sin_servicio__' && id !== '__venta_producto__' && id !== null
  )

  const sinFilas = { data: null, error: null } as const
  const [staffNamesRes, serviceNamesRes] = await Promise.all([
    barberIds.length > 0 ? supabase.from('staff').select('id, full_name').in('id', barberIds) : Promise.resolve(sinFilas),
    serviceIds.length > 0 ? supabase.from('services').select('id, name').in('id', serviceIds) : Promise.resolve(sinFilas),
  ])
  revisar('nombres de barberos', staffNamesRes.error)
  revisar('nombres de servicios', serviceNamesRes.error)

  const staffNames: Record<string, string> = Object.fromEntries(
    ((staffNamesRes.data ?? []) as { id: string; full_name: string }[]).map(s => [s.id, s.full_name]),
  )
  const serviceNames: Record<string, string> = Object.fromEntries(
    ((serviceNamesRes.data ?? []) as { id: string; name: string }[]).map(s => [s.id, s.name]),
  )

  const barberPerformance: BarberPerformance[] = [...barberMap.entries()]
    .map(([staffId, d]) => ({
      staffId,
      name: staffNames[staffId] ?? 'Desconocido',
      revenue: d.revenue,
      commissions: d.commissions,
      netContribution: d.revenue - d.commissions,
      cuts: d.cuts,
      avgTicket: d.cuts > 0 ? Math.round(d.revenue / d.cuts) : 0,
      marginPct: d.revenue > 0 ? Math.round(((d.revenue - d.commissions) / d.revenue) * 100) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)

  const NOMBRE_BUCKET: Record<string, string> = {
    __venta_producto__: 'Productos (venta directa)',
    __sin_servicio__: 'Cortes sin servicio cargado',
  }
  const serviceRevenue: ServiceRevenue[] = [...serviceMap.entries()]
    .map(([serviceId, d]) => ({
      serviceId: NOMBRE_BUCKET[serviceId] ? null : serviceId,
      serviceName: NOMBRE_BUCKET[serviceId] ?? serviceNames[serviceId] ?? 'Servicio eliminado',
      revenue: d.revenue,
      cuts: d.cuts,
      avgTicket: d.cuts > 0 ? Math.round(d.revenue / d.cuts) : 0,
    }))
    .filter(s => s.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue)

  // ── MoM: comparar el último mes COMPLETO vs el penúltimo ──
  function pctChange(current: number, previous: number): number | null {
    if (previous === 0) return null
    return Math.round(((current - previous) / Math.abs(previous)) * 100)
  }

  // Si el último mes del array es el mes en curso (el REAL) sin datos (recién comenzó),
  // la comparación significativa es el penúltimo vs el antepenúltimo.
  const actualLastMonth = months[months.length - 1]
  const currentMonthIsEmpty = actualLastMonth?.month === mesReal
    && actualLastMonth.revenue === 0
    && actualLastMonth.cuts === 0
  const momBaseIdx = currentMonthIsEmpty ? months.length - 2 : months.length - 1
  const lastMonth = months[momBaseIdx] ?? actualLastMonth
  const prevMonth = momBaseIdx >= 1 ? months[momBaseIdx - 1] : null

  // ── Mes en curso: se compara TRAMO CONTRA TRAMO (Known Risk #29) ──
  //
  // Cuando el mes de referencia es el mes en curso, el mes anterior se recorta al mismo
  // día. Los gastos fijos se prorratean por días transcurridos, que es la única forma de
  // que un neto parcial sea comparable contra otro neto parcial. "En curso" = el mes
  // REAL de hoy, nunca el mes del ancla.
  const refEsMesEnCurso = lastMonth?.month === mesReal
  const [refY, refM] = (lastMonth?.month ?? mesReal).split('-').map(Number)
  const daysInMonth = new Date(Date.UTC(refY, refM, 0)).getUTCDate()
  const daysElapsed = refEsMesEnCurso ? ahora.getUTCDate() : daysInMonth
  const isPartial = refEsMesEnCurso && daysElapsed < daysInMonth

  /** Recorta un mes a sus primeros `dayLimit` días. Devuelve las métricas comparables. */
  function tramoDelMes(m: MonthlyFinancial, dayLimit: number) {
    if (dayLimit >= 28 && !isPartial) {
      return { revenue: m.revenue, cuts: m.cuts, commissions: m.commissions, variableExpenses: m.variableExpenses, netProfit: m.netProfit }
    }
    let revenue = 0, cuts = 0, commissions = 0
    for (const v of visitasLocales) {
      if (v.ym !== m.month || v.day > dayLimit) continue
      revenue += v.amount
      commissions += v.commission
      if (v.esCorte) cuts++
    }
    let variableExp = 0
    for (const e of variableExpenses ?? []) {
      if (e.expense_date.slice(0, 7) !== m.month) continue
      if (Number(e.expense_date.slice(8, 10)) > dayLimit) continue
      variableExp += Number(e.amount)
    }
    let salaryPayments = 0
    for (const sr of salaryReports ?? []) {
      if (sr.type === 'advance') continue
      if (sr.report_date.slice(0, 7) !== m.month) continue
      if (Number(sr.report_date.slice(8, 10)) > dayLimit) continue
      salaryPayments += Math.abs(Number(sr.amount))
    }
    // Los fijos son un costo del mes entero: para comparar tramos hay que prorratearlos.
    const fixedProrrateado = m.fixedExpenses * (dayLimit / daysInMonth)
    const netProfit = revenue - (commissions + fixedProrrateado + variableExp + salaryPayments)
    return { revenue, cuts, commissions, variableExpenses: variableExp, netProfit }
  }

  const refTramo = lastMonth ? tramoDelMes(lastMonth, daysElapsed) : null
  const prevTramo = prevMonth ? tramoDelMes(prevMonth, daysElapsed) : null

  const momChange: MoMChange = {
    revenue: refTramo && prevTramo ? pctChange(refTramo.revenue, prevTramo.revenue) : null,
    commissions: refTramo && prevTramo ? pctChange(refTramo.commissions, prevTramo.commissions) : null,
    variableExpenses: refTramo && prevTramo ? pctChange(refTramo.variableExpenses, prevTramo.variableExpenses) : null,
    netProfit: refTramo && prevTramo ? pctChange(refTramo.netProfit, prevTramo.netProfit) : null,
    cuts: refTramo && prevTramo ? pctChange(refTramo.cuts, prevTramo.cuts) : null,
    isPartial,
    daysElapsed,
    daysInMonth,
  }

  return {
    months,
    breakEven: {
      cutsNeeded: netPerCut > 0 ? Math.ceil(currentMonthlyFixed / netPerCut) : 0,
      avgRevenuePerCut: Math.round(avgRevPerCut),
      avgCommissionPerCut: Math.round(avgCommPerCut),
      netPerCut: Math.round(netPerCut),
      monthlyFixedExpenses: currentMonthlyFixed,
    },
    totals: {
      revenue: totalRevenue,
      commissions: totalCommissions,
      fixedExpenses: totalFixedAll,
      variableExpenses: totalVariable,
      bonuses: totalBonuses,
      advances: totalAdvances,
      salaryPayments: totalSalaryPayments,
      totalExpenses: totalExpensesAll,
      netProfit: totalNetProfit,
      cuts: totalCuts,
    },
    momChange,
    currentMonthCuts: actualLastMonth?.cuts ?? 0,
    currentMonthRevenue: actualLastMonth?.revenue ?? 0,
    barberPerformance,
    serviceRevenue,
  }
}
