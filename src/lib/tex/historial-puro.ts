// =============================================================================
// src/lib/tex/historial-puro.ts
// El historial que se le manda a Claude, armado desde las filas de
// `assistant_messages`. PURO: sin Supabase ni el SDK en runtime (sólo tipos),
// para poder probarlo con node desde el scratchpad.
//
// LO QUE HAY QUE CUIDAR (Claude Haiku 5.5, `anthropic-version: 2026-10-21`)
// -------------------------------------------------------------------------
// 1. PENSAMIENTO PRESERVADO. Un bloque `thinking` reenviado después de
//    CUALQUIER cambio en `system`, `tools` o los mensajes anteriores es un 400.
//    El system de Tex cambia con la fecha, los permisos, el Modo Pro o la
//    personalidad, así que los turnos se GUARDAN SIN pensamiento: dentro de un
//    turno (loop de herramientas) el assistant viaja tal cual, en memoria;
//    entre turnos, nunca.
// 2. EL `role: 'system'` A MITAD DE CONVERSACIÓN (la hora y la pantalla del
//    turno) sólo puede ir después de un `user` y tiene que ser el último
//    mensaje o estar seguido de un `assistant`. TypeScript no lo controla.
// 3. TODO `tool_use` tiene su `tool_result` en el mensaje siguiente, y en ese
//    mensaje los `tool_result` van primero. Si no, 400.
// 4. El primer mensaje es del usuario, los roles alternan y no hay bloques de
//    texto vacíos.
//
// Las filas son append-only: cada una guarda en `model_messages` lo que vio el
// modelo en ese turno. Un turno cortado a mitad del loop se CIERRA antes de
// guardarse (`mensajesParaPersistir`), así el siguiente nunca arranca con un
// `tool_use` sin respuesta. Igual, `normalizarSecuencia` repara lo que llegue
// roto (filas viejas, una carrera entre dos pestañas): un historial inválido
// deja la conversación inutilizable para siempre, y eso es peor que perder un
// bloque.
// =============================================================================

import type Anthropic from '@anthropic-ai/sdk'

type Mensaje = Anthropic.MessageParam
type Bloque = Anthropic.ContentBlockParam
type ResultadoHerramienta = Anthropic.ToolResultBlockParam

/** Una fila de `assistant_messages` tal como la lee el servidor. */
export interface FilaHistorial {
  id: string
  role: string
  content: string | null
  model_messages: unknown
  created_at: string
}

/** Por qué terminó un turno: define cómo se cierra antes de guardarlo. */
export type MotivoCierre = 'completo' | 'interrumpido' | 'error' | 'pasos' | 'limite_respuesta' | 'rechazo'

export const TEXTO_CANCELADO = 'Cancelado: la persona detuvo la respuesta.'

const CIERRES: Record<MotivoCierre, { asistente: string | null; herramienta: string }> = {
  completo: { asistente: null, herramienta: 'No se ejecutó.' },
  interrumpido: { asistente: '(Respuesta interrumpida.)', herramienta: TEXTO_CANCELADO },
  error: { asistente: '(Respuesta interrumpida por un error.)', herramienta: 'Cancelado: hubo un error antes de terminar.' },
  pasos: {
    asistente: '(Corté la respuesta: llegué al límite de consultas de un mismo turno.)',
    herramienta: 'No se ejecutó: se alcanzó el límite de pasos del turno.',
  },
  limite_respuesta: { asistente: '(La respuesta se cortó por larga.)', herramienta: 'No se ejecutó: la respuesta se cortó por larga.' },
  rechazo: { asistente: '(No respondí este pedido.)', herramienta: 'No se ejecutó: el pedido fue rechazado.' },
}

/** Presupuesto del historial previo. Por encima de 100K tokens Haiku 5.5 cobra 5 veces más. */
export const PRESUPUESTO_HISTORIAL_TOKENS = 60_000

