/**
 * Utilería del elenco: objetos dibujados a mano UNA vez en un lienzo y reusados en cada cuadro.
 *
 * Son el respaldo de los sprites de `atlas.efectos` (si la hoja del barbero trae su bombo, su
 * pelota o su mate, se usa ese y esto no se dibuja nunca) y los adornos que no salen de ninguna
 * hoja: la bala, las notas del cuarteto, las cruces de la curación, las moscas del pañal, las
 * llamas, la espiral del mareo, las burbujas y las rocas del sismo.
 *
 * Todos están centrados en su lienzo cuadrado, «miran» a la derecha (el que los dibuja espeja) y
 * se crean recién la primera vez que se piden (el módulo no toca `document` al importarse).
 */
import { contexto, crearLienzo, liberarLienzo } from './lienzo'
import { ruido, TAU } from './util'

/** px de lienzo por unidad de mundo (nítidos hasta ~2,5× de zoom, como el sillón). */
const RES = 2.6

export type NombreUtileria =
  | 'bombo'
  | 'bala'
  | 'botella'
  | 'vaso'
  | 'gorro'
  | 'pelota'
  | 'panal'
  | 'mate'
  | 'guante'
  | 'graffiti'
  | 'roca0'
  | 'roca1'
  | 'roca2'
  | 'nota'
  | 'nota2'
  | 'cruz'
  | 'mosca'
  | 'llama'
  | 'espiral'
  | 'burbuja'
  // Quinta tanda (14/nov). Respaldos de los sprites de las hojas (si el atlas no los trae)…
  | 'naipe'
  | 'secador'
  | 'pelotita'
  | 'pua'
  | 'monopatin'
  | 'despido'
  | 'laptop'
  // …y adornos que no salen de ninguna hoja.
  | 'naipe_violeta'
  | 'digito0'
  | 'digito1'
  | 'digito0_rojo'
  | 'digito1_rojo'
  | 'roca_cian0'
  | 'roca_cian1'
  | 'roca_cian2'
  | 'lagrima'
  | 'exclamacion'
  | 'nube_spray0'
  | 'nube_spray1'
  | 'hipnosis'

/** Lado del lienzo de cada objeto, en unidades de mundo. */
export const TAM_UTILERIA: Readonly<Record<NombreUtileria, number>> = {
  bombo: 72,
  bala: 26,
  botella: 58,
  vaso: 46,
  gorro: 74,
  pelota: 40,
  panal: 56,
  mate: 48,
  guante: 62,
  graffiti: 120,
  roca0: 28,
  roca1: 28,
  roca2: 28,
  nota: 28,
  nota2: 30,
  cruz: 24,
  mosca: 16,
  llama: 48,
  espiral: 40,
  burbuja: 16,
  naipe: 36,
  secador: 48,
  pelotita: 24,
  pua: 40,
  monopatin: 112,
  despido: 60,
  laptop: 40,
  naipe_violeta: 36,
  digito0: 16,
  digito1: 16,
  digito0_rojo: 16,
  digito1_rojo: 16,
  roca_cian0: 28,
  roca_cian1: 28,
  roca_cian2: 28,
  lagrima: 12,
  exclamacion: 40,
  nube_spray0: 120,
  nube_spray1: 120,
  hipnosis: 56,
}

