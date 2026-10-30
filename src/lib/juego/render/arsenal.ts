/**
 * Proyectiles del elenco nuevo: bombo, bala, graffiti, trago, botella, onda, gorro, pelota, leche,
 * pañal, nube, mate, agua, sismo y guante (los de Simón y Chipi siguen en proyectiles.ts).
 *
 * De dónde sale cada dibujo: el sprite de `atlas.efectos` de la hoja del barbero si existe
 * (girando con `rot`) y si no, la utilería dibujada a mano (utileria.ts). Los chorros (leche y
 * agua), la onda del grito, la nube, el graffiti y el sismo se dibujan del tamaño de su caja
 * ACTUAL (`ancho` × `alto`), que el motor hace crecer.
 *
 * `Rastros` sigue a cada proyectil por su id entre cuadros: sabe dónde nació (la grieta del
 * sismo), cuándo estalló el graffiti y cuándo DESAPARECIÓ uno (el trago que salpica al caer, la
 * botella que se rompe sin crudeza, la nube que se esfuma). Arreglos de tamaño fijo: sin basura.
 *
 * (x, y) del proyectil = centro de su caja; y = altura del centro sobre el piso (contrato).
 */
import type { EfectoAtlas, FasePartida, Partida, ProyectilEstado, TipoProyectil } from '../tipos'
import { TIEMPOS_PROYECTIL, VISTA_ANCHO } from '../tipos'
import { temblar } from './camara'
import { enMundo, spriteMundo, type Escena } from './escena'
import type { AtlasPreparado } from './luchadores'
import {
  emitirAnillo,
  emitirBrillos,
  emitirBurbujas,
  emitirChispas,
  emitirEstallido,
  emitirLlamas,
  emitirMoscas,
  emitirNiebla,
  emitirNotas,
  emitirPolvo,
  emitirSalpicadura,
  emitirTrozos,
  G_AMBAR,
  G_CALIENTE,
  G_LECHE,
  G_PINTURA,
  G_TRAGO,
  G_YERBA,
  PAL_AZUL,
  PAL_FUEGO,
  PAL_MAGENTA,
  PAL_ORO,
  PAL_VIOLETA,
} from './particulas'
import { buscarEfecto, EF } from './proyectiles'
import type { NombreUtileria } from './utileria'
import { acotar, azar, ruido, salidaCubica, salidaElastica, TAU } from './util'

/** Los tipos que dibuja este módulo. */
const NUEVOS: ReadonlySet<TipoProyectil> = new Set<TipoProyectil>([
  'bombo',
  'bala',
  'graffiti',
  'trago',
  'botella',
  'onda',
  'gorro',
  'pelota',
  'leche',
  'panal',
  'nube',
  'mate',
  'agua',
  'sismo',
  'guante',
])

export function esDelArsenal(tipo: TipoProyectil): boolean {
  return NUEVOS.has(tipo)
}

/** Caja por defecto si el motor todavía no la informa (ancho, alto). */
const CAJA: Partial<Record<TipoProyectil, readonly [number, number]>> = {
  bombo: [60, 60],
  bala: [24, 12],
  graffiti: [150, 150],
  trago: [34, 34],
  botella: [34, 34],
  onda: [120, 230],
  gorro: [64, 32],
  pelota: [34, 34],
  leche: [150, 40],
  panal: [46, 46],
  nube: [150, 70],
  mate: [34, 34],
  agua: [150, 40],
  sismo: [90, 60],
  guante: [56, 48],
}

function anchoDe(pr: ProyectilEstado): number {
  return pr.ancho > 0 && Number.isFinite(pr.ancho) ? pr.ancho : (CAJA[pr.tipo]?.[0] ?? 40)
}
function altoDe(pr: ProyectilEstado): number {
  return pr.alto > 0 && Number.isFinite(pr.alto) ? pr.alto : (CAJA[pr.tipo]?.[1] ?? 40)
}
function dirDe(pr: ProyectilEstado): 1 | -1 {
  if (pr.vx > 0.05) return 1
  if (pr.vx < -0.05) return -1
  return pr.mira < 0 ? -1 : 1
}

// ─── Seguimiento entre cuadros ───────────────────────────────────────────────

const MAX_RASTROS = 24
/** ms que se sigue dibujando algo después de desaparecer (la nube se esfuma, la grieta se apaga). */
const FUNDIDO: Partial<Record<TipoProyectil, number>> = { nube: 450, sismo: 900 }

export class Rastros {
  readonly id = new Int32Array(MAX_RASTROS).fill(-1)
  readonly tipo: (TipoProyectil | null)[] = new Array<TipoProyectil | null>(MAX_RASTROS).fill(null)
  readonly duenio = new Uint8Array(MAX_RASTROS)
  /** x donde nació (la grieta del sismo arranca ahí). */
  readonly x0 = new Float32Array(MAX_RASTROS)
  readonly x = new Float32Array(MAX_RASTROS)
  readonly y = new Float32Array(MAX_RASTROS)
  readonly ancho = new Float32Array(MAX_RASTROS)
  readonly alto = new Float32Array(MAX_RASTROS)
  readonly vx = new Float32Array(MAX_RASTROS)
  readonly vy = new Float32Array(MAX_RASTROS)
  readonly mira = new Int8Array(MAX_RASTROS)
  readonly edad = new Float32Array(MAX_RASTROS)
  readonly visto = new Uint8Array(MAX_RASTROS)
  /** ms desde que desapareció (-1 = sigue vivo). */
  readonly fuera = new Float32Array(MAX_RASTROS).fill(-1)
  readonly estallo = new Uint8Array(MAX_RASTROS)
  /** Reloj propio (ms) para lo periódico: el temblor del sismo. */
  readonly reloj = new Float32Array(MAX_RASTROS)

  vaciar(): void {
    this.id.fill(-1)
    this.tipo.fill(null)
    this.fuera.fill(-1)
  }

  buscar(id: number): number {
    for (let k = 0; k < MAX_RASTROS; k++) if (this.id[k] === id) return k
    return -1
  }

  /** Un lugar libre (o el que más tiempo lleva esfumándose). */
  libre(): number {
    let mejor = -1
    let mayor = -1
    for (let k = 0; k < MAX_RASTROS; k++) {
      if (this.id[k] < 0) return k
      if (this.fuera[k] >= 0 && this.fuera[k] > mayor) {
        mayor = this.fuera[k]
        mejor = k
      }
    }
    return mejor
  }

