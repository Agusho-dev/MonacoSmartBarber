'use server'

// =============================================================================
// «Por responder» (6/nov/2026): las actions de la bandeja de tarjetas de
// Mensajería. La lógica de qué espera vive en la RPC `mensajeria_pendientes`
// (mig 237) y en src/lib/mensajeria/por-responder.ts (puro).
//
// Control de acceso, como obtenerProgramados: sesión de Supabase del dashboard
// (la cookie del panel del barbero no alcanza) y el permiso de Mensajería
// (`clients.view`). La org y los canales salen de la sesión
// (alcanceDeMensajeria), nunca del browser: cada conversación que llega se
// verifica contra esos canales.
//
// Todas devuelven `{ ok: true … } | { ok: false, error }` y NUNCA tiran: un
// rechazo dentro de una transición de React 19 se llevaba Mensajería entera al
// error boundary (mensajeria.md, «Programar»).
// =============================================================================

import { getCachedAuthUser } from '@/lib/auth-cache'
import { createAdminClient } from '@/lib/supabase/server'
import { isValidUUID } from '@/lib/validation'
import { alcanceDeMensajeria } from '@/lib/mensajeria/programados'
import {
  atenderConversacion, conversacionDelAlcance, leerPendientes, staffDelUsuario,
} from '@/lib/mensajeria/pendientes-servidor'
import { MAX_CARACTERES_RESPUESTA, type Pendiente } from '@/lib/mensajeria/por-responder'
import { currentUserCan } from './permissions-gate'
import { sendMessage } from './messaging'

type Falla = { ok: false; error: string }

async function acceso(): Promise<
  | { ok: true; userId: string; orgId: string; canales: string[]; supabase: ReturnType<typeof createAdminClient> }
  | Falla
> {
  const usuario = await getCachedAuthUser()
  if (!usuario) return { ok: false, error: 'Tu sesión venció. Volvé a iniciar sesión.' }
  if (!(await currentUserCan('clients.view'))) {
    return { ok: false, error: 'No tenés permiso para ver Mensajería.' }
  }
  const supabase = createAdminClient()
  const alcance = await alcanceDeMensajeria(supabase)
  if (!alcance.orgId) return { ok: false, error: 'No autorizado' }
  return { ok: true, userId: usuario.id, orgId: alcance.orgId, canales: alcance.channelIds, supabase }
}

function mensajeDe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Lo que espera a una persona (las tres pilas las arma el browser con `armarPilas`). */
export async function obtenerPorResponder(): Promise<{ ok: true; pendientes: Pendiente[]; ahora: string } | Falla> {
  try {
    const a = await acceso()
    if (!a.ok) return a
    const pendientes = await leerPendientes(a.supabase, a.orgId, a.canales)
    return { ok: true, pendientes, ahora: new Date().toISOString() }
  } catch (err) {
    console.error('[por-responder] obtenerPorResponder:', mensajeDe(err))
    return { ok: false, error: 'No pudimos leer lo que hay por responder. Probá de nuevo.' }
  }
}

/**
 * Contesta desde la bandeja: el mismo envío que el chat (sendMessage, que ya
 * deja la conversación atendida y firma el mensaje con quien lo manda).
 */
export async function responderPendiente(
  conversationId: string,
  texto: string,
): Promise<{ ok: true } | Falla> {
  try {
    if (!isValidUUID(conversationId)) return { ok: false, error: 'La conversación no es válida.' }
    const limpio = (texto ?? '').trim()
    if (!limpio) return { ok: false, error: 'Escribí la respuesta.' }
    if (limpio.length > MAX_CARACTERES_RESPUESTA) {
      return { ok: false, error: `La respuesta es demasiado larga (máximo ${MAX_CARACTERES_RESPUESTA} caracteres).` }
    }
    const a = await acceso()
    if (!a.ok) return a
    const conv = await conversacionDelAlcance(a.supabase, conversationId, a.canales)
    if (!conv) return { ok: false, error: 'No encontramos esa conversación.' }
    const r = await sendMessage(conversationId, limpio)
    if (r.error) return { ok: false, error: r.error }
    return { ok: true }
  } catch (err) {
    console.error('[por-responder] responderPendiente:', mensajeDe(err))
    return { ok: false, error: 'No se pudo mandar. Revisá la conexión y probá de nuevo.' }
  }
}

/**
 * «Listo»: no necesita respuesta (un gracias, algo resuelto por otro lado). Las
 * alertas pasan a leídas y la conversación queda atendida hasta ahora; si el
 * cliente vuelve a escribir, vuelve a aparecer.
 */
export async function marcarPendienteListo(conversationId: string): Promise<{ ok: true } | Falla> {
  try {
    if (!isValidUUID(conversationId)) return { ok: false, error: 'La conversación no es válida.' }
    const a = await acceso()
    if (!a.ok) return a
    const conv = await conversacionDelAlcance(a.supabase, conversationId, a.canales)
    if (!conv) return { ok: false, error: 'No encontramos esa conversación.' }
    const staffId = await staffDelUsuario(a.supabase, a.userId, a.orgId)
    await atenderConversacion(a.supabase, {
      orgId: a.orgId,
      conversationId,
      como: 'listo',
      authUserId: a.userId,
      staffId,
    })
    return { ok: true }
  } catch (err) {
    console.error('[por-responder] marcarPendienteListo:', mensajeDe(err))
    return { ok: false, error: 'No se pudo marcar. Revisá la conexión y probá de nuevo.' }
  }
}

/** Varias de una vez («Marcar los 5 cierres como listos»). */
export async function marcarPendientesListos(conversationIds: string[]): Promise<{ ok: true; hechas: number } | Falla> {
  try {
    const ids = Array.from(new Set((conversationIds ?? []).filter(isValidUUID))).slice(0, 100)
    if (ids.length === 0) return { ok: true, hechas: 0 }
    const a = await acceso()
    if (!a.ok) return a
    const { data, error } = await a.supabase
      .from('conversations')
      .select('id')
      .in('id', ids)
      .in('channel_id', a.canales)
    if (error) throw new Error(error.message)
    const staffId = await staffDelUsuario(a.supabase, a.userId, a.orgId)
    const validas = ((data ?? []) as { id: string }[]).map((c) => c.id)
    for (const id of validas) {
      await atenderConversacion(a.supabase, { orgId: a.orgId, conversationId: id, como: 'listo', authUserId: a.userId, staffId })
    }
    return { ok: true, hechas: validas.length }
  } catch (err) {
    console.error('[por-responder] marcarPendientesListos:', mensajeDe(err))
    return { ok: false, error: 'No se pudieron marcar. Revisá la conexión y probá de nuevo.' }
  }
}
