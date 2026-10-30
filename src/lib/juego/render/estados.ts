/**
 * Los estados del elenco nuevo sobre el luchador:
 *  - aturdido (el Bombo, el Grito): estrellas que giran sobre la cabeza.
 *  - mareado (el Trago): espirales arriba y vaivén del cuerpo (el vaivén va en dibujarLuchador).
 *  - quemado (el Termo): vapor que sale del cuerpo, alguna brasa y el tinte naranja.
 *  - lento (la nube): tinte verdoso y burbujas.
 *  - curando (la Curación de Fabri): aura verde, cruces que suben y un aro en el piso; el «+N»
 *    verde lo pone el evento `curacion` (textos.ts).
 *  - agarrado (Brian): el motor lo levanta (`y` > 0, anim 'danio'); acá tiembla, se aprieta y,
 *    cuando lo sueltan, el golpe contra el piso.
 *
 * Los tintes y el vaivén se aplican en luchadores.ts; acá van las partículas de cada cuadro y lo
 * que se dibuja encima de la cabeza. Todo lee `l.efectos` (ticks restantes) y `l.estado`.
 */
import type { LuchadorEstado } from '../tipos'
import { temblar } from './camara'
import { cuadroFx, dibujarFx, fx, FX_ESTRELLAS } from './efectos'
import { enMundo, spriteMundo, type Escena } from './escena'
import type { VisualLuchador } from './luchadores'
import {
  emitirBrillos,
  emitirBurbujas,
  emitirChispas,
  emitirCruces,
  emitirEstallido,
  emitirMechones,
  emitirNiebla,
  emitirPolvo,
  PAL_FUEGO,
} from './particulas'
import { azar, TAU } from './util'

function tasa(E: Escena, porSeg: number, dtS: number): number {
  const n = porSeg * E.densidad * dtS
  const entero = Math.floor(n)
  return entero + (Math.random() < n - entero ? 1 : 0)
}

/** Partículas de los estados en este cuadro, y el golpe al piso cuando sueltan al agarrado. */
export function emitirEstados(E: Escena, l: LuchadorEstado, v: VisualLuchador, dtMs: number): void {
  const dtS = dtMs / 1000
  const ef = l.efectos
  const cx = v.cajaX + v.cajaW / 2
  if (ef.quemado > 0) {
    // vapor que sale del cuerpo (más denso arriba)
    for (let n = tasa(E, 18, dtS); n > 0; n--) {
      emitirNiebla(E, v.cajaX + Math.random() * v.cajaW, v.cajaY + v.cajaH * azar(0.02, 0.55), azar(-15, 15), -azar(60, 120), azar(18, 28), azar(0.55, 0.85), 2)
    }
    if (Math.random() < dtS * 5 * E.densidad) {
      emitirChispas(E, v.cajaX + Math.random() * v.cajaW, v.cajaY + v.cajaH * azar(0.2, 0.8), 1, 0, 0.5, 60, 160, PAL_FUEGO, 1.6)
    }
  }
  if (ef.lento > 0) {
    for (let n = tasa(E, 6, dtS); n > 0; n--) emitirBurbujas(E, v.cajaX + Math.random() * v.cajaW, v.cajaY + v.cajaH * azar(0.3, 0.95), 1, 4)
  }
  if (ef.curando > 0) {
    for (let n = tasa(E, 4, dtS); n > 0; n--) emitirCruces(E, v.cajaX + Math.random() * v.cajaW, v.cajaY + v.cajaH * azar(0.2, 0.9), 1, 6)
    for (let n = tasa(E, 10, dtS); n > 0; n--) emitirBrillos(E, v.cajaX + Math.random() * v.cajaW, v.cajaY + v.cajaH * azar(0.1, 0.9), 1, 4, 4, 80)
  }
  // agarrado: temblequeo con chispitas del apretón; al soltarlo, el golpe contra el piso
  const agarrado = l.estado === 'agarrado'
  if (agarrado) {
    if (v.agarradoMs < 0) v.agarradoMs = 0
    v.agarradoMs += dtMs
    if (Math.random() < dtS * 7 * E.densidad) emitirBrillos(E, cx + azar(-20, 20), v.cajaY + v.cajaH * azar(0.25, 0.6), 1, 0, 6, 10)
  } else if (v.agarradoMs >= 0) {
    v.agarradoMs = -1
    const piso = E.sueloY
    emitirPolvo(E, l.x, piso, 16, 70, 1.6)
    emitirEstallido(E, l.x, piso - 20, 150, 0, 0.22)
    emitirMechones(E, l.x, v.cajaY + 30, 10, 0, 1)
    temblar(E.cam, 9)
  }
}

