import 'server-only'

// =============================================================================
// src/lib/tex/turno.ts
// Un turno de Tex de punta a punta, adentro del `execute` del UI-message-stream:
// arma system + herramientas, corre el motor, pone el título (primer turno),
// GUARDA y recién después cierra el stream.
//
// POR QUÉ SE GUARDA ANTES DEL `finish` (y del chunk `error`)
// ---------------------------------------------------------
// Con el turno ya terminado en la pantalla, la persona puede tocar "Volver a
// generar" o mandar otra pregunta al instante. Si el guardado llegara después,
// ese pedido nuevo leería un historial sin la respuesta y la fila llegaría
// tarde, desordenada. Cuando la persona se fue (Detener), el guardado corre
// igual: la ruta registra el turno con `after()` para que la función no se
// congele a mitad de camino.
//
// Nunca tira: cualquier falla termina en un chunk `error` con {codigo, mensaje}
// (lo lee `leerErrorTex` en el cliente). El motor tampoco tira: un error a mitad
// de camino vuelve con lo que ya se vio y lo que se consumió, y se guarda.
//
// QUÉ CUENTA EN EL TOPE DEL MES Y QUÉ DEJA FILA
// - Un turno cortado ANTES de cualquier salida del modelo (Detener al instante,
//   o el browser que se fue mientras la ruta preparaba el turno) no descuenta
//   del tope: no hubo respuesta. Si además no consumió ni un token, tampoco deja
//   fila: no pasó nada que guardar, y el "Reintentar" corre de nuevo desde la
//   pregunta, que ya está guardada.
// - Un error sin nada a la vista no deja fila ni cuenta (el reintento vuelve a
//   correr desde la pregunta).
// - Una respuesta cuya pregunta se cortó mientras el turno corría (un "Volver a
//   generar" o un reintento) se descarta al guardar (`guardarTurnoAsistente`).
// =============================================================================

import { createHash } from 'node:crypto'
import type Anthropic from '@anthropic-ai/sdk'
import type { UIMessageStreamWriter } from 'ai'
import { incrementUsage } from '@/lib/actions/entitlements'
import { auditAssistant } from '@/lib/asistente/context'
import { crearClienteTex } from './cliente'
import { puedeConfigurarTex, type TexConfigOrg } from './contexto'
import type { TexErrorRespuesta, TexUIMessage, TexUso } from './contrato'
import { sumarUsos } from './costo'
import { definicionesParaClaude, herramientasDisponibles } from './herramientas'
import type { TexContexto } from './herramientas/tipos'
import { guardarTurnoAsistente, tocarConversacion, type PreguntaDelTurno } from './historial'
import { mensajesParaPersistir, TEXTO_CANCELADO } from './historial-puro'
import { correrMotor, resumirError } from './motor'
import { crearArmadorDePartes, type TexChunk } from './partes'
import { armarSystemTex } from './prompt'
import { generarTituloTex } from './titulo'

export interface EntradaTurnoTex {
  writer: UIMessageStreamWriter<TexUIMessage>
  ctx: TexContexto
  config: TexConfigOrg
  clave: string
  conversacionId: string
  /** El id del mensaje del asistente: va en el chunk `start` y es el id de la fila. */
  idAsistente: string
  mensajes: Anthropic.MessageParam[]
  historialRecortado: boolean
  debeTitular: boolean
  textoUsuario: string
  /** El `req.signal`: el Detener del browser. */
  signal: AbortSignal
  /**
   * La fila guardada de la pregunta de este turno: la respuesta se guarda sólo si sigue
   * siendo ésa (un reintento o un "Volver a generar" la corta y la vuelve a guardar).
   */
  pregunta?: PreguntaDelTurno
}

const ERROR_GENERICO: TexErrorRespuesta = { codigo: 'error', mensaje: 'Tex no pudo terminar la respuesta. Probá de nuevo.' }

function tokensDe(u: TexUso): number {
  return u.entrada + u.salida + u.cacheLeido + u.cacheEscrito
}

/** Opaco para `metadata.user_id` de Anthropic (detección de abuso): ni nombre ni mail. */
function usuarioOpaco(ctx: Pick<TexContexto, 'orgId' | 'userId'>): string {
  return createHash('sha256').update(`${ctx.orgId}:${ctx.userId}`).digest('hex').slice(0, 32)
}

