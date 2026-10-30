/**
 * Los especiales del elenco nuevo en pantalla (los de Simón y Chipi siguen en eventos.ts):
 *  - `rasgoEspecial`: el destello propio de cada uno al arrancar (sale con el super flash).
 *  - `impactoEspecial`: lo que pasa en cada cuadro de impacto del atlas (el tajo de la navaja, el
 *    puño sísmico que hace temblar la cámara, el fuego de la patada del dragón…).
 *  - `especialContinuo`: lo que sueltan mientras dura la animación (el humo de la moto, las notas
 *    del cuarteto, las llamas del dragón, los brillos del break).
 *  - `dibujarEspecialVisual`: lo que se dibuja encima del luchador (el remolino de la chilena, el
 *    aro del break, las líneas de velocidad de la moto, el foco del baile).
 *
 * Lo que traen las hojas (la moto, el bombo, la víctima de Brian) es del atlas: acá no se
 * compensa. Todas las cantidades pasan por la densidad de la calidad.
 */
import type { IconoEspecial, LuchadorEstado } from '../tipos'
import { empujarZoom, temblar } from './camara'
import { enMundo, spriteMundo, type Escena } from './escena'
import type { VisualLuchador } from './luchadores'
import {
  emitirAnillo,
  emitirBrillos,
  emitirChispas,
  emitirCruces,
  emitirEstallido,
  emitirLlamas,
  emitirMoscas,
  emitirNiebla,
  emitirNotas,
  emitirPolvo,
  emitirSalpicadura,
  emitirTrozos,
  G_LECHE,
  G_PINTURA,
  G_TRAGO,
  G_YERBA,
  P_BRILLO,
  PAL_AZUL,
  PAL_BLANCO,
  PAL_FUEGO,
  PAL_MAGENTA,
  PAL_ORO,
  PAL_ROJO,
  PAL_TIERRA,
  PAL_VERDE,
  PAL_VIOLETA,
} from './particulas'
import { azar, TAU } from './util'

/** Los especiales que dejan post-imágenes del color del barbero mientras se mueven. */
export const ICONOS_ESTELA: ReadonlySet<IconoEspecial> = new Set<IconoEspecial>([
  'rayo',
  'moto',
  'break',
  'dragon',
  'chilena',
  'baile',
  'navaja',
])

/** Puntos del cuerpo en mundo-pantalla (del último cuadro dibujado). */
const PT = { manoX: 0, manoY: 0, pieY: 0, cabezaY: 0, cx: 0, cy: 0, h: 205 }

function puntos(E: Escena, l: LuchadorEstado, v: VisualLuchador): void {
  const h = v.at ? v.at.ficha.alturaMundo : 205
  PT.h = h
  PT.pieY = E.sueloY - l.y
  PT.manoX = l.x + l.mira * 52
  PT.manoY = PT.pieY - h * 0.58
  PT.cabezaY = v.cajaY + 18
  PT.cx = v.cajaW > 0 ? v.cajaX + v.cajaW / 2 : l.x
  PT.cy = v.cajaH > 0 ? v.cajaY + v.cajaH * 0.45 : PT.pieY - h * 0.5
}

/** Un destello grande de 4 puntas (variante: 0 blanco, 1 oro, 2 celeste, 3 violeta, 4 verde, 5 magenta, 6 rojo). */
function destello(E: Escena, x: number, y: number, tam: number, variante: number): void {
  const P = E.parts
  const i = P.nueva(P_BRILLO, x, y, 0.32)
  if (i < 0) return
  P.tam[i] = tam
  P.variante[i] = variante
  P.rot[i] = azar(0, 0.5)
}

function tasa(E: Escena, porSeg: number, dtS: number): number {
  const n = porSeg * E.densidad * dtS
  const entero = Math.floor(n)
  return entero + (Math.random() < n - entero ? 1 : 0)
}

