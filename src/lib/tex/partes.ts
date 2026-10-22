// =============================================================================
// src/lib/tex/partes.ts
// Arma, en paralelo a los chunks que viajan al browser, las `parts` del
// mensaje del asistente para guardarlas en `assistant_messages.parts`. Al
// reabrir la conversación vuelven los gráficos, las tablas y el informe.
//
// POR QUÉ NO SE USA EL `onFinish` DE `createUIMessageStream`
// ----------------------------------------------------------
// Con una desconexión (Detener, se cerró la pestaña) ese callback llega con el
// mensaje truncado —0 partes en la prueba del relevamiento—. Acá cada chunk
// que se escribe pasa también por `aplicar`, con las mismas reglas que aplica
// `useChat` en el cliente (`processUIMessageStream` del AI SDK 5.0.202), así
// lo guardado es lo que la persona vio, aunque se haya ido a la mitad.
//
// PURO: sólo tipos importados. Lo prueban los tests del scratchpad pasando
// los mismos chunks por `readUIMessageStream` del AI SDK y comparando.
// =============================================================================

import type { InferUIMessageChunk } from 'ai'
import type { TexUIMessage } from './contrato'

export type TexChunk = InferUIMessageChunk<TexUIMessage>
export type TexParte = TexUIMessage['parts'][number]

export interface ArmadorDePartes {
  /** Registra un chunk escrito al stream. Los `data-*` transient no quedan (igual que en el cliente). */
  aplicar(chunk: TexChunk): void
  /**
   * Deja todo terminado para guardar: un texto abierto pasa a 'done' y una
   * herramienta sin resultado (cortada a mitad) a 'output-error' con este texto.
   */
  cerrar(textoHerramientaCortada: string): void
  /** Copia JSON-segura (sin `undefined`) de las partes. */
  partes(): TexParte[]
  /** Los textos del mensaje, en orden: va a `assistant_messages.content`. */
  texto(): string
  /** ¿Hay algo visible (texto o herramientas)? Un turno vacío no se guarda. */
  tieneContenido(): boolean
}

type ParteMutable = Record<string, unknown> & { type: string }

export function crearArmadorDePartes(): ArmadorDePartes {
  const partes: ParteMutable[] = []
  const textosAbiertos = new Map<string, ParteMutable>()

  const herramienta = (toolCallId: string): ParteMutable | undefined =>
    partes.find((p) => p.type.startsWith('tool-') && p.toolCallId === toolCallId)

  /** Mismo efecto que `updateToolPart` del cliente: actualiza la parte o la crea al final. */
  function actualizarHerramienta(toolCallId: string, toolName: string | null, campos: Record<string, unknown>): void {
    const existente = herramienta(toolCallId)
    if (existente) {
      Object.assign(existente, campos)
      return
    }
    if (!toolName) return // un tool-output-* sin parte previa: el cliente lo rechaza, acá se ignora
    partes.push({ type: `tool-${toolName}`, toolCallId, ...campos })
  }

  return {
    aplicar(chunk) {
      switch (chunk.type) {
        case 'start-step':
          partes.push({ type: 'step-start' })
          return
        case 'finish-step':
          textosAbiertos.clear()
          return
        case 'text-start': {
          const parte: ParteMutable = { type: 'text', text: '', state: 'streaming' }
          partes.push(parte)
          textosAbiertos.set(chunk.id, parte)
          return
        }
        case 'text-delta': {
          const parte = textosAbiertos.get(chunk.id)
          if (parte) parte.text = `${parte.text as string}${chunk.delta}`
          return
        }
        case 'text-end': {
          const parte = textosAbiertos.get(chunk.id)
          if (parte) parte.state = 'done'
          textosAbiertos.delete(chunk.id)
          return
        }
        case 'tool-input-start':
          actualizarHerramienta(chunk.toolCallId, chunk.toolName, { state: 'input-streaming', input: undefined })
          return
        case 'tool-input-available':
          actualizarHerramienta(chunk.toolCallId, chunk.toolName, { state: 'input-available', input: chunk.input })
          return
        case 'tool-input-error':
          // Herramienta estática: el cliente deja `input` vacío y lo crudo en `rawInput`.
          actualizarHerramienta(chunk.toolCallId, chunk.toolName, {
            state: 'output-error',
            input: undefined,
            rawInput: chunk.input,
            errorText: chunk.errorText,
          })
          return
        case 'tool-output-available':
          actualizarHerramienta(chunk.toolCallId, null, { state: 'output-available', output: chunk.output, errorText: undefined })
          return
        case 'tool-output-error':
          actualizarHerramienta(chunk.toolCallId, null, { state: 'output-error', errorText: chunk.errorText, output: undefined })
          return
        case 'tool-input-delta':
        case 'start':
        case 'finish':
        case 'message-metadata':
        case 'abort':
        case 'error':
        case 'reasoning-start':
        case 'reasoning-delta':
        case 'reasoning-end':
        case 'source-url':
        case 'source-document':
        case 'file':
          return
        default: {
          // data-*: los transient no entran al mensaje; los otros se agregan o
          // reemplazan a uno del mismo tipo con el mismo id.
          if (!chunk.type.startsWith('data-')) return
          const dato = chunk as { type: string; id?: string; data: unknown; transient?: boolean }
          if (dato.transient) return
          const existente =
            dato.id != null ? partes.find((p) => p.type === dato.type && p.id === dato.id) : undefined
          if (existente) existente.data = dato.data
          else partes.push({ type: dato.type, ...(dato.id != null ? { id: dato.id } : {}), data: dato.data })
        }
      }
    },

    cerrar(textoHerramientaCortada) {
      for (const p of partes) {
        if (p.type === 'text' && p.state !== 'done') p.state = 'done'
        if (p.type.startsWith('tool-') && p.state !== 'output-available' && p.state !== 'output-error') {
          p.state = 'output-error'
          p.errorText = textoHerramientaCortada
        }
      }
      textosAbiertos.clear()
    },

    partes() {
      return JSON.parse(JSON.stringify(partes)) as TexParte[]
    },

    texto() {
      return partes
        .filter((p) => p.type === 'text' && typeof p.text === 'string' && p.text.trim() !== '')
        .map((p) => (p.text as string).trim())
        .join('\n\n')
    },

    tieneContenido() {
      return partes.some(
        (p) => (p.type === 'text' && typeof p.text === 'string' && p.text.trim() !== '') || p.type.startsWith('tool-'),
      )
    },
  }
}
