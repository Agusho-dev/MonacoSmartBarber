// =============================================================================
// POST /api/tex/chat — un turno de Tex.
//
// El browser (`useChat` + DefaultChatTransport) manda SÓLO el último mensaje,
// el id de la conversación, el trigger y la pantalla (`TexPedidoSchema`). El
// historial lo tiene el servidor: nadie puede inyectarle a Claude un
// "resultado de herramienta" inventado ni un turno que no ocurrió.
//
// Orden de los controles (todo antes de abrir el stream, con status y JSON
// {codigo, mensaje} que el cliente lee con `leerErrorTex`):
//   400 invalido → 401 sin_sesion → 403 sin_permiso → 403 bloqueado (plan) →
//   403 cuota (tope del mes) → 429 limite → 422 sin_clave → 404 no_encontrada →
//   historial + mensaje del usuario guardado → stream.
//
// Si el browser ya cortó el pedido (Detener antes de que llegue la respuesta),
// no se crea la conversación, no se guarda la pregunta y no corre el modelo:
// antes se guardaban igual un "(Respuesta interrumpida.)" y un mensaje del tope
// del mes por una respuesta que nunca existió. Next corta `req.signal` cuando
// el cliente se desconecta.
//
// La ruta vieja (/api/asistente/chat y src/lib/asistente/*) queda intacta en
// este deploy: puede haber pestañas con el bundle anterior llamándola (Known
// Risk #38).
// =============================================================================

import { after } from 'next/server'
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai'
import { requireFeature, requireMonthlyCap } from '@/lib/actions/entitlements'
import { EntitlementError } from '@/lib/billing/types'
import { rateLimit } from '@/lib/rate-limit'
import { resolverClaveTex } from '@/lib/tex/cliente'
import { obtenerContextoTexConConfig, puedeConfigurarTex, puedeUsarTex } from '@/lib/tex/contexto'
import {
  TEX_MAX_CARACTERES,
  TexPedidoSchema,
  type TexCodigoError,
  type TexErrorRespuesta,
  type TexUIMessage,
} from '@/lib/tex/contrato'
import { leerEquipoTex } from '@/lib/tex/equipo'
import { cantidad } from '@/lib/tex/formato'
import { asegurarConversacion, prepararHistorialTex, type HistorialPreparado } from '@/lib/tex/historial'
import { resumirError } from '@/lib/tex/motor'
import { contextoDelTurno, normalizarPagina } from '@/lib/tex/prompt'
import { correrTurnoTex } from '@/lib/tex/turno'

export const runtime = 'nodejs'
export const maxDuration = 300
export const dynamic = 'force-dynamic'

function respuestaError(status: number, codigo: TexCodigoError, mensaje: string): Response {
  const cuerpo: TexErrorRespuesta = { codigo, mensaje }
  return Response.json(cuerpo, { status })
}

/** El browser se fue antes de que empezara la respuesta: nadie lee esto (499, como nginx). */
function clienteSeFue(): Response {
  return new Response(null, { status: 499 })
}

/** El texto del mensaje: las partes de texto, juntas. Tex no recibe archivos. */
function textoDelPedido(partes: { type: string; text?: string }[]): string {
  return partes
    .filter((p) => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text as string)
    .join('\n')
    .trim()
}

