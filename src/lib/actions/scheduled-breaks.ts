'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

/**
 * Create pending break requests for all active barbers in a branch
 * that don't already have an active (pending/approved) request.
 * Called when the scheduled break time arrives.
 */
export async function createScheduledBreakRequests(branchId: string, breakConfigId: string) {
  const supabase = createAdminClient()

  // Get all active barbers for this branch
  const { data: barbers } = await supabase
    .from('staff')
    .select('id')
    .eq('branch_id', branchId)
    .eq('role', 'barber')
    .eq('is_active', true)

  if (!barbers || barbers.length === 0) {
    return { created: 0 }
  }

  // Get barbers who already have pending/approved requests
  const { data: existing } = await supabase
    .from('break_requests')
    .select('staff_id')
    .eq('branch_id', branchId)
    .in('status', ['pending', 'approved'])

  const existingStaffIds = new Set((existing ?? []).map(e => e.staff_id))

  // Filter barbers who need a new request
  const barbersToCreate = barbers.filter(b => !existingStaffIds.has(b.id))

  if (barbersToCreate.length === 0) {
    return { created: 0 }
  }

  // Insert break requests for all eligible barbers
  const { error } = await supabase.from('break_requests').insert(
    barbersToCreate.map(b => ({
      staff_id: b.id,
      branch_id: branchId,
      break_config_id: breakConfigId,
    }))
  )

  if (error) return { error: error.message, created: 0 }

  revalidatePath('/dashboard/descansos')
  revalidatePath('/dashboard/equipo')
  revalidatePath('/barbero/cola')
  return { created: barbersToCreate.length }
}
