import 'server-only'

// =============================================================================
// src/lib/tex/motor.ts
// El loop de Tex: Claude Haiku 5.5 con el SDK oficial, a mano y en streaming,
// traducido al protocolo de UI-message-stream del AI SDK 5 para que el browser
// siga usando `useChat`.
//
// UN PASO = UNA LLAMADA A LA API. Se streamea, se mira el `stop_reason` y:
//   tool_use     → se validan los inputs con zod, se ejecutan TODAS las
//                  herramientas del mensaje en paralelo y vuelven TODOS los
//                  tool_result en UN mensaje user; otro paso.
//   end_turn     → listo.
//   max_tokens   → no se ejecuta nada (el input pudo quedar truncado y aun así
//                  parsear "bien"), aviso `limite_respuesta`.
//   refusal      → no se ejecuta nada, aviso `rechazo` (Haiku 5.5 no tiene
//                  fallback del lado del servidor: no se manda `fallbacks`).
//   pause_turn   → se continúa (sólo pasa con herramientas de servidor).
// Máximo 10 pasos por turno.
//
// PARÁMETROS QUE NO PUEDEN VIAJAR: `temperature`, `top_p` y `top_k` son un 400
// con `anthropic-version: 2026-10-21` (lo manda el SDK 1.1.0). `stream()` es
// genérico y NO marca campos de más, por eso los params van con `satisfies`.
// `budget_tokens` también es un 400: el pensamiento es adaptativo (default de
// Haiku 5.5) y el `effort` sale de la configuración de la org.
//
// PENSAMIENTO: el assistant vuelve TAL CUAL dentro del turno (con sus bloques
// thinking y su firma); lo que se guarda va sin ellos (`historial-puro.ts`).
// No se manda `reasoning-*` al browser: con `display` en 'omitted' (default de
// Haiku 5.5) los bloques llegan vacíos.
//
// DESCONEXIÓN: `createUIMessageStream` no se entera solo de que el browser se
// fue (gotcha 6 del relevamiento). La señal del request llega al SDK y a cada
// herramienta; el abort cae como `APIUserAbortError` y el turno se cierra y se
// guarda igual.
//
// NUNCA TIRA. Cualquier falla (una herramienta, un esquema de zod que explota al
// validar, algo inesperado del loop) termina en un `ResultadoMotor` con su
// `turno` y su `uso`: así el orquestador guarda lo que la persona ya vio y lo
// que se consumió. Si tirara, el turno entero se perdía sin guardar nada.
//
// REINTENTOS: un paso que falla con un `AnthropicError` que no es de la API (un
// JSON de herramienta ilegible, un corte de red a mitad del stream) se reintenta
// SÓLO si todavía no mostró texto. Con texto a la vista, el reintento escribía
// el suyo y lo guardado quedaba duplicado o a medias: se cierra como error y se
// guarda lo que se vio.
//
// El motor no toca la base ni escribe `start`/`finish`: recibe `escribir` (que
// manda el chunk al browser y lo anota en las partes) y devuelve qué pasó. Así
// se prueba con un cliente falso.
// =============================================================================

import Anthropic from '@anthropic-ai/sdk'
import type { FinishReason } from 'ai'
import {
  TEX_MODELO,
  metaHerramienta,
  type TexCodigoAviso,
  type TexErrorRespuesta,
  type TexEsfuerzo,
  type TexUso,
} from './contrato'
import { sumarPedido, usoVacio } from './costo'
import { TEXTO_CANCELADO, type MotivoCierre } from './historial-puro'
import type { TexChunk } from './partes'
import type { TexContexto, TexHerramienta, TexResultado } from './herramientas/tipos'

export const MAX_PASOS = 10
/** El pensamiento cuenta dentro; con streaming no hay timeout que temer. */
const MAX_TOKENS = 32_000
/** Un JSON de herramienta imposible de parsear (eager streaming) se reintenta hasta 2 veces. */
const MAX_REINTENTOS_PASO = 2
/** Ninguna herramienta debería acercarse; si alguna se pasa, el modelo recibe un aviso y no 100K tokens. */
const MAX_RESULTADO_CARACTERES = 60_000

