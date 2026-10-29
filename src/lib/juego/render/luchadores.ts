/**
 * Los luchadores en el canvas: sprite del atlas (apoyo ax/ay, escala alturaMundo/alturaReferencia,
 * espejo por `mira`), respiración, aplastado al caer, sombra, reflejo en el piso, destello blanco,
 * hielo con cristales, arcos eléctricos, escudo de guardia, aura de crítico, post-imágenes y
 * estrellitas de mareo.
 *
 * Los tintes (blanco, hielo, aura, silueta, paleta alternativa) se pintan UNA vez por cuadro del
 * atlas en un lienzo aparte y se reusan: en el cuadro sólo hay drawImage.
 */
import type { AnimacionAtlas, AtlasPersonaje, ClaveAnimacion, CuadroAtlas, FichaPersonaje, Lado, LuchadorEstado } from '../tipos'
import { CLAVES_ANIMACION } from '../tipos'
import { cuadroFx, dibujarFx, fx, FX_ARCO, FX_ESTRELLAS, FX_HIELO, type FxAnim } from './efectos'
import { caminoRedondeado, enMundo, spriteMundo, type Escena } from './escena'
import { contexto, crearLienzo, liberarLienzo, medidas } from './lienzo'
import { emitirBrillos, emitirElectricas, emitirGotas, emitirNiebla } from './particulas'
import { acotar, azar, ruido, salidaConRebote, suavizar, TAU } from './util'

export const TINTE_ALTERNO = 0
export const TINTE_BLANCO = 1
export const TINTE_HIELO = 2
export const TINTE_AURA = 3
export const TINTE_SILUETA = 4
const PAD_TINTE = [0, 0, 0, 12, 0]

/** Si a un atlas le falta una animación, se usa la primera de estas que tenga. */
const RESPALDOS: Record<ClaveAnimacion, readonly ClaveAnimacion[]> = {
  quieto: [],
  caminar: ['quieto'],
  correr: ['caminar', 'quieto'],
  dash: ['correr', 'caminar', 'quieto'],
  guardia: ['quieto'],
  agachado: ['guardia', 'quieto'],
  saltar: ['caer', 'quieto'],
  caer: ['saltar', 'quieto'],
  golpe: ['quieto'],
  patada: ['golpe', 'quieto'],
  combo: ['patada', 'golpe', 'quieto'],
  herramienta1: ['golpe', 'quieto'],
  herramienta2: ['herramienta1', 'golpe', 'quieto'],
  especial1: ['herramienta1', 'golpe', 'quieto'],
  especial2: ['herramienta2', 'herramienta1', 'golpe', 'quieto'],
  danio: ['quieto'],
  ko: ['danio', 'quieto'],
  levantarse: ['agachado', 'quieto'],
  victoria: ['burla', 'quieto'],
  burla: ['victoria', 'quieto'],
}

interface AnimPreparada {
  /** Índices en `cuadros` (lista plana de todo el atlas). */
  idx: number[]
  impactos: number[]
}

export interface AtlasPreparado {
  ficha: FichaPersonaje
  imagen: CanvasImageSource
  /** Unidades de mundo por px del atlas. */
  escala: number
  cuadros: CuadroAtlas[]
  anims: Record<ClaveAnimacion, AnimPreparada>
  /** [tinte][cuadro plano] → lienzo, creado la primera vez que hace falta. */
  tintes: (HTMLCanvasElement | undefined)[][]
  efectos: Record<string, CuadroAtlas[]>
  /** Medidas del lienzo del reflejo (px del atlas). */
  reflejoMitad: number
  reflejoAlto: number
}

function cuadroValido(c: CuadroAtlas | undefined, W: number, H: number): c is CuadroAtlas {
  if (!c || typeof c !== 'object') return false
  if (![c.x, c.y, c.w, c.h, c.ax, c.ay].every((n) => typeof n === 'number' && Number.isFinite(n))) return false
  if (c.w <= 0 || c.h <= 0) return false
  // Safari viejo tira IndexSizeError con un recorte fuera de la imagen
  if (W > 0 && H > 0 && (c.x < 0 || c.y < 0 || c.x + c.w > W + 0.5 || c.y + c.h > H + 0.5)) return false
  return true
}

/** Prepara un atlas para dibujar. Devuelve null si no tiene ni un cuadro usable. */
export function prepararAtlas(ficha: FichaPersonaje, datos: AtlasPersonaje, imagen: CanvasImageSource): AtlasPreparado | null {
  const { w: W, h: H } = medidas(imagen)
  const cuadros: CuadroAtlas[] = []
  const propias: Partial<Record<ClaveAnimacion, AnimPreparada>> = {}
  const animaciones = (datos.animaciones ?? {}) as Partial<Record<ClaveAnimacion, AnimacionAtlas>>
  for (const clave of CLAVES_ANIMACION) {
    const a = animaciones[clave]
    if (!a || !Array.isArray(a.cuadros)) continue
    const idx: number[] = []
    for (const c of a.cuadros) {
      if (!cuadroValido(c, W, H)) continue
      idx.push(cuadros.length)
      cuadros.push(c)
    }
    if (idx.length === 0) continue
    const impactos = Array.isArray(a.impactos)
      ? a.impactos.filter((n) => Number.isInteger(n) && n >= 0 && n < idx.length)
      : []
    propias[clave] = { idx, impactos }
  }
  let primera = propias.quieto
  if (!primera) {
    for (const clave of CLAVES_ANIMACION) {
      if (propias[clave]) {
        primera = propias[clave]
        break
      }
    }
  }
  if (!primera) return null
  const anims = {} as Record<ClaveAnimacion, AnimPreparada>
  for (const clave of CLAVES_ANIMACION) {
    let elegida = propias[clave]
    if (!elegida) {
      for (const r of RESPALDOS[clave]) {
        if (propias[r]) {
          elegida = propias[r]
          break
        }
      }
    }
    anims[clave] = elegida ?? primera
  }
  const ref = datos.alturaReferencia > 0 ? datos.alturaReferencia : cuadros[primera.idx[0]].h
  let mitad = 8
  for (const c of cuadros) mitad = Math.max(mitad, c.ax, c.w - c.ax)
  const efectos: Record<string, CuadroAtlas[]> = {}
  for (const [nombre, ef] of Object.entries(datos.efectos ?? {})) {
    const lista = Array.isArray(ef?.cuadros) ? ef.cuadros.filter((c) => cuadroValido(c, W, H)) : []
    if (lista.length) efectos[nombre] = lista
  }
  return {
    ficha,
    imagen,
    escala: ficha.alturaMundo / ref,
    cuadros,
    anims,
    tintes: [[], [], [], [], []],
    efectos,
    reflejoMitad: Math.ceil(mitad + 2),
    reflejoAlto: Math.ceil(ref * 0.62),
  }
}

