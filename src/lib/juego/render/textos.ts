/**
 * Textos del canvas: números de daño, textos de impacto («¡CRÍTICO!», «¡GUARDIA ROTA!»...),
 * anuncios enormes («ROUND 1», «K.O.»...) y el contador de combo.
 *
 * Cada texto se pinta UNA vez en un lienzo propio (degradé metálico, doble contorno, sombra,
 * itálica por sesgo) y en el cuadro sólo se dibuja ese lienzo escalado/rotado. Los lienzos se
 * reusan (pool) y se vuelven a pintar si cambia la resolución.
 *
 * Precalentado: el primer drawImage de un lienzo recién pintado es el que cuesta (el navegador
 * rasteriza los contornos gruesos y el degradé: 40 ms con la CPU normal, 70–85 ms con un celular
 * medio) y caía justo en el primer cuadro del «ROUND 1», del «¡A PELEAR!» o del «K.O.». Se
 * pintan y se dibujan una vez antes, uno por cuadro y siempre sin el jugador en control: al
 * arrancar (cortina, presentación, anuncios) lo de la primera vez y lo que sale jugando (los
 * impactos, el combo, el TURBO, el remate del final); en el festejo de un round, el «ROUND N»
 * que viene. Quedan afuera «¡TIEMPO!» y «PERFECTO» (casi nunca salen).
 */
import type { Lado, Partida } from '../tipos'
import type { Escena } from './escena'
import { contexto, crearLienzo, liberarLienzo } from './lienzo'
import { acotar, entradaCuadratica, salidaConRebote, salidaCubica, salidaElastica, suavizar } from './util'

export interface EstiloTexto {
  tam: number
  familia: 'titulo' | 'numeros'
  /** Degradé vertical (un solo color = liso). */
  colores: readonly string[]
  paradas: readonly number[]
  contorno: string
  /** Fracción del tamaño. */
  contornoAncho: number
  exterior: string | null
  exteriorAncho: number
  /** 0,18 ≈ itálica. */
  inclinacion: number
  /** Espaciado entre letras (fracción del tamaño). */
  espaciado: number
  /** Desplazamiento de la sombra dura (fracción del tamaño). */
  sombra: number
}

export interface TextoPintado {
  lienzo: HTMLCanvasElement
  /** px de lienzo por unidad (de pantalla o de mundo). */
  escala: number
}

const PARADAS_METAL = [0, 0.36, 0.5, 0.78, 1]
const ORO = ['#FFFFFF', '#FFF4C4', '#FFD447', '#F5A300', '#9A4A00']
const FUEGO = ['#FFFFFF', '#FFF0A0', '#FFC02E', '#FF6A00', '#B81800']
const ROJO = ['#FFFFFF', '#FFD6CF', '#FF5340', '#D0140A', '#5E0000']
const HIELO = ['#FFFFFF', '#E8FCFF', '#92E8FF', '#35B4FF', '#123F9C']
const CROMO = ['#FFFFFF', '#F2F5F9', '#BCC5D0', '#7A8594', '#2F3742']
const ELECTRICO = ['#FFFFFF', '#FFFCD8', '#FFF06B', '#FFC400', '#B86E00']
const VIOLETA = ['#FFFFFF', '#F5E8FF', '#D7A8FF', '#A855F7', '#4C1D95']

function estilo(tam: number, colores: readonly string[], exterior: string, extra: Partial<EstiloTexto> = {}): EstiloTexto {
  return {
    tam,
    familia: 'titulo',
    colores,
    paradas: PARADAS_METAL,
    contorno: '#0B0B0E',
    contornoAncho: 0.075,
    exterior,
    exteriorAncho: 0.13,
    inclinacion: 0.17,
    espaciado: 0.02,
    sombra: 0.07,
    ...extra,
  }
}

export type ClaveAnuncio =
  | 'round'
  | 'round_final'
  | 'pelea'
  | 'ko'
  | 'tiempo'
  | 'perfecto'
  | 'dejalo'
  | 'alcero'
  | 'turbo'

type Entrada = 'rebote' | 'golpe' | 'deslizar'

interface DefAnuncio {
  estilo: EstiloTexto
  dur: number
  entrada: Entrada
}