/** El rasgo propio de cada especial al arrancar (el super flash ya oscureció y tiró rayos). */
export function rasgoEspecial(E: Escena, l: LuchadorEstado, v: VisualLuchador, icono: IconoEspecial): void {
  puntos(E, l, v)
  const m = l.mira
  const { manoX, manoY, pieY, cabezaY, cx, cy } = PT
  switch (icono) {
    case 'bombo':
      emitirAnillo(E, manoX, manoY, 14, 86, 0.3, PAL_AZUL, 6)
      emitirAnillo(E, manoX, manoY, 8, 62, 0.26, PAL_ORO, 4)
      emitirBrillos(E, manoX, manoY, 6, 1, 30, 70)
      break
    case 'navaja':
      destello(E, manoX, manoY, 70, 0)
      emitirChispas(E, manoX, manoY, 6, m, 0.4, 200, 480, PAL_BLANCO, 1.6)
      break
    case 'cura':
      emitirAnillo(E, cx, pieY - 4, 20, 110, 0.4, PAL_VERDE, 5)
      emitirBrillos(E, cx, cy, 8, 4, 50, 90)
      emitirCruces(E, cx, cy, 4, 40)
      break
    case 'guante':
      emitirEstallido(E, manoX, manoY, 100, 0, 0.2)
      emitirLlamas(E, manoX, manoY, 10, 0, -120, 30, 14)
      break
    case 'moto':
      for (let i = 0; i < 8; i++) emitirNiebla(E, l.x - m * 40, pieY - 30, -m * azar(60, 200), -azar(10, 60), azar(16, 26), 0.7, 3)
      emitirPolvo(E, l.x, pieY, 8, 36, 1.2, -m)
      destello(E, l.x - m * 30, pieY - 40, 54, 6)
      break
    case 'pistola':
      destello(E, manoX + m * 10, manoY, 56, 1)
      emitirNiebla(E, manoX, manoY, m * 30, -30, 14, 0.5, 3)
      break
    case 'break':
      emitirAnillo(E, l.x, pieY - 6, 16, 100, 0.34, PAL_VIOLETA, 6)
      emitirBrillos(E, cx, cy, 8, 3, 50, 60)
      break
    case 'graffiti':
      emitirSalpicadura(E, manoX, manoY, 14, G_PINTURA, -Math.PI / 2, 1.3, 120, 320, 1.2)
      for (let i = 0; i < 3; i++) emitirNiebla(E, manoX, manoY, m * azar(30, 120), -azar(10, 50), 22, 0.6, 5)
      break
    case 'trago':
      emitirSalpicadura(E, manoX, manoY, 10, G_TRAGO, -Math.PI / 2, 0.9, 90, 240, 1)
      destello(E, manoX, manoY - 10, 44, 3)
      break
    case 'botella':
      for (let i = 0; i < 3; i++) destello(E, manoX + azar(-30, 30), manoY + azar(-60, 10), 30 + i * 8, 1)
      emitirBrillos(E, manoX, manoY, 5, 1, 30, 60)
      break
    case 'baile':
      emitirNotas(E, cx, cy, 6, 60, 120, 24)
      emitirAnillo(E, l.x, pieY - 6, 16, 110, 0.36, PAL_MAGENTA, 6)
      break
    case 'grito': {
      const bocaY = v.cajaY + v.cajaH * 0.16
      emitirAnillo(E, l.x + m * 18, bocaY, 10, 96, 0.34, PAL_MAGENTA, 7)
      emitirNotas(E, l.x + m * 30, bocaY, 4, 30, 120, 24)
      break
    }
    case 'gorro':
      emitirAnillo(E, l.x, cabezaY, 10, 70, 0.28, PAL_ROJO, 5)
      emitirBrillos(E, l.x, cabezaY, 6, 6, 30, 50)
      break
    case 'dragon':
      emitirLlamas(E, cx, pieY - 20, 14, 0, -160, 34, 40)
      emitirEstallido(E, l.x, pieY - 30, 120, 0, 0.22)
      break
    case 'pelota':
      emitirAnillo(E, l.x + m * 30, pieY - 8, 12, 80, 0.3, PAL_AZUL, 5)
      emitirBrillos(E, l.x + m * 30, pieY - 30, 6, 2, 30, 60)
      break
    case 'chilena':
      emitirAnillo(E, cx, cy, 20, 120, 0.36, PAL_AZUL, 7)
      emitirBrillos(E, cx, cy, 8, 2, 60, 40)
      break
    case 'mamadera':
      emitirSalpicadura(E, manoX, manoY, 10, G_LECHE, -Math.PI / 2, 1, 90, 240, 1)
      destello(E, manoX, manoY, 40, 0)
      break
    case 'panal':
      for (let i = 0; i < 6; i++) emitirNiebla(E, manoX + azar(-20, 20), manoY, azar(-60, 60), -azar(10, 60), 22, 0.7, 4)
      emitirMoscas(E, manoX, manoY - 20, 3, 1.3)
      break
    case 'mate':
      for (let i = 0; i < 4; i++) emitirNiebla(E, manoX, manoY - 10, azar(-20, 20), -azar(40, 90), 18, 0.8, 2)
      emitirSalpicadura(E, manoX, manoY, 8, G_YERBA, -Math.PI / 2, 1, 70, 200, 0.9)
      break
    case 'termo':
      for (let i = 0; i < 5; i++) emitirNiebla(E, manoX + m * azar(0, 40), manoY + azar(-6, 10), m * azar(20, 70), -azar(40, 90), azar(14, 20), 0.75, 2)
      break
    case 'agarre':
      for (let i = 0; i < 2; i++) destello(E, manoX + azar(-14, 14), manoY + azar(-20, 20), 36, 1)
      emitirAnillo(E, manoX, manoY, 8, 54, 0.24, PAL_FUEGO, 4)
      emitirPolvo(E, l.x, pieY, 6, 30, 1)
      break
    case 'sismo':
      emitirPolvo(E, l.x, pieY, 10, 50, 1.3)
      emitirTrozos(E, l.x + m * 30, pieY - 4, 3, 0, 0.7)
      temblar(E.cam, 4)
      break
    default:
      break
  }
}