export interface EventoAuditoria {
  kind: 'tool' | 'denied' | 'sql'
  toolName: string
  allowed: boolean
  detail: Record<string, unknown>
}

export interface EntradaMotor {
  /** El cliente del SDK (o uno falso en las pruebas). */
  cliente: Pick<Anthropic, 'messages'>
  /** Manda el chunk al browser y lo registra en las partes del mensaje. */
  escribir: (chunk: TexChunk) => void
  system: Anthropic.TextBlockParam[]
  /** En el MISMO orden que `definiciones`. */
  herramientas: TexHerramienta[]
  definiciones: Anthropic.Tool[]
  esfuerzo: TexEsfuerzo
  /** Historial + mensaje del usuario + system del turno (último). */
  mensajes: Anthropic.MessageParam[]
  ctx: TexContexto
  signal: AbortSignal
  /** Identificador opaco (hash) para `metadata.user_id`: nunca un nombre ni un mail. */
  usuarioOpaco?: string
  puedeConfigurar: boolean
  auditar?: (evento: EventoAuditoria) => void
  maxPasos?: number
}

export interface AvisoTurno {
  codigo: TexCodigoAviso
  texto: string
}

export interface ResultadoMotor {
  motivo: MotivoCierre
  finishReason: FinishReason
  /** Lo que agregó el turno (assistant y tool_result), CON pensamiento: para guardar, `mensajesParaPersistir`. */
  turno: Anthropic.MessageParam[]
  uso: TexUso
  aviso: AvisoTurno | null
  /** Error fatal: el orquestador lo manda como chunk `error`, después de guardar lo que haya. */
  error: TexErrorRespuesta | null
}

const ERROR_GENERICO: TexErrorRespuesta = { codigo: 'error', mensaje: 'Tex no pudo terminar la respuesta. Probá de nuevo.' }

/** Lo que vuelve al modelo cuando una herramienta no pudo completarse. */
const RESULTADO_FALLIDO = JSON.stringify({
  error: 'no_se_pudo_leer',
  instruccion: 'Falló esta consulta. Decile a la persona que no pudiste leer ese dato. No lo estimes ni lo reemplaces por cero.',
})

export const AVISOS = {
  rechazo: 'Eso no lo puedo responder. Probá preguntarlo de otra forma.',
  limite_respuesta: 'La respuesta se cortó por larga. Pedime que siga o que la resuma.',
  pasos: 'Frené porque hice demasiadas consultas para una sola respuesta. Pedime que siga o hacé la pregunta más concreta.',
  interrumpido: 'Detuviste la respuesta.',
} as const satisfies Partial<Record<TexCodigoAviso, string>>

// ─────────────────────────────────────────────────────────────────────────────
// Errores del SDK → error de Tex
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Más específica primero: `APIUserAbortError` extiende `APIError` y se resuelve
 * antes de llegar acá. Se mira la clase Y el `type` del cuerpo: un error que
 * llega A MITAD del stream (evento SSE `error`) es un `APIError` pelado, sin
 * status, con el tipo sólo en `type` (p. ej. un `overloaded_error` o un
 * `rate_limit_error` después de los primeros tokens).
 */
