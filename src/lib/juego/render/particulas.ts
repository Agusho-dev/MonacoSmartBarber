/**
 * Partículas y tajos (estelas de los golpes).
 *
 * El pool es un «struct of arrays» de tamaño fijo: crear una partícula es escribir números en
 * arreglos tipados y morirse es pisarla con la última (sin basura para el GC). El tope depende
 * de la calidad; si se llena, las nuevas no se crean (nunca se traba el cuadro).
 *
 * Coordenadas: x de mundo, y de mundo-pantalla (hacia abajo, el piso en `sueloY`).
 */
import { cuadroFx, dibujarFx, duracionFx, fx, FX_HIELO_TROZO, FX_MECHONES, FX_POLVO, FX_VIDRIO } from './efectos'
import { enMundo, spriteMundo, type Escena } from './escena'
import { azar, salidaCubica, TAU } from './util'

export const P_CHISPA = 0
export const P_BRILLO = 1
export const P_MECHON = 2
export const P_POLVO = 3
export const P_VIDRIO = 4
export const P_HIELO = 5
export const P_ANILLO = 6
export const P_ESTALLIDO = 7
export const P_NIEBLA = 8
export const P_ELECTRICA = 9
export const P_GOTA = 10
/** Un efecto animado del atlas compartido (variante = FX_*, ancho = escala). */
export const P_ANIM = 11

/** Paletas de las chispas y anillos (de claro a oscuro a medida que se apagan). */
export const PAL_FUEGO = 0
export const PAL_AZUL = 1
export const PAL_ORO = 2
export const PAL_HIELO = 3
export const PAL_ELECTRICA = 4
const PALETAS: readonly (readonly string[])[] = [
  ['#FFFFFF', '#FFF6C8', '#FFD45A', '#FF9A2E', '#FF5A1F'],
  ['#FFFFFF', '#E3F8FF', '#9BE6FF', '#56BFFF', '#2A7BFF'],
  ['#FFFFFF', '#FFF3B8', '#FFD447', '#F5B301', '#C27C00'],
  ['#FFFFFF', '#E9FCFF', '#B5F0FF', '#7EDCFF', '#38B6FF'],
  ['#FFFFFF', '#FFFDE0', '#FFF27A', '#FFD000', '#F59E00'],
]

export class Particulas {
  readonly max: number
  limite: number
  n = 0
  readonly x: Float32Array
  readonly y: Float32Array
  readonly vx: Float32Array
  readonly vy: Float32Array
  readonly vida: Float32Array
  readonly total: Float32Array
  readonly tam: Float32Array
  readonly tamFin: Float32Array
  readonly rot: Float32Array
  readonly vrot: Float32Array
  readonly grav: Float32Array
  readonly roce: Float32Array
  readonly ancho: Float32Array
  readonly tipo: Uint8Array
  readonly paleta: Uint8Array
  readonly variante: Uint8Array
  /** Cuadro elegido del atlas compartido (mechones, esquirlas). */
  readonly cuadro: Uint8Array
  readonly capa: Uint8Array

  constructor(max: number, limite: number) {
    this.max = max
    this.limite = Math.min(max, limite)
    this.x = new Float32Array(max)
    this.y = new Float32Array(max)
    this.vx = new Float32Array(max)
    this.vy = new Float32Array(max)
    this.vida = new Float32Array(max)
    this.total = new Float32Array(max)
    this.tam = new Float32Array(max)
    this.tamFin = new Float32Array(max)
    this.rot = new Float32Array(max)
    this.vrot = new Float32Array(max)
    this.grav = new Float32Array(max)
    this.roce = new Float32Array(max)
    this.ancho = new Float32Array(max)
    this.tipo = new Uint8Array(max)
    this.paleta = new Uint8Array(max)
    this.variante = new Uint8Array(max)
    this.cuadro = new Uint8Array(max)
    this.capa = new Uint8Array(max)
  }

