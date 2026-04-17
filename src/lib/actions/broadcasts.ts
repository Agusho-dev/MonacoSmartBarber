'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId, getOrgBranchIds } from './org'
import { requireOrgAccessToEntity } from './guard'
import { revalidatePath } from 'next/cache'
import type { AudienceFilters } from './client-segments'

// Estructura de variables por componente de template (Meta Cloud API format)
export interface TemplateVariable {
  type: 'header' | 'body'
  parameters: Array<{
    type: 'text' | 'image' | 'document' | 'video'
    text?: string
    // Para media
    image?: { link: string }
    document?: { link: string; filename?: string }
    video?: { link: string }
  }>
}

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
  templateComponents?: TemplateVariable[]
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
      template_components: input.templateComponents ?? null,
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

  const { data: broadcast } = await supabase
    .from('broadcasts')
    .select('*')
    .eq('id', broadcastId)
    .eq('organization_id', orgId)
    .single()

  if (!broadcast) return { error: 'Difusión no encontrada' }
  if (broadcast.status !== 'draft') return { error: 'Solo se pueden enviar difusiones en borrador' }

  // Resolver la audiencia
  const { getFilteredClientIds } = await import('./client-segments')
  const { clients, error: filterErr } = await getFilteredClientIds(broadcast.audience_filters as AudienceFilters)
  if (filterErr) return { error: filterErr }
  if (clients.length === 0) return { error: 'No hay clientes que coincidan con los filtros' }

  // Obtener nombres de clientes para personalización de variables
  const clientIds = clients.map(c => c.id)
  const clientNameMap = new Map<string, string>()

  const PAGE = 500
  for (let i = 0; i < clientIds.length; i += PAGE) {
    const chunk = clientIds.slice(i, i + PAGE)
    const { data: clientRows } = await supabase
      .from('clients')
      .select('id, name')
      .in('id', chunk)
    if (clientRows) {
      for (const c of clientRows) clientNameMap.set(c.id, c.name)
    }
  }

  // Crear recipients en lotes
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

  // Template components base del broadcast
  const baseComponents = (broadcast.template_components as TemplateVariable[] | null) ?? []

  // Crear scheduled_messages con variables personalizadas por cliente
  const scheduledFor = broadcast.scheduled_for || new Date().toISOString()

  const scheduledRows = clients.map(c => {
    const clientName = clientNameMap.get(c.id) ?? ''
    const firstName = clientName.split(/\s+/)[0] ?? ''

    // Reemplazar placeholders {{nombre}}, {{telefono}} en las variables
    const resolvedComponents = resolveTemplateVariables(baseComponents, {
      nombre: clientName,
      primer_nombre: firstName,
      telefono: c.phone,
    })

    return {
      client_id: c.id,
      phone: c.phone,
      template_name: broadcast.template_name,
      template_language: broadcast.template_language || 'es_AR',
      template_params: resolvedComponents.length > 0 ? resolvedComponents : null,
      scheduled_for: scheduledFor,
      status: 'pending',
      broadcast_id: broadcastId,
      channel_id: channelId,
    }
  })

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

  // Verificar ownership del broadcast ANTES de cancelar mensajes
  const orgAccess = await requireOrgAccessToEntity('broadcasts', broadcastId)
  if (!orgAccess.ok) return { error: 'Acceso denegado' }

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

// Reemplaza placeholders dinámicos en los parámetros de un template
function resolveTemplateVariables(
  components: TemplateVariable[],
  vars: Record<string, string>
): TemplateVariable[] {
  if (components.length === 0) return []

  return components.map(comp => ({
    ...comp,
    parameters: comp.parameters.map(param => {
      if (param.type !== 'text' || !param.text) return param
      let resolved = param.text
      for (const [key, val] of Object.entries(vars)) {
        resolved = resolved.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'gi'), val)
      }
      return { ...param, text: resolved }
    }),
  }))
}

// Obtener templates filtrados por canal (sucursal), escopado a canales de la org
export async function getTemplatesByChannel(channelId?: string) {
  const result = await requireOrgId()
  if ('error' in result) return { data: [], error: result.error }

  const supabase = createAdminClient()

  // Obtener canales de la org para acotar la query
  const orgBranchIds = await getOrgBranchIds()
  const { data: orgChannels } = await supabase
    .from('social_channels')
    .select('id')
    .in('branch_id', orgBranchIds)
  const orgChannelIds = (orgChannels ?? []).map(c => c.id)

  if (orgChannelIds.length === 0) return { data: [], error: null }

  let query = supabase
    .from('message_templates')
    .select('id, name, language, category, status, components, channel_id')
    .eq('status', 'approved')
    .in('channel_id', orgChannelIds)

  if (channelId) {
    // Si se filtra por canal, validar que ese canal pertenece a la org
    if (!orgChannelIds.includes(channelId)) return { data: [], error: 'Canal no autorizado' }
    query = query.eq('channel_id', channelId)
  }

  const { data, error } = await query.order('name')
  if (error) return { data: [], error: error.message }
  return { data: data ?? [], error: null }
}
