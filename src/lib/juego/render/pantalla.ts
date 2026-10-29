/**
 * Capa de escenario y de pantalla: la arena (con su caché a la resolución justa), las luces que
 * titilan, la viñeta, el resplandor del TURBO, el destello de pantalla y el «super flash» de los
 * especiales (oscurecer, rayos detrás del que lo tira y la banda en diagonal con su cara y el
 * nombre gigante).
 */
import type { ArenaDef, FichaPersonaje, Lado, LuchadorEstado } from '../tipos'
import { enMundo, spriteMundo, type Escena } from './escena'
import { contexto, crearLienzo, liberarLienzo, medidas } from './lienzo'
import { dibujarLuchador, type VisualLuchador } from './luchadores'
import { pintarTexto, type EstiloTexto } from './textos'
import { aclarar, acotar, entradaCuadratica, rgba, ruido, salidaCubica, TAU } from './util'

// ─── Escenario ───────────────────────────────────────────────────────────────

export interface Escenario {
  def: ArenaDef
  imagen: CanvasImageSource
  anchoImg: number
  altoImg: number
  /** La arena ya achicada a la resolución del lienzo (sólo si hace falta achicar mucho). */
  cache: HTMLCanvasElement | null
  vineta: HTMLCanvasElement
  turbo: HTMLCanvasElement
}

function lienzoBorde(colorBorde: string, alfaBorde: number, interior: number): HTMLCanvasElement {
  const c = crearLienzo(128, 128)
  const g = contexto(c)
  const d = g.createRadialGradient(64, 64, interior, 64, 64, 92)
  d.addColorStop(0, rgba(colorBorde, 0))
  d.addColorStop(0.55, rgba(colorBorde, alfaBorde * 0.3))
  d.addColorStop(1, rgba(colorBorde, alfaBorde))
  g.fillStyle = d
  g.fillRect(0, 0, 128, 128)
  return c
}

export function crearEscenario(def: ArenaDef, imagen: CanvasImageSource): Escenario {
  const { w, h } = medidas(imagen)
  return {
    def,
    imagen,
    anchoImg: w,
    altoImg: h,
    cache: null,
    vineta: lienzoBorde('#000000', 0.62, 30),
    turbo: lienzoBorde('#FFB21A', 0.75, 44),
  }
}

/** Después de redimensionar: si el lienzo es mucho más chico que la imagen, la achica una vez. */
export function prepararEscenario(E: Escena, esc: Escenario): void {
  liberarLienzo(esc.cache)
  esc.cache = null
  const cam = E.cam
  if (esc.anchoImg <= 0 || esc.altoImg <= 0) return
  const nativa = esc.anchoImg / cam.imgW
  const necesaria = cam.base * 1.12
  if (necesaria >= nativa * 0.8) return
  const w = Math.max(1, Math.ceil(cam.imgW * necesaria))
  const h = Math.max(1, Math.ceil(cam.imgH * necesaria))
  // de a mitades: se parece más a promediar que un solo salto (sin moiré en los tubos de luz)
  let fuente: CanvasImageSource = esc.imagen
  let fw = esc.anchoImg
  let fh = esc.altoImg
  const temporales: HTMLCanvasElement[] = []
  while (fw / 2 >= w) {
    const t = crearLienzo(Math.ceil(fw / 2), Math.ceil(fh / 2))
    const gt = contexto(t)
    gt.imageSmoothingEnabled = true
    gt.imageSmoothingQuality = 'high'
    gt.drawImage(fuente, 0, 0, t.width, t.height)
    temporales.push(t)
    fuente = t
    fw = t.width
    fh = t.height
  }
  const c = crearLienzo(w, h)
  const g = contexto(c)
  g.imageSmoothingEnabled = true
  g.imageSmoothingQuality = 'high'
  g.drawImage(fuente, 0, 0, w, h)
  for (const t of temporales) liberarLienzo(t)
  esc.cache = c
}

export function liberarEscenario(esc: Escenario): void {
  liberarLienzo(esc.cache)
  liberarLienzo(esc.vineta)
  liberarLienzo(esc.turbo)
  esc.cache = null
}

export function dibujarFondo(E: Escena, esc: Escenario): void {
  const ctx = E.ctx
  const cam = E.cam
  ctx.setTransform(cam.esc, 0, 0, cam.esc, cam.tx, cam.ty)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(esc.cache ?? esc.imagen, cam.imgX, cam.imgY, cam.imgW, cam.imgH)
}

