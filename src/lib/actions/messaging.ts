'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from './org'
import { requireOrgAccessToEntity } from './guard'
import { revalidatePath } from 'next/cache'

export async function getConversations(channelFilter?: string) {
  const supabase = createAdminClient()

  // Filtrar conversaciones por canales que pertenecen a sucursales de esta org
  const orgId = await getCurrentOrgId()
  if (!orgId) return { data: [], error: 'No autorizado' }

  const { data: orgBranches } = await supabase
    .from('branches')
    .select('id')
    .eq('organization_id', orgId)
  const branchIds = orgBranches?.map((b) => b.id) ?? []

  const { data: orgChannels } = await supabase
    .from('social_channels')
    .select('id')
    .in('branch_id', branchIds)
  const channelIds = orgChannels?.map((c) => c.id) ?? []

  let query = supabase
    .from('conversations')
    .select(`
      *,
      channel:social_channels(id, platform, display_name),
      client:clients(id, name, phone, instagram)
    `)
    .in('channel_id', channelIds)
    .order('last_message_at', { ascending: false, nullsFirst: false })

  if (channelFilter && channelFilter !== 'all') {
    query = query.eq('channel.platform', channelFilter)
  }

  const { data, error } = await query

  if (error) return { data: [], error: error.message }

  // Traer el último mensaje de cada conversación en una sola query
  const convIds = (data ?? []).map(c => c.id)
  let lastMessages: Record<string, { content: string | null; direction: string; content_type: string; created_at: string }> = {}

  if (convIds.length > 0) {
    const { data: msgs } = await supabase.rpc('get_last_messages_for_conversations', { conv_ids: convIds })
    if (msgs) {
      for (const m of msgs as Array<{ conversation_id: string; content: string | null; direction: string; content_type: string; created_at: string }>) {
        lastMessages[m.conversation_id] = m
      }
    }
  }

  const enriched = (data ?? []).map(c => {
    const lm = lastMessages[c.id]
    return { ...c, last_message: lm ? [lm] : [] }
  })

  return { data: enriched, error: null }
}

export async function getMessages(conversationId: string) {
  const orgAccess = await requireOrgAccessToEntity('conversations', conversationId)
  if (!orgAccess.ok) return { data: [], error: 'Acceso denegado' }

  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('messages')
    .select('*, sent_by:staff(full_name)')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })

  if (error) return { data: [], error: error.message }
  return { data: data ?? [], error: null }
}

export async function sendMessage(
  conversationId: string,
  content: string,
  staffId?: string
) {
  const orgAccess = await requireOrgAccessToEntity('conversations', conversationId)
  if (!orgAccess.ok) return { error: 'Acceso denegado' }

  const supabase = createAdminClient()

  // Obtener conversación para conocer el teléfono y la plataforma
  const { data: conv } = await supabase
    .from('conversations')
    .select('platform_user_id, channel:social_channels(platform)')
    .eq('id', conversationId)
    .single()

  if (!conv) return { error: 'Conversación no encontrada' }

  const platform = (conv.channel as any)?.platform as string | undefined

  if (platform === 'whatsapp') {
    const { sendMetaWhatsAppMessage } = await import('./whatsapp-meta')
    return sendMetaWhatsAppMessage(conv.platform_user_id, content, conversationId, staffId)
  }

  if (platform === 'instagram') {
    const { sendInstagramMessage } = await import('./instagram-meta')
    return sendInstagramMessage(conv.platform_user_id, content, conversationId, staffId)
  }

  return { error: 'Plataforma no soportada aún' }
}