export function liberarAtlas(at: AtlasPreparado): void {
  for (const lista of at.tintes) {
    for (const c of lista) liberarLienzo(c)
    lista.length = 0
  }
}

/** Lo que el render necesita de rapado.json (ver RecursoRapado en recursos.ts). */
export interface FuenteRapado {
  datos: { animaciones?: Partial<Record<'danio' | 'ko', { cuadros: CuadroAtlas[] }>> }
  imagen: CanvasImageSource
}

/**
 * El atlas «pelado» del remate ¡AL CERO!: el mismo atlas con los cuadros de `danio` y `ko`
 * cambiados por los de rapado.png (mismo w, h, ax, ay y orden: scripts/juego/generar_rapado.py).
 * Las dos imágenes van a un lienzo (atlas arriba, rapados abajo) y el resto del render (tintes,
 * reflejo, estela) no se entera. Una animación que no encaja cuadro por cuadro queda con pelo.
 */
export function prepararAtlasPelado(
  ficha: FichaPersonaje,
  datos: AtlasPersonaje,
  imagen: CanvasImageSource,
  rapado: FuenteRapado,
): { at: AtlasPreparado; lienzo: HTMLCanvasElement } | null {
  const { w: W, h: H } = medidas(imagen)
  const { w: RW, h: RH } = medidas(rapado.imagen)
  if (!(W > 0 && H > 0 && RW > 0 && RH > 0)) return null
  const animaciones = { ...datos.animaciones }
  let cambios = 0
  for (const clave of ['danio', 'ko'] as const) {
    const base = datos.animaciones?.[clave]
    const pelados = rapado.datos.animaciones?.[clave]?.cuadros
    if (!base || !Array.isArray(base.cuadros) || !Array.isArray(pelados) || pelados.length !== base.cuadros.length) continue
    const encaja = pelados.every((c, i) => {
      const o = base.cuadros[i]
      return cuadroValido(c, RW, RH) && !!o && c.w === o.w && c.h === o.h
    })
    if (!encaja) continue
    animaciones[clave] = { cuadros: pelados.map((c) => ({ ...c, y: c.y + H })), impactos: base.impactos }
    cambios++
  }
  if (cambios === 0) return null
  const lienzo = crearLienzo(Math.max(W, RW), H + RH)
  const g = contexto(lienzo)
  g.drawImage(imagen, 0, 0)
  g.drawImage(rapado.imagen, 0, H)
  const at = prepararAtlas(ficha, { ...datos, animaciones }, lienzo)
  if (!at) {
    liberarLienzo(lienzo)
    return null
  }
  return { at, lienzo }
}

/**
 * Cambia el atlas de un luchador sin reiniciar su estado visual (estela, destello, escudo). El
 * reflejo se rehace sólo si el atlas nuevo no entra en el lienzo del anterior.
 */
export function cambiarAtlasVisual(v: VisualLuchador, at: AtlasPreparado, conReflejo: boolean): void {
  const viejo = v.at
  v.at = at
  if (!conReflejo || !v.reflejo) return
  if (viejo && at.reflejoMitad <= viejo.reflejoMitad && at.reflejoAlto <= viejo.reflejoAlto) return
  liberarLienzo(v.reflejo)
  const r = crearLienzo(at.reflejoMitad * 2, at.reflejoAlto)
  const g = contexto(r)
  const d = g.createLinearGradient(0, r.height, 0, 0)
  d.addColorStop(0, 'rgba(0,0,0,1)')
  d.addColorStop(0.35, 'rgba(0,0,0,0.45)')
  d.addColorStop(1, 'rgba(0,0,0,0)')
  v.reflejo = r
  v.reflejoCtx = g
  v.reflejoDeg = d
}

