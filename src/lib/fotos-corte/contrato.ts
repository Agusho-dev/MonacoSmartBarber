/**
 * Lo que se sumó al contrato de las fotos del corte después de la 219
 * (revisión adversarial, 219f/219g): acciones nuevas de la ruta de la tablet y
 * el estado ampliado de la página del celular. Sólo tipos y textos: lo
 * importan el store (navegador), la ruta, el servidor y el celular.
 *
 * Vive acá y no en src/lib/types/fotos-corte.ts para sumar sin tocar ese
 * archivo, que comparten otras áreas (el historial lo usa también).
 */

import type { EstadoFotosCelular, PedidoFotosDeEntrada, ResultadoFotos } from '@/lib/types/fotos-corte'

/** Cuerpo de POST /api/fotos-corte/entradas/[id], con las acciones nuevas. */
export type PedidoDeFotos =
  | PedidoFotosDeEntrada
  /**
   * Una foto que el barbero quitó DESPUÉS de subir los bytes y ANTES de
   * confirmarla: se borra el objeto de Storage (no se registra nunca). Si una
   * confirmación cortada llegó a registrarla, se quita como 'quitar'.
   */
  | { accion: 'descartar'; ruta: string }
  /**
   * Todas las fotos de un corte que se cierra SIN cobro (solo asesoría): las
   * que conoce la tablet y las que el celular haya subido sin que la tablet se
   * enterara. Nunca toca las de una visita (un cobro ya hecho lo rechaza).
   */
  | { accion: 'descartar_todo' }

/** Respuesta de 'descartar_todo': cuántas se quitaron y cuántas no se pudieron quitar. */
export type RespuestaDescartarFotos = ResultadoFotos<{ quitadas: number; fallidas: number }>

/** La página del celular: el estado de siempre, más CÓMO se cerró el corte. */
export type EstadoCelular = EstadoFotosCelular & {
  /**
   * El corte se cerró SIN visita (solo asesoría, o se canceló): no hay ficha
   * donde guardar fotos. Viene con `estado: 'cerrada'` y `aceptaFotos: false`.
   * No es lo mismo que "el código venció" (se arregla con otro QR) ni que
   * "¡Listo!" (las fotos quedaron en la ficha).
   */
  cerradaSinVisita: boolean
}

/** El corte se cerró sin cobro: lo que se dice en la tablet y en el celular. */
export const TEXTO_CERRADA_SIN_VISITA = 'Este corte se cerró sin fotos: ya no se pueden subir.'
