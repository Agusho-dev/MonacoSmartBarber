// =============================================================================
// Mensajería en el servidor: qué canales ve el usuario y los mensajes
// programados (la vista Programados).
//
// Server-only y SIN 'use server' a propósito: en un archivo 'use server' todo
// export es un endpoint HTTP, y estas funciones reciben el cliente con service
// role. Las usan la página (/dashboard/mensajeria) y la action que relee la
// lista después de programar (obtenerProgramados, actions/programados.ts): así
// las dos miran exactamente lo mismo.
//
// Antes la página pedía `.order('scheduled_for', asc).limit(100)`, o sea los
// 100 MÁS VIEJOS. Con 208 filas en Monaco (oct/2026) eran del 08/04 al 27/07 y
// nada programado después aparecía nunca, tampoco al recargar.
// =============================================================================

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getScopedBranchIds } from '@/lib/actions/branch-access'

/** Lo que alcanza el usuario en Mensajería. */
export interface AlcanceMensajeria {
  orgId: string | null
  /** Las sucursales de la org que tiene permitidas, por nombre. */
  branches: { id: string; name: string }[]
  /** El `.or()` de los canales: org-wide (organization_id) o legacy por sucursal (branch_id). */
  channelFilters: string[]
  channelIds: string[]
}

/**
 * La organización de la sesión, sus sucursales permitidas y sus canales.
 *
 * Los canales pueden estar scopeados por `organization_id` (modelo org-wide,
 * nuevo) o por `branch_id` (legacy). Sin el OR, los canales de WhatsApp e
 * Instagram globales quedan invisibles y el inbox aparece vacío aunque existan
 * cientos de conversaciones activas.
 */
export async function alcanceDeMensajeria(supabase: SupabaseClient): Promise<AlcanceMensajeria> {
  const orgId = await getCurrentOrgId()
  const scopedIds = await getScopedBranchIds()
  const { data: orgBranches } = orgId && scopedIds.length > 0
    ? await supabase.from('branches').select('id, name').eq('organization_id', orgId).in('id', scopedIds).order('name')
    : { data: [] }
  const branches = (orgBranches ?? []) as { id: string; name: string }[]
  const branchIds = branches.map((b) => b.id)

  const channelFilters: string[] = []
  if (orgId) channelFilters.push(`organization_id.eq.${orgId}`)
  if (branchIds.length > 0) channelFilters.push(`branch_id.in.(${branchIds.join(',')})`)

  const { data: orgChannels } = channelFilters.length > 0
    ? await supabase.from('social_channels').select('id').or(channelFilters.join(','))
    : { data: [] }
  const channelIds = (orgChannels ?? []).map((c) => c.id as string)

  return { orgId, branches, channelFilters, channelIds }
}

/** Una fila de Programados: lo que dibuja la lista (ScheduledWithRelations en Mensajería). */
export interface ProgramadoFila {
  id: string
  client_id: string
  content: string | null
  scheduled_for: string
  status: string
  client?: { name: string; phone: string }
  template_name?: string | null
  error_message?: string | null
  sent_at?: string | null
}

const SELECT_PROGRAMADOS = `
  *,
  channel:social_channels(platform, display_name),
  client:clients(name, phone),
  template:message_templates(name),
  created_by_staff:staff(full_name)
`

// TODOS los pendientes: son los que alguien todavía puede cancelar. El .limit
// es explícito y alto porque PostgREST corta en silencio en 1000 filas
// (max-rows); en Monaco hay 0 a 30 pendientes a la vez.
const TOPE_PENDIENTES = 500
// De lo que ya salió (o falló), los últimos: el historial reciente.
const TOPE_HISTORIAL = 100

/**
 * Los mensajes programados de esos canales: todos los pendientes (del más
 * próximo al más lejano) y después los últimos enviados o fallidos (del más
 * nuevo al más viejo). Ese orden es el de la lista.
 */
export async function leerProgramados(
  supabase: SupabaseClient,
  channelIds: string[],
): Promise<{ data: ProgramadoFila[]; error: string | null }> {
  if (channelIds.length === 0) return { data: [], error: null }

  const [pendientes, historial] = await Promise.all([
    supabase
      .from('scheduled_messages')
      .select(SELECT_PROGRAMADOS)
      .in('channel_id', channelIds)
      .eq('status', 'pending')
      .order('scheduled_for', { ascending: true })
      .limit(TOPE_PENDIENTES),
    supabase
      .from('scheduled_messages')
      .select(SELECT_PROGRAMADOS)
      .in('channel_id', channelIds)
      .in('status', ['sent', 'failed'])
      .order('scheduled_for', { ascending: false })
      .limit(TOPE_HISTORIAL),
  ])

  // Un fallo no es "no hay programados": se dice (Known Risk #15 del CLAUDE.md raíz).
  const error = pendientes.error ?? historial.error
  if (error) {
    console.error('[mensajeria] leerProgramados:', error.message)
    return { data: [...(pendientes.data ?? []), ...(historial.data ?? [])] as ProgramadoFila[], error: 'No pudimos leer los mensajes programados' }
  }
  return { data: [...(pendientes.data ?? []), ...(historial.data ?? [])] as ProgramadoFila[], error: null }
}