/** Neones y focos de la arena (`arena.luces`, fracciones de la imagen; radio = fracción del ancho). */
export function dibujarLuces(E: Escena, esc: Escenario, turbo: boolean): void {
  const luces = esc.def.luces
  if (!luces || luces.length === 0) return
  const cam = E.cam
  const ctx = E.ctx
  ctx.globalCompositeOperation = 'lighter'
  const rapido = turbo ? 1.8 : 1
  for (let i = 0; i < luces.length; i++) {
    const L = luces[i]
    const x = cam.imgX + L.x * cam.imgW
    const y = cam.imgY + L.y * cam.imgH
    const r = Math.max(3, L.radio * cam.imgW)
    const lento = 0.8 + 0.2 * Math.sin(E.s * (1.6 + (i % 5) * 0.37) * rapido + i * 1.3)
    // de vez en cuando un tubo «falla» un instante, como un neón viejo
    const falla = E.calidad !== 'baja' && ruido(Math.floor(E.s * 9) + i * 131) < 0.035 ? 0.25 : 1
    const a = lento * falla
    const img = E.spr.brillo(L.color || '#FFFFFF')
    spriteMundo(E, img, x, y, r * 2.6, r * 2.6, 0, 0.3 * a)
    if (E.calidad !== 'baja') spriteMundo(E, img, x, y, r, r, 0, 0.45 * a)
  }
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
}

export function dibujarVineta(E: Escena, esc: Escenario, turbo: boolean): void {
  const ctx = E.ctx
  const W = E.cam.anchoPx
  const H = E.cam.altoPx
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.globalAlpha = 1
  ctx.drawImage(esc.vineta, 0, 0, W, H)
  if (turbo) {
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = 0.2 + 0.12 * Math.sin(E.s * 6.5)
    ctx.drawImage(esc.turbo, 0, 0, W, H)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
  }
}

// ─── Destello de pantalla ────────────────────────────────────────────────────

export interface Destello {
  color: string
  alfa: number
  dur: number
  edad: number
}

export function crearDestello(): Destello {
  return { color: '#FFFFFF', alfa: 0, dur: 1, edad: 1 }
}

/** Un fogonazo de pantalla completa. Uno más fuerte reemplaza al que está. */
export function destellar(d: Destello, color: string, alfa: number, durMs: number): void {
  const queda = d.edad < d.dur ? d.alfa * (1 - d.edad / d.dur) : 0
  if (alfa < queda) return
  d.color = color
  d.alfa = alfa
  d.dur = Math.max(30, durMs)
  d.edad = 0
}

export function dibujarDestello(E: Escena, d: Destello): void {
  if (d.edad >= d.dur || d.alfa <= 0) return
  const t = d.edad / d.dur
  const ctx = E.ctx
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = d.alfa * (1 - t) * (1 - t)
  ctx.fillStyle = d.color
  ctx.fillRect(0, 0, E.cam.anchoPx, E.cam.altoPx)
  ctx.globalAlpha = 1
}

// ─── Super flash de los especiales ───────────────────────────────────────────

const BANDA_W = 1180
const BANDA_H = 150
export const DUR_SUPER = 1000

export interface SuperFlash {
  activo: boolean
  edad: number
  lado: Lado
  color: string
  rayos: string
  banda: HTMLCanvasElement | null
  bandaEscala: number
  /** Bandas ya pintadas por especial y lado (se repiten varias veces por partida). */
  bandas: Map<string, HTMLCanvasElement>
  bandasEscala: number
}

export function crearSuperFlash(): SuperFlash {
  return {
    activo: false,
    edad: 0,
    lado: 0,
    color: '#FFFFFF',
    rayos: 'rgba(255,255,255,0.3)',
    banda: null,
    bandaEscala: 1,
    bandas: new Map(),
    bandasEscala: 0,
  }
}

function caminoParalelogramo(g: CanvasRenderingContext2D, cx: number, y0: number, y1: number, ancho: number, sesgo: number): void {
  g.beginPath()
  g.moveTo(cx - ancho / 2 + sesgo, y0)
  g.lineTo(cx + ancho / 2 + sesgo, y0)
  g.lineTo(cx + ancho / 2 - sesgo, y1)
  g.lineTo(cx - ancho / 2 - sesgo, y1)
  g.closePath()
}

