/**
 * Qué dispara cada evento del motor en pantalla: chispas, pelo, números, textos de impacto,
 * temblores, destellos, super flash y anuncios. Y los tajos que acompañan cada golpe, sincronizados
 * con los cuadros de impacto del atlas (si el atlas no los marca, se usa el evento `swing`).
 *
 * El estado (posiciones, efectos activos, fase) se lee de la Partida; los eventos sólo disparan.
 */
import { PERSONAJES } from '../personajes'
import type { EventoJuego, FuerzaGolpe, Herramienta, IdPersonaje, Lado, Partida } from '../tipos'
import { empujarZoom, temblar } from './camara'
import { fx, FX_ARCO, FX_BLOQUEO, FX_CHISPA, FX_CHISPA_CRITICA, FX_ONDA, FX_RAYO } from './efectos'
import type { Escena } from './escena'
import { impactoEspecial, rasgoEspecial } from './especiales'
import { tieneImpactos, type VisualLuchador } from './luchadores'
import { destellar, iniciarSuperFlash, type Destello, type SuperFlash } from './pantalla'
import {
  emitirAnillo,
  emitirAnim,
  emitirBrillos,
  emitirChispas,
  emitirCruces,
  emitirElectricas,
  emitirEsquirlas,
  emitirEstallido,
  emitirLlamas,
  emitirMechones,
  emitirMoscas,
  emitirNiebla,
  emitirNotas,
  emitirPolvo,
  emitirSalpicadura,
  emitirTrozos,
  G_CALIENTE,
  G_LECHE,
  G_PINTURA,
  G_TRAGO,
  G_YERBA,
  P_HIELO,
  P_VIDRIO,
  PAL_AZUL,
  PAL_BLANCO,
  PAL_ELECTRICA,
  PAL_FUEGO,
  PAL_HIELO,
  PAL_MAGENTA,
  PAL_ORO,
  PAL_TIERRA,
  PAL_VIOLETA,
} from './particulas'
import type { Textos } from './textos'
import { azar } from './util'

export interface Mundo {
  E: Escena
  vis: [VisualLuchador, VisualLuchador]
  textos: Textos
  destello: Destello
  sf: SuperFlash
  p: Partida
  caras: Partial<Record<IdPersonaje, CanvasImageSource>>
  /** Quién cayó en el último K.O. (para la cámara de la fase 'ko' y 'final'). */
  perdedorKo: Lado | null
  /** ms que la cámara sigue al que tiró el especial. */
  focoMs: number
  focoLado: Lado
  /** ¡AL CERO!: deja pelado al lado (y le vuela la gorra). Devuelve el centro de su cabeza. */
  rapar?: (lado: Lado) => { x: number; y: number } | null
  /** Arma de antemano los sprites pelados del lado (al abrirse la ventana del remate). */
  prepararRapado?: (lado: Lado) => void
}

const NIVEL: Record<FuerzaGolpe, number> = { leve: 0, medio: 1, fuerte: 2, especial: 3 }
const CORTA: Partial<Record<Herramienta, boolean>> = {
  puno: false,
  patada: false,
  maquina: true,
  tijera: true,
  peine: true,
  rayo: false,
  tornado: true,
  sillon: false,
  spray: false,
  // la navaja de barbería corta pelo de verdad
  navaja: true,
}
const TEMBLOR = [2.5, 4, 6.5, 9]
/** Golpes que sacuden más que su fuerza (el sillón, la moto, el agarre contra el piso, el sismo). */
const TEMBLOR_EXTRA: Partial<Record<Herramienta, number>> = { sillon: 15, moto: 12, agarre: 12, sismo: 11, pesado: 10, guante: 10 }