  soltar(k: number): void {
    this.id[k] = -1
    this.tipo[k] = null
    this.fuera[k] = -1
  }
}

/** ¿Se ve en pantalla? (un proyectil que se va por el borde no estalla contra la nada). */
function enPantalla(x: number): boolean {
  return x > 12 && x < VISTA_ANCHO - 12
}

const FASES_SIN_ESTALLIDOS: ReadonlySet<FasePartida> = new Set<FasePartida>(['presentacion', 'anuncio', 'terminada'])

/** Emite `porSeg` por segundo de algo, escalado por la calidad (entero, con el resto al azar). */
function tasa(E: Escena, porSeg: number, dtS: number): number {
  const n = porSeg * E.densidad * dtS
  const entero = Math.floor(n)
  return entero + (Math.random() < n - entero ? 1 : 0)
}

/**
 * Avanza el seguimiento y suelta las partículas de los proyectiles en vuelo. Va antes de dibujar,
 * una vez por cuadro de pantalla.
 */
export function actualizarArsenal(E: Escena, p: Partida, R: Rastros, dtMs: number): void {
  const dtS = dtMs / 1000
  R.visto.fill(0)
  const lista = p.proyectiles
  for (let i = 0; i < lista.length; i++) {
    const pr = lista[i]
    if (!NUEVOS.has(pr.tipo)) continue
    let k = R.buscar(pr.id)
    if (k < 0) {
      k = R.libre()
      if (k < 0) continue
      R.id[k] = pr.id
      R.tipo[k] = pr.tipo
      R.x0[k] = pr.x
      R.estallo[k] = 0
      R.fuera[k] = -1
      R.reloj[k] = 0
    }
    R.visto[k] = 1
    R.duenio[k] = pr.duenio
    R.x[k] = pr.x
    R.y[k] = pr.y
    R.ancho[k] = anchoDe(pr)
    R.alto[k] = altoDe(pr)
    R.vx[k] = pr.vx
    R.vy[k] = pr.vy
    R.mira[k] = dirDe(pr)
    R.edad[k] = pr.edad
    R.reloj[k] += dtMs
    enVuelo(E, pr, R, k, dtS)
  }
  const sinEstallidos = FASES_SIN_ESTALLIDOS.has(p.fase)
  for (let k = 0; k < MAX_RASTROS; k++) {
    if (R.id[k] < 0) continue
    if (R.fuera[k] < 0) {
      if (R.visto[k]) continue
      if (!sinEstallidos) alDesaparecer(E, R, k)
      const tipo = R.tipo[k]
      if (tipo && FUNDIDO[tipo]) R.fuera[k] = 0
      else R.soltar(k)
      continue
    }
    R.fuera[k] += dtMs
    const tipo = R.tipo[k]
    if (!tipo || R.fuera[k] >= (FUNDIDO[tipo] ?? 0)) R.soltar(k)
  }
}

/** Lo que sueltan mientras viajan. */
function enVuelo(E: Escena, pr: ProyectilEstado, R: Rastros, k: number, dtS: number): void {
  const x = pr.x
  const cy = E.sueloY - pr.y
  const dir = dirDe(pr)
  const w = R.ancho[k]
  const h = R.alto[k]
  switch (pr.tipo) {
    case 'bombo':
      if (Math.random() < dtS * 12 * E.densidad) emitirPolvo(E, x - dir * h * 0.3, E.sueloY, 1, 10, 0.55, -dir)
      break
    case 'graffiti': {
      const estalla = TIEMPOS_PROYECTIL.graffitiEstalla
      if (pr.edad < estalla) {
        for (let n = tasa(E, 10, dtS); n > 0; n--) {
          const a = azar(0, TAU)
          emitirSalpicadura(E, x + Math.cos(a) * w * 0.32, cy + Math.sin(a) * h * 0.26, 1, G_PINTURA, a, 0.4, 30, 90, 0.8)
        }
        if (Math.random() < dtS * 6 * E.densidad) emitirNiebla(E, x + azar(-w, w) * 0.3, cy + azar(-h, h) * 0.25, 0, -20, 22, 0.5, 5)
      } else if (!R.estallo[k]) {
        R.estallo[k] = 1
        estallidoGraffiti(E, x, cy, Math.max(w, 120), Math.max(h, 120))
      }
      break
    }
    case 'trago':
      for (let n = tasa(E, 20, dtS); n > 0; n--) emitirSalpicadura(E, x, cy, 1, G_TRAGO, dir > 0 ? Math.PI * 0.8 : Math.PI * 0.2, 0.5, 20, 70, 0.7)
      break
    case 'botella':
      if (Math.random() < dtS * 3 * E.densidad) emitirBrillos(E, x, cy, 1, 0, 8, 20)
      break
    case 'onda':
      for (let n = tasa(E, 3, dtS); n > 0; n--) emitirNotas(E, x - dir * w * 0.2, cy, 1, h * 0.35, 70, 20)
      if (Math.random() < dtS * 8 * E.densidad) emitirPolvo(E, x + dir * w * 0.4, E.sueloY, 1, 14, 0.7, dir)
      break
    case 'gorro':
      if (Math.random() < dtS * 6 * E.densidad) emitirBrillos(E, x, cy, 1, 6, 14, 10)
      break
    case 'pelota':
      if (Math.random() < dtS * 6 * E.densidad) emitirBrillos(E, x - dir * 12, cy, 1, 2, 8, 10)
      break
    case 'leche':
    case 'agua': {
      const leche = pr.tipo === 'leche'
      const xa = x - dir * w * 0.5
      const paleta = leche ? G_LECHE : G_CALIENTE
      for (let n = tasa(E, leche ? 40 : 28, dtS); n > 0; n--) {
        const f = Math.random()
        emitirSalpicadura(E, xa + dir * w * f, cy + azar(-h, h) * 0.2, 1, paleta, dir > 0 ? -0.25 : Math.PI + 0.25, 0.9, 30, 130, 0.8)
      }
      for (let n = tasa(E, 22, dtS); n > 0; n--) {
        emitirSalpicadura(E, x + dir * w * 0.5, cy, 1, paleta, dir > 0 ? 0.15 : Math.PI - 0.15, 0.8, 80, 240, 1)
      }
      if (!leche) {
        for (let n = tasa(E, 22, dtS); n > 0; n--) {
          emitirNiebla(E, xa + dir * w * Math.random(), cy - h * 0.3, azar(-20, 20), -azar(40, 90), azar(12, 20), azar(0.5, 0.8), 2)
        }
      }
      break
    }
    case 'panal':
      if (Math.random() < dtS * 8 * E.densidad) emitirNiebla(E, x, cy, -dir * 30, -10, 14, 0.5, 4)
      break
    case 'nube':
      if (Math.random() < dtS * 2.5 * E.densidad) emitirBurbujas(E, x + azar(-w, w) * 0.35, cy, 1, 10)
      break
    case 'mate':
      for (let n = tasa(E, 14, dtS); n > 0; n--) emitirSalpicadura(E, x, cy - 8, 1, G_YERBA, dir > 0 ? Math.PI * 0.85 : Math.PI * 0.15, 0.6, 20, 60, 0.6)
      break
    case 'sismo': {
      const frente = x + dir * w * 0.45
      for (let n = tasa(E, 20, dtS); n > 0; n--) emitirPolvo(E, frente, E.sueloY, 1, 16, 1, dir)
      for (let n = tasa(E, 9, dtS); n > 0; n--) emitirTrozos(E, frente, E.sueloY - 4, 1, 0, 0.75, 0, 0.8)
      if (R.reloj[k] >= 120) {
        R.reloj[k] = 0
        temblar(E.cam, 1.6)
      }
      break
    }
    case 'guante':
      for (let n = tasa(E, 46, dtS); n > 0; n--) emitirLlamas(E, x - dir * w * 0.55, cy + azar(-10, 10), 1, -dir * azar(120, 220), -azar(10, 40), 34, 6)
      if (Math.random() < dtS * 8 * E.densidad) emitirChispas(E, x - dir * w * 0.3, cy, 1, -dir, 0.6, 80, 220, PAL_FUEGO, 2)
      break
    default:
      break
  }
}

