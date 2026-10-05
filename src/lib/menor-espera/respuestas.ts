/**
 * Qué quiso decir el cliente cuando ESCRIBIÓ en vez de tocar un botón.
 *
 * Se compara el mensaje ENTERO, normalizado, contra listas cerradas: nada de
 * "contiene". Un «sí» suelto es inequívoco; «sí, pero tengo que irme a las 6»
 * no lo es y va a la recepción como respuesta libre. Equivocarse acá mueve a
 * alguien de fila sin que lo haya pedido, así que ante la duda no se interpreta.
 *
 * Además, el webhook sólo interpreta un «sí»/«no» si la oferta está abierta, salió
 * hace menos de 30 minutos y el último mensaje que le mandamos ES la plantilla
 * (migración 218, `menor_espera_contexto`). Un pedido de baja vale de quien
 * recibió un aviso en los últimos 30 días, aunque ya no espere (mig 222).
 */

import { normalizarTexto, PLANTILLA_POR_DEFECTO } from './plantilla'

const SI = new Set([
  'si', 'sii', 'siii', 'sip', 'si dale', 'dale', 'dale si', 'ok', 'oka', 'okey', 'okay',
  'de una', 'si de una', 'pasame', 'pasarme', 'si pasame', 'si pasarme',
  'si por favor', 'si porfa', 'si gracias', 'dale gracias', 'si quiero',
])

const NO = new Set([
  'no', 'noo', 'nop', 'no gracias', 'sigo esperando', 'no sigo esperando',
  'prefiero esperar', 'no prefiero esperar', 'espero', 'no quiero', 'no no',
])

/**
 * Pedidos de baja. Meta exige respetarlos; también acá, mensaje entero: «no
 * quiero mensajes de promociones pero sí del turno» no es una baja. Lo único
 * que se tolera son cortesías al principio o al final («hola», «por favor»,
 * «gracias»): la lista sigue siendo cerrada y lo dudoso va a la recepción.
 * Ojo: «no quiero» a secas es un «no» a la oferta, no una baja.
 */
const BAJA = new Set([
  'baja', 'la baja', 'dar de baja', 'darme de baja', 'dame de baja', 'denme de baja',
  'quiero la baja', 'quiero darme de baja', 'pido la baja', 'solicito la baja',
  'stop', 'desuscribir', 'desuscribirme', 'unsubscribe',
  'no me escriban', 'no me escriban mas', 'no me escribas', 'no me escribas mas',
  'no me manden', 'no me manden mas', 'no me manden mensajes', 'no me manden mas mensajes',
  'no me mandes mas', 'no me mandes mensajes', 'no me mandes mas mensajes',
  'no me envien mas', 'no me envien mensajes', 'no me envien mas mensajes',
  'no quiero mensajes', 'no quiero mas mensajes', 'no quiero recibir mensajes',
  'no quiero recibir mas mensajes', 'no quiero recibir mas', 'no quiero recibir estos mensajes',
  'no quiero que me escriban', 'no quiero que me escriban mas',
  'no quiero que me manden mensajes', 'no quiero que me manden mas mensajes',
  'dejen de escribirme', 'dejen de mandarme', 'dejen de mandarme mensajes',
  'dejen de enviarme', 'dejen de enviarme mensajes', 'deja de escribirme', 'deja de mandarme mensajes',
  'dejen de molestar', 'dejen de molestarme', 'no me molesten', 'no me molesten mas',
  'sacame de la lista', 'saquenme de la lista', 'borrame de la lista', 'borrenme de la lista',
])

/** Cortesías que no cambian el pedido. Las frases largas van antes que sus finales. */
const CORTESIA_INICIO = [
  'buenos dias', 'buenas tardes', 'buenas noches', 'buen dia', 'buenas', 'hola',
  'disculpen', 'disculpa', 'perdon', 'por favor', 'porfavor', 'porfa',
]
const CORTESIA_FIN = [
  'desde ya muchas gracias', 'desde ya gracias', 'muchas gracias', 'mil gracias', 'gracias',
  'por favor', 'porfavor', 'porfa', 'x favor', 'xfavor', 'xfa', 'please', 'plis', 'pls', 'saludos',
]

/** El texto normalizado sin cortesías al principio ni al final («hola, baja por favor» → «baja»). */
function sinCortesias(normalizado: string): string {
  let t = normalizado
  let cambio = true
  while (cambio && t) {
    cambio = false
    for (const c of CORTESIA_INICIO) {
      if (t.startsWith(c + ' ')) {
        t = t.slice(c.length + 1).trim()
        cambio = true
      }
    }
    for (const c of CORTESIA_FIN) {
      if (t.endsWith(' ' + c)) {
        t = t.slice(0, -(c.length + 1)).trim()
        cambio = true
      }
    }
  }
  return t
}

export function interpretarTexto(
  texto: string | null | undefined,
  botones: readonly string[] | null | undefined,
): 'si' | 'no' | null {
  const n = normalizarTexto(texto)
  if (!n) return null
  const [si, no] = botones && botones.length >= 2 ? botones : PLANTILLA_POR_DEFECTO.botones
  if (SI.has(n) || n === normalizarTexto(si)) return 'si'
  if (NO.has(n) || n === normalizarTexto(no)) return 'no'
  return null
}

export function esPedidoDeBaja(texto: string | null | undefined): boolean {
  const n = normalizarTexto(texto)
  return n !== '' && (BAJA.has(n) || BAJA.has(sinCortesias(n)))
}

/**
 * Un «gracias» (o un emoji suelto) DESPUÉS de que ya le contestamos. No pide
 * nada: avisarle a la recepción por eso es ruido, y la Bienvenida sería peor.
 */
const CORTESIA = new Set([
  'gracias', 'muchas gracias', 'mil gracias', 'graciass', 'grax', 'gracias genio', 'gracias capo',
  'genial', 'perfecto', 'buenisimo', 'joya', 'barbaro', 'listo', 'ok', 'oka', 'okey', 'okay',
  'dale', 'dale gracias', 'ok gracias', 'listo gracias', 'perfecto gracias', 'genial gracias',
])

export function esCortesia(texto: string | null | undefined): boolean {
  const n = normalizarTexto(texto)
  // Sólo emojis o signos («👍», «🙏🙏», «!!») también es cortesía.
  return n === '' ? (texto ?? '').trim() !== '' : CORTESIA.has(n)
}