/** Lo propio de cada herramienta del elenco cuando el golpe entra (además de chispas y pelo). */
function capaHerramienta(M: Mundo, h: Herramienta, x: number, y: number, dir: number): void {
  const E = M.E
  switch (h) {
    case 'bombo':
      emitirAnillo(E, x, y, 8, 60, 0.24, PAL_ORO, 4)
      emitirBrillos(E, x, y, 4, 1, 24, 50)
      break
    case 'navaja':
      emitirChispas(E, x, y, 8, dir, 0.4, 260, 620, PAL_BLANCO, 1.5)
      emitirBrillos(E, x, y, 2, 0, 10, 20)
      break
    case 'celular':
      emitirBrillos(E, x, y, 3, 2, 14, 30)
      break
    case 'anteojos':
      emitirBrillos(E, x, y, 2, 0, 12, 30)
      break
    case 'guante':
      emitirLlamas(E, x, y, 8, dir * 120, -60, 30, 14)
      break
    case 'moto':
      emitirPolvo(E, x, E.sueloY, 8, 40, 1.4, dir)
      emitirChispas(E, x, y, 8, dir, 0.7, 200, 520, PAL_FUEGO)
      break
    case 'bala':
      emitirChispas(E, x, y, 5, dir, 0.6, 150, 380, PAL_ORO, 1.8)
      break
    case 'graffiti':
      emitirSalpicadura(E, x, y, 14, G_PINTURA, dir > 0 ? -0.5 : Math.PI + 0.5, 1.1, 120, 380, 1.2)
      break
    case 'break':
      emitirBrillos(E, x, y, 4, 3, 20, 40)
      break
    case 'trago':
      emitirSalpicadura(E, x, y, 10, G_TRAGO, -Math.PI / 2, 1.2, 80, 260, 1)
      break
    case 'botella':
      emitirTrozos(E, x, y, 4, 1, 0.6)
      emitirBrillos(E, x, y, 3, 0, 14, 40)
      break
    case 'baile':
    case 'onda':
      emitirAnillo(E, x, y, 8, 54, 0.24, PAL_MAGENTA, 4)
      emitirNotas(E, x, y, 2, 20, 100, 20)
      break
    case 'gorro':
      emitirBrillos(E, x, y, 3, 6, 16, 30)
      break
    case 'dragon':
      emitirLlamas(E, x, y, 10, dir * 140, -80, 32, 16)
      emitirEstallido(E, x, y, 90, 0, 0.18)
      break
    case 'pelota':
      emitirAnillo(E, x, y, 8, 46, 0.22, PAL_AZUL, 4)
      emitirBrillos(E, x, y, 3, 2, 14, 30)
      break
    case 'leche':
      emitirSalpicadura(E, x, y, 8, G_LECHE, dir > 0 ? -0.4 : Math.PI + 0.4, 1, 80, 240, 1)
      break
    case 'panal':
    case 'nube':
      for (let k = 0; k < 4; k++) emitirNiebla(E, x, y, dir * azar(20, 90), -azar(10, 40), 18, 0.5, 4)
      break
    case 'mate':
      emitirSalpicadura(E, x, y, 8, G_YERBA, -Math.PI / 2, 1.2, 70, 220, 0.9)
      break
    case 'agua':
      emitirSalpicadura(E, x, y, 6, G_CALIENTE, dir > 0 ? -0.4 : Math.PI + 0.4, 1, 80, 220, 1)
      for (let k = 0; k < 3; k++) emitirNiebla(E, x, y, azar(-30, 30), -azar(40, 90), 16, 0.6, 2)
      break
    case 'sismo':
      emitirTrozos(E, x, E.sueloY - 6, 6, 0, 0.9)
      emitirPolvo(E, x, E.sueloY, 6, 30, 1.2, dir)
      break
    case 'agarre':
      emitirPolvo(E, x, E.sueloY, 10, 50, 1.5)
      emitirEstallido(E, x, E.sueloY - 24, 120, 0, 0.2)
      break
    case 'pesado':
      emitirAnillo(E, x, y, 10, 64, 0.24, PAL_FUEGO, 5)
      emitirPolvo(E, x, E.sueloY, 6, 30, 1.2, dir)
      break
    default:
      break
  }
}
const ZOOM = [0, 0.006, 0.014, 0.024]

function otro(l: Lado): Lado {
  return l === 0 ? 1 : 0
}

function alto(v: VisualLuchador): number {
  return v.at ? v.at.ficha.alturaMundo : 205
}

/** Centro del cuerpo en mundo-pantalla (de la caja del último cuadro dibujado). */
function centroX(v: VisualLuchador): number {
  return v.cajaX + v.cajaW / 2
}
function centroY(v: VisualLuchador): number {
  return v.cajaY + v.cajaH * 0.45
}

/** Estallido del golpe: el del atlas compartido si está; si no, el dibujado a mano. */
function estallido(E: Escena, x: number, y: number, tam: number, variante: number, vida = 0.17): void {
  let id = -1
  if (variante === 2 || (variante === 0 && tam > 120)) id = FX_CHISPA_CRITICA
  else if (variante === 1) id = FX_BLOQUEO
  else if (variante === 0 || variante === 3) id = FX_CHISPA
  const anim = id >= 0 ? fx(E, id) : null
  if (anim) {
    const c = anim.cuadros[0]
    emitirAnim(E, id, x, y, (tam * 1.1) / Math.max(c.w, c.h), 0, Math.random() < 0.5 ? -1 : 1)
    if (variante === 3) emitirAnim(E, FX_ARCO, x, y, (tam * 0.8) / 44)
    return
  }
  emitirEstallido(E, x, y, tam, variante, vida)
}