const ANUNCIOS: Record<ClaveAnuncio, DefAnuncio> = {
  round: { estilo: estilo(104, ORO, '#4A2200'), dur: 1150, entrada: 'rebote' },
  round_final: { estilo: estilo(100, FUEGO, '#4A0E00'), dur: 1250, entrada: 'rebote' },
  pelea: { estilo: estilo(126, FUEGO, '#4A0E00'), dur: 900, entrada: 'golpe' },
  ko: { estilo: estilo(164, ROJO, '#2A0000', { espaciado: 0.04 }), dur: 1500, entrada: 'golpe' },
  tiempo: { estilo: estilo(112, HIELO, '#06204F'), dur: 1300, entrada: 'rebote' },
  perfecto: { estilo: estilo(100, ORO, '#4A2200'), dur: 1400, entrada: 'rebote' },
  dejalo: { estilo: estilo(80, ROJO, '#2A0000'), dur: 4500, entrada: 'rebote' },
  alcero: { estilo: estilo(146, ORO, '#4A2200'), dur: 1700, entrada: 'golpe' },
  turbo: { estilo: estilo(94, ELECTRICO, '#4A2A00', { espaciado: 0.06 }), dur: 1250, entrada: 'deslizar' },
}

export type ClaveImpacto = 'critico' | 'guardia' | 'congelado' | 'electrocutado' | 'aturdido' | 'mareado' | 'quemado'

const IMPACTOS: Record<ClaveImpacto, { texto: string; estilo: EstiloTexto }> = {
  critico: { texto: '¡CRÍTICO!', estilo: estilo(46, ORO, '#4A2200') },
  guardia: { texto: '¡GUARDIA ROTA!', estilo: estilo(42, CROMO, '#0B2440') },
  congelado: { texto: '¡CONGELADO!', estilo: estilo(42, HIELO, '#06204F') },
  electrocutado: { texto: '¡ELECTROCUTADO!', estilo: estilo(38, ELECTRICO, '#4A2A00') },
  aturdido: { texto: '¡ATURDIDO!', estilo: estilo(40, ORO, '#4A2200') },
  mareado: { texto: '¡MAREADO!', estilo: estilo(40, VIOLETA, '#2E0A4F') },
  quemado: { texto: '¡QUEMADO!', estilo: estilo(40, FUEGO, '#4A0E00') },
}

const NUM_NORMAL = estilo(31, ['#FFFFFF', '#FFFFFF', '#FFE6A6'], '#1A0F00', {
  familia: 'numeros',
  paradas: [0, 0.55, 1],
  exteriorAncho: 0.11,
  espaciado: 0,
})
const NUM_CRITICO = estilo(46, ['#FFFFFF', '#FFF27A', '#FFC400', '#FF7A00'], '#4A1500', {
  familia: 'numeros',
  paradas: [0, 0.35, 0.6, 1],
  espaciado: 0,
})
/** «+N» de la curación: verde, sube despacio y se va sumando mientras dura. */
const NUM_CURA = estilo(34, ['#FFFFFF', '#D1FAE5', '#4ADE80', '#15803D'], '#052E16', {
  familia: 'numeros',
  paradas: [0, 0.35, 0.65, 1],
  espaciado: 0,
})
const NUM_BLOQUEO = estilo(22, ['#EEF4F8', '#AFC0CF'], '#0E1620', {
  familia: 'numeros',
  paradas: [0, 1],
  exteriorAncho: 0.1,
  espaciado: 0,
})
const COMBO_NUM = estilo(66, ORO, '#4A2200', { familia: 'numeros', espaciado: 0 })
const COMBO_TXT = estilo(22, CROMO, '#0B0B0E', { espaciado: 0.12, sombra: 0.05 })

let medidor: CanvasRenderingContext2D | null = null

/** Un texto para precalentar: [clave del caché, texto, estilo, ancho máximo]. */
type Previo = readonly [string, string, EstiloTexto, number]

function previoAnuncio(clave: ClaveAnuncio, texto: string): Previo {
  return [`anuncio:${clave}:${texto}`, texto, ANUNCIOS[clave].estilo, 900]
}

/**
 * Lo que se precalienta al arrancar: lo que sale primero y lo que cae con el jugador en control
 * (el «¡A PELEAR!», el combo, los impactos, el TURBO, el remate del final) y el «K.O.». Los
 * «ROUND N» siguientes, en el festejo del round anterior (ver precalentar).
 */
function previosDeLaPelea(): Previo[] {
  const impactos = (Object.keys(IMPACTOS) as ClaveImpacto[]).map((k): Previo => [k, IMPACTOS[k].texto, IMPACTOS[k].estilo, 0])
  return [
    previoAnuncio('round', 'ROUND 1'),
    previoAnuncio('pelea', '¡A PELEAR!'),
    ['combo:golpes', 'GOLPES', COMBO_TXT, 0],
    ...impactos,
    previoAnuncio('turbo', 'TURBO'),
    previoAnuncio('dejalo', '¡DEJALO AL CERO!'),
    previoAnuncio('alcero', '¡AL CERO!'),
    previoAnuncio('ko', 'K.O.'),
  ]
}

