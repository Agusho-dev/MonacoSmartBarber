'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { IncentiveMetric, IncentivePeriod } from '@/lib/types/database'

export async function getIncentiveRules(branchId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('incentive_rules')
    .select('*')
    .eq('branch_id', branchId)
    .order('name')
  return { data: data ?? [], error }
}

export async function upsertIncentiveRule(formData: FormData) {
  const supabase = await createClient()
  const id = formData.get('id') as string | null
  const branchId = formData.get('branch_id') as string
  const name = (formData.get('name') as string).trim()
  const description = (formData.get('description') as string | null)?.trim() || null
  const metric = formData.get('metric') as IncentiveMetric
  const threshold = parseFloat(formData.get('threshold') as string)
  const rewardAmount = parseFloat(formData.get('reward_amount') as string)
  const period = formData.get('period') as IncentivePeriod

  if (!branchId || !name || isNaN(threshold) || isNaN(rewardAmount)) {
    return { error: 'Datos incompletos' }
  }

  if (id) {
    const { error } = await supabase
      .from('incentive_rules')
      .update({ name, description, metric, threshold, reward_amount: rewardAmount, period })
      .eq('id', id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase
      .from('incentive_rules')
      .insert({ branch_id: branchId, name, description, metric, threshold, reward_amount: rewardAmount, period })
    if (error) return { error: error.message }
  }

  revalidatePath('/dashboard/incentivos')
  return { success: true }
}

export async function toggleIncentiveRule(id: string, isActive: boolean) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('incentive_rules')
    .update({ is_active: isActive })
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/dashboard/incentivos')
  return { success: true }
}

export async function deleteIncentiveRule(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('incentive_rules').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/dashboard/incentivos')
  return { success: true }
}

export async function logAchievement(staffId: string, ruleId: string, periodLabel: string, amountEarned: number, notes?: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('incentive_achievements').insert({
    staff_id: staffId,
    rule_id: ruleId,
    period_label: periodLabel,
    amount_earned: amountEarned,
    notes: notes ?? null,
  })
  if (error) return { error: error.message }
  revalidatePath('/dashboard/incentivos')
  return { success: true }
}

export async function getBarberProgress(branchId: string, periodLabel: string) {
  const supabase = await createClient()

  const [barbersRes, achievementsRes, rulesRes] = await Promise.all([
    supabase
      .from('staff')
      .select('id, full_name')
      .eq('branch_id', branchId)
      .eq('role', 'barber')
      .eq('is_active', true)
      .order('full_name'),
    supabase
      .from('incentive_achievements')
      .select('*, rule:incentive_rules(name)')
      .eq('period_label', periodLabel),
    supabase
      .from('incentive_rules')
      .select('*')
      .eq('branch_id', branchId)
      .eq('is_active', true),
  ])

  return {
    barbers: barbersRes.data ?? [],
    achievements: achievementsRes.data ?? [],
    rules: rulesRes.data ?? [],
  }
}
