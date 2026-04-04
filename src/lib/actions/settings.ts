'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getCurrentOrgId } from './org'

export async function updateAppSettings(formData: FormData) {
  const supabase = await createClient()

  // Filtrar configuracion por organización
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Organización no encontrada' }

  const { data: existing } = await supabase
    .from('app_settings')
    .select('id')
    .eq('organization_id', orgId)
    .maybeSingle()

  const businessDaysRaw = formData.get('business_days') as string
  const businessDays = businessDaysRaw
    ? businessDaysRaw.split(',').map(Number)
    : [1, 2, 3, 4, 5, 6]

  const rawBgColor = formData.get('checkin_bg_color') as string | null
  const hexRegex = /^#[0-9a-fA-F]{6}$/
  const checkinBgColor = rawBgColor && hexRegex.test(rawBgColor) ? rawBgColor : '#3f3f46'

  const updateData = {
    lost_client_days: Number(formData.get('lost_client_days')),
    at_risk_client_days: Number(formData.get('at_risk_client_days')),
    business_hours_open: formData.get('business_hours_open') as string,
    business_hours_close: formData.get('business_hours_close') as string,
    business_days: businessDays,
    shift_end_margin_minutes: Number(formData.get('shift_end_margin_minutes') || 35),
    next_client_alert_minutes: Number(formData.get('next_client_alert_minutes') || 5),
    dynamic_cooldown_seconds: Number(formData.get('dynamic_cooldown_seconds') || 60),
    checkin_bg_color: checkinBgColor,
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
      .insert([{ ...updateData, organization_id: orgId }])
    opError = error
  }

  if (opError) return { error: opError.message }

  // Sincronizar con todas las sucursales de la organización
  const { error: branchError } = await supabase
    .from('branches')
    .update({
      business_hours_open: updateData.business_hours_open,
      business_hours_close: updateData.business_hours_close,
      business_days: updateData.business_days,
    })
    .eq('organization_id', orgId)

  if (branchError) return { error: branchError.message }

  revalidatePath('/dashboard/configuracion')
  return { success: true }
}

export async function updateBranchCheckinColor(branchId: string, color: string | null) {
  const supabase = await createClient()

  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Organización no encontrada' }

  const hexRegex = /^#[0-9a-fA-F]{6}$/
  const checkinBgColor = color && hexRegex.test(color) ? color : null

  const { error } = await supabase
    .from('branches')
    .update({ checkin_bg_color: checkinBgColor })
    .eq('id', branchId)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }

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

  // Filtrar configuracion por organización
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Organización no encontrada' }

  const value = waApiUrl.trim() || null

  if (value && !validateHttpsUrl(value)) {
    return { error: 'La URL del microservicio debe usar HTTPS' }
  }

  const { data: existing } = await supabase
    .from('app_settings')
    .select('id')
    .eq('organization_id', orgId)
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
      .insert([{ wa_api_url: value, organization_id: orgId }])
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

  // Filtrar configuracion por organización
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Organización no encontrada' }

  const { data: existing } = await supabase
    .from('app_settings')
    .select('id')
    .eq('organization_id', orgId)
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
      .insert([{ ...updateData, organization_id: orgId }])
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