/** La primera familia de una pila («'Anton', 'Anton Fallback', Impact, …» → «'Anton'»). */
function primeraFamilia(pila: string): string {
  return pila.split(',')[0]?.trim() || pila
}

/**
 * ¿Ya cargaron las fuentes de los textos? Precalentar con la de reserva dejaría el texto pintado
 * con ésa toda la pelea. Sin la API (o si falla), se asume que sí.
 */
function fuentesListas(familias: { titulo: string; numeros: string }): boolean {
  try {
    const f = typeof document !== 'undefined' ? document.fonts : undefined
    if (!f || typeof f.check !== 'function') return true
    const listas = [familias.titulo, familias.numeros].map((x) => `40px ${primeraFamilia(x)}`)
    if (listas.every((fuente) => f.check(fuente))) return true
    for (const fuente of listas) void f.load(fuente).catch(() => undefined)
    return false
  } catch {
    return true
  }
}

/** Cuadros que se espera a las fuentes antes de dejar de precalentar (≈ 4 s). */
const ESPERA_FUENTES_CUADROS = 240
/**
 * Después de un cambio de resolución se espera esto antes de precalentar: al montar la pelea el
 * lienzo cambia de tamaño un par de veces en los primeros cuadros (la disposición, el
 * ResizeObserver) y lo pintado a la escala anterior se tira.
 */
const QUIETO_MS = 250

function ponerEspaciado(g: CanvasRenderingContext2D, px: number): void {
  if ('letterSpacing' in g) g.letterSpacing = `${px.toFixed(2)}px`
}

/**
 * Pinta `texto` con el estilo en `destino` (o en un lienzo nuevo). `escala` = px de lienzo por
 * unidad; `anchoMax` (en unidades) achica la letra si no entra.
 */
export function pintarTexto(
  destino: HTMLCanvasElement | null,
  texto: string,
  est: EstiloTexto,
  familias: { titulo: string; numeros: string },
  escala: number,
  anchoMax = 0,
): TextoPintado {
  if (!medidor) medidor = contexto(crearLienzo(8, 8))
  const g0 = medidor
  const familia = est.familia === 'numeros' ? familias.numeros : familias.titulo
  let tam = est.tam
  g0.font = `${tam}px ${familia}`
  ponerEspaciado(g0, est.espaciado * tam)
  let m = g0.measureText(texto)
  if (anchoMax > 0 && m.width > anchoMax) {
    tam = (tam * anchoMax) / m.width
    g0.font = `${tam}px ${familia}`
    ponerEspaciado(g0, est.espaciado * tam)
    m = g0.measureText(texto)
  }
  const asc = m.actualBoundingBoxAscent > 0 ? m.actualBoundingBoxAscent : tam * 0.8
  const desc = m.actualBoundingBoxDescent > 0 ? m.actualBoundingBoxDescent : tam * 0.08
  const borde = tam * Math.max(est.contornoAncho, est.exterior ? est.exteriorAncho : 0) + 3
  const sombra = est.sombra * tam
  const k = est.inclinacion
  const w = m.width + borde * 2 + k * (asc + desc) + sombra
  const h = asc + desc + borde * 2 + sombra
  const lienzo = destino ?? crearLienzo(1, 1)
  lienzo.width = Math.max(1, Math.ceil(w * escala))
  lienzo.height = Math.max(1, Math.ceil(h * escala))
  const g = contexto(lienzo)
  const yb = borde + asc
  const x0 = borde + k * desc
  // sesgo con origen en la línea de base: la parte de arriba se corre a la derecha
  g.setTransform(escala, 0, -k * escala, escala, k * yb * escala, 0)
  g.font = `${tam}px ${familia}`
  ponerEspaciado(g, est.espaciado * tam)
  g.textAlign = 'left'
  g.textBaseline = 'alphabetic'
  g.lineJoin = 'round'
  g.miterLimit = 2
  const anchoExterior = (est.exterior ? est.exteriorAncho : est.contornoAncho) * tam * 2
  if (sombra > 0) {
    g.fillStyle = 'rgba(0,0,0,0.6)'
    g.strokeStyle = 'rgba(0,0,0,0.6)'
    g.lineWidth = anchoExterior
    g.strokeText(texto, x0 + sombra, yb + sombra)
    g.fillText(texto, x0 + sombra, yb + sombra)
  }
  if (est.exterior) {
    g.strokeStyle = est.exterior
    g.lineWidth = anchoExterior
    g.strokeText(texto, x0, yb)
  }
  g.strokeStyle = est.contorno
  g.lineWidth = est.contornoAncho * tam * 2
  g.strokeText(texto, x0, yb)
  if (est.colores.length > 1) {
    const d = g.createLinearGradient(0, yb - asc, 0, yb + desc)
    for (let i = 0; i < est.colores.length; i++) {
      d.addColorStop(est.paradas[i] ?? i / (est.colores.length - 1), est.colores[i])
    }
    g.fillStyle = d
  } else {
    g.fillStyle = est.colores[0] ?? '#FFFFFF'
  }
  g.fillText(texto, x0, yb)
  // brillo fino arriba: la luz pega de arriba en el metal
  g.globalCompositeOperation = 'source-atop'
  const brillo = g.createLinearGradient(0, yb - asc, 0, yb - asc * 0.55)
  brillo.addColorStop(0, 'rgba(255,255,255,0.35)')
  brillo.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = brillo
  g.fillRect(-w, 0, w * 3, yb - asc * 0.5)
  g.globalCompositeOperation = 'source-over'
  return { lienzo, escala }
}

