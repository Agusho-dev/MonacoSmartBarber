/**
 * Cámara del render: lleva el mundo lógico de 960×540 al lienzo real.
 *
 * - El ancho del escenario (0..960) entra SIEMPRE completo con zoom 1: los luchadores pelean de
 *   borde a borde. Si el lienzo es más ancho que 16:9 se recorta techo (y un poco de piso); si es
 *   más alto, la imagen de la arena se agranda alrededor del punto del piso para cubrirlo.
 * - Zoom dinámico (1,0–1,1 según la distancia, más algunos momentos de cámara), temblor por
 *   evento y «golpe de zoom». El temblor agranda un poco el encuadre (sobrebarrido) para no
 *   mostrar nunca el borde de la imagen.
 */
import { VISTA_ALTO, VISTA_ANCHO } from '../tipos'
import { acotar, suavizar, TAU } from './util'

export interface Camara {
  /** Tamaño del lienzo en px de dispositivo. */
  anchoPx: number
  altoPx: number
  /** px de dispositivo por unidad de mundo con zoom 1 (también la escala de la capa de pantalla). */
  base: number
  /** Alto visible en unidades de mundo con zoom 1 (540 en un lienzo 16:9). */
  altoVista: number
  sueloY: number
  /** Rectángulo de la imagen de la arena, en unidades de mundo. */
  imgX: number
  imgY: number
  imgW: number
  imgH: number
  /** Dónde cae el piso dentro de la vista (0 arriba, 1 abajo); se conserva con el zoom. */
  pisoRel: number
  zoom: number
  centroX: number
  golpe: number
  temblor: number
  temblorTau: number
  temblorReloj: number
  dirX: number
  dirY: number
  /** Transformación del cuadro: dispositivo = mundo * esc + (tx, ty). */
  esc: number
  tx: number
  ty: number
  izq: number
  arriba: number
  anchoVis: number
  altoVis: number
}

export function crearCamara(suelo: number): Camara {
  const sueloY = acotar(suelo, 0.3, 1) * VISTA_ALTO
  return {
    anchoPx: 0,
    altoPx: 0,
    base: 1,
    altoVista: VISTA_ALTO,
    sueloY,
    imgX: 0,
    imgY: 0,
    imgW: VISTA_ANCHO,
    imgH: VISTA_ALTO,
    pisoRel: sueloY / VISTA_ALTO,
    zoom: 1.12,
    centroX: VISTA_ANCHO / 2,
    golpe: 0,
    temblor: 0,
    temblorTau: 0.1,
    temblorReloj: 0,
    dirX: 0,
    dirY: 0,
    esc: 1,
    tx: 0,
    ty: 0,
    izq: 0,
    arriba: 0,
    anchoVis: VISTA_ANCHO,
    altoVis: VISTA_ALTO,
  }
}

/** Recalcula el encuadre base para un lienzo nuevo (rotación, cambio de tamaño). */
export function ajustarCamara(c: Camara, anchoPx: number, altoPx: number, aspectoImagen: number): void {
  c.anchoPx = anchoPx
  c.altoPx = altoPx
  c.base = anchoPx / VISTA_ANCHO
  c.altoVista = altoPx / c.base
  const aspecto = aspectoImagen > 0.2 && aspectoImagen < 5 ? aspectoImagen : VISTA_ANCHO / VISTA_ALTO
  // rectángulo natural de la imagen: alto 540 (así `suelo` es exacto), centrada en x
  const imgW0 = VISTA_ALTO * aspecto
  let k = 1
  if (imgW0 < VISTA_ANCHO) k = VISTA_ANCHO / imgW0
  if (c.altoVista > VISTA_ALTO * k) k = c.altoVista / VISTA_ALTO
  // se agranda alrededor del punto del piso para que los pies sigan pisando lo mismo
  const px = VISTA_ANCHO / 2
  const py = c.sueloY
  c.imgX = px + (px - imgW0 / 2 - px) * k
  c.imgY = py + (0 - py) * k
  c.imgW = imgW0 * k
  c.imgH = VISTA_ALTO * k
  let arriba0: number
  if (c.altoVista <= VISTA_ALTO) {
    // más ancho que 16:9: se recorta más techo que piso
    arriba0 = (VISTA_ALTO - c.altoVista) * 0.6
  } else {
    // más alto: el piso queda en la misma proporción que en la imagen
    arriba0 = c.sueloY - ((c.sueloY - c.imgY) / c.imgH) * c.altoVista
  }
  arriba0 = acotar(arriba0, c.imgY, c.imgY + c.imgH - c.altoVista)
  c.pisoRel = (c.sueloY - arriba0) / c.altoVista
}

/** Sacude la cámara (px de mundo). Golpes seguidos suman un poco, sin descontrolarse. */
export function temblar(c: Camara, intensidad: number): void {
  if (intensidad <= 0) return
  if (intensidad >= c.temblor) {
    c.temblor = intensidad
    c.temblorTau = 0.05 + intensidad * 0.013
    c.temblorReloj = 0
  } else {
    c.temblor = Math.min(18, c.temblor + intensidad * 0.3)
  }
}

/** «Golpe de zoom»: acerca un instante y vuelve solo. */
export function empujarZoom(c: Camara, cantidad: number): void {
  if (cantidad > c.golpe) c.golpe = cantidad
}

export function actualizarCamara(c: Camara, dtS: number, objetivoX: number, objetivoZoom: number, rapidez: number): void {
  c.zoom = suavizar(c.zoom, objetivoZoom, 3 * rapidez, dtS)
  c.centroX = suavizar(c.centroX, objetivoX, 4.2 * rapidez, dtS)
  c.golpe = suavizar(c.golpe, 0, 9, dtS)
  if (c.temblor > 0) {
    c.temblor *= Math.exp(-dtS / c.temblorTau)
    if (c.temblor < 0.08) c.temblor = 0
    c.temblorReloj -= dtS
    if (c.temblorReloj <= 0) {
      // cambia de dirección ~35 veces por segundo, igual a 60 o a 120 Hz
      c.temblorReloj = 0.028
      const a = Math.random() * TAU
      c.dirX = Math.cos(a)
      c.dirY = Math.sin(a) * 0.75
    }
  }
  const m = c.temblor
  let z = c.zoom * (1 + c.golpe)
  z *= 1 + (2.2 * m) / Math.min(VISTA_ANCHO, c.altoVista)
  const visW = VISTA_ANCHO / z
  const visH = c.altoVista / z
  const minX = Math.max(0, c.imgX)
  const maxX = Math.min(VISTA_ANCHO, c.imgX + c.imgW)
  const cx = acotar(c.centroX, minX + visW / 2 + m, maxX - visW / 2 - m)
  const arriba = acotar(c.sueloY - c.pisoRel * visH, c.imgY + m, c.imgY + c.imgH - visH - m)
  c.izq = cx - visW / 2 + c.dirX * m
  c.arriba = arriba + c.dirY * m
  c.anchoVis = visW
  c.altoVis = visH
  c.esc = c.base * z
  c.tx = -c.izq * c.esc
  c.ty = -c.arriba * c.esc
}
