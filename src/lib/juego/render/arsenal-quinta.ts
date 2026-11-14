/**
 * Proyectiles de la quinta tanda (14/nov): las cartas de Chino, la mirada de los Lentes de Fran, las
 * herramientas y la nube del Spray de Leo, las columnas del Terremoto de Código de Nacho, la pelota de
 * pádel de Nehuen, las púas de Nico M. (en vuelo y clavadas en el piso) y el monopatín de Tony. Los de
 * antes siguen en proyectiles.ts (Simón y Chipi) y arsenal.ts (el elenco de 13).
 *
 * De dónde sale cada dibujo: el sprite de `atlas.efectos` de la hoja (buscado en el atlas del dueño y
 * después en el del otro: un tiro devuelto por Nehuen sigue usando el sprite de su autor) y si no, la
 * utilería dibujada a mano. Lo caro va precalculado: la nube del Spray son dos lienzos de la utilería
 * que se estiran a la caja del chorro, y la franja de código del Terremoto es un lienzo que se desplaza.
 *
 * `SeguimientoQuinta` sigue a CADA proyectil de la partida por su id (también los de antes): sabe a
 * quién pertenecía al nacer (los que devuelve el Smash de Nehuen cambian de dueño y llevan la estela
 * lima), cuándo se clavó una púa (titila los últimos ticks de su trampa, que se leen del kit), cuándo
 * reventó una columna y cuándo desapareció cada uno. Arreglos de tamaño fijo: sin basura por cuadro.
 *
 * (x, y) del proyectil = centro de su caja; y = altura del centro sobre el piso (contrato).
 */
import type { FasePartida, IdPersonaje, Partida, ProyectilEstado, TipoProyectil } from '../tipos'
import { TIEMPOS_PROYECTIL, VISTA_ANCHO } from '../tipos'
import { objeto, sombraEnPiso, trazarEstela } from './arsenal'
import { empujarZoom, temblar } from './camara'
import { enMundo, spriteMundo, type Escena } from './escena'
import { rangoMonopatin, vidaTrampa } from './kit'
import type { AtlasPreparado } from './luchadores'
import {
  emitirAnillo,
  emitirBrillos,
  emitirChispas,
  emitirEstallido,
  emitirNiebla,
  emitirObjetos,
  emitirPolvo,
  PAL_AZUL,
  PAL_BLANCO,
  PAL_HIELO,
  PAL_ORO,
  PAL_ROJO,
  PAL_VIOLETA,
  TROZO_DIGITO,
  TROZO_NAIPE,
  TROZO_ROCA_CIAN,
} from './particulas'
import { acotar, azar, salidaCubica, TAU } from './util'

/** Los tipos que dibuja este módulo. */
const TIPOS: ReadonlySet<TipoProyectil> = new Set<TipoProyectil>([
  'carta',
  'hipnosis',
  'secador',
  'aerosol',
  'codigo',
  'pelotita',
  'espina',
  'monopatin',
])

export function esDeLaQuinta(tipo: TipoProyectil): boolean {
  return TIPOS.has(tipo)
}

/** Color de la estela de un tiro devuelto: el de Nehuen. */
const LIMA = '#C8F542'