// Envía un template de WA a una conversación existente
export async function sendTemplateToConversation(
  conversationId: string,
  templateName: string,
  languageCode: string,
  components?: Record<string, unknown>[],
  staffId?: string
) {
  const orgAccess = await requireOrgAccessToEntity('conversations', conversationId)
  if (!orgAccess.ok) return { error: 'Acceso denegado' }

  const supabase = createAdminClient()

  const { data: conv } = await supabase
    .from('conversations')
    .select('platform_user_id, channel:social_channels(platform)')
    .eq('id', conversationId)
    .single()

  if (!conv) return { error: 'Conversación no encontrada' }

  const platform = (conv.channel as any)?.platform as string | undefined
  if (platform !== 'whatsapp') return { error: 'Templates solo disponibles para WhatsApp' }

  const { sendMetaWhatsAppTemplate } = await import('./whatsapp-meta')
  return sendMetaWhatsAppTemplate(
    conv.platform_user_id,
    templateName,
    languageCode,
    conversationId,
    components,
    staffId
  )
}

// Inicia una conversación nueva con un cliente vía template
export async function sendTemplateToClient(
  clientId: string,
  templateName: string,
  languageCode: string,
  components?: Record<string, unknown>[],
  staffId?: string
) {
  const supabase = createAdminClient()
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'No autorizado' }

  // Obtener teléfono del cliente
  const { data: client } = await supabase
    .from('clients')
    .select('id, name, phone')
    .eq('id', clientId)
    .eq('organization_id', orgId)
    .single()

  if (!client?.phone) return { error: 'El cliente no tiene teléfono registrado' }

  // Obtener canal WA
  const { data: orgBranches } = await supabase
    .from('branches')
    .select('id')
    .eq('organization_id', orgId)
  const branchIds = orgBranches?.map((b: { id: string }) => b.id) ?? []

  const { data: waChannel } = await supabase
    .from('social_channels')
    .select('id')
    .in('branch_id', branchIds)
    .eq('platform', 'whatsapp')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (!waChannel) return { error: 'Canal WhatsApp no encontrado' }

  // Normalizar teléfono para platform_user_id
  let phone = client.phone.replace(/\D/g, '')
  if (!phone.startsWith('54')) {
    if (phone.startsWith('9') && phone.length === 11) {
      phone = '54' + phone.slice(1)
    } else {
      phone = '54' + phone
    }
  } else if (phone.startsWith('549') && phone.length === 13) {
    phone = '54' + phone.slice(3)
  }

  // Buscar o crear conversación (por sufijo para evitar duplicados por formato 54xxx vs 549xxx)
  const phoneSuffix = phone.slice(-10)
  let { data: conv } = await supabase
    .from('conversations')
    .select('id')
    .eq('channel_id', waChannel.id)
    .ilike('platform_user_id', `%${phoneSuffix}`)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  if (!conv) {
    const { data: newConv, error: convErr } = await supabase
      .from('conversations')
      .insert({
        channel_id: waChannel.id,
        client_id: clientId,
        platform_user_id: phone,
        platform_user_name: client.name || phone,
        status: 'open',
        unread_count: 0,
        last_message_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (convErr || !newConv) return { error: 'Error al crear conversación' }
    conv = newConv
  }

  const { sendMetaWhatsAppTemplate } = await import('./whatsapp-meta')
  return sendMetaWhatsAppTemplate(
    phone,
    templateName,
    languageCode,
    conv.id,
    components,
    staffId
  )
}

export async function markAsRead(conversationId: string) {
  const orgAccess = await requireOrgAccessToEntity('conversations', conversationId)
  if (!orgAccess.ok) return { success: false, error: 'Acceso denegado' }

  const supabase = createAdminClient()

  await supabase
    .from('conversations')
    .update({ unread_count: 0 })
    .eq('id', conversationId)

  revalidatePath('/dashboard/mensajeria')
  return { success: true }
}

export async function scheduleMessage(data: {
  channelId: string
  clientId: string
  templateId?: string
  content?: string
  templateParams?: Record<string, unknown>
  scheduledFor: string
  createdBy?: string
}) {
  // Validar ownership del canal y del cliente antes de insertar
  const [channelAccess, clientAccess] = await Promise.all([
    requireOrgAccessToEntity('social_channels', data.channelId),
    requireOrgAccessToEntity('clients', data.clientId),
  ])
  if (!channelAccess.ok) return { error: 'Acceso denegado al canal' }
  if (!clientAccess.ok) return { error: 'Acceso denegado al cliente' }

  const supabase = createAdminClient()

  const { error } = await supabase
    .from('scheduled_messages')
    .insert({
      channel_id: data.channelId,
      client_id: data.clientId,
      template_id: data.templateId || null,
      content: data.content || null,
      template_params: data.templateParams || null,
      scheduled_for: data.scheduledFor,
      created_by: data.createdBy || null,
    })

  if (error) return { error: 'Error al programar mensaje' }
  revalidatePath('/dashboard/mensajeria')
  return { success: true }
}

export async function cancelScheduledMessage(id: string) {
  const orgAccess = await requireOrgAccessToEntity('scheduled_messages', id)
  if (!orgAccess.ok) return { error: 'Acceso denegado' }

  const supabase = createAdminClient()

  const { error } = await supabase
    .from('scheduled_messages')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('status', 'pending')

  if (error) return { error: 'Error al cancelar mensaje programado' }
  revalidatePath('/dashboard/mensajeria')
  return { success: true }
}

export async function getScheduledMessages() {
  const supabase = createAdminClient()

  // Filtrar mensajes programados por canales de la org actual
  const orgId = await getCurrentOrgId()
  if (!orgId) return { data: [], error: 'No autorizado' }

  const { data: orgBranches } = await supabase
    .from('branches')
    .select('id')
    .eq('organization_id', orgId)
  const branchIds = orgBranches?.map((b) => b.id) ?? []

  const { data: orgChannels } = await supabase
    .from('social_channels')
    .select('id')
    .in('branch_id', branchIds)
  const channelIds = orgChannels?.map((c) => c.id) ?? []

  const { data, error } = await supabase
    .from('scheduled_messages')
    .select(`
      *,
      channel:social_channels(platform, display_name),
      client:clients(name, phone),
      template:message_templates(name),
      created_by_staff:staff(full_name)
    `)
    .in('channel_id', channelIds)
    .in('status', ['pending', 'sent', 'failed'])
    .order('scheduled_for', { ascending: true })

  if (error) return { data: [], error: error.message }
  return { data: data ?? [], error: null }
}

export async function getChannels() {
  const supabase = createAdminClient()

  // Obtener solo canales de sucursales que pertenecen a esta org
  const orgId = await getCurrentOrgId()
  if (!orgId) return { data: [], error: 'No autorizado' }

  const { data: orgBranches } = await supabase
    .from('branches')
    .select('id')
    .eq('organization_id', orgId)
  const branchIds = orgBranches?.map((b) => b.id) ?? []

  const { data, error } = await supabase
    .from('social_channels')
    .select('*')
    .in('branch_id', branchIds)
    .eq('is_active', true)
    .order('platform')

  if (error) return { data: [], error: error.message }
  return { data: data ?? [], error: null }
}

export async function getTemplates(channelId?: string) {
  const supabase = createAdminClient()

  // Limitar templates a canales de la org actual
  const orgId = await getCurrentOrgId()
  if (!orgId) return { data: [], error: 'No autorizado' }

  const { data: orgBranches } = await supabase
    .from('branches')
    .select('id')
    .eq('organization_id', orgId)
  const branchIds = orgBranches?.map((b) => b.id) ?? []

  const { data: orgChannels } = await supabase
    .from('social_channels')
    .select('id')
    .in('branch_id', branchIds)
  const channelIds = orgChannels?.map((c) => c.id) ?? []

  let query = supabase
    .from('message_templates')
    .select('*')
    .in('channel_id', channelIds)
    .eq('status', 'approved')
    .order('name')

  if (channelId) {
    query = query.eq('channel_id', channelId)
  }

  const { data, error } = await query

  if (error) return { data: [], error: error.message }
  return { data: data ?? [], error: null }
}