/** Cuando un proyectil deja de existir: el trago salpica, la botella se rompe, el guante estalla… */
function alDesaparecer(E: Escena, R: Rastros, k: number): void {
  const tipo = R.tipo[k]
  const x = R.x[k]
  if (!tipo || !enPantalla(x)) return
  const cy = E.sueloY - R.y[k]
  const dir = R.mira[k] < 0 ? -1 : 1
  const w = R.ancho[k]
  switch (tipo) {
    case 'bombo':
      emitirPolvo(E, x, E.sueloY, 6, 26, 1.1)
      emitirBrillos(E, x, cy, 3, 1, 20, 50)
      break
    case 'bala':
      emitirChispas(E, x, cy, 6, -dir, 0.9, 120, 320, PAL_ORO, 1.8)
      break
    case 'graffiti':
      if (!R.estallo[k]) estallidoGraffiti(E, x, cy, Math.max(w, 120), Math.max(R.alto[k], 120))
      break
    case 'trago':
      emitirSalpicadura(E, x, cy, 16, G_TRAGO, -Math.PI / 2, 1.2, 90, 260, 1.1)
      emitirNiebla(E, x, cy, 0, -20, 24, 0.5, 5)
      emitirAnillo(E, x, cy, 6, 34, 0.22, PAL_VIOLETA, 3)
      break
    case 'botella':
      // se rompe «sin crudeza»: brillos, vidrio ámbar chiquito y unas gotas
      emitirBrillos(E, x, cy, 5, 0, 16, 60)
      emitirTrozos(E, x, cy, 6, 1, 0.7)
      emitirSalpicadura(E, x, cy, 8, G_AMBAR, -Math.PI / 2, 1.1, 60, 200, 0.9)
      break
    case 'onda':
      emitirAnillo(E, x, cy, 30, 130, 0.35, PAL_MAGENTA, 6)
      emitirNotas(E, x, cy, 4, 40, 110, 24)
      break
    case 'gorro':
      emitirBrillos(E, x, cy, 4, 6, 18, 40)
      break
    case 'pelota':
      emitirBrillos(E, x, cy, 3, 2, 12, 40)
      emitirPolvo(E, x, E.sueloY, 2, 14, 0.7)
      break
    case 'leche':
      emitirSalpicadura(E, x + dir * w * 0.5, cy, 8, G_LECHE, dir > 0 ? 0.2 : Math.PI - 0.2, 0.9, 60, 200, 1)
      break
    case 'agua':
      for (let i = 0; i < 6; i++) emitirNiebla(E, x + dir * w * 0.5, cy, azar(-30, 30), -azar(40, 90), 20, 0.7, 2)
      break
    case 'panal':
      for (let i = 0; i < 6; i++) emitirNiebla(E, x + azar(-20, 20), cy, azar(-60, 60), -azar(10, 50), 22, 0.6, 4)
      emitirPolvo(E, x, E.sueloY, 4, 22, 0.9)
      emitirMoscas(E, x, cy - 10, 2, 1.2)
      break
    case 'mate':
      emitirSalpicadura(E, x, cy, 12, G_YERBA, -Math.PI / 2, 1.2, 70, 220, 0.9)
      emitirSalpicadura(E, x, cy, 4, G_CALIENTE, -Math.PI / 2, 0.9, 60, 160, 1)
      emitirBrillos(E, x, cy, 2, 0, 10, 40)
      break
    case 'sismo':
      emitirTrozos(E, x + dir * w * 0.45, E.sueloY - 6, 6, 0, 0.9)
      emitirPolvo(E, x + dir * w * 0.45, E.sueloY, 8, 34, 1.3)
      break
    case 'guante':
      emitirEstallido(E, x, cy, 110, 0, 0.2)
      emitirLlamas(E, x, cy, 10, 0, -60, 30, 20)
      emitirChispas(E, x, cy, 10, 0, Math.PI, 180, 480, PAL_FUEGO)
      break
    default:
      break
  }
}

/** El graffiti estalla: colores para todos lados, anillos y un temblor. */
export function estallidoGraffiti(E: Escena, x: number, y: number, w: number, h: number): void {
  const r = Math.max(w, h) * 0.5
  emitirEstallido(E, x, y, r * 2.6, 5, 0.34)
  emitirAnillo(E, x, y, r * 0.2, r * 1.25, 0.42, PAL_MAGENTA, 11)
  emitirAnillo(E, x, y, r * 0.1, r * 0.95, 0.36, PAL_AZUL, 7)
  emitirSalpicadura(E, x, y, 34, G_PINTURA, -Math.PI / 2, Math.PI, 180, 600, 1.7)
  emitirBrillos(E, x, y, 10, 3, r * 0.7, 90)
  emitirBrillos(E, x, y, 6, 5, r * 0.5, 70)
  for (let i = 0; i < 6; i++) emitirNiebla(E, x + azar(-r, r) * 0.6, y + azar(-r, r) * 0.5, azar(-90, 90), azar(-90, 20), 38, 0.7, 5)
  temblar(E.cam, 10)
}