export async function POST(req: Request): Promise<Response> {
  // ── 1. El pedido ──────────────────────────────────────────────────────────
  let cuerpo: unknown
  try {
    cuerpo = await req.json()
  } catch {
    return respuestaError(400, 'invalido', 'El pedido no es válido.')
  }
  const parseado = TexPedidoSchema.safeParse(cuerpo)
  if (!parseado.success) return respuestaError(400, 'invalido', 'El pedido no es válido.')
  const pedido = parseado.data
  const texto = textoDelPedido(pedido.mensaje.parts)
  if (!texto) return respuestaError(400, 'invalido', 'Escribí tu pregunta.')
  if (texto.length > TEX_MAX_CARACTERES) {
    return respuestaError(400, 'invalido', `El mensaje es demasiado largo: el máximo es de ${cantidad(TEX_MAX_CARACTERES)} caracteres.`)
  }

  // ── 2. Quién pregunta ─────────────────────────────────────────────────────
  let base: Awaited<ReturnType<typeof obtenerContextoTexConConfig>>
  try {
    base = await obtenerContextoTexConConfig()
  } catch (err) {
    console.error('[tex] resolviendo el contexto:', resumirError(err))
    return respuestaError(500, 'error', 'Tex no pudo arrancar. Probá de nuevo en un momento.')
  }
  if (!base) return respuestaError(401, 'sin_sesion', 'Tu sesión venció. Volvé a iniciar sesión.')
  const { ctx, config } = base
  if (!puedeUsarTex(ctx)) return respuestaError(403, 'sin_permiso', 'Tu usuario no tiene acceso a Tex. Pedíselo al dueño.')

  // ── 3. Plan y tope del mes ────────────────────────────────────────────────
  try {
    await requireFeature('ai.enabled')
  } catch (err) {
    if (err instanceof EntitlementError) {
      return respuestaError(403, 'bloqueado', err.kind === 'feature_locked' ? 'Tex es parte del plan Enterprise.' : err.message)
    }
    console.error('[tex] verificando el plan:', resumirError(err))
    return respuestaError(500, 'error', 'Tex no pudo arrancar. Probá de nuevo en un momento.')
  }
  try {
    await requireMonthlyCap('ai_messages_monthly')
  } catch (err) {
    if (err instanceof EntitlementError) {
      return respuestaError(403, err.kind === 'limit_exceeded' ? 'cuota' : 'bloqueado', err.kind === 'limit_exceeded' ? 'Llegaste al tope de mensajes de Tex de este mes.' : err.message)
    }
    console.error('[tex] verificando el tope del mes:', resumirError(err))
    return respuestaError(500, 'error', 'Tex no pudo arrancar. Probá de nuevo en un momento.')
  }

  // ── 4. Ritmo ──────────────────────────────────────────────────────────────
  const ritmo = await rateLimit('tex_chat', ctx.userId, { limit: 20, window: 60 })
  if (!ritmo.allowed) return respuestaError(429, 'limite', 'Hay muchas consultas seguidas. Esperá un momento.')

  // ── 5. La clave ───────────────────────────────────────────────────────────
  let clave: Awaited<ReturnType<typeof resolverClaveTex>>
  try {
    clave = await resolverClaveTex(ctx.orgId)
  } catch (err) {
    console.error('[tex] leyendo la clave:', resumirError(err))
    return respuestaError(500, 'error', 'Tex no pudo arrancar. Probá de nuevo en un momento.')
  }
  if (!clave) {
    return respuestaError(
      422,
      'sin_clave',
      puedeConfigurarTex(ctx)
        ? 'Para que Tex funcione falta conectar la clave de Anthropic. Se hace una sola vez.'
        : 'Tex no está disponible ahora. Avisale al dueño.',
    )
  }

  // ── 6. La conversación (de esta org y de esta persona) ────────────────────
  // Hasta acá todo fue lectura. Desde acá se escribe: si la persona ya tocó Detener, no.
  if (req.signal.aborted) return clienteSeFue()
  // El equipo para el system ("Chipi" es un barbero, no un cliente), en paralelo con la
  // conversación y el historial. Nunca tira: si falla, el system sale sin esa sección.
  const promesaEquipo = leerEquipoTex(ctx)
  const conversacion = await asegurarConversacion(ctx, pedido.conversacionId, texto)
  if (!conversacion.ok) {
    return conversacion.motivo === 'no_encontrada'
      ? respuestaError(404, 'no_encontrada', 'No encontramos esa conversación.')
      : respuestaError(500, 'error', 'No pudimos abrir la conversación. Probá de nuevo.')
  }

  // ── 7. Historial + mensaje del usuario guardado ───────────────────────────
  if (req.signal.aborted) return clienteSeFue()
  let historial: HistorialPreparado
  try {
    historial = await prepararHistorialTex({
      ctx,
      conversacionId: pedido.conversacionId,
      creada: conversacion.creada,
      tituloActual: conversacion.titulo,
      trigger: pedido.trigger,
      mensajeId: pedido.mensajeId,
      idMensaje: pedido.mensaje.id,
      texto,
      // Contexto, nunca instrucciones: la pantalla se valida contra un patrón de rutas.
      contexto: contextoDelTurno({ ahora: new Date(), nombre: ctx.nombreUsuario, pagina: normalizarPagina(pedido.pagina) }),
    })
  } catch (err) {
    console.error('[tex] preparando el turno:', resumirError(err))
    return respuestaError(500, 'error', 'No pudimos guardar tu mensaje. Probá de nuevo.')
  }

  // ── 8. El turno, en streaming ─────────────────────────────────────────────
  // La pregunta ya quedó guardada: si la persona se fue mientras tanto, no se corre el
  // modelo. "Reintentar" reenvía el MISMO mensaje y el servidor corta desde esa fila.
  if (req.signal.aborted) return clienteSeFue()
  const equipo = await promesaEquipo
  const claveTex = clave.clave
  const preparado = historial
  const idAsistente = crypto.randomUUID()
  let liberar: () => void = () => {}
  const terminado = new Promise<void>((resolve) => {
    liberar = resolve
  })
  const stream = createUIMessageStream<TexUIMessage>({
    generateId: () => crypto.randomUUID(),
    // `correrTurnoTex` no tira; esto es la red por si algo se escapa.
    onError: (error) => {
      console.error('[tex] stream:', resumirError(error))
      return JSON.stringify({ codigo: 'error', mensaje: 'Tex no pudo terminar la respuesta. Probá de nuevo.' } satisfies TexErrorRespuesta)
    },
    execute: async ({ writer }) => {
      try {
        await correrTurnoTex({
          writer,
          ctx,
          config,
          clave: claveTex,
          conversacionId: pedido.conversacionId,
          idAsistente,
          mensajes: preparado.mensajes,
          historialRecortado: preparado.recortado,
          debeTitular: preparado.debeTitular,
          textoUsuario: texto,
          // `createUIMessageStream` no se entera solo de que el browser se fue: la señal del
          // request corta el stream de Anthropic y las herramientas, y el turno se guarda igual.
          signal: req.signal,
          // La respuesta se guarda sólo si esta pregunta sigue siendo la misma al terminar.
          pregunta: preparado.pregunta,
          equipo,
        })
      } finally {
        liberar()
      }
    },
  })
  // Que la función siga viva hasta que el turno quede guardado, aunque la persona se haya ido.
  after(terminado)
  return createUIMessageStreamResponse({ stream })
}
