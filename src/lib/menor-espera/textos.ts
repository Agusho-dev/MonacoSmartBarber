/**
 * Lo que se le contesta al cliente después de que toca un botón (o escribe
 * «sí»/«no»), según lo que hizo `menor_espera_responder`.
 *
 * Van como texto libre: la respuesta del cliente abrió la ventana de 24 h, así
 * que no hace falta plantilla ni cuesta nada. Cada texto dice lo que PASÓ en
 * la base, no lo que el cliente pidió: si la recepción ya lo había movido, el
 * «seguís esperando a Nico» sería mentira.
 */

import type { RespuestaRpc } from './tipos'
import { PLANTILLA_POR_DEFECTO } from './plantilla'

/** «Listo, Juan.» / «Listo.» — un nombre que no se pudo armar no rompe la frase. */
function conNombre(base: string, nombre: string | null | undefined, sufijo = '.'): string {
  return nombre ? `${base}, ${nombre}${sufijo}` : `${base}${sufijo}`
}

export const TEXTO_NO_VIGENTE =
  'Esta consulta ya no está vigente. Si seguís esperando en el local, avisale a la recepción.'

export const TEXTO_ERROR =
  'No pudimos cambiarte en este momento. Avisale a la recepción y lo resolvemos al toque.'

/** Tocó «No» y no pudimos registrarlo: no había nada que cambiar, y eso es lo que pasó. */
export const TEXTO_ERROR_NO =
  'No pudimos registrar tu respuesta, pero no cambia nada: seguís esperando como hasta ahora.'

/** El texto de error que corresponde a lo que pidió (sin saberlo, como si fuera «sí»). */
export function textoError(respuesta: 'si' | 'no' | null | undefined): string {
  return respuesta === 'no' ? TEXTO_ERROR_NO : TEXTO_ERROR
}

export function textoBaja(nombre: string | null | undefined): string {
  return `${conNombre('Listo', nombre)} No te vamos a mandar más estos avisos de la fila. Si alguna vez querés pasarte a Menor espera, pedíselo a la recepción.`
}

/**
 * Texto para un resultado de la RPC. `null` = no se contesta (teléfono que no
 * coincide o respuesta inválida: eso va al log y a la recepción, no al cliente).
 */
export function textoRespuesta(r: RespuestaRpc, botones: readonly string[] | null | undefined): string | null {
  const [botonSi, botonNo] = botones && botones.length >= 2 ? botones : PLANTILLA_POR_DEFECTO.botones
  const nombre = r.cliente ?? null
  const barbero = r.barbero || 'tu barbero'
  const actual = r.barbero_actual || 'un barbero'
  const sucursal = r.sucursal || 'la barbería'

  switch (r.resultado) {
    case 'movida':
      return `${conNombre('Listo', nombre)} Ya estás en Menor espera: te atiende el primer barbero que se libere y no perdiste tu lugar. Quedate cerca, que te llaman por tu nombre.`
    case 'ya_estaba_en_menor_espera':
      return `${conNombre('Ya estás en Menor espera', nombre)} Te atiende el primer barbero que se libere.`
    case 'rechazada':
      return `${conNombre('Perfecto', nombre)} Seguís esperando a ${barbero} y no perdiste tu lugar. Si cambiás de idea, tocá «${botonSi}» en el mensaje anterior.`
    case 'rechazada_en_menor_espera':
      return `${conNombre('Anotado', nombre)} Igual ya figurás en Menor espera, así que te atiende el primer barbero que se libere. Si preferís esperar a ${barbero}, avisale a la recepción.`
    case 'rechazada_otro_barbero':
      return `${conNombre('Anotado', nombre)} Ahora figurás esperando a ${actual}. Si querés cambiar algo, avisale a la recepción.`
    case 'ya_estaba_en_menor_espera_no':
      return `${conNombre('Ya te pasamos a Menor espera', nombre)} Si preferís volver a esperar a ${barbero}, avisale a la recepción.`
    case 'ya_lo_atienden':
      return nombre
        ? `Ya te está atendiendo ${actual}, ${nombre}. ¡Que lo disfrutes!`
        : `Ya te está atendiendo ${actual}. ¡Que lo disfrutes!`
    case 'ya_atendido':
      return `${conNombre('Tu atención de hoy ya terminó', nombre)} Gracias por venir a ${sucursal}.`
    case 'fuera_de_fila':
      return `Ya no figurás en la fila de ${sucursal}, así que no pudimos cambiarte. Si seguís en el local, avisale a la recepción y te ubicamos.`
    case 'es_turno':
      return nombre
        ? `Tenés un turno reservado, ${nombre}: te atiende ${actual} a la hora del turno. Si querés cambiar algo, avisale a la recepción.`
        : `Tenés un turno reservado: te atiende ${actual} a la hora del turno. Si querés cambiar algo, avisale a la recepción.`
    case 'prueba':
      return r.respuesta === 'no'
        ? `Esto fue una prueba. Cuando un cliente toca «${botonNo}», sigue esperando a su barbero y no cambia nada.`
        : `Esto fue una prueba: así le llega el aviso a tus clientes. Cuando un cliente toca «${botonSi}», lo pasamos a Menor espera sin que pierda su lugar.`
    case 'no_encontrada':
      return TEXTO_NO_VIGENTE
    case 'telefono_no_coincide':
    case 'invalida':
      return null
  }
}

