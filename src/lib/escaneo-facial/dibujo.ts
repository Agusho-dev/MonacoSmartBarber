/**
 * Dibujo del escáner facial (canvas 2D, sin React).
 *
 * Un solo canvas encima de la lente dibuja todo lo que se mueve:
 *   - el anillo de 72 marcas alrededor de la lente: el cometa que gira mientras
 *     espera, el progreso de la lectura (cian → violeta) y los estados,
 *   - la malla sobre la cara (meridianos y paralelos que giran con ella), los
 *     rasgos y los puntos clave,
 *   - el enganche: el óvalo guía se cierra sobre el contorno real de la cara
 *     cuando la encuentra, y la malla crece desde el centro,
 *   - el barrido de luz que recorre la cara de la frente al mentón mientras se
 *     lee, y un pulso por cada muestra tomada,
 *   - la navaja: al reconocer, una hoja de luz cruza la lente en diagonal y
 *     afeita la malla; el anillo se pone verde a su paso.
 *
 * Pensado para la Mali-G57 de la Redmi Pad 2: nada de `shadowBlur` (un blur por
 * figura, cientos por cuadro, era lo que trababa la versión anterior), la malla
 * entera va en UN path pintado con UN stroke por pasada, y los brillos son
 * trazos anchos con poca opacidad en modo aditivo.
 *
 * Coordenadas: la escena recibe los puntos en px del VIDEO y el encuadre
 * (`s`, `fx`, `fy`) con el que se está mostrando, y los lleva al lienzo
 * espejados, como se ve uno en un espejo: X = cx − s·(x − fx), Y = cy + s·(y − fy).
 */

import { INDICE_FRENTE, MallaCara, type PoseCara, type Puntos } from './geometria'
import type { FaseEscaner, Guia } from './tipos'

type RGB = readonly [number, number, number]

/** Colores de lo que se dibuja AFUERA de la lente (el anillo): dependen del fondo del kiosko. */
export interface Paleta {
  base: RGB
  baseAlfa: number
  borde: RGB
  bordeAlfa: number
  acento: RGB
  acento2: RGB
  exito: RGB
  aviso: RGB
  error: RGB
  /** Brillos en modo aditivo: sobre fondo oscuro suman luz; sobre claro, lavan. */
  aditivo: boolean
}

export const PALETA_OSCURA: Paleta = {
  base: [255, 255, 255],
  baseAlfa: 0.16,
  borde: [255, 255, 255],
  bordeAlfa: 0.2,
  acento: [103, 232, 249], // cyan-300
  acento2: [196, 181, 253], // violet-300
  exito: [52, 211, 153], // emerald-400
  aviso: [251, 191, 36], // amber-400
  error: [248, 113, 113], // red-400
  aditivo: true,
}

export const PALETA_CLARA: Paleta = {
  base: [24, 24, 27],
  baseAlfa: 0.13,
  borde: [24, 24, 27],
  bordeAlfa: 0.16,
  acento: [8, 145, 178], // cyan-600
  acento2: [124, 58, 237], // violet-600
  exito: [5, 150, 105], // emerald-600
  aviso: [217, 119, 6], // amber-600
  error: [220, 38, 38], // red-600
  aditivo: false,
}

/** Lo que se dibuja ADENTRO de la lente va sobre el video: no depende del tema. */
const CARA = {
  linea: [255, 255, 255] as RGB,
  nucleo: [236, 254, 255] as RGB, // cyan-50
  barrido: [165, 243, 252] as RGB, // cyan-200
  brillo: [34, 211, 238] as RGB, // cyan-400
  exito: [110, 231, 183] as RGB, // emerald-300
  aviso: [252, 211, 77] as RGB, // amber-300
}

export interface Encuadre {
  /** Escala: px del lienzo por px del video. */
  s: number
  /** Punto del video que cae en el centro de la lente. */
  fx: number
  fy: number
}

/** Todo lo que la escena necesita saber para dibujar UN cuadro. */
export interface CuadroEscena {
  t: number
  fase: FaseEscaner
  tFase: number
  /** Progreso visible del anillo (0–1), ya suavizado. */
  progreso: number
  guia: Guia | null
  /** Qué tan presente está la cara (0–1): entra y sale con fundido. */
  presencia: number
  puntos: Puntos | null
  pose: PoseCara | null
  encuadre: Encuadre
  /** Cuándo apareció la cara (dispara el enganche). */
  tEnganche: number | null
  /** Momentos en que se tomó cada muestra del intento actual. */
  muestras: readonly number[]
  tExito: number | null
  tAviso: number | null
  /** prefers-reduced-motion: sin cometa, sin barrido, sin navaja. */
  reducido: boolean
}

const TAU = Math.PI * 2
const N_MARCAS = 72
const MUESTRAS_OVALO = 48
/** Ojos (comisuras), nariz, boca, mentón, cejas y entrecejo. */
const PUNTOS_CLAVE = [36, 39, 42, 45, 30, 48, 54, 8, 19, 24, 27] as const

