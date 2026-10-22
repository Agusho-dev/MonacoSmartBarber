// El `Chat` de Tex y su transporte, sin React: `TexChat` lo crea una vez por
// conversación y las pruebas del scratchpad lo usan tal cual (con un fetch
// falso) para verificar que el pedido es el que valida el servidor.
//
// El cliente manda SÓLO el último mensaje + el id de la conversación
// (`TexPedidoSchema` en src/lib/tex/contrato.ts): el historial lo tiene el
// servidor, así nadie le puede inyectar a Claude un turno que no ocurrió.

import { Chat } from '@ai-sdk/react'
import { DefaultChatTransport, type ChatInit } from 'ai'
import type { TexUIMessage } from '@/lib/tex/contrato'
import { nuevoUuid } from './ids'

export const TEX_API_CHAT = '/api/tex/chat'

/** Lo que se manda en cada envío además del mensaje (`sendMessage(m, { body })`). */
export interface CuerpoTex {
  /** Ruta desde la que se pregunta (panel lateral): contexto, nunca instrucciones. */
  pagina?: string
}

export function crearTransporteTex(opciones: { fetch?: typeof fetch } = {}): DefaultChatTransport<TexUIMessage> {
  return new DefaultChatTransport<TexUIMessage>({
    api: TEX_API_CHAT,
    fetch: opciones.fetch,
    // Devolver `body` REEMPLAZA el cuerpo por defecto (que traería el historial
    // entero): va sólo lo que el servidor necesita.
    prepareSendMessagesRequest: ({ id, messages, trigger, messageId, body }) => ({
      body: {
        conversacionId: id,
        trigger,
        mensajeId: messageId,
        mensaje: messages[messages.length - 1],
        pagina: (body as CuerpoTex | undefined)?.pagina,
      },
    }),
  })
}

export function crearChatTex(opciones: {
  conversacionId: string
  mensajesIniciales: TexUIMessage[]
  onData?: ChatInit<TexUIMessage>['onData']
  onFinish?: ChatInit<TexUIMessage>['onFinish']
  onError?: ChatInit<TexUIMessage>['onError']
  fetch?: typeof fetch
}): Chat<TexUIMessage> {
  return new Chat<TexUIMessage>({
    id: opciones.conversacionId,
    messages: opciones.mensajesIniciales,
    // assistant_messages.id y assistant_conversations.id son uuid (gotcha 13).
    generateId: nuevoUuid,
    transport: crearTransporteTex({ fetch: opciones.fetch }),
    onData: opciones.onData,
    onFinish: opciones.onFinish,
    onError: opciones.onError,
  })
}