// ─── Dibujo ──────────────────────────────────────────────────────────────────

/**
 * Un objeto centrado en (x, y) de mundo: el sprite `efecto` de la hoja del dueño (o del rival) si
 * existe, encajado en `lado` y sin pasar la escala del atlas; si no, la utilería `util` (un
 * cuadrado de `lado` unidades de mundo). Espeja con `mira` y después gira `rot`.
 */
function objeto(
  E: Escena,
  atlas: readonly (AtlasPreparado | null)[],
  duenio: number,
  efecto: EfectoAtlas | null,
  util: NombreUtileria,
  x: number,
  y: number,
  lado: number,
  rot: number,
  mira: number,
  alfa: number,
): void {
  const ctx = E.ctx
  const k = E.cam.esc
  const sx = mira < 0 ? -1 : 1
  const cs = Math.cos(rot)
  const sn = Math.sin(rot)
  const tx = E.cam.tx + k * x
  const ty = E.cam.ty + k * y
  ctx.globalAlpha = alfa
  if (efecto && buscarEfecto(atlas, duenio, efecto) && EF.at && EF.c) {
    const c = EF.c[0]
    const esc = Math.min(EF.at.escala * 1.2, (lado * 0.86) / Math.max(c.w, c.h)) * k
    ctx.imageSmoothingEnabled = esc < 2
    ctx.setTransform(esc * sx * cs, esc * sx * sn, -esc * sn, esc * cs, tx, ty)
    ctx.drawImage(EF.at.imagen, c.x, c.y, c.w, c.h, -c.w / 2, -c.h / 2, c.w, c.h)
    ctx.imageSmoothingEnabled = true
    return
  }
  ctx.imageSmoothingEnabled = true
  ctx.setTransform(k * sx * cs, k * sx * sn, -k * sn, k * cs, tx, ty)
  ctx.drawImage(E.util.de(util), -lado / 2, -lado / 2, lado, lado)
}

/** Sombra en el piso de algo que vuela (más chica y clara cuanto más alto). */
function sombraEnPiso(E: Escena, x: number, yPantalla: number, ancho: number): void {
  const altura = E.sueloY - yPantalla
  const k = acotar(1 - altura / 380, 0.25, 1)
  spriteMundo(E, E.spr.sombra, x, E.sueloY + 2, ancho * k, ancho * 0.22 * k, 0, 0.42 * k)
}

/** Estira una estela (Sprites.estela) desde la cola hasta la cabeza, en modo aditivo. */
function trazarEstela(E: Escena, color: string, xc: number, yc: number, xh: number, yh: number, grosor: number, alfa: number): void {
  const dx = xh - xc
  const dy = yh - yc
  const largo = Math.hypot(dx, dy)
  if (largo < 2) return
  const img = E.spr.estela(color)
  const k = E.cam.esc
  const c = dx / largo
  const s = dy / largo
  const ctx = E.ctx
  ctx.globalCompositeOperation = 'lighter'
  ctx.imageSmoothingEnabled = true
  ctx.setTransform(k * c, k * s, -k * s, k * c, E.cam.tx + k * xc, E.cam.ty + k * yc)
  ctx.globalAlpha = alfa
  ctx.drawImage(img, 0, -grosor / 2, largo, grosor)
  ctx.globalCompositeOperation = 'source-over'
}

function dibujarBombo(E: Escena, pr: ProyectilEstado, atlas: readonly (AtlasPreparado | null)[]): void {
  const d = Math.max(40, Math.min(anchoDe(pr), altoDe(pr)))
  const dir = dirDe(pr)
  const bote = Math.abs(Math.sin(pr.edad * 0.42)) * 3
  const cy = E.sueloY - Math.max(pr.y, d / 2) - bote
  sombraEnPiso(E, pr.x, E.sueloY - d / 2, d * 1.2)
  // líneas de velocidad
  enMundo(E)
  const ctx = E.ctx
  ctx.globalCompositeOperation = 'lighter'
  ctx.strokeStyle = 'rgba(255,230,120,0.55)'
  ctx.lineWidth = 2.2
  ctx.lineCap = 'round'
  ctx.globalAlpha = 0.8
  ctx.beginPath()
  for (let i = 0; i < 3; i++) {
    const oy = cy - d * 0.3 + i * d * 0.3
    const largo = 26 + ((i * 17 + Math.floor(E.ms / 60)) % 3) * 12
    ctx.moveTo(pr.x - dir * d * 0.62, oy)
    ctx.lineTo(pr.x - dir * (d * 0.62 + largo), oy)
  }
  ctx.stroke()
  ctx.globalCompositeOperation = 'source-over'
  objeto(E, atlas, pr.duenio, 'bombo', 'bombo', pr.x, cy, d / 0.94, pr.rot, dir, 1)
}

function dibujarBala(E: Escena, pr: ProyectilEstado): void {
  const dir = dirDe(pr)
  const cy = E.sueloY - pr.y
  const largo = Math.min(120, 20 + pr.edad * 18)
  trazarEstela(E, '#FFB547', pr.x - dir * largo, cy, pr.x - dir * 4, cy, 10, 0.95)
  const ctx = E.ctx
  ctx.globalCompositeOperation = 'lighter'
  spriteMundo(E, E.spr.brillo('#FFD36B'), pr.x, cy, 52, 52, 0, 0.75)
  ctx.globalCompositeOperation = 'source-over'
  objeto(E, [], pr.duenio, null, 'bala', pr.x, cy, 26, 0, dir, 1)
}

