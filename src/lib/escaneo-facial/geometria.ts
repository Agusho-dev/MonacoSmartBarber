/**
 * Geometría de la cara para el escáner del kiosko (sin React, sin DOM).
 *
 * Trabaja sobre los 68 puntos de face-api (esquema iBUG 300-W) en píxeles del
 * VIDEO, sin espejar: el espejo lo pone el dibujo. De acá salen las tres cosas
 * que el escáner necesita saber de una cara:
 *   - la pose (hacia dónde mira, qué tan grande se ve, si se mueve),
 *   - si la lectura sirve para reconocerla y, si no, QUÉ pedirle a la persona,
 *   - la malla que se dibuja encima: meridianos y paralelos que siguen el
 *     contorno real de la cara y giran con ella.
 *
 * Los puntos viajan como Float32Array intercalado [x0, y0, x1, y1, …]: la malla
 * se rearma en cada cuadro de la pantalla (hasta 90 por segundo en la Redmi
 * Pad 2) y con arrays de objetos cada cuadro dejaría cientos de objetos al GC.
 */

import type { Guia } from './tipos'

export type Puntos = Float32Array

export const CANTIDAD_PUNTOS = 68

export interface Punto {
  x: number
  y: number
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

function centroDe(p: Puntos, desde: number, hasta: number): Punto {
  let x = 0
  let y = 0
  for (let i = desde; i <= hasta; i++) {
    x += p[2 * i]
    y += p[2 * i + 1]
  }
  const n = hasta - desde + 1
  return { x: x / n, y: y / n }
}

// ── Pose ────────────────────────────────────────────────────────────────────

export interface PoseCara {
  /** Punto medio entre los centros de los ojos. */
  centroOjos: Punto
  /** Eje horizontal de la cara (unitario): del ojo de la izquierda de la imagen al de la derecha. */
  ex: Punto
  /** Eje vertical de la cara (unitario): hacia el mentón. */
  ey: Punto
  /** Distancia entre los centros de los ojos, en px del video. Es la regla de toda la geometría. */
  iod: number
  /** Inclinación hacia un hombro, en grados. */
  roll: number
  /** Giro hacia un costado: 0 de frente, ±1 de perfil. */
  yaw: number
  /** Dónde cae la punta de la nariz entre los ojos (0) y el mentón (1). De frente ronda 0,33–0,42. */
  pitch: number
  /** Distancia de los ojos al mentón sobre el eje vertical (px del video). */
  alturaMenton: number
}

export function leerPose(p: Puntos): PoseCara {
  const oi = centroDe(p, 36, 41)
  const od = centroDe(p, 42, 47)
  const centroOjos = { x: (oi.x + od.x) / 2, y: (oi.y + od.y) / 2 }
  const dx = od.x - oi.x
  const dy = od.y - oi.y
  const iod = Math.max(1e-3, Math.hypot(dx, dy))
  const ex = { x: dx / iod, y: dy / iod }
  const ey = { x: -ex.y, y: ex.x }

  const u = (i: number) => (p[2 * i] - centroOjos.x) * ex.x + (p[2 * i + 1] - centroOjos.y) * ex.y
  const v = (i: number) => (p[2 * i] - centroOjos.x) * ey.x + (p[2 * i + 1] - centroOjos.y) * ey.y

  // Giro: dónde cae la punta de la nariz entre los dos extremos de la
  // mandíbula, medido sobre la línea de los ojos. De frente, en el medio. Con
  // la cabeza muy girada el lado lejano de la mandíbula se aplasta contra la
  // nariz y la cuenta pierde sentido: ahí ya es "de perfil".
  const u0 = u(0)
  const u16 = u(16)
  const uNariz = u(30)
  const ancho = u16 - u0
  const yaw =
    ancho > iod * 0.5
      ? clamp(((uNariz - u0) / ancho - 0.5) * 2, -1, 1)
      : uNariz > (u0 + u16) / 2
        ? 1
        : -1

  // Cabeceo: la punta de la nariz sobresale, así que al bajar la cabeza su
  // proyección se acerca al mentón y al subirla se acerca a los ojos.
  const alturaMenton = v(8)
  const pitch = alturaMenton > iod * 0.5 ? v(30) / alturaMenton : 0.38

  return {
    centroOjos,
    ex,
    ey,
    iod,
    roll: (Math.atan2(dy, dx) * 180) / Math.PI,
    yaw,
    pitch,
    alturaMenton: Math.max(iod, alturaMenton),
  }
}

// ── ¿La lectura sirve? ──────────────────────────────────────────────────────

export interface LimitesLectura {
  /** Confianza mínima del detector. */
  confianza: number
  /**
   * Distancia interocular sobre el lado mayor del video. Debajo, la cara está
   * tan lejos que el descriptor sale con poco detalle; arriba, tan cerca que se
   * corta. Relativo y no en píxeles: así vale igual si la cámara entrega 720p o
   * 480p, en horizontal o en vertical.
   */
  tamanoMin: number
  tamanoMax: number
  /** Giro máximo (0–1) e inclinación máxima (grados). */
  yaw: number
  roll: number
  /** Rango aceptado de la nariz entre ojos y mentón. Generoso: la red tolera bastante cabeceo. */
  pitchMin: number
  pitchMax: number
  /** Movimiento máximo, en distancias interoculares por segundo. Más, y el cuadro sale movido. */
  movimiento: number
  /** Brillo mínimo del centro de la cara (0–255). Sólo frena con oscuridad de verdad. */
  luz: number
}

/**
 * Cada límite que frena la lectura tiene SU guía: si una cara no sirve, la
 * pantalla siempre dice por qué. Un límite sin guía sería una zona muerta donde
 * la persona espera sin saber qué hacer.
 */
export const LIMITES_IDENTIFICAR: LimitesLectura = {
  confianza: 0.5,
  tamanoMin: 0.04,
  tamanoMax: 0.16,
  yaw: 0.38,
  roll: 22,
  pitchMin: 0.18,
  pitchMax: 0.7,
  movimiento: 0.9,
  luz: 25,
}

/** Para registrar se pide un poco más: esa cara es la referencia de todas las visitas que vienen. */
export const LIMITES_REGISTRAR: LimitesLectura = {
  ...LIMITES_IDENTIFICAR,
  confianza: 0.6,
  yaw: 0.3,
  roll: 18,
  movimiento: 0.7,
}

export interface MedicionCara {
  puntos: Puntos
  /** Confianza del detector (0–1). */
  confianza: number
  /** Brillo medio del centro de la cara (0–255). */
  luz: number
  ancho: number
  alto: number
  /** performance.now() de la medición. */
  t: number
}

export interface EvaluacionCara {
  pose: PoseCara
  tamano: number
  /** Distancias interoculares por segundo. */
  movimiento: number
  /** Qué pedirle a la persona; null = la cara sirve para leer. */
  guia: Guia | null
}

/** Mandíbula y cejas adentro del cuadro: si no, la cara está cortada por un borde. */
function cortada(m: MedicionCara): boolean {
  const mx = m.ancho * 0.01
  const my = m.alto * 0.01
  for (let i = 0; i <= 26; i++) {
    const x = m.puntos[2 * i]
    const y = m.puntos[2 * i + 1]
    if (x < mx || x > m.ancho - mx || y < my || y > m.alto - my) return true
  }
  return false
}

export function evaluarCara(
  actual: MedicionCara,
  anterior: MedicionCara | null,
  lim: LimitesLectura,
): EvaluacionCara {
  const pose = leerPose(actual.puntos)
  const tamano = pose.iod / Math.max(1, actual.ancho, actual.alto)

  // Velocidad media de los puntos entre las dos últimas mediciones. Si la
  // anterior es vieja (la cara se había ido) no hay con qué comparar.
  let movimiento = 0
  if (anterior) {
    const dt = (actual.t - anterior.t) / 1000
    if (dt > 0.01 && dt < 0.6) {
      let suma = 0
      for (let i = 0; i < CANTIDAD_PUNTOS; i++) {
        suma += Math.hypot(
          actual.puntos[2 * i] - anterior.puntos[2 * i],
          actual.puntos[2 * i + 1] - anterior.puntos[2 * i + 1],
        )
      }
      movimiento = suma / CANTIDAD_PUNTOS / pose.iod / dt
    }
  }

  let guia: Guia | null = null
  if (cortada(actual)) guia = 'centrate'
  else if (tamano < lim.tamanoMin) guia = 'acercate'
  else if (tamano > lim.tamanoMax) guia = 'alejate'
  else if (
    Math.abs(pose.yaw) > lim.yaw ||
    Math.abs(pose.roll) > lim.roll ||
    actual.confianza < lim.confianza
  ) {
    guia = 'de_frente'
  } else if (pose.pitch < lim.pitchMin || pose.pitch > lim.pitchMax) guia = 'cabeza'
  else if (actual.luz < lim.luz) guia = 'luz'
  else if (movimiento > lim.movimiento) guia = 'quieto'

  return { pose, tamano, movimiento, guia }
}

// ── Encuadre ────────────────────────────────────────────────────────────────

/**
 * Centro y alto de la cara (de la frente al mentón) en px del video, a partir
 * de la pose. La frente no tiene puntos: se estima con las proporciones de una
 * cara promedio (los ojos quedan a ~36 % del alto desde arriba).
 */
export function encuadreDeCara(pose: PoseCara): { x: number; y: number; alto: number } {
  const desplazamiento = 0.22 * pose.alturaMenton
  return {
    x: pose.centroOjos.x + pose.ey.x * desplazamiento,
    y: pose.centroOjos.y + pose.ey.y * desplazamiento,
    alto: 1.56 * pose.alturaMenton,
  }
}

// ── Malla ───────────────────────────────────────────────────────────────────

/** Filas de la tabla de anchos de la cara, de la frente al mentón. */
const FILAS = 26
/** Tramos del arco de la frente entre los dos extremos de la mandíbula. */
const ARCO = 12
/** Mandíbula (17 puntos) + puntos intermedios del arco. */
const N_CONTORNO = 17 + ARCO - 1
/** Índice del contorno que cae en lo más alto de la frente. */
export const INDICE_FRENTE = 16 + ARCO / 2

export interface OpcionesMalla {
  meridianos: number
  paralelos: number
  puntosParalelo: number
}

/**
 * La malla que se dibuja sobre la cara: como las líneas de un globo terráqueo
 * apoyado sobre el contorno real de la cara.
 *
 * - El contorno es la mandíbula (puntos 0–16) cerrada por un arco de frente
 *   estimado desde las cejas. El arco es bajo a propósito: con gorra (muy común
 *   en la barbería) un arco alto se dibujaba sobre la visera.
 * - Una tabla de filas guarda, para cada altura, dónde empieza y termina la
 *   cara. Los meridianos recorren esas filas en una "longitud" fija y los
 *   paralelos las cruzan de lado a lado: así todo queda adentro de la cara sin
 *   recortar nada y las líneas se juntan en la frente y el mentón como en un
 *   globo.
 * - Con la cabeza girada, los meridianos se corren y se apiñan del lado que se
 *   aleja: es lo que hace que la malla se lea en 3D y no como un sello pegado.
 *
 * Todos los buffers se reservan una vez; `armar` no aloca.
 */
export class MallaCara {
  readonly nMeridianos: number
  readonly nParalelos: number
  readonly puntosParalelo: number
  readonly filas = FILAS
  readonly nContorno = N_CONTORNO
  /** Contorno cerrado en px del video. */
  readonly contorno = new Float32Array(N_CONTORNO * 2)
  /** nMeridianos × FILAS puntos, en px del video. */
  readonly meridianos: Float32Array
  /** Cuánto se ve cada meridiano: 0 = de canto (no se dibuja), 1 = de frente. */
  readonly visibilidad: Float32Array
  /** nParalelos × puntosParalelo puntos, en px del video. */
  readonly paralelos: Float32Array
  /** Eje de la cara (frente → mentón) en px del video: [x0, y0, x1, y1]. */
  readonly eje = new Float32Array(4)
  centroX = 0
  centroY = 0
  /** Radio aproximado de la cara (px del video). */
  radio = 0

