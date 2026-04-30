'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from './org'
import { requireOrgAccessToEntity } from './guard'
import { revalidatePath } from 'next/cache'

// Busca o crea una conversación WhatsApp para un cliente dado
export async function startConversation(clientId: string) {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'No autorizado' }

  const supabase = createAdminClient()

  // Obtener datos del cliente
  const { data: client } = await supabase
    .from('clients')
    .select('id, name, phone')
    .eq('id', clientId)
    .single()

  if (!client?.phone) return { error: 'El cliente no tiene teléfono registrado' }

  // Obtener canal WhatsApp activo de la org
  const { data: branches } = await supabase
    .from('branches')
    .select('id')
    .eq('organization_id', orgId)

  const branchIds = (branches as { id: string }[] | null)?.map((b) => b.id) ?? []
  if (branchIds.length === 0) return { error: 'No hay sucursales configuradas' }

  const { data: channel } = await supabase
    .from('social_channels')
    .select('id')
    .in('branch_id', branchIds)
    .eq('platform', 'whatsapp')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (!channel) return { error: 'No hay un canal WhatsApp configurado. Guardá tus credenciales primero.' }

  let phoneClean = client.phone.replace(/\D/g, '')
  if (!phoneClean.startsWith('54')) phoneClean = '54' + phoneClean

  // Obtener todos los canales WA de la org para buscar conversaciones existentes
  const { data: allWaChannels } = await supabase
    .from('social_channels')
    .select('id')
    .in('branch_id', branchIds)
    .eq('platform', 'whatsapp')
    .eq('is_active', true)

  const allChannelIds = (allWaChannels as { id: string }[] | null)?.map((c) => c.id) ?? [channel.id]

  // Buscar conversación existente por sufijo de teléfono para evitar duplicados
  // por diferencia de formato (ej: 549xxx vs 54xxx)
  const phoneSuffix = phoneClean.slice(-10)
  const { data: existing } = await supabase
    .from('conversations')
    .select('*')
    .in('channel_id', allChannelIds)
    .ilike('platform_user_id', `%${phoneSuffix}`)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  if (existing) {
    // Vincular el cliente si no está vinculado
    if (!existing.client_id) {
      await supabase
        .from('conversations')
        .update({ client_id: clientId })
        .eq('id', existing.id)
      existing.client_id = clientId
    }
    return { data: existing, error: null }
  }

  // Crear nueva conversación
  const { data: newConv, error } = await supabase
    .from('conversations')
    .insert({
      channel_id: channel.id,
      client_id: clientId,
      platform_user_id: phoneClean,
      platform_user_name: client.name,
      status: 'open',
      unread_count: 0,
    })
    .select()
    .single()

  if (error) return { error: error.message }

  revalidatePath('/dashboard/mensajeria')
  return { data: newConv, error: null }
}

// Actualiza el estado de una conversación (open / closed / archived)
export async function updateConversationStatus(
  conversationId: string,
  status: 'open' | 'closed' | 'archived'
) {
  const orgAccess = await requireOrgAccessToEntity('conversations', conversationId)
  if (!orgAccess.ok) return { error: 'Acceso denegado' }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('conversations')
    .update({ status })
    .eq('id', conversationId)

  if (error) return { error: error.message }
  revalidatePath('/dashboard/mensajeria')
  return { success: true }
}

// Obtiene el historial de visitas de un cliente (para el panel lateral)
export async function getClientVisits(clientId: string) {
  const orgAccess = await requireOrgAccessToEntity('clients', clientId)
  if (!orgAccess.ok) return { data: [], error: 'Acceso denegado' }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('visits')
    .select('id, amount, started_at, completed_at, payment_method, service:services(name), barber:staff(full_name)')
    .eq('client_id', clientId)
    .order('started_at', { ascending: false })
    .limit(10)

  if (error) return { data: [], error: error.message }
  return { data: data ?? [], error: null }
}

// Schedules a message — finds channel automatically from org config
export async function scheduleMessageAuto(data: {
  clientId: string
  content: string
  scheduledFor: string
  createdBy?: string
}) {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'No autorizado' }

  const supabase = createAdminClient()

  const { data: client } = await supabase
    .from('clients')
    .select('phone')
    .eq('id', data.clientId)
    .single()

  if (!client?.phone) return { error: 'El cliente no tiene teléfono registrado' }

  const { data: branches } = await supabase
    .from('branches')
    .select('id')
    .eq('organization_id', orgId)

  const branchIds = (branches as { id: string }[] | null)?.map((b) => b.id) ?? []

  const { data: channel } = await supabase
    .from('social_channels')
    .select('id')
    .in('branch_id', branchIds)
    .eq('platform', 'whatsapp')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (!channel) return { error: 'No hay canal WhatsApp configurado' }

  const { error } = await supabase
    .from('scheduled_messages')
    .insert({
      channel_id: channel.id,
      client_id: data.clientId,
      content: data.content,
      scheduled_for: data.scheduledFor,
      created_by: data.createdBy ?? null,
      phone: client.phone,
    })

  if (error) return { error: error.message }
  revalidatePath('/dashboard/mensajeria')
  return { success: true }
}
