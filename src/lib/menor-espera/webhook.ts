/**
 * Corte de «Menor espera por WhatsApp» en el webhook entrante, ANTES del motor
 * de workflows (migraciones 218 y 222).
 *
 * Si el mensaje es una respuesta al aviso, se resuelve acá y el webhook hace
 * `continue`: sin motor, sin IA, sin auto-tag. Si no, devuelve false y el
 * mensaje sigue exactamente el camino de siempre. Sin este corte, el botón se
 * lo come una reseña en `waiting_reply` (hay ~100 vivas en cualquier momento) o
 * dispara la Bienvenida («Que onda hermanoo…» + «La modalidad es únicamente por
 * orden de llegada») a un cliente que está sentado en el local.
 *
 * Es un módulo plano y no una server action a propósito: en un archivo
 * 'use server' todo export es un endpoint HTTP, y esto actúa en nombre de un
 * cliente a partir de su teléfono.
 *
 * QUÉ SE INTERCEPTA (todo lo demás sigue al motor):
 *  1. `button` con el texto EXACTO de nuestros botones → `menor_espera_responder`
 *     sobre la oferta más reciente a ese teléfono (90 min). Sin oferta, se
 *     contesta «ya no está vigente». Un botón de OTRA plantilla (la reseña) no
 *     se toca.
 *  2. Pedido de baja («baja», «no me escriban más»…) de alguien que recibió un
 *     aviso en los últimos 30 días, aunque ya no espere (mig 222) → se registra
 *     y se confirma. Si ya no está en la fila, la conversación queda sin leer:
 *     el pedido puede ser también por otros mensajes y lo tiene que ver una
 *     persona. Si no recibió ningún aviso, sigue al motor.
 *  3. Con una oferta recibida y la entrada todavía esperando:
 *     - «sí»/«no» escrito, si la oferta está abierta, salió hace menos de
 *       30 min y lo último que le mandamos ES la plantilla → como el botón.
 *     - «gracias» o un emoji después de que ya le contestamos → se absorbe.
 *     - cualquier otro mensaje → UNA alerta a la recepción por oferta y no
 *       sigue al motor (que no le llegue la Bienvenida en medio de la fila).
 *       Un `button` de OTRA plantilla (la reseña de una visita anterior) no se
 *       intercepta: tiene dueño, y robárselo perdería la calificación.
 *  4. Nunca `interactive`: así llegan los botones de la Bienvenida («Si»/«No»).
 *
 * FIRMA (mig 222): sólo con la firma de Meta VERIFICADA se mueve a alguien de la
 * fila, se registra una baja o se le contesta. Sin ella, la respuesta deja una
 * alerta para la recepción y nada más: el `from` del payload lo pone quien
 * manda el POST. El resto del webhook (reseñas, IA, inbox) no cambia: la firma
 * se está midiendo antes de exigirla (whatsapp_webhook_firmas).
 *
 * ERRORES: si el mensaje era nuestro botón y algo falla (la base no contesta,
 * una excepción), nunca cae al motor: queda una alerta urgente y, con firma
 * válida, el cliente recibe «No pudimos cambiarte…». Nunca dos respuestas.
 *
 * Contestar sólo si cambió algo o pasaron más de 30 s desde la respuesta
 * anterior: Meta reintenta y la gente toca dos veces.
 */

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendToMeta, extractWhatsAppId } from '@/lib/meta-send'
import { pareceBotonMenorEspera, respuestaDeBoton, PLANTILLA_POR_DEFECTO } from './plantilla'
import { esCortesia, esPedidoDeBaja, interpretarTexto } from './respuestas'
import {
  ALERTA_BAJA_ERROR_TITULO,
  ALERTA_ERROR_TITULO,
  ALERTA_RESPUESTA_LIBRE_TITULO,
  ALERTA_SIN_VERIFICAR_TITULO,
  ALERTA_TELEFONO_TITULO,
  TEXTO_NO_VIGENTE,
  alertaBajaError,
  alertaBajaSinVerificar,
  alertaError,
  alertaErrorBoton,
  alertaRespuestaLibre,
  alertaSinVerificar,
  alertaTelefono,
  textoBaja,
  textoError,
  textoRespuesta,
} from './textos'
import type { ContextoRpc, RespuestaRpc } from './tipos'