export interface Utileria {
  /** El lienzo del objeto (se dibuja la primera vez que se pide). */
  de(nombre: NombreUtileria): HTMLCanvasElement
  /**
   * Un lienzo propio que no es cuadrado (la franja de código del Terremoto, el código del piso):
   * `ancho` × `alto` px, pintado una vez por `pintor` (que recibe el contexto ya limpio) y guardado
   * por `clave`. Se libera con el resto.
   */
  propio(clave: string, ancho: number, alto: number, pintor: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement
  liberar(): void
}

type Pintor = (g: CanvasRenderingContext2D, T: number) => void

function lienzoDe(T: number, pintor: Pintor): HTMLCanvasElement {
  const c = crearLienzo(T * RES, T * RES)
  const g = contexto(c)
  g.scale(RES, RES)
  g.translate(T / 2, T / 2)
  g.lineJoin = 'round'
  g.lineCap = 'round'
  pintor(g, T)
  return c
}

function rectRedondo(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  g.beginPath()
  g.moveTo(x + rr, y)
  g.arcTo(x + w, y, x + w, y + h, rr)
  g.arcTo(x + w, y + h, x, y + h, rr)
  g.arcTo(x, y + h, x, y, rr)
  g.arcTo(x, y, x + w, y, rr)
  g.closePath()
}

/** Brillo especular: una medialuna blanca arriba a la izquierda. */
function brilloEsfera(g: CanvasRenderingContext2D, r: number, alfa = 0.55): void {
  g.save()
  g.globalAlpha = alfa
  g.strokeStyle = '#FFFFFF'
  g.lineWidth = r * 0.12
  g.beginPath()
  g.arc(0, 0, r * 0.72, Math.PI * 1.08, Math.PI * 1.42)
  g.stroke()
  g.globalAlpha = alfa * 0.9
  g.fillStyle = '#FFFFFF'
  g.beginPath()
  g.arc(-r * 0.38, -r * 0.5, r * 0.08, 0, TAU)
  g.fill()
  g.restore()
}

// ─── Proyectiles ─────────────────────────────────────────────────────────────

/** El bombo de la hinchada visto de frente (rueda): casco azul, aro amarillo, parche con franja. */
const bombo: Pintor = (g, T) => {
  const r = T * 0.47
  g.beginPath()
  g.arc(0, 0, r, 0, TAU)
  g.fillStyle = '#1D4ED8'
  g.fill()
  g.lineWidth = 2.4
  g.strokeStyle = '#081846'
  g.stroke()
  g.beginPath()
  g.arc(0, 0, r * 0.88, 0, TAU)
  g.lineWidth = r * 0.12
  g.strokeStyle = '#FFD100'
  g.stroke()
  // tensores sobre el aro: se ven girar
  for (let k = 0; k < 8; k++) {
    g.save()
    g.rotate((k / 8) * TAU + 0.2)
    rectRedondo(g, r * 0.78, -2.1, r * 0.2, 4.2, 1.4)
    g.fillStyle = '#E3E8EE'
    g.fill()
    g.lineWidth = 0.8
    g.strokeStyle = '#2B3138'
    g.stroke()
    g.restore()
  }
  // parche
  const d = g.createRadialGradient(-r * 0.22, -r * 0.26, r * 0.04, 0, 0, r * 0.78)
  d.addColorStop(0, '#FFFCF2')
  d.addColorStop(0.62, '#F0E4C4')
  d.addColorStop(1, '#C7B387')
  g.beginPath()
  g.arc(0, 0, r * 0.74, 0, TAU)
  g.fillStyle = d
  g.fill()
  // franja amarilla con bordes azules (la camiseta), recortada al parche
  g.save()
  g.beginPath()
  g.arc(0, 0, r * 0.74, 0, TAU)
  g.clip()
  g.fillStyle = '#1E40AF'
  g.fillRect(-r, -r * 0.26, r * 2, r * 0.52)
  g.fillStyle = '#FFD100'
  g.fillRect(-r, -r * 0.18, r * 2, r * 0.36)
  g.fillStyle = 'rgba(255,255,255,0.35)'
  g.fillRect(-r, -r * 0.18, r * 2, r * 0.06)
  // marca del mazo
  g.fillStyle = 'rgba(90,60,20,0.18)'
  g.beginPath()
  g.arc(r * 0.12, r * 0.42, r * 0.16, 0, TAU)
  g.fill()
  g.restore()
  g.beginPath()
  g.arc(0, 0, r * 0.74, 0, TAU)
  g.lineWidth = 1.3
  g.strokeStyle = 'rgba(70,50,15,0.6)'
  g.stroke()
  brilloEsfera(g, r, 0.5)
}

/** Una bala de dibujo animado: cápsula de bronce con punta de cobre, mirando a la derecha. */
const bala: Pintor = (g, T) => {
  const L = T * 0.78
  const h = T * 0.3
  const x0 = -L / 2
  g.beginPath()
  g.moveTo(x0, -h / 2)
  g.lineTo(x0 + L * 0.55, -h / 2)
  g.bezierCurveTo(x0 + L * 0.85, -h / 2, x0 + L, -h * 0.18, x0 + L, 0)
  g.bezierCurveTo(x0 + L, h * 0.18, x0 + L * 0.85, h / 2, x0 + L * 0.55, h / 2)
  g.lineTo(x0, h / 2)
  g.closePath()
  const d = g.createLinearGradient(0, -h / 2, 0, h / 2)
  d.addColorStop(0, '#FFE7A8')
  d.addColorStop(0.45, '#E2A63B')
  d.addColorStop(1, '#8A5A12')
  g.fillStyle = d
  g.fill()
  // punta de cobre
  g.save()
  g.clip()
  const p = g.createLinearGradient(0, -h / 2, 0, h / 2)
  p.addColorStop(0, '#FFC9A3')
  p.addColorStop(0.5, '#D16A2C')
  p.addColorStop(1, '#7A2E0C')
  g.fillStyle = p
  g.fillRect(x0 + L * 0.55, -h, L, h * 2)
  g.restore()
  g.lineWidth = 1
  g.strokeStyle = '#3A2205'
  g.stroke()
  g.fillStyle = 'rgba(255,255,255,0.7)'
  g.fillRect(x0 + L * 0.08, -h * 0.32, L * 0.5, h * 0.14)
}

/** Botella de barra: vidrio ámbar, etiqueta crema con franja turquesa, tapa dorada. */
const botella: Pintor = (g, T) => {
  const w = T * 0.3
  const yCuerpo = -T * 0.06
  g.beginPath()
  g.moveTo(-T * 0.055, -T * 0.4)
  g.lineTo(T * 0.055, -T * 0.4)
  g.lineTo(T * 0.06, -T * 0.2)
  g.bezierCurveTo(T * 0.07, -T * 0.12, w / 2, -T * 0.13, w / 2, yCuerpo)
  g.lineTo(w / 2, T * 0.38)
  g.quadraticCurveTo(w / 2, T * 0.44, w / 2 - 4, T * 0.44)
  g.lineTo(-w / 2 + 4, T * 0.44)
  g.quadraticCurveTo(-w / 2, T * 0.44, -w / 2, T * 0.38)
  g.lineTo(-w / 2, yCuerpo)
  g.bezierCurveTo(-w / 2, -T * 0.13, -T * 0.07, -T * 0.12, -T * 0.06, -T * 0.2)
  g.closePath()
  const vidrio = g.createLinearGradient(-w / 2, 0, w / 2, 0)
  vidrio.addColorStop(0, '#F6B860')
  vidrio.addColorStop(0.35, '#D98A2B')
  vidrio.addColorStop(1, '#7A420A')
  g.fillStyle = vidrio
  g.fill()
  g.lineWidth = 1.3
  g.strokeStyle = '#3A2205'
  g.stroke()
  // etiqueta
  rectRedondo(g, -w / 2 + 0.5, T * 0.07, w - 1, T * 0.2, 1.5)
  g.fillStyle = '#F6EDD3'
  g.fill()
  g.fillStyle = '#14B8A6'
  g.fillRect(-w / 2 + 0.5, T * 0.13, w - 1, T * 0.06)
  g.fillStyle = '#F59E0B'
  g.fillRect(-w / 2 + 0.5, T * 0.2, w - 1, T * 0.025)
  // tapa
  rectRedondo(g, -T * 0.07, -T * 0.46, T * 0.14, T * 0.08, 1.5)
  g.fillStyle = '#F2C230'
  g.fill()
  g.lineWidth = 1
  g.strokeStyle = '#6B4A00'
  g.stroke()
  // reflejo del vidrio
  g.globalAlpha = 0.65
  g.fillStyle = '#FFFFFF'
  rectRedondo(g, -w / 2 + 2.2, -T * 0.04, 2.2, T * 0.36, 1.1)
  g.fill()
  g.fillRect(-T * 0.035, -T * 0.37, 1.4, T * 0.14)
  g.globalAlpha = 1
}

/** Vaso con un trago violeta, hielo, sorbete y una rodaja de lima. */
const vaso: Pintor = (g, T) => {
  const arriba = -T * 0.3
  const abajo = T * 0.32
  const ra = T * 0.27
  const rb = T * 0.2
  const contorno = () => {
    g.beginPath()
    g.moveTo(-ra, arriba)
    g.lineTo(ra, arriba)
    g.lineTo(rb, abajo)
    g.lineTo(-rb, abajo)
    g.closePath()
  }
  // sorbete (atrás del vidrio)
  g.strokeStyle = '#F59E0B'
  g.lineWidth = T * 0.06
  g.beginPath()
  g.moveTo(-T * 0.02, T * 0.1)
  g.lineTo(T * 0.2, -T * 0.46)
  g.stroke()
  g.strokeStyle = '#FFFFFF'
  g.lineWidth = T * 0.02
  g.setLineDash([2.2, 2.6])
  g.stroke()
  g.setLineDash([])
  // líquido
  g.save()
  contorno()
  g.clip()
  const liq = g.createLinearGradient(0, -T * 0.12, 0, abajo)
  liq.addColorStop(0, '#E9B8FF')
  liq.addColorStop(0.25, '#B76BFF')
  liq.addColorStop(1, '#6D1FC2')
  g.fillStyle = liq
  g.fillRect(-ra, -T * 0.1, ra * 2, abajo + T * 0.2)
  g.fillStyle = 'rgba(255,255,255,0.6)'
  g.fillRect(-ra, -T * 0.11, ra * 2, 1.6)
  // hielo
  g.fillStyle = 'rgba(235,250,255,0.85)'
  g.strokeStyle = 'rgba(150,200,240,0.9)'
  g.lineWidth = 0.8
  for (const [hx, hy, r] of [
    [-0.08, -0.08, 0.3],
    [0.07, -0.02, -0.25],
  ] as const) {
    g.save()
    g.translate(hx * T, hy * T)
    g.rotate(r)
    rectRedondo(g, -T * 0.07, -T * 0.07, T * 0.14, T * 0.14, 1.5)
    g.fill()
    g.stroke()
    g.restore()
  }
  g.restore()
  // vidrio
  contorno()
  g.fillStyle = 'rgba(210,235,255,0.16)'
  g.fill()
  g.lineWidth = 1.6
  g.strokeStyle = 'rgba(225,245,255,0.95)'
  g.stroke()
  g.strokeStyle = 'rgba(255,255,255,0.7)'
  g.lineWidth = 1.4
  g.beginPath()
  g.moveTo(-ra + 3.5, arriba + 3)
  g.lineTo(-rb + 2.6, abajo - 4)
  g.stroke()
  // lima en el borde
  g.save()
  g.translate(ra - 1, arriba + 1)
  g.rotate(0.5)
  g.beginPath()
  g.arc(0, 0, T * 0.12, Math.PI, TAU)
  g.closePath()
  g.fillStyle = '#A3E635'
  g.fill()
  g.lineWidth = 1.2
  g.strokeStyle = '#3F6212'
  g.stroke()
  g.strokeStyle = 'rgba(255,255,255,0.75)'
  g.lineWidth = 0.7
  for (let k = 1; k < 4; k++) {
    const a = Math.PI + (k / 4) * Math.PI
    g.beginPath()
    g.moveTo(0, 0)
    g.lineTo(Math.cos(a) * T * 0.1, Math.sin(a) * T * 0.1)
    g.stroke()
  }
  g.restore()
}

/** El gorro chino (cono de paja) un poco desde arriba, con la cinta roja. */
const gorro: Pintor = (g, T) => {
  const R = T * 0.47
  const yb = T * 0.1
  const ry = T * 0.12
  const ap = -T * 0.3
  g.beginPath()
  g.moveTo(0, ap)
  g.lineTo(R, yb)
  g.ellipse(0, yb, R, ry, 0, 0, Math.PI)
  g.closePath()
  const paja = g.createLinearGradient(-R, ap, R, yb + ry)
  paja.addColorStop(0, '#FBE7A1')
  paja.addColorStop(0.45, '#E2B54A')
  paja.addColorStop(1, '#8C6516')
  g.fillStyle = paja
  g.fill()
  // tejido
  g.save()
  g.clip()
  g.strokeStyle = 'rgba(100,62,8,0.45)'
  g.lineWidth = 0.8
  for (let k = 0; k <= 14; k++) {
    const a = (k / 14) * Math.PI
    g.beginPath()
    g.moveTo(0, ap)
    g.lineTo(Math.cos(a) * R, yb + Math.sin(a) * ry)
    g.stroke()
  }
  for (let k = 1; k <= 3; k++) {
    const f = k / 4
    g.beginPath()
    g.ellipse(0, ap + (yb - ap) * f, R * f, ry * f, 0, 0, Math.PI)
    g.stroke()
  }
  g.restore()
  // cinta roja
  g.beginPath()
  g.ellipse(0, ap + (yb - ap) * 0.62, R * 0.62, ry * 0.62, 0, 0.05, Math.PI - 0.05)
  g.lineWidth = T * 0.05
  g.strokeStyle = '#D62828'
  g.stroke()
  // ala y contorno
  g.beginPath()
  g.moveTo(0, ap)
  g.lineTo(R, yb)
  g.ellipse(0, yb, R, ry, 0, 0, Math.PI)
  g.closePath()
  g.lineWidth = 1.5
  g.strokeStyle = '#4A3006'
  g.stroke()
  g.strokeStyle = 'rgba(255,248,210,0.8)'
  g.lineWidth = 1.2
  g.beginPath()
  g.moveTo(-1, ap + 2)
  g.lineTo(-R * 0.62, yb - 1)
  g.stroke()
  g.fillStyle = '#7A1010'
  g.beginPath()
  g.arc(0, ap + 0.5, 1.8, 0, TAU)
  g.fill()
}

/** Pelota de fútbol: hexágonos blancos con el pentágono negro al medio. */
const pelota: Pintor = (g, T) => {
  const r = T * 0.46
  const base = g.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r)
  base.addColorStop(0, '#FFFFFF')
  base.addColorStop(0.7, '#F1F4F8')
  base.addColorStop(1, '#BAC4D0')
  g.beginPath()
  g.arc(0, 0, r, 0, TAU)
  g.fillStyle = base
  g.fill()
  const pentagono = (cx: number, cy: number, rr: number, giro: number) => {
    g.beginPath()
    for (let k = 0; k < 5; k++) {
      const a = giro + (k / 5) * TAU - Math.PI / 2
      if (k === 0) g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
      else g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
    }
    g.closePath()
  }
  g.save()
  g.beginPath()
  g.arc(0, 0, r, 0, TAU)
  g.clip()
  g.fillStyle = '#16181C'
  g.strokeStyle = '#3B4048'
  g.lineWidth = 0.9
  pentagono(0, 0, r * 0.3, 0)
  g.fill()
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * TAU - Math.PI / 2
    const cx = Math.cos(a) * r * 0.95
    const cy = Math.sin(a) * r * 0.95
    // costuras del pentágono del medio hacia los de afuera
    g.beginPath()
    g.moveTo(Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3)
    g.lineTo(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62)
    g.stroke()
    pentagono(cx, cy, r * 0.3, Math.PI)
    g.fill()
  }
  g.restore()
  g.beginPath()
  g.arc(0, 0, r, 0, TAU)
  g.lineWidth = 1.4
  g.strokeStyle = '#1B1E24'
  g.stroke()
  brilloEsfera(g, r, 0.6)
}

