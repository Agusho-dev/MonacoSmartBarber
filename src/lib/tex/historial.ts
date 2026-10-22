import 'server-only'

// =============================================================================
// src/lib/tex/historial.ts
// Las conversaciones de Tex en la base: `assistant_conversations` y
// `assistant_messages`, siempre con la service role y SIEMPRE filtrando por
// organización y por usuario. El `conversacionId` llega del browser: una
// conversación que existe y no es de esta persona responde lo mismo que una
// que no existe (404), sin decir de quién es.
//
// La lógica de armado (corte por regenerate, alternancia, recorte por tamaño,
// cierre de turnos cortados) es pura y vive en `historial-puro.ts`.
//
// `created_at` se fija desde el servidor: el del usuario al recibir el pedido
// y el del asistente cuando terminó el turno. Si alguien manda otra pregunta
// mientras se guarda un turno cortado, el orden igual queda bien.
//
// UNA RESPUESTA SE GUARDA SÓLO SI SU PREGUNTA SIGUE SIENDO LA MISMA. Un turno
// puede seguir corriendo después de que la persona se fue (Detener durante una
// herramienta lenta, un corte de red): si mientras tanto tocó "Volver a generar"
// o "Reintentar", esa pregunta ya se cortó y se volvió a guardar (mismo id, otra
// hora). La respuesta vieja quedaba colgada de la nueva y Claude las recibía
// fundidas. `guardarTurnoAsistente` inserta y después verifica que la fila de la
// pregunta (id + created_at) siga ahí; si no, borra lo que insertó.
// =============================================================================

import { randomUUID } from 'node:crypto'
import type Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/server'
import { isValidUUID } from '@/lib/validation'
import type { TexUso } from './contrato'
import { armarHistorial, planificarCorte, type FilaHistorial } from './historial-puro'
import type { TexContexto } from './herramientas/tipos'
import type { TexParte } from './partes'
import { tituloProvisorio } from './titulo'

/** Los últimos N mensajes de una conversación que se leen para armar el historial. */
export const MAX_FILAS_HISTORIAL = 200

const LOTE_BORRADO = 50

type ResultadoConversacion = { ok: true; creada: boolean; titulo: string | null } | { ok: false; motivo: 'no_encontrada' | 'error' }

/**
 * La conversación tiene que ser de esta org Y de este usuario. Si no existe se
 * crea con ese id (lo genera el browser) y el título provisorio.
 */
export async function asegurarConversacion(
  ctx: Pick<TexContexto, 'orgId' | 'userId'>,
  conversacionId: string,
  textoInicial: string,
): Promise<ResultadoConversacion> {
  const supabase = createAdminClient()
  const verificar = async (): Promise<ResultadoConversacion | null> => {
    const { data, error } = await supabase
      .from('assistant_conversations')
      .select('id, organization_id, user_id, title')
      .eq('id', conversacionId)
      .maybeSingle()
    if (error) {
      console.error('[tex] leyendo la conversación:', error.message)
      return { ok: false, motivo: 'error' }
    }
    if (!data) return null
    const fila = data as { organization_id: string; user_id: string | null; title: string | null }
    if (fila.organization_id !== ctx.orgId || fila.user_id !== ctx.userId) return { ok: false, motivo: 'no_encontrada' }
    return { ok: true, creada: false, titulo: fila.title }
  }

  const existente = await verificar()
  if (existente) return existente

  const titulo = tituloProvisorio(textoInicial)
  const { error } = await supabase
    .from('assistant_conversations')
    .insert({ id: conversacionId, organization_id: ctx.orgId, user_id: ctx.userId, title: titulo })
  if (error) {
    // Dos pedidos creando la misma conversación a la vez: la creó el otro. Se vuelve a verificar.
    if (error.code === '23505') return (await verificar()) ?? { ok: false, motivo: 'error' }
    console.error('[tex] creando la conversación:', error.message)
    return { ok: false, motivo: 'error' }
  }
  return { ok: true, creada: true, titulo }
}

