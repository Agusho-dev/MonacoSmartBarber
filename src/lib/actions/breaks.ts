'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function getBreakConfigs(branchId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('break_configs')
    .select('*')
    .eq('branch_id', branchId)
    .order('name')
  return { data: data ?? [], error }
}

export async function upsertBreakConfig(formData: FormData) {
  const supabase = await createClient()
  const id = formData.get('id') as string | null
  const branchId = formData.get('branch_id') as string
  const name = (formData.get('name') as string).trim()
  const durationMinutes = parseInt(formData.get('duration_minutes') as string, 10)
  const toleranceMinutes = parseInt(formData.get('tolerance_minutes') as string, 10)
  const scheduledTime = (formData.get('scheduled_time') as string | null) || null

  if (!branchId || !name || isNaN(durationMinutes)) {
    return { error: 'Datos incompletos' }
  }

  if (id) {
    const { error } = await supabase
      .from('break_configs')
      .update({ name, duration_minutes: durationMinutes, tolerance_minutes: toleranceMinutes, scheduled_time: scheduledTime })
      .eq('id', id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase
      .from('break_configs')
      .insert({ branch_id: branchId, name, duration_minutes: durationMinutes, tolerance_minutes: toleranceMinutes, scheduled_time: scheduledTime })
    if (error) return { error: error.message }
  }

  revalidatePath('/dashboard/descansos')
  return { success: true }
}

export async function deleteBreakConfig(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('break_configs').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/dashboard/descansos')
  return { success: true }
}

export async function startBreak(staffId: string, breakConfigId: string) {
  const supabase = await createClient()
  const { error } = await supabase.rpc('start_barber_break', {
    p_staff_id: staffId,
    p_break_config_id: breakConfigId,
  })
  if (error) return { error: error.message }
  revalidatePath('/dashboard/descansos')
  revalidatePath('/barbero/cola')
  return { success: true }
}

export async function endBreak(staffId: string) {
  const supabase = await createClient()
  const { error } = await supabase.rpc('end_barber_break', { p_staff_id: staffId })
  if (error) return { error: error.message }
  revalidatePath('/dashboard/descansos')
  revalidatePath('/barbero/cola')
  return { success: true }
}

export async function unblockBarber(staffId: string) {
  const supabase = await createClient()
  const { error } = await supabase.rpc('unblock_barber', { p_staff_id: staffId })
  if (error) return { error: error.message }
  revalidatePath('/dashboard/descansos')
  revalidatePath('/barbero/cola')
  return { success: true }
}

export async function checkAndBlockOverdueBreaks() {
  const supabase = await createClient()
  const { error } = await supabase.rpc('check_and_block_overdue_breaks')
  if (error) return { error: error.message }
  return { success: true }
}

export async function getBarbersBreakStatus(branchId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('staff')
    .select('id, full_name, status, break_config_id, break_started_at, break_ends_at, break_configs:break_config_id(name, duration_minutes, tolerance_minutes)')
    .eq('branch_id', branchId)
    .eq('role', 'barber')
    .eq('is_active', true)
    .order('full_name')
  return { data: data ?? [], error }
}
