// =============================================================================
// POST /api/mensajeria/borrador — el borrador de Tex de una tarjeta de
// «Por responder» (6/nov/2026).
//
// El browser manda la conversación y, si quiere, un ajuste («más corta») con
// la versión anterior. Contesta TEXTO PLANO en streaming: lo que va
// escribiendo Tex, letra por letra, para que la cara de Tex lo «lea» mientras
// llega (tex-cara.tsx). Tex no manda nada: la persona lo revisa en la tarjeta.
//
// Controles, todos antes de abrir el stream y con {codigo, mensaje}:
//   400 invalido → 401 sin_sesion → 403 sin_permiso → 403 bloqueado (plan) →
//   429 limite → 422 sin_clave → 404 no_encontrada → 422 cierre (un «gracias»
//   no necesita borrador; la tarjeta lo pide igual con `forzar`).
// Un error ANTES de la primera letra vuelve como JSON con su status; uno a
// mitad del stream corta el stream (el browser se queda con lo que llegó).
//
// Modelo: el de Tex (TEX_MODELO, Claude Haiku 5.5), con la clave de Tex
// (resolverClaveTex). Esfuerzo bajo: es un mensaje de una a cuatro oraciones y
// la tarjeta lo pide apenas sube al tope de la pila. No descuenta del tope
// mensual de Tex: es otra cosa (un borrador cuesta ~US$0,0005).
// =============================================================================