// ─────────────────────────────────────────────────────────────────────────────
// Bloques y mensajes
// ─────────────────────────────────────────────────────────────────────────────

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function textoNoVacio(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== ''
}

/**
 * Un bloque reconstruido con SÓLO los campos que la API acepta de vuelta.
 * Se descartan: `thinking`/`redacted_thinking` (regla 1), los `cache_control`
 * (más de 4 breakpoints es un 400 y los de Tex se ponen en otro lado), los
 * bloques de herramientas de servidor (Tex no las usa) y los textos vacíos.
 * El `caller` de un tool_use también se cae: su default es la llamada directa.
 */
function normalizarBloque(b: unknown): Bloque | null {
  if (!esObjeto(b)) return null
  switch (b.type) {
    case 'text':
      return textoNoVacio(b.text) ? { type: 'text', text: b.text } : null
    case 'tool_use':
      if (typeof b.id !== 'string' || typeof b.name !== 'string') return null
      return { type: 'tool_use', id: b.id, name: b.name, input: esObjeto(b.input) ? b.input : {} }
    case 'tool_result': {
      if (typeof b.tool_use_id !== 'string') return null
      let contenido: string
      if (typeof b.content === 'string') contenido = b.content
      else if (Array.isArray(b.content)) {
        contenido = b.content
          .map((c) => (esObjeto(c) && c.type === 'text' && typeof c.text === 'string' ? c.text : ''))
          .filter(Boolean)
          .join('\n')
      } else contenido = ''
      const r: ResultadoHerramienta = { type: 'tool_result', tool_use_id: b.tool_use_id, content: contenido }
      if (b.is_error === true) r.is_error = true
      return r
    }
    default:
      return null
  }
}

function contenidoComoBloques(content: unknown): Bloque[] {
  if (typeof content === 'string') return textoNoVacio(content) ? [{ type: 'text', text: content }] : []
  if (!Array.isArray(content)) return []
  return content.map(normalizarBloque).filter((b): b is Bloque => b !== null)
}

/** Un mensaje válido o null si no queda nada que mandar. */
export function normalizarMensaje(m: unknown): Mensaje | null {
  if (!esObjeto(m)) return null
  if (m.role === 'system') {
    // El system de mitad de conversación sólo admite texto.
    const texto =
      typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content)
          ? m.content
              .map((c) => (esObjeto(c) && c.type === 'text' && typeof c.text === 'string' ? c.text : ''))
              .filter(Boolean)
              .join('\n')
          : ''
    return textoNoVacio(texto) ? { role: 'system', content: texto.trim() } : null
  }
  if (m.role !== 'user' && m.role !== 'assistant') return null
  const bloques = contenidoComoBloques(m.content)
  if (bloques.length === 0) return null
  // Un tool_use sólo puede venir del assistant y un tool_result sólo del user.
  const validos = bloques.filter((b) => (m.role === 'user' ? b.type !== 'tool_use' : b.type !== 'tool_result'))
  return validos.length > 0 ? { role: m.role, content: validos } : null
}

function bloques(m: Mensaje): Bloque[] {
  return typeof m.content === 'string' ? (textoNoVacio(m.content) ? [{ type: 'text', text: m.content }] : []) : [...m.content]
}

function idsDeToolUse(m: Mensaje | undefined): string[] {
  if (!m || m.role !== 'assistant') return []
  return bloques(m).flatMap((b) => (b.type === 'tool_use' ? [b.id] : []))
}