/** Dibuja un texto pintado centrado en (x, y) de la capa que diga la transformación base. */
function dibujarCentrado(
  ctx: CanvasRenderingContext2D,
  t: TextoPintado,
  ox: number,
  oy: number,
  unidad: number,
  x: number,
  y: number,
  escala: number,
  rot: number,
  alfa: number,
): void {
  if (alfa <= 0.003 || escala <= 0.001) return
  const s = (unidad * escala) / t.escala
  const c = Math.cos(rot) * s
  const sn = Math.sin(rot) * s
  ctx.setTransform(c, sn, -sn, c, ox + unidad * x, oy + unidad * y)
  ctx.globalAlpha = Math.min(1, alfa)
  ctx.drawImage(t.lienzo, -t.lienzo.width / 2, -t.lienzo.height / 2)
}

// ─── Flotantes de mundo ──────────────────────────────────────────────────────

const MAX_NUMEROS = 14
const MAX_IMPACTOS = 6

interface Numero {
  activo: boolean
  pintado: TextoPintado | null
  lienzo: HTMLCanvasElement | null
  x: number
  y: number
  vx: number
  vy: number
  edad: number
  vida: number
  tipo: number
}

interface Impacto {
  activo: boolean
  clave: ClaveImpacto
  x: number
  y: number
  edad: number
  vida: number
}

interface Anuncio {
  clave: ClaveAnuncio
  texto: string
  pintado: TextoPintado | null
  edad: number
  dur: number
  entrada: Entrada
  /** ms que faltan para empezar (cola). */
  demora: number
  persistente: boolean
  /** ms desde que empezó a salir (-1 = todavía no). */
  saliendo: number
}

interface ComboVis {
  golpes: number
  desde: number
  pop: number
  pintado: TextoPintado | null
  lienzo: HTMLCanvasElement | null
}

/** Línea zigzag por donde se parte el «¡GUARDIA ROTA!» (fracciones del ancho/alto). */
const CORTE_VIDRIO = [-0.5, 0.12, -0.3, -0.05, -0.12, 0.14, 0.05, -0.08, 0.22, 0.1, 0.38, -0.06, 0.5, 0.08]

export class Textos {
  private readonly E: Escena
  private readonly numeros: Numero[] = []
  private readonly impactos: Impacto[] = []
  private readonly cache = new Map<string, TextoPintado>()
  private escalaCache = 0
  private actual: Anuncio | null = null
  private saliente: Anuncio | null = null
  private readonly cola: Anuncio[] = []
  private readonly combos: [ComboVis, ComboVis]
  /** El «+N» de la curación que se está sumando, por lado. */
  private readonly curas: [{ n: Numero | null; total: number; desde: number }, { n: Numero | null; total: number; desde: number }] = [
    { n: null, total: 0, desde: -1e9 },
    { n: null, total: 0, desde: -1e9 },
  ]
  numerosVisibles = true
  /** Los textos que faltan precalentar (ver el encabezado). */
  private previos: Previo[] = previosDeLaPelea()
  private cuadrosSinFuentes = 0
  /** E.ms del último cambio de resolución. */
  private invalidadoMs = 0
  /** El «ROUND N» del round que viene ya precalentado. */
  private proximoRound = ''

  constructor(E: Escena) {
    this.E = E
    for (let i = 0; i < MAX_NUMEROS; i++) {
      this.numeros.push({ activo: false, pintado: null, lienzo: null, x: 0, y: 0, vx: 0, vy: 0, edad: 0, vida: 0, tipo: 0 })
    }
    for (let i = 0; i < MAX_IMPACTOS; i++) {
      this.impactos.push({ activo: false, clave: 'critico', x: 0, y: 0, edad: 0, vida: 0 })
    }
    this.combos = [
      { golpes: 0, desde: -1e9, pop: 0, pintado: null, lienzo: null },
      { golpes: 0, desde: -1e9, pop: 0, pintado: null, lienzo: null },
    ]
  }

