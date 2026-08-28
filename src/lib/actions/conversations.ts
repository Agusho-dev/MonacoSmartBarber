'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from './org'
import { getScopedBranchIds } from './branch-access'
import { INBOX_PAGE_SIZE } from '@/lib/inbox'
import { requireOrgAccessToEntity } from './guard'
import { revalidatePath } from 'next/cache'

// Busca o crea una conversación WhatsApp para un cliente dado
export async function startConversation(clientId: string) {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'No autorizado' }

  const supabase = createAdminClient()

  // Obtener datos del cliente (scopeado por org — evita IDOR cross-org por id)
  const { data: client } = await supabase
    .from('clients')
    .select('id, name, phone')
    .eq('id', clientId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!client?.phone) return { error: 'El cliente no tiene teléfono registrado' }

  // Obtener canal WhatsApp activo de la org. Los canales son org-scope:
  // pueden ser org-wide (branch_id=NULL) o legacy por-sucursal. Resolver por
  // organization_id (NO por branch_id, que excluye los org-wide). Preferir el
  // org-wide (nullsFirst).
  const { data: waChannels } = await supabase
    .from('social_channels')
    .select('id')
    .eq('organization_id', orgId)
    .eq('platform', 'whatsapp')
    .eq('is_active', true)
    .order('branch_id', { ascending: true, nullsFirst: true })

  const allChannelIds = (waChannels as { id: string }[] | null)?.map((c) => c.id) ?? []
  if (allChannelIds.length === 0) return { error: 'No hay un canal WhatsApp configurado. Guardá tus credenciales primero.' }
  const channel = { id: allChannelIds[0] }

  let phoneClean = client.phone.replace(/\D/g, '')
  if (!phoneClean.startsWith('54')) phoneClean = '54' + phoneClean

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
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!client?.phone) return { error: 'El cliente no tiene teléfono registrado' }

  // Canal WA org-scope (org-wide branch_id=NULL o legacy por-sucursal).
  const { data: channel } = await supabase
    .from('social_channels')
    .select('id')
    .eq('organization_id', orgId)
    .eq('platform', 'whatsapp')
    .eq('is_active', true)
    .order('branch_id', { ascending: true, nullsFirst: true })
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

// ═══════════════════════════════════════════════════════════════════════════
// INBOX: búsqueda y paginación
// ═══════════════════════════════════════════════════════════════════════════
//
// PostgREST corta en 1000 filas (`max-rows`). El inbox pedía las conversaciones
// sin `.limit()` y se comía ese tope en silencio: con 6.367 conversaciones sólo
// veía las 1000 más recientes —los últimos 10 días de 5 meses de historia— y el
// buscador filtraba en el cliente sobre ESE array. Buscar a alguien que escribió
// en junio no devolvía nada y no había forma de llegar a esa conversación.
//
// Estas dos funciones son las que hacen alcanzable el historial completo:
// `searchConversations` busca contra la tabla entera (RPC `search_conversations`,
// mig 195) y `loadMoreConversations` pagina por keyset.

/** Embeds que espera la UI del inbox. Igual que el SELECT de la página. */
const INBOX_SELECT = `
  *,
  channel:social_channels(id, platform, display_name, branch_id),
  client:clients(id, name, phone, instagram, notes),
  tags:conversation_tag_assignments(tag_id, tag:conversation_tags(id, name, color))
`

type ConvRow = { id: string; [key: string]: unknown }

/**
 * Canales de la org visibles para el usuario.
 *
 * Los canales son **org-scope**: pueden ser org-wide (`branch_id = NULL`) o
 * legacy por sucursal. Filtrar sólo por `branch_id` deja afuera los org-wide,
 * que son la mayoría — es lo que rompió el flujo de reseñas en abril/2026.
 */
async function getInboxChannelIds(): Promise<string[]> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return []

  const supabase = createAdminClient()
  const branchIds = await getScopedBranchIds()

  const filters: string[] = [`organization_id.eq.${orgId}`]
  if (branchIds.length > 0) filters.push(`branch_id.in.(${branchIds.join(',')})`)

  const { data } = await supabase.from('social_channels').select('id').or(filters.join(','))
  return (data ?? []).map((c) => c.id as string)
}

/**
 * Hidrata el último mensaje de cada conversación (el preview de la lista).
 * Sin esto el preview muestra el teléfono hasta que llegue un realtime update
 * — o sea, nunca, si esa conversación no tiene más tráfico.
 */
async function hidratarUltimoMensaje(convs: ConvRow[]): Promise<ConvRow[]> {
  if (convs.length === 0) return convs
  const supabase = createAdminClient()
  const { data: lastMsgs } = await supabase.rpc('get_last_messages_for_conversations', {
    conv_ids: convs.map((c) => c.id),
  })
  if (!lastMsgs) return convs

  const porConv: Record<string, unknown> = {}
  for (const m of lastMsgs as Array<{ conversation_id: string }>) {
    porConv[m.conversation_id] = m
  }
  return convs.map((c) => ({ ...c, last_message: porConv[c.id] ? [porConv[c.id]] : [] }))
}