function crearTinte(at: AtlasPreparado, tinte: number, plano: number): HTMLCanvasElement {
  const f = at.cuadros[plano]
  const pad = PAD_TINTE[tinte]
  const c = crearLienzo(f.w + pad * 2, f.h + pad * 2)
  const g = contexto(c)
  if (tinte === TINTE_AURA) {
    // silueta dorada repetida alrededor: un halo suave sin filtros ni sombras
    const s = crearLienzo(f.w, f.h)
    const gs = contexto(s)
    gs.drawImage(at.imagen, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h)
    gs.globalCompositeOperation = 'source-in'
    gs.fillStyle = '#FFC93A'
    gs.fillRect(0, 0, f.w, f.h)
    const anillos: [number, number][] = [
      [pad, 0.13],
      [pad * 0.66, 0.22],
      [pad * 0.33, 0.38],
    ]
    for (const [r, a] of anillos) {
      g.globalAlpha = a
      for (let k = 0; k < 10; k++) {
        const ang = (k / 10) * TAU
        g.drawImage(s, pad + Math.cos(ang) * r, pad + Math.sin(ang) * r)
      }
    }
    g.globalAlpha = 1
    liberarLienzo(s)
    return c
  }
  g.drawImage(at.imagen, f.x, f.y, f.w, f.h, pad, pad, f.w, f.h)
  if (tinte === TINTE_BLANCO || tinte === TINTE_SILUETA) {
    g.globalCompositeOperation = 'source-in'
    g.fillStyle = tinte === TINTE_BLANCO ? '#FFFFFF' : at.ficha.color
    g.fillRect(0, 0, c.width, c.height)
  } else if (tinte === TINTE_HIELO) {
    g.globalCompositeOperation = 'source-atop'
    g.fillStyle = 'rgba(165,228,255,0.55)'
    g.fillRect(0, 0, c.width, c.height)
    const d = g.createLinearGradient(0, 0, c.width * 0.5, c.height)
    d.addColorStop(0, 'rgba(255,255,255,0.42)')
    d.addColorStop(0.45, 'rgba(255,255,255,0.03)')
    d.addColorStop(1, 'rgba(90,180,255,0.22)')
    g.fillStyle = d
    g.fillRect(0, 0, c.width, c.height)
  } else if (tinte === TINTE_ALTERNO) {
    // segunda paleta para la pelea espejo (mismo barbero de los dos lados)
    g.globalCompositeOperation = 'source-atop'
    g.fillStyle = 'rgba(255,44,92,0.27)'
    g.fillRect(0, 0, c.width, c.height)
  }
  return c
}

/** Registro de la fuente de dibujo (sin crear objetos por cuadro). */
const F = { img: null as CanvasImageSource | null, sx: 0, sy: 0, sw: 0, sh: 0, ax: 0, ay: 0 }

function fuente(at: AtlasPreparado, plano: number, tinte: number): void {
  const f = at.cuadros[plano]
  if (tinte < 0) {
    F.img = at.imagen
    F.sx = f.x
    F.sy = f.y
    F.sw = f.w
    F.sh = f.h
    F.ax = f.ax
    F.ay = f.ay
    return
  }
  const lista = at.tintes[tinte]
  let c = lista[plano]
  if (!c) {
    c = crearTinte(at, tinte, plano)
    lista[plano] = c
  }
  const pad = PAD_TINTE[tinte]
  F.img = c
  F.sx = 0
  F.sy = 0
  F.sw = c.width
  F.sh = c.height
  F.ax = f.ax + pad
  F.ay = f.ay + pad
}

/** Pinta un cuadro con apoyo en (x, yPie) de mundo. */
function pintar(
  E: Escena,
  at: AtlasPreparado,
  plano: number,
  tinte: number,
  x: number,
  yPie: number,
  mira: number,
  sx: number,
  sy: number,
  rot: number,
  alfa: number,
): void {
  fuente(at, plano, tinte)
  if (!F.img) return
  const ctx = E.ctx
  const k = E.cam.esc
  const kx = k * at.escala * sx * (mira < 0 ? -1 : 1)
  const ky = k * at.escala * sy
  // el apoyo cae en un px entero: el pixel art no «nada» al moverse
  const ex = Math.round(E.cam.tx + k * x)
  const fy = Math.round(E.cam.ty + k * yPie)
  if (rot === 0) {
    ctx.setTransform(kx, 0, 0, ky, ex, fy)
  } else {
    const c = Math.cos(rot)
    const s = Math.sin(rot)
    ctx.setTransform(kx * c, kx * s, -ky * s, ky * c, ex, fy)
  }
  ctx.globalAlpha = alfa
  ctx.drawImage(F.img, F.sx, F.sy, F.sw, F.sh, -F.ax, -F.ay, F.sw, F.sh)
}

export function planoDe(at: AtlasPreparado, l: LuchadorEstado): number {
  const anim = at.anims[l.anim] ?? at.anims.quieto
  const idx = anim.idx
  let c = l.cuadro | 0
  if (c < 0) c = 0
  else if (c >= idx.length) c = idx.length - 1
  return idx[c]
}

// ─── Estado visual de cada luchador ──────────────────────────────────────────

const MAX_ESTELA = 6
const VIDA_ESTELA = 260
const MAX_CRISTALES = 10
const PUNTOS_ARCO = 8
const MAX_ARCOS = 4

export interface VisualLuchador {
  lado: Lado
  at: AtlasPreparado | null
  /** Paleta alternativa (pelea espejo, lado 1). */
  alterno: boolean
  fase: number
  plano: number
  cajaX: number
  cajaY: number
  cajaW: number
  cajaH: number
  aplastar: number
  aplastarVel: number
  /** ms de temblor de la víctima mientras dura el hitstop. */
  sacudida: number
  /**
   * ms reales desde el último destello blanco. El motor deja `destello` quieto durante el hitstop
   * y la cámara lenta: si se dibujara con ese valor, el que recibe quedaría blanco un buen rato.
   */
  destelloMs: number
  destelloPrev: number
  escudoVis: number
  escudoGolpe: number
  superBlanco: number
  estX: Float32Array
  estY: Float32Array
  estT: Float64Array
  estMira: Int8Array
  estPlano: Int16Array
  estN: number
  estCab: number
  estAcum: number
  congelado: boolean
  cristalMs: number
  rotoMs: number
  nCristales: number
  cristales: Float32Array
  arcos: Float32Array
  nArcos: number
  arcosMs: number
  sprayMs: number
  sprayDesde: number
  animPrev: string
  tickPrev: number
  cuadroPrev: number
  reflejo: HTMLCanvasElement | null
  reflejoCtx: CanvasRenderingContext2D | null
  reflejoDeg: CanvasGradient | null
}