  /** px de lienzo por unidad para textos de pantalla y de mundo (con margen para el rebote). */
  private escalaPintado(): number {
    return this.E.cam.base * 1.25
  }

  private cacheado(clave: string, texto: string, est: EstiloTexto, anchoMax = 0): TextoPintado {
    const escala = this.escalaPintado()
    if (Math.abs(escala - this.escalaCache) > 0.001) {
      for (const t of this.cache.values()) liberarLienzo(t.lienzo)
      this.cache.clear()
      this.escalaCache = escala
    }
    let t = this.cache.get(clave)
    if (!t) {
      t = pintarTexto(null, texto, est, this.E.familias, escala, anchoMax)
      this.cache.set(clave, t)
    }
    return t
  }

  /** Tras redimensionar: los pintados se rehacen a la nueva resolución (y se vuelven a precalentar). */
  invalidar(): void {
    this.escalaCache = 0
    this.previos = previosDeLaPelea()
    this.cuadrosSinFuentes = 0
    this.invalidadoMs = this.E.ms
    this.proximoRound = ''
  }

  /**
   * Precalienta UN texto (ver el encabezado): lo pinta en su lienzo (el mismo caché que usa el
   * cuadro) y lo dibuja una vez en el lienzo principal. El render lo llama ANTES de pintar el
   * cuadro (que lo tapa entero) y nunca en la fase 'pelea'. Con las fuentes cargadas.
   */
  precalentar(p: Partida): void {
    if (this.E.ms - this.invalidadoMs < QUIETO_MS) return
    const previo = this.previos.length > 0 ? this.previos[0] : this.previoDelProximoRound(p)
    if (!previo) return
    if (!fuentesListas(this.E.familias)) {
      if (++this.cuadrosSinFuentes > ESPERA_FUENTES_CUADROS) {
        this.previos.length = 0
        this.proximoRound = 'sin fuentes'
      }
      return
    }
    if (this.previos.length > 0) this.previos.shift()
    else this.proximoRound = previo[0]
    const [clave, texto, est, anchoMax] = previo
    const t = this.cacheado(clave, texto, est, anchoMax)
    const ctx = this.E.ctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.drawImage(t.lienzo, 0, 0)
  }

  /**
   * En el festejo de un round que no definió la pelea (no en el K.O.: su primer cuadro es el del
   * «K.O.»), el anuncio del que viene («ROUND 2» o «ROUND FINAL», igual que lo arma el motor).
   * null si no hay o ya está.
   */
  private previoDelProximoRound(p: Partida): Previo | null {
    if (p.fase !== 'entre_rounds' || p.ganadorPartida !== null) return null
    const r = p.config.rondasParaGanar - 1
    const final = p.rondasGanadas[0] === r && p.rondasGanadas[1] === r
    const previo = final ? previoAnuncio('round_final', 'ROUND FINAL') : previoAnuncio('round', `ROUND ${p.round + 1}`)
    return previo[0] === this.proximoRound ? null : previo
  }

  vaciar(): void {
    for (const n of this.numeros) n.activo = false
    for (const c of this.curas) {
      c.n = null
      c.total = 0
    }
    for (const i of this.impactos) i.activo = false
    this.actual = null
    this.saliente = null
    this.cola.length = 0
    for (const c of this.combos) {
      c.golpes = 0
      c.desde = -1e9
    }
  }

  /** Libera los lienzos y suelta toda referencia a ellos (un lienzo de 0×0 no se puede dibujar). */
  liberar(): void {
    for (const t of this.cache.values()) liberarLienzo(t.lienzo)
    this.cache.clear()
    for (const n of this.numeros) {
      liberarLienzo(n.lienzo)
      n.activo = false
      n.pintado = null
    }
    for (const c of this.combos) {
      liberarLienzo(c.lienzo)
      c.pintado = null
      c.golpes = 0
    }
    if (this.actual) this.actual.pintado = null
    if (this.saliente) this.saliente.pintado = null
  }