  /** Reserva una partícula y devuelve su índice (o -1 si el pool está lleno). */
  nueva(tipo: number, x: number, y: number, vida: number): number {
    if (this.n >= this.limite) return -1
    const i = this.n++
    this.tipo[i] = tipo
    this.x[i] = x
    this.y[i] = y
    this.vx[i] = 0
    this.vy[i] = 0
    this.vida[i] = vida
    this.total[i] = vida
    this.tam[i] = 1
    this.tamFin[i] = 1
    this.rot[i] = 0
    this.vrot[i] = 0
    this.grav[i] = 0
    this.roce[i] = 0
    this.ancho[i] = 0
    this.paleta[i] = 0
    this.variante[i] = 0
    this.cuadro[i] = 0
    this.capa[i] = 1
    return i
  }

  vaciar(): void {
    this.n = 0
  }

  actualizar(dt: number, sueloY: number, s: number): void {
    for (let i = 0; i < this.n; i++) {
      const vida = this.vida[i] - dt
      if (vida <= 0) {
        this.quitar(i)
        i--
        continue
      }
      this.vida[i] = vida
      const tipo = this.tipo[i]
      const roce = this.roce[i]
      if (roce > 0) {
        const k = Math.exp(-roce * dt)
        this.vx[i] *= k
        this.vy[i] *= k
      }
      this.vy[i] += this.grav[i] * dt
      // el pelo cae hamacándose
      if (tipo === P_MECHON && this.grav[i] > 0) this.vx[i] += Math.sin(s * 6.5 + i * 1.7) * 150 * dt
      this.x[i] += this.vx[i] * dt
      this.y[i] += this.vy[i] * dt
      this.rot[i] += this.vrot[i] * dt
      if (this.y[i] > sueloY && (tipo === P_MECHON || tipo === P_VIDRIO || tipo === P_HIELO || tipo === P_GOTA)) {
        this.y[i] = sueloY
        if ((tipo === P_VIDRIO || tipo === P_HIELO) && this.vy[i] > 90) {
          this.vy[i] *= -0.32
          this.vx[i] *= 0.55
          this.vrot[i] *= 0.4
        } else {
          this.vy[i] = 0
          this.vx[i] *= 0.15
          this.vrot[i] = 0
          this.grav[i] = 0
          if (tipo === P_GOTA && this.vida[i] > 0.12) this.vida[i] = 0.12
        }
      }
    }
  }

  private quitar(i: number): void {
    const u = --this.n
    if (i === u) return
    this.tipo[i] = this.tipo[u]
    this.x[i] = this.x[u]
    this.y[i] = this.y[u]
    this.vx[i] = this.vx[u]
    this.vy[i] = this.vy[u]
    this.vida[i] = this.vida[u]
    this.total[i] = this.total[u]
    this.tam[i] = this.tam[u]
    this.tamFin[i] = this.tamFin[u]
    this.rot[i] = this.rot[u]
    this.vrot[i] = this.vrot[u]
    this.grav[i] = this.grav[u]
    this.roce[i] = this.roce[u]
    this.ancho[i] = this.ancho[u]
    this.paleta[i] = this.paleta[u]
    this.variante[i] = this.variante[u]
    this.cuadro[i] = this.cuadro[u]
    this.capa[i] = this.capa[u]
  }
}

function esAditiva(tipo: number): boolean {
  return (
    tipo === P_CHISPA ||
    tipo === P_BRILLO ||
    tipo === P_ANILLO ||
    tipo === P_ESTALLIDO ||
    tipo === P_ELECTRICA
  )
}

