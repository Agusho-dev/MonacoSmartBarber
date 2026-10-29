/**
 * Lo que comparten todas las piezas del render en un cuadro, y dos ayudas de dibujo que usan
 * todas. Sólo tipos y funciones puras sobre el contexto: nada se crea por cuadro.
 */
import type { Camara } from './camara'
import type { EfectosComunes } from './efectos'
import type { Particulas, Tajos } from './particulas'
import type { Sprites } from './sprites'

export type Calidad = 'alta' | 'media' | 'baja'

export interface Escena {
  ctx: CanvasRenderingContext2D
  cam: Camara
  calidad: Calidad
  /** Multiplica las cantidades de partículas (alta 1, media 0,6, baja 0,35). */
  densidad: number
  parts: Particulas
  tajos: Tajos
  spr: Sprites
  /** Atlas de efectos compartidos (pixel art); null = todo procedural. */
  fx: EfectosComunes | null
  /** ms reales desde que se creó el renderizador (corren aunque el motor esté en hitstop). */
  ms: number
  /** Lo mismo en segundos. */
  s: number
  /** Línea del piso en y de mundo-pantalla (hacia abajo). */
  sueloY: number
  familias: { titulo: string; numeros: string }
  /** Agranda los textos chicos (daño, combo) en lienzos angostos. */
  escalaTextos: number
}

/** Dibuja `img` centrado en (x, y) de mundo, con tamaño (w, h) de mundo, rotado. */
export function spriteMundo(
  E: Escena,
  img: CanvasImageSource,
  x: number,
  y: number,
  w: number,
  h: number,
  rot: number,
  alfa: number,
): void {
  const k = E.cam.esc
  const ctx = E.ctx
  // brillos, nubes y estrellas son suaves: nunca heredan el «nítido» del pixel art
  ctx.imageSmoothingEnabled = true
  if (rot === 0) {
    ctx.setTransform(k, 0, 0, k, E.cam.tx + k * x, E.cam.ty + k * y)
  } else {
    const c = Math.cos(rot) * k
    const s = Math.sin(rot) * k
    ctx.setTransform(c, s, -s, c, E.cam.tx + k * x, E.cam.ty + k * y)
  }
  ctx.globalAlpha = alfa
  ctx.drawImage(img, -w / 2, -h / 2, w, h)
}

/** Deja el contexto con la transformación de la cámara (para dibujar caminos en mundo). */
export function enMundo(E: Escena): void {
  E.ctx.setTransform(E.cam.esc, 0, 0, E.cam.esc, E.cam.tx, E.cam.ty)
}

/** Camino de un rectángulo con esquinas redondeadas (sin depender de roundRect). */
export function caminoRedondeado(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}
