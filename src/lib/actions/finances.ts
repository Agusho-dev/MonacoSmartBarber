'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { revalidatePath } from 'next/cache'
import { getMonthBoundsStr, getLocalNow, getPeriodBoundsStr } from '@/lib/time-utils'
import { getActiveTimezone } from '@/lib/i18n'
import { validateBranchAccess, getCurrentOrgId } from './org'
import { getScopedBranchIds } from './branch-access'

export interface MonthlyFinancial {
  month: string
  label: string
  revenue: number
  commissions: number
  fixedExpenses: number
  variableExpenses: number
  bonuses: number
  advances: number
  salaryPayments: number
  baseSalaryPaid: number   // sueldos fijos y híbridos pagados (base_salary + hybrid_deficit)
  totalExpenses: number
  netProfit: number
  cuts: number
}

export interface BreakEvenData {
  cutsNeeded: number
  avgRevenuePerCut: number
  avgCommissionPerCut: number
  netPerCut: number
  monthlyFixedExpenses: number
}

export interface MoMChange {
  revenue: number | null        // % cambio vs mes anterior (null si sin dato previo)
  commissions: number | null
  variableExpenses: number | null
  netProfit: number | null
  cuts: number | null
  /**
   * true = el mes de referencia es el mes EN CURSO, o sea incompleto. Cuando es true, los
   * porcentajes de arriba comparan contra el MISMO TRAMO DE DÍAS del mes anterior, no contra
   * el mes anterior completo, y la UI tiene que decirlo.
   *
   * Antes se comparaba medio mes contra un mes entero: el 13/08/2026 la pantalla informaba
   * -50% de ingresos y -50% de cortes en Paraná cuando el like-for-like (1-13 ago vs 1-13 jul)
   * era +17,8% en las dos métricas. Le decía al dueño que se le cayó el negocio a la mitad
   * justo en su mejor mes.
   */
  isPartial: boolean
  daysElapsed: number
  daysInMonth: number
}

export interface BarberPerformance {
  staffId: string
  name: string
  revenue: number
  commissions: number
  netContribution: number  // revenue - commissions
  cuts: number
  avgTicket: number
  marginPct: number        // Math.round((netContribution / revenue) * 100), 0 si revenue=0
}

export interface ServiceRevenue {
  serviceId: string | null
  serviceName: string
  revenue: number
  cuts: number
  avgTicket: number
}