/** Dibuja las partículas de una capa (0 = detrás de los luchadores, 1 = adelante). */
export function dibujarParticulas(E: Escena, capa: number): void {
  const P = E.parts
  if (P.n === 0) return
  const ctx = E.ctx
  let aditivo = false
  ctx.globalCompositeOperation = 'source-over'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (let i = 0; i < P.n; i++) {
    if (P.capa[i] !== capa) continue
    const tipo = P.tipo[i]
    const vidaRel = P.vida[i] / P.total[i]
    const edadRel = 1 - vidaRel
    // la niebla del spray va opaca (se ve sobre pisos claros); el viento blanco, aditivo
    const quiere =
      tipo === P_ANIM
        ? (E.fx?.anims[P.variante[i]]?.aditiva ?? true)
        : tipo === P_NIEBLA
          ? P.variante[i] === 2
          : esAditiva(tipo)
    if (quiere !== aditivo) {
      aditivo = quiere
      ctx.globalCompositeOperation = quiere ? 'lighter' : 'source-over'
    }
    const x = P.x[i]
    const y = P.y[i]
    switch (tipo) {
      case P_CHISPA: {
        enMundo(E)
        const pal = PALETAS[P.paleta[i]] ?? PALETAS[0]
        ctx.strokeStyle = pal[Math.min(4, (edadRel * 5) | 0)]
        ctx.globalAlpha = Math.min(1, vidaRel * 1.8)
        ctx.lineWidth = P.tam[i] * (0.35 + 0.65 * vidaRel)
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x - P.vx[i] * 0.03, y - P.vy[i] * 0.03)
        ctx.stroke()
        break
      }
      case P_ELECTRICA: {
        enMundo(E)
        const largo = P.tam[i]
        const v = Math.hypot(P.vx[i], P.vy[i]) || 1
        const ux = P.vx[i] / v
        const uy = P.vy[i] / v
        ctx.globalAlpha = Math.min(1, vidaRel * 2)
        ctx.beginPath()
        ctx.moveTo(x, y)
        const j1 = (Math.random() - 0.5) * 9
        const j2 = (Math.random() - 0.5) * 9
        ctx.lineTo(x - ux * largo * 0.35 - uy * j1, y - uy * largo * 0.35 + ux * j1)
        ctx.lineTo(x - ux * largo * 0.7 - uy * j2, y - uy * largo * 0.7 + ux * j2)
        ctx.lineTo(x - ux * largo, y - uy * largo)
        ctx.strokeStyle = 'rgba(255,214,80,0.55)'
        ctx.lineWidth = 4
        ctx.stroke()
        ctx.strokeStyle = '#FFFFFF'
        ctx.lineWidth = 1.4
        ctx.stroke()
        break
      }
      case P_ANILLO: {
        enMundo(E)
        const pal = PALETAS[P.paleta[i]] ?? PALETAS[0]
        const r = P.tam[i] + (P.tamFin[i] - P.tam[i]) * salidaCubica(edadRel)
        ctx.strokeStyle = pal[1]
        ctx.globalAlpha = vidaRel * 0.9
        ctx.lineWidth = Math.max(0.5, P.ancho[i] * vidaRel)
        ctx.beginPath()
        ctx.arc(x, y, r, 0, TAU)
        ctx.stroke()
        break
      }
      case P_VIDRIO:
      case P_HIELO: {
        const sprite = fx(E, tipo === P_VIDRIO ? FX_VIDRIO : FX_HIELO_TROZO)
        if (sprite) {
          dibujarFx(E, sprite, P.cuadro[i], x, y, P.tam[i] * 0.17, P.rot[i], 1, vidaRel < 0.3 ? vidaRel / 0.3 : 1)
          break
        }
        enMundo(E)
        const r = P.tam[i]
        const c = Math.cos(P.rot[i])
        const s = Math.sin(P.rot[i])
        ctx.globalAlpha = vidaRel < 0.3 ? vidaRel / 0.3 : 1
        ctx.beginPath()
        ctx.moveTo(x + c * r, y + s * r)
        ctx.lineTo(x - s * r * 0.55 - c * r * 0.45, y + c * r * 0.55 - s * r * 0.45)
        ctx.lineTo(x + s * r * 0.4 - c * r * 0.62, y - c * r * 0.4 - s * r * 0.62)
        ctx.closePath()
        const destello = Math.sin(P.rot[i] * 3) > 0.7
        if (tipo === P_VIDRIO) {
          ctx.fillStyle = destello ? '#FFFFFF' : 'rgba(214,240,255,0.82)'
          ctx.strokeStyle = 'rgba(130,205,255,0.95)'
        } else {
          ctx.fillStyle = destello ? '#FFFFFF' : '#BDEFFF'
          ctx.strokeStyle = '#4FBCEB'
        }
        ctx.lineWidth = 1
        ctx.fill()
        ctx.stroke()
        break
      }
      case P_GOTA: {
        enMundo(E)
        ctx.globalAlpha = Math.min(1, vidaRel * 2)
        ctx.fillStyle = '#9EE4FF'
        ctx.beginPath()
        ctx.arc(x, y, P.tam[i], 0, TAU)
        ctx.fill()
        break
      }
      case P_MECHON: {
        const t = P.tam[i]
        const alfa = vidaRel < 0.3 ? vidaRel / 0.3 : 1
        const sprite = fx(E, FX_MECHONES)
        if (sprite) {
          dibujarFx(E, sprite, P.cuadro[i], x, y, 0.95 * t, P.rot[i], 1, alfa)
          break
        }
        const img = E.spr.mechones[P.variante[i] % E.spr.mechones.length]
        spriteMundo(E, img, x, y, 15 * t, 6.5 * t, P.rot[i], alfa)
        break
      }
      case P_BRILLO: {
        const img = E.spr.estrella[P.variante[i] % E.spr.estrella.length]
        const titila = 0.6 + 0.4 * Math.sin(E.s * 31 + i * 2.3)
        const t = P.tam[i] * titila * (vidaRel < 0.4 ? vidaRel / 0.4 : 1)
        spriteMundo(E, img, x, y, t, t, P.rot[i], Math.min(1, vidaRel * 2))
        break
      }
      case P_POLVO: {
        const t = P.tam[i] + (P.tamFin[i] - P.tam[i]) * salidaCubica(edadRel)
        const sprite = fx(E, FX_POLVO)
        if (sprite) {
          // el pivote del polvo del atlas está en el piso: la nube crece hacia arriba
          const c = Math.min(sprite.cuadros.length - 1, Math.floor(edadRel * sprite.cuadros.length))
          dibujarFx(E, sprite, c, x, y, P.tamFin[i] / 48, 0, P.vx[i] < 0 ? -1 : 1, Math.min(1, vidaRel * 2.2) * 0.9)
          break
        }
        spriteMundo(E, E.spr.nube[0], x, y, t, t * 0.78, 0, 0.45 * vidaRel)
        break
      }
      case P_NIEBLA: {
        const t = P.tam[i] + (P.tamFin[i] - P.tam[i]) * salidaCubica(edadRel)
        const img = E.spr.nube[P.variante[i] % E.spr.nube.length]
        spriteMundo(E, img, x, y, t, t, 0, (P.variante[i] === 2 ? 0.42 : 0.62) * vidaRel)
        break
      }
      case P_ANIM: {
        const anim = E.fx?.anims[P.variante[i]]
        if (!anim) break
        const edadMs = (P.total[i] - P.vida[i]) * 1000
        dibujarFx(E, anim, cuadroFx(anim, edadMs, false), x, y, P.ancho[i], P.rot[i], P.tamFin[i] < 0 ? -1 : 1, vidaRel < 0.2 ? vidaRel / 0.2 : 1)
        break
      }
      case P_ESTALLIDO: {
        const t = P.tam[i] + (P.tamFin[i] - P.tam[i]) * salidaCubica(Math.min(1, edadRel * 1.7))
        const img = E.spr.estallido[P.variante[i] % E.spr.estallido.length]
        spriteMundo(E, img, x, y, t, t, P.rot[i], vidaRel)
        break
      }
    }
  }
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.imageSmoothingEnabled = true
}