/** Un pañal blanco con elásticos celestes y estrellitas. */
const panal: Pintor = (g, T) => {
  const forma = () => {
    g.beginPath()
    g.moveTo(-T * 0.4, -T * 0.24)
    g.lineTo(T * 0.4, -T * 0.24)
    g.bezierCurveTo(T * 0.4, -T * 0.02, T * 0.2, T * 0.04, T * 0.17, T * 0.24)
    g.quadraticCurveTo(T * 0.15, T * 0.34, 0, T * 0.34)
    g.quadraticCurveTo(-T * 0.15, T * 0.34, -T * 0.17, T * 0.24)
    g.bezierCurveTo(-T * 0.2, T * 0.04, -T * 0.4, -T * 0.02, -T * 0.4, -T * 0.24)
    g.closePath()
  }
  forma()
  const d = g.createLinearGradient(0, -T * 0.24, 0, T * 0.34)
  d.addColorStop(0, '#FFFFFF')
  d.addColorStop(1, '#DCE7F3')
  g.fillStyle = d
  g.fill()
  g.save()
  g.clip()
  g.fillStyle = '#A5D8FF'
  g.fillRect(-T * 0.45, -T * 0.25, T * 0.9, T * 0.09)
  g.fillStyle = 'rgba(255,255,255,0.7)'
  g.fillRect(-T * 0.45, -T * 0.23, T * 0.9, T * 0.02)
  // estrellitas
  g.fillStyle = '#8CCBF5'
  for (const [sx, sy] of [
    [-0.18, -0.02],
    [0.12, 0.02],
    [-0.02, 0.17],
    [0.22, -0.1],
  ] as const) {
    g.beginPath()
    for (let k = 0; k < 10; k++) {
      const rr = k % 2 === 0 ? T * 0.045 : T * 0.02
      const a = -Math.PI / 2 + (k * Math.PI) / 5
      const px = sx * T + Math.cos(a) * rr
      const py = sy * T + Math.sin(a) * rr
      if (k === 0) g.moveTo(px, py)
      else g.lineTo(px, py)
    }
    g.closePath()
    g.fill()
  }
  g.restore()
  // pestañas
  for (const s of [-1, 1]) {
    rectRedondo(g, s > 0 ? T * 0.3 : -T * 0.44, -T * 0.25, T * 0.14, T * 0.09, 2)
    g.fillStyle = '#7CC4FA'
    g.fill()
    g.lineWidth = 0.9
    g.strokeStyle = '#3A86C6'
    g.stroke()
  }
  forma()
  g.lineWidth = 1.4
  g.strokeStyle = '#8FA6BE'
  g.stroke()
}