/**
 * Un cuadro de impacto del atlas de un especial del elenco. `k` = cuál de los impactos de la
 * animación (el break tiene varios). Devuelve false si el icono no es del elenco nuevo.
 */
export function impactoEspecial(E: Escena, l: LuchadorEstado, v: VisualLuchador, icono: IconoEspecial, k: number): boolean {
  puntos(E, l, v)
  const T = E.tajos
  const m = l.mira
  const { manoX, manoY, pieY, h } = PT
  switch (icono) {
    case 'bombo':
      emitirAnillo(E, manoX, manoY, 10, 70, 0.26, PAL_AZUL, 5)
      emitirAnillo(E, manoX, manoY, 6, 50, 0.22, PAL_ORO, 4)
      emitirBrillos(E, manoX, manoY, 5, 1, 24, 60)
      temblar(E.cam, 3)
      return true
    case 'navaja':
      // el tajo de la navaja: largo, fino y plateado
      T.nuevo(l.x + m * 8, pieY - h * 0.6, 96, -1.15, 0.8, 15, 150, m, '#EAF2FF')
      T.nuevo(l.x + m * 12, pieY - h * 0.56, 76, -0.95, 0.55, 6, 190, m, '#FFFFFF')
      destello(E, manoX + m * 24, manoY, 46, 0)
      emitirChispas(E, manoX + m * 20, manoY, 8, m, 0.5, 220, 560, PAL_BLANCO, 1.6)
      return true
    case 'cura':
      emitirBrillos(E, PT.cx, PT.cy, 6, 4, 40, 80)
      return true
    case 'guante':
      T.nuevo(l.x, pieY - h * 0.58, 100, -1.0, 0.7, 22, 220, m, '#FF6A1A')
      emitirLlamas(E, manoX + m * 30, manoY, 14, m * 160, -80, 32, 16)
      emitirEstallido(E, manoX + m * 40, manoY, 130, 0, 0.22)
      temblar(E.cam, 6)
      empujarZoom(E.cam, 0.02)
      return true
    case 'moto':
      emitirPolvo(E, l.x, pieY, 10, 40, 1.3, -m)
      emitirChispas(E, l.x + m * 40, pieY - 10, 6, m, 0.6, 160, 380, PAL_FUEGO)
      return true
    case 'pistola':
      return true
    case 'break': {
      const cy = pieY - h * 0.38
      const arriba = k % 2 === 0
      T.nuevo(l.x, cy, 82, arriba ? -2.6 : 0.4, arriba ? -0.4 : 2.6, 14, 190, m, '#C084FC')
      emitirBrillos(E, l.x + m * 50, cy, 3, 3, 20, 40)
      emitirChispas(E, l.x + m * 60, cy, 5, m, 0.8, 160, 420, PAL_VIOLETA, 2)
      return true
    }
    case 'graffiti':
      emitirSalpicadura(E, manoX, manoY, 10, G_PINTURA, m > 0 ? -0.3 : Math.PI + 0.3, 0.6, 160, 380, 1)
      return true
    case 'trago':
      emitirSalpicadura(E, manoX, manoY, 8, G_TRAGO, m > 0 ? -0.6 : Math.PI + 0.6, 0.6, 120, 300, 1)
      return true
    case 'botella':
      emitirBrillos(E, manoX, manoY, 4, 1, 20, 50)
      return true
    case 'baile':
      // el remate del paso: un golpe de energía que empuja lejos
      T.nuevo(l.x + m * 4, pieY - h * 0.5, 88, -0.9, 0.9, 18, 210, m, '#E879F9')
      emitirAnillo(E, manoX + m * 20, manoY, 10, 96, 0.3, PAL_MAGENTA, 7)
      emitirNotas(E, manoX, manoY, 5, 30, 140, 24)
      temblar(E.cam, 5)
      return true
    case 'grito': {
      const bocaY = v.cajaY + v.cajaH * 0.16
      emitirAnillo(E, l.x + m * 20, bocaY, 10, 80, 0.3, PAL_MAGENTA, 6)
      emitirNotas(E, l.x + m * 30, bocaY, 3, 24, 120, 22)
      return true
    }
    case 'gorro':
      T.nuevo(l.x, PT.cabezaY, 60, -2.2, -0.6, 10, 170, m, '#FF3B30')
      emitirBrillos(E, l.x + m * 30, PT.cabezaY, 4, 6, 20, 40)
      return true
    case 'dragon': {
      const pieX = l.x + m * 60
      const pieAlto = pieY - h * 0.45
      T.nuevo(l.x, pieY - h * 0.5, 98, -1.3, 1.0, 22, 230, m, '#FF7A1A')
      T.nuevo(l.x, pieY - h * 0.5, 82, -1.1, 0.8, 8, 260, m, '#FFE08A')
      emitirLlamas(E, pieX, pieAlto, 14, m * 180, -60, 34, 18)
      emitirEstallido(E, pieX, pieAlto, 110, 0, 0.2)
      temblar(E.cam, 5)
      return true
    }
    case 'pelota':
      emitirPolvo(E, l.x + m * 40, pieY, 4, 20, 0.9, m)
      emitirAnillo(E, l.x + m * 50, pieY - 20, 8, 50, 0.22, PAL_AZUL, 4)
      return true
    case 'chilena':
      // la chilena remata de arriba hacia abajo
      T.nuevo(l.x, pieY - h * 0.5, 92, -1.9, 1.1, 18, 230, m, '#60A5FA')
      T.nuevo(l.x, pieY - h * 0.5, 74, -1.7, 0.9, 7, 260, m, '#FFFFFF')
      emitirChispas(E, l.x + m * 60, pieY - h * 0.3, 10, m, 0.8, 200, 500, PAL_AZUL)
      emitirBrillos(E, l.x + m * 40, pieY - h * 0.5, 4, 2, 30, 40)
      temblar(E.cam, 5)
      return true
    case 'mamadera':
      emitirSalpicadura(E, manoX, manoY, 8, G_LECHE, m > 0 ? -0.2 : Math.PI + 0.2, 0.5, 120, 300, 1)
      return true
    case 'panal':
      for (let i = 0; i < 4; i++) emitirNiebla(E, manoX, manoY, m * azar(20, 80), -azar(10, 40), 18, 0.5, 4)
      return true
    case 'mate':
      emitirSalpicadura(E, manoX, manoY, 6, G_YERBA, -Math.PI / 2, 0.9, 60, 180, 0.9)
      return true
    case 'termo':
      for (let i = 0; i < 6; i++) emitirNiebla(E, manoX + m * 10, manoY, m * azar(20, 90), -azar(30, 90), 18, 0.7, 2)
      return true
    case 'agarre':
      for (let i = 0; i < 2; i++) destello(E, manoX + m * 10 + azar(-10, 10), manoY + azar(-16, 16), 34, 0)
      emitirPolvo(E, l.x + m * 30, pieY, 4, 24, 0.9)
      temblar(E.cam, 3)
      return true
    case 'sismo': {
      // el puño al piso: la cámara tiembla fuerte
      const x = l.x + m * 46
      temblar(E.cam, 13)
      empujarZoom(E.cam, 0.03)
      emitirPolvo(E, x, pieY, 16, 70, 1.6)
      emitirTrozos(E, x, pieY - 6, 10, 0, 1.1)
      emitirAnillo(E, x, pieY - 4, 10, 120, 0.34, PAL_TIERRA, 7)
      emitirEstallido(E, x, pieY - 10, 130, 0, 0.2)
      return true
    }
    default:
      return false
  }
}

