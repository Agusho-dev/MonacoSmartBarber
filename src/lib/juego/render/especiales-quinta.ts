/**
 * Los especiales, los estados y las pasivas de la quinta tanda (14/nov) en pantalla: Chino, Fran,
 * Lautaro, Leo y los dueños (Nacho, Nehuen, Nico M. y Tony). Los proyectiles van en arsenal-quinta.ts.
 *
 *  - `rasgoQuinta`: el destello propio de cada especial al arrancar (sale con el super flash, en la
 *    capa de partículas que queda ENCIMA del oscurecido).
 *  - `impactoQuinta`: lo que pasa en el cuadro de impacto del atlas (el aplastón del Gigante, los tajos
 *    azules del Corte de Precisión, el arco del monopatín revoleado…).
 *  - `actualizarQuinta`: una vez por cuadro, con los dos luchadores: los relojes de cada efecto (el
 *    dominio, el reaparecer de Nehuen, el arrodillado del Despido, el revoleado, el «pop» del que se
 *    despierta de la hipnosis…), el cuadro forzado del arrodillado y las partículas que sueltan.
 *  - `pisoQuinta` (DETRÁS del luchador) y `dibujarEncimaQuinta` (ENCIMA): el anillo de cartas del All
 *    In (la mitad de atrás y la de adelante), el aura de la Presencia de jefe, el brillo del Overclock,
 *    el código que corre por el piso, los anillos de la Orden Final, la tijera de Fran, el papel del
 *    despido, el arco del Smash, el brazo de código de Nacho, la espiral del hipnotizado, la nube del
 *    cegado, las lágrimas y el «!!» del arrodillado y las líneas del fade del Corte de Precisión.
 *
 * Los ticks de cada cosa salen del kit (kit.ts → motor/movimientos.ts); los ms son de pantalla (lo que
 * dura un destello, no la mecánica). Todas las cantidades pasan por la densidad de la calidad. Nada de
 * filtros ni sombras del canvas: los tintes van precalculados en luchadores.ts.
 */
import type { IconoEspecial, LuchadorEstado, Partida } from '../tipos'
import { objeto } from './arsenal'
import { codigoEnElPiso } from './arsenal-quinta'
import { empujarZoom, temblar } from './camara'
import { enMundo, spriteMundo, type Escena } from './escena'
import { especialDe, especialEnCurso, pasivaDe } from './kit'
import { contexto, crearLienzo, liberarLienzo } from './lienzo'
import type { AtlasPreparado, VisualLuchador } from './luchadores'
import {
  emitirAnillo,
  emitirBrillos,
  emitirChispas,
  emitirEstallido,
  emitirNiebla,
  emitirObjetos,
  emitirPolvo,
  emitirTrozos,
  P_BRILLO,
  PAL_AZUL,
  PAL_BLANCO,
  PAL_HIELO,
  PAL_ORO,
  PAL_ROJO,
  PAL_TIERRA,
  PAL_VIOLETA,
  TROZO_DIGITO,
  TROZO_DIGITO_ROJO,
  TROZO_LAGRIMA,
  TROZO_NAIPE,
  TROZO_NAIPE_VIOLETA,
  TROZO_PUA,
  TROZO_ROCA_CIAN,
} from './particulas'
import { buscarEfecto } from './proyectiles'
import { acotar, azar, mezcla, salidaConRebote, salidaCubica, suavizar, TAU } from './util'

/** Variantes de los destellos de 4 puntas (Sprites.estrella) y de los estallidos (Sprites.estallido). */
const D_BLANCO = 0
const D_ORO = 1
const D_CELESTE = 2
const D_VIOLETA = 3
const D_VERDE = 4
const D_ROJO = 6
export const ESTALLIDO_ROJO = 7
export const ESTALLIDO_CIAN = 8

/** Cuánto duran los efectos de pantalla de la tanda (ms reales). */
export const MS_CLONES = 760
const MS = {
  clones: MS_CLONES,
  reaparecer: 520,
  precision: 700,
  glitch: 320,
  exclamacion: 950,
} as const

// ─── Puntos del cuerpo ───────────────────────────────────────────────────────

const PT = { pie: 0, h: 205, cx: 0, frente: 0, manoX: 0, manoY: 0, cabezaY: 0, ojosY: 0, cinturaY: 0 }

function puntos(E: Escena, l: LuchadorEstado, v: VisualLuchador): void {
  const h = v.at ? v.at.ficha.alturaMundo : 205
  PT.h = h
  PT.pie = E.sueloY - l.y
  PT.cx = v.cajaW > 0 ? v.cajaX + v.cajaW / 2 : l.x
  PT.frente = v.cajaW > 0 ? (l.mira > 0 ? v.cajaX + v.cajaW : v.cajaX) : l.x + l.mira * 40
  PT.manoX = l.x + l.mira * 52
  PT.manoY = PT.pie - h * 0.58
  PT.cabezaY = v.cajaH > 0 ? v.cajaY + v.cajaH * 0.08 : PT.pie - h * 0.92
  PT.ojosY = v.cajaH > 0 ? v.cajaY + v.cajaH * 0.11 : PT.pie - h * 0.88
  PT.cinturaY = PT.pie - h * 0.46
}