/** Estrellas del aturdido: el sprite animado del atlas compartido, o cuatro dibujadas. */
function estrellas(E: Escena, v: VisualLuchador, x: number, quedan: number): void {
  const alfa = quedan < 12 ? quedan / 12 : 1
  const anim = fx(E, FX_ESTRELLAS)
  if (anim) {
    dibujarFx(E, anim, cuadroFx(anim, E.ms, true), x, v.cajaY - 6, 1.6, 0, 1, alfa)
    E.ctx.imageSmoothingEnabled = true
  } else {
    const img = E.spr.estrella5[0]
    const cy = v.cajaY - 8
    for (let i = 0; i < 4; i++) {
      const ang = E.s * 5.5 + (i * TAU) / 4
      const prof = Math.sin(ang)
      const t = 22 * (0.78 + 0.28 * prof)
      spriteMundo(E, img, x + Math.cos(ang) * 38, cy + prof * 10, t, t, E.s * 6 + i, alfa * (0.55 + 0.45 * (prof * 0.5 + 0.5)))
    }
  }
  // un brillito que pasa por el medio
  E.ctx.globalCompositeOperation = 'lighter'
  spriteMundo(E, E.spr.estrella[1], x + Math.cos(E.s * 9) * 18, v.cajaY - 10, 14, 14, E.s * 4, 0.7 * alfa)
  E.ctx.globalCompositeOperation = 'source-over'
}

/** Dos espirales que giran al revés sobre la cabeza del mareado. */
function espirales(E: Escena, v: VisualLuchador, x: number, quedan: number): void {
  const alfa = quedan < 15 ? quedan / 15 : 1
  const img = E.util.de('espiral')
  const cy = v.cajaY - 10
  const meneo = Math.sin(E.s * 3.1) * 6
  spriteMundo(E, img, x - 15 + meneo, cy, 26, 26, E.s * 7, 0.95 * alfa)
  spriteMundo(E, img, x + 15 + meneo, cy - 2, 24, 24, -E.s * 8, 0.95 * alfa)
}

/** El aro verde de la curación en el piso, que late. */
export function aroCuracion(E: Escena, l: LuchadorEstado, v: VisualLuchador): void {
  const ctx = E.ctx
  const yPie = E.sueloY - l.y
  const pulso = 0.6 + 0.4 * Math.sin(E.s * 9)
  ctx.globalCompositeOperation = 'lighter'
  spriteMundo(E, E.spr.brillo('#4ADE80'), l.x, yPie, Math.max(120, v.cajaW * 1.5), 34, 0, 0.55 * pulso)
  enMundo(E)
  ctx.globalAlpha = 0.75 * pulso
  ctx.strokeStyle = '#86EFAC'
  ctx.lineWidth = 2.6
  ctx.beginPath()
  ctx.ellipse(l.x, yPie + 1, Math.max(56, v.cajaW * 0.6), 12, 0, 0, TAU)
  ctx.stroke()
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
}

/** Lo que va arriba de la cabeza (después del sprite). */
export function dibujarEstadosEncima(E: Escena, l: LuchadorEstado, v: VisualLuchador, x: number): void {
  const ef = l.efectos
  if (ef.aturdido > 0) estrellas(E, v, x, ef.aturdido)
  if (ef.mareado > 0) espirales(E, v, x, ef.mareado)
  E.ctx.globalAlpha = 1
}