export function crearVisual(lado: Lado): VisualLuchador {
  return {
    lado,
    at: null,
    alterno: false,
    fase: lado * 1.9,
    plano: 0,
    cajaX: 0,
    cajaY: 0,
    cajaW: 0,
    cajaH: 0,
    aplastar: 0,
    aplastarVel: 0,
    sacudida: 0,
    destelloMs: 1e9,
    destelloPrev: 0,
    escudoVis: 0,
    escudoGolpe: 0,
    superBlanco: 0,
    estX: new Float32Array(MAX_ESTELA),
    estY: new Float32Array(MAX_ESTELA),
    estT: new Float64Array(MAX_ESTELA),
    estMira: new Int8Array(MAX_ESTELA),
    estPlano: new Int16Array(MAX_ESTELA),
    estN: 0,
    estCab: 0,
    estAcum: 30,
    congelado: false,
    cristalMs: 0,
    rotoMs: -1e9,
    nCristales: 0,
    cristales: new Float32Array(MAX_CRISTALES * 5),
    arcos: new Float32Array(MAX_ARCOS * PUNTOS_ARCO * 2),
    nArcos: 0,
    arcosMs: 0,
    sprayMs: 0,
    sprayDesde: -1e9,
    animPrev: '',
    tickPrev: 0,
    cuadroPrev: -1,
    reflejo: null,
    reflejoCtx: null,
    reflejoDeg: null,
  }
}

/** Arranca de cero (partida nueva) con el atlas de ese lado. */
export function reiniciarVisual(v: VisualLuchador, at: AtlasPreparado | null, alterno: boolean, conReflejo: boolean): void {
  const cambiaAtlas = v.at !== at
  v.at = at
  v.alterno = alterno
  v.aplastar = 0
  v.aplastarVel = 0
  v.sacudida = 0
  v.destelloMs = 1e9
  v.destelloPrev = 0
  v.escudoVis = 0
  v.escudoGolpe = 0
  v.superBlanco = 0
  v.estN = 0
  v.estAcum = 30
  v.congelado = false
  v.nCristales = 0
  v.nArcos = 0
  v.sprayMs = 0
  v.animPrev = ''
  v.cuadroPrev = -1
  if (cambiaAtlas || (conReflejo && !v.reflejo)) {
    liberarLienzo(v.reflejo)
    v.reflejo = null
    v.reflejoCtx = null
    v.reflejoDeg = null
    if (at && conReflejo) {
      const r = crearLienzo(at.reflejoMitad * 2, at.reflejoAlto)
      const g = contexto(r)
      const d = g.createLinearGradient(0, r.height, 0, 0)
      d.addColorStop(0, 'rgba(0,0,0,1)')
      d.addColorStop(0.35, 'rgba(0,0,0,0.45)')
      d.addColorStop(1, 'rgba(0,0,0,0)')
      v.reflejo = r
      v.reflejoCtx = g
      v.reflejoDeg = d
    }
  }
}

export function liberarVisual(v: VisualLuchador): void {
  liberarLienzo(v.reflejo)
  v.reflejo = null
  v.reflejoCtx = null
  v.reflejoDeg = null
  v.at = null
}

function cajaDe(at: AtlasPreparado, plano: number, x: number, yPie: number, mira: number, v: VisualLuchador): void {
  const f = at.cuadros[plano]
  const e = at.escala
  v.cajaW = f.w * e
  v.cajaH = f.h * e
  v.cajaX = mira < 0 ? x - (f.w - f.ax) * e : x - f.ax * e
  v.cajaY = yPie - f.ay * e
}

function iconoEnCurso(at: AtlasPreparado, l: LuchadorEstado): string | null {
  if (l.anim === 'especial1') return at.ficha.especiales[0]?.icono ?? null
  if (l.anim === 'especial2') return at.ficha.especiales[1]?.icono ?? null
  return null
}

function generarCristales(v: VisualLuchador, x: number, yPie: number): void {
  const n = MAX_CRISTALES
  for (let k = 0; k < n; k++) {
    const lado = k % 3
    let bx: number
    let by: number
    let ang: number
    if (lado === 0) {
      bx = v.cajaX + v.cajaW * azar(0.08, 0.92)
      by = yPie - azar(0, 6)
      ang = -Math.PI / 2 + azar(-0.75, 0.75)
    } else if (lado === 1) {
      bx = v.cajaX + azar(0, 8)
      by = v.cajaY + v.cajaH * azar(0.2, 0.95)
      ang = Math.PI + azar(0, 0.55)
    } else {
      bx = v.cajaX + v.cajaW - azar(0, 8)
      by = v.cajaY + v.cajaH * azar(0.2, 0.95)
      ang = -azar(0, 0.55)
    }
    const o = k * 5
    v.cristales[o] = bx - x
    v.cristales[o + 1] = by - yPie
    v.cristales[o + 2] = ang
    v.cristales[o + 3] = azar(14, 36)
    v.cristales[o + 4] = azar(6, 12)
  }
  v.nCristales = n
}

function generarArcos(v: VisualLuchador, x: number, yPie: number, n: number): void {
  const total = Math.min(MAX_ARCOS, n)
  for (let a = 0; a < total; a++) {
    const x0 = v.cajaX + Math.random() * v.cajaW - x
    const y0 = v.cajaY + Math.random() * v.cajaH * 0.85 - yPie
    const ang = Math.random() * TAU
    const largo = azar(26, 72)
    const x1 = x0 + Math.cos(ang) * largo
    const y1 = y0 + Math.sin(ang) * largo
    const px = -Math.sin(ang)
    const py = Math.cos(ang)
    for (let s = 0; s < PUNTOS_ARCO; s++) {
      const t = s / (PUNTOS_ARCO - 1)
      const desvio = s === 0 || s === PUNTOS_ARCO - 1 ? 0 : (Math.random() - 0.5) * 18
      const o = (a * PUNTOS_ARCO + s) * 2
      v.arcos[o] = x0 + (x1 - x0) * t + px * desvio
      v.arcos[o + 1] = y0 + (y1 - y0) * t + py * desvio
    }
  }
  v.nArcos = total
}

/** Emite `tasa` por segundo de algo (entero, con el resto al azar). */
function cuantasPorTasa(tasa: number, dtS: number): number {
  const n = tasa * dtS
  const entero = Math.floor(n)
  return entero + (Math.random() < n - entero ? 1 : 0)
}