  /** Número de daño en el punto de contacto (mundo). tipo: 0 normal, 1 crítico, 2 bloqueado. */
  numero(valor: number, x: number, y: number, tipo: number, dir: number): void {
    if (!this.numerosVisibles || valor <= 0) return
    let n = this.numeros[0]
    for (const c of this.numeros) {
      if (!c.activo) {
        n = c
        break
      }
      if (c.edad > n.edad) n = c
    }
    const est = tipo === 1 ? NUM_CRITICO : tipo === 2 ? NUM_BLOQUEO : NUM_NORMAL
    const escala = this.escalaPintado() * this.E.escalaTextos
    if (!n.lienzo) n.lienzo = crearLienzo(4, 4)
    n.pintado = pintarTexto(n.lienzo, String(Math.round(valor)), est, this.E.familias, escala)
    n.activo = true
    n.x = x + (Math.random() - 0.5) * 18
    n.y = y - 16 - Math.random() * 14
    n.vx = dir * (30 + Math.random() * 40)
    n.vy = tipo === 1 ? -230 : -170
    n.edad = 0
    n.vida = tipo === 1 ? 950 : 750
    n.tipo = tipo
  }

  /** Un número libre (o el más viejo). */
  private tomarNumero(): Numero {
    let n = this.numeros[0]
    for (const c of this.numeros) {
      if (!c.activo) return c
      if (c.edad > n.edad) n = c
    }
    return n
  }

  /**
   * «+N» verde sobre el que se cura. La curación llega de a pedacitos: mientras siguen llegando
   * (menos de 650 ms entre uno y otro) se suman en el mismo número, que vuelve a latir.
   */
  curar(lado: Lado, cantidad: number, x: number, y: number): void {
    if (!this.numerosVisibles || !(cantidad > 0)) return
    const c = this.curas[lado]
    let n = c.n
    if (!n || !n.activo || n.tipo !== 3 || this.E.ms - c.desde > 650) {
      n = this.tomarNumero()
      c.total = 0
      n.x = x
      n.y = y
      n.vx = 0
      n.vy = 0
      n.edad = 0
      n.vida = 1150
      n.tipo = 3
    } else {
      // vuelve a latir y estira la vida
      n.edad = Math.min(n.edad, 40)
      n.vida = Math.max(n.vida, n.edad + 900)
    }
    c.total += cantidad
    c.desde = this.E.ms
    c.n = n
    if (!n.lienzo) n.lienzo = crearLienzo(4, 4)
    n.pintado = pintarTexto(n.lienzo, `+${Math.round(c.total)}`, NUM_CURA, this.E.familias, this.escalaPintado() * this.E.escalaTextos)
    n.activo = true
  }

  impacto(clave: ClaveImpacto, x: number, y: number): void {
    let n = this.impactos[0]
    for (const c of this.impactos) {
      if (!c.activo) {
        n = c
        break
      }
      if (c.edad > n.edad) n = c
    }
    // dos textos iguales seguidos (tornado): se renueva el que está
    for (const c of this.impactos) {
      if (c.activo && c.clave === clave && c.edad < 250) {
        n = c
        break
      }
    }
    n.activo = true
    n.clave = clave
    n.x = x
    n.y = y
    n.edad = 0
    n.vida = clave === 'guardia' ? 1100 : 900
  }

  anuncio(clave: ClaveAnuncio, texto: string, demoraMs = 0, persistente = false): void {
    const def = ANUNCIOS[clave]
    const a: Anuncio = {
      clave,
      texto,
      pintado: null,
      edad: 0,
      dur: def.dur,
      entrada: def.entrada,
      demora: demoraMs,
      persistente,
      saliendo: -1,
    }
    if (demoraMs > 0) {
      this.cola.push(a)
      return
    }
    this.mostrar(a)
  }

  private mostrar(a: Anuncio): void {
    if (this.actual) {
      this.saliente = this.actual
      if (this.saliente.saliendo < 0) this.saliente.saliendo = 0
    }
    this.actual = a
  }

  /** Corta el anuncio persistente («¡DEJALO AL CERO!») cuando termina la ventana. */
  terminarPersistente(): void {
    if (this.actual?.persistente && this.actual.saliendo < 0) this.actual.saliendo = 0
  }

  combo(lado: Lado, golpes: number): void {
    const c = this.combos[lado]
    if (golpes < 2) return
    if (golpes !== c.golpes || !c.pintado) {
      if (!c.lienzo) c.lienzo = crearLienzo(4, 4)
      c.pintado = pintarTexto(c.lienzo, String(golpes), COMBO_NUM, this.E.familias, this.escalaPintado() * this.E.escalaTextos)
    }
    c.golpes = golpes
    c.desde = this.E.ms
    c.pop = 1
  }

