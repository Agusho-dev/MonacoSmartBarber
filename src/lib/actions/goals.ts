'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export interface GoalWithProgress {
  id: string
  branch_id: string | null
  barber_id: string | null
  month: string
  target_cuts: number
  target_revenue: number
  actual_cuts: number
  actual_revenue: number
  branch_name?: string
  barber_name?: string
}

export async function fetchGoals(
  month: string,
  branchId?: string | null
): Promise<GoalWithProgress[]> {
  const supabase = await createClient()

  let gq = supabase
    .from('goals')
    .select('*, branch:branches(name), barber:staff(full_name)')
    .eq('month', month)
  if (branchId) gq = gq.eq('branch_id', branchId)
  const { data: goals } = await gq

  const monthDate = new Date(month)
  const nextMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1)

  let vq = supabase
    .from('visits')
    .select('branch_id, barber_id, amount')
    .gte('completed_at', month)
    .lt('completed_at', nextMonth.toISOString().slice(0, 10))
  if (branchId) vq = vq.eq('branch_id', branchId)
  const { data: visits } = await vq

  const branchActuals = new Map<string, { cuts: number; revenue: number }>()
  const barberActuals = new Map<string, { cuts: number; revenue: number }>()
  for (const v of visits ?? []) {
    const ba = branchActuals.get(v.branch_id) || { cuts: 0, revenue: 0 }
    ba.cuts++
    ba.revenue += v.amount
    branchActuals.set(v.branch_id, ba)

    const bba = barberActuals.get(v.barber_id) || { cuts: 0, revenue: 0 }
    bba.cuts++
    bba.revenue += v.amount
    barberActuals.set(v.barber_id, bba)
  }

  return (goals ?? []).map((g) => {
    let actual = { cuts: 0, revenue: 0 }
    if (g.barber_id) {
      actual = barberActuals.get(g.barber_id) || actual
    } else if (g.branch_id) {
      actual = branchActuals.get(g.branch_id) || actual
    }
    return {
      id: g.id,
      branch_id: g.branch_id,
      barber_id: g.barber_id,
      month: g.month,
      target_cuts: g.target_cuts,
      target_revenue: g.target_revenue,
      actual_cuts: actual.cuts,
      actual_revenue: actual.revenue,
      branch_name: (g.branch as Record<string, string> | null)?.name,
      barber_name: (g.barber as Record<string, string> | null)?.full_name,
    }
  })
}

export async function upsertGoal(data: {
  id?: string
  branch_id?: string | null
  barber_id?: string | null
  month: string
  target_cuts: number
  target_revenue: number
}) {
  const supabase = await createClient()

  if (data.id) {
    const { error } = await supabase
      .from('goals')
      .update({
        target_cuts: data.target_cuts,
        target_revenue: data.target_revenue,
      })
      .eq('id', data.id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase.from('goals').insert({
      branch_id: data.branch_id || null,
      barber_id: data.barber_id || null,
      month: data.month,
      target_cuts: data.target_cuts,
      target_revenue: data.target_revenue,
    })
    if (error) return { error: error.message }
  }

  revalidatePath('/dashboard/metas')
  return { success: true }
}

export async function deleteGoal(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('goals').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/dashboard/metas')
  return { success: true }
}