/**
 * Avanza lo visual de un luchador. Devuelve una máscara con los impactos de la animación que se
 * cruzaron en este cuadro (bit k = impacto k del atlas): sirve para sincronizar los tajos con el
 * dibujo aunque el motor avise el golpe en otro momento.
 */
export function actualizarVisual(E: Escena, l: LuchadorEstado, v: VisualLuchador, dtMs: number): number {
  const dtS = dtMs / 1000
  v.sacudida = Math.max(0, v.sacudida - dtMs)
  // un destello nuevo del motor (sube) arranca el pulso; el resto lo cuenta el reloj real
  if (l.destello > v.destelloPrev) v.destelloMs = 0
  else v.destelloMs += dtMs
  v.destelloPrev = l.destello
  const enGuardia = l.estado === 'guardia'
  v.escudoVis = suavizar(v.escudoVis, enGuardia ? 1 : 0, enGuardia ? 20 : 11, dtS)
  v.escudoGolpe = suavizar(v.escudoGolpe, 0, 8, dtS)
  v.superBlanco = suavizar(v.superBlanco, 0, 5, dtS)
  // resorte del aplastado, en sub-pasos para que no se desarme con un dt grande
  let resta = dtS
  while (resta > 0) {
    const h = Math.min(resta, 1 / 120)
    v.aplastarVel += (-700 * v.aplastar - 20 * v.aplastarVel) * h
    v.aplastar += v.aplastarVel * h
    resta -= h
  }
  if (Math.abs(v.aplastar) < 0.0005 && Math.abs(v.aplastarVel) < 0.01) {
    v.aplastar = 0
    v.aplastarVel = 0
  }
  const yPie = E.sueloY - l.y
  const at = v.at
  if (!at) {
    v.cajaW = 64
    v.cajaH = 200
    v.cajaX = l.x - 32
    v.cajaY = yPie - 200
    return 0
  }
  const plano = planoDe(at, l)
  v.plano = plano
  cajaDe(at, plano, l.x, yPie, l.mira, v)
  const icono = iconoEnCurso(at, l)
  const velX = Math.abs(l.vx)

  // post-imágenes: dash, Corte Relámpago o cualquier desplazamiento muy rápido
  const relampago = icono === 'rayo'
  const enDash = l.estado === 'dash' || l.anim === 'dash'
  if (velX > 10 || ((enDash || relampago) && velX > 2.5)) {
    v.estAcum += dtMs
    if (v.estAcum >= 30) {
      v.estAcum = 0
      const k = v.estCab
      v.estX[k] = l.x
      v.estY[k] = yPie
      v.estT[k] = E.ms
      v.estMira[k] = l.mira
      v.estPlano[k] = plano
      v.estCab = (k + 1) % MAX_ESTELA
      v.estN = Math.min(MAX_ESTELA, v.estN + 1)
    }
  } else {
    v.estAcum = 30
  }

  // hielo
  const congelado = l.efectos.congelado > 0 || l.estado === 'congelado'
  if (congelado && !v.congelado) {
    generarCristales(v, l.x, yPie)
    v.cristalMs = 0
  } else if (!congelado && v.congelado) {
    // se derritió solo: gotitas (si se rompió de un golpe, el evento ya tiró las esquirlas)
    if (E.ms - v.rotoMs > 300) emitirGotas(E, v.cajaX + v.cajaW / 2, v.cajaY + v.cajaH * 0.55, 10, v.cajaW * 0.4)
    v.nCristales = 0
  }
  v.congelado = congelado
  if (congelado) {
    v.cristalMs += dtMs
    if (Math.random() < dtS * 5 * E.densidad) {
      emitirBrillos(E, v.cajaX + Math.random() * v.cajaW, v.cajaY + Math.random() * v.cajaH, 1, 2, 4, 8)
    }
  }

  // electricidad: electrocutado, o Simón cruzando la pantalla con el Corte Relámpago
  const electro = l.efectos.electrocutado > 0 || l.estado === 'electrocutado'
  if (electro || (relampago && velX > 2)) {
    v.arcosMs -= dtMs
    if (v.arcosMs <= 0) {
      generarArcos(v, l.x, yPie, electro ? (E.calidad === 'baja' ? 2 : 3) : 2)
      v.arcosMs = 45
    }
    const n = cuantasPorTasa((electro ? 12 : 26) * E.densidad, dtS)
    for (let i = 0; i < n; i++) {
      emitirElectricas(E, v.cajaX + Math.random() * v.cajaW, v.cajaY + Math.random() * v.cajaH * 0.85, 1, 4)
    }
  } else {
    v.nArcos = 0
  }

  // spray de la Fijación Extrema
  if (v.sprayMs > 0) {
    v.sprayMs -= dtMs
    const manoX = l.mira > 0 ? v.cajaX + v.cajaW * 0.9 : v.cajaX + v.cajaW * 0.1
    const manoY = yPie - at.ficha.alturaMundo * 0.6
    const n = cuantasPorTasa(75 * E.densidad, dtS)
    for (let i = 0; i < n; i++) {
      const a = azar(-0.3, 0.3)
      const vel = azar(380, 700)
      emitirNiebla(E, manoX, manoY, Math.cos(a) * vel * l.mira, Math.sin(a) * vel - 20, azar(10, 18), azar(0.35, 0.6), 1)
    }
    if (Math.random() < dtS * 22 * E.densidad) {
      emitirBrillos(E, manoX + l.mira * azar(20, 170), manoY + azar(-28, 28), 1, 2, 6, 10)
    }
  }

  // aura de crítico: chispitas doradas que suben
  if (l.efectos.critico > 0 && Math.random() < dtS * 16 * E.densidad) {
    emitirBrillos(E, v.cajaX + Math.random() * v.cajaW, v.cajaY + v.cajaH * azar(0.1, 0.9), 1, 1, 4, 90)
  }

  // impactos de la animación cruzados en este cuadro
  let mascara = 0
  if (l.anim !== v.animPrev || l.animTick < v.tickPrev) v.cuadroPrev = -1
  const anim = at.anims[l.anim]
  if (anim && anim.impactos.length) {
    for (let k = 0; k < anim.impactos.length && k < 30; k++) {
      const imp = anim.impactos[k]
      if (v.cuadroPrev < imp && l.cuadro >= imp) mascara |= 1 << k
    }
  }
  v.animPrev = l.anim
  v.tickPrev = l.animTick
  v.cuadroPrev = l.cuadro
  return mascara
}

