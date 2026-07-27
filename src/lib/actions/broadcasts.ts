'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from './org'
import { requireOrgAccessToEntity } from './guard'
import { revalidatePath } from 'next/cache'
import type { AudienceFilters } from './client-segments'
import { normalizeCsvPhone, CSV_MAX_CONTACTS } from '@/lib/csv/contacts'

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

// ===========================================================================
// Audiencia desde CSV
// ===========================================================================

export interface CsvContactInput {
  name: string
  phone: string
}

/**
 * Deduplica y normaliza los contactos que llegan del wizard. El teléfono se
 * vuelve a normalizar en el servidor (nunca confiar en el que armó el browser).
 */
function sanitizeCsvContacts(contacts: CsvContactInput[]): Array<{ name: string; phone: string }> {
  const seen = new Set<string>()
  const out: Array<{ name: string; phone: string }> = []
  for (const c of contacts) {
    const phone = normalizeCsvPhone(String(c?.phone ?? ''))
    if (!phone || seen.has(phone)) continue
    seen.add(phone)
    out.push({ phone, name: String(c?.name ?? '').trim().slice(0, 120) })
  }
  return out
}

/**
 * Cuenta cuántos contactos del CSV ya existen como clientes de la org y cuántos
 * se van a crear. Es solo lectura: no escribe nada hasta que se crea la difusión.
 */
export async function previewCsvAudience(contacts: CsvContactInput[]): Promise<{
  total: number
  existing: number
  nuevos: number
  error?: string
}> {
  const result = await requireOrgId()
  if ('error' in result) return { total: 0, existing: 0, nuevos: 0, error: result.error }

  const clean = sanitizeCsvContacts(contacts ?? [])
  if (clean.length === 0) return { total: 0, existing: 0, nuevos: 0 }

  const supabase = createAdminClient()
  const phones = clean.map(c => c.phone)
  const found = new Set<string>()

  const CHUNK = 300
  for (let i = 0; i < phones.length; i += CHUNK) {
    const { data, error } = await supabase
      .from('clients')
      .select('phone')
      .eq('organization_id', result.orgId)
      .in('phone', phones.slice(i, i + CHUNK))
    if (error) return { total: clean.length, existing: 0, nuevos: 0, error: error.message }
    for (const row of data ?? []) if (row.phone) found.add(row.phone)
  }

  return { total: clean.length, existing: found.size, nuevos: clean.length - found.size }
}

/**
 * Find-or-create de los contactos del CSV como `clients` de la org.
 *
 * Por qué crear clientes en vez de mandar a teléfonos sueltos: todo el pipeline
 * de envío está clavado en `client_id` (`scheduled_messages.client_id` y
 * `broadcast_recipients.client_id` son NOT NULL, y el cron arma la conversación
 * del inbox con ese id). Creándolos acá, cuando el contacto responde el mensaje
 * cae en la misma ficha y los workflows `message_received` lo agarran.
 *
 * NUNCA pisa el nombre de un cliente existente: el CSV solo aporta nombre a los
 * que se crean nuevos.
 */
async function resolveCsvClientIds(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
  contacts: Array<{ name: string; phone: string }>,
  broadcastName: string,
): Promise<{ clientIds: string[]; created: number } | { error: string }> {
  const phones = contacts.map(c => c.phone)
  const idByPhone = new Map<string, string>()
  const CHUNK = 300

  const fetchExisting = async (list: string[]) => {
    for (let i = 0; i < list.length; i += CHUNK) {
      const { data, error } = await supabase
        .from('clients')
        .select('id, phone')
        .eq('organization_id', orgId)
        .in('phone', list.slice(i, i + CHUNK))
      if (error) return error.message
      for (const row of data ?? []) if (row.phone) idByPhone.set(row.phone, row.id)
    }
    return null
  }

  const readErr = await fetchExisting(phones)
  if (readErr) return { error: 'No se pudo leer la base de clientes: ' + readErr }

  const missing = contacts.filter(c => !idByPhone.has(c.phone))
  let created = 0

  if (missing.length > 0) {
    const note = `Importado desde CSV — difusión "${broadcastName}"`
    for (let i = 0; i < missing.length; i += CHUNK) {
      const batch = missing.slice(i, i + CHUNK).map(c => ({
        organization_id: orgId,
        phone: c.phone,
        name: c.name || `+54${c.phone}`,
        notes: note,
      }))
      // ignoreDuplicates: si otro import creó el mismo teléfono en paralelo, el
      // UNIQUE (organization_id, phone) lo absorbe en vez de tirar la operación.
      const { data, error } = await supabase
        .from('clients')
        .upsert(batch, { onConflict: 'organization_id,phone', ignoreDuplicates: true })
        .select('id, phone')
      if (error) return { error: 'No se pudieron crear los contactos: ' + error.message }
      created += data?.length ?? 0
      for (const row of data ?? []) if (row.phone) idByPhone.set(row.phone, row.id)
    }

    // Releer los que el upsert no devolvió (conflictos ignorados).
    const stillMissing = phones.filter(p => !idByPhone.has(p))
    if (stillMissing.length > 0) {
      const retryErr = await fetchExisting(stillMissing)
      if (retryErr) return { error: 'No se pudo resolver los contactos: ' + retryErr }
    }
  }

  const clientIds = phones.map(p => idByPhone.get(p)).filter((id): id is string => !!id)
  if (clientIds.length === 0) return { error: 'No se pudo resolver ningún contacto del CSV' }

  return { clientIds, created }
}

