'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from './org'
import { revalidatePath } from 'next/cache'
import type { AudienceFilters } from './client-segments'

async function requireOrgId(): Promise<{ orgId: string } | { error: string }> {
  const orgId = await getCurrentOrgId()
  if (!orgId) {
    console.error('[Broadcasts] getCurrentOrgId returned null — session may have expired')
    return { error: 'Sesión expirada. Recargá la página e intentá de nuevo.' }
  }
  return { orgId }
}

export async function getBroadcasts() {
  const result = await requireOrgId()
  if ('error' in result) return { data: [], error: result.error }
  const orgId = result.orgId

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('broadcasts')
    .select('*')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return { data: [], error: error.message }
  return { data: data ?? [], error: null }
}

export async function createBroadcast(input: {
  name: string
  templateName: string
  templateLanguage?: string
  audienceFilters: AudienceFilters
  scheduledFor?: string
}) {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }
  const orgId = result.orgId
  if (!input.name.trim()) return { error: 'Nombre requerido' }
  if (!input.templateName) return { error: 'Template requerido' }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('broadcasts')
    .insert({
      organization_id: orgId,
      name: input.name.trim(),
      status: 'draft',
      message_type: 'template',
      template_name: input.templateName,
      template_language: input.templateLanguage || 'es_AR',
      audience_filters: input.audienceFilters,
      scheduled_for: input.scheduledFor || null,
    })
    .select('*')
    .single()

  if (error) return { error: error.message }
  revalidatePath('/dashboard/mensajeria')
  return { data, error: null }
}

export async function sendBroadcast(broadcastId: string) {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }
  const orgId = result.orgId

  const supabase = createAdminClient()

  // Obtener el broadcast
  const { data: broadcast } = await supabase
    .from('broadcasts')
    .select('*')
    .eq('id', broadcastId)
    .eq('organization_id', orgId)
    .single()

  if (!broadcast) return { error: 'Difusion no encontrada' }
  if (broadcast.status !== 'draft') return { error: 'Solo se pueden enviar difusiones en borrador' }

  // Resolver la audiencia
  const { getFilteredClientIds } = await import('./client-segments')
  const { clients, error: filterErr } = await getFilteredClientIds(broadcast.audience_filters as AudienceFilters)
  if (filterErr) return { error: filterErr }
  if (clients.length === 0) return { error: 'No hay clientes que coincidan con los filtros' }

  // Crear recipients en lotes (Supabase tiene límites de payload)
  const BATCH = 500
  const recipients = clients.map(c => ({
    broadcast_id: broadcastId,
    client_id: c.id,
    phone: c.phone,
    status: 'pending',
  }))

  for (let i = 0; i < recipients.length; i += BATCH) {
    const batch = recipients.slice(i, i + BATCH)
    const { error: recipErr } = await supabase
      .from('broadcast_recipients')
      .insert(batch)
    if (recipErr) return { error: 'Error al crear destinatarios: ' + recipErr.message }
  }

  // Obtener canal WA para scheduled_messages
  const { data: orgBranches } = await supabase
    .from('branches')
    .select('id')
    .eq('organization_id', orgId)
  const branchIds = orgBranches?.map((b: { id: string }) => b.id) ?? []

  let channelId: string | null = null
  if (branchIds.length > 0) {
    const { data: ch } = await supabase
      .from('social_channels')
      .select('id')
      .in('branch_id', branchIds)
      .eq('platform', 'whatsapp')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()
    channelId = ch?.id ?? null
  }

  // Crear scheduled_messages para cada destinatario
  const scheduledFor = broadcast.scheduled_for || new Date().toISOString()
  const scheduledRows = clients.map(c => ({
    client_id: c.id,
    phone: c.phone,
    template_name: broadcast.template_name,
    template_language: broadcast.template_language || 'es_AR',
    scheduled_for: scheduledFor,
    status: 'pending',
    broadcast_id: broadcastId,
    channel_id: channelId,
  }))

  for (let i = 0; i < scheduledRows.length; i += BATCH) {
    const batch = scheduledRows.slice(i, i + BATCH)
    const { error: schedErr } = await supabase
      .from('scheduled_messages')
      .insert(batch)
    if (schedErr) return { error: 'Error al programar mensajes: ' + schedErr.message }
  }

  // Actualizar broadcast
  await supabase
    .from('broadcasts')
    .update({
      status: broadcast.scheduled_for ? 'scheduled' : 'sending',
      audience_count: clients.length,
      started_at: new Date().toISOString(),
    })
    .eq('id', broadcastId)

  revalidatePath('/dashboard/mensajeria')
  return { success: true, recipientCount: clients.length }
}

export async function cancelBroadcast(broadcastId: string) {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }
  const orgId = result.orgId

  const supabase = createAdminClient()

  // Cancelar scheduled_messages pendientes
  await supabase
    .from('scheduled_messages')
    .update({ status: 'cancelled' })
    .eq('broadcast_id', broadcastId)
    .eq('status', 'pending')

  // Actualizar broadcast
  await supabase
    .from('broadcasts')
    .update({ status: 'cancelled' })
    .eq('id', broadcastId)
    .eq('organization_id', orgId)
    .in('status', ['draft', 'scheduled', 'sending'])

  revalidatePath('/dashboard/mensajeria')
  return { success: true }
}