/**
 * Busca conversaciones en TODO el historial, no sólo en las cargadas.
 *
 * Tolerancia igual que `/dashboard/clientes`: pliega acentos, acepta los tokens
 * del nombre en cualquier orden y normaliza el teléfono. Busca también por el
 * nombre/identificador de la plataforma, porque **una conversación puede no
 * tener `client_id`** (alguien que escribió y todavía no es cliente) y ésas son
 * justo las que uno busca por el nombre que muestra WhatsApp.
 */
export async function searchConversations(query: string) {
  const q = (query ?? '').trim()
  if (q.length < 2) return { data: [] }

  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'No autorizado' }

  const supabase = createAdminClient()
  const { data: hits, error } = await supabase.rpc('search_conversations', {
    p_organization_id: orgId,
    p_query: q,
    p_limit: 50,
  })
  if (error) {
    console.error('[mensajeria] searchConversations:', error.message)
    return { error: 'No pudimos buscar en el historial' }
  }

  const ids = (hits ?? []).map((h: { id: string }) => h.id)
  if (ids.length === 0) return { data: [] }

  // La RPC resuelve el scope de ORG; acá se aplica además el scope de SUCURSAL
  // del usuario (`role_branch_scope`), que la RPC no conoce.
  const channelIds = await getInboxChannelIds()
  if (channelIds.length === 0) return { data: [] }

  const { data: convs, error: errConvs } = await supabase
    .from('conversations')
    .select(INBOX_SELECT)
    .in('id', ids)
    .in('channel_id', channelIds)
    .order('last_message_at', { ascending: false, nullsFirst: false })

  if (errConvs) {
    console.error('[mensajeria] searchConversations hidratar:', errConvs.message)
    return { error: 'No pudimos buscar en el historial' }
  }

  return { data: await hidratarUltimoMensaje((convs ?? []) as ConvRow[]) }
}

/**
 * Página siguiente de la lista, por **keyset** sobre `last_message_at`.
 *
 * Keyset y no `.range(offset)`: en un inbox cada mensaje nuevo empuja su
 * conversación al tope, así que con offset las páginas se solapan y se saltean
 * filas justo mientras el local está trabajando.
 *
 * `cursor` = `last_message_at` del último elemento que ya tiene el cliente.
 * `null` = pedir la primera página. Las conversaciones sin `last_message_at`
 * (hoy 2) van al final, en su propia fase.
 */
export async function loadMoreConversations(cursor: string | null, nullsPhase = false) {
  const channelIds = await getInboxChannelIds()
  if (channelIds.length === 0) return { data: [], hasMore: false, nullsPhase: true }

  const supabase = createAdminClient()

  if (!nullsPhase) {
    let q = supabase
      .from('conversations')
      .select(INBOX_SELECT)
      .in('channel_id', channelIds)
      .not('last_message_at', 'is', null)
      .order('last_message_at', { ascending: false })
      .limit(INBOX_PAGE_SIZE)
    if (cursor) q = q.lt('last_message_at', cursor)

    const { data, error } = await q
    if (error) {
      console.error('[mensajeria] loadMoreConversations:', error.message)
      return { error: 'No pudimos cargar más conversaciones' }
    }
    const rows = (data ?? []) as ConvRow[]
    // Se agotaron las que tienen fecha: la próxima página son las que no la
    // tienen. Si no hubiera ninguna, `hasMore` se apaga en esa llamada.
    if (rows.length < INBOX_PAGE_SIZE) {
      return { data: await hidratarUltimoMensaje(rows), hasMore: true, nullsPhase: true }
    }
    return { data: await hidratarUltimoMensaje(rows), hasMore: true, nullsPhase: false }
  }

  const { data, error } = await supabase
    .from('conversations')
    .select(INBOX_SELECT)
    .in('channel_id', channelIds)
    .is('last_message_at', null)
    .order('created_at', { ascending: false })
    .limit(INBOX_PAGE_SIZE)

  if (error) {
    console.error('[mensajeria] loadMoreConversations (nulls):', error.message)
    return { error: 'No pudimos cargar más conversaciones' }
  }
  return { data: await hidratarUltimoMensaje((data ?? []) as ConvRow[]), hasMore: false, nullsPhase: true }
}

/** Cuántas conversaciones hay en total, para poder decir "N de M". */
export async function countConversations() {
  const channelIds = await getInboxChannelIds()
  if (channelIds.length === 0) return { total: 0 }

  const supabase = createAdminClient()
  const { count } = await supabase
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .in('channel_id', channelIds)

  return { total: count ?? 0 }
}
