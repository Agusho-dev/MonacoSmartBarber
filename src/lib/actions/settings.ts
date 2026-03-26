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
    shift_end_margin_minutes: Number(formData.get('shift_end_margin_minutes') || 35),
    next_client_alert_minutes: Number(formData.get('next_client_alert_minutes') || 5),
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

  // Sync to all branches since it applies to all of them globally
  const { error: branchError } = await supabase
    .from('branches')
    .update({
      business_hours_open: updateData.business_hours_open,
      business_hours_close: updateData.business_hours_close,
      business_days: updateData.business_days,
    })
    .not('id', 'is', null) // Match all existing branches

  if (branchError) return { error: branchError.message }

  revalidatePath('/dashboard/configuracion')
  return { success: true }
}

function validateHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

export async function updateWaApiUrl(waApiUrl: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autorizado' }

  const value = waApiUrl.trim() || null

  if (value && !validateHttpsUrl(value)) {
    return { error: 'La URL del microservicio debe usar HTTPS' }
  }

  const { data: existing } = await supabase
    .from('app_settings')
    .select('id')
    .maybeSingle()

  let opError
  if (existing) {
    const { error } = await supabase
      .from('app_settings')
      .update({ wa_api_url: value })
      .eq('id', existing.id)
    opError = error
  } else {
    const { error } = await supabase
      .from('app_settings')
      .insert([{ wa_api_url: value }])
    opError = error
  }

  if (opError) return { error: opError.message }
  revalidatePath('/dashboard/configuracion')
  return { success: true }
}

export async function updateReviewAutoConfig(data: {
  reviewAutoSend: boolean
  reviewDelayMinutes: number
  reviewMessageTemplate: string
  waApiUrl: string
}) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autorizado' }

  const { data: existing } = await supabase
    .from('app_settings')
    .select('id')
    .maybeSingle()

  const updateData = {
    review_auto_send: data.reviewAutoSend,
    review_delay_minutes: data.reviewDelayMinutes,
    review_message_template: data.reviewMessageTemplate || null,
    wa_api_url: data.waApiUrl.trim() || null,
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

export async function updateCheckinBgColor(color: 'white' | 'black' | 'graphite') {
  const supabase = await createClient()

  const { data: existing } = await supabase
    .from('app_settings')
    .select('id')
    .maybeSingle()

  const { error } = existing
    ? await supabase.from('app_settings').update({ checkin_bg_color: color }).eq('id', existing.id)
    : await supabase.from('app_settings').insert({ checkin_bg_color: color })

  if (error) return { error: error.message }
  revalidatePath('/dashboard/configuracion')
  revalidatePath('/(tablet)/checkin')
  return { success: true }
}
