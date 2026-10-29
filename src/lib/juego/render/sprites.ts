/**
 * Sprites dibujados una sola vez y reusados en cada cuadro: brillos, sombra, estrellas,
 * estallidos de golpe, mechones de pelo, nubes, el escudo de la guardia, el sillón de barbero y
 * la tijera de los proyectiles procedurales. Con esto ningún cuadro crea degradés ni usa sombras
 * del canvas.
 */
import { contexto, crearLienzo, liberarLienzo } from './lienzo'
import { aclarar, rgba, TAU } from './util'

/** px de lienzo por unidad de mundo de los objetos dibujados a mano (nítidos hasta ~2,5×). */
const RES = 2.6

export interface Sprites {
  sombra: HTMLCanvasElement
  /** Brillo suave de núcleo claro, por color (cacheado). */
  brillo(color: string): HTMLCanvasElement
  /** Destellos de 4 puntas: 0 blanco, 1 oro, 2 celeste. */
  estrella: HTMLCanvasElement[]
  /** Estrellitas del mareo: 0 oro, 1 celeste (guardia rota). */
  estrella5: HTMLCanvasElement[]
  /** Estallidos de golpe: 0 fuego, 1 azul (bloqueo), 2 oro (crítico), 3 eléctrico, 4 hielo. */
  estallido: HTMLCanvasElement[]
  /** Nubes suaves: 0 polvo, 1 niebla del spray, 2 viento blanco. */
  nube: HTMLCanvasElement[]
  mechones: HTMLCanvasElement[]
  /** Escudo de la guardia del color del personaje (cacheado por color). */
  escudo(color: string): HTMLCanvasElement
  /** Sillón de barbero (mira a la derecha), 120×120 de mundo. */
  sillon(): HTMLCanvasElement
  /** Tijera abierta, 48×48 de mundo. */
  tijera(): HTMLCanvasElement
  liberar(): void
}

function brilloSuave(color: string, tam = 64): HTMLCanvasElement {
  const c = crearLienzo(tam, tam)
  const g = contexto(c)
  const r = tam / 2
  const d = g.createRadialGradient(r, r, 0, r, r, r)
  d.addColorStop(0, rgba(aclarar(color, 0.7), 1))
  d.addColorStop(0.18, rgba(color, 0.75))
  d.addColorStop(0.5, rgba(color, 0.22))
  d.addColorStop(1, rgba(color, 0))
  g.fillStyle = d
  g.fillRect(0, 0, tam, tam)
  return c
}

function sombra(): HTMLCanvasElement {
  const c = crearLienzo(64, 64)
  const g = contexto(c)
  const d = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  d.addColorStop(0, 'rgba(0,0,0,0.85)')
  d.addColorStop(0.45, 'rgba(0,0,0,0.5)')
  d.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = d
  g.fillRect(0, 0, 64, 64)
  return c
}

function nube(color: string, centro: number): HTMLCanvasElement {
  const c = crearLienzo(64, 64)
  const g = contexto(c)
  const d = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  d.addColorStop(0, rgba(color, centro))
  d.addColorStop(0.55, rgba(color, centro * 0.45))
  d.addColorStop(1, rgba(color, 0))
  g.fillStyle = d
  g.fillRect(0, 0, 64, 64)
  return c
}

function estrella4(color: string): HTMLCanvasElement {
  const T = 64
  const c = crearLienzo(T, T)
  const g = contexto(c)
  g.translate(T / 2, T / 2)
  const halo = g.createRadialGradient(0, 0, 0, 0, 0, T * 0.32)
  halo.addColorStop(0, rgba(color, 0.9))
  halo.addColorStop(1, rgba(color, 0))
  g.fillStyle = halo
  g.fillRect(-T / 2, -T / 2, T, T)
  g.fillStyle = rgba(aclarar(color, 0.5), 1)
  g.beginPath()
  const L = T * 0.47
  const a = T * 0.06
  g.moveTo(0, -L)
  g.quadraticCurveTo(a, -a, L, 0)
  g.quadraticCurveTo(a, a, 0, L)
  g.quadraticCurveTo(-a, a, -L, 0)
  g.quadraticCurveTo(-a, -a, 0, -L)
  g.fill()
  g.fillStyle = '#FFFFFF'
  g.beginPath()
  g.arc(0, 0, T * 0.07, 0, TAU)
  g.fill()
  return c
}

function estrella5(relleno: string, borde: string): HTMLCanvasElement {
  const T = 48
  const c = crearLienzo(T, T)
  const g = contexto(c)
  g.translate(T / 2, T / 2 + 1)
  g.beginPath()
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? T * 0.44 : T * 0.19
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r)
    else g.lineTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  g.closePath()
  g.lineJoin = 'round'
  g.lineWidth = 4
  g.strokeStyle = borde
  g.stroke()
  g.fillStyle = relleno
  g.fill()
  g.fillStyle = 'rgba(255,255,255,0.75)'
  g.beginPath()
  g.arc(-T * 0.08, -T * 0.1, T * 0.07, 0, TAU)
  g.fill()
  return c
}