function dibujarGraffiti(E: Escena, pr: ProyectilEstado, atlas: readonly (AtlasPreparado | null)[]): void {
  const ctx = E.ctx
  const w = anchoDe(pr)
  const h = altoDe(pr)
  const cy = E.sueloY - pr.y
  const estalla = TIEMPOS_PROYECTIL.graffitiEstalla
  if (pr.edad < estalla) {
    const t = pr.edad / estalla
    const pop = 0.35 + 0.65 * salidaElastica(Math.min(1, pr.edad / 11))
    // cuanto más cerca de estallar, más late y más tiembla
    const late = 1 + (t > 0.55 ? 0.06 * Math.sin(E.s * (18 + t * 30)) : 0)
    const tiembla = t > 0.65 ? (Math.random() - 0.5) * (t - 0.65) * 14 : 0
    const lado = Math.min(w, h) * pop * late
    ctx.globalCompositeOperation = 'lighter'
    spriteMundo(E, E.spr.brillo('#A855F7'), pr.x, cy, lado * 1.8, lado * 1.6, 0, 0.35 + 0.35 * t)
    ctx.globalCompositeOperation = 'source-over'
    objeto(E, atlas, pr.duenio, 'graffiti', 'graffiti', pr.x + tiembla, cy, lado * 1.12, Math.sin(E.s * 3) * 0.05, pr.mira, 0.97)
    // la mira que se cierra: avisa que va a estallar (se esquiva)
    enMundo(E)
    const r = lado * (0.55 + 0.75 * (1 - salidaCubica(t)))
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = 0.25 + 0.6 * t
    ctx.strokeStyle = '#F5D0FE'
    ctx.lineWidth = 2.6
    ctx.setLineDash([10, 8])
    ctx.lineDashOffset = -E.ms * 0.08
    ctx.beginPath()
    ctx.arc(pr.x, cy, r, 0, TAU)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalCompositeOperation = 'source-over'
  } else {
    // el estallido: el área de la explosión (la caja crece unos ticks)
    const f = acotar((pr.edad - estalla) / 10, 0, 1)
    const r = Math.max(w, h) * 0.5
    // el mural se infla y se deshace en pintura
    if (f < 0.5) objeto(E, atlas, pr.duenio, 'graffiti', 'graffiti', pr.x, cy, r * (1.2 + 1.2 * f), f * 0.4, pr.mira, 1 - f * 2)
    ctx.globalCompositeOperation = 'lighter'
    spriteMundo(E, E.spr.brillo('#FFFFFF'), pr.x, cy, r * 1.6, r * 1.6, 0, 0.9 * (1 - f) * (1 - f))
    spriteMundo(E, E.spr.brillo('#F472D0'), pr.x, cy, r * 2.8, r * 2.6, 0, 0.8 * (1 - f))
    spriteMundo(E, E.spr.estallido[5], pr.x, cy, r * (1.6 + 0.6 * f), r * (1.6 + 0.6 * f), f * 0.6, 0.9 * (1 - f * 0.7))
    enMundo(E)
    ctx.globalAlpha = 1 - f
    ctx.lineWidth = 7 * (1 - f) + 1
    ctx.strokeStyle = '#22D3EE'
    ctx.beginPath()
    ctx.arc(pr.x, cy, r * (0.5 + 0.6 * f), 0, TAU)
    ctx.stroke()
    ctx.strokeStyle = '#F472B6'
    ctx.beginPath()
    ctx.arc(pr.x, cy, r * (0.3 + 0.9 * f), 0, TAU)
    ctx.stroke()
    ctx.globalCompositeOperation = 'source-over'
  }
}

/** Trago, botella, mate y pañal: un objeto que vuela en arco girando, con su sombra. */
function dibujarArrojadizo(
  E: Escena,
  pr: ProyectilEstado,
  atlas: readonly (AtlasPreparado | null)[],
  efecto: EfectoAtlas,
  util: NombreUtileria,
  lado: number,
  fantasmas: number,
  rot = pr.rot,
): void {
  const cy = E.sueloY - pr.y
  const dir = dirDe(pr)
  sombraEnPiso(E, pr.x, cy, lado * 0.8)
  // fantasmas atrás: se lee el giro aunque vaya rápido
  for (let g = fantasmas; g >= 1; g--) {
    const atras = g * 1.4
    objeto(E, atlas, pr.duenio, efecto, util, pr.x - pr.vx * atras, cy + pr.vy * atras, lado, rot - dir * g * 0.45, dir, 0.32 / g)
  }
  objeto(E, atlas, pr.duenio, efecto, util, pr.x, cy, lado, rot, dir, 1)
}

function dibujarBotella(E: Escena, pr: ProyectilEstado, atlas: readonly (AtlasPreparado | null)[]): void {
  const lado = Math.max(50, altoDe(pr) * 1.5)
  dibujarArrojadizo(E, pr, atlas, 'botella', 'botella', lado, E.calidad === 'baja' ? 0 : 2)
  // el brillo que gira con el vidrio
  const cy = E.sueloY - pr.y
  const a = pr.rot - Math.PI / 2
  const tam = 16 + 8 * Math.abs(Math.sin(E.s * 9 + pr.id))
  E.ctx.globalCompositeOperation = 'lighter'
  spriteMundo(E, E.spr.estrella[0], pr.x + Math.cos(a) * lado * 0.32, cy + Math.sin(a) * lado * 0.32, tam, tam, E.s * 4, 0.9)
  E.ctx.globalCompositeOperation = 'source-over'
}

function dibujarOnda(E: Escena, pr: ProyectilEstado): void {
  const ctx = E.ctx
  const w = anchoDe(pr)
  const h = altoDe(pr)
  const cy = E.sueloY - pr.y
  const dir = dirDe(pr)
  const nace = salidaCubica(Math.min(1, pr.edad / 12))
  const frente = pr.x + dir * w * 0.5
  ctx.globalCompositeOperation = 'lighter'
  spriteMundo(E, E.spr.brillo('#D946EF'), pr.x, cy, w * 1.6, h * 1.05, 0, 0.42 * nace)
  enMundo(E)
  ctx.lineCap = 'round'
  // arcos «)))» que nacen atrás y avanzan hasta el frente
  const R = h * 0.62
  const a = Math.asin(acotar((h * 0.47) / R, 0.2, 0.98))
  const paso = w * 0.3
  const fase = (E.s * 2.6) % 1
  for (let j = 0; j < 4; j++) {
    const off = (j + 1 - fase) * paso
    const cx = frente - dir * (R + off)
    const vida = 1 - (j + 1 - fase) / 4
    const alfa = acotar(vida * 1.2, 0, 1) * nace
    const a0 = dir > 0 ? -a : Math.PI - a
    const a1 = dir > 0 ? a : Math.PI + a
    ctx.globalAlpha = alfa * 0.55
    ctx.strokeStyle = '#E879F9'
    ctx.lineWidth = 16 * vida + 4
    ctx.beginPath()
    ctx.arc(cx, cy, R, a0, a1)
    ctx.stroke()
    ctx.globalAlpha = alfa
    ctx.strokeStyle = '#FDF4FF'
    ctx.lineWidth = 3.2 * vida + 1
    ctx.stroke()
  }
  // el frente: el arco más fuerte
  ctx.globalAlpha = 0.9 * nace
  ctx.strokeStyle = '#F5D0FE'
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.arc(frente - dir * R, cy, R, dir > 0 ? -a : Math.PI - a, dir > 0 ? a : Math.PI + a)
  ctx.stroke()
  ctx.globalCompositeOperation = 'source-over'
  // notas flotando adentro
  const nota = E.util.de('nota')
  const nota2 = E.util.de('nota2')
  for (let j = 0; j < 3; j++) {
    const nx = frente - dir * w * (0.25 + j * 0.24)
    const ny = cy + Math.sin(E.s * 3.4 + j * 2.1 + pr.id) * h * 0.28
    spriteMundo(E, j === 1 ? nota2 : nota, nx, ny, 26, 26, Math.sin(E.s * 4 + j) * 0.3, 0.95 * nace)
  }
  ctx.globalAlpha = 1
}