// ── Alertas para la recepción (bandeja del CRM) ──────────────────────────────

export const ALERTA_RESPUESTA_LIBRE_TITULO = 'Respondió al aviso de Menor espera'

export function alertaRespuestaLibre(cliente: string | null | undefined, mensaje: string): string {
  const quien = cliente || 'El cliente'
  const cita = mensaje.trim() ? `«${mensaje.trim().slice(0, 300)}»` : 'un mensaje'
  return `${quien} escribió ${cita} después del aviso de Menor espera. Sigue esperando en la fila: contestale desde el inbox.`
}

export const ALERTA_ERROR_TITULO = 'No pudimos pasar a un cliente a Menor espera'

export function alertaError(cliente: string | null | undefined, motivo: string): string {
  return `No pudimos pasar a ${cliente || 'un cliente'} a Menor espera · ${motivo}. Revisalo en la fila.`
}

/**
 * Tocó uno de nuestros botones y no pudimos ni leer el aviso (la base no
 * contestó o el módulo no cargó): no se movió a nadie y una persona tiene que
 * verlo. `boton` es el texto que tocó, si se sabe.
 */
export function alertaErrorBoton(boton: string | null | undefined, motivo: string): string {
  const que = boton ? `tocó «${boton}»` : 'contestó'
  return `Un cliente ${que} en el aviso de Menor espera y no pudimos procesarlo (${motivo}). No se movió a nadie: revisalo en la fila y contestale desde el inbox.`
}

export const ALERTA_TELEFONO_TITULO = 'Respuesta al aviso de Menor espera desde otro teléfono'

export function alertaTelefono(telefono: string): string {
  return `Llegó una respuesta al aviso de Menor espera desde ${telefono}, que no es el teléfono de la ficha. No se movió a nadie.`
}

// Sin la firma de Meta verificada (mig 222) el corte no mueve a nadie ni
// registra bajas: sólo deja esto para la recepción. No se le contesta nada al
// teléfono del mensaje, porque no sabemos si lo mandó él.
export const ALERTA_SIN_VERIFICAR_TITULO = 'Respuesta al aviso de Menor espera sin verificar'

export function alertaSinVerificar(cliente: string | null | undefined, boton: string): string {
  return `${cliente || 'Un cliente'} tocó «${boton}» en el aviso de Menor espera, pero el mensaje no trajo la firma de Meta verificada, así que no hicimos nada. Si está en el local, resolvelo desde la fila.`
}

export function alertaBajaSinVerificar(cliente: string | null | undefined, mensaje: string): string {
  return `${cliente || 'Un cliente'} escribió «${mensaje.trim().slice(0, 200)}» después del aviso de Menor espera, pero el mensaje no trajo la firma de Meta verificada, así que no lo dimos de baja. Si corresponde, dalo de baja en Configuración → Menor espera por WhatsApp.`
}

export const ALERTA_BAJA_ERROR_TITULO = 'Un cliente pidió no recibir más avisos y no pudimos registrarlo'

export function alertaBajaError(mensaje: string): string {
  return `Escribió «${mensaje.slice(0, 200)}». Meta exige respetar los pedidos de baja: dalo de baja a mano en Configuración → Menor espera por WhatsApp.`
}