// ─── Emisores ────────────────────────────────────────────────────────────────

function cuantas(E: Escena, n: number): number {
  return Math.max(1, Math.round(n * E.densidad))
}

/** Chispas en abanico. dir: +1/-1 = hacia ese lado, 0 = todas direcciones. */
export function emitirChispas(
  E: Escena,
  x: number,
  y: number,
  n: number,
  dir: number,
  apertura: number,
  vMin: number,
  vMax: number,
  paleta: number,
  grosor = 2.6,
): void {
  const P = E.parts
  const base = dir > 0 ? -0.2 : dir < 0 ? Math.PI + 0.2 : -Math.PI / 2
  for (let c = cuantas(E, n); c > 0; c--) {
    const i = P.nueva(P_CHISPA, x, y, azar(0.16, 0.4))
    if (i < 0) return
    const a = base + azar(-apertura, apertura)
    const v = azar(vMin, vMax)
    P.vx[i] = Math.cos(a) * v
    P.vy[i] = Math.sin(a) * v
    P.grav[i] = 950
    P.roce[i] = 3.2
    P.tam[i] = grosor * azar(0.7, 1.3)
    P.paleta[i] = paleta
  }
}

/** Mechones de pelo cortado que vuelan y caen hamacándose. */
export function emitirMechones(E: Escena, x: number, y: number, n: number, dir: number, fuerza: number): void {
  const P = E.parts
  const variantes = fx(E, FX_MECHONES)?.cuadros.length ?? 1
  for (let c = cuantas(E, n); c > 0; c--) {
    const i = P.nueva(P_MECHON, x + azar(-8, 8), y + azar(-10, 10), azar(1.0, 1.7))
    if (i < 0) return
    const lado = dir === 0 ? (Math.random() < 0.5 ? -1 : 1) : dir
    P.vx[i] = lado * azar(40, 270) * fuerza + azar(-50, 50)
    P.vy[i] = -azar(90, 330) * fuerza
    P.grav[i] = 420
    P.roce[i] = 2.4
    P.rot[i] = azar(0, TAU)
    P.vrot[i] = azar(-10, 10)
    P.tam[i] = azar(0.75, 1.35)
    P.variante[i] = (Math.random() * 12) | 0
    P.cuadro[i] = (Math.random() * variantes) | 0
  }
}