/** Onda expansiva: la del atlas para las neutras/azules; las de color, dibujadas. */
function onda(E: Escena, x: number, y: number, r0: number, r1: number, vida: number, paleta: number, grosor: number): void {
  if ((paleta === PAL_AZUL || paleta === PAL_HIELO) && emitirAnim(E, FX_ONDA, x, y, (r1 * 2) / 128)) return
  emitirAnillo(E, x, y, r0, r1, vida, paleta, grosor)
}

function alGolpe(M: Mundo, e: Extract<EventoJuego, { tipo: 'golpe' }>): void {
  const E = M.E
  const vic = M.p.luchadores[e.victima]
  const atk = M.p.luchadores[e.atacante]
  if (!vic || !atk) return
  const x = e.x
  const y = E.sueloY - e.y
  const dir = vic.x >= atk.x ? 1 : -1
  const nivel = NIVEL[e.fuerza] ?? 1
  const vV = M.vis[e.victima]
  if (e.bloqueado) {
    vV.escudoGolpe = 1
    emitirChispas(E, x, y, 10 + nivel * 3, dir, 1.0, 180, 520, PAL_AZUL, 2.2)
    estallido(E, x, y, 46 + nivel * 10, 1, 0.14)
    if (nivel >= 2) onda(E, x, y, 8, 46, 0.22, PAL_AZUL, 4)
    temblar(E.cam, 1.5 + nivel * 0.8)
    vV.sacudida = Math.max(vV.sacudida, 60)
    M.textos.numero(e.danio, x, y, 2, dir)
    return
  }
  const crit = e.critico
  const variante = crit ? 2 : e.herramienta === 'rayo' ? 3 : e.herramienta === 'spray' ? 4 : 0
  estallido(E, x, y, 58 + nivel * 18 + (crit ? 30 : 0), variante, crit ? 0.22 : 0.17)
  emitirChispas(E, x, y, 8 + nivel * 4 + (crit ? 8 : 0), dir, 0.9, 220, 640 + nivel * 80, crit ? PAL_ORO : PAL_FUEGO)
  if (nivel >= 2 || crit) onda(E, x, y, 8, 40 + nivel * 10, 0.22, crit ? PAL_ORO : PAL_FUEGO, 4)
  // sin sangre: lo que vuela es pelo cortado (mucho más con una herramienta)
  const pelo = (CORTA[e.herramienta] ? 5 + nivel * 3 : 2) + (crit ? 5 : 0)
  emitirMechones(E, x, y, pelo, dir, 0.8 + nivel * 0.15)
  switch (e.herramienta) {
    case 'rayo':
      emitirElectricas(E, x, y, 14, 18)
      break
    case 'maquina':
      emitirElectricas(E, x, y, 3, 6)
      break
    case 'spray':
      for (let k = 0; k < 6; k++) emitirNiebla(E, x, y, dir * azar(80, 260), azar(-80, 40), 18, 0.5, 1)
      break
    case 'sillon':
      emitirPolvo(E, vic.x, E.sueloY, 10, 50, 1.4)
      break
    case 'tornado':
      emitirBrillos(E, x, y, 3, 0, 14, 40)
      break
    default:
      capaHerramienta(M, e.herramienta, x, y, dir)
      break
  }
  if (nivel >= 2) emitirPolvo(E, vic.x, E.sueloY, 4, 30, 1, dir)
  temblar(E.cam, TEMBLOR_EXTRA[e.herramienta] ?? (TEMBLOR[nivel] + (crit ? 3 : 0)))
  empujarZoom(E.cam, ZOOM[nivel] + (crit ? 0.02 : 0))
  vV.sacudida = Math.max(vV.sacudida, (4 + nivel * 2 + (crit ? 4 : 0)) * 16.7)
  vV.destelloMs = 0
  M.textos.numero(e.danio, x, y, crit ? 1 : 0, dir)
  if (crit) {
    // arriba de la cabeza de la víctima: el número de daño sale del punto de contacto
    M.textos.impacto('critico', vic.x, vV.cajaY - 26)
    destellar(M.destello, '#FFF6D8', 0.2, 120)
  }
}