function resultadosCancelados(ids: string[], texto: string): ResultadoHerramienta[] {
  return ids.map((id) => ({ type: 'tool_result', tool_use_id: id, content: texto, is_error: true }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Secuencia válida
// ─────────────────────────────────────────────────────────────────────────────

/** Regla 2: un system queda sólo si sigue a un user y es el último o lo sigue un assistant. */
function quitarSystemsMalUbicados(ms: Mensaje[]): Mensaje[] {
  return ms.filter((m, i) => {
    if (m.role !== 'system') return true
    const anterior = ms[i - 1]
    const siguiente = ms[i + 1]
    return anterior?.role === 'user' && (siguiente === undefined || siguiente.role === 'assistant')
  })
}

/** Dos mensajes seguidos del mismo rol se funden (en el user, los tool_result primero). */
function fusionarConsecutivos(ms: Mensaje[]): Mensaje[] {
  const out: Mensaje[] = []
  for (const m of ms) {
    const ultimo = out[out.length - 1]
    if (ultimo && ultimo.role === m.role && m.role !== 'system') {
      const juntos = [...bloques(ultimo), ...bloques(m)]
      const ordenados =
        m.role === 'user' ? [...juntos.filter((b) => b.type === 'tool_result'), ...juntos.filter((b) => b.type !== 'tool_result')] : juntos
      out[out.length - 1] = { role: m.role, content: ordenados } as Mensaje
    } else {
      out.push(m)
    }
  }
  return out
}

/**
 * Regla 3. Cada tool_use del assistant tiene su tool_result en el user que
 * sigue (si falta, se agrega uno cancelado; si no hay user, se inserta), y un
 * tool_result que no responde a un tool_use del mensaje anterior se descarta.
 */
function repararHerramientas(ms: Mensaje[], textoCancelado: string): Mensaje[] {
  const out: Mensaje[] = []
  for (let i = 0; i < ms.length; i++) {
    const m = ms[i]
    if (m.role === 'user') {
      const anterior = out[out.length - 1]
      const esperados = new Set(idsDeToolUse(anterior))
      const contenido = bloques(m).filter((b) => b.type !== 'tool_result' || esperados.has(b.tool_use_id))
      if (esperados.size > 0) {
        const presentes = new Set(contenido.flatMap((b) => (b.type === 'tool_result' ? [b.tool_use_id] : [])))
        const faltan = [...esperados].filter((id) => !presentes.has(id))
        const resultados = [
          ...contenido.filter((b) => b.type === 'tool_result'),
          ...resultadosCancelados(faltan, textoCancelado),
        ]
        // Orden de los tool_use, y después el resto (la API exige los tool_result primero).
        const orden = idsDeToolUse(anterior)
        resultados.sort(
          (a, b) => orden.indexOf((a as ResultadoHerramienta).tool_use_id) - orden.indexOf((b as ResultadoHerramienta).tool_use_id),
        )
        out.push({ role: 'user', content: [...resultados, ...contenido.filter((b) => b.type !== 'tool_result')] })
      } else if (contenido.length > 0) {
        out.push({ role: 'user', content: contenido })
      }
      continue
    }
    if (m.role === 'assistant') {
      const anterior = out[out.length - 1]
      // Un assistant con tool_use seguido de otro assistant (o del system): falta el user con los resultados.
      if (anterior?.role === 'assistant' && idsDeToolUse(anterior).length > 0) {
        out.push({ role: 'user', content: resultadosCancelados(idsDeToolUse(anterior), textoCancelado) })
      }
      out.push(m)
      continue
    }
    // system
    const anterior = out[out.length - 1]
    if (anterior?.role === 'assistant' && idsDeToolUse(anterior).length > 0) {
      out.push({ role: 'user', content: resultadosCancelados(idsDeToolUse(anterior), textoCancelado) })
    }
    out.push(m)
  }
  const ultimo = out[out.length - 1]
  if (ultimo?.role === 'assistant' && idsDeToolUse(ultimo).length > 0) {
    out.push({ role: 'user', content: resultadosCancelados(idsDeToolUse(ultimo), textoCancelado) })
  }
  return out
}

/** Regla 4: el primer mensaje es del usuario. */
function arrancarConUsuario(ms: Mensaje[]): Mensaje[] {
  const i = ms.findIndex((m) => m.role === 'user')
  return i === -1 ? [] : ms.slice(i)
}

/**
 * Deja una secuencia que la API acepta. Idempotente: aplicarla dos veces da lo
 * mismo. Se itera porque cada arreglo puede habilitar otro (sacar un system
 * deja dos user seguidos, que se funden, y eso puede reubicar un tool_result).
 */
export function normalizarSecuencia(entrada: unknown[], textoCancelado = TEXTO_CANCELADO): Mensaje[] {
  let ms = entrada.map(normalizarMensaje).filter((m): m is Mensaje => m !== null)
  for (let pasada = 0; pasada < 4; pasada++) {
    const antes = JSON.stringify(ms)
    ms = arrancarConUsuario(ms)
    ms = quitarSystemsMalUbicados(ms)
    ms = fusionarConsecutivos(ms)
    ms = repararHerramientas(ms, textoCancelado)
    ms = ms.map((m) => normalizarMensaje(m)).filter((m): m is Mensaje => m !== null)
    if (JSON.stringify(ms) === antes) break
  }
  return ms
}

// ─────────────────────────────────────────────────────────────────────────────
// Filas → turnos → historial
// ─────────────────────────────────────────────────────────────────────────────

/** Lo que vio el modelo en esa fila. Filas viejas (sin model_messages): sólo el texto. */
export function mensajesDeFila(f: FilaHistorial): unknown[] {
  if (f.role !== 'user' && f.role !== 'assistant') return []
  if (Array.isArray(f.model_messages) && f.model_messages.length > 0) return f.model_messages
  return textoNoVacio(f.content) ? [{ role: f.role, content: [{ type: 'text', text: f.content.trim() }] }] : []
}

/** ~caracteres/3,5: el tokenizer de Haiku 5.5 cuenta ~30 % más que el de Haiku 4.5. */
export function estimarTokens(ms: unknown[]): number {
  return Math.ceil(JSON.stringify(ms).length / 3.5)
}

/** Cada fila de usuario abre un turno; las del asistente que siguen son suyas. */
export function agruparEnTurnos(filas: FilaHistorial[]): unknown[][] {
  const turnos: unknown[][] = []
  for (const f of filas) {
    const ms = mensajesDeFila(f)
    if (f.role === 'user') turnos.push([...ms])
    else if (f.role === 'assistant' && turnos.length > 0) turnos[turnos.length - 1].push(...ms)
    // Filas del asistente antes del primer usuario (o con otro rol): fuera.
  }
  return turnos.filter((t) => t.length > 0)
}

/**
 * El historial para Claude: los turnos previos que entren en el presupuesto
 * (enteros, desde el más reciente: nunca medio turno) + el turno nuevo (user +
 * system del turno), normalizado. `recortado` = quedó afuera algo de antes.
 */
export function armarHistorial(
  filasPrevias: FilaHistorial[],
  turnoNuevo: Mensaje[],
  opciones: { presupuestoTokens?: number; filasTruncadas?: boolean } = {},
): { mensajes: Mensaje[]; recortado: boolean } {
  const presupuesto = opciones.presupuestoTokens ?? PRESUPUESTO_HISTORIAL_TOKENS
  const turnos = agruparEnTurnos(filasPrevias)
  const elegidos: unknown[][] = []
  let usados = 0
  for (let i = turnos.length - 1; i >= 0; i--) {
    const costo = estimarTokens(turnos[i])
    if (usados + costo > presupuesto) break
    usados += costo
    elegidos.unshift(turnos[i])
  }
  const recortado = elegidos.length < turnos.length || opciones.filasTruncadas === true
  return { mensajes: normalizarSecuencia([...elegidos.flat(), ...turnoNuevo]), recortado }
}

// ─────────────────────────────────────────────────────────────────────────────
// Guardar un turno
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Los mensajes del turno (assistant y tool_result) listos para guardar: SIN
 * pensamiento y CERRADOS. Un turno cortado (Detener, error, límite) se cierra
 * con un tool_result cancelado por cada tool_use sin respuesta y un texto que
 * dice qué pasó, así el próximo turno no arranca con un loop abierto y el
 * modelo sabe que su respuesta anterior quedó a medias.
 */
export function mensajesParaPersistir(turno: unknown[], motivo: MotivoCierre): Mensaje[] {
  const cierre = CIERRES[motivo]
  // El turno arranca con la respuesta del modelo: un user suelto al principio no tiene sentido acá.
  let ms = turno.map(normalizarMensaje).filter((m): m is Mensaje => m !== null && m.role !== 'system')
  while (ms.length > 0 && ms[0].role !== 'assistant') ms = ms.slice(1)
  ms = repararHerramientas(fusionarConsecutivos(ms), cierre.herramienta)
  const ultimo = ms[ms.length - 1]
  if (!ultimo || ultimo.role !== 'assistant') {
    ms.push({ role: 'assistant', content: [{ type: 'text', text: cierre.asistente ?? '(Sin texto.)' }] })
  } else if (cierre.asistente) {
    ms[ms.length - 1] = { role: 'assistant', content: [...bloques(ultimo), { type: 'text', text: cierre.asistente }] }
  }
  return ms
}

// ─────────────────────────────────────────────────────────────────────────────
// Regenerar / editar: desde dónde se corta
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Qué filas se borran antes de correr el turno. El cliente (`useChat`) manda
 * siempre como último mensaje el del usuario que hay que responder:
 *
 *   enviar nuevo              submit, sin mensajeId           → se agrega
 *   reenviar (tras un error)  submit, mensajeId = ese mensaje → se corta desde él
 *   editar                    submit, mensajeId = el editado (mismo id) → ídem
 *   regenerate()              regenerate, sin mensajeId       → desde el último user
 *   regenerate({messageId})   regenerate, id del user o del assistant
 *
 * Regla única: se corta (inclusive) desde la PRIMERA fila cuyo id sea el
 * `mensajeId` (de cualquier rol) o el id del mensaje del usuario (sólo una fila
 * de USUARIO), y el turno del usuario se vuelve a guardar con la hora y la
 * pantalla de ahora (append-only desde ese punto).
 *
 * IDEMPOTENCIA: un 'submit-message' cuyo id ya está guardado como pregunta de
 * esta conversación NO es una pregunta nueva: es un reintento (el "Reintentar"
 * del cliente reenvía el MISMO mensaje, con o sin `mensajeId`). Se corta desde
 * esa fila y la pregunta queda una sola vez. Antes de esto, un reintento después
 * de un "Volver a generar" fallido la guardaba dos veces.
 *
 * Si el id no está (un cliente que no usó UUID), en un regenerate se corta
 * desde el último mensaje del usuario con el mismo texto, o desde el último
 * mensaje del usuario a secas.
 */
export function planificarCorte(
  filas: FilaHistorial[],
  pedido: { trigger: 'submit-message' | 'regenerate-message'; mensajeId?: string | null; idMensaje: string; texto: string },
): { borrar: string[]; quedan: FilaHistorial[] } {
  const mensajeId = typeof pedido.mensajeId === 'string' && pedido.mensajeId !== '' ? pedido.mensajeId : null
  const idMensaje = pedido.idMensaje !== '' ? pedido.idMensaje : null
  let corte = filas.findIndex((f) => (mensajeId !== null && f.id === mensajeId) || (idMensaje !== null && f.id === idMensaje && f.role === 'user'))
  if (corte === -1 && pedido.trigger === 'regenerate-message') {
    const texto = pedido.texto.trim()
    for (let i = filas.length - 1; i >= 0; i--) {
      if (filas[i].role === 'user' && (filas[i].content ?? '').trim() === texto) {
        corte = i
        break
      }
    }
    if (corte === -1) {
      for (let i = filas.length - 1; i >= 0; i--) {
        if (filas[i].role === 'user') {
          corte = i
          break
        }
      }
    }
  }
  if (corte === -1) return { borrar: [], quedan: filas }
  return { borrar: filas.slice(corte).map((f) => f.id), quedan: filas.slice(0, corte) }
}