  // Coordenadas locales de la cara: u sobre la línea de los ojos, v hacia el mentón.
  private readonly cu = new Float32Array(N_CONTORNO)
  private readonly cv = new Float32Array(N_CONTORNO)
  private readonly filaV = new Float32Array(FILAS)
  private readonly filaC = new Float32Array(FILAS)
  private readonly filaW = new Float32Array(FILAS)
  private vArriba = 0
  private vAbajo = 1
  // Marco local → video.
  private ox = 0
  private oy = 0
  private exx = 1
  private exy = 0
  private eyx = 0
  private eyy = 1
  // Resultado de `filaEn` (sin alocar una tupla por llamada).
  private c = 0
  private w = 0
  private readonly tmp = new Float32Array(2)

  constructor(opciones: OpcionesMalla = { meridianos: 9, paralelos: 8, puntosParalelo: 21 }) {
    this.nMeridianos = opciones.meridianos
    this.nParalelos = opciones.paralelos
    this.puntosParalelo = opciones.puntosParalelo
    this.meridianos = new Float32Array(opciones.meridianos * FILAS * 2)
    this.visibilidad = new Float32Array(opciones.meridianos)
    this.paralelos = new Float32Array(opciones.paralelos * opciones.puntosParalelo * 2)
  }

  armar(p: Puntos, pose: PoseCara): void {
    const { centroOjos: o, ex, ey, iod } = pose
    this.ox = o.x
    this.oy = o.y
    this.exx = ex.x
    this.exy = ex.y
    this.eyx = ey.x
    this.eyy = ey.y

    const cu = this.cu
    const cv = this.cv
    for (let i = 0; i < 17; i++) {
      const dx = p[2 * i] - o.x
      const dy = p[2 * i + 1] - o.y
      cu[i] = dx * ex.x + dy * ex.y
      cv[i] = dx * ey.x + dy * ey.y
    }
    let vCejas = Infinity
    for (let i = 17; i <= 26; i++) {
      const v = (p[2 * i] - o.x) * ey.x + (p[2 * i + 1] - o.y) * ey.y
      if (v < vCejas) vCejas = v
    }
    const vMenton = cv[8]
    const altoCara = Math.max(iod, vMenton - vCejas)
    const vFrente = vCejas - 0.3 * altoCara

    // Arco de la frente: del extremo 16 al 0 pasando por arriba.
    const u0 = cu[0]
    const v0 = cv[0]
    const u16 = cu[16]
    const v16 = cv[16]
    const uc = (u0 + u16) / 2
    const a = Math.max(iod * 0.6, (u16 - u0) / 2)
    for (let k = 1; k < ARCO; k++) {
      const th = (Math.PI * k) / ARCO
      const vLado = v16 + (v0 - v16) * (th / Math.PI)
      cu[16 + k] = uc + a * Math.cos(th)
      cv[16 + k] = vLado + (vFrente - vLado) * Math.pow(Math.sin(th), 0.7)
    }
    for (let i = 0; i < N_CONTORNO; i++) this.aVideo(cu[i], cv[i], this.contorno, 2 * i)

    // Tabla de filas: para cada altura, dónde cruza la horizontal al contorno.
    this.vArriba = vFrente
    this.vAbajo = vMenton
    for (let r = 0; r < FILAS; r++) {
      const v = vFrente + (vMenton - vFrente) * (0.015 + (0.97 * r) / (FILAS - 1))
      this.filaV[r] = v
      let uMin = Infinity
      let uMax = -Infinity
      for (let i = 0, j = N_CONTORNO - 1; i < N_CONTORNO; j = i++) {
        const vi = cv[i]
        const vj = cv[j]
        if ((vi <= v && v < vj) || (vj <= v && v < vi)) {
          const u = cu[i] + ((v - vi) * (cu[j] - cu[i])) / (vj - vi)
          if (u < uMin) uMin = u
          if (u > uMax) uMax = u
        }
      }
      if (uMin === Infinity) {
        // Fila degenerada (pasa justo por un vértice del borde): copia la vecina.
        this.filaC[r] = r > 0 ? this.filaC[r - 1] : uc
        this.filaW[r] = r > 0 ? this.filaW[r - 1] : 0
      } else {
        this.filaC[r] = (uMin + uMax) / 2
        this.filaW[r] = (uMax - uMin) / 2
      }
    }

    // Meridianos: longitudes fijas de -80° a 80°, corridas por el giro.
    const giro = Math.asin(clamp(pose.yaw * 0.85, -0.85, 0.85))
    for (let j = 0; j < this.nMeridianos; j++) {
      const longitud = (((-80 + (160 * j) / (this.nMeridianos - 1)) * Math.PI) / 180) + giro
      const frente = Math.cos(longitud)
      this.visibilidad[j] = frente > 0.12 ? frente : 0
      const t = Math.sin(longitud)
      const base = j * FILAS * 2
      for (let r = 0; r < FILAS; r++) {
        this.aVideo(this.filaC[r] + t * this.filaW[r], this.filaV[r], this.meridianos, base + 2 * r)
      }
    }

    // Paralelos: cruzan la cara de borde a borde y se curvan hacia abajo en el
    // centro, como las líneas de un globo visto apenas desde arriba (la cámara
    // está en el borde de arriba de la tablet).
    const altoTotal = vMenton - vFrente
    for (let k = 0; k < this.nParalelos; k++) {
      const f = (k + 1) / (this.nParalelos + 1)
      const vk = vFrente + altoTotal * f
      const curva = 0.05 * altoTotal * (0.55 + 0.45 * Math.sin(Math.PI * f))
      const base = k * this.puntosParalelo * 2
      for (let m = 0; m < this.puntosParalelo; m++) {
        const th = -Math.PI / 2 + (Math.PI * m) / (this.puntosParalelo - 1)
        const v = vk + curva * Math.cos(th)
        this.filaEn(v)
        this.aVideo(this.c + Math.sin(th) * this.w, v, this.paralelos, base + 2 * m)
      }
    }

    this.aVideo(uc, vFrente, this.eje, 0)
    this.aVideo(uc, vMenton, this.eje, 2)
    this.aVideo(uc, (vFrente + vMenton) / 2, this.tmp, 0)
    this.centroX = this.tmp[0]
    this.centroY = this.tmp[1]
    this.radio = Math.max(altoTotal / 2, a)
  }