/** Nube de polvo a los pies (la mitad atrás de los luchadores, la mitad adelante). */
export function emitirPolvo(E: Escena, x: number, y: number, n: number, ancho: number, fuerza: number, dirX = 0): void {
  const P = E.parts
  for (let c = cuantas(E, n); c > 0; c--) {
    const i = P.nueva(P_POLVO, x + azar(-ancho, ancho), y - azar(0, 8), azar(0.45, 0.85))
    if (i < 0) return
    P.vx[i] = (dirX !== 0 ? dirX * azar(30, 140) : azar(-1, 1) * 90) * fuerza
    P.vy[i] = -azar(10, 70) * fuerza
    P.roce[i] = 3
    P.grav[i] = -25
    P.tam[i] = azar(14, 24) * Math.sqrt(fuerza)
    P.tamFin[i] = P.tam[i] * azar(2.2, 3.4)
    P.capa[i] = c % 2
  }
}

/** Esquirlas de vidrio (guardia rota) o de hielo (descongelado). */
export function emitirEsquirlas(E: Escena, x: number, y: number, n: number, tipo: number, fuerza: number): void {
  const P = E.parts
  const variantes = fx(E, tipo === P_VIDRIO ? FX_VIDRIO : FX_HIELO_TROZO)?.cuadros.length ?? 1
  for (let c = cuantas(E, n); c > 0; c--) {
    const i = P.nueva(tipo, x + azar(-12, 12), y + azar(-26, 26), azar(0.7, 1.25))
    if (i < 0) return
    const a = azar(0, TAU)
    const v = azar(120, 430) * fuerza
    P.vx[i] = Math.cos(a) * v
    P.vy[i] = Math.sin(a) * v - 170 * fuerza
    P.grav[i] = 1150
    P.roce[i] = 0.8
    P.tam[i] = azar(4, 11)
    P.rot[i] = azar(0, TAU)
    P.vrot[i] = azar(-15, 15)
    P.cuadro[i] = (Math.random() * variantes) | 0
  }
}

/** Destellitos (0 blanco, 1 oro, 2 celeste) alrededor de un punto. */
export function emitirBrillos(E: Escena, x: number, y: number, n: number, variante: number, radio: number, subida = 60): void {
  const P = E.parts
  for (let c = cuantas(E, n); c > 0; c--) {
    const i = P.nueva(P_BRILLO, x + azar(-radio, radio), y + azar(-radio, radio), azar(0.35, 0.85))
    if (i < 0) return
    P.vx[i] = azar(-30, 30)
    P.vy[i] = -azar(0, subida)
    P.roce[i] = 1.5
    P.tam[i] = azar(9, 18)
    P.rot[i] = azar(0, 0.6)
    P.variante[i] = variante
  }
}

