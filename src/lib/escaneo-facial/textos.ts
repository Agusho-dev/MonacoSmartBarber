/**
 * Lo que dice la pantalla del escáner en cada momento.
 *
 * Un texto por momento y una sola idea por texto: el que está frente a la
 * tablet lee de pasada, a un metro, mientras mira su propia cara. Por eso cada
 * guía dice QUÉ hacer ("Acercate un poco") y no qué pasa ("Rostro muy pequeño").
 */

import type { ErrorEscaner, EstadoVisible, Guia } from './tipos'

export interface TextoEscaner {
  titulo: string
  detalle?: string
}

/** Quién está frente a la cámara: cambia la salida que se le ofrece y cómo se lo saluda. */
export type QuienEscanea = 'cliente' | 'staff' | 'registro'

const GUIAS: Record<Guia, TextoEscaner> = {
  centrate: { titulo: 'Centrá tu cara', detalle: 'Ubicate justo frente a la tablet' },
  acercate: { titulo: 'Acercate un poco', detalle: 'Que tu cara llene el círculo' },
  alejate: { titulo: 'Alejate un poco', detalle: 'Estás muy cerca de la cámara' },
  de_frente: { titulo: 'Mirá de frente', detalle: 'Girá la cara hacia la cámara' },
  cabeza: { titulo: 'Mirá derecho a la cámara', detalle: 'Ni muy arriba ni muy abajo' },
  luz: { titulo: 'Falta un poco de luz', detalle: 'Acercate a la tablet: la pantalla te ilumina' },
  quieto: { titulo: 'Quedate quieto', detalle: 'Un segundo y listo' },
}

const ERRORES: Record<ErrorEscaner, string> = {
  permiso: 'La cámara no tiene permiso',
  sin_camara: 'No encontramos la cámara',
  camara_ocupada: 'La cámara está ocupada',
  modelos: 'No pudimos preparar el reconocimiento',
  motor: 'El reconocimiento se trabó',
}

const SALIDA: Record<QuienEscanea, string> = {
  cliente: 'Ingresá con tu teléfono',
  staff: 'Ingresá con tu PIN',
  registro: 'Podés seguir sin registrarla',
}

/**
 * "Nacho" de "nacho baldovino", "MARÍA JOSÉ" → "María", "Lucas. Vaccari" →
 * "Lucas". Para saludar se usa el primer nombre: el apellido suena a trámite.
 */
export function primerNombre(completo: string | null | undefined): string | undefined {
  const palabra = (completo ?? '').trim().split(/\s+/)[0]?.replace(/[^A-Za-zÀ-ÿ'’-]+$/, '')
  if (!palabra) return undefined
  return palabra.charAt(0).toLocaleUpperCase('es-AR') + palabra.slice(1).toLocaleLowerCase('es-AR')
}

export function textoEscaner(e: EstadoVisible, quien: QuienEscanea): TextoEscaner {
  switch (e.fase) {
    case 'preparando':
      return { titulo: 'Preparando la cámara…', detalle: 'Un segundo' }
    case 'buscando':
      return {
        titulo: 'Mirá a la cámara',
        detalle:
          quien === 'registro'
            ? 'Vamos a guardar tu cara'
            : quien === 'staff'
              ? 'Te identificamos para fichar'
              : 'Ubicá tu cara en el círculo',
      }
    case 'ajustando':
      return e.guia ? GUIAS[e.guia] : { titulo: 'Quedate quieto…', detalle: 'Ya casi' }
    case 'leyendo':
      return {
        titulo: 'Quedate quieto…',
        detalle: quien === 'registro' ? `Captura ${Math.min(e.muestras + 1, e.total)} de ${e.total}` : 'Leyendo tu cara',
      }
    case 'consultando':
      return quien === 'registro' ? { titulo: 'Guardando…', detalle: 'Un instante' } : { titulo: 'Buscándote…', detalle: 'Un instante' }
    case 'exito':
      if (quien === 'registro') {
        return { titulo: e.nombre ? `¡Listo, ${e.nombre}!` : '¡Listo!', detalle: 'La próxima te reconocemos al instante' }
      }
      return {
        titulo: e.nombre ? `¡Hola, ${e.nombre}!` : '¡Te encontramos!',
        detalle: quien === 'staff' ? 'Te reconocimos' : 'Te encontramos',
      }
    case 'reintento':
      return { titulo: 'Probemos otra vez', detalle: 'Mirá a la cámara sin moverte' }
    case 'fallo':
      if (quien === 'registro') {
        return { titulo: e.mensaje ?? 'No pudimos guardar tu cara', detalle: 'Probá de nuevo o seguí sin registrarla' }
      }
      return quien === 'staff'
        ? { titulo: 'No te reconocimos', detalle: SALIDA.staff }
        : { titulo: 'No te encontramos', detalle: 'Seguimos con tu teléfono' }
    case 'error':
      return { titulo: ERRORES[e.error ?? 'sin_camara'], detalle: SALIDA[quien] }
  }
}