const CAJA: Partial<Record<TipoProyectil, readonly [number, number]>> = {
  carta: [34, 26],
  hipnosis: [36, 54],
  secador: [40, 30],
  aerosol: [40, 70],
  codigo: [40, 240],
  pelotita: [32, 32],
  espina: [28, 34],
  monopatin: [112, 60],
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

/** Ángulo de dibujo de algo que vuela recto según su velocidad (el sprite mira a la derecha y se espeja con `dir`). */
function anguloDeVuelo(vx: number, vy: number, dir: number): number {
  return Math.atan2(-vy * dir, Math.max(0.01, Math.abs(vx)))
}

// ─── Seguimiento entre cuadros ───────────────────────────────────────────────

const MAX = 32

export class SeguimientoQuinta {
  readonly id = new Int32Array(MAX).fill(-1)
  readonly tipo: (TipoProyectil | null)[] = new Array<TipoProyectil | null>(MAX).fill(null)
  /** El dueño al nacer: si cambia, lo devolvió el Smash de Nehuen. */
  readonly duenio0 = new Uint8Array(MAX)
  readonly duenio = new Uint8Array(MAX)
  readonly x = new Float32Array(MAX)
  readonly y = new Float32Array(MAX)
  readonly vx = new Float32Array(MAX)
  readonly vy = new Float32Array(MAX)
  readonly ancho = new Float32Array(MAX)
  readonly alto = new Float32Array(MAX)
  readonly edad = new Float32Array(MAX)
  readonly visto = new Uint8Array(MAX)
  /** La edad (ticks) con la que se clavó una púa; −1 = no está clavada. */
  readonly clavada = new Float32Array(MAX).fill(-1)
  /** La columna de código ya reventó. */
  readonly estallo = new Uint8Array(MAX)
  /** ms desde que lo devolvieron (−1 = no). */
  readonly devuelto = new Float32Array(MAX).fill(-1)
  /** Personaje del dueño al nacer (las púas leen su trampa del kit de su autor). */
  readonly autor: (IdPersonaje | null)[] = new Array<IdPersonaje | null>(MAX).fill(null)

  vaciar(): void {
    this.id.fill(-1)
    this.tipo.fill(null)
    this.autor.fill(null)
    this.clavada.fill(-1)
    this.devuelto.fill(-1)
  }

  buscar(id: number): number {
    for (let k = 0; k < MAX; k++) if (this.id[k] === id) return k
    return -1
  }

  libre(): number {
    for (let k = 0; k < MAX; k++) if (this.id[k] < 0) return k
    return -1
  }

  soltar(k: number): void {
    this.id[k] = -1
    this.tipo[k] = null
    this.autor[k] = null
    this.clavada[k] = -1
    this.devuelto[k] = -1
  }

  /** ¿El proyectil `id` es un tiro devuelto? (para pintarle la estela lima a los de antes también). */
  devueltoPor(id: number): boolean {
    const k = this.buscar(id)
    return k >= 0 && this.devuelto[k] >= 0
  }
}

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

/** Avanza el seguimiento y suelta las partículas de los proyectiles en vuelo (una vez por cuadro). */
export function actualizarQuintaProyectiles(E: Escena, p: Partida, S: SeguimientoQuinta, dtMs: number): void {
  const dtS = dtMs / 1000
  S.visto.fill(0)
  const lista = p.proyectiles
  for (let i = 0; i < lista.length; i++) {
    const pr = lista[i]
    let k = S.buscar(pr.id)
    if (k < 0) {
      k = S.libre()
      if (k < 0) continue
      S.id[k] = pr.id
      S.tipo[k] = pr.tipo
      S.duenio0[k] = pr.duenio
      S.autor[k] = p.luchadores[pr.duenio]?.id ?? null
      S.clavada[k] = -1
      S.estallo[k] = 0
      S.devuelto[k] = -1
    }
    S.visto[k] = 1
    S.duenio[k] = pr.duenio
    S.x[k] = pr.x
    S.y[k] = pr.y
    S.vx[k] = pr.vx
    S.vy[k] = pr.vy
    S.ancho[k] = anchoDe(pr)
    S.alto[k] = altoDe(pr)
    S.edad[k] = pr.edad
    if (pr.duenio !== S.duenio0[k]) S.devuelto[k] = S.devuelto[k] < 0 ? 0 : S.devuelto[k] + dtMs
    if (pr.plantado && S.clavada[k] < 0) S.clavada[k] = pr.edad
    if (TIPOS.has(pr.tipo)) enVuelo(E, pr, S, k, dtS)
  }
  const sinEstallidos = FASES_SIN_ESTALLIDOS.has(p.fase)
  for (let k = 0; k < MAX; k++) {
    if (S.id[k] < 0 || S.visto[k]) continue
    const tipo = S.tipo[k]
    if (tipo && TIPOS.has(tipo) && !sinEstallidos) alDesaparecer(E, S, k)
    S.soltar(k)
  }
}

/** Lo que sueltan mientras viajan. */
function enVuelo(E: Escena, pr: ProyectilEstado, S: SeguimientoQuinta, k: number, dtS: number): void {
  const x = pr.x
  const cy = E.sueloY - pr.y
  const dir = dirDe(pr)
  switch (pr.tipo) {
    case 'carta':
      if (Math.random() < dtS * 14 * E.densidad) emitirBrillos(E, x - dir * 14, cy, 1, 6, 6, 10)
      break
    case 'hipnosis':
      if (Math.random() < dtS * 16 * E.densidad) emitirBrillos(E, x + azar(-1, 1) * anchoDe(pr) * 0.4, cy + azar(-1, 1) * 20, 1, 3, 4, 20)
      break
    case 'secador':
      if (Math.random() < dtS * 8 * E.densidad) emitirBrillos(E, x, cy, 1, 0, 8, 6)
      break
    case 'aerosol': {
      // el frente de la nube se abre en niebla blanca
      const w = anchoDe(pr)
      const h = altoDe(pr)
      for (let n = tasa(E, 26, dtS); n > 0; n--) {
        emitirNiebla(E, x + dir * w * azar(0.2, 0.5), cy + azar(-0.4, 0.4) * h, dir * azar(30, 110), azar(-30, 20), azar(16, 28), azar(0.35, 0.6), 1)
      }
      break
    }
    case 'codigo': {
      const espera = TIEMPOS_PROYECTIL.codigoEstalla
      if (pr.edad < espera) {
        // los ceros y unos que suben de la franja
        for (let n = tasa(E, 22, dtS); n > 0; n--) {
          const h = altoDe(pr) * (0.25 + 0.75 * salidaCubica(pr.edad / espera))
          emitirObjetos(E, x + azar(-14, 14), E.sueloY - azar(10, h), 1, TROZO_DIGITO, 0, -azar(60, 140), 10, -60, 13, 0.55)
        }
      } else if (!S.estallo[k]) {
        S.estallo[k] = 1
        estallidoCodigo(E, x, Math.max(anchoDe(pr), 60), altoDe(pr))
      }
      break
    }
    case 'pelotita':
      if (Math.random() < dtS * 10 * E.densidad) emitirBrillos(E, x - dir * 10, cy, 1, 4, 6, 8)
      break
    case 'espina':
      if (!pr.plantado && Math.random() < dtS * 12 * E.densidad) emitirBrillos(E, x, cy, 1, 1, 6, 6)
      break
    case 'monopatin': {
      // chispas azules debajo de la tabla: más cuanto más rápido va
      const r = rangoMonopatin()
      const f = acotar((Math.abs(pr.vx) - r.desde) / (r.hasta - r.desde), 0, 1)
      for (let n = tasa(E, 6 + 30 * f, dtS); n > 0; n--) {
        emitirChispas(E, x - dir * azar(10, 50), cy + altoDe(pr) * 0.3, 1, -dir, 0.5, 120, 260 + 260 * f, PAL_AZUL, 1.8)
      }
      if (Math.random() < dtS * (4 + 10 * f) * E.densidad) emitirPolvo(E, x - dir * 30, E.sueloY, 1, 10, 0.7, -dir)
      break
    }
    default:
      break
  }
}

/** La columna de código revienta el piso: piedras oscuras con borde cian, un destello y el temblor. */
function estallidoCodigo(E: Escena, x: number, w: number, h: number): void {
  const piso = E.sueloY
  emitirObjetos(E, x, piso - 10, 10, TROZO_ROCA_CIAN, 0, -380, 220, 1250, 18, 1.1)
  emitirPolvo(E, x, piso, 8, w * 0.6, 1.3)
  emitirAnillo(E, x, piso - 6, 10, w * 1.4, 0.3, PAL_AZUL, 5)
  emitirChispas(E, x, piso - h * 0.3, 10, 0, Math.PI, 160, 480, PAL_HIELO, 1.8)
  emitirBrillos(E, x, piso - h * 0.5, 4, 2, w * 0.5, 120)
  temblar(E.cam, 7)
  empujarZoom(E.cam, 0.012)
}

/** Cuando un proyectil de la quinta tanda deja de existir en pantalla. */
function alDesaparecer(E: Escena, S: SeguimientoQuinta, k: number): void {
  const tipo = S.tipo[k]
  const x = S.x[k]
  if (!tipo || !enPantalla(x)) return
  const cy = E.sueloY - S.y[k]
  const dir = S.vx[k] < 0 ? -1 : 1
  switch (tipo) {
    case 'carta':
      emitirChispas(E, x, cy, 5, -dir, 0.8, 100, 260, PAL_ROJO, 1.6)
      emitirObjetos(E, x, cy, 2, TROZO_NAIPE, -dir * 60, -160, 90, 900, 14, 0.7)
      break
    case 'hipnosis':
      emitirAnillo(E, x, cy, 10, 46, 0.28, PAL_VIOLETA, 3)
      emitirBrillos(E, x, cy, 3, 3, 14, 30)
      break
    case 'secador':
      emitirChispas(E, x, cy, 6, -dir, 0.7, 120, 320, PAL_BLANCO, 1.4)
      break
    case 'aerosol':
      for (let i = 0; i < 4; i++) emitirNiebla(E, x + azar(-40, 40), cy + azar(-30, 30), azar(-20, 20), -azar(10, 40), 26, 0.6, 1)
      break
    case 'codigo':
      emitirBrillos(E, x, E.sueloY - S.alto[k] * 0.5, 2, 2, 20, 60)
      break
    case 'pelotita':
      emitirBrillos(E, x, cy, 4, 4, 12, 40)
      emitirPolvo(E, x, E.sueloY, 2, 14, 0.7)
      break
    case 'espina': {
      const clavada = S.clavada[k]
      const autor = S.autor[k] ?? 'nico_m'
      if (clavada >= 0 && S.edad[k] - clavada >= vidaTrampa(autor) - 2) {
        // se apagó sola: unos brillitos dorados que suben
        emitirBrillos(E, x, E.sueloY - 10, 4, 1, 12, 50)
      } else {
        // la pisaron (el golpe pone el estallido) o se deshizo con las de su tirada
        emitirChispas(E, x, clavada >= 0 ? E.sueloY - 12 : cy, 8, 0, Math.PI, 120, 360, PAL_ORO, 1.6)
        emitirBrillos(E, x, clavada >= 0 ? E.sueloY - 12 : cy, 3, 1, 10, 40)
      }
      break
    }
    case 'monopatin':
      emitirEstallido(E, x, cy, 110, 1, 0.2)
      emitirChispas(E, x, cy, 10, 0, Math.PI, 160, 460, PAL_AZUL, 2)
      break
    default:
      break
  }
}

// ─── Texturas precalculadas ─────────────────────────────────────────────────

/** px de textura por unidad de mundo de las franjas de código. */
const RES_CODIGO = 2
const COLUMNA = { w: 40, h: 400 }
const SUELO = { w: 300, h: 24 }

/** Ceros y unos en columnas, con brillo desparejo (pintado una vez; la franja se desplaza encima). */
function pintarCodigo(g: CanvasRenderingContext2D, anchoU: number, altoU: number, horizontal: boolean): void {
  const W = anchoU * RES_CODIGO
  const H = altoU * RES_CODIGO
  const paso = 13 * RES_CODIGO * 0.62
  g.font = `700 ${Math.round(paso * 1.05)}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  let semilla = horizontal ? 77 : 13
  const azarFijo = () => {
    semilla = (semilla * 1103515245 + 12345) & 0x7fffffff
    return semilla / 0x7fffffff
  }
  if (horizontal) {
    for (let x = paso * 0.5; x < W; x += paso * 0.78) {
      for (let y = paso * 0.6; y < H; y += paso) {
        const a = azarFijo()
        g.fillStyle = a > 0.82 ? 'rgba(224,251,255,0.95)' : `rgba(34,211,238,${(0.35 + a * 0.55).toFixed(2)})`
        g.fillText(azarFijo() > 0.5 ? '1' : '0', x, y)
      }
    }
    return
  }
  for (let x = paso * 0.62; x < W; x += paso * 1.15) {
    for (let y = paso * 0.5; y < H; y += paso) {
      const a = azarFijo()
      g.fillStyle = a > 0.85 ? 'rgba(224,251,255,0.95)' : `rgba(34,211,238,${(0.3 + a * 0.6).toFixed(2)})`
      g.fillText(azarFijo() > 0.5 ? '1' : '0', x, y)
    }
  }
}

function texturaColumna(E: Escena): HTMLCanvasElement {
  return E.util.propio('codigo-columna', COLUMNA.w * RES_CODIGO, COLUMNA.h * RES_CODIGO, (g) => pintarCodigo(g, COLUMNA.w, COLUMNA.h, false))
}

export function texturaSueloCodigo(E: Escena): HTMLCanvasElement {
  return E.util.propio('codigo-suelo', SUELO.w * RES_CODIGO, SUELO.h * RES_CODIGO, (g) => pintarCodigo(g, SUELO.w, SUELO.h, true))
}

/**
 * Una franja vertical de la textura de código, desplazada `desplazamiento` unidades hacia arriba (se
 * repite: dos pedazos cuando da la vuelta), entre `arriba` y `abajo` (mundo-pantalla).
 */
function franjaVertical(E: Escena, tex: HTMLCanvasElement, x: number, w: number, arriba: number, abajo: number, desplazamiento: number, alfa: number): void {
  const alto = abajo - arriba
  if (alto < 1 || alfa <= 0.01) return
  const ctx = E.ctx
  enMundo(E)
  ctx.globalAlpha = alfa
  const texH = COLUMNA.h
  let desde = ((desplazamiento % texH) + texH) % texH
  let y = arriba
  let resta = alto
  while (resta > 0.5) {
    const tramo = Math.min(resta, texH - desde)
    ctx.drawImage(tex, 0, desde * RES_CODIGO, tex.width, tramo * RES_CODIGO, x - w / 2, y, w, tramo)
    y += tramo
    resta -= tramo
    desde = 0
  }
}

/**
 * El código que corre por el piso desde las manos de Nacho (el Terremoto): una franja horizontal
 * de `desde` a `hasta` (x de mundo) apoyada en el piso, desplazándose hacia adelante.
 */
export function codigoEnElPiso(E: Escena, desde: number, hasta: number, alfa: number): void {
  const largo = Math.abs(hasta - desde)
  if (largo < 4 || alfa <= 0.01) return
  const tex = texturaSueloCodigo(E)
  const ctx = E.ctx
  const dir = hasta >= desde ? 1 : -1
  const piso = E.sueloY
  enMundo(E)
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = alfa
  const texW = SUELO.w
  const alto = 14
  let desdeTex = (((-E.ms * 0.32) % texW) + texW) % texW
  let x = 0
  while (x < largo - 0.5) {
    const tramo = Math.min(largo - x, texW - desdeTex)
    const x0 = dir > 0 ? desde + x : desde - x - tramo
    ctx.drawImage(tex, desdeTex * RES_CODIGO, 0, tramo * RES_CODIGO, tex.height, x0, piso - alto * 0.7, tramo, alto)
    x += tramo
    desdeTex = 0
  }
  spriteMundo(E, E.spr.brillo('#22D3EE'), (desde + hasta) / 2, piso - 2, largo * 1.1, 26, 0, 0.35 * alfa)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
}

// ─── Dibujo ──────────────────────────────────────────────────────────────────

function dibujarCarta(E: Escena, pr: ProyectilEstado, atlas: readonly (AtlasPreparado | null)[]): void {
  const cy = E.sueloY - pr.y
  const dir = dirDe(pr)
  const ctx = E.ctx
  trazarEstela(E, '#BE123C', pr.x - dir * 80, cy - pr.vy * 6, pr.x - dir * 6, cy, 14, 0.85)
  ctx.globalCompositeOperation = 'lighter'
  spriteMundo(E, E.spr.brillo('#FF4D6D'), pr.x, cy, 62, 62, 0, 0.55)
  ctx.globalCompositeOperation = 'source-over'
  // 44: con 36 la carta se perdía al lado del luchador en un celular
  objeto(E, atlas, pr.duenio, 'carta', 'naipe', pr.x, cy, 44, pr.rot, dir, 1)
}

function dibujarHipnosis(E: Escena, pr: ProyectilEstado): void {
  const ctx = E.ctx
  const cy = E.sueloY - pr.y
  const w = anchoDe(pr)
  const h = altoDe(pr)
  const nace = salidaCubica(Math.min(1, pr.edad / 6))
  ctx.globalCompositeOperation = 'lighter'
  spriteMundo(E, E.spr.brillo('#A855F7'), pr.x, cy, w * 1.9, h * 1.5, 0, 0.5 * nace)
  enMundo(E)
  for (let j = 0; j < 3; j++) {
    const fase = (E.s * 2.4 + j / 3) % 1
    const s = 0.3 + 0.7 * fase
    ctx.globalAlpha = (1 - fase) * 0.95 * nace
    ctx.strokeStyle = j % 2 === 0 ? '#C084FC' : '#67E8F9'
    ctx.lineWidth = 4.2 * (1 - fase * 0.5)
    ctx.beginPath()
    ctx.ellipse(pr.x, cy, Math.max(1, w * 0.5 * s), Math.max(1, h * 0.5 * s), 0, 0, TAU)
    ctx.stroke()
  }
  // el centro: el brillo de la mirada
  ctx.globalAlpha = 0.9 * nace
  ctx.fillStyle = '#F5E8FF'
  ctx.beginPath()
  ctx.ellipse(pr.x, cy, 5, 3.2, 0, 0, TAU)
  ctx.fill()
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
}

function dibujarSecador(E: Escena, pr: ProyectilEstado, atlas: readonly (AtlasPreparado | null)[]): void {
  const ctx = E.ctx
  const cy = E.sueloY - pr.y
  const dir = dirDe(pr)
  const rot = anguloDeVuelo(pr.vx, pr.vy, dir)
  sombraEnPiso(E, pr.x, cy, 40)
  // líneas de velocidad grises, en la dirección del vuelo
  const v = Math.hypot(pr.vx, pr.vy) || 1
  const ux = pr.vx / v
  const uy = -pr.vy / v
  enMundo(E)
  ctx.globalCompositeOperation = 'lighter'
  ctx.strokeStyle = 'rgba(214,222,232,0.6)'
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.globalAlpha = 0.85
  ctx.beginPath()
  for (let i = 0; i < 3; i++) {
    const off = (i - 1) * 9
    const largo = 26 + ((i * 13 + Math.floor(E.ms / 55)) % 3) * 12
    const bx = pr.x - ux * 26 - uy * off
    const by = cy - uy * 26 + ux * off
    ctx.moveTo(bx, by)
    ctx.lineTo(bx - ux * largo, by - uy * largo)
  }
  ctx.stroke()
  ctx.globalCompositeOperation = 'source-over'
  // secador o tijera según el id (la del medio de la ráfaga es la tijera)
  const efecto = pr.id % 2 === 1 ? 'tijera' : 'secador'
  objeto(E, atlas, pr.duenio, efecto, 'secador', pr.x, cy, 62, rot + Math.sin(pr.edad * 0.9) * 0.08, dir, 1)
}

function dibujarAerosol(E: Escena, pr: ProyectilEstado): void {
  const w = anchoDe(pr)
  const h = altoDe(pr)
  const cy = E.sueloY - pr.y
  const dir = pr.mira < 0 ? -1 : 1
  const fin = pr.edad > 14 ? acotar(1 - (pr.edad - 14) / 7, 0, 1) : 1
  const ctx = E.ctx
  const respira = Math.sin(E.s * 9 + pr.id) * 0.04
  ctx.globalCompositeOperation = 'source-over'
  // la nube grande (opaca: se ve sobre pisos claros) y adentro una segunda que respira
  spriteMundo(E, E.util.de('nube_spray0'), pr.x + dir * w * 0.04, cy, w * 1.2, h * 1.18, 0, 0.92 * fin)
  spriteMundo(E, E.util.de('nube_spray1'), pr.x + dir * w * 0.14, cy - 4, w * (0.95 + respira), h * (0.92 - respira), 0, 0.78 * fin)
  // el cono que sale de la lata
  spriteMundo(E, E.util.de('nube_spray1'), pr.x - dir * w * 0.36, cy, w * 0.42, h * 0.5, 0, 0.95 * fin)
  ctx.globalAlpha = 1
}

function dibujarCodigo(E: Escena, pr: ProyectilEstado): void {
  const ctx = E.ctx
  const espera = TIEMPOS_PROYECTIL.codigoEstalla
  const w = anchoDe(pr)
  const h = altoDe(pr)
  const piso = E.sueloY
  if (pr.edad < espera) {
    const f = pr.edad / espera
    const hVis = h * (0.25 + 0.75 * salidaCubica(f))
    ctx.globalCompositeOperation = 'lighter'
    spriteMundo(E, E.spr.brillo('#22D3EE'), pr.x, piso - 6, w * 2.6, 46, 0, 0.5 + 0.4 * f)
    spriteMundo(E, E.spr.brillo('#0891B2'), pr.x, piso - hVis * 0.5, w * 1.8, hVis * 1.1, 0, 0.32 + 0.3 * f)
    franjaVertical(E, texturaColumna(E), pr.x, w, piso - hVis, piso, E.ms * 0.18, 0.7 + 0.3 * f)
    // los bordes de la franja y la punta que titila cuando está por reventar
    enMundo(E)
    ctx.globalAlpha = 0.45 + 0.4 * f
    ctx.strokeStyle = '#22D3EE'
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.moveTo(pr.x - w / 2, piso)
    ctx.lineTo(pr.x - w / 2, piso - hVis)
    ctx.moveTo(pr.x + w / 2, piso)
    ctx.lineTo(pr.x + w / 2, piso - hVis)
    ctx.stroke()
    const titila = f > 0.6 ? 0.6 + 0.4 * Math.abs(Math.sin(E.s * 34)) : 0.5
    spriteMundo(E, E.spr.estrella[2], pr.x, piso - hVis, 30, 30, E.s * 3, titila)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    return
  }
  // reventó: la columna entera se enciende y se apaga en los ticks que pega
  const f = acotar((pr.edad - espera) / 7, 0, 1)
  ctx.globalCompositeOperation = 'lighter'
  spriteMundo(E, E.spr.brillo('#22D3EE'), pr.x, piso - h * 0.5, w * 1.7, h * 1.15, 0, 0.85 * (1 - f))
  spriteMundo(E, E.spr.brillo('#FFFFFF'), pr.x, piso - h * 0.45, w * 0.7, h * 0.9, 0, 0.7 * (1 - f) * (1 - f))
  franjaVertical(E, texturaColumna(E), pr.x, w * 0.8, piso - h, piso, E.ms * 0.6, 0.9 * (1 - f))
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
}

function dibujarPelotita(E: Escena, pr: ProyectilEstado, atlas: readonly (AtlasPreparado | null)[]): void {
  const cy = E.sueloY - pr.y
  const dir = dirDe(pr)
  const d = 30
  sombraEnPiso(E, pr.x, cy, d)
  trazarEstela(E, '#3D5AFE', pr.x - dir * 110, cy, pr.x - dir * d * 0.2, cy, d * 0.75, 0.9)
  E.ctx.globalCompositeOperation = 'lighter'
  spriteMundo(E, E.spr.brillo('#C8F542'), pr.x, cy, 46, 46, 0, 0.55)
  E.ctx.globalCompositeOperation = 'source-over'
  objeto(E, atlas, pr.duenio, 'pelotita', 'pelotita', pr.x, cy, d, pr.rot, dir, 1)
}

function dibujarEspinaVuelo(E: Escena, pr: ProyectilEstado, atlas: readonly (AtlasPreparado | null)[]): void {
  const cy = E.sueloY - pr.y
  const dir = dirDe(pr)
  const v = Math.hypot(pr.vx, pr.vy) || 1
  const ux = pr.vx / v
  const uy = -pr.vy / v
  sombraEnPiso(E, pr.x, cy, 30)
  trazarEstela(E, '#FFC93C', pr.x - ux * 64, cy - uy * 64, pr.x - ux * 6, cy - uy * 6, 9, 0.85)
  E.ctx.globalCompositeOperation = 'lighter'
  spriteMundo(E, E.spr.brillo('#FFC93C'), pr.x, cy, 40, 40, 0, 0.45)
  E.ctx.globalCompositeOperation = 'source-over'
  objeto(E, atlas, pr.duenio, 'pua', 'pua', pr.x, cy, 42, anguloDeVuelo(pr.vx, pr.vy, dir), dir, 1)
}

/** Una púa clavada: pinchos dorados en el piso que laten y titilan cuando se están por apagar. */
function dibujarEspinaClavada(E: Escena, S: SeguimientoQuinta, k: number, atlas: readonly (AtlasPreparado | null)[]): void {
  const x = S.x[k]
  const piso = E.sueloY
  const vida = vidaTrampa(S.autor[k] ?? 'nico_m')
  const resta = vida - (S.edad[k] - Math.max(0, S.clavada[k]))
  const late = 0.75 + 0.25 * Math.sin(E.s * 6 + S.id[k])
  let alfa = acotar(resta / 8, 0, 1)
  // los últimos 30 ticks titila (se está por apagar)
  if (resta < 30) alfa *= Math.floor(E.ms / 85) % 2 === 0 ? 1 : 0.3
  const entra = salidaCubica(acotar((S.edad[k] - S.clavada[k]) / 6, 0, 1))
  const ctx = E.ctx
  ctx.globalCompositeOperation = 'lighter'
  spriteMundo(E, E.spr.brillo('#FFC93C'), x, piso - 4, 70, 22, 0, 0.5 * late * alfa)
  ctx.globalCompositeOperation = 'source-over'
  // tres pinchos: el del medio, parado; los de los costados, inclinados
  const duenio = S.duenio[k]
  objeto(E, atlas, duenio, 'pua', 'pua', x, piso - 13 * entra, 34, -Math.PI / 2, 1, alfa)
  objeto(E, atlas, duenio, 'pua', 'pua', x - 9, piso - 8 * entra, 24, -Math.PI / 2 - 0.42, 1, alfa * 0.95)
  objeto(E, atlas, duenio, 'pua', 'pua', x + 9, piso - 8 * entra, 24, -Math.PI / 2 + 0.42, 1, alfa * 0.95)
  ctx.globalCompositeOperation = 'lighter'
  spriteMundo(E, E.spr.estrella[1], x, piso - 26 * entra, 14 * late, 14 * late, E.s * 2, 0.8 * alfa)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
}

/** Zigzag de la estela eléctrica del monopatín (se sortea cada tanto, no en cada cuadro). */
const RAYO = new Float32Array(10)
let rayoMs = -1

function dibujarMonopatin(E: Escena, pr: ProyectilEstado, atlas: readonly (AtlasPreparado | null)[]): void {
  const ctx = E.ctx
  const cy = E.sueloY - pr.y + Math.sin(E.s * 31 + pr.id) * 1.4
  const dir = dirDe(pr)
  const r = rangoMonopatin()
  const f = acotar((Math.abs(pr.vx) - r.desde) / (r.hasta - r.desde), 0, 1)
  const largo = 40 + 230 * f
  sombraEnPiso(E, pr.x, E.sueloY - pr.y, 110)
  trazarEstela(E, '#2B79DB', pr.x - dir * (largo + 50), cy + 6, pr.x - dir * 40, cy + 6, 30, 0.9)
  trazarEstela(E, '#BFE3FF', pr.x - dir * (largo * 0.7 + 50), cy + 6, pr.x - dir * 44, cy + 6, 8, 0.75)
  // dos rayitos azules en la estela
  if (E.ms - rayoMs > 60 || rayoMs < 0) {
    rayoMs = E.ms
    for (let s = 0; s < RAYO.length; s++) RAYO[s] = (Math.random() - 0.5) * 16
  }
  enMundo(E)
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineJoin = 'round'
  for (let capa = 0; capa < 2; capa++) {
    ctx.beginPath()
    for (let s = 0; s < RAYO.length; s++) {
      const px = pr.x - dir * (46 + (largo * s) / (RAYO.length - 1))
      const py = cy + 6 + RAYO[s] * (s === 0 ? 0 : 1)
      if (s === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.globalAlpha = (0.35 + 0.55 * f) * (capa === 0 ? 0.6 : 1)
    ctx.strokeStyle = capa === 0 ? 'rgba(80,160,255,0.7)' : '#FFFFFF'
    ctx.lineWidth = capa === 0 ? 6 : 1.6
    ctx.stroke()
  }
  spriteMundo(E, E.spr.brillo('#2B79DB'), pr.x, cy + 18, 140, 40, 0, 0.55)
  ctx.globalCompositeOperation = 'source-over'
  objeto(E, atlas, pr.duenio, 'monopatin', 'monopatin', pr.x, cy, 124, 0, dir, 1)
}

/** La estela lima de un tiro que devolvió el Smash de Nehuen (de cualquier tipo, también los de antes). */
function estelaDevuelto(E: Escena, S: SeguimientoQuinta, k: number): void {
  const x = S.x[k]
  const cy = E.sueloY - S.y[k]
  const v = Math.hypot(S.vx[k], S.vy[k]) || 1
  const ux = S.vx[k] / v
  const uy = -S.vy[k] / v
  const grosor = acotar(Math.min(S.ancho[k], S.alto[k]) * 0.8, 14, 40)
  trazarEstela(E, LIMA, x - ux * 130, cy - uy * 130, x - ux * 6, cy - uy * 6, grosor, 0.95)
  E.ctx.globalCompositeOperation = 'lighter'
  spriteMundo(E, E.spr.brillo(LIMA), x, cy, grosor * 3.4, grosor * 3.4, 0, 0.5)
  E.ctx.globalCompositeOperation = 'source-over'
}

/** Lo que va en el piso DETRÁS de los luchadores: las púas clavadas. */
export function dibujarQuintaFondo(E: Escena, S: SeguimientoQuinta, atlas: readonly (AtlasPreparado | null)[]): void {
  for (let k = 0; k < MAX; k++) {
    if (S.id[k] < 0 || S.tipo[k] !== 'espina' || S.clavada[k] < 0) continue
    dibujarEspinaClavada(E, S, k, atlas)
  }
  E.ctx.globalAlpha = 1
}

/** Las estelas lima de los tiros devueltos (van debajo de los proyectiles: se dibuja antes). */
export function dibujarDevueltos(E: Escena, S: SeguimientoQuinta): void {
  for (let k = 0; k < MAX; k++) {
    if (S.id[k] < 0 || S.devuelto[k] < 0 || !S.visto[k]) continue
    estelaDevuelto(E, S, k)
  }
  E.ctx.globalAlpha = 1
}

/** Los proyectiles de la quinta tanda en vuelo. */
export function dibujarQuinta(E: Escena, p: Partida, atlas: readonly (AtlasPreparado | null)[]): void {
  const lista = p.proyectiles
  const ctx = E.ctx
  for (let i = 0; i < lista.length; i++) {
    const pr = lista[i]
    switch (pr.tipo) {
      case 'carta':
        dibujarCarta(E, pr, atlas)
        break
      case 'hipnosis':
        dibujarHipnosis(E, pr)
        break
      case 'secador':
        dibujarSecador(E, pr, atlas)
        break
      case 'aerosol':
        dibujarAerosol(E, pr)
        break
      case 'codigo':
        dibujarCodigo(E, pr)
        break
      case 'pelotita':
        dibujarPelotita(E, pr, atlas)
        break
      case 'espina':
        if (!pr.plantado) dibujarEspinaVuelo(E, pr, atlas)
        break
      case 'monopatin':
        dibujarMonopatin(E, pr, atlas)
        break
      default:
        break
    }
  }
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.imageSmoothingEnabled = true
}