/** Lo que sueltan mientras dura la animación del especial (llamado cada cuadro). */
export function especialContinuo(E: Escena, l: LuchadorEstado, v: VisualLuchador, icono: IconoEspecial, dtS: number): void {
  const m = l.mira
  const velX = Math.abs(l.vx)
  switch (icono) {
    case 'moto': {
      if (velX < 2) break
      puntos(E, l, v)
      const atras = l.x - m * v.cajaW * 0.42
      for (let n = tasa(E, 34, dtS); n > 0; n--) {
        emitirNiebla(E, atras, PT.pieY - azar(18, 44), -m * azar(60, 180), -azar(10, 40), azar(14, 22), azar(0.4, 0.75), 3)
      }
      for (let n = tasa(E, 16, dtS); n > 0; n--) emitirPolvo(E, atras, PT.pieY, 1, 12, 0.9, -m)
      if (Math.random() < dtS * 6 * E.densidad) emitirChispas(E, atras, PT.pieY - 4, 2, -m, 0.5, 120, 300, PAL_FUEGO, 1.6)
      break
    }
    case 'break':
      puntos(E, l, v)
      for (let n = tasa(E, 14, dtS); n > 0; n--) emitirBrillos(E, PT.cx + azar(-1, 1) * v.cajaW * 0.6, PT.cy + azar(-0.6, 0.6) * v.cajaH * 0.5, 1, 3, 4, 30)
      if (Math.random() < dtS * 8 * E.densidad) emitirPolvo(E, l.x, PT.pieY, 1, 30, 0.8)
      break
    case 'baile':
      puntos(E, l, v)
      for (let n = tasa(E, 6, dtS); n > 0; n--) emitirNotas(E, PT.cx, PT.cy - 20, 1, v.cajaW * 0.6, 90, 22)
      break
    case 'dragon': {
      puntos(E, l, v)
      const pieX = l.x + m * v.cajaW * 0.4
      const pieAlto = PT.pieY - PT.h * 0.45
      for (let n = tasa(E, 50, dtS); n > 0; n--) emitirLlamas(E, pieX, pieAlto, 1, -m * azar(40, 140), -azar(30, 90), 26, 14)
      if (Math.random() < dtS * 10 * E.densidad) emitirChispas(E, pieX, pieAlto, 2, -m, 0.8, 100, 300, PAL_FUEGO, 1.8)
      break
    }
    case 'chilena':
      puntos(E, l, v)
      for (let n = tasa(E, 12, dtS); n > 0; n--) emitirBrillos(E, PT.cx + azar(-1, 1) * v.cajaW * 0.6, PT.cy + azar(-0.6, 0.6) * v.cajaH * 0.5, 1, 2, 4, 20)
      break
    case 'navaja':
      puntos(E, l, v)
      if (Math.random() < dtS * 6 * E.densidad) emitirBrillos(E, PT.manoX, PT.manoY, 1, 0, 8, 20)
      break
    case 'guante':
      puntos(E, l, v)
      for (let n = tasa(E, 24, dtS); n > 0; n--) emitirLlamas(E, PT.manoX, PT.manoY, 1, 0, -90, 18, 10)
      break
    case 'cura':
      puntos(E, l, v)
      if (Math.random() < dtS * 8 * E.densidad) emitirBrillos(E, PT.cx + azar(-1, 1) * v.cajaW * 0.5, PT.cy + azar(-0.5, 0.5) * v.cajaH * 0.5, 1, 4, 4, 70)
      break
    case 'grito': {
      const bocaY = v.cajaY + v.cajaH * 0.16
      for (let n = tasa(E, 4, dtS); n > 0; n--) emitirNotas(E, l.x + m * 30, bocaY, 1, 20, 100, 20)
      break
    }
    default:
      break
  }
}