function dibujarGorro(E: Escena, pr: ProyectilEstado, atlas: readonly (AtlasPreparado | null)[]): void {
  const ctx = E.ctx
  const lado = Math.max(62, anchoDe(pr) * 1.15)
  const cy = E.sueloY - pr.y
  const dir = dirDe(pr)
  sombraEnPiso(E, pr.x, cy, lado * 0.8)
  // estela roja (de ida o de vuelta, sigue a la velocidad)
  const v = Math.hypot(pr.vx, pr.vy) || 1
  const ux = pr.vx / v
  const uy = -pr.vy / v
  trazarEstela(E, '#FF3B30', pr.x - ux * 90, cy - uy * 90, pr.x - ux * 8, cy - uy * 8, lado * 0.46, 0.85)
  if (E.calidad !== 'baja') {
    for (let g = 2; g >= 1; g--) {
      objeto(E, atlas, pr.duenio, 'gorro', 'gorro', pr.x - pr.vx * g * 1.8, cy + pr.vy * g * 1.8, lado, pr.rot - g * 0.5, 1, 0.22 / g)
    }
  }
  objeto(E, atlas, pr.duenio, 'gorro', 'gorro', pr.x, cy, lado, pr.rot, 1, 1)
  // arcos que giran alrededor: se lee el bumerán
  enMundo(E)
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = 'round'
  ctx.strokeStyle = '#FF8A80'
  ctx.lineWidth = 3
  const giro = E.s * 16 * dir
  for (let j = 0; j < 2; j++) {
    ctx.globalAlpha = 0.75
    ctx.beginPath()
    ctx.ellipse(pr.x, cy, lado * 0.6, lado * 0.24, 0, giro + j * Math.PI, giro + j * Math.PI + 1.3)
    ctx.stroke()
  }
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
}

function dibujarPelota(E: Escena, pr: ProyectilEstado, atlas: readonly (AtlasPreparado | null)[]): void {
  const d = Math.max(32, Math.min(anchoDe(pr), altoDe(pr)) * 1.1)
  const cy = E.sueloY - pr.y
  const dir = dirDe(pr)
  sombraEnPiso(E, pr.x, cy, d)
  trazarEstela(E, '#60A5FA', pr.x - dir * 110, cy, pr.x - dir * d * 0.2, cy, d * 0.8, 0.9)
  if (E.calidad !== 'baja') objeto(E, atlas, pr.duenio, 'pelota', 'pelota', pr.x - pr.vx * 1.6, cy + pr.vy * 1.6, d / 0.92, pr.rot - 0.6 * dir, dir, 0.25)
  objeto(E, atlas, pr.duenio, 'pelota', 'pelota', pr.x, cy, d / 0.92, pr.rot, dir, 1)
}

