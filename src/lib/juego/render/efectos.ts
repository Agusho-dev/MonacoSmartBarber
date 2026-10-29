/**
 * Atlas de efectos compartidos: public/juego/efectos/efectos.json + efectos.png (pixel art que
 * genera scripts/juego/generar_efectos.py: chispas, ondas, hielo, polvo, tornado, tijera...).
 *
 * NO es parte del contrato de tipos.ts: cargarRecursos lo baja si está y lo deja como propiedad
 * extra de RecursosJuego (`efectosComunes`). Si no está, cada efecto se dibuja a mano: todo lo
 * que usa esto tiene su respaldo procedural.
 */
import type { CuadroAtlas } from '../tipos'
import type { Escena } from './escena'
import { medidas } from './lienzo'

export const FX_CHISPA = 0
export const FX_CHISPA_CRITICA = 1
export const FX_BLOQUEO = 2
export const FX_MECHONES = 3
export const FX_RAYO = 4
export const FX_ARCO = 5
export const FX_TIJERA = 6
export const FX_TORNADO = 7
export const FX_SILLON = 8
export const FX_SPRAY = 9
export const FX_HIELO = 10
export const FX_HIELO_TROZO = 11
export const FX_POLVO = 12
export const FX_VIDRIO = 13
export const FX_ESTRELLAS = 14
export const FX_ONDA = 15
export const FX_DESTELLO = 16

/** Nombres en el JSON, en el orden de las constantes de arriba. */
const NOMBRES = [
  'chispa',
  'chispa_critica',
  'bloqueo',
  'mechones',
  'rayo',
  'arco_electrico',
  'tijera',
  'tornado',
  'sillon',
  'spray_nube',
  'hielo',
  'hielo_trozo',
  'polvo',
  'vidrio',
  'estrellas',
  'onda',
  'destello',
] as const

/** El JSON tal como lo escribe el generador. */
export interface AtlasEfectosComunes {
  version: number
  imagen: string
  animaciones: Record<string, { cuadros: CuadroAtlas[]; mezcla?: string; fps?: number }>
}

/** Lo que cargarRecursos deja en RecursosJuego.efectosComunes. */
export interface RecursoEfectos {
  datos: AtlasEfectosComunes
  imagen: CanvasImageSource
}

export interface FxAnim {
  cuadros: CuadroAtlas[]
  aditiva: boolean
  /** 0 = cuadros sueltos (variantes), no una animación. */
  fps: number
}

export interface EfectosComunes {
  imagen: CanvasImageSource
  /** Índice = constante FX_*; null si el atlas no trae ese efecto. */
  anims: (FxAnim | null)[]
}

export function prepararEfectos(r: RecursoEfectos | null | undefined): EfectosComunes | null {
  if (!r || !r.datos || typeof r.datos.animaciones !== 'object') return null
  const { w: W, h: H } = medidas(r.imagen)
  if (W <= 0 || H <= 0) return null
  const anims: (FxAnim | null)[] = []
  let alguna = false
  for (const nombre of NOMBRES) {
    const a = r.datos.animaciones[nombre]
    const cuadros = Array.isArray(a?.cuadros)
      ? a.cuadros.filter(
          (c) =>
            c &&
            [c.x, c.y, c.w, c.h, c.ax, c.ay].every((n) => typeof n === 'number' && Number.isFinite(n)) &&
            c.w > 0 &&
            c.h > 0 &&
            c.x >= 0 &&
            c.y >= 0 &&
            c.x + c.w <= W + 0.5 &&
            c.y + c.h <= H + 0.5,
        )
      : []
    if (!a || cuadros.length === 0) {
      anims.push(null)
      continue
    }
    alguna = true
    anims.push({ cuadros, aditiva: a.mezcla === 'aditiva', fps: typeof a.fps === 'number' && a.fps > 0 ? a.fps : 0 })
  }
  return alguna ? { imagen: r.imagen, anims } : null
}

/** El efecto `id` si el atlas compartido lo trae. */
export function fx(E: Escena, id: number): FxAnim | null {
  return E.fx ? (E.fx.anims[id] ?? null) : null
}

/** Cuadro de una animación según el tiempo: de una pasada (se queda en el último) o en bucle. */
export function cuadroFx(f: FxAnim, ms: number, bucle: boolean): number {
  const n = f.cuadros.length
  if (n <= 1 || f.fps <= 0) return 0
  const i = Math.floor((ms / 1000) * f.fps)
  return bucle ? ((i % n) + n) % n : Math.min(n - 1, Math.max(0, i))
}

/** Duración en ms de una pasada completa. */
export function duracionFx(f: FxAnim): number {
  return f.fps > 0 ? (f.cuadros.length / f.fps) * 1000 : 400
}

/**
 * Dibuja el cuadro `i` con su pivote en (x, y) de mundo. `esc` = unidades de mundo por px del
 * atlas. No toca la mezcla (la elige quien llama); sí el suavizado (pixel art nítido si se agranda).
 */
export function dibujarFx(
  E: Escena,
  f: FxAnim,
  i: number,
  x: number,
  y: number,
  esc: number,
  rot: number,
  mira: number,
  alfa: number,
): void {
  const fxs = E.fx
  if (!fxs) return
  const c = f.cuadros[i] ?? f.cuadros[0]
  const ctx = E.ctx
  const k = E.cam.esc * esc
  const kx = k * (mira < 0 ? -1 : 1)
  ctx.imageSmoothingEnabled = k < 2
  if (rot === 0) {
    ctx.setTransform(kx, 0, 0, k, E.cam.tx + E.cam.esc * x, E.cam.ty + E.cam.esc * y)
  } else {
    const cs = Math.cos(rot)
    const sn = Math.sin(rot)
    ctx.setTransform(kx * cs, kx * sn, -k * sn, k * cs, E.cam.tx + E.cam.esc * x, E.cam.ty + E.cam.esc * y)
  }
  ctx.globalAlpha = alfa
  ctx.drawImage(fxs.imagen, c.x, c.y, c.w, c.h, -c.ax, -c.ay, c.w, c.h)
}