export function emitirAnillo(E: Escena, x: number, y: number, r0: number, r1: number, vida: number, paleta: number, grosor = 5): void {
  const i = E.parts.nueva(P_ANILLO, x, y, vida)
  if (i < 0) return
  E.parts.tam[i] = r0
  E.parts.tamFin[i] = r1
  E.parts.paleta[i] = paleta
  E.parts.ancho[i] = grosor
}

/** Estallido de golpe (0 fuego, 1 azul, 2 oro, 3 eléctrico, 4 hielo). */
export function emitirEstallido(E: Escena, x: number, y: number, tam: number, variante: number, vida = 0.17): void {
  const i = E.parts.nueva(P_ESTALLIDO, x, y, vida)
  if (i < 0) return
  E.parts.tam[i] = tam * 0.45
  E.parts.tamFin[i] = tam
  E.parts.variante[i] = variante
  E.parts.rot[i] = azar(0, TAU)
}

/**
 * Un efecto animado del atlas compartido (FX_*) que se reproduce una vez en (x, y).
 * `esc` = unidades de mundo por px del atlas. Devuelve false si el atlas no lo trae (para que
 * quien llama use su respaldo procedural).
 */
export function emitirAnim(E: Escena, id: number, x: number, y: number, esc: number, rot = 0, mira = 1): boolean {
  const anim = fx(E, id)
  if (!anim) return false
  const i = E.parts.nueva(P_ANIM, x, y, duracionFx(anim) / 1000)
  if (i < 0) return true
  E.parts.variante[i] = id
  E.parts.ancho[i] = esc
  E.parts.rot[i] = rot
  E.parts.tamFin[i] = mira < 0 ? -1 : 1
  return true
}

/** Niebla o viento (variante 1 = spray helado, 2 = viento blanco). */
export function emitirNiebla(E: Escena, x: number, y: number, vx: number, vy: number, tam: number, vida: number, variante = 1): void {
  const i = E.parts.nueva(P_NIEBLA, x, y, vida)
  if (i < 0) return
  E.parts.vx[i] = vx
  E.parts.vy[i] = vy
  E.parts.roce[i] = 2.6
  E.parts.grav[i] = -15
  E.parts.tam[i] = tam
  E.parts.tamFin[i] = tam * 2.6
  E.parts.variante[i] = variante
}

/** Chispazos eléctricos que saltan en todas direcciones. */
export function emitirElectricas(E: Escena, x: number, y: number, n: number, radio: number): void {
  const P = E.parts
  for (let c = cuantas(E, n); c > 0; c--) {
    const i = P.nueva(P_ELECTRICA, x + azar(-radio, radio), y + azar(-radio, radio), azar(0.1, 0.24))
    if (i < 0) return
    const a = azar(0, TAU)
    const v = azar(160, 430)
    P.vx[i] = Math.cos(a) * v
    P.vy[i] = Math.sin(a) * v
    P.roce[i] = 4
    P.tam[i] = azar(10, 20)
  }
}

export function emitirGotas(E: Escena, x: number, y: number, n: number, ancho: number): void {
  const P = E.parts
  for (let c = cuantas(E, n); c > 0; c--) {
    const i = P.nueva(P_GOTA, x + azar(-ancho, ancho), y + azar(-ancho, ancho * 0.6), azar(0.5, 0.9))
    if (i < 0) return
    P.vx[i] = azar(-40, 40)
    P.vy[i] = -azar(0, 60)
    P.grav[i] = 900
    P.tam[i] = azar(1.5, 2.8)
  }
}

// ─── Tajos: la medialuna que deja cada golpe ─────────────────────────────────

const MAX_TAJOS = 10

