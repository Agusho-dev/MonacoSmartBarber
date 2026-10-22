// =============================================================================
// Cómo se reintenta un turno de Tex que falló, sin React: lo usa TexChat y lo
// prueban las suites del scratchpad con el `Chat` real del AI SDK.
//
// El servidor deduplica por el id del mensaje (`planificarCorte` en
// src/lib/tex/historial-puro.ts): si le llega una pregunta con un id que ya
// tiene guardado, corta desde esa fila y la vuelve a guardar. Por eso un
// reintento NUNCA manda la pregunta con un id nuevo (antes, "Reintentar" la
// sacaba y la mandaba como mensaje nuevo, y después de un "Volver a generar"
// fallido la conversación quedaba con la pregunta dos veces):
//   - después de un envío fallido: el MISMO mensaje, como submit. Si el
//     servidor no lo había guardado, lo guarda; si sí, lo reemplaza;
//   - después de un "Volver a generar" fallido: otra vez regenerate.
//
// Y un "Volver a generar" que falla ANTES de que llegue algo (429, sin red)
// deja la conversación como estaba: el servidor no tocó la respuesta anterior,
// así que vuelve a la pantalla. Sin esto la persona veía la pregunta sola
// mientras Claude seguía leyendo esa respuesta.
// =============================================================================

import type { TexUIMessage } from '@/lib/tex/contrato'
import type { CuerpoTex } from './transporte'

export type TipoPedidoTex = 'enviar' | 'regenerar'

/** El último pedido que se le hizo al servidor: con eso se sabe cómo reintentarlo. */
export interface PedidoTex {
  tipo: TipoPedidoTex
  /** "Volver a generar": los mensajes de antes, con la respuesta que se iba a reemplazar. */
  antes?: TexUIMessage[]
  /**
   * La pregunta ya había llegado antes al servidor (se cortó a mitad, o se
   * detuvo con el pedido en vuelo): puede estar guardada aunque este pedido
   * falle, así que no se saca de la pantalla.
   */
  quizasGuardada?: boolean
}

/** Lo que hace falta del chat (`useChat` o el `Chat` del AI SDK) para reintentar. */
export interface ChatParaReintentar {
  messages: TexUIMessage[]
  setMessages: (mensajes: TexUIMessage[]) => void
  sendMessage: (mensaje: undefined, opciones: { body: CuerpoTex }) => Promise<void>
  regenerate: (opciones: { body: CuerpoTex }) => Promise<void>
}

export type PlanReintento =
  | { accion: 'regenerar' }
  /** Reenviar la última pregunta con su id. `sacarParcial`: antes, sacar la respuesta a medias. */
  | { accion: 'reenviar'; sacarParcial: boolean }

/** Qué hacer con "Reintentar" según el último pedido y cómo quedaron los mensajes. */
export function planDeReintento(ultimo: PedidoTex | null, mensajes: Pick<TexUIMessage, 'role'>[]): PlanReintento | null {
  const final = mensajes[mensajes.length - 1]
  if (!final) return null
  if (ultimo?.tipo === 'regenerar') return { accion: 'regenerar' }
  if (final.role === 'user') return { accion: 'reenviar', sacarParcial: false }
  // Llegó una respuesta a medias: sale, y la pregunta de antes se reenvía con su id.
  if (final.role === 'assistant' && mensajes[mensajes.length - 2]?.role === 'user') return { accion: 'reenviar', sacarParcial: true }
  return null
}

/** Ejecuta el plan sobre el chat y devuelve el pedido que quedó en curso. */
export function ejecutarReintento(
  chat: ChatParaReintentar,
  plan: PlanReintento,
  body: CuerpoTex,
  anterior: PedidoTex | null = null,
): PedidoTex {
  if (plan.accion === 'regenerar') {
    const pedido: PedidoTex = { tipo: 'regenerar', antes: chat.messages }
    void chat.regenerate({ body })
    return pedido
  }
  if (plan.sacarParcial) chat.setMessages(chat.messages.slice(0, -1))
  // Sin mensaje: el AI SDK manda el último (la pregunta) con su id, como submit.
  void chat.sendMessage(undefined, { body })
  // Con una respuesta a medias, el servidor ya había guardado la pregunta.
  return { tipo: 'enviar', quizasGuardada: plan.sacarParcial || anterior?.quizasGuardada === true }
}

/**
 * Al terminar un pedido con error: los mensajes a devolver a la pantalla, o
 * null. Sólo un "Volver a generar" que falló sin que llegara nada: el AI SDK
 * ya había sacado la respuesta anterior, y el servidor la conserva.
 */
export function mensajesARestaurar(pedido: PedidoTex | null, mensajes: TexUIMessage[]): TexUIMessage[] | null {
  if (pedido?.tipo !== 'regenerar' || !pedido.antes) return null
  const antes = pedido.antes
  const final = mensajes[mensajes.length - 1]
  // Llegó algo del servidor (o no queda la pregunta): lo que se ve es lo que hay.
  if (!final || final.role !== 'user' || antes.length <= mensajes.length) return null
  for (let i = 0; i < mensajes.length; i++) if (antes[i]?.id !== mensajes[i].id) return null
  if (antes[mensajes.length]?.role !== 'assistant') return null
  return antes
}

/**
 * Al mandar una pregunta nueva después de un error: ¿se saca la pregunta que
 * falló? Sí cuando fue un envío que el servidor cortó antes de guardarla (los
 * errores previos al stream: 429, sin clave, plan). No después de un "Volver
 * a generar" (esa pregunta y su respuesta siguen guardadas), ni si un intento
 * anterior pudo haberla guardado: la pantalla no esconde lo que el servidor
 * tiene y Claude sigue leyendo.
 */
export function descartarPreguntaFallida(
  pedido: PedidoTex | null,
  estado: 'submitted' | 'streaming' | 'ready' | 'error',
  mensajes: Pick<TexUIMessage, 'role'>[],
): boolean {
  return (
    estado === 'error' && mensajes[mensajes.length - 1]?.role === 'user' && pedido?.tipo === 'enviar' && pedido.quizasGuardada !== true
  )
}