const META_API_VERSION = 'v22.0'
/** Ventana anti-repetición: Meta reintenta el webhook y la gente toca dos veces. */
const VENTANA_REPETICION_MS = 30_000

let avisoSinMigracion = false

/** Subconjunto del mensaje de Meta que usa este módulo. */
export interface MensajeEntranteWa {
  type: string
  from: string
  id: string
  text?: { body?: string }
  button?: { payload?: string; text?: string }
}

export interface CorteMenorEsperaParams {
  supabase: SupabaseClient
  orgId: string
  conversationId: string
  from: string
  message: MensajeEntranteWa
  /** El texto que el webhook ya extrajo del mensaje (para las alertas). */
  textoMensaje: string
  waConfig: { whatsapp_access_token: string | null; whatsapp_phone_id: string | null }
  /**
   * La firma x-hub-signature-256 validó con el App Secret de la org (mig 222).
   * Sin eso no se mueve a nadie, no se registran bajas ni se contesta.
   */
  firmaValida: boolean
}

/** Lo que ya se hizo con ESTE mensaje: para no contestarle dos veces si algo explota a mitad de camino. */
interface Avance {
  contestado: boolean
}

/**
 * true = el mensaje era de Menor espera y ya quedó resuelto: el webhook NO lo
 * pasa al motor. Nunca lanza: si algo falla y el mensaje era nuestro botón,
 * igual devuelve true (un botón nuestro en el motor es peor que un error).
 */
export async function manejarRespuestaMenorEspera(p: CorteMenorEsperaParams): Promise<boolean> {
  const { message } = p
  // 4. Los botones de la Bienvenida llegan como `interactive`: jamás son nuestros.
  if (message.type === 'interactive') return false

  const esBoton = message.type === 'button'
  const texto = message.type === 'text' ? (message.text?.body ?? '') : ''
  // Se decide ACÁ (y no en SQL) si el texto es una baja: la RPC sólo busca
  // avisos de los últimos 30 días cuando hace falta.
  const esBaja = message.type === 'text' && esPedidoDeBaja(texto)
  // A partir de que sabemos que el mensaje es nuestro, un error no lo devuelve al motor.
  let nuestro = esBoton && pareceBotonMenorEspera(message)
  const avance: Avance = { contestado: false }

  try {
    const { data, error } = await p.supabase.rpc('menor_espera_contexto', {
      p_organization_id: p.orgId,
      p_telefono: p.from,
      p_conversation_id: p.conversationId,
      p_es_boton: esBoton,
      p_es_baja: esBaja,
    })
    if (error) {
      if (error.code === 'PGRST202') {
        // La 218/222 todavía no está aplicada: el corte no existe y el mensaje
        // sigue su camino. Se avisa una vez por proceso, no una por mensaje.
        if (!avisoSinMigracion) console.warn('[menor-espera] falta la migración 222 (o la 218): el corte está inactivo')
        avisoSinMigracion = true
      } else {
        console.error('[menor-espera] menor_espera_contexto:', error.message)
      }
      if (nuestro) await fallaConBotonNuestro(p, avance, `la base no contestó: ${error.message}`)
      return nuestro
    }
    const ctx = data as ContextoRpc | null
    if (!ctx) {
      if (nuestro) await fallaConBotonNuestro(p, avance, 'la base no devolvió el aviso')
      return nuestro
    }

    // ── 1. Botón de plantilla ──
    if (esBoton) {
      const respuesta = respuestaDeBoton(message.button, ctx.botones)
      if (!respuesta) return false // botón de otra plantilla: sigue su camino
      nuestro = true
      if (!ctx.boton) {
        // Sin firma verificada no se le escribe a nadie (no sabemos si lo mandó él).
        if (p.firmaValida) await contestar(p, avance, TEXTO_NO_VIGENTE, true)
        return true
      }
      await responder(p, avance, ctx.boton.id, respuesta, ctx.botones, ctx.boton.cliente ?? null)
      return true
    }

    // ── 2. Baja: con un aviso recibido en los últimos 30 días, aunque ya no espere ──
    if (esBaja) {
      const oferta = ctx.contexto?.id ?? ctx.baja?.id ?? null
      if (oferta) {
        nuestro = true
        // Si ya no está en la fila, el «no me escriban más» puede ser también por
        // otros mensajes (reseñas, difusiones): la baja de los avisos se registra
        // igual, pero la conversación queda sin leer para que la vea una persona.
        await registrarBaja(p, avance, oferta, texto, ctx.contexto?.cliente ?? ctx.baja?.cliente ?? null, !!ctx.contexto)
        return true
      }
    }

    // ── 3a. «Sí»/«No» escrito ──
    if (ctx.texto && message.type === 'text') {
      const respuesta = interpretarTexto(texto, ctx.botones)
      if (respuesta) {
        nuestro = true
        await responder(p, avance, ctx.texto.id, respuesta, ctx.botones, ctx.texto.cliente ?? null)
        return true
      }
    }

    // ── 3b. «Gracias» o un emoji después de que ya le contestamos: no pide nada.
    //        Se absorbe y se marca leído, sin molestar a la recepción.
    if (
      ctx.contexto &&
      (ctx.contexto.estado === 'aceptada' || ctx.contexto.estado === 'rechazada') &&
      (message.type === 'reaction' || (message.type === 'text' && esCortesia(texto)))
    ) {
      nuestro = true
      await marcarResuelto(p)
      return true
    }

    // ── 3c. Cualquier otra cosa mientras espera en la fila ──
    if (ctx.contexto) {
      nuestro = true
      await avisarRecepcion(p, ctx.contexto.id, ctx.contexto.cliente, p.textoMensaje || texto)
      return true
    }

    return false
  } catch (e) {
    console.error('[menor-espera] corte del webhook:', e)
    if (nuestro) await fallaConBotonNuestro(p, avance, 'error inesperado')
    return nuestro
  }
}