/** El mate: calabaza con virola, yerba verde y la bombilla plateada. */
const mate: Pintor = (g, T) => {
  // bombilla (atrás de la yerba)
  g.strokeStyle = '#C9D2DC'
  g.lineWidth = T * 0.055
  g.beginPath()
  g.moveTo(-T * 0.02, -T * 0.08)
  g.lineTo(T * 0.22, -T * 0.44)
  g.stroke()
  g.strokeStyle = '#FFFFFF'
  g.lineWidth = T * 0.015
  g.beginPath()
  g.moveTo(T * 0.0, -T * 0.12)
  g.lineTo(T * 0.2, -T * 0.42)
  g.stroke()
  g.fillStyle = '#E6B422'
  g.beginPath()
  g.ellipse(T * 0.14, -T * 0.32, T * 0.04, T * 0.02, -0.98, 0, TAU)
  g.fill()
  // calabaza
  g.beginPath()
  g.moveTo(-T * 0.18, -T * 0.2)
  g.bezierCurveTo(-T * 0.2, -T * 0.08, -T * 0.36, -T * 0.02, -T * 0.34, T * 0.16)
  g.bezierCurveTo(-T * 0.32, T * 0.4, T * 0.32, T * 0.4, T * 0.34, T * 0.16)
  g.bezierCurveTo(T * 0.36, -T * 0.02, T * 0.2, -T * 0.08, T * 0.18, -T * 0.2)
  g.closePath()
  const cuero = g.createRadialGradient(-T * 0.1, T * 0.02, T * 0.04, 0, T * 0.1, T * 0.38)
  cuero.addColorStop(0, '#B97A3E')
  cuero.addColorStop(0.6, '#7A4A20')
  cuero.addColorStop(1, '#43260C')
  g.fillStyle = cuero
  g.fill()
  g.lineWidth = 1.4
  g.strokeStyle = '#2A1606'
  g.stroke()
  g.strokeStyle = 'rgba(255,225,180,0.45)'
  g.lineWidth = 1.6
  g.beginPath()
  g.arc(0, T * 0.12, T * 0.24, Math.PI * 1.05, Math.PI * 1.35)
  g.stroke()
  // yerba
  g.beginPath()
  g.ellipse(0, -T * 0.21, T * 0.18, T * 0.065, 0, 0, TAU)
  g.fillStyle = '#6E9F2A'
  g.fill()
  g.fillStyle = '#4C7419'
  for (let k = 0; k < 7; k++) {
    g.beginPath()
    g.arc((ruido(k + 3) - 0.5) * T * 0.28, -T * 0.21 + (ruido(k + 41) - 0.5) * T * 0.07, 0.9, 0, TAU)
    g.fill()
  }
  // virola de alpaca
  g.beginPath()
  g.ellipse(0, -T * 0.2, T * 0.19, T * 0.055, 0, 0, Math.PI)
  g.lineWidth = T * 0.05
  g.strokeStyle = '#D7DEE6'
  g.stroke()
  g.lineWidth = 0.8
  g.strokeStyle = '#5A626C'
  g.beginPath()
  g.ellipse(0, -T * 0.2, T * 0.21, T * 0.075, 0, 0.1, Math.PI - 0.1)
  g.stroke()
}

/** Guante de box rojo de perfil, pegando hacia la derecha. */
const guante: Pintor = (g, T) => {
  // puño acolchado
  g.beginPath()
  g.moveTo(-T * 0.2, -T * 0.24)
  g.bezierCurveTo(-T * 0.02, -T * 0.42, T * 0.38, -T * 0.4, T * 0.43, -T * 0.04)
  g.bezierCurveTo(T * 0.47, T * 0.28, T * 0.12, T * 0.38, -T * 0.18, T * 0.26)
  g.closePath()
  const rojo = g.createLinearGradient(0, -T * 0.4, 0, T * 0.36)
  rojo.addColorStop(0, '#FF7A7A')
  rojo.addColorStop(0.35, '#E11D2A')
  rojo.addColorStop(1, '#7E0A12')
  g.fillStyle = rojo
  g.fill()
  g.lineWidth = 1.6
  g.strokeStyle = '#3D0307'
  g.stroke()
  // pulgar
  g.beginPath()
  g.moveTo(T * 0.0, T * 0.02)
  g.bezierCurveTo(T * 0.1, -T * 0.08, T * 0.3, -T * 0.06, T * 0.3, T * 0.08)
  g.bezierCurveTo(T * 0.28, T * 0.18, T * 0.1, T * 0.18, T * 0.02, T * 0.12)
  g.fillStyle = '#C8121F'
  g.fill()
  g.lineWidth = 1.1
  g.strokeStyle = '#5A040B'
  g.stroke()
  // puño blanco con la tira
  rectRedondo(g, -T * 0.43, -T * 0.22, T * 0.26, T * 0.46, 4)
  const puno = g.createLinearGradient(0, -T * 0.22, 0, T * 0.24)
  puno.addColorStop(0, '#FFFFFF')
  puno.addColorStop(1, '#C9CFD8')
  g.fillStyle = puno
  g.fill()
  g.lineWidth = 1.3
  g.strokeStyle = '#4A505A'
  g.stroke()
  g.fillStyle = '#FF4D4D'
  g.fillRect(-T * 0.36, -T * 0.22, T * 0.07, T * 0.46)
  // brillo
  g.strokeStyle = 'rgba(255,255,255,0.75)'
  g.lineWidth = 2.2
  g.beginPath()
  g.moveTo(-T * 0.06, -T * 0.28)
  g.quadraticCurveTo(T * 0.18, -T * 0.36, T * 0.32, -T * 0.22)
  g.stroke()
}

