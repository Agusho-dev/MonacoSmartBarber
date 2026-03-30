'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from './org'
import { revalidatePath } from 'next/cache'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

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
  return { data: data ?? [], error: null }
}

export async function getMessages(conversationId: string) {
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
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-message`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        conversation_id: conversationId,
        content,
        staff_id: staffId,
      }),
    })

    const result = await res.json()
    revalidatePath('/dashboard/mensajeria')
    
    if (!result.success) {
      return { error: result.error || 'Error al enviar mensaje' }
    }
    return { success: true }
  } catch {
    return { error: 'Error de conexión al enviar mensaje' }
  }
}

export async function sendTemplateMessage(
  clientId: string,
  channelId: string,
  templateName: string,
  templateParams?: Record<string, unknown>,
  staffId?: string
) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-message`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        channel_id: channelId,
        template_name: templateName,
        template_params: templateParams,
        staff_id: staffId,
      }),
    })

    const result = await res.json()
    revalidatePath('/dashboard/mensajeria')
    
    if (!result.success) {
      return { error: result.error || 'Error al enviar template' }
    }
    return { success: true }
  } catch {
    return { error: 'Error de conexión al enviar template' }
  }
}

export async function markAsRead(conversationId: string) {
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