// ═══════════════════════════════════════════════════════════════════════════

/** El texto del botón que tocó (para las alertas), o el que corresponde a la respuesta. */
function textoDelBoton(p: CorteMenorEsperaParams, respuesta: 'si' | 'no' | null, botones: string[] | null): string | null {
  const tocado = p.message.button?.text || p.message.button?.payload
  if (tocado) return tocado
  if (!respuesta) return null
  const [si, no] = botones && botones.length >= 2 ? botones : PLANTILLA_POR_DEFECTO.botones
  return respuesta === 'si' ? si : no
}

/**
 * Era nuestro botón y no pudimos ni leer el aviso: alerta urgente y, con firma
 * válida, «No pudimos cambiarte…» (si todavía no le contestamos nada). No lanza.
 */
async function fallaConBotonNuestro(p: CorteMenorEsperaParams, avance: Avance, motivo: string): Promise<void> {
  try {
    const respuesta = respuestaDeBoton(p.message.button, null)
    await crearAlerta(p, 'urgent', ALERTA_ERROR_TITULO, alertaErrorBoton(textoDelBoton(p, respuesta, null), motivo), {
      motivo,
      firma_valida: p.firmaValida,
    })
    if (p.firmaValida && !avance.contestado) await contestar(p, avance, textoError(respuesta), false)
  } catch (e) {
    console.error('[menor-espera] avisando la falla:', e)
  }
}

