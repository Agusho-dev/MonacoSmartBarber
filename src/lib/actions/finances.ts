'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getMonthBoundsStr, getLocalNow } from '@/lib/time-utils'
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
  monthsBack: number,
  branchId?: string | null
): Promise<FinancialSummary> {
  const supabase = await createClient()

  const { start: startDateStr, end: endDateStr } = getMonthBoundsStr(monthsBack)
  const localNow = getLocalNow()

  // Resolver el scope de branches para filtrar: una sucursal específica o todas las de la org
  let orgBranchIds: string[] = []
  if (!branchId) {
    orgBranchIds = await getOrgBranchIds()
  }

  // Visits en el rango — incluye barber_id para el desglose por barbero
  let vq = supabase
    .from('visits')
    .select('amount, commission_amount, completed_at, branch_id, service_id, queue_entry_id, barber_id')
    .gte('completed_at', startDateStr)
    .lte('completed_at', endDateStr)
  if (branchId) {
    vq = vq.eq('branch_id', branchId)
  } else {
    vq = vq.in('branch_id', orgBranchIds)
  }
  const { data: visits } = await vq

  // Todos los gastos fijos (activos e inactivos) con created_at para cálculo histórico preciso
  let fq = supabase
    .from('fixed_expenses')
    .select('amount, branch_id, created_at, is_active')
  if (branchId) {
    fq = fq.eq('branch_id', branchId)
  } else {
    fq = fq.in('branch_id', orgBranchIds)
  }
  const { data: allFixedExpenses } = await fq

  // Calcula los gastos fijos que existían al final de un mes dado
  function getHistoricalFixedForMonth(ym: string): number {
    const [y, m] = ym.split('-')
    // Último instante del mes
    const monthEnd = new Date(Number(y), Number(m), 0, 23, 59, 59, 999)
    return (allFixedExpenses ?? [])
      .filter(e => new Date(e.created_at) <= monthEnd)
      .reduce((s, e) => s + Number(e.amount), 0)
  }

  // Para break-even: solo gastos fijos activos actualmente
  const currentMonthlyFixed = (allFixedExpenses ?? [])
    .filter(e => e.is_active)
    .reduce((s, e) => s + Number(e.amount), 0)

  // Gastos variables (expense_tickets) en el rango
  let eq = supabase
    .from('expense_tickets')
    .select('amount, expense_date, branch_id')
    .gte('expense_date', startDateStr.slice(0, 10))
    .lte('expense_date', endDateStr.slice(0, 10))
  if (branchId) {
    eq = eq.eq('branch_id', branchId)
  } else {
    eq = eq.in('branch_id', orgBranchIds)
  }
  const { data: variableExpenses } = await eq

  // Reportes salariales (bonos, adelantos, pagos) en el rango
  let sq = supabase
    .from('salary_reports')
    .select('type, amount, report_date, status')
    .in('type', ['bonus', 'advance', 'commission', 'base_salary', 'hybrid_deficit'])
    .eq('status', 'paid')
    .gte('report_date', startDateStr.slice(0, 10))
    .lte('report_date', endDateStr.slice(0, 10))
  if (branchId) {
    sq = sq.eq('branch_id', branchId)
  } else {
    sq = sq.in('branch_id', orgBranchIds)
  }
  const { data: salaryReports } = await sq

  // Inicializar todos los meses usando hora local para agrupar
  const monthMap = new Map<string, { revenue: number; commissions: number; cuts: number; variableExp: number; bonuses: number; advances: number; salaryPayments: number; baseSalaryPaid: number }>()
  for (let i = 0; i < monthsBack; i++) {
    let year = localNow.getFullYear()
    let monthIndex = localNow.getMonth() - i
    while (monthIndex < 0) {
      monthIndex += 12
      year -= 1
    }
    const d = new Date(year, monthIndex, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    monthMap.set(key, { revenue: 0, commissions: 0, cuts: 0, variableExp: 0, bonuses: 0, advances: 0, salaryPayments: 0, baseSalaryPaid: 0 })
  }

  const TZ = 'America/Argentina/Buenos_Aires'

  // Agrupar visitas por mes local usando Intl
  for (const v of visits ?? []) {
    // Convertir timestamp UTC a "YYYY-MM" local
    const localMonth = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
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

  // Obtener nombres de barberos en una sola consulta
  const barberIds = [...barberMap.keys()]
  let staffNames: Record<string, string> = {}
  if (barberIds.length > 0) {
    const { data: staffData } = await supabase
      .from('staff')
      .select('id, full_name')
      .in('id', barberIds)
    staffNames = Object.fromEntries((staffData ?? []).map(s => [s.id, s.full_name]))
  }

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

  // ── Ingresos por servicio ──
  const serviceMap = new Map<string, { revenue: number; cuts: number }>()
  for (const v of visits ?? []) {
    const key = v.service_id ?? '__sin_servicio__'
    const s = serviceMap.get(key) ?? { revenue: 0, cuts: 0 }
    s.revenue += Number(v.amount)
    if (v.service_id || v.queue_entry_id) s.cuts++
    serviceMap.set(key, s)
  }

  // Obtener nombres de servicios en una sola consulta
  const serviceIds = [...serviceMap.keys()].filter((id): id is string => id !== '__sin_servicio__' && id !== null)
  let serviceNames: Record<string, string> = {}
  if (serviceIds.length > 0) {
    const { data: servicesData } = await supabase
      .from('services')
      .select('id, name')
      .in('id', serviceIds)
    serviceNames = Object.fromEntries((servicesData ?? []).map(s => [s.id, s.name]))
  }

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

  // ── MoM: comparar el último mes vs el penúltimo ──
  function pctChange(current: number, previous: number): number | null {
    if (previous === 0) return null
    return Math.round(((current - previous) / Math.abs(previous)) * 100)
  }

  const lastMonth = months[months.length - 1]
  const prevMonth = months.length >= 2 ? months[months.length - 2] : null

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
    currentMonthCuts: lastMonth?.cuts ?? 0,
    currentMonthRevenue: lastMonth?.revenue ?? 0,
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
