// =============================================================================
// «Por responder» en el servidor: leer lo que espera y atender una conversación.
//
// Server-only y SIN 'use server' (como programados.ts): reciben el cliente con
// service role, y en un archivo 'use server' todo export sería un endpoint. Las
// usan las actions de la bandeja (actions/por-responder.ts), sendMessage
// (actions/messaging.ts: contestar a mano también atiende) y el cron de los
// avisos (api/cron/avisos-mensajeria).
// =============================================================================

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizarPendiente, type FilaPendiente, type Pendiente } from './por-responder'

/** Los días hacia atrás que mira la bandeja. Más viejo que esto no se muestra ni se avisa. */
export const DIAS_DE_LA_BANDEJA = 7

/**
 * Lo que espera a una persona en los canales dados. Tira si la RPC falla: una
 * bandeja vacía por un error se leería como «todo respondido» (Known Risk #15).
 */
export async function leerPendientes(
  supabase: SupabaseClient,
  orgId: string,
  canales: string[],
): Promise<Pendiente[]> {
  if (canales.length === 0) return []
  const { data, error } = await supabase.rpc('mensajeria_pendientes', {
    p_org: orgId,
    p_canales: canales,
    p_dias: DIAS_DE_LA_BANDEJA,
  })
  if (error) throw new Error(`[por-responder] mensajeria_pendientes: ${error.message}`)
  return ((data ?? []) as FilaPendiente[]).map(normalizarPendiente)
}

/**
 * La conversación, si es de uno de los canales dados (el alcance de Mensajería
 * de quien llama). Null si no existe o es de otra org.
 */
export async function conversacionDelAlcance(
  supabase: SupabaseClient,
  conversationId: string,
  canales: string[],
): Promise<{ id: string; channel_id: string; client_id: string | null; last_inbound_at: string | null } | null> {
  if (canales.length === 0) return null
  const { data, error } = await supabase
    .from('conversations')
    .select('id, channel_id, client_id, last_inbound_at')
    .eq('id', conversationId)
    .in('channel_id', canales)
    .maybeSingle()
  if (error) throw new Error(`[por-responder] conversations: ${error.message}`)
  return (data as { id: string; channel_id: string; client_id: string | null; last_inbound_at: string | null } | null) ?? null
}

/**
 * Deja atendida una conversación: las alertas sin leer pasan a leídas (con quién
 * y cuándo) y `mensajeria_atencion` guarda hasta cuándo. Si el cliente vuelve
 * a escribir después, la consulta reaparece sola.
 *
 * `como`: 'respondida' cuando salió un mensaje de una persona (sendMessage), 'listo'
 * cuando se descartó desde la bandeja. Tira si alguna escritura falla.
 */
export async function atenderConversacion(
  supabase: SupabaseClient,
  args: {
    orgId: string
    conversationId: string
    como: 'respondida' | 'listo'
    authUserId: string | null
    staffId: string | null
    /** Hasta cuándo queda atendida. Por defecto, ahora. */
    hasta?: string
  },
): Promise<void> {
  const ahora = args.hasta ?? new Date().toISOString()
  const [alertas, atencion] = await Promise.all([
    supabase
      .from('crm_alerts')
      .update({ is_read: true, read_at: ahora, read_by: args.staffId })
      .eq('organization_id', args.orgId)
      .eq('conversation_id', args.conversationId)
      .eq('is_read', false),
    supabase
      .from('mensajeria_atencion')
      .upsert(
        {
          conversation_id: args.conversationId,
          organization_id: args.orgId,
          atendida_hasta: ahora,
          como: args.como,
          atendida_por: args.authUserId,
          updated_at: ahora,
        },
        { onConflict: 'conversation_id' },
      ),
  ])
  if (alertas.error) throw new Error(`[por-responder] crm_alerts: ${alertas.error.message}`)
  if (atencion.error) throw new Error(`[por-responder] mensajeria_atencion: ${atencion.error.message}`)
}

/** El id de staff de un usuario del dashboard en la org (los dueños pueden no tener fila). */
export async function staffDelUsuario(
  supabase: SupabaseClient,
  authUserId: string,
  orgId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('staff')
    .select('id')
    .eq('auth_user_id', authUserId)
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}
