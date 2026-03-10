'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { SalaryScheme } from '@/lib/types/database'

export async function getSalaryConfig(staffId: string) {
  const supabase = await createClient()
  const { data } = await supabase
    .from('salary_configs')
    .select('*')
    .eq('staff_id', staffId)
    .single()
  return data
}

export async function upsertSalaryConfig(staffId: string, scheme: SalaryScheme, baseAmount: number, commissionPct: number) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('salary_configs')
    .upsert(
      { staff_id: staffId, scheme, base_amount: baseAmount, commission_pct: commissionPct },
      { onConflict: 'staff_id' }
    )
  if (error) return { error: error.message }
  revalidatePath('/dashboard/sueldos')
  return { success: true }
}

export async function calculateAndSaveSalary(staffId: string, periodStart: string, periodEnd: string) {
  const supabase = await createClient()

  const { data: amount } = await supabase.rpc('calculate_barber_salary', {
    p_staff_id: staffId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
  })

  const { data, error } = await supabase
    .from('salary_payments')
    .insert({
      staff_id: staffId,
      period_start: periodStart,
      period_end: periodEnd,
      calculated_amount: amount ?? 0,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }
  revalidatePath('/dashboard/sueldos')
  return { success: true, paymentId: data.id, calculatedAmount: amount ?? 0 }
}

export async function markSalaryAsPaid(paymentId: string, notes?: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('salary_payments')
    .update({ is_paid: true, paid_at: new Date().toISOString(), notes: notes ?? null })
    .eq('id', paymentId)
  if (error) return { error: error.message }
  revalidatePath('/dashboard/sueldos')
  return { success: true }
}

export async function getSalaryHistory(branchId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('salary_payments')
    .select('*, staff:staff(id, full_name, branch_id)')
    .order('period_start', { ascending: false })

  const filtered = (data ?? []).filter(
    (p) => (p.staff as { branch_id: string | null } | null)?.branch_id === branchId
  )
  return { data: filtered, error }
}

export async function getAllBarbersWithSalaryConfig(branchId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('staff')
    .select('id, full_name, commission_pct, salary_configs(*)')
    .eq('branch_id', branchId)
    .eq('role', 'barber')
    .eq('is_active', true)
    .order('full_name')
  return { data: data ?? [], error }
}

export async function previewSalary(staffId: string, periodStart: string, periodEnd: string) {
  const supabase = await createClient()
  const { data: amount } = await supabase.rpc('calculate_barber_salary', {
    p_staff_id: staffId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
  })
  return { amount: amount ?? 0 }
}