export function traducirErrorAnthropic(err: unknown, puedeConfigurar: boolean): TexErrorRespuesta {
  const avisaleAlDueno = 'Tex no está disponible ahora. Avisale al dueño.'
  if (err instanceof Anthropic.APIConnectionError) {
    return { codigo: 'error', mensaje: 'No pudimos comunicarnos con Claude. Probá de nuevo.' }
  }
  if (!(err instanceof Anthropic.APIError)) {
    return { codigo: 'error', mensaje: 'Tex no pudo terminar la respuesta. Probá de nuevo.' }
  }
  if (err instanceof Anthropic.AuthenticationError || err.type === 'authentication_error') {
    return { codigo: 'clave_invalida', mensaje: puedeConfigurar ? 'Anthropic rechazó la clave. Revisala en Configurar Tex.' : avisaleAlDueno }
  }
  if (
    err instanceof Anthropic.PermissionDeniedError ||
    err instanceof Anthropic.NotFoundError ||
    err.type === 'permission_error' ||
    err.type === 'not_found_error'
  ) {
    return {
      codigo: 'clave_invalida',
      mensaje: puedeConfigurar ? 'Esa clave de Anthropic no tiene acceso a Claude Haiku 5.5. Revisala en Configurar Tex.' : avisaleAlDueno,
    }
  }
  if (err instanceof Anthropic.RateLimitError || err.type === 'rate_limit_error') {
    return { codigo: 'limite', mensaje: 'Hay muchas consultas seguidas. Esperá un momento.' }
  }
  let cuerpo = ''
  try {
    cuerpo = JSON.stringify(err.error ?? '')
  } catch {
    cuerpo = ''
  }
  if (err.type === 'billing_error' || /credit balance/i.test(err.message) || /credit balance/i.test(cuerpo)) {
    return {
      codigo: 'error',
      mensaje: puedeConfigurar ? 'La cuenta de Anthropic de esta clave no tiene saldo. Cargale crédito en la consola de Anthropic.' : avisaleAlDueno,
    }
  }
  if (err.status === 529 || err.type === 'overloaded_error') {
    return { codigo: 'error', mensaje: 'Claude está con mucha demanda en este momento. Probá de nuevo en un minuto.' }
  }
  return { codigo: 'error', mensaje: 'Tex no pudo terminar la respuesta. Probá de nuevo.' }
}

/** Para los logs: nada del request ni de la clave, sólo lo que sirve para diagnosticar. */
export function resumirError(err: unknown): string {
  if (err instanceof Anthropic.APIError) {
    return `${err.constructor.name} status=${err.status ?? '-'} type=${err.type ?? '-'} request=${err.requestID ?? '-'}: ${err.message.slice(0, 300)}`
  }
  if (err instanceof Error) return `${err.name}: ${err.message.slice(0, 300)}`
  return String(err).slice(0, 300)
}

// ─────────────────────────────────────────────────────────────────────────────
// El loop
// ─────────────────────────────────────────────────────────────────────────────

type Abierto = { tipo: 'texto'; id: string; cerrado: boolean } | { tipo: 'herramienta'; id: string; nombre: string }

type ResultadoPaso =
  | { tipo: 'ok'; final: Anthropic.Message; herramientasEmpezadas: string[] }
  | { tipo: 'abortado'; textoParcial: string[] }
  | { tipo: 'reintentar'; textoParcial: string[] }
  | { tipo: 'fatal'; error: TexErrorRespuesta; textoParcial: string[] }

function finishReasonDe(stop: Anthropic.StopReason | null): FinishReason {
  switch (stop) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop'
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return 'length'
    case 'tool_use':
      return 'tool-calls'
    case 'refusal':
      return 'content-filter'
    case 'pause_turn':
      return 'other'
    default:
      return 'unknown'
  }
}