/** El graffiti: una explosión de aerosol violeta con borde turquesa, chorreado y un tag. */
const graffiti: Pintor = (g, T) => {
  const puntas = 13
  const forma = (escala: number) => {
    g.beginPath()
    for (let k = 0; k <= puntas * 2; k++) {
      const a = (k / (puntas * 2)) * TAU
      const larga = k % 2 === 0
      const r = (larga ? 0.44 + 0.06 * ruido(k * 7 + 1) : 0.27 + 0.05 * ruido(k * 13 + 5)) * T * escala
      const px = Math.cos(a) * r
      const py = Math.sin(a) * r * 0.8
      if (k === 0) g.moveTo(px, py)
      else g.lineTo(px, py)
    }
    g.closePath()
  }
  // contorno turquesa ancho (el «aura» del aerosol)
  forma(1)
  g.lineWidth = T * 0.06
  g.strokeStyle = '#22D3EE'
  g.stroke()
  g.fillStyle = '#7C1FD6'
  g.fill()
  forma(0.8)
  const d = g.createRadialGradient(0, 0, T * 0.02, 0, 0, T * 0.36)
  d.addColorStop(0, '#FFE3FF')
  d.addColorStop(0.35, '#F472B6')
  d.addColorStop(1, '#A855F7')
  g.fillStyle = d
  g.fill()
  // chorreado
  g.fillStyle = '#7C1FD6'
  for (let k = 0; k < 5; k++) {
    const x = (-0.24 + k * 0.12 + (ruido(k + 77) - 0.5) * 0.05) * T
    const largo = (0.08 + 0.12 * ruido(k + 91)) * T
    const y0 = T * 0.24
    rectRedondo(g, x - T * 0.018, y0 - 2, T * 0.036, largo, T * 0.018)
    g.fill()
    g.beginPath()
    g.arc(x, y0 + largo - 1, T * 0.026, 0, TAU)
    g.fill()
  }
  // el tag: un trazo blanco con borde negro
  g.lineWidth = T * 0.05
  g.strokeStyle = '#111827'
  const tag = () => {
    g.beginPath()
    g.moveTo(-T * 0.2, T * 0.06)
    g.bezierCurveTo(-T * 0.14, -T * 0.16, -T * 0.04, T * 0.14, T * 0.02, -T * 0.06)
    g.bezierCurveTo(T * 0.06, -T * 0.2, T * 0.14, T * 0.1, T * 0.22, -T * 0.08)
  }
  tag()
  g.stroke()
  g.lineWidth = T * 0.024
  g.strokeStyle = '#FFFFFF'
  tag()
  g.stroke()
  // brillitos de pintura
  g.fillStyle = '#FDE047'
  for (let k = 0; k < 6; k++) {
    const a = ruido(k + 5) * TAU
    const r = (0.36 + 0.1 * ruido(k + 17)) * T
    g.beginPath()
    g.arc(Math.cos(a) * r, Math.sin(a) * r * 0.8, T * 0.016, 0, TAU)
    g.fill()
  }
}

/** Piedras del sismo: polígonos con caras iluminadas (tres formas). */
function roca(semilla: number): Pintor {
  return (g, T) => {
    const n = 7
    const pts: [number, number][] = []
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + ruido(semilla * 31 + k) * 0.5
      const r = T * (0.3 + 0.14 * ruido(semilla * 17 + k * 3))
      pts.push([Math.cos(a) * r, Math.sin(a) * r * 0.86])
    }
    g.beginPath()
    pts.forEach(([x, y], k) => (k === 0 ? g.moveTo(x, y) : g.lineTo(x, y)))
    g.closePath()
    g.fillStyle = '#857B6E'
    g.fill()
    // cara de arriba iluminada y cara de abajo en sombra
    g.save()
    g.clip()
    g.fillStyle = '#B4A994'
    g.beginPath()
    g.moveTo(-T, -T)
    g.lineTo(T, -T)
    g.lineTo(T * 0.5, -T * 0.05)
    g.lineTo(-T * 0.2, T * 0.06)
    g.closePath()
    g.fill()
    g.fillStyle = '#544C42'
    g.beginPath()
    g.moveTo(T, T)
    g.lineTo(-T, T)
    g.lineTo(-T * 0.1, T * 0.16)
    g.lineTo(T * 0.6, T * 0.04)
    g.closePath()
    g.fill()
    g.restore()
    g.beginPath()
    pts.forEach(([x, y], k) => (k === 0 ? g.moveTo(x, y) : g.lineTo(x, y)))
    g.closePath()
    g.lineWidth = 1.3
    g.strokeStyle = '#25211C'
    g.stroke()
  }
}

// ─── Adornos ─────────────────────────────────────────────────────────────────

/** Corchea (una o dos unidas), blanca con borde magenta: notas del cuarteto y del grito. */
function nota(doble: boolean): Pintor {
  return (g, T) => {
    const cabeza = (cx: number, cy: number) => {
      g.beginPath()
      g.ellipse(cx, cy, T * 0.15, T * 0.105, -0.45, 0, TAU)
    }
    const dibujar = () => {
      if (doble) {
        cabeza(-T * 0.2, T * 0.24)
        cabeza(T * 0.18, T * 0.16)
        g.rect(-T * 0.08, -T * 0.32, T * 0.05, T * 0.56)
        g.rect(T * 0.3, -T * 0.4, T * 0.05, T * 0.56)
        g.moveTo(-T * 0.08, -T * 0.32)
        g.lineTo(T * 0.35, -T * 0.4)
        g.lineTo(T * 0.35, -T * 0.28)
        g.lineTo(-T * 0.08, -T * 0.2)
        g.closePath()
      } else {
        cabeza(-T * 0.08, T * 0.24)
        g.rect(T * 0.03, -T * 0.38, T * 0.06, T * 0.6)
        g.moveTo(T * 0.06, -T * 0.38)
        g.bezierCurveTo(T * 0.12, -T * 0.24, T * 0.36, -T * 0.2, T * 0.26, T * 0.04)
        g.bezierCurveTo(T * 0.28, -T * 0.12, T * 0.16, -T * 0.16, T * 0.06, -T * 0.22)
        g.closePath()
      }
    }
    dibujar()
    g.lineWidth = T * 0.1
    g.strokeStyle = '#86198F'
    g.stroke()
    dibujar()
    g.fillStyle = '#FDF4FF'
    g.fill()
  }
}

