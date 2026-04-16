'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from './org'
import { revalidatePath } from 'next/cache'
import type { PartnerBenefit, PartnerBenefitStatus } from '@/lib/types/database'

/** Lista los beneficios de la org actual, opcionalmente filtrados por status. */
export async function listOrgBenefits(
  status?: PartnerBenefitStatus | 'all'
): Promise<Array<PartnerBenefit & { partner: { id: string; business_name: string; logo_url: string | null } | null }>> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return []

  const supabase = createAdminClient()
  let q = supabase
    .from('partner_benefits')
    .select(`
      *,
      partner:commercial_partners(id, business_name, logo_url)
    `)
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })

  if (status && status !== 'all') {
    q = q.eq('status', status)
  }

  const { data } = await q
  return (data ?? []) as never
}

export async function getBenefitById(id: string) {
  const orgId = await getCurrentOrgId()
  if (!orgId) return null

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('partner_benefits')
    .select(`
      *,
      partner:commercial_partners(id, business_name, logo_url, contact_email, contact_phone)
    `)
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle()

  return data
}

async function getApproverStaffId(orgId: string): Promise<string | null> {
  const supabase = createAdminClient()
  const { cookies } = await import('next/headers')
  const cookieStore = await cookies()

  // Buscar staff desde la cookie barber_session si existe
  const barberCookie = cookieStore.get('barber_session')
  if (barberCookie) {
    try {
      const parsed = JSON.parse(barberCookie.value)
      if (parsed.staff_id) return parsed.staff_id
    } catch { /* ignore */ }
  }

  // O desde Supabase Auth user → staff
  const { createClient } = await import('@/lib/supabase/server')
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return null

  const { data: staff } = await supabase
    .from('staff')
    .select('id')
    .eq('auth_user_id', user.id)
    .eq('organization_id', orgId)
    .limit(1)
    .maybeSingle()
  return staff?.id ?? null
}

export async function approveBenefit(
  benefitId: string
): Promise<{ success: boolean; error?: string }> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { success: false, error: 'No autorizado' }

  const approverId = await getApproverStaffId(orgId)

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('partner_benefits')
    .update({
      status: 'approved',
      approved_by: approverId,
      approved_at: new Date().toISOString(),
      rejection_reason: null,
    })
    .eq('id', benefitId)
    .eq('organization_id', orgId)

  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard/convenios')
  revalidatePath(`/dashboard/convenios/${benefitId}`)
  return { success: true }
}

export async function rejectBenefit(
  benefitId: string,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { success: false, error: 'No autorizado' }

  if (!reason || reason.trim().length < 3) {
    return { success: false, error: 'Indicá un motivo (mín 3 caracteres)' }
  }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('partner_benefits')
    .update({
      status: 'rejected',
      rejection_reason: reason.trim(),
      approved_by: null,
      approved_at: null,
    })
    .eq('id', benefitId)
    .eq('organization_id', orgId)

  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard/convenios')
  revalidatePath(`/dashboard/convenios/${benefitId}`)
  return { success: true }
}

export async function pauseBenefit(
  benefitId: string
): Promise<{ success: boolean; error?: string }> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { success: false, error: 'No autorizado' }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('partner_benefits')
    .update({ status: 'paused' })
    .eq('id', benefitId)
    .eq('organization_id', orgId)
    .eq('status', 'approved')

  if (error) return { success: false, error: error.message }
  revalidatePath('/dashboard/convenios')
  revalidatePath(`/dashboard/convenios/${benefitId}`)
  return { success: true }
}

export async function unpauseBenefit(
  benefitId: string
): Promise<{ success: boolean; error?: string }> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { success: false, error: 'No autorizado' }

  const approverId = await getApproverStaffId(orgId)
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('partner_benefits')
    .update({
      status: 'approved',
      approved_by: approverId,
      approved_at: new Date().toISOString(),
    })
    .eq('id', benefitId)
    .eq('organization_id', orgId)
    .eq('status', 'paused')

  if (error) return { success: false, error: error.message }
  revalidatePath('/dashboard/convenios')
  return { success: true }
}

export async function archiveBenefit(benefitId: string) {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { success: false, error: 'No autorizado' }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('partner_benefits')
    .update({ status: 'archived' })
    .eq('id', benefitId)
    .eq('organization_id', orgId)

  if (error) return { success: false, error: error.message }
  revalidatePath('/dashboard/convenios')
  return { success: true }
}

export async function getOrgBenefitsStats() {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { pending: 0, approved: 0, rejected: 0, paused: 0, redemptions: 0 }

  const supabase = createAdminClient()
  const [{ count: pending }, { count: approved }, { count: rejected }, { count: paused }] =
    await Promise.all([
      supabase.from('partner_benefits').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'pending'),
      supabase.from('partner_benefits').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'approved'),
      supabase.from('partner_benefits').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'rejected'),
      supabase.from('partner_benefits').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'paused'),
    ])

  // Redenciones usadas en esta org
  const { data: redeemedData } = await supabase
    .from('partner_benefit_redemptions')
    .select('id, benefit:partner_benefits!inner(organization_id)')
    .eq('status', 'used')
    .eq('benefit.organization_id', orgId)

  return {
    pending: pending ?? 0,
    approved: approved ?? 0,
    rejected: rejected ?? 0,
    paused: paused ?? 0,
    redemptions: redeemedData?.length ?? 0,
  }
}