/** Lo que se dibuja ENCIMA del luchador mientras dura el especial. */
export function dibujarEspecialVisual(E: Escena, l: LuchadorEstado, v: VisualLuchador, icono: IconoEspecial): void {
  const ctx = E.ctx
  const yPie = E.sueloY - l.y
  switch (icono) {
    case 'chilena': {
      // remolino azul alrededor del cuerpo
      const cx = v.cajaX + v.cajaW / 2
      const cy = v.cajaY + v.cajaH * 0.5
      const rx = Math.max(60, v.cajaW * 0.72)
      const ry = Math.max(70, v.cajaH * 0.46)
      enMundo(E)
      ctx.globalCompositeOperation = 'lighter'
      ctx.lineCap = 'round'
      const giro = E.s * 15 * (l.mira < 0 ? -1 : 1)
      for (let j = 0; j < 3; j++) {
        const a0 = giro + (j * TAU) / 3
        ctx.globalAlpha = 0.7
        ctx.strokeStyle = '#60A5FA'
        ctx.lineWidth = 7
        ctx.beginPath()
        ctx.ellipse(cx, cy, rx, ry, 0.5, a0, a0 + 1.2)
        ctx.stroke()
        ctx.globalAlpha = 0.95
        ctx.strokeStyle = '#E0F2FE'
        ctx.lineWidth = 2
        ctx.stroke()
      }
      ctx.globalCompositeOperation = 'source-over'
      break
    }
    case 'break': {
      // aro de luz en el piso que gira con el molino
      enMundo(E)
      ctx.globalCompositeOperation = 'lighter'
      ctx.lineCap = 'round'
      const giro = E.s * 12
      for (let j = 0; j < 2; j++) {
        ctx.globalAlpha = 0.8
        ctx.strokeStyle = j === 0 ? '#C084FC' : '#22D3EE'
        ctx.lineWidth = 4
        ctx.beginPath()
        ctx.ellipse(l.x, yPie + 2, 78, 15, 0, giro + j * Math.PI, giro + j * Math.PI + 2.2)
        ctx.stroke()
      }
      spriteMundo(E, E.spr.brillo('#A855F7'), l.x, yPie, 200, 40, 0, 0.35)
      ctx.globalCompositeOperation = 'source-over'
      break
    }
    case 'moto': {
      if (Math.abs(l.vx) < 2) break
      // líneas de velocidad detrás de la moto
      const m = l.mira
      const atras = l.x - m * v.cajaW * 0.45
      enMundo(E)
      ctx.globalCompositeOperation = 'lighter'
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'
      ctx.lineWidth = 2.2
      ctx.lineCap = 'round'
      ctx.globalAlpha = 0.85
      ctx.beginPath()
      for (let i = 0; i < 6; i++) {
        const oy = v.cajaY + v.cajaH * (0.15 + i * 0.14)
        const largo = 50 + ((i * 41 + Math.floor(E.ms / 45)) % 4) * 22
        ctx.moveTo(atras - m * (i % 2) * 10, oy)
        ctx.lineTo(atras - m * (largo + (i % 2) * 10), oy)
      }
      ctx.stroke()
      ctx.globalCompositeOperation = 'source-over'
      break
    }
    case 'baile': {
      // el foco del boliche bajo los pies, al ritmo
      const pulso = 0.55 + 0.45 * Math.abs(Math.sin(E.s * Math.PI * 2.2))
      ctx.globalCompositeOperation = 'lighter'
      spriteMundo(E, E.spr.brillo('#D946EF'), l.x, yPie + 2, 190 * pulso + 40, 38, 0, 0.55 * pulso)
      spriteMundo(E, E.spr.brillo('#8B5CF6'), l.x, v.cajaY + v.cajaH * 0.5, v.cajaW * 1.6, v.cajaH * 1.1, 0, 0.18 * pulso)
      ctx.globalCompositeOperation = 'source-over'
      break
    }
    case 'dragon':
      ctx.globalCompositeOperation = 'lighter'
      spriteMundo(E, E.spr.brillo('#FF7A1A'), v.cajaX + v.cajaW / 2, v.cajaY + v.cajaH * 0.5, v.cajaW * 1.8, v.cajaH * 1.2, 0, 0.32)
      ctx.globalCompositeOperation = 'source-over'
      break
    case 'guante': {
      const m = l.mira
      const pulso = 0.6 + 0.4 * Math.sin(E.s * 18)
      ctx.globalCompositeOperation = 'lighter'
      spriteMundo(E, E.spr.brillo('#FF5A1F'), l.x + m * 52, yPie - (v.at?.ficha.alturaMundo ?? 205) * 0.58, 120, 120, 0, 0.5 * pulso)
      ctx.globalCompositeOperation = 'source-over'
      break
    }
    default:
      break
  }
  ctx.globalAlpha = 1
}
