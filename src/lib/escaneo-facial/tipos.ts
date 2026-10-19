/**
 * Contrato del escáner facial del kiosko (sin React, sin DOM).
 *
 * El escáner hace dos trabajos con la misma pantalla:
 *   - `identificar`: lee la cara y pregunta a la base de quién es (check-in
 *     del cliente, fichaje del barbero).
 *   - `registrar`: lee la cara para guardarla (enrolamiento).
 *
 * Lo que el escáner NO decide es qué hacer con la lectura: se la pasa a quien
 * lo usa (`leer`), que contesta con un veredicto. Así la misma animación sirve
 * para buscar en clientes, en el staff o para guardar, sin que el motor sepa
 * de Supabase.
 */

export type ModoEscaner = 'identificar' | 'registrar'

/**
 * Momentos de la lectura, en el orden en que suelen pasar.
 *
 * - `preparando`: modelos y cámara cargando.
 * - `buscando`: la cámara anda y no hay ninguna cara.
 * - `ajustando`: hay una cara, pero todavía no sirve (lejos, girada, moviéndose…).
 * - `leyendo`: la cara sirve y se están tomando las muestras.
 * - `consultando`: las muestras están listas y se espera el veredicto.
 * - `exito` / `fallo`: terminó; después de la animación avisa con `terminar`.
 * - `reintento`: no coincidió y queda otro intento.
 * - `error`: sin cámara o sin modelos; la salida es el ingreso manual.
 */
export type FaseEscaner =
  | 'preparando'
  | 'buscando'
  | 'ajustando'
  | 'leyendo'
  | 'consultando'
  | 'exito'
  | 'reintento'
  | 'fallo'
  | 'error'

/** Lo que se le pide a la persona cuando la cara todavía no sirve. */
export type Guia = 'centrate' | 'acercate' | 'alejate' | 'de_frente' | 'cabeza' | 'luz' | 'quieto'

export type ErrorEscaner = 'permiso' | 'sin_camara' | 'camara_ocupada' | 'modelos' | 'motor'

/** Una lectura completa: varias muestras de la misma cara, tomadas en ~medio segundo. */
export interface LecturaFacial {
  /**
   * Promedio de las muestras. Es lo que se compara contra la base y lo que se
   * guarda: el ruido de un cuadro suelto (un parpadeo, un borroneo) se diluye.
   */
  descriptor: Float32Array
  /** Las muestras sueltas (el registro guarda las tres). */
  muestras: Float32Array[]
  /** Confianza del detector en la mejor muestra (0–1). */
  calidad: number
  /** Foto del mejor cuadro (WebP, 480 px de ancho). Se codifica una sola vez, al pedirla. */
  foto: () => Promise<Blob | null>
}

export type Veredicto =
  | { tipo: 'exito'; nombre?: string }
  /** No coincidió: si quedan intentos se vuelve a leer, si no termina en `fallo`. */
  | { tipo: 'reintento' }
  | { tipo: 'fallo'; mensaje?: string }

export interface ResultadoEscaner {
  tipo: 'exito' | 'fallo'
  lectura: LecturaFacial | null
}

/** Lo que la pantalla necesita para dibujar textos y botones. */
export interface EstadoVisible {
  fase: FaseEscaner
  guia: Guia | null
  /** Muestras tomadas en el intento actual. */
  muestras: number
  /** Muestras que hacen falta por intento. */
  total: number
  /** Intento actual (empieza en 1). */
  intento: number
  /** La cámara ya está mostrando imagen (puede pasar antes de que carguen los modelos). */
  camara: boolean
  /** Nombre que devolvió el veredicto de éxito. */
  nombre?: string
  error?: ErrorEscaner
  /** Mensaje que devolvió un veredicto de fallo. */
  mensaje?: string
}