/** Un destello grande de 4 puntas (en la capa con la que nacen las partículas). */
function destello(E: Escena, x: number, y: number, tam: number, variante: number, vida = 0.32): void {
  const P = E.parts
  const i = P.nueva(P_BRILLO, x, y, vida)
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

// ─── El rasgo de cada especial (con el super flash) ──────────────────────────

/** Devuelve false si el ícono no es de la quinta tanda. */
export function rasgoQuinta(E: Escena, l: LuchadorEstado, v: VisualLuchador, icono: IconoEspecial): boolean {
  puntos(E, l, v)
  const m = l.mira
  const { manoX, manoY, pie, cx, h } = PT
  switch (icono) {
    case 'cartas':
      // abanico de destellos rojos en la mano
      for (let i = 0; i < 5; i++) {
        const a = -1.05 + i * 0.36
        destello(E, manoX + m * Math.cos(a) * 34, manoY + Math.sin(a) * 34, 30 + (i % 2) * 10, D_ROJO)
      }
      emitirChispas(E, manoX, manoY, 8, m, 0.7, 160, 380, PAL_ROJO, 1.8)
      return true
    case 'dominio':
      emitirAnillo(E, l.x, PT.cinturaY, 12, 96, 0.36, PAL_VIOLETA, 6)
      emitirObjetos(E, l.x, PT.cinturaY, 6, TROZO_NAIPE_VIOLETA, 0, -60, 150, -40, 18, 0.7)
      destello(E, l.x, PT.cinturaY, 60, D_VIOLETA)
      return true
    case 'lentes':
      // los lentes destellan violeta y blanco; atrás aparecen los clones fantasma
      destello(E, l.x + m * 10, PT.ojosY, 66, D_VIOLETA, 0.4)
      destello(E, l.x + m * 14, PT.ojosY, 38, D_BLANCO, 0.3)
      v.clonesMs = 0
      return true
    case 'corte':
      destello(E, PT.frente, manoY, 58, D_CELESTE)
      emitirChispas(E, PT.frente, manoY, 8, m, 0.5, 200, 460, PAL_AZUL, 1.6)
      return true
    case 'gigante':
      emitirAnillo(E, l.x, pie - 6, 16, 140, 0.4, PAL_AZUL, 7)
      emitirChispas(E, cx, pie - h * 0.5, 12, 0, Math.PI, 160, 460, PAL_AZUL, 2)
      empujarZoom(E.cam, 0.02)
      return true
    case 'lanzamiento':
      emitirAnillo(E, manoX, manoY, 8, 64, 0.26, PAL_BLANCO, 4)
      emitirPolvo(E, l.x, pie, 6, 30, 1)
      return true
    case 'herramientas':
      for (let i = 0; i < 3; i++) destello(E, l.x + m * azar(-10, 30), pie - h * azar(0.35, 0.6), 30 + i * 6, D_BLANCO)
      emitirChispas(E, manoX, manoY, 6, m, 0.6, 140, 320, PAL_BLANCO, 1.4)
      return true
    case 'aerosol':
      destello(E, manoX, manoY, 44, D_BLANCO)
      for (let i = 0; i < 3; i++) emitirNiebla(E, manoX, manoY, m * azar(20, 70), -azar(10, 40), 18, 0.5, 1)
      return true
    case 'ejecucion':
      // la mano se vuelve código
      emitirObjetos(E, manoX, manoY, 12, TROZO_DIGITO, 0, -50, 120, -80, 14, 0.8)
      destello(E, manoX, manoY, 52, D_CELESTE)
      return true
    case 'codigo':
      emitirObjetos(E, cx, pie - h * 0.4, 14, TROZO_DIGITO, 0, -90, 140, -70, 14, 0.9)
      emitirAnillo(E, l.x + m * 30, pie - 4, 10, 110, 0.34, PAL_HIELO, 5)
      return true
    case 'fantasma':
      emitirAnillo(E, cx, pie - h * 0.5, 14, 100, 0.34, PAL_AZUL, 6)
      destello(E, cx, pie - h * 0.55, 64, D_CELESTE)
      for (let i = 0; i < 4; i++) emitirNiebla(E, cx + azar(-30, 30), pie - h * azar(0.2, 0.8), azar(-30, 30), -azar(10, 40), 20, 0.5, 2)
      return true
    case 'padel':
      emitirAnillo(E, manoX, manoY - 20, 10, 70, 0.28, PAL_AZUL, 5)
      destello(E, manoX, manoY - 20, 40, D_VERDE)
      return true
    case 'orden':
      destello(E, PT.frente + m * 6, manoY, 70, D_ORO, 0.42)
      emitirBrillos(E, PT.frente, manoY, 6, 1, 20, 60)
      return true
    case 'espinas':
      emitirAnillo(E, l.x, PT.cabezaY, 10, 80, 0.3, PAL_ORO, 5)
      destello(E, l.x, PT.cabezaY - 6, 60, D_ORO, 0.4)
      emitirChispas(E, l.x, PT.cabezaY, 10, 0, Math.PI, 160, 420, PAL_ORO, 1.6)
      return true
    case 'monopatin':
      emitirChispas(E, manoX, manoY + 20, 10, m, 0.9, 140, 380, PAL_AZUL, 1.8)
      destello(E, manoX, manoY + 20, 46, D_CELESTE)
      return true
    case 'despido':
      emitirBrillos(E, cx, pie - h * 0.3, 10, D_ORO, h * 0.35, 220)
      emitirAnillo(E, l.x, pie - 6, 14, 110, 0.36, PAL_ORO, 6)
      return true
    default:
      return false
  }
}

// ─── El cuadro de impacto del atlas ──────────────────────────────────────────

/** Devuelve false si el ícono no es de la quinta tanda. */
export function impactoQuinta(E: Escena, l: LuchadorEstado, v: VisualLuchador, icono: IconoEspecial, k: number): boolean {
  puntos(E, l, v)
  const T = E.tajos
  const m = l.mira
  const { manoX, manoY, pie, h } = PT
  switch (icono) {
    case 'cartas':
      destello(E, manoX + m * 10, manoY, 50, D_ROJO)
      emitirChispas(E, manoX, manoY, 6, m, 0.5, 200, 420, PAL_ROJO, 1.6)
      return true
    case 'dominio':
      if (v.contraOk) {
        T.nuevo(l.x, pie - h * 0.5, 96, -1.1, 0.8, 20, 220, m, '#A78BFA')
        destello(E, l.x + m * 40, pie - h * 0.5, 56, D_VIOLETA)
      } else emitirPolvo(E, l.x, pie, 5, 24, 0.9, -m)
      return true
    case 'lentes':
      destello(E, l.x + m * 12, PT.ojosY, 58, D_VIOLETA, 0.36)
      destello(E, l.x + m * 16, PT.ojosY, 30, D_BLANCO, 0.26)
      return true
    case 'corte': {
      // la estocada: tres tajos azules largos y el destello en la punta
      const y = pie - h * 0.6
      T.nuevo(l.x + m * 8, y, 118, -0.42, 0.3, 13, 180, m, '#38BDF8')
      T.nuevo(l.x + m * 10, y + 4, 104, -0.22, 0.16, 6, 210, m, '#E0F2FE')
      T.nuevo(l.x + m * 4, y - 8, 92, -0.62, 0.42, 8, 200, m, '#7DD3FC')
      destello(E, l.x + m * 150, y, 50, D_CELESTE)
      emitirChispas(E, l.x + m * 140, y, 8, m, 0.4, 220, 520, PAL_AZUL, 1.5)
      return true
    }
    case 'gigante': {
      // el aplastón: temblor fuerte, el anillo de polvo y piedras
      const x = l.x + m * 72
      temblar(E.cam, 15)
      empujarZoom(E.cam, 0.04)
      emitirPolvo(E, x, pie, 18, 90, 1.7)
      emitirTrozos(E, x, pie - 6, 10, 0, 1.15)
      emitirAnillo(E, x, pie - 4, 12, 150, 0.38, PAL_TIERRA, 8)
      emitirEstallido(E, x, pie - 16, 150, 1, 0.22)
      return true
    }
    case 'lanzamiento':
      emitirAnillo(E, manoX + m * 20, manoY - 20, 8, 56, 0.24, PAL_BLANCO, 4)
      if (k > 0) emitirPolvo(E, l.x, pie, 6, 30, 1)
      return true
    case 'herramientas':
      destello(E, manoX + m * 16, manoY, 40, D_BLANCO)
      emitirChispas(E, manoX + m * 10, manoY, 5, m, 0.5, 160, 360, PAL_BLANCO, 1.4)
      return true
    case 'aerosol':
      for (let i = 0; i < 4; i++) emitirNiebla(E, manoX + m * 20, manoY, m * azar(40, 120), azar(-30, 20), 20, 0.5, 1)
      destello(E, manoX + m * 16, manoY, 40, D_BLANCO)
      return true
    case 'ejecucion':
      destello(E, manoX + m * 30, manoY, 50, D_CELESTE)
      emitirObjetos(E, manoX + m * 30, manoY, 6, TROZO_DIGITO, m * 60, -40, 80, -60, 13, 0.6)
      return true
    case 'codigo': {
      // las dos manos al piso: de ahí sale el código
      const x = l.x + m * 34
      temblar(E.cam, 6)
      emitirAnillo(E, x, pie - 4, 10, 120, 0.34, PAL_HIELO, 6)
      emitirPolvo(E, x, pie, 8, 40, 1.1)
      emitirObjetos(E, x, pie - 10, 10, TROZO_DIGITO, m * 40, -140, 90, -50, 14, 0.8)
      return true
    }
    case 'fantasma':
      // reaparece y pega con la pelota: el estallido azul
      emitirEstallido(E, PT.frente + m * 10, manoY, 110, 1, 0.2)
      emitirChispas(E, PT.frente + m * 10, manoY, 10, m, 0.7, 200, 480, PAL_AZUL, 1.8)
      destello(E, PT.frente + m * 6, manoY, 34, D_VERDE)
      return true
    case 'padel':
      T.nuevo(l.x, pie - h * 0.62, 96, -2.2, 0.4, 16, 220, m, '#60A5FA')
      T.nuevo(l.x, pie - h * 0.62, 84, -2.0, 0.3, 6, 240, m, '#E0F2FE')
      destello(E, PT.frente, pie - h * 0.7, 44, D_VERDE)
      return true
    case 'orden':
      destello(E, PT.frente + m * 6, manoY, 64, D_ORO, 0.36)
      return true
    case 'espinas':
      emitirEstallido(E, l.x, PT.cabezaY, 120, 2, 0.22)
      emitirChispas(E, l.x + m * 20, PT.cabezaY, 12, m, 0.9, 200, 520, PAL_ORO, 1.8)
      return true
    case 'monopatin': {
      // el revoleo: un arco azul en círculo
      const y = pie - h * 0.55
      T.nuevo(l.x, y, 108, -2.9, 1.5, 20, 320, m, '#2B79DB')
      T.nuevo(l.x, y, 96, -2.7, 1.3, 7, 340, m, '#BFE3FF')
      emitirChispas(E, l.x + m * 70, y, 8, m, 0.8, 160, 420, PAL_AZUL, 1.8)
      return true
    }
    case 'despido':
      // El atlas tiene un impacto por ventana (`impactos [2, 4]`): k = 0 es el papel y k = 1 la patada.
      if (k === 0) {
        // el papel en la mano: un destello blanco
        destello(E, l.x + m * 36, pie - h * 0.86, 54, D_BLANCO, 0.36)
      } else {
        // la patada voladora: el tajo del pie, del dorado del aura (el estallido lo pone el golpe)
        T.nuevo(l.x, pie - h * 0.55, 92, -0.5, 1.0, 15, 200, m, '#FF9F1C')
        destello(E, l.x + m * 70, pie - h * 0.6, 40, D_ORO, 0.3)
      }
      return true
    default:
      return false
  }
}

// ─── Una vez por cuadro ──────────────────────────────────────────────────────

/** El cuadro del arrodillado: el segundo de `levantarse` (de rodillas en los 21), o el primero. */
function planoArrodillado(at: AtlasPreparado): number {
  const idx = at.anims.levantarse.idx
  return idx[Math.min(1, idx.length - 1)] ?? -1
}

/**
 * Los relojes y las partículas de la tanda para los dos luchadores. Va después de actualizarVisual (con
 * las cajas del cuadro ya medidas). Deja en `v.planoForzado` el cuadro que el render dibuja en lugar
 * del del motor (el renderizador lo aplica con `forzarPlano`).
 */
export function actualizarQuinta(E: Escena, p: Partida, vis: readonly [VisualLuchador, VisualLuchador], dtMs: number): void {
  const dtS = dtMs / 1000
  for (let lado = 0; lado < 2; lado++) {
    const l = p.luchadores[lado]
    const v = vis[lado]
    const r = p.luchadores[lado === 0 ? 1 : 0]
    const at = v.at
    if (!l || !r || !at) continue
    puntos(E, l, v)
    const { h, pie } = PT
    const ef = l.efectos

    // Un movimiento nuevo: lo de la acción anterior (la contra) no sigue.
    if (l.movimiento !== v.movPrev) {
      v.contraOk = false
      v.movPrev = l.movimiento
    }

    // El dominio del All In: el anillo vive exactamente lo que vive la contra armada.
    if ((ef.dominio ?? 0) > 0) v.dominioMs = v.dominioMs < 0 ? 0 : v.dominioMs + dtMs
    else if (v.dominioMs >= 0) {
      v.dominioMs = -1
      // se terminó la ventana sin que nadie le pegue: las cartas se deshacen (ya se le puede pegar)
      if (!v.contraOk) emitirBrillos(E, l.x, PT.cinturaY, 5, D_VIOLETA, 50, 30)
    }

    const e = especialEnCurso(l)
    const t = l.animTick

    // Desaparecer (Nehuen): intocable = transparente, sólo el contorno de puntos y una estela fina.
    const emb = e?.embestida
    if (e && emb && emb.hastaRival !== undefined && emb.invulnerableHasta !== undefined && t < emb.invulnerableHasta) {
      v.invisible = true
      v.alfaCuerpo = t < emb.desde ? 0.25 * (1 - t / Math.max(1, emb.desde)) : 0
      if (Math.abs(l.vx) > 2) {
        for (let n = tasa(E, 70, dtS); n > 0; n--) {
          emitirNiebla(E, l.x - l.mira * azar(0, 40), pie - h * azar(0.15, 0.9), -l.mira * azar(30, 90), azar(-8, 8), azar(7, 12), azar(0.25, 0.4), 2)
        }
      }
    } else {
      if (v.invisible) {
        v.invisible = false
        v.reaparecioMs = 0
        emitirAnillo(E, l.x, pie - h * 0.5, 10, 90, 0.3, PAL_AZUL, 5)
        emitirBrillos(E, l.x, pie - h * 0.5, 6, D_CELESTE, 40, 60)
      }
      v.alfaCuerpo = 1
    }
    if (v.reaparecioMs >= 0) {
      v.reaparecioMs += dtMs
      if (v.reaparecioMs > MS.reaparecer) v.reaparecioMs = -1
    }

    // El arrodillado del Despido: mientras dure el aturdido del papel (y Tony siga en su especial).
    if (v.arrodilladoMs >= 0) {
      const tony = especialDe(r.id, r.movimiento)
      if (l.estado === 'aturdido' && l.anim === 'danio' && tony?.siPega) {
        v.arrodilladoMs += dtMs
        v.planoForzado = planoArrodillado(at)
        // lágrimas celestes de los dos ojos
        for (let n = tasa(E, 9, dtS); n > 0; n--) {
          const ojo = Math.random() < 0.5 ? -1 : 1
          emitirObjetos(E, l.x + l.mira * 6 + ojo * 7, v.cajaY + v.cajaH * 0.16, 1, TROZO_LAGRIMA, ojo * azar(10, 40), -azar(10, 60), 6, 600, 9, 0.7)
        }
      } else v.arrodilladoMs = -1
    }

    // Revoleado por el Lanzamiento Aéreo: estela de viento hasta que toca el piso (el aterrizaje
    // fuerte lo pone eventos.ts).
    if (v.revoleado) {
      if (l.enSuelo) v.revoleado = false
      else {
        for (let n = tasa(E, 40, dtS); n > 0; n--) {
          emitirNiebla(E, l.x + azar(-20, 20), v.cajaY + v.cajaH * azar(0.2, 0.8), -l.vx * 6, l.vy * 6, azar(12, 20), azar(0.25, 0.45), 2)
        }
      }
    }

    // Relojes de pantalla.
    if (v.precisionMs >= 0) {
      v.precisionMs += dtMs
      if (v.precisionMs > MS.precision) v.precisionMs = -1
    }
    if (v.glitchMs >= 0) {
      v.glitchMs += dtMs
      if (v.glitchMs > MS.glitch) v.glitchMs = -1
    }
    if (v.clonesMs >= 0) {
      v.clonesMs += dtMs
      if (v.clonesMs > MS.clones) v.clonesMs = -1
    }

    // El que se despierta de la hipnosis: un «pop» violeta.
    const hip = ef.hipnotizado ?? 0
    if (v.hipnoPrev > 0 && hip === 0) {
      emitirAnillo(E, l.x, PT.cabezaY - 12, 6, 54, 0.24, PAL_VIOLETA, 4)
      emitirBrillos(E, l.x, PT.cabezaY - 12, 5, D_VIOLETA, 18, 40)
    }
    v.hipnoPrev = hip
    if (hip > 0 && Math.random() < dtS * 8 * E.densidad) emitirBrillos(E, l.x + azar(-24, 24), PT.cabezaY - azar(0, 20), 1, D_VIOLETA, 6, 30)

    // El cegado: niebla blanca que sale de la cara.
    const ceg = ef.cegado ?? 0
    if (ceg > 0 && Math.random() < dtS * 10 * E.densidad) {
      emitirNiebla(E, l.x + l.mira * azar(0, 16), PT.ojosY + azar(-6, 6), azar(-20, 20), -azar(10, 30), azar(10, 16), 0.5, 1)
    }
    if (v.cegadoPrev > 0 && ceg === 0) emitirNiebla(E, l.x + l.mira * 8, PT.ojosY, 0, -30, 24, 0.5, 1)
    v.cegadoPrev = ceg

    // El Gigante: aura eléctrica azul mientras crece, polvo en el paso enorme.
    if (e?.cuerpo) {
      v.arcosAzules = t >= e.cuerpo.desde && t < e.cuerpo.hasta
      if (v.arcosAzules && Math.random() < dtS * 14 * E.densidad) {
        emitirChispas(E, v.cajaX + Math.random() * v.cajaW, v.cajaY + Math.random() * v.cajaH * 0.8, 1, 0, Math.PI, 80, 220, PAL_AZUL, 1.6)
      }
      if (e.avance && t >= e.avance.desde && t < e.avance.hasta) {
        for (let n = tasa(E, 40, dtS); n > 0; n--) emitirPolvo(E, l.x + l.mira * 40, pie, 1, 26, 1.1, -l.mira)
      }
    } else v.arcosAzules = false

    // El brazo de código del Agarre y Ejecución (Nacho): estira la mano hasta la ventana y, si agarró,
    // queda tendido hasta la víctima mientras la tiene.
    v.brazo = 0
    const ag = e?.agarre
    if (e && ag?.roba) {
      const w = e.ventanas[0]
      if (r.estado === 'agarrado' && Math.abs(r.x - l.x) < 400) {
        const rv = vis[lado === 0 ? 1 : 0]
        v.brazo = 1
        v.brazoX = r.x
        v.brazoY = rv.cajaH > 0 ? rv.cajaY + rv.cajaH * 0.2 : E.sueloY - r.y - 150
        if (Math.random() < dtS * 14 * E.densidad) {
          emitirObjetos(E, r.x + azar(-20, 20), v.brazoY + azar(0, 80), 1, TROZO_DIGITO, 0, -azar(40, 90), 10, -50, 12, 0.6)
        }
      } else if (w && t >= w.desde - 6 && t < w.desde + w.ticks + 2) {
        const f = acotar((t - (w.desde - 6)) / (w.ticks + 6), 0, 1)
        v.brazo = 1 - Math.max(0, f - 0.85) / 0.15
        v.brazoX = l.x + l.mira * mezcla(50, w.caja.x1, salidaCubica(Math.min(1, f * 1.4)))
        v.brazoY = pie - (w.caja.y0 + w.caja.y1) * 0.5
      }
    }

    // El aura dorada del Despido Final: sube desde el flash hasta el papel.
    if (e?.siPega) {
      const papel = e.ventanas[e.siPega.ventana]
      if (papel && t < papel.desde && Math.random() < dtS * 22 * E.densidad) {
        emitirBrillos(E, l.x + azar(-1, 1) * v.cajaW * 0.5, pie - azar(0, 0.4) * h, 1, D_ORO, 6, 160)
      }
      // El papel en alto hasta que salta, con el mismo tramo en que se dibuja el papel (dibujarEncimaQuinta).
      // Con un impacto por ventana en el atlas (Tony, `impactos [2, 4]`), entre el papel y la patada el
      // motor muestra casi medio segundo el cuadro de la rodilla y el papel quedaba flotando.
      const an = at.anims[e.anim]
      const plano = an.idx[an.impactos[e.siPega.ventana] ?? -1]
      const hasta = (e.embestida?.desde ?? (papel ? papel.desde + 24 : 0)) - 4
      if (papel && plano !== undefined && an.impactos.length > e.siPega.ventana + 1 && t >= papel.desde && t < hasta) {
        v.planoForzado = plano
      }
      // la patada voladora: brillos dorados detrás
      if (e.embestida && t >= e.embestida.desde && t < e.embestida.desde + e.embestida.ticks && Math.random() < dtS * 30 * E.densidad) {
        emitirChispas(E, l.x - l.mira * 30, pie - h * 0.45, 1, -l.mira, 0.5, 80, 220, PAL_ORO, 1.6)
      }
    }

    // Las Espinas: brillitos dorados en el pelo de punta.
    if (e?.proyectil?.trampa && t < (e.lanzamiento?.desde ?? 18) + 6 && Math.random() < dtS * 16 * E.densidad) {
      emitirBrillos(E, l.x + azar(-22, 22), PT.cabezaY + azar(-14, 8), 1, D_ORO, 4, 20)
    }

    // El que está convertido en código (agarrado por Nacho): ceros y unos que se le escapan.
    if (l.estado === 'agarrado' && v.agarreDe === 3 && Math.random() < dtS * 16 * E.densidad) {
      emitirObjetos(E, v.cajaX + Math.random() * v.cajaW, v.cajaY + Math.random() * v.cajaH, 1, TROZO_DIGITO, 0, -azar(40, 100), 10, -40, 12, 0.55)
    }

    // Presencia de jefe (Tony): el aura tenue se prende cuando el rival está adentro.
    const pres = pasivaDe(l.id)?.presencia
    const adentro = !!pres && p.fase === 'pelea' && Math.abs(r.x - l.x) <= pres.distancia
    v.presencia = suavizar(v.presencia, adentro ? 1 : 0, 7, dtS)

    // Overclock (Nacho): con la carga alta, chispitas cian en los pies cuando camina o corre.
    const oc = pasivaDe(l.id)?.velocidadConCarga
    if (oc && l.carga >= oc.desde && l.enSuelo && Math.abs(l.vx) > 1 && Math.random() < dtS * 18 * E.densidad) {
      emitirChispas(E, l.x - l.mira * 10, pie - 4, 1, -l.mira, 0.5, 60, 160, PAL_HIELO, 1.4)
    }
  }
}

// ─── Dibujo: detrás del luchador ─────────────────────────────────────────────

/** El anillo de 8 cartas violetas del dominio, a la cintura: la mitad de atrás o la de adelante. */
function anilloDominio(E: Escena, l: LuchadorEstado, v: VisualLuchador, x: number, delante: boolean): void {
  if (v.dominioMs < 0) return
  const h = v.at ? v.at.ficha.alturaMundo : 205
  const cy = E.sueloY - l.y - h * 0.46
  const entra = salidaConRebote(Math.min(1, v.dominioMs / 220))
  const rx = 74 * entra
  const ry = 17 * entra
  const giro = E.s * 4.6
  const img = E.util.de('naipe_violeta')
  const aparece = Math.min(1, v.dominioMs / 110)
  for (let k = 0; k < 8; k++) {
    const a = giro + (k * TAU) / 8
    const prof = Math.sin(a)
    if (prof >= 0 !== delante) continue
    const t = 40 * (0.8 + 0.24 * prof)
    spriteMundo(E, img, x + Math.cos(a) * rx, cy + prof * ry, t, t, Math.cos(a) * 0.55, (delante ? 1 : 0.6) * aparece)
  }
  E.ctx.globalAlpha = 1
}

/**
 * Lo que va en el piso y detrás del cuerpo: el aura violeta del dominio y la mitad de atrás del anillo,
 * el aura de la Presencia de jefe, el brillo del Overclock y el código que corre desde las manos de
 * Nacho en el Terremoto. `x` y `yPie` son los del dibujo del luchador (con su temblor).
 */
export function pisoQuinta(E: Escena, l: LuchadorEstado, v: VisualLuchador, x: number, yPie: number): void {
  const ctx = E.ctx
  if (v.dominioMs >= 0) {
    const pulso = 0.75 + 0.25 * Math.sin(E.s * 10)
    const entra = Math.min(1, v.dominioMs / 120)
    ctx.globalCompositeOperation = 'lighter'
    spriteMundo(E, E.spr.brillo('#7C3AED'), x, yPie, 230, 46, 0, 0.7 * pulso * entra)
    enMundo(E)
    ctx.globalAlpha = 0.75 * entra
    ctx.strokeStyle = '#C4B5FD'
    ctx.lineWidth = 3
    ctx.setLineDash([16, 10])
    ctx.lineDashOffset = -E.ms * 0.12
    ctx.beginPath()
    ctx.ellipse(x, yPie + 1, 86, 15, 0, 0, TAU)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    anilloDominio(E, l, v, x, false)
  }
  if (v.presencia > 0.02) {
    const dist = pasivaDe(l.id)?.presencia?.distancia ?? 170
    ctx.globalCompositeOperation = 'lighter'
    spriteMundo(E, E.spr.brillo('#FF9F1C'), x, yPie, dist * 2.2, 44, 0, 0.16 * v.presencia)
    enMundo(E)
    ctx.globalAlpha = 0.38 * v.presencia
    ctx.strokeStyle = '#E8A33A'
    ctx.lineWidth = 2.4
    ctx.setLineDash([12, 12])
    ctx.lineDashOffset = E.ms * 0.03
    ctx.beginPath()
    ctx.ellipse(x, yPie + 2, dist, 22, 0, 0, TAU)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
  }
  const oc = pasivaDe(l.id)?.velocidadConCarga
  if (oc && l.carga >= oc.desde && l.enSuelo) {
    ctx.globalCompositeOperation = 'lighter'
    spriteMundo(E, E.spr.brillo('#00C2FF'), x, yPie, 120, 24, 0, 0.45 + 0.15 * Math.sin(E.s * 12))
    ctx.globalCompositeOperation = 'source-over'
  }
  // El Terremoto de Código: el código corre por el piso desde las manos hasta la última columna.
  const e = especialEnCurso(l)
  if (e?.rafaga && e.proyectil?.diferido && e.lanzamiento) {
    const t = l.animTick
    const desde = e.lanzamiento.desde
    const fin = desde + e.lanzamiento.ticks + 8
    if (t >= desde - 1 && t < fin) {
      const cada = e.rafaga.cada
      const salidos = Math.min(e.rafaga.cantidad, Math.floor((t - desde) / Math.max(1, cada)) + 1)
      const tiro = e.rafaga.tiros?.[Math.max(0, salidos - 1)]
      const lejos = tiro?.distancia ?? e.proyectil.diferido.distancia
      const alfa = t > fin - 8 ? (fin - t) / 8 : 1
      codigoEnElPiso(E, x + l.mira * 26, x + l.mira * lejos, 0.9 * alfa)
    }
  }
}

// ─── Dibujo: encima del luchador ─────────────────────────────────────────────

/** La mano de adelante de cada cuadro medido (px del atlas desde el ancla: adelante y arriba del pie). */
const MANOS = new WeakMap<AtlasPreparado, Map<number, { dx: number; dy: number } | null>>()

/**
 * La punta de la mano de adelante en el cuadro `plano`: el píxel opaco más adelantado entre el 45 y el
 * 85 % del alto (de pie) medido desde el pie. El recuadro de los cuadros trae aire a los costados, así
 * que el borde de la caja no es la mano. Se mide una vez por cuadro (getImageData de un recorte del
 * tamaño del cuadro) y queda guardado; null si el lienzo no se deja leer o no hay nada a esa altura.
 */
function manoAdelante(at: AtlasPreparado, plano: number): { dx: number; dy: number } | null {
  let porCuadro = MANOS.get(at)
  if (!porCuadro) {
    porCuadro = new Map()
    MANOS.set(at, porCuadro)
  }
  const guardada = porCuadro.get(plano)
  if (guardada !== undefined) return guardada
  let mano: { dx: number; dy: number } | null = null
  const f = at.cuadros[plano]
  if (f) {
    const c = crearLienzo(f.w, f.h)
    try {
      const g = contexto(c)
      g.drawImage(at.imagen, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h)
      const px = g.getImageData(0, 0, c.width, c.height).data
      const alto = at.ficha.alturaMundo / at.escala
      const y0 = Math.max(0, Math.floor(f.ay - alto * 0.85))
      const y1 = Math.min(c.height - 1, Math.ceil(f.ay - alto * 0.45))
      for (let x = c.width - 1; x >= 0 && !mano; x--) {
        let suma = 0
        let n = 0
        for (let y = y0; y <= y1; y++) {
          if (px[(y * c.width + x) * 4 + 3] > 128) {
            suma += y
            n++
          }
        }
        if (n > 0) mano = { dx: x - f.ax, dy: f.ay - suma / n }
      }
    } catch {
      mano = null
    } finally {
      liberarLienzo(c)
    }
  }
  porCuadro.set(plano, mano)
  return mano
}

/** Un sprite de la hoja de ESTE luchador (si está) o la utilería. */
function enLaMano(
  E: Escena,
  at: AtlasPreparado | null,
  efecto: 'tijeras' | 'despido' | 'pelotita',
  util: 'despido' | 'pelotita' | null,
  x: number,
  y: number,
  lado: number,
  rot: number,
  mira: number,
  alfa: number,
): void {
  if (util === null) {
    // la tijera de Fran: si su hoja no la trae, la tijera dibujada de los proyectiles de Simón
    if (at && buscarEfecto([at], 0, efecto)) objeto(E, [at], 0, efecto, 'naipe', x, y, lado, rot, mira, alfa)
    else spriteMundo(E, E.spr.tijera(), x, y, lado, lado, mira < 0 ? Math.PI - rot : rot, alfa)
    return
  }
  objeto(E, at ? [at] : [], 0, efecto, util, x, y, lado, rot, mira, alfa)
}

/** Los anillos dorados de la Orden Final: salen del dedo y llegan a la punta de su ventana. */
function anillosOrden(E: Escena, l: LuchadorEstado): void {
  const e = especialEnCurso(l)
  if (!e || e.herramienta !== 'anillos') return
  const ctx = E.ctx
  const pie = E.sueloY - l.y
  const t = l.animTick
  for (let i = 0; i < e.ventanas.length; i++) {
    const w = e.ventanas[i]
    const vuelo = (t - w.desde + 1) / Math.max(1, w.ticks)
    if (vuelo < 0 || vuelo > 1.7) continue
    const f = Math.min(1, vuelo)
    const fade = vuelo > 1 ? 1 - (vuelo - 1) / 0.7 : 1
    const xc = l.x + l.mira * mezcla(56, w.caja.x1, salidaCubica(f))
    const cy = pie - (w.caja.y0 + w.caja.y1) * 0.5
    const ry = (w.caja.y1 - w.caja.y0) * 0.5 * (0.45 + 0.55 * salidaCubica(f))
    const rx = ry * 0.3
    ctx.globalCompositeOperation = 'lighter'
    spriteMundo(E, E.spr.brillo('#FFC93C'), xc, cy, rx * 5, ry * 2.4, 0, 0.45 * fade)
    enMundo(E)
    const capas: [number, number, string][] = [
      [1, 5.5, '#FFC93C'],
      [0.72, 3.6, '#FFE58A'],
      [0.46, 2.4, '#FFF7D6'],
    ]
    for (const [k, ancho, color] of capas) {
      ctx.globalAlpha = 0.95 * fade
      ctx.strokeStyle = color
      ctx.lineWidth = ancho
      ctx.beginPath()
      ctx.ellipse(xc, cy, Math.max(1, rx * k), Math.max(1, ry * k), 0, 0, TAU)
      ctx.stroke()
    }
    // la estela del aro desde el dedo
    if (f < 1) {
      ctx.globalAlpha = 0.35 * fade
      ctx.strokeStyle = '#FFD45A'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(l.x + l.mira * 56, cy)
      ctx.lineTo(xc, cy)
      ctx.stroke()
    }
    ctx.globalCompositeOperation = 'source-over'
  }
  ctx.globalAlpha = 1
}

/**
 * El arco azul del Smash mientras la paleta devuelve lo que le tiran: centrado en la caja de la
 * devolución (adelante del cuerpo, del alto de la caja), con un tramo brillante que la barre.
 */
function arcoSmash(E: Escena, l: LuchadorEstado): void {
  const e = especialEnCurso(l)
  const dv = e?.devuelve
  if (!dv) return
  const t = l.animTick
  if (t < dv.desde - 1 || t >= dv.hasta + 2) return
  const f = acotar((t - dv.desde) / Math.max(1, dv.hasta - dv.desde), 0, 1)
  const fade = t >= dv.hasta ? 1 - (t - dv.hasta + 1) / 3 : Math.min(1, (t - dv.desde + 2) / 3)
  const ctx = E.ctx
  const pie = E.sueloY - l.y
  const cx = l.x + l.mira * (dv.caja.x0 + (dv.caja.x1 - dv.caja.x0) * 0.22)
  const cy = pie - (dv.caja.y0 + dv.caja.y1) * 0.5
  const R = (dv.caja.y1 - dv.caja.y0) * 0.5
  const a0 = l.mira > 0 ? -1.35 : Math.PI + 1.35
  const a1 = l.mira > 0 ? 1.2 : Math.PI - 1.2
  const sentido = l.mira < 0
  ctx.globalCompositeOperation = 'lighter'
  spriteMundo(E, E.spr.brillo('#60A5FA'), cx + l.mira * R * 0.72, cy, R * 1.1, R * 2.3, 0, 0.4 * fade)
  enMundo(E)
  ctx.lineCap = 'round'
  ctx.globalAlpha = 0.42 * fade
  ctx.strokeStyle = '#3D5AFE'
  ctx.lineWidth = 22
  ctx.beginPath()
  ctx.arc(cx, cy, R, a0, a1, sentido)
  ctx.stroke()
  ctx.globalAlpha = 0.5 * fade
  ctx.strokeStyle = '#60A5FA'
  ctx.lineWidth = 9
  ctx.stroke()
  // el tramo brillante barre el arco
  const am = a0 + (a1 - a0) * f
  const atras = a0 + (a1 - a0) * Math.max(0, f - 0.35)
  ctx.beginPath()
  ctx.arc(cx, cy, R, atras, am, sentido)
  ctx.globalAlpha = 0.95 * fade
  ctx.strokeStyle = '#BFDBFE'
  ctx.lineWidth = 9
  ctx.stroke()
  ctx.strokeStyle = '#FFFFFF'
  ctx.lineWidth = 3.5
  ctx.stroke()
  spriteMundo(E, E.spr.estrella[2], cx + Math.cos(am) * R, cy + Math.sin(am) * R, 30, 30, E.s * 6, 0.9 * fade)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
}

/** El brazo de código de Nacho: tres cables cian ondulando con dígitos que corren hacia la víctima. */
function brazoCodigo(E: Escena, l: LuchadorEstado, v: VisualLuchador): void {
  if (v.brazo <= 0.01) return
  const ctx = E.ctx
  const pie = E.sueloY - l.y
  const h = v.at ? v.at.ficha.alturaMundo : 205
  const x0 = (l.mira > 0 ? v.cajaX + v.cajaW : v.cajaX) - l.mira * 6
  const y0 = pie - h * 0.6
  const x1 = v.brazoX
  const y1 = v.brazoY
  const dx = x1 - x0
  const dy = y1 - y0
  const largo = Math.hypot(dx, dy)
  if (largo < 8) return
  const nx = -dy / largo
  const ny = dx / largo
  enMundo(E)
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (let j = 0; j < 3; j++) {
    for (let capa = 0; capa < 2; capa++) {
      ctx.beginPath()
      for (let s = 0; s <= 10; s++) {
        const f = s / 10
        const ola = Math.sin(E.s * 26 + f * 9 + j * 2.1) * 6 * Math.sin(f * Math.PI)
        const px = x0 + dx * f + nx * (ola + (j - 1) * 5)
        const py = y0 + dy * f + ny * (ola + (j - 1) * 5)
        if (s === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.globalAlpha = (capa === 0 ? 0.3 : 0.85) * v.brazo
      ctx.strokeStyle = capa === 0 ? '#06B6D4' : '#A5F3FC'
      ctx.lineWidth = capa === 0 ? 7 : 1.8
      ctx.stroke()
    }
  }
  ctx.globalCompositeOperation = 'source-over'
  for (let j = 0; j < 4; j++) {
    const f = (E.s * 2.4 + j / 4) % 1
    spriteMundo(E, E.util.de(j % 2 ? 'digito1' : 'digito0'), x0 + dx * f, y0 + dy * f - 6, 14, 14, 0, 0.95 * v.brazo)
  }
  E.ctx.globalCompositeOperation = 'lighter'
  spriteMundo(E, E.spr.brillo('#22D3EE'), x1, y1, 60, 60, 0, 0.55 * v.brazo)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
}

/** La línea de luz y el remolino donde reaparece Nehuen. */
function reaparicion(E: Escena, l: LuchadorEstado, v: VisualLuchador, x: number): void {
  if (v.reaparecioMs < 0) return
  const f = v.reaparecioMs / MS.reaparecer
  const ctx = E.ctx
  const pie = E.sueloY - l.y
  const h = v.at ? v.at.ficha.alturaMundo : 205
  ctx.globalCompositeOperation = 'lighter'
  spriteMundo(E, E.spr.brillo('#60A5FA'), x, pie - h * 0.55, 46 * (1 - f) + 10, h * 1.5, 0, 0.9 * (1 - f))
  enMundo(E)
  ctx.globalAlpha = 1 - f
  ctx.strokeStyle = '#FFFFFF'
  ctx.lineWidth = 2.4 * (1 - f) + 0.5
  ctx.beginPath()
  ctx.moveTo(x, pie + 4)
  ctx.lineTo(x, pie - h * 1.2)
  ctx.stroke()
  const giro = E.s * 16
  ctx.strokeStyle = '#93C5FD'
  ctx.lineWidth = 3
  for (let j = 0; j < 2; j++) {
    ctx.beginPath()
    ctx.ellipse(x, pie - h * 0.5, 54 * (1 - f * 0.4), h * 0.5, 0, giro + j * Math.PI, giro + j * Math.PI + 1.4)
    ctx.stroke()
  }
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
}

/** Las líneas del fade sobre la cabeza del que se comió el Corte de Precisión con la punta, y la tijera. */
function fadePrecision(E: Escena, l: LuchadorEstado, v: VisualLuchador, x: number, rival: AtlasPreparado | null): void {
  if (v.precisionMs < 0) return
  const ms = v.precisionMs
  const f = ms / MS.precision
  const ctx = E.ctx
  const arriba = v.cajaY + 2
  const abajo = v.cajaY + v.cajaH * 0.17
  const ancho = Math.max(40, v.cajaW * 0.5)
  enMundo(E)
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = 'round'
  for (let k = 0; k < 4; k++) {
    const t0 = k * 70
    if (ms < t0) continue
    const barre = Math.min(1, (ms - t0) / 140)
    const y = arriba + ((k + 0.5) * (abajo - arriba)) / 4
    const x0 = x - ancho / 2
    const alfa = (1 - f) * (k === 3 ? 0.7 : 1)
    ctx.globalAlpha = 0.35 * alfa
    ctx.strokeStyle = '#38BDF8'
    ctx.lineWidth = 6
    ctx.beginPath()
    ctx.moveTo(x0, y)
    ctx.lineTo(x0 + ancho * barre, y)
    ctx.stroke()
    ctx.globalAlpha = alfa
    ctx.strokeStyle = '#E0F2FE'
    ctx.lineWidth = 1.6
    ctx.stroke()
  }
  ctx.globalCompositeOperation = 'source-over'
  // la tijera grande que corta arriba de la cabeza
  if (ms < 420) {
    const s = ms < 120 ? 1.35 - 0.35 * (ms / 120) : 1
    enLaMano(E, rival, 'tijeras', null, x, arriba - 16, 52 * s, Math.sin(ms * 0.05) * 0.3, l.mira > 0 ? -1 : 1, 1 - ms / 420)
  }
  ctx.globalAlpha = 1
}

/** La espiral hipnótica sobre la cabeza (distinta de las dos espirales chicas del mareo). */
function espiralHipnosis(E: Escena, l: LuchadorEstado, v: VisualLuchador, x: number): void {
  const quedan = l.efectos.hipnotizado ?? 0
  if (quedan <= 0) return
  const alfa = quedan < 10 ? quedan / 10 : 1
  const y = v.cajaY - 20 + Math.sin(E.s * 4) * 3
  E.ctx.globalCompositeOperation = 'lighter'
  spriteMundo(E, E.spr.brillo('#A855F7'), x, y, 64, 64, 0, 0.5 * alfa)
  E.ctx.globalCompositeOperation = 'source-over'
  spriteMundo(E, E.util.de('hipnosis'), x, y, 36, 36, -E.s * 7, 0.95 * alfa)
  E.ctx.globalAlpha = 1
}

/** La nubecita blanca en la cara del cegado. */
function nubeCegado(E: Escena, l: LuchadorEstado, v: VisualLuchador, x: number): void {
  const quedan = l.efectos.cegado ?? 0
  if (quedan <= 0) return
  const alfa = quedan < 12 ? quedan / 12 : 1
  const y = v.cajaY + v.cajaH * 0.11
  const fx = x + l.mira * 8
  const res = Math.sin(E.s * 5) * 2
  spriteMundo(E, E.util.de('nube_spray0'), fx, y, 58 + res, 40, 0, 0.88 * alfa)
  spriteMundo(E, E.util.de('nube_spray1'), fx + l.mira * 12, y - 6 - res, 38, 28, 0, 0.8 * alfa)
  E.ctx.globalAlpha = 1
}

/** El «!!» arriba de la cabeza del arrodillado (salta al principio y después titila). */
function exclamacion(E: Escena, v: VisualLuchador, x: number): void {
  if (v.arrodilladoMs < 0) return
  const ms = v.arrodilladoMs
  const salto = ms < 260 ? salidaConRebote(ms / 260) : 1
  const titila = ms > MS.exclamacion ? (Math.floor(ms / 120) % 2 === 0 ? 1 : 0.55) : 1
  spriteMundo(E, E.util.de('exclamacion'), x, v.cajaY - 26 - 10 * (1 - salto), 36 * salto, 36 * salto, 0, titila)
  E.ctx.globalAlpha = 1
}

/**
 * Lo que va ENCIMA del luchador (después del sprite y de los estados de siempre). `x` es la del dibujo
 * (con su temblor). `rival` es el atlas del otro (la tijera del fade es la de Fran).
 */
export function dibujarEncimaQuinta(E: Escena, l: LuchadorEstado, v: VisualLuchador, x: number, rival: AtlasPreparado | null): void {
  anilloDominio(E, l, v, x, true)
  espiralHipnosis(E, l, v, x)
  nubeCegado(E, l, v, x)
  exclamacion(E, v, x)
  fadePrecision(E, l, v, x, rival)
  reaparicion(E, l, v, x)
  const e = especialEnCurso(l)
  if (!e) return
  const at = v.at
  const t = l.animTick
  const pie = E.sueloY - l.y
  const h = at ? at.ficha.alturaMundo : 205
  const frente = l.mira > 0 ? v.cajaX + v.cajaW : v.cajaX
  // El Corte de Precisión: la tijera grande en la mano (la hoja no la trae) y el brillo de la punta.
  const punta = e.ventanas[0]?.punta
  if (punta) {
    const w = e.ventanas[0]
    if (t >= 2) {
      // en la mano medida del cuadro (sin hoja medible, en el borde de la caja como antes); el mango
      // queda en la mano y las hojas adelante
      const mano = at ? manoAdelante(at, v.plano) : null
      const xMano = mano && at ? x + l.mira * mano.dx * at.escala : frente
      const yMano = mano && at ? pie - mano.dy * at.escala : pie - h * 0.6
      const xTijera = xMano + l.mira * 18
      // un brillo frío detrás: la tijera de la hoja es oscura y sobre el oscurecido no se leía
      E.ctx.globalCompositeOperation = 'lighter'
      spriteMundo(E, E.spr.brillo('#7DD3FC'), xTijera, yMano, 74, 58, 0, 0.42)
      E.ctx.globalCompositeOperation = 'source-over'
      enLaMano(E, at, 'tijeras', null, xTijera, yMano, 66, -0.12, l.mira, 1)
      if (t >= w.desde - 3 && t < w.desde + w.ticks + 3) {
        E.ctx.globalCompositeOperation = 'lighter'
        spriteMundo(E, E.spr.brillo('#38BDF8'), xTijera + l.mira * 22, yMano, 70, 70, 0, 0.8)
        spriteMundo(E, E.spr.estrella[2], xTijera + l.mira * 30, yMano, 34, 34, E.s * 5, 0.95)
        E.ctx.globalCompositeOperation = 'source-over'
      }
    }
  }
  // El Despido Final: el papel en la mano levantada, del papel hasta que salta.
  const papel = e.siPega ? e.ventanas[e.siPega.ventana] : undefined
  if (papel) {
    const hasta = (e.embestida?.desde ?? papel.desde + 24) - 4
    if (t >= papel.desde - 6 && t < hasta) {
      const sube = salidaCubica(acotar((t - (papel.desde - 6)) / 6, 0, 1))
      enLaMano(E, at, 'despido', 'despido', l.x + l.mira * 34, pie - h * (0.62 + 0.24 * sube), 48, l.mira * Math.sin(E.s * 6) * 0.06, l.mira, 1)
    }
  }
  // Desaparecer: la pelota en la mano cuando reaparece y pega.
  if (e.embestida?.hastaRival !== undefined) {
    const w = e.ventanas[0]
    if (w && t >= w.desde - 5 && t < w.desde + w.ticks) {
      enLaMano(E, at, 'pelotita', 'pelotita', frente + l.mira * 8, pie - h * 0.6, 26, E.s * 9, l.mira, 1)
    }
  }
  anillosOrden(E, l)
  arcoSmash(E, l)
  brazoCodigo(E, l, v)
}

// ─── La capa de cada herramienta cuando el golpe entra ───────────────────────

/** Devuelve false si la herramienta no es de la quinta tanda. */
export function capaHerramientaQuinta(
  E: Escena,
  h: string,
  x: number,
  y: number,
  dir: number,
  fuerza: string,
  conBono: boolean,
): boolean {
  switch (h) {
    case 'carta':
      emitirEstallido(E, x, y, 74, ESTALLIDO_ROJO, 0.16)
      emitirObjetos(E, x, y, 4, TROZO_NAIPE, dir * 140, -200, 120, 1000, 14, 0.7)
      emitirChispas(E, x, y, 6, dir, 0.7, 160, 380, PAL_ROJO, 1.6)
      return true
    case 'dominio':
      emitirEstallido(E, x, y, conBono ? 150 : 90, 5, 0.2)
      emitirObjetos(E, x, y, conBono ? 8 : 3, TROZO_NAIPE_VIOLETA, dir * 160, -240, 160, 900, 20, 0.9)
      if (conBono) emitirAnillo(E, x, y, 10, 110, 0.32, PAL_VIOLETA, 7)
      return true
    case 'hipnosis':
      emitirAnillo(E, x, y, 8, 64, 0.28, PAL_VIOLETA, 5)
      emitirBrillos(E, x, y, 5, D_VIOLETA, 20, 40)
      return true
    case 'gigante':
      emitirPolvo(E, x, E.sueloY, 10, 60, 1.5, dir)
      emitirTrozos(E, x, E.sueloY - 6, 6, 0, 1)
      return true
    case 'lanzamiento':
      emitirAnillo(E, x, y, 10, 70, 0.26, PAL_BLANCO, 5)
      for (let k = 0; k < 5; k++) emitirNiebla(E, x, y, azar(-60, 60), -azar(60, 160), 18, 0.4, 2)
      return true
    case 'secador':
      emitirChispas(E, x, y, 8, dir, 0.7, 180, 460, PAL_BLANCO, 1.5)
      emitirBrillos(E, x, y, 3, D_BLANCO, 12, 30)
      return true
    case 'aerosol':
      for (let k = 0; k < 6; k++) emitirNiebla(E, x, y, dir * azar(40, 140), azar(-40, 20), 20, 0.5, 1)
      return true
    case 'laptop':
      emitirEstallido(E, x, y, 80, ESTALLIDO_CIAN, 0.16)
      emitirObjetos(E, x, y, 6, TROZO_DIGITO, dir * 120, -160, 120, 300, 13, 0.7)
      emitirChispas(E, x, y, 6, dir, 0.7, 160, 400, PAL_HIELO, 1.5)
      return true
    case 'ejecucion':
      if (fuerza === 'leve') {
        // cada apretón: un estallido de dígitos rojos
        emitirObjetos(E, x, y, 9, TROZO_DIGITO_ROJO, 0, -120, 160, 200, 14, 0.65)
      } else {
        emitirEstallido(E, x, y, 130, ESTALLIDO_CIAN, 0.22)
        emitirObjetos(E, x, y, 8, TROZO_DIGITO, dir * 100, -200, 200, 300, 15, 0.9)
        emitirObjetos(E, x, y, 8, TROZO_DIGITO_ROJO, dir * 100, -200, 200, 300, 15, 0.9)
      }
      return true
    case 'codigo':
      emitirEstallido(E, x, y, 110, ESTALLIDO_CIAN, 0.2)
      emitirObjetos(E, x, y, 4, TROZO_ROCA_CIAN, dir * 120, -260, 160, 1200, 16, 0.9)
      return true
    case 'fantasma':
      emitirEstallido(E, x, y, 100, 1, 0.18)
      emitirChispas(E, x, y, 8, dir, 0.8, 200, 480, PAL_AZUL, 1.8)
      emitirBrillos(E, x, y, 3, D_VERDE, 14, 30)
      return true
    case 'paleta':
      emitirAnillo(E, x, y, 8, 52, 0.22, PAL_AZUL, 4)
      emitirBrillos(E, x, y, 4, D_VERDE, 16, 30)
      return true
    case 'anillos':
      // el aro se cierra sobre el rival; el tercero (el de más fuerza) estalla con trozos dorados
      emitirAnillo(E, x, y, 78, 10, 0.24, PAL_ORO, 5)
      emitirChispas(E, x, y, 8, dir, 0.9, 160, 420, PAL_ORO, 1.6)
      if (fuerza === 'especial') {
        emitirEstallido(E, x, y, 150, 2, 0.24)
        emitirTrozos(E, x, y, 8, 1, 1)
        temblar(E.cam, 6)
      }
      return true
    case 'espinas':
      emitirEstallido(E, x, y, 110, 2, 0.2)
      emitirObjetos(E, x, y, 2, TROZO_PUA, dir * 200, -360, 120, 1300, 26, 0.9)
      emitirChispas(E, x, y, 10, 0, Math.PI, 160, 460, PAL_ORO, 1.6)
      return true
    case 'monopatin':
      emitirEstallido(E, x, y, 140, 1, 0.22)
      emitirChispas(E, x, y, 14, dir, 1, 200, 560, PAL_AZUL, 2)
      emitirPolvo(E, x, E.sueloY, 6, 30, 1.1, dir)
      return true
    case 'despido':
      if (fuerza === 'especial') {
        emitirEstallido(E, x, y, 160, 2, 0.24)
        emitirTrozos(E, x, y, 8, 1, 1.1)
        emitirChispas(E, x, y, 12, dir, 1, 200, 560, PAL_ORO, 2)
      } else {
        emitirBrillos(E, x, y, 5, D_BLANCO, 20, 40)
        emitirAnillo(E, x, y, 6, 46, 0.2, PAL_BLANCO, 3)
      }
      return true
    default:
      return false
  }
}

/** La capa de cada herramienta de la tanda cuando el golpe se CUBRE. */
export function bloqueoQuinta(E: Escena, h: string, x: number, y: number, dir: number): void {
  switch (h) {
    case 'carta':
      // chispas rojas apagadas
      emitirChispas(E, x, y, 5, -dir, 0.9, 60, 180, PAL_ROJO, 1.2)
      break
    case 'anillos':
      // los aros rebotan en la guardia
      emitirAnillo(E, x - dir * 10, y, 16, 64, 0.22, PAL_ORO, 3)
      emitirChispas(E, x, y, 6, -dir, 0.7, 140, 360, PAL_ORO, 1.4)
      break
    case 'espinas':
      emitirChispas(E, x, y, 5, -dir, 0.8, 100, 260, PAL_ORO, 1.3)
      break
    case 'secador':
      emitirChispas(E, x, y, 5, -dir, 0.8, 120, 300, PAL_BLANCO, 1.3)
      break
    default:
      break
  }
}

/** El temblor de un golpe de la tanda que sacude más que su fuerza (null: el de siempre). */
export function temblorQuinta(h: string, fuerza: string): number | null {
  switch (h) {
    case 'gigante':
      return 14
    case 'monopatin':
      return 11
    case 'codigo':
      return 9
    case 'espinas':
      return fuerza === 'especial' ? 8 : null
    case 'despido':
    case 'lanzamiento':
    case 'ejecucion':
      return fuerza === 'especial' ? 10 : null
    default:
      return null
  }
}

/** La contra del All In: las 8 cartas del anillo salen despedidas para todos lados. */
export function cartasDespedidas(E: Escena, l: LuchadorEstado, v: VisualLuchador): void {
  const h = v.at ? v.at.ficha.alturaMundo : 205
  const cy = E.sueloY - l.y - h * 0.46
  const giro = E.s * 4.6
  for (let k = 0; k < 8; k++) {
    const a = giro + (k * TAU) / 8
    const px = l.x + Math.cos(a) * 66
    const py = cy + Math.sin(a) * 15
    emitirObjetos(E, px, py, 1, TROZO_NAIPE_VIOLETA, Math.cos(a) * 420, -260 + Math.sin(a) * 120, 60, 900, 26, 0.9)
  }
}
