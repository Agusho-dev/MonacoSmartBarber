'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getMonthBoundsStr, getLocalNow } from '@/lib/time-utils'

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

  // Visits in range
  let vq = supabase
    .from('visits')
    .select('amount, commission_amount, completed_at, branch_id, service_id, queue_entry_id')
    .gte('completed_at', startDateStr)
    .lte('completed_at', endDateStr)
  if (branchId) vq = vq.eq('branch_id', branchId)
  const { data: visits } = await vq

  // Active fixed expenses
  let fq = supabase
    .from('fixed_expenses')
    .select('amount, branch_id')
    .eq('is_active', true)
  if (branchId) fq = fq.eq('branch_id', branchId)
  const { data: expenses } = await fq

  const monthlyFixed = (expenses ?? []).reduce((s, e) => s + Number(e.amount), 0)

  // Variable expenses (expense_tickets) in range
  let eq = supabase
    .from('expense_tickets')
    .select('amount, expense_date, branch_id')
    .gte('expense_date', startDateStr.slice(0, 10))
    .lte('expense_date', endDateStr.slice(0, 10))
  if (branchId) eq = eq.eq('branch_id', branchId)
  const { data: variableExpenses } = await eq

  // Salary reports (bonos, adelantos, pagos) en rango
  let sq = supabase
    .from('salary_reports')
    .select('type, amount, report_date, status')
    .in('type', ['bonus', 'advance', 'commission', 'base_salary', 'hybrid_deficit'])
    .eq('status', 'paid')
    .gte('report_date', startDateStr.slice(0, 10))
    .lte('report_date', endDateStr.slice(0, 10))
  if (branchId) sq = sq.eq('branch_id', branchId)
  const { data: salaryReports } = await sq

  // Initialize all months using local time to group
  const monthMap = new Map<string, { revenue: number; commissions: number; cuts: number; variableExp: number; bonuses: number; advances: number; salaryPayments: number }>()
  for (let i = 0; i < monthsBack; i++) {
    let year = localNow.getFullYear()
    let monthIndex = localNow.getMonth() - i
    while (monthIndex < 0) {
      monthIndex += 12
      year -= 1
    }
    const d = new Date(year, monthIndex, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    monthMap.set(key, { revenue: 0, commissions: 0, cuts: 0, variableExp: 0, bonuses: 0, advances: 0, salaryPayments: 0 })
  }

  const TZ = 'America/Argentina/Buenos_Aires'
  // Group visits by local month using Intl
  for (const v of visits ?? []) {
    // Convert UTC timestamp to local "YYYY-MM"
    const localMonth = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
    }).format(new Date(v.completed_at)) // returns "YYYY-MM"
    const key = localMonth
    const m = monthMap.get(key)
    if (m) {
      m.revenue += Number(v.amount)
      m.commissions += Number(v.commission_amount)
      // Only count as a "cut" if it was tied to a service or queue entry
      if (v.service_id || v.queue_entry_id) {
        m.cuts++
      }
    }
  }

  // Group variable expenses by local month
  for (const e of variableExpenses ?? []) {
    // expense_date is already "YYYY-MM-DD"
    const key = e.expense_date.slice(0, 7) // "YYYY-MM"
    const m = monthMap.get(key)
    if (m) {
      m.variableExp += Number(e.amount)
    }
  }

  // Group salary reports by local month
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
      m.salaryPayments += Number(sr.amount)
    }
  }

  const months: MonthlyFinancial[] = [...monthMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ym, d]) => {
      // Egresos totales = comisiones + fijos + variables + bonos + pagos salariales
      // Los adelantos se restan porque son dinero a favor del negocio (ya entregado, se descuenta)
      const totalExp = d.commissions + monthlyFixed + d.variableExp + d.bonuses + d.salaryPayments
      const net = d.revenue - totalExp + d.advances
      return {
        month: ym,
        label: monthLabel(ym),
        revenue: d.revenue,
        commissions: d.commissions,
        fixedExpenses: monthlyFixed,
        variableExpenses: d.variableExp,
        bonuses: d.bonuses,
        advances: d.advances,
        salaryPayments: d.salaryPayments,
        totalExpenses: totalExp,
        netProfit: net,
        cuts: d.cuts,
      }
    })

  const totalRevenue = months.reduce((s, m) => s + m.revenue, 0)
  const totalCuts = months.reduce((s, m) => s + m.cuts, 0)
  const totalCommissions = months.reduce((s, m) => s + m.commissions, 0)
  const totalFixedAll = monthlyFixed * monthsBack
  const totalVariable = months.reduce((s, m) => s + m.variableExpenses, 0)
  const totalBonuses = months.reduce((s, m) => s + m.bonuses, 0)
  const totalAdvances = months.reduce((s, m) => s + m.advances, 0)
  const totalSalaryPayments = months.reduce((s, m) => s + m.salaryPayments, 0)

  const avgRevPerCut = totalCuts > 0 ? totalRevenue / totalCuts : 0
  const avgCommPerCut = totalCuts > 0 ? totalCommissions / totalCuts : 0
  const netPerCut = avgRevPerCut - avgCommPerCut

  return {
    months,
    breakEven: {
      cutsNeeded: netPerCut > 0 ? Math.ceil(monthlyFixed / netPerCut) : 0,
      avgRevenuePerCut: Math.round(avgRevPerCut),
      avgCommissionPerCut: Math.round(avgCommPerCut),
      netPerCut: Math.round(netPerCut),
      monthlyFixedExpenses: monthlyFixed,
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
  }
}

/* ─── Fixed Expenses CRUD ─── */

export async function getFixedExpenses(branchId?: string | null) {
  const supabase = await createClient()
  let q = supabase
    .from('fixed_expenses')
    .select('*, branch:branches(name)')
    .order('name')
  if (branchId) q = q.eq('branch_id', branchId)
  const { data } = await q
  return data ?? []
}

export async function upsertFixedExpense(data: {
  id?: string
  branch_id: string
  name: string
  category?: string | null
  amount: number
  is_active?: boolean
}) {
  const supabase = await createClient()

  if (data.id) {
    const { error } = await supabase
      .from('fixed_expenses')
      .update({
        name: data.name,
        category: data.category || null,
        amount: data.amount,
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
      is_active: data.is_active ?? true,
    })
    if (error) return { error: error.message }
  }

  revalidatePath('/dashboard/finanzas')
  return { success: true }
}

export async function deleteFixedExpense(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('fixed_expenses').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/dashboard/finanzas')
  return { success: true }
}