function alEspecial(M: Mundo, e: Extract<EventoJuego, { tipo: 'especial' }>): void {
  const l = M.p.luchadores[e.quien]
  if (!l) return
  const v = M.vis[e.quien]
  const ficha = v.at?.ficha ?? PERSONAJES[l.id]
  if (!ficha) return
  const nombre = e.nombre || ficha.especiales[e.numero - 1]?.nombre || 'Especial'
  iniciarSuperFlash(M.E, M.sf, e.quien, nombre, ficha, M.caras[l.id] ?? null)
  destellar(M.destello, '#FFFFFF', 0.45, 110)
  temblar(M.E.cam, 2.5)
  empujarZoom(M.E.cam, 0.04)
  M.focoMs = 750
  M.focoLado = e.quien
  v.superBlanco = 0.8
  emitirBrillos(M.E, l.x, M.E.sueloY - l.y - alto(v) * 0.5, 10, 1, 50, 120)
  const icono = ficha.especiales[e.numero - 1]?.icono
  if (icono) {
    // el rasgo propio va ENCIMA del oscurecido del super flash (si no, quedaba tapado)
    M.E.parts.capaNueva = 2
    try {
      rasgoEspecial(M.E, l, v, icono)
    } finally {
      M.E.parts.capaNueva = 1
    }
  }
}

function alProyectil(M: Mundo, e: Extract<EventoJuego, { tipo: 'proyectil' }>): void {
  const E = M.E
  const l = M.p.luchadores[e.quien]
  if (!l) return
  const v = M.vis[e.quien]
  const manoX = l.x + l.mira * 52
  const manoY = E.sueloY - l.y - alto(v) * 0.58
  switch (e.proyectil) {
    case 'tornado':
      for (let k = 0; k < 8; k++) emitirNiebla(E, manoX, manoY, l.mira * azar(60, 240), azar(-120, 60), 20, 0.5, 2)
      emitirMechones(E, manoX, manoY, 5, l.mira, 0.7)
      break
    case 'sillon':
      emitirPolvo(E, l.x, E.sueloY, 6, 30, 1, -l.mira)
      break
    case 'spray':
      v.sprayMs = Math.max(v.sprayMs, 480)
      v.sprayDesde = E.ms
      break
    case 'rayo':
      emitirElectricas(E, manoX, manoY, 10, 10)
      estallido(E, manoX, manoY, 70, 3)
      break
    case 'bombo':
      emitirAnillo(E, manoX, manoY, 10, 64, 0.26, PAL_AZUL, 5)
      emitirAnillo(E, manoX, manoY, 6, 46, 0.22, PAL_ORO, 4)
      emitirPolvo(E, l.x + l.mira * 40, E.sueloY, 6, 26, 1, l.mira)
      break
    case 'bala':
      // el fogonazo lo pone el evento `disparo` (uno por tiro)
      break
    case 'graffiti':
      emitirSalpicadura(E, manoX, manoY, 10, G_PINTURA, l.mira > 0 ? -0.3 : Math.PI + 0.3, 0.5, 160, 380, 1)
      for (let k = 0; k < 3; k++) emitirNiebla(E, manoX, manoY, l.mira * azar(60, 180), azar(-30, 10), 18, 0.5, 5)
      break
    case 'trago':
      emitirSalpicadura(E, manoX, manoY, 8, G_TRAGO, l.mira > 0 ? -0.8 : Math.PI + 0.8, 0.5, 100, 260, 1)
      break
    case 'botella':
      emitirBrillos(E, manoX, manoY, 3, 1, 16, 40)
      break
    case 'onda': {
      const bocaY = v.cajaY + v.cajaH * 0.16
      emitirAnillo(E, l.x + l.mira * 24, bocaY, 12, 110, 0.32, PAL_MAGENTA, 7)
      emitirNotas(E, l.x + l.mira * 34, bocaY, 4, 30, 120, 24)
      destellar(M.destello, '#F5D0FE', 0.12, 140)
      break
    }
    case 'gorro':
      E.tajos.nuevo(l.x, v.cajaY + 20, 56, -2.4, -0.5, 10, 160, l.mira, '#FF3B30')
      emitirBrillos(E, l.x + l.mira * 20, v.cajaY + 20, 4, 6, 20, 40)
      break
    case 'pelota':
      emitirPolvo(E, l.x + l.mira * 40, E.sueloY, 5, 20, 0.9, l.mira)
      emitirAnillo(E, l.x + l.mira * 50, E.sueloY - 24, 6, 32, 0.18, PAL_AZUL, 3)
      emitirBrillos(E, l.x + l.mira * 50, E.sueloY - 30, 3, 2, 16, 40)
      break
    case 'leche':
      emitirSalpicadura(E, manoX, manoY, 10, G_LECHE, l.mira > 0 ? -0.2 : Math.PI + 0.2, 0.5, 120, 300, 1)
      break
    case 'panal':
      for (let k = 0; k < 4; k++) emitirNiebla(E, manoX, manoY, l.mira * azar(20, 80), -azar(10, 40), 18, 0.5, 4)
      break
    case 'mate':
      emitirSalpicadura(E, manoX, manoY, 6, G_YERBA, -Math.PI / 2, 1, 60, 180, 0.9)
      emitirNiebla(E, manoX, manoY - 10, 0, -60, 16, 0.6, 2)
      break
    case 'agua':
      for (let k = 0; k < 6; k++) emitirNiebla(E, manoX, manoY, l.mira * azar(30, 120), -azar(30, 80), 18, 0.7, 2)
      emitirSalpicadura(E, manoX, manoY, 6, G_CALIENTE, l.mira > 0 ? -0.2 : Math.PI + 0.2, 0.5, 120, 280, 1)
      break
    case 'guante':
      emitirLlamas(E, manoX, manoY, 10, l.mira * 160, -60, 30, 14)
      emitirEstallido(E, manoX, manoY, 90, 0, 0.18)
      emitirChispas(E, manoX, manoY, 8, l.mira, 0.6, 200, 480, PAL_FUEGO)
      break
    default:
      // nube y sismo: los anuncian sus propios eventos (con la x de dónde aparecen)
      break
  }
}