/** Los últimos 200 mensajes, en orden. Tira si no pudo leer. */
export async function leerFilas(ctx: Pick<TexContexto, 'orgId'>, conversacionId: string): Promise<FilaHistorial[]> {
  const { data, error } = await createAdminClient()
    .from('assistant_messages')
    .select('id, role, content, model_messages, created_at')
    .eq('conversation_id', conversacionId)
    .eq('organization_id', ctx.orgId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(MAX_FILAS_HISTORIAL)
  if (error) throw new Error(`[tex] leyendo el historial: ${error.message}`)
  return ((data ?? []) as FilaHistorial[]).reverse()
}

async function borrarFilas(ctx: Pick<TexContexto, 'orgId'>, conversacionId: string, ids: string[]): Promise<void> {
  const supabase = createAdminClient()
  for (let i = 0; i < ids.length; i += LOTE_BORRADO) {
    const { error } = await supabase
      .from('assistant_messages')
      .delete()
      .eq('conversation_id', conversacionId)
      .eq('organization_id', ctx.orgId)
      .in('id', ids.slice(i, i + LOTE_BORRADO))
    if (error) throw new Error(`[tex] borrando el final de la conversación: ${error.message}`)
  }
}

/** El turno del usuario: su texto, lo que ve (parts) y lo que ve el modelo (texto + system del turno). */
async function guardarTurnoUsuario(
  ctx: Pick<TexContexto, 'orgId'>,
  conversacionId: string,
  turno: { id: string; texto: string; contexto: string; creadoEn: string },
): Promise<string> {
  const supabase = createAdminClient()
  const fila = (id: string) => ({
    id,
    conversation_id: conversacionId,
    organization_id: ctx.orgId,
    role: 'user',
    content: turno.texto,
    parts: [{ type: 'text', text: turno.texto }],
    model_messages: [
      { role: 'user', content: [{ type: 'text', text: turno.texto }] },
      { role: 'system', content: turno.contexto },
    ],
    created_at: turno.creadoEn,
  })
  const { error } = await supabase.from('assistant_messages').insert(fila(turno.id))
  if (!error) return turno.id
  // El id lo eligió el browser: si choca con una fila que no es de esta conversación,
  // se guarda con uno nuevo (el regenerate de ese mensaje cae al corte por texto).
  if (error.code === '23505') {
    const nuevo = randomUUID()
    const segundo = await supabase.from('assistant_messages').insert(fila(nuevo))
    if (!segundo.error) return nuevo
    throw new Error(`[tex] guardando el mensaje: ${segundo.error.message}`)
  }
  throw new Error(`[tex] guardando el mensaje: ${error.message}`)
}

/** La fila de la pregunta que originó un turno: su respuesta se guarda sólo si sigue siendo ésta. */
export interface PreguntaDelTurno {
  id: string
  /** El `created_at` con que se guardó (ISO). Un reintento la vuelve a guardar con otra hora. */
  creadoEn: string
}

export interface HistorialPreparado {
  /** Historial + mensaje nuevo + system del turno, listo para la API. */
  mensajes: Anthropic.MessageParam[]
  /** Quedaron afuera turnos viejos (por tamaño o por el tope de 200 mensajes). */
  recortado: boolean
  /** Es el primer turno y el título todavía es el provisorio: Tex le pone uno. */
  debeTitular: boolean
  /** La fila guardada de la pregunta de este turno. */
  pregunta: PreguntaDelTurno
}

/**
 * Prepara el turno ANTES de streamear (si algo falla, la ruta contesta un
 * error HTTP y no un stream roto): lee el historial, aplica el corte de un
 * regenerate/editar, guarda el mensaje del usuario y arma lo que va a ver Claude.
 */
export async function prepararHistorialTex(p: {
  ctx: Pick<TexContexto, 'orgId'>
  conversacionId: string
  creada: boolean
  tituloActual: string | null
  trigger: 'submit-message' | 'regenerate-message'
  mensajeId?: string
  idMensaje: string
  texto: string
  /** El `role: 'system'` del turno (hora y pantalla). */
  contexto: string
}): Promise<HistorialPreparado> {
  const filas = p.creada ? [] : await leerFilas(p.ctx, p.conversacionId)
  const corte = planificarCorte(filas, { trigger: p.trigger, mensajeId: p.mensajeId, idMensaje: p.idMensaje, texto: p.texto })
  if (corte.borrar.length > 0) await borrarFilas(p.ctx, p.conversacionId, corte.borrar)

  const idUsuario = isValidUUID(p.idMensaje) && !corte.quedan.some((f) => f.id === p.idMensaje) ? p.idMensaje : randomUUID()
  const creadoEn = new Date().toISOString()
  const idGuardado = await guardarTurnoUsuario(p.ctx, p.conversacionId, {
    id: idUsuario,
    texto: p.texto,
    contexto: p.contexto,
    creadoEn,
  })

  const { mensajes, recortado } = armarHistorial(
    corte.quedan,
    [
      { role: 'user', content: [{ type: 'text', text: p.texto }] },
      { role: 'system', content: p.contexto },
    ],
    { filasTruncadas: filas.length >= MAX_FILAS_HISTORIAL },
  )
  const tituloProvisorioActual = p.tituloActual == null || p.tituloActual === tituloProvisorio(p.texto) || p.tituloActual === 'Nueva conversación'
  return {
    mensajes,
    recortado,
    debeTitular: corte.quedan.length === 0 && (p.creada || tituloProvisorioActual),
    pregunta: { id: idGuardado, creadoEn },
  }
}

/**
 * La respuesta del asistente: lo que vio la persona y lo que vio el modelo (sin
 * pensamiento). Tira si el insert falla.
 *
 * Con `pregunta`, después de insertar verifica que la fila de la pregunta (id y
 * `created_at`) siga siendo la que originó el turno. Si un reintento o un "Volver
 * a generar" la cortó mientras el turno corría, borra lo que acaba de insertar y
 * devuelve 'descartada': esa respuesta ya no responde a nada. Se verifica DESPUÉS
 * del insert (no antes) para que tampoco se escape un corte que llega entre los dos.
 */
export async function guardarTurnoAsistente(
  ctx: Pick<TexContexto, 'orgId'>,
  conversacionId: string,
  turno: {
    id: string
    texto: string
    partes: TexParte[]
    modelMessages: Anthropic.MessageParam[]
    uso: TexUso
    creadoEn: string
  },
  opciones: { pregunta?: PreguntaDelTurno } = {},
): Promise<'guardada' | 'descartada'> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('assistant_messages')
    .insert({
      id: turno.id,
      conversation_id: conversacionId,
      organization_id: ctx.orgId,
      role: 'assistant',
      content: turno.texto,
      parts: turno.partes,
      model_messages: turno.modelMessages,
      usage: turno.uso,
      created_at: turno.creadoEn,
    })
  if (error) throw new Error(`[tex] guardando la respuesta: ${error.message}`)

  const pregunta = opciones.pregunta
  if (!pregunta) return 'guardada'
  const { data, error: errorLectura } = await supabase
    .from('assistant_messages')
    .select('id, created_at')
    .eq('id', pregunta.id)
    .eq('conversation_id', conversacionId)
    .eq('organization_id', ctx.orgId)
    .maybeSingle()
  if (errorLectura) {
    // Sin poder verificar, la respuesta queda: perderla sería peor que una fila de más.
    console.error('[tex] verificando la pregunta del turno:', errorLectura.message)
    return 'guardada'
  }
  const fila = data as { id: string; created_at: string } | null
  if (fila && Date.parse(fila.created_at) === Date.parse(pregunta.creadoEn)) return 'guardada'

  const { error: errorBorrado } = await supabase
    .from('assistant_messages')
    .delete()
    .eq('id', turno.id)
    .eq('conversation_id', conversacionId)
    .eq('organization_id', ctx.orgId)
  // Known Risk #13: si no se pudo borrar, que quede en el log (la respuesta vieja queda colgada).
  if (errorBorrado) console.error('[tex] descartando una respuesta sin pregunta:', errorBorrado.message)
  return 'descartada'
}

/** Sube la conversación en el historial (updated_at) y, si hay, le pone el título. Tira si falla. */
export async function tocarConversacion(
  ctx: Pick<TexContexto, 'orgId' | 'userId'>,
  conversacionId: string,
  cambios: { titulo?: string | null },
): Promise<void> {
  const { error } = await createAdminClient()
    .from('assistant_conversations')
    .update({ updated_at: new Date().toISOString(), ...(cambios.titulo ? { title: cambios.titulo } : {}) })
    .eq('id', conversacionId)
    .eq('organization_id', ctx.orgId)
    .eq('user_id', ctx.userId)
  if (error) throw new Error(`[tex] actualizando la conversación: ${error.message}`)
}
