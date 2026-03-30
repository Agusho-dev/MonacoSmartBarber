'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { validateBranchAccess } from './org'

export async function updateRewardConfig(
  branchId: string,
  config: {
    points_per_visit: number
    redemption_threshold: number
    reward_description: string
    is_active: boolean
  }
) {
  const orgId = await validateBranchAccess(branchId)
  if (!orgId) return { error: 'No autorizado' }

  const supabase = await createClient()

  // Check if config exists
  const { data: existing } = await supabase
    .from('rewards_config')
    .select('id')
    .eq('branch_id', branchId)
    .single()

  let error
  if (existing) {
    const { error: updateError } = await supabase
      .from('rewards_config')
      .update(config)
      .eq('id', existing.id)
    error = updateError
  } else {
    const { error: insertError } = await supabase
      .from('rewards_config')
      .insert({
        branch_id: branchId,
        ...config,
      })
    error = insertError
  }

  if (error) {
    return { error: 'Error al actualizar la configuración' }
  }

  revalidatePath('/dashboard/fidelizacion')
  revalidatePath('/dashboard/app-movil')
  return { success: true }
}