async function responder(
  p: CorteMenorEsperaParams,
  avance: Avance,
  ofertaId: string,
  respuesta: 'si' | 'no',
  botones: string[] | null,
  cliente: string | null,
): Promise<void> {
  if (!p.firmaValida) {
    // Sin firma verificada no se mueve a nadie: el `from` lo pone quien manda el
    // POST. La recepción lo ve y, si el cliente está en el local, lo resuelve.
    console.warn('[menor-espera] respuesta sin firma verificada: sólo alerta. Oferta', ofertaId)
    await crearAlerta(p, 'urgent', ALERTA_SIN_VERIFICAR_TITULO,
      alertaSinVerificar(cliente, textoDelBoton(p, respuesta, botones) ?? respuesta), {
        oferta_id: ofertaId,
        respuesta,
        firma_valida: false,
      })
    return
  }

  const { data, error } = await p.supabase.rpc('menor_espera_responder', {
    p_oferta_id: ofertaId,
    p_respuesta: respuesta,
    p_organization_id: p.orgId,
    p_telefono: p.from,
  })

  if (error || !data) {
    // El cliente pidió algo y no pudimos hacerlo: que lo sepa y que la recepción
    // lo vea. La conversación queda sin leer a propósito.
    console.error('[menor-espera] menor_espera_responder:', error?.message ?? 'sin datos')
    await crearAlerta(p, 'urgent', ALERTA_ERROR_TITULO, alertaError(cliente, error?.message ?? 'la base no contestó'), {
      oferta_id: ofertaId,
      respuesta,
    })
    await contestar(p, avance, textoError(respuesta), false)
    return
  }

  const r = data as RespuestaRpc

  if (r.resultado === 'telefono_no_coincide' || r.resultado === 'invalida') {
    // No se contesta: con la correlación por teléfono esto sólo pasa si la
    // ficha cambió de número. Que lo mire una persona.
    console.warn('[menor-espera] respuesta descartada:', r.resultado, 'oferta', ofertaId)
    if (r.resultado === 'telefono_no_coincide') {
      await crearAlerta(p, 'warning', ALERTA_TELEFONO_TITULO, alertaTelefono(p.from), { oferta_id: ofertaId })
    }
    return
  }

  const segundos = r.segundos_desde_respuesta_previa
  const contestarAhora = r.cambio || segundos == null || segundos * 1000 > VENTANA_REPETICION_MS
  const cuerpo = textoRespuesta(r, botones)
  if (contestarAhora && cuerpo) {
    await contestar(p, avance, cuerpo, true)
  } else {
    // Doble toque dentro de los 30 s: ya le contestamos. Igual quedó resuelto.
    await marcarResuelto(p)
  }
}

async function registrarBaja(
  p: CorteMenorEsperaParams,
  avance: Avance,
  ofertaId: string,
  texto: string,
  cliente: string | null,
  /** Está esperando en la fila: el pedido es por el aviso y queda resuelto. */
  enLaFila: boolean,
): Promise<void> {
  if (!p.firmaValida) {
    console.warn('[menor-espera] baja sin firma verificada: sólo alerta. Oferta', ofertaId)
    await crearAlerta(p, 'warning', ALERTA_SIN_VERIFICAR_TITULO, alertaBajaSinVerificar(cliente, texto), {
      oferta_id: ofertaId,
      tipo: 'baja',
      firma_valida: false,
    })
    return
  }

  const { data, error } = await p.supabase.rpc('menor_espera_registrar_baja', {
    p_oferta_id: ofertaId,
    p_organization_id: p.orgId,
    p_telefono: p.from,
    p_mensaje: texto,
  })
  if (error || !data) {
    console.error('[menor-espera] menor_espera_registrar_baja:', error?.message ?? 'sin datos')
    await crearAlerta(p, 'urgent', ALERTA_BAJA_ERROR_TITULO, alertaBajaError(texto), { oferta_id: ofertaId })
    return
  }
  const r = data as { resultado: string; cliente?: string | null }
  if (r.resultado === 'telefono_no_coincide' || r.resultado === 'no_encontrada') {
    console.warn('[menor-espera] baja descartada:', r.resultado, 'oferta', ofertaId)
    return
  }
  await contestar(p, avance, textoBaja(r.cliente), enLaFila)
}

async function avisarRecepcion(
  p: CorteMenorEsperaParams,
  ofertaId: string,
  cliente: string | null,
  mensaje: string,
): Promise<void> {
  // Una sola alerta por oferta: la RPC marca la oferta y crea la alerta en la
  // misma transacción. La conversación queda sin leer: una persona tiene que verla.
  const { error } = await p.supabase.rpc('menor_espera_avisar_recepcion', {
    p_oferta_id: ofertaId,
    p_organization_id: p.orgId,
    p_conversation_id: p.conversationId,
    p_titulo: ALERTA_RESPUESTA_LIBRE_TITULO,
    p_mensaje: alertaRespuestaLibre(cliente, mensaje),
    p_metadata: { platform: 'whatsapp', mensaje: mensaje.slice(0, 500), firma_valida: p.firmaValida },
  })
  if (error) console.error('[menor-espera] menor_espera_avisar_recepcion:', error.message)
}