const RASGOS_ABIERTOS = [
  [17, 18, 19, 20, 21],
  [22, 23, 24, 25, 26],
  [27, 28, 29, 30],
  [31, 32, 33, 34, 35],
] as const
const RASGOS_CERRADOS = [
  [36, 37, 38, 39, 40, 41],
  [42, 43, 44, 45, 46, 47],
  [48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59],
  [60, 61, 62, 63, 64, 65, 66, 67],
] as const

export const DURACION_ENGANCHE = 420
/**
 * Coreografía del éxito (ms desde que llegó el veredicto):
 *   0–320   una onda verde recorre la malla desde la nariz hacia afuera: "te encontré",
 *   200–740 la navaja cruza la lente y afeita la malla; el anillo se pone verde a su paso,
 *   640     aparece el sello de verificado (lo anima el componente, con el tilde a los 860).
 */
const ONDA_EXITO = 320
const INICIO_NAVAJA = 200
const DURACION_NAVAJA = 540
/** Dirección de la navaja: de arriba a la izquierda hacia abajo a la derecha. */
const NAV_X = 0.5145
const NAV_Y = 0.8575

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

function rgba(c: RGB, a: number): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${a <= 0 ? 0 : a >= 1 ? 1 : Math.round(a * 1000) / 1000})`
}

function mezclar(a: RGB, b: RGB, k: number, out: number[]): void {
  out[0] = Math.round(a[0] + (b[0] - a[0]) * k)
  out[1] = Math.round(a[1] + (b[1] - a[1]) * k)
  out[2] = Math.round(a[2] + (b[2] - a[2]) * k)
}

const salida = (t: number) => 1 - Math.pow(1 - t, 3)
const ondaSuave = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2

/** Brillo redondo pre-renderizado: un drawImage es mucho más barato que un gradiente por punto. */
function crearBrillo(c: RGB): HTMLCanvasElement {
  const lienzo = document.createElement('canvas')
  lienzo.width = 64
  lienzo.height = 64
  const ctx = lienzo.getContext('2d')
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    g.addColorStop(0, rgba(c, 0.95))
    g.addColorStop(0.35, rgba(c, 0.4))
    g.addColorStop(1, rgba(c, 0))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 64, 64)
  }
  return lienzo
}

export class EscenaEscaner {
  private readonly ctx: CanvasRenderingContext2D
  private readonly paleta: Paleta
  private readonly malla = new MallaCara()
  private readonly brillos: { cian: HTMLCanvasElement; exito: HTMLCanvasElement; aviso: HTMLCanvasElement }
  private readonly ovalo = new Float32Array(MUESTRAS_OVALO * 2)
  private readonly contornoLienzo: Float32Array
  private readonly acumulado: Float32Array
  private readonly enganche = new Float32Array(MUESTRAS_OVALO * 2)
  private readonly cuerda = new Float32Array(4)
  /** Color y opacidad de la marca que se está pintando (sin alocar por marca). */
  private readonly color = [0, 0, 0]
  private alfaMarca = 0
  /** Color de cada marca leída: cian arriba, violeta al cerrar la vuelta. */
  private readonly tintas: RGB[]
  private lado = 0
  private dpr = 1
  private cx = 0
  private cy = 0
  private r = 0
  private liviana = false

  constructor(
    private readonly lienzo: HTMLCanvasElement,
    tema: 'oscuro' | 'claro',
    /** Espacio entre el borde del lienzo y la lente: ahí vive el anillo. */
    private readonly margen: number,
  ) {
    const ctx = lienzo.getContext('2d')
    if (!ctx) throw new Error('El navegador no dio un contexto 2D para el escáner')
    this.ctx = ctx
    this.paleta = tema === 'claro' ? PALETA_CLARA : PALETA_OSCURA
    this.brillos = { cian: crearBrillo(CARA.brillo), exito: crearBrillo(CARA.exito), aviso: crearBrillo(CARA.aviso) }
    this.contornoLienzo = new Float32Array(this.malla.nContorno * 2)
    this.acumulado = new Float32Array(this.malla.nContorno + 1)
    this.tintas = Array.from({ length: N_MARCAS }, (_, i) => {
      const out = [0, 0, 0]
      mezclar(this.paleta.acento, this.paleta.acento2, i / N_MARCAS, out)
      return out as unknown as RGB
    })
  }

  /** Mezcla la marca entre el color base y `col` (k = 0 base, 1 `col`). */
  private encender(k: number, col: RGB, alfaMax = 0.95): void {
    const pal = this.paleta
    mezclar(pal.base, col, k, this.color)
    this.alfaMarca = pal.baseAlfa + (alfaMax - pal.baseAlfa) * k
  }

  /** Radio de la lente en px CSS (el escáner lo necesita para encuadrar). */
  get radio(): number {
    return this.r
  }

  /** Tamaño del lienzo en px CSS y densidad de píxeles con la que se pinta. */
  medir(lado: number, dpr: number): void {
    this.lado = lado
    this.dpr = dpr
    this.lienzo.width = Math.max(1, Math.round(lado * dpr))
    this.lienzo.height = Math.max(1, Math.round(lado * dpr))
    this.cx = lado / 2
    this.cy = lado / 2
    this.r = Math.max(1, lado / 2 - this.margen)
    // Óvalo guía: de arriba, en el sentido de las agujas del reloj (como el contorno).
    const a = this.r * 0.44
    const b = this.r * 0.58
    const cy = this.cy - this.r * 0.03
    for (let j = 0; j < MUESTRAS_OVALO; j++) {
      const th = -Math.PI / 2 + (TAU * j) / MUESTRAS_OVALO
      this.ovalo[2 * j] = this.cx + a * Math.cos(th)
      this.ovalo[2 * j + 1] = cy + b * Math.sin(th)
    }
  }

  /** Menos trabajo por cuadro (sin halos): lo pide el escáner si la tablet no llega. */
  aliviar(): void {
    this.liviana = true
  }

  dibujar(c: CuadroEscena): void {
    const { ctx } = this
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, this.lado, this.lado)
    if (this.lado === 0) return

    const hayCara = c.puntos !== null && c.pose !== null && c.presencia > 0.01
    if (hayCara) {
      this.malla.armar(c.puntos as Puntos, c.pose as PoseCara)
      this.dibujarCara(c)
    }
    const navaja = this.navaja(c)
    if (navaja && navaja.p > 0 && navaja.p < 1) this.dibujarNavaja(navaja.s)
    this.dibujarGuia(c, hayCara)
    this.dibujarDestellos(c)
    this.dibujarAnillo(c)
  }

  // ── Coordenadas ───────────────────────────────────────────────────────────

  private X(x: number, e: Encuadre): number {
    return this.cx - e.s * (x - e.fx)
  }

  private Y(y: number, e: Encuadre): number {
    return this.cy + e.s * (y - e.fy)
  }

  // ── Cara ──────────────────────────────────────────────────────────────────

  /** Opacidad de la malla según el momento. */
  private alfaFase(c: CuadroEscena): number {
    switch (c.fase) {
      case 'ajustando':
      case 'buscando':
        return 0.55
      case 'leyendo':
        return 1
      case 'consultando':
        return c.reducido ? 0.9 : 0.86 + 0.14 * Math.sin((c.t - c.tFase) / 190)
      case 'exito':
        return 1
      case 'reintento':
        return c.tAviso === null ? 0.3 : Math.max(0.3, 1 - (c.t - c.tAviso) / 320)
      case 'fallo':
        return c.tAviso === null ? 0 : Math.max(0, 1 - (c.t - c.tAviso) / 650)
      default:
        return 0
    }
  }

  /** Dónde va el barrido sobre el eje de la cara (0 frente, 1 mentón), o null si no hay. */
  private posicionBarrido(c: CuadroEscena): number | null {
    if (c.reducido) return null
    if (c.fase !== 'leyendo' && c.fase !== 'consultando') return null
    const periodo = c.fase === 'consultando' ? 860 : 1350
    const k = ((c.t - c.tFase) % periodo) / periodo
    return -0.2 + 1.4 * ondaSuave(k)
  }

  /** Avance de la navaja: `s` es la posición de la hoja sobre su eje, desde el centro de la lente. */
  private navaja(c: CuadroEscena): { p: number; s: number } | null {
    if (c.tExito === null) return null
    if (c.reducido) return { p: 1, s: Infinity }
    const e = c.t - c.tExito - INICIO_NAVAJA
    if (e <= 0) return { p: 0, s: -Infinity }
    const p = ondaSuave(clamp(e / DURACION_NAVAJA, 0, 1))
    return { p, s: -this.r * 1.05 + 2.1 * this.r * p }
  }

  private dibujarCara(c: CuadroEscena): void {
    const alfa = c.presencia * this.alfaFase(c)
    if (alfa < 0.01) return
    const { ctx } = this
    const e = c.encuadre
    const m = this.malla
    const puntos = c.puntos as Puntos
    const tono = c.fase === 'exito' ? CARA.exito : c.fase === 'reintento' || c.fase === 'fallo' ? CARA.aviso : CARA.linea
    const brillo =
      c.fase === 'exito' ? this.brillos.exito : c.fase === 'reintento' || c.fase === 'fallo' ? this.brillos.aviso : this.brillos.cian
    const navaja = this.navaja(c)
    // La navaja ya pasó: la cara quedó limpia.
    if (navaja && (navaja.s === Infinity || navaja.p >= 1)) return
    // Mientras engancha, la malla crece desde el centro de la cara.
    const crecimiento =
      c.tEnganche === null || c.reducido ? 1 : 0.25 + 0.75 * salida(clamp((c.t - c.tEnganche) / DURACION_ENGANCHE, 0, 1))

    ctx.save()
    ctx.beginPath()
    ctx.arc(this.cx, this.cy, this.r - 0.5, 0, TAU)
    ctx.clip()
    if (navaja && navaja.p > 0) this.recortarDelanteDeLaNavaja(navaja.s)
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'

    // 1) Malla, con un gradiente radial: firme en el centro, se apaga hacia el borde.
    ctx.beginPath()
    this.trazarMalla(e)
    const ccx = this.X(m.centroX, e)
    const ccy = this.Y(m.centroY, e)
    const radio = m.radio * e.s * 1.12 * crecimiento
    const radial = ctx.createRadialGradient(ccx, ccy, radio * 0.12, ccx, ccy, radio)
    radial.addColorStop(0, rgba(tono, 0.36 * alfa))
    radial.addColorStop(0.6, rgba(tono, 0.26 * alfa))
    radial.addColorStop(1, rgba(tono, 0))
    ctx.strokeStyle = radial
    ctx.lineWidth = 1
    ctx.stroke()

    // Al reconocer: una onda de luz verde recorre la malla desde el centro de la cara.
    if (c.fase === 'exito' && c.tExito !== null && !c.reducido) {
      const k = (c.t - c.tExito) / ONDA_EXITO
      if (k >= 0 && k < 1) {
        const alcance = m.radio * e.s * 1.15
        const frente = salida(k) * alcance
        const ancho = alcance * 0.4
        const onda = ctx.createRadialGradient(ccx, ccy, Math.max(0, frente - ancho), ccx, ccy, frente + ancho * 0.25)
        onda.addColorStop(0, rgba(CARA.exito, 0))
        onda.addColorStop(0.75, rgba(CARA.nucleo, 0.95 * (1 - 0.5 * k)))
        onda.addColorStop(1, rgba(CARA.exito, 0))
        ctx.globalCompositeOperation = 'lighter'
        ctx.strokeStyle = onda
        ctx.lineWidth = 1.8
        ctx.stroke()
        if (!this.liviana) {
          ctx.globalAlpha = 0.32
          ctx.lineWidth = 6
          ctx.stroke()
          ctx.globalAlpha = 1
        }
        ctx.globalCompositeOperation = 'source-over'
      }
    }

    // 2) Barrido: el mismo path, repintado con una franja de luz que baja.
    const k = this.posicionBarrido(c)
    let franja: CanvasGradient | null = null
    if (k !== null) {
      const x0 = this.X(m.eje[0], e)
      const y0 = this.Y(m.eje[1], e)
      const x1 = this.X(m.eje[2], e)
      const y1 = this.Y(m.eje[3], e)
      franja = ctx.createLinearGradient(x0, y0, x1, y1)
      const parada = (o: number, col: RGB, a: number) => franja!.addColorStop(clamp(o, 0, 1), rgba(col, a))
      parada(k - 0.24, CARA.brillo, 0)
      parada(k - 0.06, CARA.brillo, 0.32 * alfa)
      parada(k, CARA.nucleo, 0.95 * alfa)
      parada(k + 0.02, CARA.barrido, 0.6 * alfa)
      parada(k + 0.16, CARA.brillo, 0)
      ctx.globalCompositeOperation = 'lighter'
      ctx.strokeStyle = franja
      ctx.lineWidth = 1.7
      ctx.stroke()
      if (!this.liviana) {
        ctx.globalAlpha = 0.26
        ctx.lineWidth = 6
        ctx.stroke()
        ctx.globalAlpha = 1
      }
      // La hoja: la cuerda de la cara a la altura del barrido.
      if (k > 0.01 && k < 0.99) {
        m.cuerda(k, this.cuerda)
        const ax = this.X(this.cuerda[0], e)
        const ay = this.Y(this.cuerda[1], e)
        const bx = this.X(this.cuerda[2], e)
        const by = this.Y(this.cuerda[3], e)
        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.lineTo(bx, by)
        if (!this.liviana) {
          ctx.strokeStyle = rgba(CARA.brillo, 0.22 * alfa)
          ctx.lineWidth = 9
          ctx.stroke()
        }
        ctx.strokeStyle = rgba(CARA.nucleo, 0.85 * alfa)
        ctx.lineWidth = 1.6
        ctx.stroke()
      }
      ctx.globalCompositeOperation = 'source-over'
    }

    // 3) Contorno y rasgos: lo que hace que la malla "lea" la cara y no sea un sello.
    ctx.beginPath()
    this.trazarContorno(e)
    ctx.strokeStyle = rgba(tono, 0.22 * alfa * crecimiento)
    ctx.lineWidth = 1.2
    ctx.stroke()

    ctx.beginPath()
    for (const r of RASGOS_ABIERTOS) this.curva(puntos, r, false, e)
    for (const r of RASGOS_CERRADOS) this.curva(puntos, r, true, e)
    ctx.strokeStyle = rgba(tono, 0.55 * alfa * crecimiento)
    ctx.lineWidth = 1.25
    ctx.stroke()
    if (franja) {
      ctx.globalCompositeOperation = 'lighter'
      ctx.strokeStyle = franja
      ctx.lineWidth = 1.6
      ctx.stroke()
      ctx.globalCompositeOperation = 'source-over'
    }

    // 4) Puntos clave, con su halo, y los pulsos de cada muestra.
    this.dibujarPuntosClave(c, puntos, e, brillo, alfa * crecimiento)
    ctx.restore()
  }

  private trazarMalla(e: Encuadre): void {
    const { ctx } = this
    const m = this.malla
    for (let j = 0; j < m.nMeridianos; j++) {
      if (m.visibilidad[j] <= 0) continue
      const base = j * m.filas * 2
      ctx.moveTo(this.X(m.meridianos[base], e), this.Y(m.meridianos[base + 1], e))
      for (let r = 1; r < m.filas; r++) {
        ctx.lineTo(this.X(m.meridianos[base + 2 * r], e), this.Y(m.meridianos[base + 2 * r + 1], e))
      }
    }
    for (let k = 0; k < m.nParalelos; k++) {
      const base = k * m.puntosParalelo * 2
      ctx.moveTo(this.X(m.paralelos[base], e), this.Y(m.paralelos[base + 1], e))
      for (let i = 1; i < m.puntosParalelo; i++) {
        ctx.lineTo(this.X(m.paralelos[base + 2 * i], e), this.Y(m.paralelos[base + 2 * i + 1], e))
      }
    }
  }

  private trazarContorno(e: Encuadre): void {
    const { ctx } = this
    const m = this.malla
    ctx.moveTo(this.X(m.contorno[0], e), this.Y(m.contorno[1], e))
    for (let i = 1; i < m.nContorno; i++) ctx.lineTo(this.X(m.contorno[2 * i], e), this.Y(m.contorno[2 * i + 1], e))
    ctx.closePath()
  }

  /** Curva suave por los puntos (punto medio + cuadrática), abierta o cerrada. */
  private curva(p: Puntos, idx: readonly number[], cerrada: boolean, e: Encuadre): void {
    const { ctx } = this
    const n = idx.length
    const px = (i: number) => this.X(p[2 * idx[i]], e)
    const py = (i: number) => this.Y(p[2 * idx[i] + 1], e)
    if (cerrada) {
      ctx.moveTo((px(n - 1) + px(0)) / 2, (py(n - 1) + py(0)) / 2)
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n
        ctx.quadraticCurveTo(px(i), py(i), (px(i) + px(j)) / 2, (py(i) + py(j)) / 2)
      }
      return
    }
    ctx.moveTo(px(0), py(0))
    for (let i = 1; i < n - 1; i++) {
      ctx.quadraticCurveTo(px(i), py(i), (px(i) + px(i + 1)) / 2, (py(i) + py(i + 1)) / 2)
    }
    ctx.lineTo(px(n - 1), py(n - 1))
  }

  private dibujarPuntosClave(c: CuadroEscena, p: Puntos, e: Encuadre, brillo: HTMLCanvasElement, alfa: number): void {
    const { ctx } = this
    if (!this.liviana) {
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = clamp(0.5 * alfa, 0, 1)
      for (const i of PUNTOS_CLAVE) ctx.drawImage(brillo, this.X(p[2 * i], e) - 9, this.Y(p[2 * i + 1], e) - 9, 18, 18)
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
    }
    ctx.beginPath()
    for (const i of PUNTOS_CLAVE) {
      const x = this.X(p[2 * i], e)
      const y = this.Y(p[2 * i + 1], e)
      ctx.moveTo(x + 1.7, y)
      ctx.arc(x, y, 1.7, 0, TAU)
    }
    ctx.fillStyle = rgba(CARA.linea, 0.92 * alfa)
    ctx.fill()

    // Un pulso que se abre desde cada punto clave cuando se toma una muestra.
    if (c.reducido) return
    for (const tm of c.muestras) {
      const k = (c.t - tm) / 560
      if (k < 0 || k >= 1) continue
      const radio = 2.5 + 15 * salida(k)
      ctx.beginPath()
      for (const i of PUNTOS_CLAVE) {
        const x = this.X(p[2 * i], e)
        const y = this.Y(p[2 * i + 1], e)
        ctx.moveTo(x + radio, y)
        ctx.arc(x, y, radio, 0, TAU)
      }
      ctx.strokeStyle = rgba(CARA.barrido, (1 - k) * (1 - k) * 0.85 * alfa)
      ctx.lineWidth = 1.2
      ctx.stroke()
    }
  }

  // ── Navaja ────────────────────────────────────────────────────────────────

  /** Deja dibujar sólo lo que la hoja todavía no pasó. */
  private recortarDelanteDeLaNavaja(s: number): void {
    const { ctx } = this
    const bx = this.cx + NAV_X * s
    const by = this.cy + NAV_Y * s
    const L = this.r * 3
    const px = -NAV_Y * L
    const py = NAV_X * L
    ctx.beginPath()
    ctx.moveTo(bx + px, by + py)
    ctx.lineTo(bx - px, by - py)
    ctx.lineTo(bx - px + NAV_X * L, by - py + NAV_Y * L)
    ctx.lineTo(bx + px + NAV_X * L, by + py + NAV_Y * L)
    ctx.closePath()
    ctx.clip()
  }

  private dibujarNavaja(s: number): void {
    if (Math.abs(s) >= this.r) return
    const { ctx } = this
    const mitad = Math.sqrt(this.r * this.r - s * s)
    const bx = this.cx + NAV_X * s
    const by = this.cy + NAV_Y * s
    const px = -NAV_Y
    const py = NAV_X
    const ax = bx + px * mitad
    const ay = by + py * mitad
    const cx = bx - px * mitad
    const cy = by - py * mitad

    ctx.save()
    ctx.beginPath()
    ctx.arc(this.cx, this.cy, this.r - 0.5, 0, TAU)
    ctx.clip()
    ctx.globalCompositeOperation = 'lighter'

    // Estela: un velo verde que se desvanece detrás de la hoja.
    const estela = 64
    const g = ctx.createLinearGradient(bx, by, bx - NAV_X * estela, by - NAV_Y * estela)
    g.addColorStop(0, rgba(CARA.exito, 0.32))
    g.addColorStop(1, rgba(CARA.exito, 0))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(cx, cy)
    ctx.lineTo(cx - NAV_X * estela, cy - NAV_Y * estela)
    ctx.lineTo(ax - NAV_X * estela, ay - NAV_Y * estela)
    ctx.closePath()
    ctx.fill()

    // La hoja: halo ancho, filo y brillo blanco.
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(cx, cy)
    ctx.lineCap = 'round'
    if (!this.liviana) {
      ctx.strokeStyle = rgba(CARA.exito, 0.3)
      ctx.lineWidth = 14
      ctx.stroke()
    }
    ctx.strokeStyle = rgba(CARA.exito, 0.6)
    ctx.lineWidth = 5
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'
    ctx.lineWidth = 1.8
    ctx.stroke()
    ctx.restore()

    // Destello de filo donde la hoja toca el borde de la lente.
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (const [x, y] of [
      [ax, ay],
      [cx, cy],
    ]) {
      ctx.drawImage(this.brillos.exito, x - 14, y - 14, 28, 28)
      ctx.beginPath()
      ctx.moveTo(x - 9, y)
      ctx.lineTo(x + 9, y)
      ctx.moveTo(x, y - 9)
      ctx.lineTo(x, y + 9)
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.lineWidth = 1.4
      ctx.stroke()
    }
    ctx.restore()
  }

  // ── Guía y enganche ───────────────────────────────────────────────────────

  private dibujarGuia(c: CuadroEscena, hayCara: boolean): void {
    const { ctx } = this
    const enganche = c.tEnganche === null || c.reducido ? 1 : (c.t - c.tEnganche) / DURACION_ENGANCHE

    // El óvalo punteado: "poné la cara acá". Vuelve cuando hay que acercarse o alejarse.
    let alfa = 0
    let escala = 1
    if (c.fase === 'buscando') alfa = c.reducido ? 0.5 : 0.48 + 0.14 * Math.sin(c.t / 520)
    else if (c.fase === 'preparando') alfa = 0.16
    else if (c.fase === 'ajustando' && (c.guia === 'acercate' || c.guia === 'alejate' || c.guia === 'centrate')) {
      alfa = 0.62
      const pulso = c.reducido ? 0 : 0.5 + 0.5 * Math.sin(c.t / 210)
      escala = c.guia === 'acercate' ? 1 + 0.04 * pulso : c.guia === 'alejate' ? 1 - 0.04 * pulso : 1
    }
    if (alfa > 0 && (enganche >= 1 || !hayCara)) {
      ctx.save()
      ctx.setLineDash([2, 10])
      ctx.lineDashOffset = c.reducido ? 0 : -(c.t / 45) % 12
      ctx.lineCap = 'round'
      ctx.lineWidth = 2.5
      ctx.strokeStyle = rgba(CARA.linea, alfa)
      ctx.beginPath()
      ctx.ellipse(this.cx, this.cy - this.r * 0.03, this.r * 0.44 * escala, this.r * 0.58 * escala, 0, 0, TAU)
      ctx.stroke()
      ctx.restore()
    }

    // Enganche: el óvalo se cierra sobre el contorno real de la cara.
    if (!hayCara || enganche >= 1 || enganche < 0) return
    this.remuestrearContorno(c.encuadre)
    const k = salida(enganche)
    ctx.save()
    ctx.beginPath()
    ctx.arc(this.cx, this.cy, this.r - 0.5, 0, TAU)
    ctx.clip()
    ctx.beginPath()
    for (let j = 0; j < MUESTRAS_OVALO; j++) {
      const x = this.ovalo[2 * j] + (this.enganche[2 * j] - this.ovalo[2 * j]) * k
      const y = this.ovalo[2 * j + 1] + (this.enganche[2 * j + 1] - this.ovalo[2 * j + 1]) * k
      if (j === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.lineJoin = 'round'
    const desvanecer = 1 - enganche * 0.85
    ctx.globalCompositeOperation = 'lighter'
    if (!this.liviana) {
      ctx.strokeStyle = rgba(CARA.brillo, 0.22 * desvanecer)
      ctx.lineWidth = 8
      ctx.stroke()
    }
    ctx.strokeStyle = rgba(CARA.barrido, 0.9 * desvanecer)
    ctx.lineWidth = 2.2
    ctx.stroke()
    ctx.restore()
  }

  /** El contorno de la cara en px del lienzo, en MUESTRAS_OVALO puntos parejos desde la frente. */
  private remuestrearContorno(e: Encuadre): void {
    const m = this.malla
    const n = m.nContorno
    const p = this.contornoLienzo
    for (let k = 0; k < n; k++) {
      const i = (INDICE_FRENTE + k) % n
      p[2 * k] = this.X(m.contorno[2 * i], e)
      p[2 * k + 1] = this.Y(m.contorno[2 * i + 1], e)
    }
    const acc = this.acumulado
    acc[0] = 0
    for (let k = 1; k <= n; k++) {
      const a = k - 1
      const b = k % n
      acc[k] = acc[a] + Math.hypot(p[2 * b] - p[2 * a], p[2 * b + 1] - p[2 * a + 1])
    }
    const total = acc[n]
    let tramo = 0
    for (let j = 0; j < MUESTRAS_OVALO; j++) {
      const objetivo = (total * j) / MUESTRAS_OVALO
      while (tramo < n - 1 && acc[tramo + 1] < objetivo) tramo++
      const a = tramo
      const b = (tramo + 1) % n
      const f = clamp((objetivo - acc[tramo]) / Math.max(1e-6, acc[tramo + 1] - acc[tramo]), 0, 1)
      this.enganche[2 * j] = p[2 * a] + (p[2 * b] - p[2 * a]) * f
      this.enganche[2 * j + 1] = p[2 * a + 1] + (p[2 * b + 1] - p[2 * a + 1]) * f
    }
  }

  // ── Destellos ─────────────────────────────────────────────────────────────

  /** Un flash suave en la lente al tomar cada muestra y al reconocer. */
  private dibujarDestellos(c: CuadroEscena): void {
    if (c.reducido) return
    let intensidad = 0
    const ultima = c.muestras.length ? c.muestras[c.muestras.length - 1] : null
    if (ultima !== null) {
      const k = (c.t - ultima) / 280
      if (k >= 0 && k < 1) intensidad = 0.12 * (1 - k) * (1 - k)
    }
    let color: RGB = CARA.linea
    if (c.tExito !== null) {
      const k = (c.t - c.tExito) / 360
      if (k >= 0 && k < 1) {
        intensidad = Math.max(intensidad, 0.16 * (1 - k) * (1 - k))
        color = CARA.exito
      }
    }
    if (intensidad <= 0.002) return
    const { ctx } = this
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = rgba(color, intensidad)
    ctx.beginPath()
    ctx.arc(this.cx, this.cy, this.r - 0.5, 0, TAU)
    ctx.fill()
    ctx.restore()
  }

  // ── Anillo ────────────────────────────────────────────────────────────────

  private dibujarAnillo(c: CuadroEscena): void {
    const { ctx, paleta: pal } = this
    const t = c.t
    const rDentro = this.r + 11
    const largo = 10
    const navaja = this.navaja(c)
    const color = this.color
    const p = clamp(c.progreso, 0, 1)

    // Sacudida al no coincidir: un "no" con la cabeza.
    let dx = 0
    if (!c.reducido && c.tAviso !== null && (c.fase === 'reintento' || c.fase === 'fallo')) {
      const e = t - c.tAviso
      if (e < 520) dx = Math.sin(e * 0.06) * 6 * Math.exp(-e / 170)
    }

    ctx.save()
    if (dx !== 0) ctx.translate(dx, 0)
    ctx.lineCap = 'round'

    // Borde de la lente, con el tramo ya leído en color.
    ctx.beginPath()
    ctx.arc(this.cx, this.cy, this.r + 0.5, 0, TAU)
    ctx.strokeStyle = rgba(pal.borde, pal.bordeAlfa)
    ctx.lineWidth = 1
    ctx.stroke()
    if (p > 0.005 && c.fase !== 'error') {
      const col = c.fase === 'exito' ? pal.exito : c.fase === 'reintento' || c.fase === 'fallo' ? pal.aviso : pal.acento
      ctx.beginPath()
      ctx.arc(this.cx, this.cy, this.r + 0.5, -Math.PI / 2, -Math.PI / 2 + TAU * p)
      ctx.strokeStyle = rgba(col, 0.55)
      ctx.lineWidth = 1.5
      ctx.stroke()
    }

    // Halo de las marcas encendidas: tres pasadas (una por intensidad) en vez de una por marca.
    const halos = this.liviana ? null : [new Path2D(), new Path2D(), new Path2D()]
    let hayHalo = false

    for (let i = 0; i < N_MARCAS; i++) {
      const f = i / N_MARCAS
      const ang = -Math.PI / 2 + f * TAU
      const cos = Math.cos(ang)
      const sin = Math.sin(ang)
      const tinta = this.tintas[i]
      let extra = 0
      let halo = 0
      this.encender(0, pal.base)

      switch (c.fase) {
        case 'preparando':
        case 'buscando': {
          if (c.reducido) break
          // Cometa: rápido mientras carga, lento mientras espera una cara.
          const vuelta = c.fase === 'preparando' ? 1050 : 2900
          const cola = c.fase === 'preparando' ? 0.24 : 0.32
          const cabeza = (t / vuelta) % 1
          const detras = (cabeza - f + 1) % 1
          if (detras < cola) {
            const k = Math.pow(1 - detras / cola, 2) * (c.fase === 'preparando' ? 1 : 0.75)
            this.encender(k, tinta)
            extra = 3 * k
            halo = k
          }
          break
        }
        case 'ajustando': {
          // Vio una cara: el anillo respira, todavía sin progreso.
          this.encender(c.reducido ? 0.1 : 0.08 + 0.07 * (0.5 + 0.5 * Math.sin(t / 480 - f * TAU)), pal.acento)
          break
        }
        case 'leyendo':
        case 'consultando': {
          const lleno = clamp(p * N_MARCAS - i, 0, 1)
          if (lleno > 0) {
            let brillo = 1
            if (c.fase === 'consultando' && !c.reducido) brillo = 0.72 + 0.28 * Math.sin(TAU * (f * 3 - (t - c.tFase) / 700))
            this.encender(lleno, tinta, 0.95 * brillo)
            halo = lleno * 0.7 * brillo
          }
          // La marca que va adelante, más larga y brillante.
          const delta = p * N_MARCAS - i - 0.5
          const punta = p < 0.999 ? Math.exp(-(delta * delta) / 1.6) : 0
          if (punta > 0.02) {
            extra = 5 * punta
            this.alfaMarca = Math.max(this.alfaMarca, 0.65 * punta)
            halo = Math.max(halo, punta)
          }
          break
        }
        case 'exito': {
          if (navaja && navaja.s !== Infinity && navaja.p < 1) {
            // Verde a medida que la hoja pasa por cada marca.
            const proyeccion = (cos * NAV_X + sin * NAV_Y) * (rDentro + 5)
            if (proyeccion < navaja.s) {
              this.encender(1, pal.exito)
              halo = 1
            } else {
              this.encender(1, tinta)
              halo = 0.6
            }
            const d = Math.abs(proyeccion - navaja.s)
            if (d < 28) extra = 8 * (1 - d / 28)
          } else {
            this.encender(1, pal.exito, c.reducido ? 0.95 : 0.88 + 0.12 * Math.sin(t / 380))
            halo = 0.9
          }
          break
        }
        case 'reintento':
        case 'fallo': {
          const lleno = clamp(p * N_MARCAS - i, 0, 1)
          this.encender(Math.max(lleno, c.fase === 'fallo' ? 0.4 : 0.15), pal.aviso, 0.9)
          halo = lleno * 0.6
          break
        }
        case 'error':
          this.encender(0.5, pal.error, 0.7)
          break
      }

      const r0 = rDentro
      const r1 = rDentro + largo + extra
      ctx.beginPath()
      ctx.moveTo(this.cx + cos * r0, this.cy + sin * r0)
      ctx.lineTo(this.cx + cos * r1, this.cy + sin * r1)
      ctx.strokeStyle = rgba(color as unknown as RGB, this.alfaMarca)
      ctx.lineWidth = 3
      ctx.stroke()

      if (halos && halo > 0.05) {
        const nivel = halo > 0.66 ? 2 : halo > 0.33 ? 1 : 0
        halos[nivel].moveTo(this.cx + cos * r0, this.cy + sin * r0)
        halos[nivel].lineTo(this.cx + cos * r1, this.cy + sin * r1)
        hayHalo = true
      }
    }

    if (halos && hayHalo) {
      const col = c.fase === 'exito' ? pal.exito : c.fase === 'reintento' || c.fase === 'fallo' ? pal.aviso : pal.acento
      ctx.globalCompositeOperation = pal.aditivo ? 'lighter' : 'source-over'
      ctx.lineWidth = 8
      const base = pal.aditivo ? 0.2 : 0.12
      for (let nivel = 0; nivel < 3; nivel++) {
        ctx.strokeStyle = rgba(col, base * ((nivel + 1) / 3))
        ctx.stroke(halos[nivel])
      }
      ctx.globalCompositeOperation = 'source-over'
    }
    ctx.restore()
  }
}
