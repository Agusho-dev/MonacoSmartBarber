'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentPartner, createPartnerSession, destroyPartnerSession } from '@/lib/partners/session'
import { consumePartnerMagicLink, generatePartnerMagicLink, invalidatePreviousMagicLinks } from '@/lib/partners/magic-link'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import type { PartnerBenefit } from '@/lib/types/database'

const benefitSchema = z.object({
  organization_id: z.string().uuid(),
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().max(2000).optional().or(z.literal('')),
  discount_text: z.string().trim().max(40).optional().or(z.literal('')),
  image_url: z.string().url().optional().or(z.literal('')),
  terms: z.string().trim().max(2000).optional().or(z.literal('')),
  location_address: z.string().trim().max(300).optional().or(z.literal('')),
  location_map_url: z.string().url().optional().or(z.literal('')),
  valid_from: z.string().optional().or(z.literal('')),
  valid_until: z.string().optional().or(z.literal('')),
})

/**
 * Consume el magic link y crea sesión. Se llama desde /partners/auth/callback.
 * Devuelve `success: true` — el caller debe hacer `redirect()` desde el server component
 * porque createPartnerSession setea cookies.
 */
export async function consumeMagicLinkAndLogin(
  token: string
): Promise<{ success: boolean; error?: string }> {
  const result = await consumePartnerMagicLink(token)
  if ('error' in result) return { success: false, error: result.error }

  await createPartnerSession(result.partnerId)
  return { success: true }
}

export async function requestLoginMagicLink(formData: FormData) {
  const email = String(formData.get('email') || '').trim().toLowerCase()
  if (!email) return { success: false, error: 'Ingresá tu email' }

  const supabase = createAdminClient()
  const { data: partner } = await supabase
    .from('commercial_partners')
    .select('id, contact_email, contact_phone, business_name')
    .eq('contact_email', email)
    .maybeSingle()

  // Respuesta genérica para no filtrar qué emails están registrados
  if (!partner) {
    return { success: true, sentTo: email }
  }

  await invalidatePreviousMagicLinks(partner.id, 'login')
  const link = await generatePartnerMagicLink(partner.id, 'login')

  // Si hay WhatsApp de alguna org aliada, también enviar por ahí (best-effort)
  // En el MVP solo guardamos y mostramos. En prod real: enviar por email (Resend/SMTP).

  return {
    success: true,
    sentTo: email,
    // Solo en dev mostramos el link para testing:
    devLinkUrl: process.env.NODE_ENV !== 'production' ? link.url : undefined,
  }
}

export async function logoutPartner() {
  await destroyPartnerSession()
  redirect('/partners/login')
}

export async function updatePartnerProfile(formData: FormData) {
  const partner = await getCurrentPartner()
  if (!partner) return { success: false, error: 'No autorizado' }

  const businessName = String(formData.get('businessName') || '').trim()
  const contactPhone = String(formData.get('contactPhone') || '').trim() || null
  const logoUrl = String(formData.get('logoUrl') || '').trim() || null

  if (!businessName || businessName.length < 2) {
    return { success: false, error: 'Nombre inválido' }
  }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('commercial_partners')
    .update({
      business_name: businessName,
      contact_phone: contactPhone,
      logo_url: logoUrl,
    })
    .eq('id', partner.id)

  if (error) return { success: false, error: error.message }
  revalidatePath('/partners/dashboard')
  return { success: true }
}

export async function listPartnerOrgs() {
  const partner = await getCurrentPartner()
  if (!partner) return []

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('partner_org_relations')
    .select(`
      id, status, invited_at,
      organization:organizations(id, name, logo_url)
    `)
    .eq('partner_id', partner.id)
    .eq('status', 'active')

  return data ?? []
}

export async function listPartnerBenefits(): Promise<Array<PartnerBenefit & { organization: { id: string; name: string; logo_url: string | null } | null }>> {
  const partner = await getCurrentPartner()
  if (!partner) return []

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('partner_benefits')
    .select(`
      *,
      organization:organizations(id, name, logo_url)
    `)
    .eq('partner_id', partner.id)
    .order('updated_at', { ascending: false })

  return (data ?? []) as never
}