/** La banda del especial: fondo negro con el color del personaje, su cara y el nombre gigante. */
function pintarBanda(
  E: Escena,
  destino: HTMLCanvasElement | null,
  nombre: string,
  ficha: FichaPersonaje,
  cara: CanvasImageSource | null,
  lado: Lado,
): HTMLCanvasElement {
  const esc = E.cam.base
  const c = destino ?? crearLienzo(1, 1)
  c.width = Math.max(1, Math.ceil(BANDA_W * esc))
  c.height = Math.max(1, Math.ceil(BANDA_H * esc))
  const g = contexto(c)
  g.setTransform(esc, 0, 0, esc, 0, 0)
  const fondo = g.createLinearGradient(0, 0, BANDA_W, 0)
  fondo.addColorStop(0, 'rgba(8,8,12,0)')
  fondo.addColorStop(0.13, 'rgba(8,8,12,0.93)')
  fondo.addColorStop(0.87, 'rgba(8,8,12,0.93)')
  fondo.addColorStop(1, 'rgba(8,8,12,0)')
  g.fillStyle = fondo
  g.fillRect(0, 12, BANDA_W, BANDA_H - 24)
  const desde = lado === 0 ? BANDA_W * 0.08 : BANDA_W * 0.92
  const hasta = lado === 0 ? BANDA_W * 0.7 : BANDA_W * 0.3
  const tinte = g.createLinearGradient(desde, 0, hasta, 0)
  tinte.addColorStop(0, rgba(ficha.color, 0.5))
  tinte.addColorStop(1, rgba(ficha.color, 0))
  g.fillStyle = tinte
  g.fillRect(0, 12, BANDA_W, BANDA_H - 24)
  // líneas de velocidad
  g.fillStyle = 'rgba(255,255,255,0.09)'
  for (let i = 0; i < 11; i++) {
    const y = 20 + ((i * 53) % (BANDA_H - 40))
    const x = (i * 197) % BANDA_W
    g.fillRect(x, y, 150 + (i % 3) * 90, 2)
  }
  // filos del color del personaje
  const filo = g.createLinearGradient(0, 0, BANDA_W, 0)
  filo.addColorStop(0, rgba(ficha.color, 0))
  filo.addColorStop(0.15, rgba(ficha.color, 1))
  filo.addColorStop(0.85, rgba(ficha.color, 1))
  filo.addColorStop(1, rgba(ficha.color, 0))
  g.fillStyle = filo
  g.fillRect(0, 6, BANDA_W, 6)
  g.fillRect(0, BANDA_H - 12, BANDA_W, 6)
  g.fillStyle = 'rgba(255,255,255,0.55)'
  g.fillRect(BANDA_W * 0.1, 13, BANDA_W * 0.8, 1.5)
  g.fillRect(BANDA_W * 0.1, BANDA_H - 14.5, BANDA_W * 0.8, 1.5)

  let hayCara = false
  const caraX = lado === 0 ? 170 : BANDA_W - 170
  if (cara) {
    const { w, h } = medidas(cara)
    if (w > 0 && h > 0) {
      hayCara = true
      const ancho = 220
      g.save()
      caminoParalelogramo(g, caraX, 14, BANDA_H - 14, ancho, 24)
      g.clip()
      const halo = g.createRadialGradient(caraX, BANDA_H / 2, 10, caraX, BANDA_H / 2, ancho * 0.6)
      halo.addColorStop(0, rgba(aclarar(ficha.color, 0.3), 0.85))
      halo.addColorStop(1, rgba(ficha.color, 0.1))
      g.fillStyle = halo
      g.fillRect(caraX - ancho, 0, ancho * 2, BANDA_H)
      const k = Math.max(ancho / w, (BANDA_H - 28) / h) * 1.08
      const dw = w * k
      const dh = h * k
      if (lado === 1) {
        // la cara mira hacia el centro de la pantalla
        g.translate(caraX * 2, 0)
        g.scale(-1, 1)
      }
      g.drawImage(cara, caraX - dw / 2, BANDA_H / 2 - dh / 2 + 8, dw, dh)
      g.restore()
      g.setTransform(esc, 0, 0, esc, 0, 0)
      caminoParalelogramo(g, caraX, 14, BANDA_H - 14, ancho, 24)
      g.lineWidth = 4
      g.strokeStyle = ficha.color
      g.stroke()
    }
  }

  const est: EstiloTexto = {
    tam: 98,
    familia: 'titulo',
    colores: ['#FFFFFF', aclarar(ficha.color, 0.55), ficha.color, ficha.colorSecundario, aclarar(ficha.colorSecundario, -0.45)],
    paradas: [0, 0.32, 0.5, 0.78, 1],
    contorno: '#050505',
    contornoAncho: 0.06,
    exterior: aclarar(ficha.color, -0.68),
    exteriorAncho: 0.11,
    inclinacion: 0.2,
    espaciado: 0.03,
    sombra: 0.06,
  }
  const txt = pintarTexto(null, nombre.toUpperCase(), est, E.familias, esc, hayCara ? 760 : 980)
  const tw = txt.lienzo.width / esc
  const th = txt.lienzo.height / esc
  const centro = hayCara ? (lado === 0 ? 690 : BANDA_W - 690) : BANDA_W / 2
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.drawImage(txt.lienzo, Math.round((centro - tw / 2) * esc), Math.round((BANDA_H / 2 - th / 2) * esc))
  liberarLienzo(txt.lienzo)
  return c
}