/**
 * Manda un texto libre (la ventana de 24 h la acaba de abrir el cliente) y lo
 * registra en `messages`, salga o no salga. `resuelto` = el mensaje del cliente
 * ya no necesita que una persona lo lea: descuenta uno de los no leídos.
 */
async function contestar(p: CorteMenorEsperaParams, avance: Avance, cuerpo: string, resuelto: boolean): Promise<void> {
  // Se marca antes de mandar: si algo explota después, el camino de error no
  // le escribe una segunda vez.
  avance.contestado = true

  // Meta reintenta el webhook: si lo último que mandamos es este mismo texto
  // hace menos de 30 s, no se repite.
  const { data: ultimo, error: ultErr } = await p.supabase
    .from('messages')
    .select('content, created_at')
    .eq('conversation_id', p.conversationId)
    .eq('direction', 'outbound')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (ultErr) {
    console.error('[menor-espera] último saliente:', ultErr.message)
  } else if (
    ultimo?.content === cuerpo &&
    ultimo.created_at &&
    Date.now() - new Date(ultimo.created_at).getTime() < VENTANA_REPETICION_MS
  ) {
    if (resuelto) await marcarResuelto(p)
    return
  }

  const token = p.waConfig.whatsapp_access_token
  const phoneId = p.waConfig.whatsapp_phone_id
  if (!token || !phoneId) {
    console.error('[menor-espera] sin credenciales de WhatsApp para contestar (org', p.orgId, ')')
    return
  }

  const out = await sendToMeta({
    url: `https://graph.facebook.com/${META_API_VERSION}/${phoneId}/messages`,
    token,
    payload: { messaging_product: 'whatsapp', to: p.from, type: 'text', text: { body: cuerpo } },
    extractId: extractWhatsAppId,
    // Estamos dentro del webhook y Meta espera una respuesta rápida: un solo
    // reintento y 6 s por intento. El cambio en la fila ya está hecho; si la
    // confirmación no sale, queda `failed` en el inbox y sin leer.
    maxRetries: 1,
    timeoutMs: 6000,
  })

  const { error: insErr } = await p.supabase.from('messages').insert({
    conversation_id: p.conversationId,
    direction: 'outbound',
    content_type: 'text',
    content: cuerpo,
    platform_message_id: out.platformMessageId,
    status: out.ok ? 'sent' : 'failed',
    error_message: out.ok ? null : out.errorMessage,
  })
  if (insErr) console.error('[menor-espera] respuesta enviada pero no registrada:', insErr.message)
  if (!out.ok) console.error('[menor-espera] la respuesta no salió:', out.errorMessage)

  // Si la respuesta no salió, la conversación queda sin leer: alguien tiene que verla.
  if (resuelto && out.ok) await marcarResuelto(p)
}

/** −1 a los no leídos (no 0: puede haber otros mensajes sin leer en la conversación). */
async function marcarResuelto(p: CorteMenorEsperaParams): Promise<void> {
  const { data: conv, error } = await p.supabase
    .from('conversations')
    .select('unread_count')
    .eq('id', p.conversationId)
    .maybeSingle()
  if (error || !conv) {
    if (error) console.error('[menor-espera] leer no leídos:', error.message)
    return
  }
  const actual = conv.unread_count ?? 0
  if (actual <= 0) return
  const { error: updErr } = await p.supabase
    .from('conversations')
    .update({ unread_count: actual - 1 })
    .eq('id', p.conversationId)
  if (updErr) console.error('[menor-espera] descontar no leídos:', updErr.message)
}

async function crearAlerta(
  p: CorteMenorEsperaParams,
  tipo: 'urgent' | 'warning',
  titulo: string,
  mensaje: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const { error } = await p.supabase.from('crm_alerts').insert({
    organization_id: p.orgId,
    conversation_id: p.conversationId,
    alert_type: tipo,
    title: titulo,
    message: mensaje,
    metadata: { origen: 'menor_espera', platform: 'whatsapp', ...metadata },
  })
  if (error) console.error('[menor-espera] crm_alerts.insert:', error.message)
}