/** Cruz de la curación: verde con brillo. */
const cruz: Pintor = (g, T) => {
  const a = T * 0.15
  const l = T * 0.4
  const forma = () => {
    g.beginPath()
    g.moveTo(-a, -l)
    g.lineTo(a, -l)
    g.lineTo(a, -a)
    g.lineTo(l, -a)
    g.lineTo(l, a)
    g.lineTo(a, a)
    g.lineTo(a, l)
    g.lineTo(-a, l)
    g.lineTo(-a, a)
    g.lineTo(-l, a)
    g.lineTo(-l, -a)
    g.lineTo(-a, -a)
    g.closePath()
  }
  forma()
  g.lineWidth = T * 0.12
  g.strokeStyle = '#065F46'
  g.stroke()
  forma()
  const d = g.createLinearGradient(0, -l, 0, l)
  d.addColorStop(0, '#D1FAE5')
  d.addColorStop(0.45, '#4ADE80')
  d.addColorStop(1, '#15803D')
  g.fillStyle = d
  g.fill()
  g.fillStyle = 'rgba(255,255,255,0.7)'
  g.fillRect(-a * 0.55, -l * 0.86, a * 0.5, l * 0.6)
}

/** Mosca: cuerpo negro y dos alas translúcidas. */
const mosca: Pintor = (g, T) => {
  g.fillStyle = 'rgba(220,240,255,0.75)'
  g.strokeStyle = 'rgba(120,150,180,0.8)'
  g.lineWidth = 0.6
  for (const s of [-1, 1]) {
    g.beginPath()
    g.ellipse(s * T * 0.12, -T * 0.16, T * 0.16, T * 0.1, s * 0.6, 0, TAU)
    g.fill()
    g.stroke()
  }
  g.fillStyle = '#16181C'
  g.beginPath()
  g.ellipse(0, T * 0.04, T * 0.2, T * 0.14, 0, 0, TAU)
  g.fill()
  g.beginPath()
  g.arc(T * 0.2, T * 0.02, T * 0.09, 0, TAU)
  g.fill()
  g.fillStyle = '#B91C1C'
  g.beginPath()
  g.arc(T * 0.24, T * 0.0, T * 0.04, 0, TAU)
  g.fill()
}

/** Lengua de fuego (apunta hacia arriba): núcleo claro, borde naranja que se desvanece. */
const llama: Pintor = (g, T) => {
  g.translate(0, T * 0.18)
  const forma = (k: number) => {
    g.beginPath()
    g.moveTo(0, -T * 0.62 * k)
    g.bezierCurveTo(T * 0.12 * k, -T * 0.36 * k, T * 0.3 * k, -T * 0.14 * k, T * 0.22 * k, T * 0.06 * k)
    g.bezierCurveTo(T * 0.16 * k, T * 0.24 * k, -T * 0.16 * k, T * 0.24 * k, -T * 0.22 * k, T * 0.06 * k)
    g.bezierCurveTo(-T * 0.3 * k, -T * 0.14 * k, -T * 0.12 * k, -T * 0.36 * k, 0, -T * 0.62 * k)
    g.closePath()
  }
  forma(1)
  const d = g.createRadialGradient(0, T * 0.02, T * 0.02, 0, -T * 0.1, T * 0.5)
  d.addColorStop(0, 'rgba(255,240,170,1)')
  d.addColorStop(0.35, 'rgba(255,170,40,0.95)')
  d.addColorStop(0.75, 'rgba(255,80,20,0.7)')
  d.addColorStop(1, 'rgba(200,30,10,0)')
  g.fillStyle = d
  g.fill()
  forma(0.5)
  g.fillStyle = 'rgba(255,252,225,0.95)'
  g.fill()
}

/** Espiral del mareo. */
const espiral: Pintor = (g, T) => {
  const trazo = () => {
    g.beginPath()
    const vueltas = 2.6
    const pasos = 70
    for (let k = 0; k <= pasos; k++) {
      const a = (k / pasos) * vueltas * TAU
      const r = 1 + (k / pasos) * T * 0.44
      const px = Math.cos(a) * r
      const py = Math.sin(a) * r
      if (k === 0) g.moveTo(px, py)
      else g.lineTo(px, py)
    }
  }
  trazo()
  g.lineWidth = T * 0.12
  g.strokeStyle = '#5B21B6'
  g.stroke()
  trazo()
  g.lineWidth = T * 0.055
  g.strokeStyle = '#F5D0FE'
  g.stroke()
}

/** Burbuja verdosa (estado lento). */
const burbuja: Pintor = (g, T) => {
  const r = T * 0.4
  g.beginPath()
  g.arc(0, 0, r, 0, TAU)
  g.fillStyle = 'rgba(160,230,120,0.22)'
  g.fill()
  g.lineWidth = T * 0.08
  g.strokeStyle = 'rgba(190,245,160,0.9)'
  g.stroke()
  g.fillStyle = 'rgba(255,255,255,0.9)'
  g.beginPath()
  g.arc(-r * 0.35, -r * 0.35, r * 0.22, 0, TAU)
  g.fill()
}

// ─── Quinta tanda (14/nov) ───────────────────────────────────────────────────

/** Un naipe de espaldas: el rojo de las Cartas Malditas o el violeta del dominio (Chino). */
function naipe(color: string, rombo: string): Pintor {
  return (g, T) => {
    const w = T * 0.6
    const h = T * 0.88
    rectRedondo(g, -w / 2, -h / 2, w, h, T * 0.08)
    g.fillStyle = '#FBF7F0'
    g.fill()
    g.lineWidth = T * 0.045
    g.strokeStyle = '#1A0A10'
    g.stroke()
    rectRedondo(g, -w / 2 + T * 0.07, -h / 2 + T * 0.07, w - T * 0.14, h - T * 0.14, T * 0.05)
    g.fillStyle = color
    g.fill()
    g.beginPath()
    g.moveTo(0, -h * 0.28)
    g.lineTo(w * 0.24, 0)
    g.lineTo(0, h * 0.28)
    g.lineTo(-w * 0.24, 0)
    g.closePath()
    g.fillStyle = rombo
    g.fill()
    g.lineWidth = T * 0.025
    g.strokeStyle = '#FBF7F0'
    g.stroke()
  }
}

/** Secador de pelo de costado, mirando a la derecha (respaldo del de Leo). */
const secador: Pintor = (g, T) => {
  const u = T / 48
  g.lineWidth = 1.4 * u
  g.strokeStyle = '#15171B'
  // el mango
  g.beginPath()
  g.moveTo(-9 * u, 4 * u)
  g.lineTo(-12 * u, 20 * u)
  g.lineTo(-5 * u, 20 * u)
  g.lineTo(-2 * u, 4 * u)
  g.closePath()
  g.fillStyle = '#2B2F36'
  g.fill()
  g.stroke()
  // el cuerpo y la boca
  rectRedondo(g, -18 * u, -12 * u, 34 * u, 16 * u, 7 * u)
  const d = g.createLinearGradient(0, -12 * u, 0, 4 * u)
  d.addColorStop(0, '#E6EBF0')
  d.addColorStop(0.5, '#9AA4AF')
  d.addColorStop(1, '#5E6670')
  g.fillStyle = d
  g.fill()
  g.stroke()
  g.fillStyle = '#1D2026'
  g.fillRect(14 * u, -10 * u, 6 * u, 12 * u)
  g.strokeRect(14 * u, -10 * u, 6 * u, 12 * u)
  g.beginPath()
  g.arc(-10 * u, -4 * u, 4.5 * u, 0, TAU)
  g.fillStyle = '#3A4049'
  g.fill()
  g.stroke()
}

