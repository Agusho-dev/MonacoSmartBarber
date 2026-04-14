'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from './org'
import { revalidatePath } from 'next/cache'

const STAFF_TAG_NAME = 'Staff'
const STAFF_TAG_COLOR = '#F59E0B'

export interface PrepareStaffContactResult {
  clientId?: string
  tagId?: string
  conversationId?: string
  error?: string
}

// Idempotente: espeja staff -> clients, asegura la etiqueta "Staff",
// y (si hay canal WhatsApp activo) crea/reusa la conversacion y la etiqueta.
// Se usa tanto al crear un miembro nuevo (best-effort) como al tocar "Contactar".
export async function prepareStaffContact(
  staffId: string,
): Promise<PrepareStaffContactResult> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'No autorizado' }

  const supabase = createAdminClient()

  // 1. Obtener staff
  const { data: staff, error: staffErr } = await supabase
    .from('staff')
    .select('id, full_name, phone, organization_id')
    .eq('id', staffId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (staffErr) return { error: 'Error buscando staff: ' + staffErr.message }
  if (!staff) return { error: 'Miembro no encontrado' }
  if (!staff.phone || !staff.phone.trim()) {
    return { error: 'El miembro no tiene telefono cargado' }
  }

  const phoneClean = staff.phone.trim()

  // 2. Mirror client (buscar por telefono - uniqueness global)
  let clientId: string | undefined
  const { data: existingClient } = await supabase
    .from('clients')
    .select('id, organization_id')
    .eq('phone', phoneClean)
    .maybeSingle()

  if (existingClient) {
    clientId = existingClient.id
    // Si el cliente existente no tiene org o pertenece a otra, no lo movemos;
    // solo usamos su id como referencia.
  } else {
    const { data: newClient, error: cErr } = await supabase
      .from('clients')
      .insert({
        organization_id: orgId,
        phone: phoneClean,
        name: staff.full_name,
      })
      .select('id')
      .single()
    if (cErr || !newClient) return { error: 'No se pudo crear cliente espejo: ' + (cErr?.message ?? '') }
    clientId = newClient.id
  }

  // 3. Etiqueta "Staff" (idempotente a nivel org)
  let tagId: string | undefined
  const { data: existingTag } = await supabase
    .from('conversation_tags')
    .select('id')
    .eq('organization_id', orgId)
    .eq('name', STAFF_TAG_NAME)
    .maybeSingle()

  if (existingTag) {
    tagId = existingTag.id
  } else {
    const { data: newTag } = await supabase
      .from('conversation_tags')
      .insert({ organization_id: orgId, name: STAFF_TAG_NAME, color: STAFF_TAG_COLOR })
      .select('id')
      .single()
    tagId = newTag?.id
  }

  // 4. Canal WhatsApp de la org (best-effort)
  let conversationId: string | undefined
  const { data: branches } = await supabase
    .from('branches')
    .select('id')
    .eq('organization_id', orgId)
  const branchIds = (branches ?? []).map(b => b.id)

  if (branchIds.length > 0) {
    const { data: channel } = await supabase
      .from('social_channels')
      .select('id')
      .in('branch_id', branchIds)
      .eq('platform', 'whatsapp')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()

    if (channel) {
      let phoneDigits = phoneClean.replace(/\D/g, '')
      if (!phoneDigits.startsWith('54')) phoneDigits = '54' + phoneDigits
      const suffix = phoneDigits.slice(-10)

      const { data: allWaChannels } = await supabase
        .from('social_channels')
        .select('id')
        .in('branch_id', branchIds)
        .eq('platform', 'whatsapp')
        .eq('is_active', true)
      const allChannelIds = (allWaChannels ?? []).map(c => c.id)

      const { data: existing } = await supabase
        .from('conversations')
        .select('id, client_id')
        .in('channel_id', allChannelIds.length > 0 ? allChannelIds : [channel.id])
        .ilike('platform_user_id', `%${suffix}`)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle()

      if (existing) {
        conversationId = existing.id
        if (!existing.client_id && clientId) {
          await supabase
            .from('conversations')
            .update({ client_id: clientId })
            .eq('id', existing.id)
        }
      } else {
        const { data: newConv } = await supabase
          .from('conversations')
          .insert({
            channel_id: channel.id,
            client_id: clientId,
            platform_user_id: phoneDigits,
            platform_user_name: staff.full_name,
            status: 'open',
            unread_count: 0,
          })
          .select('id')
          .single()
        conversationId = newConv?.id
      }

      if (conversationId && tagId) {
        await supabase
          .from('conversation_tag_assignments')
          .upsert(
            { conversation_id: conversationId, tag_id: tagId },
            { onConflict: 'conversation_id,tag_id' },
          )
      }
    }
  }

  revalidatePath('/dashboard/mensajeria')
  return { clientId, tagId, conversationId }
}