export async function correrMotor(e: EntradaMotor): Promise<ResultadoMotor> {
  const maxPasos = e.maxPasos ?? MAX_PASOS
  const mensajes = [...e.mensajes]
  const turno: Anthropic.MessageParam[] = []
  // Tokens y costo, pedido a pedido (cada pedido con su tarifa: src/lib/tex/costo.ts).
  const uso: TexUso = usoVacio()
  const porNombre = new Map(e.herramientas.map((h) => [h.nombre, h]))

  const terminar = (
    motivo: MotivoCierre,
    finishReason: FinishReason,
    extra: { aviso?: AvisoTurno; error?: TexErrorRespuesta } = {},
  ): ResultadoMotor => {
    if (extra.aviso) e.escribir({ type: 'data-aviso', data: extra.aviso })
    return { motivo, finishReason, turno, uso, aviso: extra.aviso ?? null, error: extra.error ?? null }
  }

  /** El texto que llegó a mostrarse en un paso que no terminó: queda en el historial y en las partes. */
  const guardarParcial = (textos: string[]) => {
    const bloques = textos.filter((t) => t.trim() !== '').map((t) => ({ type: 'text' as const, text: t }))
    if (bloques.length > 0) turno.push({ role: 'assistant', content: bloques })
  }

  e.escribir({ type: 'data-estado', data: { fase: 'pensando' }, transient: true })

  try {
    for (let paso = 1; paso <= maxPasos; paso++) {
      // `correrPaso` decide si un paso fallido se reintenta (sólo sin texto a la vista y
      // con reintentos disponibles); si no, devuelve 'fatal'.
      let intento = 0
      let r: ResultadoPaso = await correrPaso(e, mensajes, paso, intento, uso)
      while (r.tipo === 'reintentar') {
        intento++
        r = await correrPaso(e, mensajes, paso, intento, uso)
      }

      if (r.tipo === 'abortado') {
        guardarParcial(r.textoParcial)
        return terminar('interrumpido', 'other', { aviso: { codigo: 'interrumpido', texto: AVISOS.interrumpido } })
      }
      if (r.tipo === 'fatal') {
        guardarParcial(r.textoParcial)
        return terminar('error', 'error', { error: r.error })
      }

      const { final, herramientasEmpezadas } = r
      const asistente: Anthropic.MessageParam = { role: 'assistant', content: final.content }
      mensajes.push(asistente)
      turno.push(asistente)
      const usos = final.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      const cancelar = (texto: string) => {
        for (const id of herramientasEmpezadas) e.escribir({ type: 'tool-output-error', toolCallId: id, errorText: texto })
      }

      if (final.stop_reason === 'refusal') {
        cancelar('No se ejecutó: el pedido fue rechazado.')
        e.escribir({ type: 'finish-step' })
        return terminar('rechazo', 'content-filter', { aviso: { codigo: 'rechazo', texto: AVISOS.rechazo } })
      }
      if (final.stop_reason === 'max_tokens' || final.stop_reason === 'model_context_window_exceeded') {
        cancelar('No se ejecutó: la respuesta se cortó por larga.')
        e.escribir({ type: 'finish-step' })
        return terminar('limite_respuesta', 'length', { aviso: { codigo: 'limite_respuesta', texto: AVISOS.limite_respuesta } })
      }
      if (final.stop_reason === 'pause_turn') {
        e.escribir({ type: 'finish-step' })
        continue
      }
      if (usos.length === 0) {
        e.escribir({ type: 'finish-step' })
        return terminar('completo', finishReasonDe(final.stop_reason))
      }

      let resultados: Anthropic.ToolResultBlockParam[]
      try {
        resultados = await ejecutarHerramientas(e, usos, porNombre)
      } catch (err) {
        // Red de seguridad: cada herramienta ya atrapa lo suyo (`ejecutarUna`). Si igual algo
        // se escapa, los tool_use de este paso se cierran con su error y el turno termina
        // guardando lo que se vio, en vez de perderse entero.
        console.error('[tex] las herramientas del paso fallaron:', resumirError(err))
        cancelar('No se pudo completar.')
        turno.push({
          role: 'user',
          content: usos.map((tu): Anthropic.ToolResultBlockParam => ({ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: RESULTADO_FALLIDO })),
        })
        e.escribir({ type: 'finish-step' })
        return terminar('error', 'error', { error: ERROR_GENERICO })
      }
      const mensajeResultados: Anthropic.MessageParam = { role: 'user', content: resultados }
      mensajes.push(mensajeResultados)
      turno.push(mensajeResultados)

      if (e.signal.aborted) {
        e.escribir({ type: 'finish-step' })
        return terminar('interrumpido', 'other', { aviso: { codigo: 'interrumpido', texto: AVISOS.interrumpido } })
      }
      e.escribir({ type: 'data-estado', data: { fase: 'redactando' }, transient: true })
      e.escribir({ type: 'finish-step' })
      if (paso === maxPasos) {
        // Las herramientas de este último paso SÍ corrieron (la persona ve sus tablas y
        // gráficos), pero no hay otra llamada para que el modelo las cuente.
        return terminar('pasos', 'tool-calls', { aviso: { codigo: 'pasos', texto: AVISOS.pasos } })
      }
    }
    return terminar('pasos', 'tool-calls', { aviso: { codigo: 'pasos', texto: AVISOS.pasos } })
  } catch (err) {
    // Lo inesperado: el turno termina como error con lo que ya tenía (`mensajesParaPersistir`
    // cierra los tool_use que hayan quedado abiertos), y el orquestador lo guarda con el uso.
    console.error('[tex] el motor falló:', resumirError(err))
    return terminar('error', 'error', { error: ERROR_GENERICO })
  }
}