function estallido(c1: string, c2: string): HTMLCanvasElement {
  const T = 128
  const c = crearLienzo(T, T)
  const g = contexto(c)
  const r = T / 2
  g.translate(r, r)
  const halo = g.createRadialGradient(0, 0, 0, 0, 0, r)
  halo.addColorStop(0, rgba(c1, 0.85))
  halo.addColorStop(0.3, rgba(c2, 0.4))
  halo.addColorStop(1, rgba(c2, 0))
  g.fillStyle = halo
  g.beginPath()
  g.arc(0, 0, r, 0, TAU)
  g.fill()
  const n = 14
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + (i % 2 ? 0.1 : 0)
    const largo = r * (i % 2 ? 0.6 : 0.97)
    const ancho = i % 2 ? 0.09 : 0.15
    const rayo = g.createRadialGradient(0, 0, 0, 0, 0, largo)
    rayo.addColorStop(0, '#FFFFFF')
    rayo.addColorStop(0.45, rgba(c1, 0.95))
    rayo.addColorStop(1, rgba(c2, 0))
    g.fillStyle = rayo
    g.beginPath()
    g.moveTo(Math.cos(a - ancho) * r * 0.12, Math.sin(a - ancho) * r * 0.12)
    g.lineTo(Math.cos(a) * largo, Math.sin(a) * largo)
    g.lineTo(Math.cos(a + ancho) * r * 0.12, Math.sin(a + ancho) * r * 0.12)
    g.closePath()
    g.fill()
  }
  const nucleo = g.createRadialGradient(0, 0, 0, 0, 0, r * 0.32)
  nucleo.addColorStop(0, '#FFFFFF')
  nucleo.addColorStop(0.55, 'rgba(255,255,255,0.9)')
  nucleo.addColorStop(1, rgba(c1, 0))
  g.fillStyle = nucleo
  g.beginPath()
  g.arc(0, 0, r * 0.32, 0, TAU)
  g.fill()
  return c
}

/** Un mechón de pelo cortado: una medialuna fina y curva con un brillo. 28×12 (x2). */
function mechon(forma: number, color: string): HTMLCanvasElement {
  const c = crearLienzo(56, 24)
  const g = contexto(c)
  g.scale(2, 2)
  g.beginPath()
  if (forma === 0) {
    g.moveTo(2, 8)
    g.quadraticCurveTo(13, -1, 26, 5)
    g.quadraticCurveTo(13, 3.6, 2, 8)
  } else if (forma === 1) {
    g.moveTo(2, 6)
    g.bezierCurveTo(8, -0.5, 16, 12.5, 26, 5)
    g.bezierCurveTo(16, 9.2, 8, 3, 2, 6)
  } else {
    g.moveTo(3, 10)
    g.quadraticCurveTo(5, 1, 15, 2)
    g.quadraticCurveTo(24, 3, 25, 10)
    g.quadraticCurveTo(21, 5, 15, 4.6)
    g.quadraticCurveTo(8, 4.4, 3, 10)
  }
  g.closePath()
  g.fillStyle = color
  g.fill()
  g.lineWidth = 0.7
  g.strokeStyle = rgba(aclarar(color, 0.45), 0.7)
  g.stroke()
  return c
}

function escudo(color: string): HTMLCanvasElement {
  const W = 100
  const H = 240
  const c = crearLienzo(W, H)
  const g = contexto(c)
  // una elipse grande con el centro adentro del cuerpo: asoma sólo su frente
  const cx = -70
  const cy = H / 2
  const rx = 160
  const ry = H / 2 - 6
  g.save()
  g.beginPath()
  g.ellipse(cx, cy, rx, ry, 0, -Math.PI / 2, Math.PI / 2)
  g.closePath()
  g.clip()
  const d = g.createRadialGradient(cx, cy, rx * 0.5, cx, cy, rx)
  d.addColorStop(0, rgba(color, 0))
  d.addColorStop(0.62, rgba(color, 0.06))
  d.addColorStop(0.9, rgba(color, 0.4))
  d.addColorStop(1, rgba(color, 0.78))
  g.fillStyle = d
  g.fillRect(0, 0, W, H)
  // trama hexagonal muy sutil
  g.strokeStyle = rgba(aclarar(color, 0.5), 0.16)
  g.lineWidth = 1
  for (let y = 8; y < H; y += 16) {
    for (let x = (y / 16) % 2 ? 8 : 0; x < W; x += 16) {
      g.beginPath()
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * TAU
        const px = x + Math.cos(a) * 7
        const py = y + Math.sin(a) * 7
        if (k === 0) g.moveTo(px, py)
        else g.lineTo(px, py)
      }
      g.closePath()
      g.stroke()
    }
  }
  g.restore()
  g.lineWidth = 3.5
  g.strokeStyle = rgba(aclarar(color, 0.25), 0.95)
  g.beginPath()
  g.ellipse(cx, cy, rx - 2, ry - 2, 0, -1.25, 1.25)
  g.stroke()
  g.lineWidth = 1.6
  g.strokeStyle = 'rgba(255,255,255,0.85)'
  g.beginPath()
  g.ellipse(cx, cy, rx - 8, ry - 10, 0, -1.05, -0.3)
  g.stroke()
  return c
}