  /**
   * Extremos de la cara a la altura k (0 = frente, 1 = mentón), en px del
   * video: escribe [x0, y0, x1, y1] en `out`.
   */
  cuerda(k: number, out: Float32Array): void {
    const v = this.vArriba + (this.vAbajo - this.vArriba) * clamp(k, 0, 1)
    this.filaEn(v)
    this.aVideo(this.c - this.w, v, out, 0)
    this.aVideo(this.c + this.w, v, out, 2)
  }

  /** Centro (`c`) y medio ancho (`w`) de la cara a la altura v, interpolando la tabla. */
  private filaEn(v: number): void {
    const v0 = this.filaV[0]
    const v1 = this.filaV[FILAS - 1]
    const pos = v1 > v0 ? ((v - v0) / (v1 - v0)) * (FILAS - 1) : 0
    const r = clamp(Math.floor(pos), 0, FILAS - 2)
    const f = clamp(pos - r, 0, 1)
    this.c = this.filaC[r] + (this.filaC[r + 1] - this.filaC[r]) * f
    this.w = this.filaW[r] + (this.filaW[r + 1] - this.filaW[r]) * f
  }

  private aVideo(u: number, v: number, out: Float32Array, i: number): void {
    out[i] = this.ox + u * this.exx + v * this.eyx
    out[i + 1] = this.oy + u * this.exy + v * this.eyy
  }
}

// ── Descriptores ────────────────────────────────────────────────────────────

/** Distancia euclídea entre dos descriptores (la misma que usa la base con `<->`). */
export function distanciaDescriptores(a: Float32Array, b: Float32Array): number {
  let suma = 0
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i]
    suma += d * d
  }
  return Math.sqrt(suma)
}

/** Promedio componente a componente: el centroide de las muestras de una misma cara. */
export function promedioDescriptores(ds: readonly Float32Array[]): Float32Array {
  const out = new Float32Array(ds[0].length)
  for (const d of ds) for (let i = 0; i < out.length; i++) out[i] += d[i]
  for (let i = 0; i < out.length; i++) out[i] /= ds.length
  return out
}

export interface Caja {
  x: number
  y: number
  width: number
  height: number
}

/** Intersección sobre unión de dos cajas. */
export function solapamiento(a: Caja, b: Caja): number {
  const x0 = Math.max(a.x, b.x)
  const y0 = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.width, b.x + b.width)
  const y1 = Math.min(a.y + a.height, b.y + b.height)
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0)
  const union = a.width * a.height + b.width * b.height - inter
  return union > 0 ? inter / union : 0
}