export async function createBroadcast(input: {
  name: string
  templateName: string
  templateLanguage?: string
  templateComponents?: TemplateVariable[]
  audienceFilters: AudienceFilters
  /** Audiencia explícita importada de un CSV. Si viene, reemplaza a los filtros. */
  csvContacts?: CsvContactInput[]
  scheduledFor?: string
}) {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }
  const orgId = result.orgId
  if (!input.name.trim()) return { error: 'Nombre requerido' }
  if (!input.templateName) return { error: 'Template requerido' }

  // Gate de plan: broadcasts requiere feature + cap mensual (Pro = 500/mes).
  const { requireFeature, requireMonthlyCap } = await import('@/lib/actions/entitlements')
  const { EntitlementError } = await import('@/lib/billing/types')
  try {
    await requireFeature('messaging.broadcasts')
    await requireMonthlyCap('broadcasts_monthly', 1)
  } catch (e) {
    if (e instanceof EntitlementError) return { error: e.message, entitlement: e.toResponse() }
    throw e
  }

  const supabase = createAdminClient()

  // Audiencia por CSV: resolvemos los contactos a client_ids y los congelamos en
  // `manualClientIds`. Así `sendBroadcast` no necesita saber de dónde salió la
  // lista y la difusión queda reproducible aunque después cambien los clientes.
  let audienceFilters = input.audienceFilters
  let csvCreated = 0

  if (input.csvContacts && input.csvContacts.length > 0) {
    const clean = sanitizeCsvContacts(input.csvContacts)
    if (clean.length === 0) return { error: 'El CSV no tiene teléfonos válidos' }
    if (clean.length > CSV_MAX_CONTACTS) {
      return { error: `El CSV tiene ${clean.length} contactos y el máximo por difusión es ${CSV_MAX_CONTACTS}` }
    }

    const resolved = await resolveCsvClientIds(supabase, orgId, clean, input.name.trim())
    if ('error' in resolved) return { error: resolved.error }

    csvCreated = resolved.created
    audienceFilters = { manualClientIds: resolved.clientIds, hasPhone: true }
  }

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
      audience_filters: audienceFilters,
      audience_count: audienceFilters.manualClientIds?.length ?? 0,
      scheduled_for: input.scheduledFor || null,
    })
    .select('*')
    .single()

  if (error) return { error: error.message }
  revalidatePath('/dashboard/mensajeria')
  return { data, error: null, csvCreated }
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

  // ── Claim atómico: transicionar draft → sending/scheduled SOLO si sigue en
  // 'draft'. Esto evita la condición de carrera del doble-submit (dos llamadas
  // concurrentes pasaban el check de 'draft' y ambas insertaban recipients +
  // scheduled_messages → DOBLE ENVÍO). Si otra ejecución ya lo tomó, abortamos.
  const nextStatus = broadcast.scheduled_for ? 'scheduled' : 'sending'
  const { data: claimed, error: claimErr } = await supabase
    .from('broadcasts')
    .update({ status: nextStatus, audience_count: clients.length, started_at: new Date().toISOString() })
    .eq('id', broadcastId)
    .eq('status', 'draft')
    .select('id')
    .maybeSingle()
  if (claimErr) return { error: 'Error al iniciar la difusión: ' + claimErr.message }
  if (!claimed) return { error: 'La difusión ya está en proceso o fue enviada' }

  // Crear recipients en lotes. La idempotencia real la da el claim atómico de
  // arriba (la función corre una sola vez por difusión). La migración 145 agrega
  // un UNIQUE (broadcast_id, client_id) como defensa en profundidad — opcional.
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

  // Canal WA org-scope: org-wide (branch_id=NULL) o legacy por-sucursal.
  // NUNCA por .in('branch_id', ...) — eso excluye el canal org-wide y dejaba
  // channel_id=NULL en los scheduled_messages.
  const { data: ch } = await supabase
    .from('social_channels')
    .select('id')
    .eq('organization_id', orgId)
    .eq('platform', 'whatsapp')
    .eq('is_active', true)
    .order('branch_id', { ascending: true, nullsFirst: true })
    .limit(1)
    .maybeSingle()
  const channelId: string | null = ch?.id ?? null

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

  // (El estado y audience_count ya se setearon en el claim atómico de arriba.)

  // Registrar uso (cada broadcast cuenta como 1 del cap mensual del plan).
  // En try/catch: si el tracking de uso falla NO debe romper el envío (la difusión
  // ya se programó), pero sí debe quedar logueado en vez de tirar abajo la acción.
  try {
    const { incrementUsage } = await import('@/lib/actions/entitlements')
    await incrementUsage('broadcasts_sent', 1, orgId)
  } catch (usageErr) {
    console.error('[broadcasts] incrementUsage falló para', broadcastId, usageErr)
  }

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

  // Canales org-scope: incluir org-wide (branch_id=NULL) y legacy por-sucursal.
  // Con .in('branch_id', ...) el picker de templates quedaba vacío para orgs con
  // canal WhatsApp org-wide.
  const { data: orgChannels } = await supabase
    .from('social_channels')
    .select('id')
    .eq('organization_id', result.orgId)
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
