'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export interface MonthlyFinancial {
  month: string
  label: string
  revenue: number
  commissions: number
  fixedExpenses: number
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

  const now = new Date()
  const startDate = new Date(now.getFullYear(), now.getMonth() - monthsBack + 1, 1)
  const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)

  // Visits in range
  let vq = supabase
    .from('visits')
    .select('amount, commission_amount, completed_at, branch_id')
    .gte('completed_at', startDate.toISOString())
    .lte('completed_at', endDate.toISOString())
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

  // Initialize all months
  const monthMap = new Map<string, { revenue: number; commissions: number; cuts: number }>()
  for (let i = 0; i < monthsBack; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    monthMap.set(key, { revenue: 0, commissions: 0, cuts: 0 })
  }

  for (const v of visits ?? []) {
    const key = v.completed_at.slice(0, 7)
    const m = monthMap.get(key)
    if (m) {
      m.revenue += Number(v.amount)
      m.commissions += Number(v.commission_amount)
      m.cuts++
    }
  }

  const months: MonthlyFinancial[] = [...monthMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ym, d]) => ({
      month: ym,
      label: monthLabel(ym),
      revenue: d.revenue,
      commissions: d.commissions,
      fixedExpenses: monthlyFixed,
      totalExpenses: d.commissions + monthlyFixed,
      netProfit: d.revenue - d.commissions - monthlyFixed,
      cuts: d.cuts,
    }))

  const totalRevenue = months.reduce((s, m) => s + m.revenue, 0)
  const totalCuts = months.reduce((s, m) => s + m.cuts, 0)
  const totalCommissions = months.reduce((s, m) => s + m.commissions, 0)
  const totalFixedAll = monthlyFixed * monthsBack

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
      netProfit: totalRevenue - totalCommissions - totalFixedAll,
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