  actualizar(dtMs: number, p: Partida): void {
    const dtS = dtMs / 1000
    for (const n of this.numeros) {
      if (!n.activo) continue
      n.edad += dtMs
      if (n.edad >= n.vida) {
        n.activo = false
        continue
      }
      if (n.tipo === 3) {
        // la curación sube despacio, sin gravedad
        n.y -= 34 * dtS
        continue
      }
      n.vy += 520 * dtS
      n.vx *= Math.exp(-3 * dtS)
      n.x += n.vx * dtS
      n.y += Math.min(n.vy, 40) * dtS
    }
    for (const i of this.impactos) {
      if (!i.activo) continue
      i.edad += dtMs
      if (i.edad >= i.vida) i.activo = false
    }
    for (let k = this.cola.length - 1; k >= 0; k--) {
      const a = this.cola[k]
      a.demora -= dtMs
      if (a.demora <= 0) {
        this.cola.splice(k, 1)
        this.mostrar(a)
      }
    }
    const a = this.actual
    if (a) {
      a.edad += dtMs
      if (a.persistente && p.fase !== 'final' && a.edad > 300 && a.saliendo < 0) a.saliendo = 0
      if (a.saliendo >= 0) a.saliendo += dtMs
      else if (a.edad >= a.dur) a.saliendo = 0
      if (a.saliendo >= 220) this.actual = null
    }
    const s = this.saliente
    if (s) {
      s.edad += dtMs
      s.saliendo += dtMs
      if (s.saliendo >= 140) this.saliente = null
    }
    for (let l = 0; l < 2; l++) {
      const c = this.combos[l]
      c.pop = suavizar(c.pop, 0, 11, dtS)
      // el combo se corta cuando el rival se recupera
      if (c.golpes >= 2 && p.luchadores[l].combo < 2 && this.E.ms - c.desde < 1000) c.desde = this.E.ms - 1000
    }
  }

  dibujarMundo(): void {
    const E = this.E
    const ctx = E.ctx
    const unidad = E.cam.esc
    const ox = E.cam.tx
    const oy = E.cam.ty
    ctx.imageSmoothingEnabled = true
    for (const n of this.numeros) {
      if (!n.activo || !n.pintado) continue
      const t = n.edad / n.vida
      const entrada = Math.min(1, n.edad / 140)
      const pop = n.tipo === 1 ? 1 + 0.9 * (1 - salidaConRebote(entrada)) : 1 + 0.5 * (1 - salidaCubica(entrada))
      const alfa = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1
      // pintado con escalaTextos de resolución: se dibuja agrandado lo mismo
      dibujarCentrado(ctx, n.pintado, ox, oy, unidad, n.x, n.y, pop * E.escalaTextos, n.tipo === 1 ? -0.08 : 0, alfa)
    }
    for (const i of this.impactos) {
      if (!i.activo) continue
      const def = IMPACTOS[i.clave]
      const p = this.cacheado(i.clave, def.texto, def.estilo)
      const t = i.edad / i.vida
      const escala = (0.45 + 0.55 * salidaElastica(Math.min(1, i.edad / 420))) * E.escalaTextos
      const subida = i.edad * 0.03
      const alfa = t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1
      let x = i.x
      if (i.clave === 'electrocutado') x += (Math.random() - 0.5) * 3
      if (i.clave === 'guardia' && i.edad > 260) {
        this.dibujarPartido(p, ox, oy, unidad, x, i.y - subida, escala, alfa, (i.edad - 260) / (i.vida - 260))
      } else {
        dibujarCentrado(ctx, p, ox, oy, unidad, x, i.y - subida, escala, -0.06, alfa)
      }
    }
    ctx.globalAlpha = 1
  }

  /** «¡GUARDIA ROTA!» se parte como un vidrio: dos mitades que se separan y caen. */
  private dibujarPartido(
    p: TextoPintado,
    ox: number,
    oy: number,
    unidad: number,
    x: number,
    y: number,
    escala: number,
    alfa: number,
    t: number,
  ): void {
    const ctx = this.E.ctx
    const w = p.lienzo.width
    const h = p.lienzo.height
    const sep = salidaCubica(Math.min(1, t * 1.6))
    for (let mitad = 0; mitad < 2; mitad++) {
      const signo = mitad === 0 ? -1 : 1
      const s = (unidad * escala) / p.escala
      const rot = -0.06 + signo * 0.09 * sep
      const dx = signo * 10 * sep
      const dy = signo * 9 * sep + entradaCuadratica(t) * 26
      const c = Math.cos(rot) * s
      const sn = Math.sin(rot) * s
      ctx.save()
      ctx.setTransform(c, sn, -sn, c, ox + unidad * (x + dx), oy + unidad * (y + dy))
      ctx.beginPath()
      const borde = mitad === 0 ? -h : h
      ctx.moveTo(-w, borde)
      for (let k = 0; k < CORTE_VIDRIO.length; k += 2) ctx.lineTo(CORTE_VIDRIO[k] * w * 1.02, CORTE_VIDRIO[k + 1] * h)
      ctx.lineTo(w, borde)
      ctx.closePath()
      ctx.clip()
      ctx.globalAlpha = Math.min(1, alfa)
      ctx.drawImage(p.lienzo, -w / 2, -h / 2)
      ctx.restore()
    }
  }