/** Pelota de pádel amarillo verdosa con su costura (respaldo de la de Nehuen). */
const pelotita: Pintor = (g, T) => {
  const r = T * 0.44
  const d = g.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r)
  d.addColorStop(0, '#F4FFC2')
  d.addColorStop(0.6, '#C8F542')
  d.addColorStop(1, '#7FA61C')
  g.beginPath()
  g.arc(0, 0, r, 0, TAU)
  g.fillStyle = d
  g.fill()
  g.lineWidth = T * 0.06
  g.strokeStyle = '#3D5208'
  g.stroke()
  g.lineWidth = T * 0.07
  g.strokeStyle = '#FFFFFF'
  g.beginPath()
  g.arc(-r * 0.95, 0, r * 0.75, -0.9, 0.9)
  g.stroke()
  g.beginPath()
  g.arc(r * 0.95, 0, r * 0.75, Math.PI - 0.9, Math.PI + 0.9)
  g.stroke()
}

/** Una púa dorada con la punta a la derecha (respaldo de la `pua` de Nico M.; también la que vuela al pisarla). */
const pua: Pintor = (g, T) => {
  const u = T / 40
  g.beginPath()
  g.moveTo(18 * u, 0)
  g.lineTo(-12 * u, -5 * u)
  g.quadraticCurveTo(-17 * u, 0, -12 * u, 5 * u)
  g.closePath()
  const d = g.createLinearGradient(0, -5 * u, 0, 5 * u)
  d.addColorStop(0, '#FFF3B0')
  d.addColorStop(0.45, '#FFC93C')
  d.addColorStop(1, '#9A6200')
  g.fillStyle = d
  g.fill()
  g.lineWidth = 1.2 * u
  g.strokeStyle = '#3A2400'
  g.stroke()
  g.strokeStyle = 'rgba(255,255,255,0.8)'
  g.lineWidth = 0.9 * u
  g.beginPath()
  g.moveTo(-9 * u, -2 * u)
  g.lineTo(14 * u, -0.5 * u)
  g.stroke()
}

/** Monopatín eléctrico de costado, con el manubrio plegado (respaldo del de Tony). */
const monopatin: Pintor = (g, T) => {
  const u = T / 112
  g.lineJoin = 'round'
  g.strokeStyle = '#0B0D12'
  g.lineWidth = 2 * u
  // el manubrio plegado sobre la tabla
  g.beginPath()
  g.moveTo(38 * u, 6 * u)
  g.lineTo(-30 * u, -8 * u)
  g.lineWidth = 5 * u
  g.strokeStyle = '#1F232B'
  g.stroke()
  g.lineWidth = 2 * u
  g.strokeStyle = '#0B0D12'
  // la tabla
  rectRedondo(g, -44 * u, 2 * u, 80 * u, 9 * u, 4 * u)
  g.fillStyle = '#2A2F38'
  g.fill()
  g.stroke()
  // el LED azul
  g.fillStyle = '#2B79DB'
  g.fillRect(-30 * u, 5 * u, 40 * u, 2.4 * u)
  // las ruedas
  for (const cx of [-40, 38]) {
    g.beginPath()
    g.arc(cx * u, 14 * u, 9 * u, 0, TAU)
    g.fillStyle = '#121418'
    g.fill()
    g.stroke()
    g.beginPath()
    g.arc(cx * u, 14 * u, 3.5 * u, 0, TAU)
    g.fillStyle = '#8D97A3'
    g.fill()
  }
}

/** El papel del despido: hoja blanca con «DESPIDO» en rojo y renglones (respaldo del de Tony). */
const despido: Pintor = (g, T) => {
  const w = T * 0.62
  const h = T * 0.86
  g.save()
  g.rotate(-0.06)
  rectRedondo(g, -w / 2, -h / 2, w, h, T * 0.03)
  g.fillStyle = '#FFFDF6'
  g.fill()
  g.lineWidth = T * 0.025
  g.strokeStyle = '#4A3B30'
  g.stroke()
  g.fillStyle = '#C81E1E'
  g.font = `900 ${T * 0.13}px Impact, "Arial Black", sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('DESPIDO', 0, -h * 0.3)
  g.strokeStyle = 'rgba(70,60,50,0.55)'
  g.lineWidth = T * 0.018
  for (let k = 0; k < 5; k++) {
    const y = -h * 0.1 + k * h * 0.11
    g.beginPath()
    g.moveTo(-w * 0.36, y)
    g.lineTo(w * (k === 4 ? 0.05 : 0.36), y)
    g.stroke()
  }
  // la firma
  g.strokeStyle = '#1E3A8A'
  g.beginPath()
  g.moveTo(w * 0.05, h * 0.38)
  g.bezierCurveTo(w * 0.15, h * 0.28, w * 0.2, h * 0.46, w * 0.34, h * 0.34)
  g.stroke()
  g.restore()
}

/** La laptop cerrada y plateada (respaldo de la del Laptopazo de Nacho). */
const laptop: Pintor = (g, T) => {
  const u = T / 40
  rectRedondo(g, -15 * u, -11 * u, 30 * u, 22 * u, 3 * u)
  const d = g.createLinearGradient(-15 * u, -11 * u, 15 * u, 11 * u)
  d.addColorStop(0, '#F4F7FA')
  d.addColorStop(0.55, '#B9C2CC')
  d.addColorStop(1, '#6E7884')
  g.fillStyle = d
  g.fill()
  g.lineWidth = 1.3 * u
  g.strokeStyle = '#2B3138'
  g.stroke()
  g.beginPath()
  g.arc(0, 0, 3 * u, 0, TAU)
  g.fillStyle = 'rgba(0,194,255,0.85)'
  g.fill()
}

/** Un dígito («0» o «1») de código: cian (el código de Nacho) o rojo (el error del apretón). */
function digito(texto: string, color: string): Pintor {
  return (g, T) => {
    g.font = `800 ${T * 0.92}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.lineWidth = T * 0.16
    g.strokeStyle = 'rgba(2,8,16,0.85)'
    g.strokeText(texto, 0, T * 0.04)
    g.fillStyle = color
    g.fillText(texto, 0, T * 0.04)
  }
}

/** Piedras oscuras con el borde cian (el piso que revienta en el Terremoto de Código). */
function rocaCian(semilla: number): Pintor {
  return (g, T) => {
    const n = 6
    const pts: [number, number][] = []
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + ruido(semilla * 29 + k) * 0.6
      const r = T * (0.28 + 0.15 * ruido(semilla * 13 + k * 5))
      pts.push([Math.cos(a) * r, Math.sin(a) * r * 0.85])
    }
    g.beginPath()
    pts.forEach(([x, y], k) => (k === 0 ? g.moveTo(x, y) : g.lineTo(x, y)))
    g.closePath()
    g.fillStyle = '#20252E'
    g.fill()
    g.lineWidth = T * 0.09
    g.strokeStyle = '#22D3EE'
    g.stroke()
    g.lineWidth = T * 0.035
    g.strokeStyle = '#E0FBFF'
    g.stroke()
  }
}