/** Una llamada a la API, traducida a chunks a medida que llega. */
async function correrPaso(
  e: EntradaMotor,
  mensajes: Anthropic.MessageParam[],
  paso: number,
  intento: number,
  uso: TexUso,
): Promise<ResultadoPaso> {
  e.escribir({ type: 'start-step' })
  const sufijo = intento === 0 ? `${paso}` : `${paso}r${intento}`
  const abiertos = new Map<number, Abierto>()
  const textos = new Map<number, string>()
  const herramientasEmpezadas: string[] = []

  const cerrarTextos = () => {
    for (const a of abiertos.values()) {
      if (a.tipo === 'texto' && !a.cerrado) {
        a.cerrado = true
        e.escribir({ type: 'text-end', id: a.id })
      }
    }
  }
  const cancelarEmpezadas = (texto: string) => {
    for (const id of herramientasEmpezadas) e.escribir({ type: 'tool-output-error', toolCallId: id, errorText: texto })
  }

  // `satisfies` (y no una anotación): sin él, un `temperature` de más pasaría el
  // type-check —`stream<Params extends MessageStreamParams>` acepta campos extra—
  // y sería un 400 en runtime. Sin `tool_choice`: auto, y el modelo piensa antes de llamar.
  const params = {
    model: TEX_MODELO,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'adaptive' },
    output_config: { effort: e.esfuerzo },
    system: e.system,
    ...(e.definiciones.length > 0 ? { tools: e.definiciones } : {}),
    // Breakpoint 3 de 3: caché automática de los mensajes (los otros dos son la
    // última herramienta y el system). Máximo 4.
    cache_control: { type: 'ephemeral' },
    messages: mensajes,
    ...(e.usuarioOpaco ? { metadata: { user_id: e.usuarioOpaco } } : {}),
  } satisfies Anthropic.MessageStreamParams

  // El uso hasta el corte, si el paso no termina: el snapshot del stream lo trae.
  let usoParcial: () => Anthropic.Usage | undefined = () => undefined
  try {
    const stream = e.cliente.messages.stream(params, { signal: e.signal })
    usoParcial = () => stream.currentMessage?.usage
    for await (const ev of stream) {
      switch (ev.type) {
        case 'content_block_start': {
          const b = ev.content_block
          if (b.type === 'text') {
            const id = `t${sufijo}-${ev.index}`
            abiertos.set(ev.index, { tipo: 'texto', id, cerrado: false })
            textos.set(ev.index, b.text)
            e.escribir({ type: 'text-start', id })
            if (b.text) e.escribir({ type: 'text-delta', id, delta: b.text })
          } else if (b.type === 'tool_use') {
            abiertos.set(ev.index, { tipo: 'herramienta', id: b.id, nombre: b.name })
            herramientasEmpezadas.push(b.id)
            e.escribir({ type: 'tool-input-start', toolCallId: b.id, toolName: b.name })
            e.escribir({ type: 'data-estado', data: { fase: 'consultando', herramienta: b.name }, transient: true })
          }
          // thinking / redacted_thinking: no se muestran (llegan vacíos con 'omitted').
          break
        }
        case 'content_block_delta': {
          const a = abiertos.get(ev.index)
          if (!a) break
          if (ev.delta.type === 'text_delta' && a.tipo === 'texto' && !a.cerrado) {
            if (ev.delta.text) {
              textos.set(ev.index, (textos.get(ev.index) ?? '') + ev.delta.text)
              e.escribir({ type: 'text-delta', id: a.id, delta: ev.delta.text })
            }
          } else if (ev.delta.type === 'input_json_delta' && a.tipo === 'herramienta') {
            if (ev.delta.partial_json) e.escribir({ type: 'tool-input-delta', toolCallId: a.id, inputTextDelta: ev.delta.partial_json })
          }
          break
        }
        case 'content_block_stop': {
          const a = abiertos.get(ev.index)
          if (a?.tipo === 'texto' && !a.cerrado) {
            a.cerrado = true
            e.escribir({ type: 'text-end', id: a.id })
          }
          break
        }
        default:
          break
      }
    }
    const final = await stream.finalMessage()
    // Tokens y costo de ESTE pedido, con su tarifa (más de 100K de prompt = 5×).
    sumarPedido(uso, final.usage)
    cerrarTextos()
    return { tipo: 'ok', final, herramientasEmpezadas }
  } catch (err) {
    cerrarTextos()
    // Lo consumido hasta el corte también se paga: el snapshot trae el uso del message_start/delta.
    sumarPedido(uso, usoParcial())
    const textoParcial = [...textos.values()]
    if (e.signal.aborted || err instanceof Anthropic.APIUserAbortError) {
      cancelarEmpezadas(TEXTO_CANCELADO)
      e.escribir({ type: 'finish-step' })
      return { tipo: 'abortado', textoParcial }
    }
    if (err instanceof Anthropic.APIError) {
      console.error('[tex] la API de Anthropic falló:', resumirError(err))
      cancelarEmpezadas('No se pudo completar.')
      e.escribir({ type: 'finish-step' })
      return { tipo: 'fatal', error: traducirErrorAnthropic(err, e.puedeConfigurar), textoParcial }
    }
    if (err instanceof Anthropic.AnthropicError) {
      // Con eager_input_streaming, un JSON de herramienta imposible de parsear llega acá (no
      // es APIError) al iterar o en finalMessage(). Un corte de red a mitad del stream también:
      // el SDK lo envuelve en un AnthropicError.
      //
      // Se reintenta SÓLO si este intento no mostró texto. Con texto a la vista, el reintento
      // escribía el suyo debajo y lo que la persona ya había leído quedaba duplicado (o a
      // medias) en la pantalla y en lo guardado, mientras el modelo veía una sola copia. Ese
      // caso se cierra como error: se guarda lo que se vio y la persona puede reintentar.
      const mostroTexto = textoParcial.some((t) => t.trim() !== '')
      if (!mostroTexto && intento < MAX_REINTENTOS_PASO) {
        console.warn('[tex] paso con respuesta ilegible, reintento:', resumirError(err))
        // Queda escrito en la tarjeta de trabajo después del reintento: en pasado, no "Reintentando…".
        cancelarEmpezadas('El pedido llegó ilegible: reintenté este paso.')
        e.escribir({ type: 'finish-step' })
        return { tipo: 'reintentar', textoParcial }
      }
      console.error(
        `[tex] paso con respuesta ilegible, sin reintento (${mostroTexto ? 'ya mostró texto' : 'sin reintentos'}):`,
        resumirError(err),
      )
      cancelarEmpezadas('No se pudo completar.')
      e.escribir({ type: 'finish-step' })
      return { tipo: 'fatal', error: ERROR_GENERICO, textoParcial }
    }
    console.error('[tex] error inesperado en el paso:', resumirError(err))
    cancelarEmpezadas('No se pudo completar.')
    e.escribir({ type: 'finish-step' })
    return { tipo: 'fatal', error: ERROR_GENERICO, textoParcial }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Herramientas
// ─────────────────────────────────────────────────────────────────────────────

function serializarParaModelo(valor: unknown): string {
  let texto: string
  try {
    texto = JSON.stringify(valor ?? null)
  } catch {
    return JSON.stringify({ error: 'no_se_pudo_leer', mensaje: 'El resultado no se pudo serializar.' })
  }
  if (texto.length <= MAX_RESULTADO_CARACTERES) return texto
  return JSON.stringify({
    aviso: 'El resultado era demasiado grande y se recortó: pedí menos datos (un período o una sucursal) si necesitás el resto.',
    recorte: texto.slice(0, MAX_RESULTADO_CARACTERES),
  })
}

function errorDelModelo(paraModelo: unknown): string | null {
  if (typeof paraModelo === 'object' && paraModelo !== null && 'error' in paraModelo) {
    const valor = (paraModelo as { error: unknown }).error
    return typeof valor === 'string' ? valor : 'error'
  }
  return null
}

function resumirInput(input: unknown): unknown {
  try {
    const texto = JSON.stringify(input)
    return texto.length <= 600 ? input : `${texto.slice(0, 600)}…`
  } catch {
    return null
  }
}

async function ejecutarHerramientas(
  e: EntradaMotor,
  usos: Anthropic.ToolUseBlock[],
  porNombre: Map<string, TexHerramienta>,
): Promise<Anthropic.ToolResultBlockParam[]> {
  return Promise.all(usos.map((tu) => ejecutarUna(e, tu, porNombre.get(tu.name))))
}

/**
 * Una herramienta. NUNCA tira: cualquier excepción vuelve al modelo como un
 * tool_result con error y a la persona como un paso fallido. Antes, una sola
 * herramienta que explotaba (p. ej. un esquema de zod que tiraba al validar)
 * rechazaba el `Promise.all` y se perdía el turno entero, sin guardarse.
 */
async function ejecutarUna(e: EntradaMotor, tu: Anthropic.ToolUseBlock, h: TexHerramienta | undefined): Promise<Anthropic.ToolResultBlockParam> {
  try {
    return await ejecutarUnaSinRed(e, tu, h)
  } catch (err) {
    console.error(`[tex] la herramienta ${tu.name} falló fuera de su ejecución:`, resumirError(err))
    e.escribir({ type: 'tool-output-error', toolCallId: tu.id, errorText: `No pude completar «${metaHerramienta(tu.name).etiqueta}».` })
    return { type: 'tool_result', tool_use_id: tu.id, is_error: true, content: RESULTADO_FALLIDO }
  }
}

type ResultadoValidacion = ReturnType<TexHerramienta['esquema']['safeParse']>

async function ejecutarUnaSinRed(
  e: EntradaMotor,
  tu: Anthropic.ToolUseBlock,
  h: TexHerramienta | undefined,
): Promise<Anthropic.ToolResultBlockParam> {
  if (!h) {
    e.escribir({ type: 'tool-input-error', toolCallId: tu.id, toolName: tu.name, input: tu.input, errorText: 'Herramienta desconocida.' })
    return {
      type: 'tool_result',
      tool_use_id: tu.id,
      is_error: true,
      content: `La herramienta "${tu.name}" no existe. Usá sólo las herramientas declaradas.`,
    }
  }

  // Con eager_input_streaming la API ya no valida el input contra el esquema: se valida acá.
  // `safeParse` PUEDE tirar: zod 3 corre los `superRefine` también sobre valores con errores
  // no fatales, y un refinamiento que asume un índice (`series[0]`) explota en vez de devolver
  // success:false. Se trata igual que un input inválido: vuelve al modelo para que lo corrija.
  let validado: ResultadoValidacion | null
  try {
    validado = h.esquema.safeParse(tu.input)
  } catch (err) {
    console.warn(`[tex] el esquema de ${tu.name} tiró al validar:`, resumirError(err))
    validado = null
  }
  if (!validado || !validado.success) {
    const errores = validado
      ? validado.error.issues.slice(0, 6).map((i) => `${i.path.join('.') || '(raíz)'}: ${i.message}`)
      : ['(raíz): los datos del pedido no se pudieron validar. Revisá que cada lista tenga al menos un elemento y que los valores coincidan con las etiquetas.']
    e.escribir({
      type: 'tool-input-error',
      toolCallId: tu.id,
      toolName: tu.name,
      input: tu.input,
      errorText: 'Los datos del pedido no eran válidos.',
    })
    e.auditar?.({ kind: 'tool', toolName: tu.name, allowed: true, detail: { estado: 'input_invalido', errores } })
    let crudo: string
    try {
      crudo = JSON.stringify(tu.input).slice(0, 2000)
    } catch {
      crudo = ''
    }
    return { type: 'tool_result', tool_use_id: tu.id, is_error: true, content: JSON.stringify({ INVALID_JSON: crudo, errores }) }
  }

  e.escribir({ type: 'tool-input-available', toolCallId: tu.id, toolName: tu.name, input: validado.data })
  const inicio = Date.now()
  let resultado: TexResultado
  try {
    resultado = await h.ejecutar(validado.data, { ctx: e.ctx, signal: e.signal })
  } catch (err) {
    const cancelada = e.signal.aborted
    if (!cancelada) console.error(`[tex] la herramienta ${tu.name} falló:`, resumirError(err))
    const meta = metaHerramienta(tu.name)
    e.escribir({
      type: 'tool-output-error',
      toolCallId: tu.id,
      errorText: cancelada ? TEXTO_CANCELADO : `No pude completar «${meta.etiqueta}».`,
    })
    e.auditar?.({
      kind: tu.name === 'consulta_sql' ? 'sql' : 'tool',
      toolName: tu.name,
      allowed: true,
      detail: { estado: cancelada ? 'cancelada' : 'excepcion', ms: Date.now() - inicio, input: resumirInput(validado.data) },
    })
    return {
      type: 'tool_result',
      tool_use_id: tu.id,
      is_error: true,
      content: cancelada ? TEXTO_CANCELADO : RESULTADO_FALLIDO,
    }
  }

  const salida = resultado.paraUI
  // Una lectura que falló es un paso fallido (ámbar, con su texto: "No pude leer las
  // reseñas"), no un resultado: así lo ve la persona en la tarjeta de trabajo y así
  // queda guardado. Si además trae bloques (datos parciales), se muestran.
  if (salida.error && salida.bloques.length === 0) {
    e.escribir({ type: 'tool-output-error', toolCallId: tu.id, errorText: salida.error })
  } else {
    e.escribir({ type: 'tool-output-available', toolCallId: tu.id, output: salida })
  }

  const error = errorDelModelo(resultado.paraModelo)
  e.auditar?.({
    kind: error === 'sin_acceso' ? 'denied' : tu.name === 'consulta_sql' ? 'sql' : 'tool',
    toolName: tu.name,
    allowed: error !== 'sin_acceso',
    detail: {
      ms: Date.now() - inicio,
      ...(error ? { error } : {}),
      ...(tu.name === 'consulta_sql' ? { sql: resumirInput(validado.data) } : { input: resumirInput(validado.data) }),
    },
  })
  return {
    type: 'tool_result',
    tool_use_id: tu.id,
    content: serializarParaModelo(resultado.paraModelo),
    ...(error === 'no_se_pudo_leer' ? { is_error: true } : {}),
  }
}
