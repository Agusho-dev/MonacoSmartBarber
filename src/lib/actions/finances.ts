'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getMonthBoundsStr, getLocalNow } from '@/lib/time-utils'
import { getActiveTimezone } from '@/lib/i18n'
import { validateBranchAccess, getOrgBranchIds } from './org'

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
    bonuses: number
    advances: number
    salaryPayments: number
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

export async function fetchFinancialData(
  monthsBack: number,   // 0 = desde el primer registro histórico
  branchId?: string | null,
  endMonth?: string | null  // "YYYY-MM" — si se pasa, se usa como mes final en vez del actual
): Promise<FinancialSummary> {
  const supabase = await createClient()
  let localNow = getLocalNow()

  // Si se especifica un mes final, usarlo como referencia en vez del mes actual
  if (endMonth) {
    const [ey, em] = endMonth.split('-').map(Number)
    // Último día del mes solicitado, a las 23:59:59 UTC
    localNow = new Date(Date.UTC(ey, em - 1, 15))
  }

  // Resolver el scope de branches para filtrar: una sucursal específica o todas las de la org
  let orgBranchIds: string[] = []
  if (!branchId) {
    orgBranchIds = await getOrgBranchIds()
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
  const { start: startDateStr, end: endDateStr } = getMonthBoundsStr(actualMonthsBack, tz, localNow)

  // ── Queries paralelas: todas las fuentes de datos del rango ──
  const branchFilter = <T extends { eq: (col: string, val: string) => T; in: (col: string, vals: string[]) => T }>(q: T, col = 'branch_id') =>
    branchId ? q.eq(col, branchId) : q.in(col, orgBranchIds)

  let vq = supabase
    .from('visits')
    .select('amount, commission_amount, completed_at, branch_id, service_id, queue_entry_id, barber_id')
    .gte('completed_at', startDateStr)
    .lte('completed_at', endDateStr)
  vq = branchFilter(vq)

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
  if (branchId) {
    fpq = fpq.eq('branch_id', branchId)
  } else if (orgBranchIds.length > 0) {
    // Incluye gastos org-wide (branch_id null pero organization_id = org)
    // Para org-wide sin branchFilter específico hay que hacer una condición compuesta.
    // Estrategia: traer todos los períodos de las branches de la org + los org-wide,
    // filtrando por organization_id usando la FK.
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

  let sq = supabase
    .from('salary_reports')
    .select('type, amount, report_date, status')
    .in('type', ['bonus', 'advance', 'commission', 'base_salary', 'hybrid_deficit', 'product_commission'])
    .eq('status', 'paid')
    .gte('report_date', startDateStr.slice(0, 10))
    .lte('report_date', endDateStr.slice(0, 10))
  sq = branchFilter(sq)

  const [
    { data: visits },
    { data: allFixedExpenses },
    { data: fixedExpensePayments },
    { data: variableExpenses },
    { data: salaryReports },
  ] = await Promise.all([vq, fq, fpq, eq, sq])

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

  // Agrupar visitas por mes local usando Intl
  for (const v of visits ?? []) {
    // Convertir timestamp UTC a "YYYY-MM" local
    const localMonth = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
    }).format(new Date(v.completed_at)) // retorna "YYYY-MM"
    const key = localMonth
    const m = monthMap.get(key)
    if (m) {
      m.revenue += Number(v.amount)
      m.commissions += Number(v.commission_amount)
      // Solo contar como "corte" si estaba asociado a un servicio o entrada de cola
      if (v.service_id || v.queue_entry_id) {
        m.cuts++
      }
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
      // Egresos totales = comisiones + fijos históricos + variables + bonos + pagos salariales
      // Los adelantos se restan porque son dinero a favor del negocio (ya entregado, se descuenta)
      const totalExp = d.commissions + historicalFixed + d.variableExp + d.bonuses + d.salaryPayments
      const net = d.revenue - totalExp + d.advances
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

  const avgRevPerCut = totalCuts > 0 ? totalRevenue / totalCuts : 0
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
  const serviceMap = new Map<string, { revenue: number; cuts: number }>()
  for (const v of visits ?? []) {
    const key = v.service_id ?? '__sin_servicio__'
    const s = serviceMap.get(key) ?? { revenue: 0, cuts: 0 }
    s.revenue += Number(v.amount)
    if (v.service_id || v.queue_entry_id) s.cuts++
    serviceMap.set(key, s)
  }

  // Fetch paralelo: nombres de barberos + nombres de servicios
  const barberIds = [...barberMap.keys()]
  const serviceIds = [...serviceMap.keys()].filter((id): id is string => id !== '__sin_servicio__' && id !== null)

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

  const serviceRevenue: ServiceRevenue[] = [...serviceMap.entries()]
    .map(([serviceId, d]) => ({
      serviceId: serviceId === '__sin_servicio__' ? null : serviceId,
      serviceName: serviceId === '__sin_servicio__' ? 'Sin servicio' : (serviceNames[serviceId] ?? 'Servicio eliminado'),
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

  const momChange: MoMChange = {
    revenue: prevMonth ? pctChange(lastMonth.revenue, prevMonth.revenue) : null,
    commissions: prevMonth ? pctChange(lastMonth.commissions, prevMonth.commissions) : null,
    variableExpenses: prevMonth ? pctChange(lastMonth.variableExpenses, prevMonth.variableExpenses) : null,
    netProfit: prevMonth ? pctChange(lastMonth.netProfit, prevMonth.netProfit) : null,
    cuts: prevMonth ? pctChange(lastMonth.cuts, prevMonth.cuts) : null,
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
      netProfit: totalRevenue - totalCommissions - totalFixedAll - totalVariable - totalBonuses - totalSalaryPayments + totalAdvances,
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
    const orgBranchIds = await getOrgBranchIds()
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
  // Validar que la sucursal pertenece a la organización del usuario
  const orgId = await validateBranchAccess(data.branch_id)
  if (!orgId) return { error: 'No tienes acceso a esta sucursal' }

  const supabase = await createClient()

  if (data.id) {
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
  const supabase = await createClient()

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