function cromo(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): CanvasGradient {
  const d = g.createLinearGradient(x0, y0, x1, y1)
  d.addColorStop(0, '#F4F7FA')
  d.addColorStop(0.35, '#B9C2CC')
  d.addColorStop(0.55, '#6E7884')
  d.addColorStop(0.8, '#C9D0D8')
  d.addColorStop(1, '#5A626C')
  return d
}

function cuero(g: CanvasRenderingContext2D, y0: number, y1: number): CanvasGradient {
  const d = g.createLinearGradient(0, y0, 0, y1)
  d.addColorStop(0, '#4A4A52')
  d.addColorStop(0.18, '#232328')
  d.addColorStop(1, '#0A0A0C')
  return d
}

function rectRedondo(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2)
  g.beginPath()
  g.moveTo(x + rr, y)
  g.arcTo(x + w, y, x + w, y + h, rr)
  g.arcTo(x + w, y + h, x, y + h, rr)
  g.arcTo(x, y + h, x, y, rr)
  g.arcTo(x, y, x + w, y, rr)
  g.closePath()
}

/** Sillón de barbero de perfil (respaldo a la izquierda, apoyapiés a la derecha). */
function sillon(): HTMLCanvasElement {
  const T = 120
  const c = crearLienzo(T * RES, T * RES)
  const g = contexto(c)
  g.scale(RES, RES)
  g.lineJoin = 'round'
  const borde = '#050506'
  // pie hidráulico
  g.fillStyle = cromo(g, 30, 104, 90, 118)
  g.beginPath()
  g.ellipse(60, 111, 31, 6.5, 0, 0, TAU)
  g.fill()
  g.strokeStyle = borde
  g.lineWidth = 1.4
  g.stroke()
  g.fillStyle = cromo(g, 52, 0, 68, 0)
  g.fillRect(53, 80, 14, 30)
  g.strokeRect(53, 80, 14, 30)
  // base del asiento
  g.fillStyle = '#1B1C20'
  rectRedondo(g, 30, 74, 62, 8, 3)
  g.fill()
  g.stroke()
  // apoyapiés cromado
  g.strokeStyle = cromo(g, 86, 76, 108, 100)
  g.lineWidth = 4
  g.beginPath()
  g.moveTo(86, 78)
  g.lineTo(101, 97)
  g.stroke()
  g.fillStyle = cromo(g, 92, 95, 114, 101)
  rectRedondo(g, 92, 95, 22, 5, 2)
  g.fill()
  g.strokeStyle = borde
  g.lineWidth = 1.2
  g.stroke()
  // respaldo inclinado y cabezal
  g.save()
  g.translate(34, 66)
  g.rotate(-0.16)
  g.fillStyle = cuero(g, -56, 0)
  rectRedondo(g, -15, -56, 22, 58, 8)
  g.fill()
  g.strokeStyle = borde
  g.lineWidth = 1.6
  g.stroke()
  g.strokeStyle = 'rgba(255,255,255,0.18)'
  g.lineWidth = 1
  g.beginPath()
  g.moveTo(-10, -50)
  g.lineTo(-10, -6)
  g.stroke()
  g.fillStyle = cromo(g, -6, -66, 2, -56)
  g.fillRect(-6, -66, 6, 10)
  g.fillStyle = cuero(g, -80, -64)
  rectRedondo(g, -13, -80, 20, 15, 6)
  g.fill()
  g.strokeStyle = borde
  g.stroke()
  g.restore()
  // asiento acolchado
  g.fillStyle = cuero(g, 56, 76)
  rectRedondo(g, 24, 56, 70, 20, 8)
  g.fill()
  g.strokeStyle = borde
  g.lineWidth = 1.6
  g.stroke()
  g.strokeStyle = 'rgba(255,255,255,0.22)'
  g.lineWidth = 1.2
  g.beginPath()
  g.moveTo(30, 59.5)
  g.lineTo(88, 59.5)
  g.stroke()
  // vivo dorado de la costura
  g.strokeStyle = 'rgba(245,179,1,0.55)'
  g.setLineDash([2.5, 2])
  g.beginPath()
  g.moveTo(29, 70)
  g.lineTo(89, 70)
  g.stroke()
  g.setLineDash([])
  // apoyabrazos
  g.fillStyle = cuero(g, 44, 52)
  rectRedondo(g, 34, 44, 54, 8, 4)
  g.fill()
  g.strokeStyle = borde
  g.stroke()
  g.fillStyle = cromo(g, 78, 52, 86, 52)
  g.fillRect(79, 52, 5, 6)
  return c
}