/** ¿La animación en curso marca sus golpes en el atlas? (si no, los tajos van con `swing`). */
export function tieneImpactos(v: VisualLuchador, l: LuchadorEstado): boolean {
  const anim = v.at?.anims[l.anim]
  return !!anim && anim.impactos.length > 0
}

// ─── Dibujo ──────────────────────────────────────────────────────────────────

export function dibujarSombra(E: Escena, l: LuchadorEstado, v: VisualLuchador): void {
  const k = acotar(1 - l.y / 320, 0.3, 1)
  const ancho = acotar(v.cajaW * 0.85 + 28, 96, 230) * k
  spriteMundo(E, E.spr.sombra, l.x, E.sueloY + 2, ancho, ancho * 0.2, 0, 0.55 * k)
}

/** El piso de los locales brilla: el luchador se refleja invertido y se apaga con un degradé. */
export function dibujarReflejo(E: Escena, l: LuchadorEstado, v: VisualLuchador): void {
  const at = v.at
  const r = v.reflejo
  const g = v.reflejoCtx
  if (!at || !r || !g || !v.reflejoDeg) return
  const alfa = 0.17 * acotar(1 - l.y / 240, 0, 1)
  if (alfa < 0.01) return
  fuente(at, v.plano, v.congelado ? TINTE_HIELO : v.alterno ? TINTE_ALTERNO : -1)
  if (!F.img) return
  g.globalCompositeOperation = 'source-over'
  g.clearRect(0, 0, r.width, r.height)
  g.drawImage(F.img, F.sx, F.sy, F.sw, F.sh, at.reflejoMitad - F.ax, r.height - F.ay, F.sw, F.sh)
  g.globalCompositeOperation = 'destination-in'
  g.fillStyle = v.reflejoDeg
  g.fillRect(0, 0, r.width, r.height)
  g.globalCompositeOperation = 'source-over'
  const ctx = E.ctx
  const k = E.cam.esc
  const e = at.escala
  ctx.imageSmoothingEnabled = true
  ctx.setTransform(k * e * (l.mira < 0 ? -1 : 1), 0, 0, -k * e, E.cam.tx + k * l.x, E.cam.ty + k * (E.sueloY + l.y))
  ctx.globalAlpha = alfa
  ctx.drawImage(r, -at.reflejoMitad, -r.height)
  ctx.globalAlpha = 1
}

function dibujarEstela(E: Escena, at: AtlasPreparado, v: VisualLuchador): void {
  if (v.estN === 0) return
  const ctx = E.ctx
  let alguna = false
  for (let j = 0; j < v.estN; j++) {
    const i = (v.estCab - v.estN + j + MAX_ESTELA) % MAX_ESTELA
    const edad = E.ms - v.estT[i]
    if (edad > VIDA_ESTELA || edad < 0) continue
    if (!alguna) {
      alguna = true
      ctx.globalCompositeOperation = 'lighter'
    }
    const t = 1 - edad / VIDA_ESTELA
    pintar(E, at, v.estPlano[i], TINTE_SILUETA, v.estX[i], v.estY[i], v.estMira[i], 1, 1, 0, 0.42 * t * t)
  }
  if (alguna) ctx.globalCompositeOperation = 'source-over'
}