/**
 * Un cuadro de impacto del atlas: el tajo del golpe sale justo cuando el dibujo pega.
 * `k` = cuál de los impactos de la animación (el combo tiene varios).
 */
export function alImpactoAnimacion(M: Mundo, lado: Lado, k: number): void {
  const E = M.E
  const l = M.p.luchadores[lado]
  const v = M.vis[lado]
  const at = v.at
  if (!l || !at) return
  const h = at.ficha.alturaMundo
  const yPie = E.sueloY - l.y
  const m = l.mira
  const color = at.ficha.color
  const T = E.tajos
  switch (l.anim) {
    case 'golpe':
      T.nuevo(l.x + m * 4, yPie - h * 0.62, 52, -0.75, 0.35, 11, 150, m, '#FFFFFF')
      break
    case 'patada':
      if (l.y > 10) T.nuevo(l.x, yPie - h * 0.5, 66, -0.5, 1.0, 13, 170, m, '#FFFFFF')
      else T.nuevo(l.x - m * 4, yPie - h * 0.42, 70, 1.0, -0.55, 13, 170, m, '#FFFFFF')
      break
    case 'combo': {
      // el último contacto del combo es el fuerte (el atlas dice cuántos tiene)
      const total = at.anims.combo.impactos.length
      if (total >= 2 && k >= total - 1) {
        T.nuevo(l.x, yPie - h * 0.56, 86, -1.2, 0.9, 18, 210, m, color)
        emitirChispas(E, l.x + m * 80, yPie - h * 0.55, 8, m, 0.7, 200, 520, PAL_ORO)
      } else if (k % 2 === 0) {
        T.nuevo(l.x + m * 4, yPie - h * 0.62, 54, -0.75, 0.35, 12, 150, m, color)
      } else {
        T.nuevo(l.x - m * 4, yPie - h * 0.44, 72, 1.0, -0.55, 14, 170, m, color)
      }
      break
    }
    case 'herramienta1':
      T.nuevo(l.x + m * 6, yPie - h * 0.6, 72, -1.25, 0.85, 15, 190, m, color)
      emitirElectricas(E, l.x + m * 74, yPie - h * 0.6, 3, 6)
      break
    case 'herramienta2':
      T.nuevo(l.x + m * 6, yPie - h * 0.6, 60, -0.95, 0.45, 9, 150, m, '#E3ECF5')
      T.nuevo(l.x + m * 10, yPie - h * 0.58, 54, 0.75, -0.6, 7, 170, m, '#FFFFFF')
      break
    case 'especial1':
    case 'especial2': {
      const icono = at.ficha.especiales[l.anim === 'especial1' ? 0 : 1]?.icono
      if (icono && impactoEspecial(E, l, v, icono, k)) break
      const manoX = l.x + m * 52
      const manoY = yPie - h * 0.58
      if (icono === 'rayo') {
        estallido(E, manoX, manoY, 90, 3, 0.2)
        emitirElectricas(E, manoX, manoY, 12, 14)
        T.nuevo(l.x, yPie - h * 0.55, 90, -0.6, 0.6, 16, 200, m, color)
      } else if (icono === 'tijera') {
        for (let i = 0; i < 6; i++) emitirNiebla(E, manoX, manoY, m * azar(80, 260), azar(-90, 50), 18, 0.45, 2)
        emitirBrillos(E, manoX, manoY, 6, 0, 20, 60)
      } else if (icono === 'sillon') {
        T.nuevo(l.x, yPie - h * 0.6, 96, -1.4, 0.7, 20, 230, m, color)
        emitirPolvo(E, l.x, E.sueloY, 6, 34, 1.2, -m)
      } else if (icono === 'spray') {
        if (E.ms - v.sprayDesde > 700) {
          v.sprayMs = Math.max(v.sprayMs, 480)
          v.sprayDesde = E.ms
        }
      }
      break
    }
    default:
      break
  }
}

