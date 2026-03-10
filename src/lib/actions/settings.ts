'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function updateAppSettings(formData: FormData) {
  const supabase = await createClient()

  const { data: existing } = await supabase
    .from('app_settings')
    .select('id')
    .maybeSingle()

  const businessDaysRaw = formData.get('business_days') as string
  const businessDays = businessDaysRaw
    ? businessDaysRaw.split(',').map(Number)
    : [1, 2, 3, 4, 5, 6]

  const updateData = {
    lost_client_days: Number(formData.get('lost_client_days')),
    at_risk_client_days: Number(formData.get('at_risk_client_days')),
    business_hours_open: formData.get('business_hours_open') as string,
    business_hours_close: formData.get('business_hours_close') as string,
    business_days: businessDays,
  }

  let opError
  if (existing) {
    const { error } = await supabase
      .from('app_settings')
      .update(updateData)
      .eq('id', existing.id)
    opError = error
  } else {
    const { error } = await supabase
      .from('app_settings')
      .insert([updateData])
    opError = error
  }

  if (opError) return { error: opError.message }
  revalidatePath('/dashboard/configuracion')
  return { success: true }
}

export async function updateRewardsConfig(formData: FormData) {
  const supabase = await createClient()

  const id = formData.get('id') as string
  const branchId = (formData.get('branch_id') as string) || null
  const data = {
    branch_id: branchId,
    points_per_visit: Number(formData.get('points_per_visit')),
    redemption_threshold: Number(formData.get('redemption_threshold')),
    reward_description: formData.get('reward_description') as string,
    is_active: formData.get('is_active') === 'true',
  }

  let error
  if (id) {
    ; ({ error } = await supabase
      .from('rewards_config')
      .update(data)
      .eq('id', id))
  } else {
    ; ({ error } = await supabase.from('rewards_config').insert(data))
  }

  if (error) return { error: error.message }
  revalidatePath('/dashboard/configuracion')
  return { success: true }
}