export async function createBenefit(formData: FormData) {
  const partner = await getCurrentPartner()
  if (!partner) return { success: false, error: 'No autorizado' }

  const raw = Object.fromEntries(formData.entries())
  const parsed = benefitSchema.safeParse(raw)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }
  const d = parsed.data

  const supabase = createAdminClient()

  // Verificar relación activa con esa org
  const { data: rel } = await supabase
    .from('partner_org_relations')
    .select('id')
    .eq('partner_id', partner.id)
    .eq('organization_id', d.organization_id)
    .eq('status', 'active')
    .maybeSingle()

  if (!rel) return { success: false, error: 'No tenés convenio activo con esa organización' }

  const { data: inserted, error } = await supabase
    .from('partner_benefits')
    .insert({
      partner_id: partner.id,
      organization_id: d.organization_id,
      title: d.title,
      description: d.description || null,
      discount_text: d.discount_text || null,
      image_url: d.image_url || null,
      terms: d.terms || null,
      location_address: d.location_address || null,
      location_map_url: d.location_map_url || null,
      valid_from: d.valid_from ? new Date(d.valid_from).toISOString() : null,
      valid_until: d.valid_until ? new Date(d.valid_until).toISOString() : null,
      status: 'pending',
    })
    .select('id')
    .single()

  if (error) return { success: false, error: error.message }

  revalidatePath('/partners/dashboard')
  return { success: true, id: inserted.id }
}

export async function updateBenefit(benefitId: string, formData: FormData) {
  const partner = await getCurrentPartner()
  if (!partner) return { success: false, error: 'No autorizado' }

  const raw = Object.fromEntries(formData.entries())
  const parsed = benefitSchema.safeParse(raw)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }
  const d = parsed.data

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('partner_benefits')
    .update({
      title: d.title,
      description: d.description || null,
      discount_text: d.discount_text || null,
      image_url: d.image_url || null,
      terms: d.terms || null,
      location_address: d.location_address || null,
      location_map_url: d.location_map_url || null,
      valid_from: d.valid_from ? new Date(d.valid_from).toISOString() : null,
      valid_until: d.valid_until ? new Date(d.valid_until).toISOString() : null,
    })
    .eq('id', benefitId)
    .eq('partner_id', partner.id) // security: solo sus propios beneficios

  if (error) return { success: false, error: error.message }

  revalidatePath('/partners/dashboard')
  revalidatePath(`/partners/dashboard/benefits/${benefitId}`)
  return { success: true }
}

export async function archiveBenefitByPartner(benefitId: string) {
  const partner = await getCurrentPartner()
  if (!partner) return { success: false, error: 'No autorizado' }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('partner_benefits')
    .update({ status: 'archived' })
    .eq('id', benefitId)
    .eq('partner_id', partner.id)

  if (error) return { success: false, error: error.message }
  revalidatePath('/partners/dashboard')
  return { success: true }
}

export async function uploadBenefitImage(formData: FormData) {
  const partner = await getCurrentPartner()
  if (!partner) return { success: false, error: 'No autorizado' }

  const file = formData.get('file') as File | null
  if (!file || file.size === 0) return { success: false, error: 'Archivo requerido' }
  if (file.size > 5 * 1024 * 1024) return { success: false, error: 'Máximo 5 MB' }

  const supabase = createAdminClient()
  const ext = file.name.split('.').pop() || 'jpg'
  const path = `${partner.id}/${Date.now()}.${ext}`
  const arrayBuffer = await file.arrayBuffer()

  const { error } = await supabase.storage
    .from('partner-benefits')
    .upload(path, arrayBuffer, { contentType: file.type, upsert: false })

  if (error) return { success: false, error: error.message }

  const { data: publicUrl } = supabase.storage.from('partner-benefits').getPublicUrl(path)
  return { success: true, url: publicUrl.publicUrl }
}

export async function validateRedemptionByPartner(
  code: string
): Promise<{ success: boolean; benefitTitle?: string; clientName?: string; error?: string }> {
  const partner = await getCurrentPartner()
  if (!partner) return { success: false, error: 'No autorizado' }

  const clean = code.trim().toUpperCase()
  if (clean.length < 4) return { success: false, error: 'Código inválido' }

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('validate_redemption_code', {
    p_code: clean,
    p_partner_id: partner.id,
  })

  if (error) return { success: false, error: error.message }
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return { success: false, error: 'Código no encontrado' }

  if (row.success) {
    return {
      success: true,
      benefitTitle: row.benefit_title ?? undefined,
      clientName: row.client_name ?? undefined,
    }
  }

  const msgMap: Record<string, string> = {
    codigo_invalido: 'Código inválido',
    codigo_no_pertenece_al_partner: 'Este código no pertenece a tu comercio',
    ya_canjeado: 'Este código ya fue canjeado',
  }
  return { success: false, error: msgMap[row.error] ?? row.error ?? 'Error' }
}

export async function issueBenefitRedemptionAsClient(benefitId: string) {
  // Llamado desde el mobile vía supabase.rpc con auth del cliente
  // Esta server action existe solo como referencia — el mobile usa directamente RPC.
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('issue_benefit_redemption', {
    p_benefit_id: benefitId,
  })
  if (error) return { success: false, error: error.message }
  return { success: true, data }
}
