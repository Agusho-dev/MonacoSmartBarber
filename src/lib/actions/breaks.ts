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
  const scheduledTimeRaw = formData.get('scheduled_time') as string | null
  const scheduledTime = scheduledTimeRaw?.trim() || null

  if (!branchId || !name || isNaN(durationMinutes)) {
    return { error: 'Datos incompletos' }
  }

  if (id) {
    const { error } = await supabase
      .from('break_configs')
      .update({ name, duration_minutes: durationMinutes, scheduled_time: scheduledTime })
      .eq('id', id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase
      .from('break_configs')
      .insert({ branch_id: branchId, name, duration_minutes: durationMinutes, scheduled_time: scheduledTime })
    if (error) return { error: error.message }
  }

  revalidatePath('/dashboard/descansos')
  revalidatePath('/dashboard/equipo')
  return { success: true }
}

export async function deleteBreakConfig(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('break_configs').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/dashboard/descansos')
  revalidatePath('/dashboard/equipo')
  return { success: true }
}