export function iniciarSuperFlash(
  E: Escena,
  sf: SuperFlash,
  lado: Lado,
  nombre: string,
  ficha: FichaPersonaje,
  cara: CanvasImageSource | null,
): void {
  sf.activo = true
  sf.edad = 0
  sf.lado = lado
  sf.color = ficha.color
  sf.rayos = rgba(ficha.color, 0.24)
  if (sf.bandasEscala !== E.cam.base) {
    for (const b of sf.bandas.values()) liberarLienzo(b)
    sf.bandas.clear()
    sf.bandasEscala = E.cam.base
  }
  const clave = `${lado}|${ficha.id}|${nombre}`
  let banda = sf.bandas.get(clave)
  if (!banda) {
    banda = pintarBanda(E, null, nombre, ficha, cara, lado)
    sf.bandas.set(clave, banda)
  }
  sf.banda = banda
  sf.bandaEscala = E.cam.base
}

export function actualizarSuperFlash(sf: SuperFlash, dtMs: number): void {
  if (!sf.activo) return
  sf.edad += dtMs
  if (sf.edad >= DUR_SUPER) sf.activo = false
}

export function liberarSuperFlash(sf: SuperFlash): void {
  for (const b of sf.bandas.values()) liberarLienzo(b)
  sf.bandas.clear()
  sf.banda = null
  sf.activo = false
}

function oscuridad(t: number): number {
  if (t < 90) return 0.78 * (t / 90)
  if (t < 640) return 0.78
  if (t < 900) return 0.78 * (1 - (t - 640) / 260)
  return 0
}

/** Oscurece todo, tira rayos detrás del que lo lanza y lo vuelve a dibujar encendido. */
export function dibujarSuperFlashMundo(E: Escena, sf: SuperFlash, l: LuchadorEstado, v: VisualLuchador): void {
  if (!sf.activo) return
  const ctx = E.ctx
  const t = sf.edad
  const oscuro = oscuridad(t)
  if (oscuro > 0) {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = oscuro
    ctx.fillStyle = '#05050A'
    ctx.fillRect(0, 0, E.cam.anchoPx, E.cam.altoPx)
  }
  const aRayos = t < 60 ? t / 60 : t < 700 ? 1 : t < 950 ? 1 - (t - 700) / 250 : 0
  if (aRayos > 0) {
    const alto = v.at ? v.at.ficha.alturaMundo : 200
    const cx = l.x
    const cy = E.sueloY - l.y - alto * 0.55
    ctx.globalCompositeOperation = 'lighter'
    spriteMundo(E, E.spr.brillo(sf.color), cx, cy, 560, 560, 0, 0.55 * aRayos)
    enMundo(E)
    ctx.globalAlpha = aRayos
    const R = 1400
    const n = 16
    const giro = E.s * 0.55
    ctx.fillStyle = sf.rayos
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const a0 = giro + (i * TAU) / n
      const a1 = a0 + (TAU / n) * 0.42
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R)
      ctx.lineTo(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R)
      ctx.closePath()
    }
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.13)'
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const a0 = -giro * 1.4 + (i * TAU) / n + 0.1
      const a1 = a0 + (TAU / n) * 0.12
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R)
      ctx.lineTo(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R)
      ctx.closePath()
    }
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }
  if (oscuro > 0.05) dibujarLuchador(E, l, v, Math.max(0, 1 - t / 260) * 0.75)
}

/** La banda en diagonal con la cara y el nombre (capa de pantalla, arriba de la viñeta). */
export function dibujarSuperFlashBanda(E: Escena, sf: SuperFlash, altoVista: number): void {
  if (!sf.activo || !sf.banda) return
  const t = sf.edad
  let desliza: number
  if (t < 50) return
  if (t < 250) desliza = 1 - salidaCubica((t - 50) / 200)
  else if (t < 780) desliza = 0
  else desliza = -entradaCuadratica((t - 780) / 180)
  const dir = sf.lado === 0 ? -1 : 1
  const offset = desliza * BANDA_W * dir
  const ctx = E.ctx
  const u = E.cam.base
  const rot = -0.16
  // en pantallas más anchas que 16:9 (celular acostado) la banda se achica con el alto visible
  const s = (u / sf.bandaEscala) * acotar(altoVista / 540, 0.75, 1)
  const c = Math.cos(rot) * s
  const sn = Math.sin(rot) * s
  ctx.setTransform(c, sn, -sn, c, 480 * u, altoVista * 0.3 * u)
  ctx.globalAlpha = acotar(1 - Math.abs(desliza) * 0.3, 0, 1)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(sf.banda, -sf.banda.width / 2 + offset * sf.bandaEscala, -sf.banda.height / 2)
  ctx.globalAlpha = 1
}