export class Tajos {
  private readonly activo = new Uint8Array(MAX_TAJOS)
  private readonly x = new Float32Array(MAX_TAJOS)
  private readonly y = new Float32Array(MAX_TAJOS)
  private readonly r = new Float32Array(MAX_TAJOS)
  private readonly a0 = new Float32Array(MAX_TAJOS)
  private readonly a1 = new Float32Array(MAX_TAJOS)
  private readonly grosor = new Float32Array(MAX_TAJOS)
  private readonly edad = new Float32Array(MAX_TAJOS)
  private readonly dur = new Float32Array(MAX_TAJOS)
  private readonly mira = new Int8Array(MAX_TAJOS)
  private readonly color: string[] = new Array<string>(MAX_TAJOS).fill('#FFFFFF')

  /**
   * Un tajo con centro (x, y) de mundo, radio r, que barre de a0 a a1 (radianes, mirando a la
   * derecha: 0 = adelante, negativo = arriba). `mira` lo espeja.
   */
  nuevo(x: number, y: number, r: number, a0: number, a1: number, grosor: number, durMs: number, mira: number, color: string): void {
    let i = 0
    let mayor = -1
    for (let k = 0; k < MAX_TAJOS; k++) {
      if (!this.activo[k]) {
        i = k
        mayor = -2
        break
      }
      if (this.edad[k] > mayor) {
        mayor = this.edad[k]
        i = k
      }
    }
    this.activo[i] = 1
    this.x[i] = x
    this.y[i] = y
    this.r[i] = r
    this.a0[i] = a0
    this.a1[i] = a1
    this.grosor[i] = grosor
    this.edad[i] = 0
    this.dur[i] = Math.max(40, durMs)
    this.mira[i] = mira < 0 ? -1 : 1
    this.color[i] = color
  }

  vaciar(): void {
    this.activo.fill(0)
  }

  actualizar(dtMs: number): void {
    for (let i = 0; i < MAX_TAJOS; i++) {
      if (!this.activo[i]) continue
      this.edad[i] += dtMs
      if (this.edad[i] >= this.dur[i]) this.activo[i] = 0
    }
  }

  dibujar(E: Escena): void {
    const ctx = E.ctx
    const k = E.cam.esc
    let alguno = false
    for (let i = 0; i < MAX_TAJOS; i++) {
      if (!this.activo[i]) continue
      if (!alguno) {
        alguno = true
        ctx.globalCompositeOperation = 'lighter'
      }
      const t = this.edad[i] / this.dur[i]
      const a0 = this.a0[i]
      const a1 = this.a1[i]
      // la cabeza barre rápido y la cola la sigue: queda una medialuna que se cierra
      const cabeza = a0 + (a1 - a0) * salidaCubica(Math.min(1, t / 0.5))
      const cola = a0 + (a1 - a0) * Math.max(0, (t - 0.2) / 0.8) * 0.95
      const ini = Math.min(cabeza, cola)
      const fin = Math.max(cabeza, cola)
      const mitad = (fin - ini) / 2
      if (mitad < 0.02) continue
      const r = this.r[i]
      const g = this.grosor[i] * (1 - t * 0.5)
      const medio = ini + mitad
      // el borde interior es otro círculo corrido hacia adentro: el tajo se afina en las puntas
      const d = g / Math.max(0.04, 1 - Math.cos(mitad))
      const icx = -Math.cos(medio) * d
      const icy = -Math.sin(medio) * d
      const r1 = r + d - g
      ctx.setTransform(k * this.mira[i], 0, 0, k, E.cam.tx + k * this.x[i], E.cam.ty + k * this.y[i])
      ctx.globalAlpha = (1 - t * t) * 0.9
      ctx.fillStyle = this.color[i]
      ctx.beginPath()
      ctx.arc(0, 0, r, ini, fin, false)
      const e1 = Math.atan2(Math.sin(fin) * r - icy, Math.cos(fin) * r - icx)
      const e0 = Math.atan2(Math.sin(ini) * r - icy, Math.cos(ini) * r - icx)
      ctx.arc(icx, icy, r1, e1, e0, true)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = '#FFFFFF'
      ctx.lineWidth = 1.4
      ctx.globalAlpha *= 0.85
      ctx.beginPath()
      ctx.arc(0, 0, r, ini + mitad * 0.15, fin, false)
      ctx.stroke()
    }
    if (alguno) {
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
    }
  }
}