export function procesarEventos(M: Mundo, eventos: readonly EventoJuego[]): void {
  const E = M.E
  // El remate trae su `ko` en el mismo tick: ese K.O. no pisa el cartel de «¡AL CERO!».
  const conRemate = eventos.some((e) => e.tipo === 'final_al_cero')
  for (let i = 0; i < eventos.length; i++) {
    const e = eventos[i]
    switch (e.tipo) {
      case 'golpe':
        alGolpe(M, e)
        break
      case 'combo':
        M.textos.combo(e.quien, e.golpes)
        break
      case 'especial':
        alEspecial(M, e)
        break
      case 'proyectil':
        alProyectil(M, e)
        break
      case 'swing': {
        const l = M.p.luchadores[e.quien]
        if (l && !tieneImpactos(M.vis[e.quien], l)) alImpactoAnimacion(M, e.quien, 0)
        break
      }
      case 'guardia_rota': {
        const v = M.vis[e.quien]
        const x = e.x
        const y = E.sueloY - (e.y > 30 ? e.y : alto(v) * 0.55)
        emitirEsquirlas(E, x, y, 26, P_VIDRIO, 1)
        onda(E, x, y, 12, 90, 0.32, PAL_AZUL, 6)
        estallido(E, x, y, 110, 1, 0.2)
        const l = M.p.luchadores[e.quien]
        M.textos.impacto('guardia', l ? l.x : x, v.cajaY - 26)
        temblar(E.cam, 7)
        destellar(M.destello, '#CFEFFF', 0.28, 160)
        v.escudoGolpe = 1
        break
      }
      case 'congelado': {
        const l = M.p.luchadores[e.quien]
        const v = M.vis[e.quien]
        if (!l) break
        const cx = centroX(v)
        const cy = centroY(v)
        emitirEsquirlas(E, cx, cy, 12, P_HIELO, 0.6)
        emitirBrillos(E, cx, cy, 10, 2, 40, 30)
        for (let k = 0; k < 6; k++) emitirNiebla(E, cx + azar(-30, 30), cy + azar(-50, 50), azar(-40, 40), azar(-30, 10), 22, 0.6, 1)
        M.textos.impacto('congelado', l.x, v.cajaY - 30)
        destellar(M.destello, '#BDEFFF', 0.25, 160)
        temblar(E.cam, 3)
        break
      }
      case 'descongelado': {
        if (!e.roto) break // derretido: las gotas salen solas al apagarse el efecto
        const v = M.vis[e.quien]
        const cx = centroX(v)
        const cy = centroY(v)
        emitirEsquirlas(E, cx, cy, 24, P_HIELO, 1.2)
        emitirBrillos(E, cx, cy, 8, 2, 40, 40)
        onda(E, cx, cy, 10, 80, 0.3, PAL_HIELO, 5)
        temblar(E.cam, 5)
        v.rotoMs = E.ms
        break
      }
      case 'electrocutado': {
        const l = M.p.luchadores[e.quien]
        const v = M.vis[e.quien]
        if (!l) break
        const cx = centroX(v)
        const cy = centroY(v)
        emitirElectricas(E, cx, cy, 18, 30)
        estallido(E, cx, cy, 90, 3, 0.2)
        emitirAnim(E, FX_RAYO, l.x, v.cajaY - 30, 1.5)
        emitirChispas(E, cx, cy, 8, 0, Math.PI, 150, 420, PAL_ELECTRICA, 2)
        M.textos.impacto('electrocutado', l.x, v.cajaY - 30)
        destellar(M.destello, '#FFF4B0', 0.22, 140)
        break
      }
      case 'curacion': {
        const l = M.p.luchadores[e.quien]
        const v = M.vis[e.quien]
        if (!l) break
        M.textos.curar(e.quien, e.cantidad, l.x, v.cajaY - 14)
        emitirBrillos(E, centroX(v), centroY(v), 4, 4, 40, 90)
        emitirCruces(E, centroX(v), centroY(v), 2, 30)
        break
      }
      case 'agarre': {
        const vic = M.p.luchadores[e.victima]
        const atk = M.p.luchadores[e.atacante]
        const vV = M.vis[e.victima]
        if (!vic || !atk) break
        const x = (vic.x + atk.x) / 2
        const y = centroY(vV)
        estallido(E, x, y, 110, 0, 0.18)
        emitirBrillos(E, x, y, 6, 1, 30, 40)
        emitirAnillo(E, x, y, 10, 70, 0.26, PAL_FUEGO, 5)
        emitirPolvo(E, atk.x, E.sueloY, 8, 40, 1.2)
        temblar(E.cam, 6)
        empujarZoom(E.cam, 0.03)
        vV.sacudida = Math.max(vV.sacudida, 200)
        M.focoMs = Math.max(M.focoMs, 500)
        M.focoLado = e.atacante
        break
      }
      case 'aturdido': {
        const l = M.p.luchadores[e.quien]
        const v = M.vis[e.quien]
        if (!l) break
        emitirBrillos(E, l.x, v.cajaY, 8, 1, 40, 30)
        emitirAnillo(E, l.x, v.cajaY - 6, 10, 70, 0.28, PAL_ORO, 4)
        M.textos.impacto('aturdido', l.x, v.cajaY - 30)
        destellar(M.destello, '#FFF3B0', 0.16, 140)
        break
      }
      case 'mareado': {
        const l = M.p.luchadores[e.quien]
        const v = M.vis[e.quien]
        if (!l) break
        emitirSalpicadura(E, centroX(v), v.cajaY + 20, 10, G_TRAGO, -Math.PI / 2, 1.3, 60, 200, 1)
        emitirBrillos(E, l.x, v.cajaY, 6, 3, 36, 30)
        emitirAnillo(E, l.x, v.cajaY - 6, 10, 64, 0.28, PAL_VIOLETA, 4)
        M.textos.impacto('mareado', l.x, v.cajaY - 30)
        break
      }
      case 'quemado': {
        const l = M.p.luchadores[e.quien]
        const v = M.vis[e.quien]
        if (!l) break
        const cx = centroX(v)
        const cy = centroY(v)
        for (let k = 0; k < 8; k++) emitirNiebla(E, cx + azar(-30, 30), cy + azar(-50, 40), azar(-40, 40), -azar(60, 140), 20, 0.8, 2)
        estallido(E, cx, cy, 90, 0, 0.18)
        emitirChispas(E, cx, cy, 8, 0, Math.PI, 120, 360, PAL_FUEGO, 2)
        M.textos.impacto('quemado', l.x, v.cajaY - 30)
        destellar(M.destello, '#FFD0A0', 0.14, 140)
        break
      }
      case 'nube': {
        // el pañal cayó: «plaf» y aparece la nube
        for (let k = 0; k < 8; k++) emitirNiebla(E, e.x + azar(-40, 40), E.sueloY - azar(4, 30), azar(-90, 90), -azar(10, 60), 26, 0.7, 4)
        emitirPolvo(E, e.x, E.sueloY, 8, 40, 1.1)
        emitirMoscas(E, e.x, E.sueloY - 50, 3, 2)
        temblar(E.cam, 2.5)
        break
      }
      case 'sismo': {
        // el puño al piso: de acá sale la onda sísmica
        temblar(E.cam, 13)
        empujarZoom(E.cam, 0.035)
        emitirPolvo(E, e.x, E.sueloY, 16, 70, 1.6)
        emitirTrozos(E, e.x, E.sueloY - 6, 10, 0, 1.1)
        emitirAnillo(E, e.x, E.sueloY - 4, 10, 130, 0.36, PAL_TIERRA, 7)
        destellar(M.destello, '#FFE2B0', 0.18, 160)
        break
      }
      case 'disparo': {
        // fogonazo de dibujo animado en la boca del arma, humito y el casquillo que salta
        const l = M.p.luchadores[e.quien]
        const y = E.sueloY - e.y
        const m = l ? l.mira : 1
        estallido(E, e.x, y, 64, 2, 0.12)
        emitirChispas(E, e.x, y, 6, m, 0.5, 200, 520, PAL_ORO, 2)
        emitirNiebla(E, e.x, y, m * 40, -20, 12, 0.45, 3)
        emitirTrozos(E, e.x - m * 16, y - 4, 1, 2, 0.6, -m)
        temblar(E.cam, 1.6)
        if (l) M.vis[e.quien].sacudida = Math.max(M.vis[e.quien].sacudida, 50)
        break
      }
      case 'turbo':
        M.textos.anuncio('turbo', 'TURBO')
        destellar(M.destello, '#FFD34D', 0.16, 220)
        break
      case 'salto': {
        const l = M.p.luchadores[e.quien]
        if (!l) break
        emitirPolvo(E, l.x, E.sueloY, 3, 16, 0.6)
        const v = M.vis[e.quien]
        v.aplastar = -0.07
        v.aplastarVel = 0
        break
      }
      case 'aterrizaje': {
        const l = M.p.luchadores[e.quien]
        if (!l) break
        emitirPolvo(E, l.x, E.sueloY, e.fuerte ? 10 : 5, 30, e.fuerte ? 1.3 : 0.8)
        const v = M.vis[e.quien]
        v.aplastar = e.fuerte ? 0.16 : 0.1
        v.aplastarVel = 0
        if (e.fuerte) temblar(E.cam, 3)
        break
      }
      case 'dash': {
        const l = M.p.luchadores[e.quien]
        if (!l) break
        const haciaAtras = l.vx !== 0 ? -Math.sign(l.vx) : -l.mira
        emitirPolvo(E, l.x, E.sueloY, 6, 18, 1, haciaAtras)
        for (let k = 0; k < 3; k++) emitirNiebla(E, l.x, E.sueloY - azar(30, 150), haciaAtras * azar(120, 260), 0, 12, 0.3, 2)
        break
      }
      case 'derribo': {
        const l = M.p.luchadores[e.quien]
        if (!l) break
        emitirPolvo(E, l.x, E.sueloY, 14, 70, 1.6)
        temblar(E.cam, 6)
        break
      }
      case 'burla': {
        const l = M.p.luchadores[e.quien]
        if (!l) break
        emitirBrillos(E, l.x + l.mira * 40, E.sueloY - l.y - alto(M.vis[e.quien]) * 0.7, 6, 1, 20, 60)
        break
      }
      case 'round':
        M.textos.anuncio(e.final ? 'round_final' : 'round', e.final ? 'ROUND FINAL' : `ROUND ${e.numero}`)
        M.perdedorKo = null
        break
      case 'pelea':
        M.textos.anuncio('pelea', '¡A PELEAR!')
        destellar(M.destello, '#FFFFFF', 0.18, 140)
        break
      case 'ko': {
        M.perdedorKo = e.perdedor
        const l = M.p.luchadores[e.perdedor]
        const v = M.vis[e.perdedor]
        if (!conRemate) M.textos.anuncio('ko', 'K.O.')
        if (e.perfecto) M.textos.anuncio('perfecto', 'PERFECTO', conRemate ? 1700 : 1150)
        destellar(M.destello, '#FFFFFF', 0.6, 220)
        temblar(E.cam, 11)
        empujarZoom(E.cam, 0.05)
        if (l) {
          const cx = centroX(v)
          const cy = centroY(v)
          emitirMechones(E, cx, v.cajaY + 30, 22, 0, 1.1)
          estallido(E, cx, cy, 160, 0, 0.26)
          emitirChispas(E, cx, cy, 20, 0, Math.PI, 300, 900, PAL_FUEGO)
        }
        break
      }
      case 'tiempo':
        M.textos.anuncio('tiempo', '¡TIEMPO!')
        break
      case 'final_disponible': {
        M.textos.anuncio('dejalo', '¡DEJALO AL CERO!', 0, true)
        M.perdedorKo = otro(e.ganador)
        M.prepararRapado?.(otro(e.ganador))
        break
      }
      case 'final_al_cero': {
        const perdedor = otro(e.ganador)
        const v = M.vis[perdedor]
        // la voladura de pelo: el remate deja al rival pelado (sprites de su hoja de rapado)
        const cabeza = M.rapar?.(perdedor) ?? null
        const cx = cabeza ? cabeza.x : centroX(v)
        const cy = cabeza ? cabeza.y : v.cajaY + 20
        M.textos.terminarPersistente()
        M.textos.anuncio('alcero', '¡AL CERO!')
        emitirMechones(E, cx, cy, 70, 0, 1.6)
        emitirBrillos(E, cx, cy, 16, 1, 50, 120)
        estallido(E, cx, cy + 10, 200, 2, 0.3)
        onda(E, cx, cy + 10, 14, 140, 0.4, PAL_ORO, 7)
        destellar(M.destello, '#FFFFFF', 0.75, 260)
        temblar(E.cam, 14)
        empujarZoom(E.cam, 0.06)
        break
      }
      default:
        break
    }
  }
}