function dibujarHielo(E: Escena, l: LuchadorEstado, v: VisualLuchador, x: number, yPie: number): void {
  const ctx = E.ctx
  enMundo(E)
  const crece = salidaConRebote(Math.min(1, v.cristalMs / 240))
  const quedan = l.efectos.congelado
  const alfa = quedan > 0 && quedan < 24 ? 0.55 + 0.45 * Math.abs(Math.sin(E.s * 20)) : 1
  const pad = 7
  // bloque de hielo translúcido
  ctx.globalAlpha = alfa * Math.min(1, v.cristalMs / 120)
  caminoRedondeado(ctx, v.cajaX - pad, v.cajaY - pad, v.cajaW + pad * 2, v.cajaH + pad, 9)
  ctx.fillStyle = 'rgba(170,232,255,0.18)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(225,250,255,0.7)'
  ctx.lineWidth = 1.8
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255,255,255,0.42)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(v.cajaX + v.cajaW * 0.24, v.cajaY - pad + 4)
  ctx.lineTo(v.cajaX - pad + 4, v.cajaY + v.cajaH * 0.26)
  ctx.moveTo(v.cajaX + v.cajaW * 0.55, v.cajaY - pad + 4)
  ctx.lineTo(v.cajaX - pad + 4, v.cajaY + v.cajaH * 0.52)
  ctx.stroke()
  // cristales
  ctx.lineWidth = 1.2
  for (let k = 0; k < v.nCristales; k++) {
    const o = k * 5
    const bx = x + v.cristales[o]
    const by = yPie + v.cristales[o + 1]
    const ang = v.cristales[o + 2]
    const largo = v.cristales[o + 3] * crece
    const ancho = v.cristales[o + 4] * crece
    if (largo < 1) continue
    const c = Math.cos(ang)
    const s = Math.sin(ang)
    const px = -s
    const py = c
    ctx.globalAlpha = 0.92 * alfa
    ctx.beginPath()
    ctx.moveTo(bx + px * ancho * 0.5, by + py * ancho * 0.5)
    ctx.lineTo(bx + c * largo * 0.35 + px * ancho * 0.62, by + s * largo * 0.35 + py * ancho * 0.62)
    ctx.lineTo(bx + c * largo, by + s * largo)
    ctx.lineTo(bx + c * largo * 0.35 - px * ancho * 0.62, by + s * largo * 0.35 - py * ancho * 0.62)
    ctx.lineTo(bx - px * ancho * 0.5, by - py * ancho * 0.5)
    ctx.closePath()
    ctx.fillStyle = '#C8F3FF'
    ctx.fill()
    ctx.strokeStyle = '#58C3EE'
    ctx.stroke()
    ctx.globalAlpha = 0.7 * alfa
    ctx.strokeStyle = '#FFFFFF'
    ctx.beginPath()
    ctx.moveTo(bx + c * largo * 0.12, by + s * largo * 0.12)
    ctx.lineTo(bx + c * largo * 0.85, by + s * largo * 0.85)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

/** El bloque de hielo pixel art del atlas compartido: crece en tres cuadros desde el piso. */
function dibujarBloqueHielo(E: Escena, l: LuchadorEstado, v: VisualLuchador, hielo: FxAnim, yPie: number): void {
  const n = hielo.cuadros.length
  const c = Math.min(n - 1, Math.floor(v.cristalMs / 90))
  const ref = hielo.cuadros[n - 1]
  const esc = Math.max(v.cajaH * 1.08, 150) / ref.h
  const quedan = l.efectos.congelado
  const alfa = quedan > 0 && quedan < 24 ? 0.35 + 0.25 * Math.abs(Math.sin(E.s * 20)) : 0.6
  E.ctx.globalCompositeOperation = 'source-over'
  dibujarFx(E, hielo, c, l.x, yPie + 2, esc, 0, l.mira, alfa)
  E.ctx.globalAlpha = 1
  E.ctx.imageSmoothingEnabled = true
}

/** Chispazos del atlas compartido sobre el cuerpo (cambian de lugar ~9 veces por segundo). */
function dibujarArcosAtlas(E: Escena, v: VisualLuchador, arco: FxAnim): void {
  const ctx = E.ctx
  ctx.globalCompositeOperation = 'lighter'
  const paso = Math.floor(E.ms / 110)
  for (let k = 0; k < 2; k++) {
    const rx = ruido(paso * 7 + k * 31 + v.lado * 101)
    const ry = ruido(paso * 13 + k * 17 + v.lado * 59)
    dibujarFx(E, arco, cuadroFx(arco, E.ms + k * 90, true), v.cajaX + rx * v.cajaW, v.cajaY + ry * v.cajaH * 0.8, 1.4, 0, k === 0 ? 1 : -1, 0.95)
  }
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.imageSmoothingEnabled = true
}

function dibujarArcos(E: Escena, v: VisualLuchador, x: number, yPie: number): void {
  if (v.nArcos === 0) return
  const ctx = E.ctx
  enMundo(E)
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineJoin = 'round'
  for (let a = 0; a < v.nArcos; a++) {
    ctx.beginPath()
    for (let s = 0; s < PUNTOS_ARCO; s++) {
      const o = (a * PUNTOS_ARCO + s) * 2
      if (s === 0) ctx.moveTo(x + v.arcos[o], yPie + v.arcos[o + 1])
      else ctx.lineTo(x + v.arcos[o], yPie + v.arcos[o + 1])
    }
    ctx.globalAlpha = 0.9
    ctx.strokeStyle = 'rgba(255,205,70,0.5)'
    ctx.lineWidth = 5
    ctx.stroke()
    ctx.strokeStyle = '#FFFFFF'
    ctx.lineWidth = 1.5
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
}

/** Grietas del escudo (en px del sprite del escudo, 100×240). */
const GRIETAS: readonly (readonly number[])[] = [
  [62, 70, 50, 92, 58, 108, 44, 128],
  [58, 108, 72, 120, 66, 140],
  [44, 128, 52, 152, 40, 170, 48, 188],
  [66, 140, 78, 156],
]

function dibujarEscudo(E: Escena, l: LuchadorEstado, v: VisualLuchador, at: AtlasPreparado, x: number, yPie: number): void {
  if (v.escudoVis < 0.02 && v.escudoGolpe < 0.02) return
  const ctx = E.ctx
  const agachado = l.anim === 'agachado' || l.estado === 'agachado'
  const h = at.ficha.alturaMundo * (agachado ? 0.64 : 1)
  const cy = yPie - h * 0.52
  const cx = x + (l.mira < 0 ? -1 : 1) * 24
  const spr = E.spr.escudo(at.ficha.color)
  const alto = h * (0.86 + 0.14 * v.escudoVis)
  const sy = alto / spr.height
  const sx = sy * (l.mira < 0 ? -1 : 1)
  const gf = l.guardiaMax > 0 ? acotar(l.guardia / l.guardiaMax, 0, 1) : 1
  let alfa = v.escudoVis * (0.5 + 0.38 * gf) + v.escudoGolpe * 0.65
  if (gf < 0.3) alfa *= 0.7 + 0.3 * Math.sin(E.s * 22)
  const k = E.cam.esc
  ctx.imageSmoothingEnabled = true
  ctx.globalCompositeOperation = 'lighter'
  ctx.setTransform(k * sx, 0, 0, k * sy, E.cam.tx + k * cx, E.cam.ty + k * cy)
  ctx.globalAlpha = Math.min(1, alfa)
  ctx.drawImage(spr, 0, -spr.height / 2)
  if (gf < 0.55) {
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = Math.min(1, (0.55 - gf) * 2.2) * v.escudoVis
    ctx.strokeStyle = '#FFFFFF'
    ctx.lineWidth = 2.2
    ctx.lineJoin = 'miter'
    ctx.beginPath()
    for (const linea of GRIETAS) {
      for (let i = 0; i < linea.length; i += 2) {
        if (i === 0) ctx.moveTo(linea[i], linea[i + 1] - spr.height / 2)
        else ctx.lineTo(linea[i], linea[i + 1] - spr.height / 2)
      }
    }
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
}

function dibujarMareo(E: Escena, l: LuchadorEstado, v: VisualLuchador, x: number): void {
  const estrellas = fx(E, FX_ESTRELLAS)
  if (estrellas && l.estado === 'mareado') {
    dibujarFx(E, estrellas, cuadroFx(estrellas, E.ms, true), x, v.cajaY - 4, 1.5, 0, 1, 1)
    E.ctx.globalAlpha = 1
    E.ctx.imageSmoothingEnabled = true
    return
  }
  const img = E.spr.estrella5[l.estado === 'guardia_rota' ? 1 : 0]
  const cy = v.cajaY - 6
  for (let i = 0; i < 3; i++) {
    const ang = E.s * 4.4 + (i * TAU) / 3
    const prof = Math.sin(ang)
    const t = 20 * (0.8 + 0.25 * prof)
    spriteMundo(E, img, x + Math.cos(ang) * 34, cy + prof * 9, t, t, E.s * 5 + i, 0.6 + 0.4 * (prof * 0.5 + 0.5))
  }
  E.ctx.globalAlpha = 1
}

/** Un cuerpo de respaldo si el atlas de ese personaje no está (nunca debería pasar). */
function dibujarSilueta(E: Escena, l: LuchadorEstado, color: string): void {
  const ctx = E.ctx
  enMundo(E)
  const yPie = E.sueloY - l.y
  ctx.globalAlpha = 0.9
  ctx.fillStyle = color
  caminoRedondeado(ctx, l.x - 30, yPie - 170, 60, 170, 24)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(l.x, yPie - 192, 22, 0, TAU)
  ctx.fill()
  ctx.globalAlpha = 1
}

/**
 * Dibuja el luchador con todos sus estados. `encendido` (0..1) es el destello del que tira un
 * especial cuando se lo vuelve a dibujar sobre el oscurecido del super flash.
 */
export function dibujarLuchador(E: Escena, l: LuchadorEstado, v: VisualLuchador, encendido = 0): void {
  const at = v.at
  if (!at) {
    dibujarSilueta(E, l, '#8a8f98')
    return
  }
  const ctx = E.ctx
  const yPie = E.sueloY - l.y
  let x = l.x
  if (v.sacudida > 0) x += (Math.floor(E.ms / 34) % 2 === 0 ? 1 : -1) * Math.min(4, 1.6 + v.sacudida * 0.02)
  const electro = l.efectos.electrocutado > 0 || l.estado === 'electrocutado'
  if (electro) x += (Math.random() - 0.5) * 3.2
  const plano = v.plano
  const congelado = v.congelado
  let sx = 1
  let sy = 1
  let rot = 0
  if (!congelado) {
    if (l.estado === 'quieto' && l.anim === 'quieto') {
      const r = Math.sin(E.s * 3.4 + v.fase) * 0.015
      sy += r
      sx -= r * 0.4
    }
    if (v.aplastar !== 0) {
      sy -= v.aplastar
      sx += v.aplastar * 0.6
    }
    if (l.estado === 'mareado' || l.estado === 'guardia_rota') rot = Math.sin(E.s * 2.6 + v.fase) * 0.045
  }
  const nitido = at.escala * E.cam.esc >= 2

  // aura dorada detrás después de un crítico
  if (l.efectos.critico > 0) {
    ctx.imageSmoothingEnabled = true
    ctx.globalCompositeOperation = 'lighter'
    const a = Math.min(1, l.efectos.critico / 12) * (0.55 + 0.25 * Math.sin(E.s * 18))
    pintar(E, at, plano, TINTE_AURA, x, yPie, l.mira, sx, sy, rot, a)
    ctx.globalCompositeOperation = 'source-over'
  }
  ctx.imageSmoothingEnabled = !nitido
  dibujarEstela(E, at, v)

  let alfa = 1
  if (l.invulnerable && l.estado === 'levantandose') alfa = Math.floor(E.ms / 60) % 2 ? 0.55 : 1
  const base = congelado ? TINTE_HIELO : v.alterno ? TINTE_ALTERNO : -1
  pintar(E, at, plano, base, x, yPie, l.mira, sx, sy, rot, alfa)

  // pulso corto: lleno 60 ms y se apaga hacia los 210 ms, dure lo que dure el hitstop
  let blanco = v.destelloMs < 60 ? 0.85 : v.destelloMs < 210 ? 0.85 * (1 - (v.destelloMs - 60) / 150) : 0
  if (electro && Math.floor(E.ms / 70) % 2 === 0) blanco = Math.max(blanco, 0.42)
  if (encendido > 0) blanco = Math.max(blanco, encendido)
  if (v.superBlanco > 0.02) blanco = Math.max(blanco, v.superBlanco)
  if (blanco > 0.01) pintar(E, at, plano, TINTE_BLANCO, x, yPie, l.mira, sx, sy, rot, Math.min(1, blanco))
  ctx.globalAlpha = 1
  ctx.imageSmoothingEnabled = true

  if (congelado) {
    const hielo = fx(E, FX_HIELO)
    if (hielo) dibujarBloqueHielo(E, l, v, hielo, yPie)
    else dibujarHielo(E, l, v, l.x, yPie)
  }
  if (v.nArcos > 0) {
    dibujarArcos(E, v, l.x, yPie)
    const arco = electro ? fx(E, FX_ARCO) : null
    if (arco) dibujarArcosAtlas(E, v, arco)
  }
  dibujarEscudo(E, l, v, at, x, yPie)
  if (l.estado === 'mareado' || l.estado === 'guardia_rota') dibujarMareo(E, l, v, x)
}
