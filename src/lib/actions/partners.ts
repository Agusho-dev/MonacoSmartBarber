'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from './org'
import { generatePartnerMagicLink, invalidatePreviousMagicLinks } from '@/lib/partners/magic-link'
import { sendMagicLinkViaWhatsApp } from '@/lib/partners/delivery'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

const invitePartnerSchema = z.object({
  businessName: z.string().trim().min(2, 'Nombre muy corto').max(120),
  contactEmail: z.string().trim().email('Email inválido').optional().or(z.literal('')),
  contactPhone: z.string().trim().max(30).optional().or(z.literal('')),
})

export interface InvitePartnerResult {
  success: boolean
  error?: string
  magicLinkUrl?: string
  expiresAt?: string
  partnerId?: string
  whatsappSent?: boolean
  whatsappError?: string
}

export async function invitePartner(formData: FormData): Promise<InvitePartnerResult> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { success: false, error: 'No autorizado' }

  const parsed = invitePartnerSchema.safeParse({
    businessName: formData.get('businessName'),
    contactEmail: formData.get('contactEmail'),
    contactPhone: formData.get('contactPhone'),
  })

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const { businessName, contactEmail, contactPhone } = parsed.data
  const email = contactEmail || null
  const phone = contactPhone || null

  if (!email && !phone) {
    return { success: false, error: 'Debe ingresar email o teléfono' }
  }

  const supabase = createAdminClient()

  // 1. Buscar partner global por email (si hay). Si no, crear nuevo.
  let partnerId: string | null = null

  if (email) {
    const { data: existing } = await supabase
      .from('commercial_partners')
      .select('id')
      .eq('contact_email', email)
      .maybeSingle()
    partnerId = existing?.id ?? null
  }

  if (!partnerId) {
    const { data: created, error: createErr } = await supabase
      .from('commercial_partners')
      .insert({
        business_name: businessName,
        contact_email: email,
        contact_phone: phone,
      })
      .select('id')
      .single()

    if (createErr) return { success: false, error: createErr.message }
    partnerId = created.id
  } else {
    // Actualizar teléfono si no tenía
    if (phone) {
      await supabase
        .from('commercial_partners')
        .update({ contact_phone: phone, business_name: businessName })
        .eq('id', partnerId)
        .is('contact_phone', null)
    }
  }

  // 2. Crear o reactivar relación org↔partner
  const { data: existingRel } = await supabase
    .from('partner_org_relations')
    .select('id, status')
    .eq('partner_id', partnerId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!existingRel) {
    await supabase.from('partner_org_relations').insert({
      partner_id: partnerId,
      organization_id: orgId,
      status: 'active',
    })
  } else if (existingRel.status !== 'active') {
    await supabase
      .from('partner_org_relations')
      .update({ status: 'active', revoked_at: null })
      .eq('id', existingRel.id)
  }

  if (!partnerId) return { success: false, error: 'No se pudo crear el partner' }

  // 3. Invalidar invitaciones previas y generar nueva
  await invalidatePreviousMagicLinks(partnerId, 'invitation')
  const link = await generatePartnerMagicLink(partnerId, 'invitation')

  // 4. Intentar envío por WhatsApp si hay teléfono
  let whatsappSent = false
  let whatsappError: string | undefined
  if (phone) {
    const result = await sendMagicLinkViaWhatsApp({
      organizationId: orgId,
      phone,
      businessName,
      url: link.url,
      purpose: 'invitation',
    })
    whatsappSent = result.sent
    whatsappError = result.error
  }

  revalidatePath('/dashboard/convenios/partners')

  return {
    success: true,
    magicLinkUrl: link.url,
    expiresAt: link.expiresAt,
    partnerId,
    whatsappSent,
    whatsappError,
  }
}

export async function regeneratePartnerMagicLink(
  partnerId: string
): Promise<InvitePartnerResult> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { success: false, error: 'No autorizado' }

  const supabase = createAdminClient()

  // Verificar que el partner esté relacionado con esta org
  const { data: rel } = await supabase
    .from('partner_org_relations')
    .select('id')
    .eq('partner_id', partnerId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!rel) return { success: false, error: 'Partner no pertenece a esta organización' }

  await invalidatePreviousMagicLinks(partnerId, 'invitation')
  const link = await generatePartnerMagicLink(partnerId, 'invitation')

  // Enviar por WA si hay teléfono
  const { data: partner } = await supabase
    .from('commercial_partners')
    .select('business_name, contact_phone')
    .eq('id', partnerId)
    .single()

  let whatsappSent = false
  if (partner?.contact_phone) {
    const r = await sendMagicLinkViaWhatsApp({
      organizationId: orgId,
      phone: partner.contact_phone,
      businessName: partner.business_name,
      url: link.url,
      purpose: 'invitation',
    })
    whatsappSent = r.sent
  }

  revalidatePath('/dashboard/convenios/partners')

  return {
    success: true,
    magicLinkUrl: link.url,
    expiresAt: link.expiresAt,
    partnerId,
    whatsappSent,
  }
}

export async function updatePartnerRelationStatus(
  partnerId: string,
  newStatus: 'active' | 'paused' | 'revoked'
): Promise<{ success: boolean; error?: string }> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { success: false, error: 'No autorizado' }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('partner_org_relations')
    .update({
      status: newStatus,
      revoked_at: newStatus === 'revoked' ? new Date().toISOString() : null,
    })
    .eq('partner_id', partnerId)
    .eq('organization_id', orgId)

  if (error) return { success: false, error: error.message }

  // Si se revoca o pausa → también pausar todos los beneficios activos de esa relación
  if (newStatus !== 'active') {
    await supabase
      .from('partner_benefits')
      .update({ status: 'paused' })
      .eq('partner_id', partnerId)
      .eq('organization_id', orgId)
      .in('status', ['approved', 'pending'])
  }

  revalidatePath('/dashboard/convenios/partners')
  revalidatePath('/dashboard/convenios')
  return { success: true }
}

export async function deletePartnerFromOrg(
  partnerId: string
): Promise<{ success: boolean; error?: string }> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { success: false, error: 'No autorizado' }

  const supabase = createAdminClient()

  // Verificar que la relación exista antes de borrar
  const { data: rel } = await supabase
    .from('partner_org_relations')
    .select('id')
    .eq('partner_id', partnerId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!rel) return { success: false, error: 'Partner no pertenece a esta organización' }

  // Borrar beneficios scoped a esta org (no afecta otros orgs aliados al mismo partner)
  const { error: benefitsErr } = await supabase
    .from('partner_benefits')
    .delete()
    .eq('partner_id', partnerId)
    .eq('organization_id', orgId)
  if (benefitsErr) return { success: false, error: benefitsErr.message }

  // Borrar la relación. El partner global (`commercial_partners`) sigue existiendo
  // si está aliado a otras orgs.
  const { error: relErr } = await supabase
    .from('partner_org_relations')
    .delete()
    .eq('partner_id', partnerId)
    .eq('organization_id', orgId)
  if (relErr) return { success: false, error: relErr.message }

  revalidatePath('/dashboard/convenios/partners')
  revalidatePath('/dashboard/convenios')
  return { success: true }
}

export async function listOrgPartners() {
  const orgId = await getCurrentOrgId()
  if (!orgId) return []

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('partner_org_relations')
    .select(`
      id, status, invited_at, revoked_at,
      partner:commercial_partners(id, business_name, contact_email, contact_phone, logo_url, created_at)
    `)
    .eq('organization_id', orgId)
    .order('invited_at', { ascending: false })

  return data ?? []
}