/** Tijera abierta de perfil, con ojos negros y dorados. */
function tijera(): HTMLCanvasElement {
  const T = 48
  const c = crearLienzo(T * RES, T * RES)
  const g = contexto(c)
  g.scale(RES, RES)
  g.translate(T / 2 + 2, T / 2)
  g.lineJoin = 'round'
  const hoja = (signo: number) => {
    g.save()
    g.rotate(signo * 0.32)
    g.beginPath()
    g.moveTo(-2, -2.2)
    g.quadraticCurveTo(10, -3.4, 21, -0.4)
    g.lineTo(21, 0.6)
    g.quadraticCurveTo(10, 2.6, -2, 2.2)
    g.closePath()
    const d = g.createLinearGradient(0, -3, 0, 3)
    d.addColorStop(0, '#FFFFFF')
    d.addColorStop(0.5, '#C7D0DA')
    d.addColorStop(1, '#6F7A86')
    g.fillStyle = d
    g.fill()
    g.strokeStyle = '#2B3138'
    g.lineWidth = 0.9
    g.stroke()
    // mango y ojo
    g.strokeStyle = '#121216'
    g.lineWidth = 2.6
    g.beginPath()
    g.moveTo(-2, 0)
    g.lineTo(-9, 0)
    g.stroke()
    g.beginPath()
    g.ellipse(-14, 0, 5.2, 4, 0, 0, TAU)
    g.stroke()
    g.strokeStyle = '#F5B301'
    g.lineWidth = 0.9
    g.stroke()
    g.restore()
  }
  hoja(1)
  hoja(-1)
  g.fillStyle = '#F5B301'
  g.beginPath()
  g.arc(0, 0, 1.6, 0, TAU)
  g.fill()
  return c
}

const COLORES_PELO = ['#2B1A10', '#3E2616', '#15100C', '#5A3A22']

export function crearSprites(): Sprites {
  const brillos = new Map<string, HTMLCanvasElement>()
  const escudos = new Map<string, HTMLCanvasElement>()
  let elSillon: HTMLCanvasElement | null = null
  let laTijera: HTMLCanvasElement | null = null
  const mechones: HTMLCanvasElement[] = []
  for (let f = 0; f < 3; f++) for (const color of COLORES_PELO) mechones.push(mechon(f, color))
  const s: Sprites = {
    sombra: sombra(),
    brillo(color: string) {
      let b = brillos.get(color)
      if (!b) {
        b = brilloSuave(color)
        brillos.set(color, b)
      }
      return b
    },
    estrella: [estrella4('#FFFFFF'), estrella4('#FFC93A'), estrella4('#7EDCFF')],
    estrella5: [estrella5('#FFD43B', '#7A3E00'), estrella5('#B8F0FF', '#145C9E')],
    estallido: [
      estallido('#FFE9A0', '#FF7A1A'),
      estallido('#E3F8FF', '#3A8BFF'),
      estallido('#FFF3B0', '#F5B301'),
      estallido('#FFFBD0', '#FFC400'),
      estallido('#E9FCFF', '#38B6FF'),
    ],
    nube: [nube('#B9AE9F', 0.55), nube('#EAFBFF', 0.6), nube('#FFFFFF', 0.5)],
    mechones,
    escudo(color: string) {
      let e = escudos.get(color)
      if (!e) {
        e = escudo(color)
        escudos.set(color, e)
      }
      return e
    },
    sillon() {
      if (!elSillon) elSillon = sillon()
      return elSillon
    },
    tijera() {
      if (!laTijera) laTijera = tijera()
      return laTijera
    },
    liberar() {
      for (const b of brillos.values()) liberarLienzo(b)
      for (const e of escudos.values()) liberarLienzo(e)
      brillos.clear()
      escudos.clear()
      liberarLienzo(elSillon)
      liberarLienzo(laTijera)
      elSillon = null
      laTijera = null
      for (const lista of [s.estrella, s.estrella5, s.estallido, s.nube, s.mechones]) {
        for (const c of lista) liberarLienzo(c)
      }
      liberarLienzo(s.sombra)
    },
  }
  return s
}