/** Un chorro (leche o agua): de la mano a la punta, más ancho adelante y ondulando. */
function dibujarChorro(E: Escena, pr: ProyectilEstado, leche: boolean): void {
  const ctx = E.ctx
  const w = anchoDe(pr)
  const h = altoDe(pr)
  const cy = E.sueloY - pr.y
  const dir = dirDe(pr)
  const xa = pr.x - dir * w * 0.5
  const n = 14
  // ondula más hacia la punta y cae un poco (el chorro pesa)
  const ondas = (t: number, lado: number) =>
    Math.sin(E.s * 24 + t * 9 + lado) * h * 0.1 * t + Math.sin(E.s * 13 + t * 5) * h * 0.06 * t + t * t * h * 0.32
  const grosor = (t: number) => h * (0.14 + 0.5 * t - 0.08 * t * t)
  const camino = (escala: number) => {
    ctx.beginPath()
    for (let s = 0; s <= n; s++) {
      const t = s / n
      const px = xa + dir * w * t
      const py = cy - grosor(t) * 0.5 * escala + ondas(t, 0)
      if (s === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    // la punta, redondeada
    const rt = grosor(1) * 0.5 * escala
    ctx.arc(xa + dir * w, cy + ondas(1, 0), rt, dir > 0 ? -Math.PI / 2 : (3 * Math.PI) / 2, Math.PI / 2, dir < 0)
    for (let s = n; s >= 0; s--) {
      const t = s / n
      const px = xa + dir * w * t
      const py = cy + grosor(t) * 0.5 * escala + ondas(t, 1.3) * 0.6
      ctx.lineTo(px, py)
    }
    ctx.closePath()
  }
  enMundo(E)
  ctx.globalAlpha = leche ? 0.97 : 0.82
  ctx.fillStyle = leche ? '#DCE6F1' : '#7FD4FF'
  camino(1)
  ctx.fill()
  ctx.globalAlpha = leche ? 1 : 0.9
  ctx.fillStyle = leche ? '#FFFFFF' : '#E6F8FF'
  camino(0.55)
  ctx.fill()
  // la línea de luz del líquido
  ctx.globalAlpha = 0.85
  ctx.strokeStyle = '#FFFFFF'
  ctx.lineWidth = 1.6
  ctx.lineCap = 'round'
  ctx.beginPath()
  for (let s = 1; s < n; s++) {
    const t = s / n
    const px = xa + dir * w * t
    const py = cy - grosor(t) * 0.22 + ondas(t, 0)
    if (s === 1) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.stroke()
  // brillo de la punta (donde revienta)
  ctx.globalCompositeOperation = 'lighter'
  spriteMundo(E, E.spr.brillo(leche ? '#FFFFFF' : '#9BE6FF'), xa + dir * w, cy + ondas(1, 0), h * 2.2, h * 2.2, 0, leche ? 0.35 : 0.55)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
}

/** La nube del pañal: gas verde que ondula, olor que sube y moscas. */
function pintarNube(E: Escena, x: number, cyCentro: number, w: number, h: number, alfa: number, semilla: number): void {
  if (alfa <= 0.01) return
  const ctx = E.ctx
  const piso = cyCentro + h * 0.5
  const gas = E.spr.nube[4]
  ctx.globalCompositeOperation = 'lighter'
  spriteMundo(E, E.spr.brillo('#A3E635'), x, piso - h * 0.4, w * 1.5, h * 1.8, 0, 0.16 * alfa)
  ctx.globalCompositeOperation = 'source-over'
  const n = E.calidad === 'baja' ? 5 : 7
  for (let j = 0; j < n; j++) {
    const f = j / (n - 1)
    const bx = x + (f - 0.5) * w * 0.86 + Math.sin(E.s * 1.3 + j * 1.9 + semilla) * 6
    const tam = h * (1.1 + 0.5 * ruido(j + semilla * 7)) * (1 + 0.06 * Math.sin(E.s * 2.1 + j))
    const by = piso - tam * 0.32 - Math.abs(f - 0.5) * h * 0.1
    spriteMundo(E, gas, bx, by, tam * 1.25, tam, 0, 0.62 * alfa)
  }
  // olor que sube: tres líneas onduladas
  enMundo(E)
  ctx.lineCap = 'round'
  ctx.strokeStyle = 'rgba(190,240,140,0.75)'
  ctx.lineWidth = 2.4
  for (let j = 0; j < 3; j++) {
    const fase = (E.s * 0.7 + j / 3) % 1
    const lx = x + (j - 1) * w * 0.26
    const ly = piso - h * 0.7 - fase * h * 0.9
    ctx.globalAlpha = alfa * Math.sin(fase * Math.PI) * 0.85
    ctx.beginPath()
    for (let s = 0; s <= 6; s++) {
      const yy = ly - s * 5
      const xx = lx + Math.sin(E.s * 5 + s * 0.9 + j) * 5
      if (s === 0) ctx.moveTo(xx, yy)
      else ctx.lineTo(xx, yy)
    }
    ctx.stroke()
  }
  // moscas dando vueltas
  const mosca = E.util.de('mosca')
  const moscas = E.calidad === 'baja' ? 2 : 4
  for (let j = 0; j < moscas; j++) {
    const v = 2.6 + j * 0.7
    const mx = x + Math.cos(E.s * v + j * 2.4 + semilla) * w * 0.36
    const my = piso - h * 0.8 + Math.sin(E.s * (v + 1.3) + j) * h * 0.4
    const ala = 0.75 + 0.25 * Math.sin(E.s * 70 + j * 3)
    spriteMundo(E, mosca, mx, my, 11, 11 * ala, Math.cos(E.s * v + j * 2.4 + semilla) > 0 ? 0 : Math.PI, alfa)
  }
  ctx.globalAlpha = 1
}

/** La grieta del sismo desde donde nació hasta la onda (en el piso, detrás de los luchadores). */
function pintarGrieta(E: Escena, x0: number, x1: number, alfa: number): void {
  if (alfa <= 0.01 || Math.abs(x1 - x0) < 4) return
  const ctx = E.ctx
  const y = E.sueloY + 3
  const desde = Math.min(x0, x1)
  const hasta = Math.max(x0, x1)
  enMundo(E)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'miter'
  const trazo = () => {
    ctx.beginPath()
    const paso = 16
    let primero = true
    for (let px = Math.floor(desde / paso) * paso; px <= hasta + paso; px += paso) {
      const cx = acotar(px, desde, hasta)
      const cyy = y + (ruido(Math.floor(px / paso) * 13 + 7) - 0.5) * 7
      if (primero) {
        ctx.moveTo(cx, cyy)
        primero = false
      } else ctx.lineTo(cx, cyy)
    }
  }
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = 0.35 * alfa
  ctx.strokeStyle = '#FF9A4A'
  ctx.lineWidth = 9
  trazo()
  ctx.stroke()
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 0.95 * alfa
  ctx.strokeStyle = '#1B130C'
  ctx.lineWidth = 3.6
  trazo()
  ctx.stroke()
  ctx.globalAlpha = 0.55 * alfa
  ctx.strokeStyle = '#F2D7B0'
  ctx.lineWidth = 1
  ctx.save()
  ctx.translate(0, -2.2)
  trazo()
  ctx.stroke()
  ctx.restore()
  ctx.globalAlpha = 1
}

/** El degradé del lomo del sismo, cacheado (cambia sólo si cambia el alto de la caja o el piso). */
const TIERRA = { g: null as CanvasGradient | null, ctx: null as CanvasRenderingContext2D | null, piso: 0, h: 0 }
function degradeTierra(ctx: CanvasRenderingContext2D, piso: number, h: number): CanvasGradient {
  const hh = Math.round(h)
  if (!TIERRA.g || TIERRA.ctx !== ctx || TIERRA.piso !== piso || TIERRA.h !== hh) {
    const g = ctx.createLinearGradient(0, piso - hh * 0.62, 0, piso)
    g.addColorStop(0, '#B39572')
    g.addColorStop(0.45, '#7A6248')
    g.addColorStop(1, '#3E3022')
    TIERRA.g = g
    TIERRA.ctx = ctx
    TIERRA.piso = piso
    TIERRA.h = hh
  }
  return TIERRA.g
}

function dibujarSismo(E: Escena, pr: ProyectilEstado): void {
  const ctx = E.ctx
  const w = anchoDe(pr)
  const h = altoDe(pr)
  const dir = dirDe(pr)
  const piso = E.sueloY
  const frente = pr.x + dir * w * 0.3
  const sube = 0.85 + 0.15 * Math.sin(E.s * 32)
  // el lomo de tierra que corre
  enMundo(E)
  ctx.beginPath()
  ctx.moveTo(pr.x - dir * w * 0.55, piso + 2)
  ctx.quadraticCurveTo(pr.x - dir * w * 0.1, piso - h * 0.35 * sube, frente, piso - h * 0.62 * sube)
  ctx.lineTo(frente + dir * w * 0.12, piso - h * 0.5 * sube)
  ctx.quadraticCurveTo(pr.x + dir * w * 0.5, piso - h * 0.2, pr.x + dir * w * 0.62, piso + 2)
  ctx.closePath()
  ctx.globalAlpha = 1
  ctx.fillStyle = degradeTierra(ctx, piso, h)
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = '#2E2216'
  ctx.stroke()
  // el filo de arriba, iluminado
  ctx.beginPath()
  ctx.moveTo(pr.x - dir * w * 0.3, piso - h * 0.25 * sube)
  ctx.quadraticCurveTo(pr.x - dir * w * 0.05, piso - h * 0.45 * sube, frente, piso - h * 0.6 * sube)
  ctx.strokeStyle = 'rgba(255,236,200,0.7)'
  ctx.lineWidth = 1.6
  ctx.stroke()
  ctx.globalCompositeOperation = 'lighter'
  spriteMundo(E, E.spr.brillo('#FFB46B'), frente, piso - h * 0.3, w * 1.2, h * 1.3, 0, 0.32)
  ctx.globalCompositeOperation = 'source-over'
  // piedras que saltan en el frente
  for (let j = 0; j < 3; j++) {
    const fase = (E.s * 2.4 + j / 3 + pr.id * 0.37) % 1
    const ry = piso - Math.sin(fase * Math.PI) * h * 0.95 - 6
    const rx = frente + dir * (j - 1) * w * 0.18
    const tam = 15 + j * 3
    spriteMundo(E, E.util.de(j === 0 ? 'roca0' : j === 1 ? 'roca1' : 'roca2'), rx, ry, tam, tam, fase * 6 + j, 1 - fase * fase * fase)
  }
}

function dibujarGuante(E: Escena, pr: ProyectilEstado, atlas: readonly (AtlasPreparado | null)[]): void {
  const ctx = E.ctx
  const lado = Math.max(58, altoDe(pr) * 1.3)
  const cy = E.sueloY - pr.y
  const dir = dirDe(pr)
  ctx.globalCompositeOperation = 'lighter'
  spriteMundo(E, E.spr.brillo('#FF7A1A'), pr.x - dir * lado * 0.3, cy, lado * 2.4, lado * 1.8, 0, 0.6)
  ctx.globalCompositeOperation = 'source-over'
  // llamas hacia atrás (la punta apunta para donde viene), opacas: se leen sobre cualquier fondo
  const llama = E.util.de('llama')
  const rotLlama = dir > 0 ? -Math.PI / 2 : Math.PI / 2
  const n = E.calidad === 'baja' ? 3 : 5
  for (let j = 0; j < n; j++) {
    const titila = 0.78 + 0.22 * Math.sin(E.s * 31 + j * 1.7)
    const largo = (56 + (j % 3) * 16) * titila
    const ox = -dir * (lado * 0.26 + largo * 0.36)
    const oy = (j - (n - 1) / 2) * lado * 0.12
    spriteMundo(E, llama, pr.x + ox, cy + oy, largo * 0.66, largo, rotLlama + (j - (n - 1) / 2) * 0.14, 0.95)
  }
  objeto(E, atlas, pr.duenio, 'guante', 'guante', pr.x, cy, lado, Math.sin(E.s * 20) * 0.06, dir, 1)
}

/** Lo que va en el piso DETRÁS de los luchadores: la grieta del sismo (también la que se apaga). */
export function dibujarArsenalFondo(E: Escena, R: Rastros): void {
  for (let k = 0; k < MAX_RASTROS; k++) {
    if (R.id[k] < 0 || R.tipo[k] !== 'sismo') continue
    const alfa = R.fuera[k] < 0 ? 1 : 1 - R.fuera[k] / (FUNDIDO.sismo ?? 900)
    pintarGrieta(E, R.x0[k], R.x[k] + (R.mira[k] < 0 ? -1 : 1) * R.ancho[k] * 0.3, alfa)
  }
  E.ctx.globalAlpha = 1
}

/** Los proyectiles del elenco nuevo (y las nubes que se están esfumando). */
export function dibujarArsenal(E: Escena, p: Partida, R: Rastros, atlas: readonly (AtlasPreparado | null)[]): void {
  const ctx = E.ctx
  const lista = p.proyectiles
  // nubes primero: el gas queda debajo de lo que vuela
  for (let i = 0; i < lista.length; i++) {
    const pr = lista[i]
    if (pr.tipo !== 'nube') continue
    pintarNube(E, pr.x, E.sueloY - pr.y, anchoDe(pr), altoDe(pr), salidaCubica(Math.min(1, pr.edad / 14)), pr.id)
  }
  for (let k = 0; k < MAX_RASTROS; k++) {
    if (R.id[k] < 0 || R.fuera[k] < 0 || R.tipo[k] !== 'nube') continue
    const alfa = 1 - R.fuera[k] / (FUNDIDO.nube ?? 450)
    pintarNube(E, R.x[k], E.sueloY - R.y[k] - R.fuera[k] * 0.02, R.ancho[k], R.alto[k], alfa, R.id[k])
  }
  for (let i = 0; i < lista.length; i++) {
    const pr = lista[i]
    switch (pr.tipo) {
      case 'bombo':
        dibujarBombo(E, pr, atlas)
        break
      case 'bala':
        dibujarBala(E, pr)
        break
      case 'graffiti':
        dibujarGraffiti(E, pr, atlas)
        break
      case 'trago':
        dibujarArrojadizo(E, pr, atlas, 'vaso', 'vaso', Math.max(44, altoDe(pr) * 1.4), E.calidad === 'baja' ? 0 : 1)
        break
      case 'botella':
        dibujarBotella(E, pr, atlas)
        break
      case 'onda':
        dibujarOnda(E, pr)
        break
      case 'gorro':
        dibujarGorro(E, pr, atlas)
        break
      case 'pelota':
        dibujarPelota(E, pr, atlas)
        break
      case 'leche':
        dibujarChorro(E, pr, true)
        break
      case 'agua':
        dibujarChorro(E, pr, false)
        break
      case 'panal':
        // el pañal se hamaca en vez de dar vueltas: de costado parecía un embudo
        dibujarArrojadizo(E, pr, atlas, 'panal', 'panal', Math.max(52, altoDe(pr) * 1.35), 0, Math.sin(pr.edad * 0.22) * 0.5)
        break
      case 'mate':
        dibujarArrojadizo(E, pr, atlas, 'mate', 'mate', Math.max(44, altoDe(pr) * 1.4), E.calidad === 'baja' ? 0 : 1)
        break
      case 'sismo':
        dibujarSismo(E, pr)
        break
      case 'guante':
        dibujarGuante(E, pr, atlas)
        break
      default:
        break
    }
  }
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.imageSmoothingEnabled = true
}