export async function correrTurnoTex(e: EntradaTurnoTex): Promise<void> {
  const armador = crearArmadorDePartes()
  const escribir = (chunk: TexChunk) => {
    e.writer.write(chunk)
    armador.aplicar(chunk)
  }
  let errorEnviado = false
  const enviarError = (error: TexErrorRespuesta) => {
    if (errorEnviado) return
    errorEnviado = true
    // Fatal en el cliente: useChat pasa a 'error' y `leerErrorTex` parsea este JSON.
    e.writer.write({ type: 'error', errorText: JSON.stringify(error) })
  }

  // `start` con el id explícito: `createUIMessageStream` sólo inyecta el suyo si falta,
  // y con éste se guarda la fila (el regenerate del browser lo manda de vuelta).
  escribir({ type: 'start', messageId: e.idAsistente, messageMetadata: { conversacionId: e.conversacionId, creadoEn: Date.now() } })

  try {
    const cliente = crearClienteTex(e.clave)
    const herramientas = herramientasDisponibles(e.ctx)
    const definiciones = definicionesParaClaude(herramientas)
    const system = armarSystemTex({
      ctx: e.ctx,
      persona: e.config.persona,
      instrucciones: e.config.instrucciones,
      herramientas: herramientas.map((h) => h.nombre),
    })
    // El título corre en paralelo: depende sólo del primer mensaje.
    const promesaTitulo = e.debeTitular ? generarTituloTex(cliente, e.textoUsuario, e.signal) : null

    const r = await correrMotor({
      cliente,
      escribir,
      system,
      herramientas,
      definiciones,
      esfuerzo: e.config.esfuerzo,
      mensajes: e.mensajes,
      ctx: e.ctx,
      signal: e.signal,
      usuarioOpaco: usuarioOpaco(e.ctx),
      puedeConfigurar: puedeConfigurarTex(e.ctx),
      auditar: (evento) => {
        void auditAssistant({ orgId: e.ctx.orgId, userId: e.ctx.userId }, evento)
      },
    })
    // La hora del turno es la de su final, no la del guardado (ver historial.ts).
    const terminadoEn = new Date().toISOString()
    armador.cerrar(r.motivo === 'interrumpido' ? TEXTO_CANCELADO : 'No se completó.')

    let uso = r.uso
    let titulo: string | null = null
    if (promesaTitulo && !r.error) {
      const t = await promesaTitulo
      titulo = t.titulo
      if (t.uso) uso = sumarUsos(uso, t.uso)
      escribir({ type: 'data-titulo', data: { titulo } })
    }

    // ¿El modelo llegó a responder algo? Texto o herramientas a la vista, o tokens de salida
    // (el pensamiento también es salida). Un turno cortado antes de eso no descuenta del tope.
    const huboSalida = armador.tieneContenido() || r.uso.salida > 0
    const cortadoSinSalida = r.motivo === 'interrumpido' && !huboSalida
    // Cortado sin salida y sin un solo token consumido: no pasó nada que guardar.
    const nadaQueGuardar = cortadoSinSalida && tokensDe(uso) === 0

    // Un error fatal sin nada a la vista no deja fila: el reintento vuelve a correr
    // desde el mensaje del usuario, que ya está guardado.
    if ((!r.error || armador.tieneContenido()) && !nadaQueGuardar) {
      if (r.error) {
        // Sólo en lo guardado: al reabrir la conversación se ve por qué quedó a medias.
        armador.aplicar({ type: 'data-aviso', data: { codigo: 'error', texto: r.error.mensaje } })
      }
      try {
        const resultado = await guardarTurnoAsistente(
          e.ctx,
          e.conversacionId,
          {
            id: e.idAsistente,
            texto: armador.texto(),
            partes: armador.partes(),
            modelMessages: mensajesParaPersistir(r.turno, r.motivo),
            uso,
            creadoEn: terminadoEn,
          },
          { pregunta: e.pregunta },
        )
        if (resultado === 'descartada') {
          console.warn('[tex] respuesta descartada: su pregunta se cortó (reintento o volver a generar) mientras el turno corría')
        }
      } catch (err) {
        console.error('[tex]', resumirError(err))
        // Known Risk #13: un fallo que se loguea y no se dice es un bug invisible.
        if (!r.error) {
          escribir({
            type: 'data-aviso',
            data: { codigo: 'error', texto: 'No pude guardar esta respuesta: si volvés a abrir la conversación, no va a aparecer.' },
          })
        }
      }
    }
    try {
      await tocarConversacion(e.ctx, e.conversacionId, { titulo })
    } catch (err) {
      console.error('[tex]', resumirError(err))
    }

    if (r.error) {
      enviarError(r.error)
      return
    }

    if (!cortadoSinSalida) {
      try {
        await incrementUsage('ai_messages', 1, e.ctx.orgId)
      } catch (err) {
        console.error('[tex] sumando el uso del mes:', resumirError(err))
      }
    }
    escribir({ type: 'message-metadata', messageMetadata: { uso, historialRecortado: e.historialRecortado } })
    escribir({ type: 'finish', finishReason: r.finishReason })
  } catch (err) {
    console.error('[tex] el turno falló:', resumirError(err))
    enviarError(ERROR_GENERICO)
  }
}