  dibujarPantalla(altoVista: number): void {
    const E = this.E
    const ctx = E.ctx
    const u = E.cam.base
    ctx.imageSmoothingEnabled = true
    // contador de combo, del lado de quien pega
    for (let l = 0; l < 2; l++) {
      const c = this.combos[l]
      if (!c.pintado || c.golpes < 2) continue
      const quieto = E.ms - c.desde
      if (quieto > 1300) continue
      const alfa = quieto > 1000 ? 1 - (quieto - 1000) / 300 : 1
      const x = l === 0 ? 118 : 842
      const y = altoVista * 0.33
      const esc = (1 + 0.38 * c.pop) * E.escalaTextos
      dibujarCentrado(ctx, c.pintado, 0, 0, u, x, y, esc, -0.06, alfa)
      const txt = this.cacheado('combo:golpes', 'GOLPES', COMBO_TXT)
      dibujarCentrado(ctx, txt, 0, 0, u, x + 4, y + 44 * E.escalaTextos, E.escalaTextos, -0.06, alfa)
    }
    if (this.saliente) this.dibujarAnuncio(this.saliente, altoVista)
    if (this.actual) this.dibujarAnuncio(this.actual, altoVista)
    ctx.globalAlpha = 1
  }

  private dibujarAnuncio(a: Anuncio, altoVista: number): void {
    const E = this.E
    const ctx = E.ctx
    const u = E.cam.base
    if (!a.pintado || a.pintado.escala !== this.escalaPintado()) {
      a.pintado = this.cacheado(`anuncio:${a.clave}:${a.texto}`, a.texto, ANUNCIOS[a.clave].estilo, 900)
    }
    const t = a.edad
    let escala = 1
    let dx = 0
    let alfa = 1
    if (a.entrada === 'rebote') {
      escala = 0.3 + 0.7 * salidaElastica(Math.min(1, t / 560))
      alfa = Math.min(1, t / 90)
    } else if (a.entrada === 'golpe') {
      if (t < 170) escala = 1 + 1.7 * (1 - salidaCubica(t / 170))
      else escala = 1 + 0.06 * Math.sin((t - 170) / 45) * Math.exp(-(t - 170) / 140)
      alfa = Math.min(1, t / 60)
    } else {
      dx = (1 - salidaConRebote(Math.min(1, t / 320))) * 720
    }
    if (a.persistente) escala *= 1 + 0.045 * Math.sin((t / 1000) * Math.PI * 2 * 2.2)
    if (a.saliendo >= 0) {
      const lim = a === this.saliente ? 140 : 220
      const s = acotar(a.saliendo / lim, 0, 1)
      alfa *= 1 - s
      if (a.entrada === 'deslizar') dx -= s * 720
      else escala *= 1 + 0.3 * s
    }
    // en pantallas más anchas que 16:9 se ve menos alto: el anuncio se achica con el alto visible
    escala *= acotar(altoVista / 540, 0.75, 1)
    const x = 480 + dx
    const y = altoVista * 0.4
    if (a.clave === 'turbo') this.dibujarRayosTurbo(x, y, alfa)
    dibujarCentrado(ctx, a.pintado, 0, 0, u, x, y, escala, -0.05, alfa)
  }

  /** Dos rayos a los costados de «TURBO». */
  private dibujarRayosTurbo(x: number, y: number, alfa: number): void {
    const ctx = this.E.ctx
    const u = this.E.cam.base
    ctx.globalAlpha = Math.min(1, alfa)
    for (let lado = -1; lado <= 1; lado += 2) {
      ctx.setTransform(u, 0, 0, u, u * (x + lado * 200), u * y)
      ctx.beginPath()
      ctx.moveTo(8, -46)
      ctx.lineTo(-14, 4)
      ctx.lineTo(0, 4)
      ctx.lineTo(-8, 46)
      ctx.lineTo(16, -6)
      ctx.lineTo(2, -6)
      ctx.closePath()
      ctx.lineJoin = 'round'
      ctx.lineWidth = 7
      ctx.strokeStyle = '#2A1600'
      ctx.stroke()
      ctx.fillStyle = '#FFE14A'
      ctx.fill()
    }
  }
}