/** Una lágrima celeste (el que llora arrodillado en el Despido). */
const lagrima: Pintor = (g, T) => {
  const r = T * 0.3
  g.beginPath()
  g.moveTo(0, -T * 0.45)
  g.quadraticCurveTo(r * 1.1, -r * 0.1, r, r * 0.5)
  g.arc(0, r * 0.5, r, 0, Math.PI)
  g.quadraticCurveTo(-r * 1.1, -r * 0.1, 0, -T * 0.45)
  g.closePath()
  g.fillStyle = '#8FD8FF'
  g.fill()
  g.lineWidth = T * 0.08
  g.strokeStyle = '#1D6FA5'
  g.stroke()
  g.fillStyle = 'rgba(255,255,255,0.9)'
  g.beginPath()
  g.arc(-r * 0.3, r * 0.2, r * 0.25, 0, TAU)
  g.fill()
}

/** «!!» de historieta: rojo con borde blanco y negro. */
const exclamacion: Pintor = (g, T) => {
  const signo = (x: number) => {
    g.beginPath()
    g.moveTo(x - T * 0.09, -T * 0.4)
    g.lineTo(x + T * 0.09, -T * 0.4)
    g.lineTo(x + T * 0.04, T * 0.14)
    g.lineTo(x - T * 0.04, T * 0.14)
    g.closePath()
    g.moveTo(x + T * 0.075, T * 0.3)
    g.arc(x, T * 0.3, T * 0.075, 0, TAU)
  }
  for (const [ancho, color] of [
    [T * 0.14, '#0B0B0E'],
    [T * 0.07, '#FFFFFF'],
  ] as const) {
    g.lineWidth = ancho
    g.strokeStyle = color
    signo(-T * 0.14)
    g.stroke()
    signo(T * 0.14)
    g.stroke()
  }
  g.fillStyle = '#F0443A'
  signo(-T * 0.14)
  g.fill()
  signo(T * 0.14)
  g.fill()
}

/**
 * La nube del Spray Cegador de Leo: bollos blancos y grises, opacos (tiene que verse sobre pisos
 * claros). Se pinta UNA vez y en cada cuadro sólo se estira a la caja del chorro (dos variantes que
 * se alternan para que respire).
 */
function nubeSpray(semilla: number): Pintor {
  return (g, T) => {
    const bollos = 13
    for (let k = 0; k < bollos; k++) {
      const a = ruido(semilla * 41 + k * 7) * TAU
      const d = Math.sqrt(ruido(semilla * 17 + k * 3)) * T * 0.3
      const x = Math.cos(a) * d
      const y = Math.sin(a) * d * 0.7
      const r = T * (0.13 + 0.09 * ruido(semilla * 5 + k))
      const gris = 205 + Math.round(45 * ruido(semilla * 3 + k * 11))
      const deg = g.createRadialGradient(x - r * 0.25, y - r * 0.3, r * 0.1, x, y, r)
      deg.addColorStop(0, `rgba(255,255,255,0.97)`)
      deg.addColorStop(0.55, `rgba(${gris},${gris},${gris + 4 > 255 ? 255 : gris + 4},0.92)`)
      deg.addColorStop(1, `rgba(${gris - 40},${gris - 38},${gris - 30},0)`)
      g.fillStyle = deg
      g.beginPath()
      g.arc(x, y, r, 0, TAU)
      g.fill()
    }
  }
}

/** El disco hipnótico (el hipnotizado de los Lentes de Fran): bandas violeta y blanco en espiral. */
const hipnosis: Pintor = (g, T) => {
  const R = T * 0.46
  g.beginPath()
  g.arc(0, 0, R, 0, TAU)
  g.fillStyle = '#2E1065'
  g.fill()
  for (const [ancho, color] of [
    [T * 0.11, '#C084FC'],
    [T * 0.045, '#FFFFFF'],
  ] as const) {
    g.beginPath()
    const pasos = 90
    for (let k = 0; k <= pasos; k++) {
      const a = (k / pasos) * 3.2 * TAU
      const r = (k / pasos) * R * 0.92
      const px = Math.cos(a) * r
      const py = Math.sin(a) * r
      if (k === 0) g.moveTo(px, py)
      else g.lineTo(px, py)
    }
    g.lineWidth = ancho
    g.strokeStyle = color
    g.stroke()
  }
  g.beginPath()
  g.arc(0, 0, R, 0, TAU)
  g.lineWidth = T * 0.05
  g.strokeStyle = '#E9D5FF'
  g.stroke()
}

const PINTORES: Readonly<Record<NombreUtileria, Pintor>> = {
  bombo,
  bala,
  botella,
  vaso,
  gorro,
  pelota,
  panal,
  mate,
  guante,
  graffiti,
  roca0: roca(1),
  roca1: roca(2),
  roca2: roca(3),
  nota: nota(false),
  nota2: nota(true),
  cruz,
  mosca,
  llama,
  espiral,
  burbuja,
  naipe: naipe('#BE123C', '#7F0A26'),
  secador,
  pelotita,
  pua,
  monopatin,
  despido,
  laptop,
  naipe_violeta: naipe('#7C3AED', '#3B1782'),
  digito0: digito('0', '#22D3EE'),
  digito1: digito('1', '#22D3EE'),
  digito0_rojo: digito('0', '#FF3B5C'),
  digito1_rojo: digito('1', '#FF3B5C'),
  roca_cian0: rocaCian(1),
  roca_cian1: rocaCian(2),
  roca_cian2: rocaCian(3),
  lagrima,
  exclamacion,
  nube_spray0: nubeSpray(1),
  nube_spray1: nubeSpray(2),
  hipnosis,
}

export function crearUtileria(): Utileria {
  const cache = new Map<NombreUtileria, HTMLCanvasElement>()
  const propios = new Map<string, HTMLCanvasElement>()
  return {
    de(nombre: NombreUtileria): HTMLCanvasElement {
      let c = cache.get(nombre)
      if (!c) {
        c = lienzoDe(TAM_UTILERIA[nombre], PINTORES[nombre])
        cache.set(nombre, c)
      }
      return c
    },
    propio(clave: string, ancho: number, alto: number, pintor: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
      let c = propios.get(clave)
      if (!c) {
        c = crearLienzo(ancho, alto)
        pintor(contexto(c))
        propios.set(clave, c)
      }
      return c
    },
    liberar(): void {
      for (const c of cache.values()) liberarLienzo(c)
      cache.clear()
      for (const c of propios.values()) liberarLienzo(c)
      propios.clear()
    },
  }
}
