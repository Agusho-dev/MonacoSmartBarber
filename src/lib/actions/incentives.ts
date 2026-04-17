'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { IncentiveMetric, IncentivePeriod } from '@/lib/types/database'
import { validateBranchAccess } from './org'

export async function getIncentiveRules(branchId: string) {
  const orgId = await validateBranchAccess(branchId)
  if (!orgId) return { data: [], error: 'No autorizado' }

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

  const orgId = await validateBranchAccess(branchId)
  if (!orgId) return { error: 'No autorizado' }

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
  const { data: rule } = await supabase.from('incentive_rules').select('branch_id').eq('id', id).single()
  if (!rule) return { error: 'Regla no encontrada' }
  const orgId = await validateBranchAccess(rule.branch_id)
  if (!orgId) return { error: 'No autorizado' }

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
  const { data: rule } = await supabase.from('incentive_rules').select('branch_id').eq('id', id).single()
  if (!rule) return { error: 'Regla no encontrada' }
  const orgId = await validateBranchAccess(rule.branch_id)
  if (!orgId) return { error: 'No autorizado' }

  const { error } = await supabase.from('incentive_rules').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/dashboard/incentivos')
  return { success: true }
}

export async function logAchievement(staffId: string, ruleId: string, periodLabel: string, amountEarned: number, notes?: string) {
  const supabase = await createClient()
  // Verificar que la regla pertenece a una branch de la org
  const { data: rule } = await supabase.from('incentive_rules').select('branch_id').eq('id', ruleId).single()
  if (!rule) return { error: 'Regla no encontrada' }
  const orgId = await validateBranchAccess(rule.branch_id)
  if (!orgId) return { error: 'No autorizado' }

  // Validar que el staff pertenece al mismo branch que la regla
  const { data: staffRow } = await supabase
    .from('staff')
    .select('branch_id')
    .eq('id', staffId)
    .maybeSingle()
  if (!staffRow || staffRow.branch_id !== rule.branch_id) {
    return { error: 'El barbero no pertenece al branch de la regla' }
  }

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
  const orgId = await validateBranchAccess(branchId)
  if (!orgId) return { barbers: [], achievements: [], rules: [] }

  const supabase = await createClient()

  const [barbersRes, rulesRes] = await Promise.all([
    supabase
      .from('staff')
      .select('id, full_name')
      .eq('branch_id', branchId)
      .eq('role', 'barber')
      .eq('is_active', true)
      .order('full_name'),
    supabase
      .from('incentive_rules')
      .select('*')
      .eq('branch_id', branchId)
      .eq('is_active', true),
  ])

  const orgBarberIds = (barbersRes.data ?? []).map(b => b.id)

  // Filtrar logros solo de barberos de la org para evitar fuga cross-org
  const achievementsRes = orgBarberIds.length > 0
    ? await supabase
        .from('incentive_achievements')
        .select('*, rule:incentive_rules(name)')
        .eq('period_label', periodLabel)
        .in('staff_id', orgBarberIds)
    : { data: [] }

  return {
    barbers: barbersRes.data ?? [],
    achievements: achievementsRes.data ?? [],
    rules: rulesRes.data ?? [],
  }
}