import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { getCachedAuthUser } from '@/lib/auth-cache'
import { requireFeature } from '@/lib/actions/entitlements'
import { currentUserCan } from '@/lib/actions/permissions-gate'
import { EntitlementError } from '@/lib/billing/types'
import { createAdminClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'
import { alcanceDeMensajeria } from '@/lib/mensajeria/programados'
import { conversacionDelAlcance } from '@/lib/mensajeria/pendientes-servidor'
import { leerCasoParaBorrador, leerDatosDelNegocio } from '@/lib/mensajeria/borrador-datos'
import { AJUSTES_BORRADOR, armarPedidoBorrador, armarSystemBorrador } from '@/lib/mensajeria/borrador-prompt'
import { crearClienteTex, resolverClaveTex } from '@/lib/tex/cliente'
import { TEX_MODELO } from '@/lib/tex/contrato'
import { resumirError } from '@/lib/tex/motor'

export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const Pedido = z.object({
  conversationId: z.string().uuid(),
  ajuste: z.enum(AJUSTES_BORRADOR as unknown as [string, ...string[]]).nullish(),
  anterior: z.string().max(4000).nullish(),
  /** Pedirlo aunque lo que espera sea un «gracias». */
  forzar: z.boolean().nullish(),
})

export type CodigoErrorBorrador =
  | 'invalido' | 'sin_sesion' | 'sin_permiso' | 'bloqueado' | 'limite' | 'sin_clave' | 'no_encontrada' | 'cierre' | 'error'

function error(status: number, codigo: CodigoErrorBorrador, mensaje: string): Response {
  return Response.json({ codigo, mensaje }, { status })
}

export async function POST(req: Request): Promise<Response> {
  // ── 1. El pedido ──────────────────────────────────────────────────────────
  let crudo: unknown
  try {
    crudo = await req.json()
  } catch {
    return error(400, 'invalido', 'El pedido no es válido.')
  }
  const parseado = Pedido.safeParse(crudo)
  if (!parseado.success) return error(400, 'invalido', 'El pedido no es válido.')
  const pedido = parseado.data

  // ── 2. Quién pide ─────────────────────────────────────────────────────────
  const usuario = await getCachedAuthUser()
  if (!usuario) return error(401, 'sin_sesion', 'Tu sesión venció. Volvé a iniciar sesión.')
  if (!(await currentUserCan('clients.view'))) return error(403, 'sin_permiso', 'No tenés permiso para ver Mensajería.')

  try {
    await requireFeature('ai.enabled')
  } catch (err) {
    if (err instanceof EntitlementError) return error(403, 'bloqueado', 'Los borradores de Tex son parte del plan con IA.')
    console.error('[borrador] verificando el plan:', resumirError(err))
    return error(500, 'error', 'Tex no pudo arrancar. Probá de nuevo.')
  }

  const ritmo = await rateLimit('mensajeria_borrador', usuario.id, { limit: 40, window: 60 })
  if (!ritmo.allowed) return error(429, 'limite', 'Muchos borradores seguidos. Esperá un momento.')

  const supabase = createAdminClient()
  let orgId: string
  try {
    const alcance = await alcanceDeMensajeria(supabase)
    if (!alcance.orgId) return error(401, 'sin_sesion', 'Tu sesión venció. Volvé a iniciar sesión.')
    orgId = alcance.orgId
    const conv = await conversacionDelAlcance(supabase, pedido.conversationId, alcance.channelIds)
    if (!conv) return error(404, 'no_encontrada', 'No encontramos esa conversación.')
  } catch (err) {
    console.error('[borrador] resolviendo el alcance:', resumirError(err))
    return error(500, 'error', 'Tex no pudo arrancar. Probá de nuevo.')
  }

  // ── 3. La clave ───────────────────────────────────────────────────────────
  let clave: Awaited<ReturnType<typeof resolverClaveTex>>
  try {
    clave = await resolverClaveTex(orgId)
  } catch (err) {
    console.error('[borrador] leyendo la clave:', resumirError(err))
    return error(500, 'error', 'Tex no pudo arrancar. Probá de nuevo.')
  }
  if (!clave) return error(422, 'sin_clave', 'Para los borradores falta conectar la clave de Tex (Configurar Tex).')

  // ── 4. El contexto ────────────────────────────────────────────────────────
  let system: string
  let mensajeUsuario: string
  try {
    const [datos, caso] = await Promise.all([
      leerDatosDelNegocio(supabase, orgId),
      leerCasoParaBorrador(supabase, { orgId, conversationId: pedido.conversationId }),
    ])
    if (caso.esCierre && !pedido.forzar && !pedido.ajuste) {
      return error(422, 'cierre', 'Parece un cierre de charla: no hace falta responder.')
    }
    system = armarSystemBorrador(datos)
    mensajeUsuario = armarPedidoBorrador({
      mensajes: caso.mensajes,
      caso: caso.caso,
      ajuste: (pedido.ajuste as (typeof AJUSTES_BORRADOR)[number] | null | undefined) ?? null,
      anterior: pedido.anterior ?? null,
    })
  } catch (err) {
    console.error('[borrador] leyendo la conversación:', resumirError(err))
    return error(500, 'error', 'Tex no pudo leer la conversación. Probá de nuevo.')
  }

  // ── 5. Claude ─────────────────────────────────────────────────────────────
  // `satisfies` y no una anotación: un campo de más (temperature) pasaría el
  // type-check y sería un 400 (tex.md). Sin `thinking`: en Haiku 5.5 corre
  // adaptativo por defecto, y con esfuerzo bajo casi no piensa.
  const params = {
    model: TEX_MODELO,
    max_tokens: 2000,
    output_config: { effort: 'low' },
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: mensajeUsuario }],
  } satisfies Anthropic.MessageStreamParams

  const cliente = crearClienteTex(clave.clave)
  const stream = cliente.messages.stream(params, { signal: req.signal })
  const codificar = new TextEncoder()

  // La primera letra (o el error) antes de contestar: así un error temprano
  // vuelve con su status y no como un stream vacío.
  const iterador = stream[Symbol.asyncIterator]()
  let primera: string | null = null
  try {
    for (;;) {
      const paso = await iterador.next()
      if (paso.done) break
      const ev = paso.value
      if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta' && ev.delta.text) {
        primera = ev.delta.text
        break
      }
    }
  } catch (err) {
    if (req.signal.aborted || err instanceof Anthropic.APIUserAbortError) return new Response(null, { status: 499 })
    console.error('[borrador] la API de Anthropic falló:', resumirError(err))
    if (err instanceof Anthropic.AuthenticationError) return error(422, 'sin_clave', 'Anthropic rechazó la clave de Tex. Revisala en Configurar Tex.')
    if (err instanceof Anthropic.RateLimitError) return error(429, 'limite', 'Tex está con mucho trabajo. Probá en un momento.')
    return error(502, 'error', 'Tex no pudo escribir el borrador. Probá de nuevo.')
  }

  if (primera === null) {
    // Terminó sin texto: una negativa del modelo (stop_reason 'refusal') o una respuesta vacía.
    try {
      const final = await stream.finalMessage()
      if (final.stop_reason === 'refusal') return error(422, 'error', 'Tex no quiso escribir esta respuesta. Escribila vos.')
    } catch {
      // Sin mensaje final: igual que vacío.
    }
    return error(502, 'error', 'Tex no escribió nada. Probá otra versión.')
  }

  const cuerpo = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(codificar.encode(primera ?? ''))
      try {
        for (;;) {
          const paso = await iterador.next()
          if (paso.done) break
          const ev = paso.value
          if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta' && ev.delta.text) {
            controller.enqueue(codificar.encode(ev.delta.text))
          }
        }
        controller.close()
      } catch (err) {
        if (!(req.signal.aborted || err instanceof Anthropic.APIUserAbortError)) {
          console.error('[borrador] el stream se cortó:', resumirError(err))
        }
        controller.error(err)
      }
    },
    cancel() {
      stream.abort()
    },
  })

  return new Response(cuerpo, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