export interface FinancialSummary {
  months: MonthlyFinancial[]
  breakEven: BreakEvenData
  totals: {
    revenue: number
    commissions: number
    fixedExpenses: number
    variableExpenses: number
    bonuses: number          // desglose informativo: YA está dentro de salaryPayments
    advances: number         // desglose informativo: NO se suma ni se resta del neto
    salaryPayments: number
    /** Egresos del período. Es la suma de `months[].totalExpenses`, no una re-derivación. */
    totalExpenses: number
    netProfit: number
    cuts: number
  }
  // Campos adicionales para análisis comparativo y desglose
  momChange: MoMChange
  currentMonthCuts: number       // cortes del mes actual (último mes del array)
  currentMonthRevenue: number    // ingresos del mes actual
  barberPerformance: BarberPerformance[]
  serviceRevenue: ServiceRevenue[]
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

/**
 * Resultado vacío para cuando el scope no autoriza nada. Mismo patrón que `fetchStats`
 * (`stats.ts`): un `branchId` que no pertenece a la org no devuelve datos ajenos.
 */
function emptyFinancialSummary(): FinancialSummary {
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

/** Fila mínima que necesita el gráfico "Egresos por categoría". */
export interface PeriodExpenseRow {
  category: string
  amount: number
  payment_account_id: string | null
  branch_id: string
  /**
   * `manual` | `fixed_expense_period` | `salary_batch` | `tip_batch`.
   *
   * El donut muestra TODA la plata que salió, así que necesita distinguir de dónde viene cada
   * peso: la tarjeta "Gastos variables" cuenta sólo `manual`, y sin este campo el donut decía
   * $27.769.880 al lado de una tarjeta de $23.934.865 sin ninguna forma de explicar la
   * diferencia.
   */
  source: string
}

/**
 * Egresos del período, para el gráfico por categoría del resumen.
 *
 * Existe porque ese gráfico se alimentaba de la lista de la pestaña "Egresos":
 * `.limit(100)` y SIN filtro de fecha. Sumaba todos los gastos desde el primer día
 * (en agosto seguía mostrando el alquiler de julio) y, pasados 100 tickets, los más
 * viejos desaparecían sin aviso. Acá el rango es el mismo del resto de la pantalla
 * y `fetchAll` drena todas las filas.
 */
export async function fetchExpensesByCategory(
  monthsBack: number,
  branchId?: string | null,
  endMonth?: string | null,
): Promise<PeriodExpenseRow[]> {
  const supabase = createAdminClient()

  let scopeBranchIds: string[]
  if (branchId) {
    const orgId = await validateBranchAccess(branchId)
    if (!orgId) return []
    scopeBranchIds = [branchId]
  } else {
    scopeBranchIds = await getScopedBranchIds()
    if (scopeBranchIds.length === 0) return []
  }

  const tz = await getActiveTimezone()
  const range = getPeriodBoundsStr(monthsBack, tz, endMonth)

  return fetchAll<PeriodExpenseRow>((from, to) => {
    let q = supabase
      .from('expense_tickets')
      .select('category, amount, payment_account_id, branch_id, source')
      .in('branch_id', scopeBranchIds)
    if (range) {
      q = q.gte('expense_date', range.start.slice(0, 10)).lte('expense_date', range.end.slice(0, 10))
    }
    return q.order('expense_date').range(from, to)
  })
}

export async function fetchFinancialData(
  monthsBack: number,   // 0 = desde el primer registro histórico
  branchId?: string | null,
  endMonth?: string | null  // "YYYY-MM" — si se pasa, se usa como mes final en vez del actual
): Promise<FinancialSummary> {
  // `createAdminClient()`, como TODO el resto del camino financiero (`stats.ts`,
  // `paymentAccounts.ts`, `salary.ts`, `tips.ts`, `caja.ts`, `fixed-expenses.ts` y
  // `fetchExpensesByCategory` acá arriba). Era el último fetch de plata que quedaba con el
  // cliente RLS, y la policy de `expense_tickets` resuelve sucursales por `staff.branch_id`
  // dando el total SÓLO a `role='owner'` o `manage_all_branches`: un ADMIN pedía 4 sucursales
  // y la RLS devolvía 2, sin ningún aviso. Medido: Gonzalo Tassistro (admin) veía $0 de gastos
  // variables en junio contra $13.937.900 reales, y en la misma pantalla el donut —que sí usa
  // admin client— mostraba otro número.
  const supabase = createAdminClient()
  let localNow = getLocalNow()

  // Si se especifica un mes final, usarlo como referencia en vez del mes actual
  if (endMonth) {
    const [ey, em] = endMonth.split('-').map(Number)
    // Último día del mes solicitado, a las 23:59:59 UTC
    localNow = new Date(Date.UTC(ey, em - 1, 15))
  }

  // Resolver el scope de branches para filtrar: una sucursal específica o todas las de la org.
  //
  // La validación del `branchId` es OBLIGATORIA ahora que abajo corre con service role: este
  // archivo es `'use server'`, así que cada export es un endpoint HTTP con un action-id que
  // viaja en el bundle del cliente. Mientras el fetch usaba el cliente RLS, la policy contenía
  // el scope; con admin client, sin este chequeo alcanzaría el UUID de una sucursal ajena para
  // leer las finanzas completas de otra organización.
  let orgBranchIds: string[] = []
  let orgId: string | null
  if (branchId) {
    orgId = await validateBranchAccess(branchId)
    if (!orgId) return emptyFinancialSummary()
  } else {
    orgId = await getCurrentOrgId()
    orgBranchIds = await getScopedBranchIds()
    if (orgBranchIds.length === 0) return emptyFinancialSummary()
  }

  // Si monthsBack === 0, detectar el primer mes con registros para mostrar todo el historial
  let actualMonthsBack = monthsBack
  if (monthsBack === 0) {
    let eq = supabase
      .from('visits')
      .select('completed_at')
      .order('completed_at', { ascending: true })
      .limit(1)
    if (branchId) {
      eq = eq.eq('branch_id', branchId)
    } else {
      eq = eq.in('branch_id', orgBranchIds)
    }
    const { data: earliest } = await eq
    if (earliest && earliest.length > 0) {
      const firstDate = new Date(earliest[0].completed_at)
      const monthsDiff =
        (localNow.getUTCFullYear() - firstDate.getUTCFullYear()) * 12 +
        (localNow.getUTCMonth() - firstDate.getUTCMonth()) + 1
      actualMonthsBack = Math.max(monthsDiff, 1)
    } else {
      actualMonthsBack = 12
    }
  }

  const tz = await getActiveTimezone()
  // Misma ventana que piden "Saldo por cuenta" y "Egresos por categoría": una sola
  // definición de período para toda la pantalla (`getPeriodBoundsStr`).
  const { start: startDateStr, end: endDateStr } =
    getPeriodBoundsStr(actualMonthsBack, tz, endMonth) ??
    getMonthBoundsStr(actualMonthsBack, tz, localNow)

  // ── Queries paralelas: todas las fuentes de datos del rango ──
  const branchFilter = <T extends { eq: (col: string, val: string) => T; in: (col: string, vals: string[]) => T }>(q: T, col = 'branch_id') =>
    branchId ? q.eq(col, branchId) : q.in(col, orgBranchIds)

  // visits puede superar el cap default de PostgREST (1000 filas) en rangos largos
  // o sucursales con alto volumen → paginar con range() para drenar todas las filas.
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
    q = branchFilter(q)
    return q.range(from, to)
  })

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
  // org-wide de CUALQUIER organización entraría en los egresos de esta org. Hoy no hay ninguna
  // fila con `branch_id IS NULL` en la base, así que la fuga era latente — pero migrar a admin
  // client sin cerrarla la habría activado.
  if (orgId) fpq = fpq.eq('organization_id', orgId)
  if (branchId) {
    fpq = fpq.eq('branch_id', branchId)
  } else if (orgBranchIds.length > 0) {
    // Incluye gastos org-wide (branch_id null pero organization_id = org, ya filtrado arriba).
    fpq = fpq.or(`branch_id.in.(${orgBranchIds.join(',')}),branch_id.is.null`)
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
  // dos veces: en Paraná la igualdad mes a mes era exacta ($6.000 mar / $103.200 abr /
  // $102.400 may / $233.000 jun / $164.000 jul). La base contable es el DEVENGADO —no depende
  // de que el dueño liquide—, así que la fuente es `visits` y punto.
  let sq = supabase
    .from('salary_reports')
    .select('type, amount, report_date, status')
    .in('type', ['bonus', 'advance', 'base_salary', 'hybrid_deficit'])
    .eq('status', 'paid')
    .gte('report_date', startDateStr.slice(0, 10))
    .lte('report_date', endDateStr.slice(0, 10))
  sq = branchFilter(sq)

  const [
    visits,
    { data: allFixedExpenses },
    { data: fixedExpensePayments },
    { data: variableExpenses },
    { data: salaryReports },
  ] = await Promise.all([visitsPromise, fq, fpq, eq, sq])

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

  // Inicializar todos los meses usando hora local para agrupar
  const monthMap = new Map<string, { revenue: number; commissions: number; cuts: number; variableExp: number; bonuses: number; advances: number; salaryPayments: number; baseSalaryPaid: number }>()
  for (let i = 0; i < actualMonthsBack; i++) {
    let year = localNow.getUTCFullYear()
    let monthIndex = localNow.getUTCMonth() - i
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

  // Agrupar visitas por mes local
  for (const v of visits ?? []) {
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
      // commission, base_salary, hybrid_deficit pagados → egreso salarial
      const absAmt = Math.abs(Number(sr.amount))
      m.salaryPayments += absAmt
      if (sr.type === 'base_salary' || sr.type === 'hybrid_deficit') {
        m.baseSalaryPaid += absAmt
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
      // UNA SOLA FUENTE POR CONCEPTO. Los dos términos que estaban acá y ya no están:
      //  · `d.bonuses` — el bono se acumula en `bonuses` (desglose) Y en `salaryPayments`
      //    (total real) 20 líneas más arriba. Sumar las dos variables contaba cada bono dos
      //    veces: $2.015.014 en la org (Paraná may $1.215.013, jun $800.000).
      //  · `+ d.advances` en el neto — el adelanto es un anticipo del `base_salary`, que se
      //    cuenta entero como egreso, y el total del lote ya viene neto de él. Acreditarlo
      //    otra vez regalaba $2.417.109 de ganancia inexistente.
      // La tercera pata del doble conteo se cierra afuera: los `expense_tickets` de los lotes
      // de sueldo dejan de ser `source='manual'` (migración 186), así que la misma plata no
      // entra como "gasto variable" además de como pago salarial ($23.393.104 en la org).
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
  // variables sueltas de arriba. Es la vacuna estructural contra la clase de bug que tenía
  // este archivo: la fórmula del total y la del mes eran dos expresiones distintas de lo
  // mismo, y cuando una se corrige y la otra no, la tarjeta y el gráfico dicen cosas
  // diferentes sobre la misma plata.
  const totalExpensesAll = months.reduce((s, m) => s + m.totalExpenses, 0)
  const totalNetProfit = months.reduce((s, m) => s + m.netProfit, 0)

  // El ticket promedio es de SERVICIO: la plata de las ventas de producto sueltas sale del
  // numerador, porque esas visitas tampoco están en el denominador (`totalCuts` las excluye).
  // Con producto de un solo lado, el promedio quedaba inflado — julio en Paraná daba $16.697
  // cuando el ticket de servicio es $16.484, $213 de más que salían de $255.000 de ceras y
  // cremas repartidos entre 1.200 cortes. Y `netPerCut` alimenta el punto de equilibrio, que
  // es una métrica de servicio: mezclarle producto lo corre sin que se note.
  const totalProductRevenue = visitasLocales.reduce((s, v) => s + (v.esCorte ? 0 : v.amount), 0)
  const avgRevPerCut = totalCuts > 0 ? (totalRevenue - totalProductRevenue) / totalCuts : 0
  const avgCommPerCut = totalCuts > 0 ? totalCommissions / totalCuts : 0
  const netPerCut = avgRevPerCut - avgCommPerCut

  // ── Rendimiento por barbero ──
  const barberMap = new Map<string, { revenue: number; commissions: number; cuts: number }>()
  for (const v of visits ?? []) {
    if (!v.barber_id) continue
    const b = barberMap.get(v.barber_id) ?? { revenue: 0, commissions: 0, cuts: 0 }
    b.revenue += Number(v.amount)
    b.commissions += Number(v.commission_amount)
    if (v.service_id || v.queue_entry_id) b.cuts++
    barberMap.set(v.barber_id, b)
  }

  // ── Ingresos por servicio (agregar antes del fetch paralelo) ──
  //
  // Las visitas sin `service_id` van a DOS buckets distintos, no a uno:
  //  · `__venta_producto__` — sin servicio y sin fila: es una venta de producto suelta
  //    (`directProductSale`). Se cuentan las VENTAS, no cortes.
  //  · `__sin_servicio__`   — salió de la fila pero nadie eligió el servicio.
  // Antes iban juntas al mismo bucket y ahí el guard `service_id || queue_entry_id` se degradaba
  // a `queue_entry_id`, o sea contaba sólo la segunda mitad mientras sumaba la plata de las dos:
  // julio en Paraná imprimía "$255.000 · 0 cortes · $0 prom." (se lee como pantalla rota) y
  // junio "$204.000 · 1 corte · $204.000 prom." sobre 10 visitas de $20.400 reales.
  const serviceMap = new Map<string, { revenue: number; cuts: number }>()
  for (const v of visits ?? []) {
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

  const [staffNamesRaw, serviceNamesRaw] = await Promise.all([
    barberIds.length > 0
      ? supabase.from('staff').select('id, full_name').in('id', barberIds).then(r => r.data)
      : Promise.resolve(null),
    serviceIds.length > 0
      ? supabase.from('services').select('id, name').in('id', serviceIds).then(r => r.data)
      : Promise.resolve(null),
  ])

  const staffNames: Record<string, string> = Object.fromEntries((staffNamesRaw ?? []).map(s => [s.id, s.full_name]))
  const serviceNames: Record<string, string> = Object.fromEntries((serviceNamesRaw ?? []).map(s => [s.id, s.name]))

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

  // Si el último mes del array es el mes actual sin datos (recién comenzó),
  // la comparación significativa es el penúltimo vs el antepenúltimo.
  const currentYM = `${localNow.getUTCFullYear()}-${String(localNow.getUTCMonth() + 1).padStart(2, '0')}`
  const actualLastMonth = months[months.length - 1]
  const currentMonthIsEmpty = actualLastMonth?.month === currentYM
    && actualLastMonth.revenue === 0
    && actualLastMonth.cuts === 0
  const momBaseIdx = currentMonthIsEmpty ? months.length - 2 : months.length - 1
  const lastMonth = months[momBaseIdx] ?? actualLastMonth
  const prevMonth = momBaseIdx >= 1 ? months[momBaseIdx - 1] : null

  // ── Mes en curso: se compara TRAMO CONTRA TRAMO ──
  //
  // El único resguardo que había (`currentMonthIsEmpty`) sólo se activaba el día 1: del 2 en
  // adelante esto comparaba medio mes contra un mes entero. El 13/08/2026 en Paraná informaba
  // -50% de ingresos y -50% de cortes cuando el like-for-like (1-13 ago vs 1-13 jul) era
  // +17,8% en las dos: la pantalla anunciaba un derrumbe en el mejor mes de la sucursal.
  //
  // Ahora, cuando el mes de referencia es el mes en curso, el mes anterior se recorta al mismo
  // día. Los gastos fijos se prorratean por días transcurridos, que es la única forma de que
  // un neto parcial sea comparable contra otro neto parcial.
  const refEsMesEnCurso = lastMonth?.month === currentYM
  const [refY, refM] = (lastMonth?.month ?? currentYM).split('-').map(Number)
  const daysInMonth = new Date(Date.UTC(refY, refM, 0)).getUTCDate()
  const daysElapsed = refEsMesEnCurso ? localNow.getUTCDate() : daysInMonth
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
    // Nuevos campos
    momChange,
    currentMonthCuts: actualLastMonth?.cuts ?? 0,
    currentMonthRevenue: actualLastMonth?.revenue ?? 0,
    barberPerformance,
    serviceRevenue,
  }
}

/* ─── Fixed Expenses CRUD ─── */

export async function getFixedExpenses(branchId?: string | null) {
  const supabase = await createClient()
  let q = supabase
    .from('fixed_expenses')
    .select('*, branch:branches(name)')
    .order('name')
  if (branchId) {
    q = q.eq('branch_id', branchId)
  } else {
    const orgBranchIds = await getScopedBranchIds()
    q = q.in('branch_id', orgBranchIds)
  }
  const { data } = await q
  return data ?? []
}

export async function upsertFixedExpense(data: {
  id?: string
  branch_id: string
  name: string
  category?: string | null
  amount: number
  due_day?: number | null   // día de vencimiento del mes
  is_active?: boolean
}) {
  // NOTA: duplicado MUERTO. El catálogo de gastos fijos usa las versiones vivas de
  // `fixed-expenses.ts` (createAdminClient). Estas dos (upsert/delete) no tienen callers.
  // Se dejan alineadas al patrón admin+validateBranchAccess por si alguna vez se re-wirean.
  const orgId = await validateBranchAccess(data.branch_id)
  if (!orgId) return { error: 'No tienes acceso a esta sucursal' }

  const supabase = createAdminClient()

  if (data.id) {
    // Validar la fila existente (no confiar en el branch del form) antes de update por id.
    const { data: existing } = await supabase
      .from('fixed_expenses')
      .select('branch_id')
      .eq('id', data.id)
      .maybeSingle()
    if (!existing) return { error: 'Gasto fijo no encontrado' }
    if (!(await validateBranchAccess(existing.branch_id))) return { error: 'No autorizado' }

    const { error } = await supabase
      .from('fixed_expenses')
      .update({
        name: data.name,
        category: data.category || null,
        amount: data.amount,
        due_day: data.due_day ?? null,
        is_active: data.is_active ?? true,
      })
      .eq('id', data.id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase.from('fixed_expenses').insert({
      branch_id: data.branch_id,
      name: data.name,
      category: data.category || null,
      amount: data.amount,
      due_day: data.due_day ?? null,
      is_active: data.is_active ?? true,
    })
    if (error) return { error: error.message }
  }

  revalidatePath('/dashboard/finanzas')
  return { success: true }
}

export async function deleteFixedExpense(id: string) {
  // Duplicado MUERTO (ver upsertFixedExpense arriba): el catálogo usa fixed-expenses.ts.
  const supabase = createAdminClient()

  // Obtener el gasto para verificar a qué sucursal pertenece
  const { data: expense, error: fetchError } = await supabase
    .from('fixed_expenses')
    .select('branch_id')
    .eq('id', id)
    .maybeSingle()

  if (fetchError) {
    console.error('Error al obtener gasto fijo:', fetchError)
    return { error: 'Error al verificar el gasto fijo' }
  }
  if (!expense) return { error: 'Gasto fijo no encontrado' }

  // Validar que la sucursal del gasto pertenece a la organización del usuario
  const orgId = await validateBranchAccess(expense.branch_id)
  if (!orgId) return { error: 'No tienes acceso a esta sucursal' }

  const { error } = await supabase.from('fixed_expenses').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/dashboard/finanzas')
  return { success: true }
}
