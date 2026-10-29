/**
 * Proyectiles de los especiales. De dónde sale cada dibujo, en orden de preferencia:
 *  - tornado: el embudo animado del atlas compartido → el `tornado` del atlas del dueño → a mano
 *    (anillos de viento). Siempre con tijeras orbitando y pelo que vuela.
 *  - tijeras del tornado: la `tijera` animada compartida → la del dueño → la dibujada.
 *  - sillón: el `sillon` del atlas de Chipi (es el de su hoja) → el compartido → el dibujado.
 *  - spray: la nube animada compartida → la dibujada. El `spray` del atlas de Chipi NO se usa:
 *    el recorte trae a Chipi entero agachado con el aerosol (se vería un segundo Chipi).
 *  - rayo: el relámpago compartido → el `rayo` del dueño → el dibujado.
 *
 * `y` del proyectil = altura sobre el piso (contrato). Para no depender de si el motor marca el
 * centro o la base, el tornado se apoya en el piso y el resto nunca baja de su medio alto.
 */
import type { Partida, ProyectilEstado, CuadroAtlas } from '../tipos'
import { cuadroFx, dibujarFx, fx, FX_RAYO, FX_SILLON, FX_SPRAY, FX_TIJERA, FX_TORNADO } from './efectos'
import { enMundo, spriteMundo, type Escena } from './escena'
import type { AtlasPreparado } from './luchadores'
import { emitirBrillos, emitirElectricas, emitirMechones, emitirNiebla, emitirPolvo } from './particulas'
import { mezcla, TAU } from './util'

const ALTO_TORNADO = 165
const SILLON = 120
/**
 * Dónde dibujar el sillón al soltarlo, relativo al centro de salida del motor (+60/+130 en
 * movimientos.ts): en especial1[1] del atlas de Chipi está a ≈ +102/+117 de los pies.
 */
const SALIDA_SILLON = { dx: 42, dy: -13, ticks: 10 }
const ZIGZAG = new Float32Array(9)

/** Registro del último efecto encontrado (sin crear objetos por cuadro). */
const EF = { at: null as AtlasPreparado | null, c: null as CuadroAtlas[] | null }

/** Busca el sprite `nombre` en el atlas del dueño (o en el del otro). Deja el resultado en EF. */
function buscarEfecto(atlas: readonly (AtlasPreparado | null)[], duenio: number, nombre: string): boolean {
  const propio = atlas[duenio]
  const lista = propio?.efectos[nombre]
  if (propio && lista && lista.length) {
    EF.at = propio
    EF.c = lista
    return true
  }
  const otro = atlas[duenio === 0 ? 1 : 0]
  const lista2 = otro?.efectos[nombre]
  if (otro && lista2 && lista2.length) {
    EF.at = otro
    EF.c = lista2
    return true
  }
  EF.at = null
  EF.c = null
  return false
}

/** Dibuja un sprite de efecto del atlas centrado en su apoyo, con un alto objetivo de mundo. */
function spriteEfecto(
  E: Escena,
  at: AtlasPreparado,
  c: CuadroAtlas,
  x: number,
  y: number,
  alto: number,
  rot: number,
  mira: number,
  alfa: number,
): void {
  const ctx = E.ctx
  const esc = Math.min(at.escala, alto / c.h) * E.cam.esc
  const sx = esc * (mira < 0 ? -1 : 1)
  const cs = Math.cos(rot)
  const sn = Math.sin(rot)
  ctx.setTransform(sx * cs, sx * sn, -esc * sn, esc * cs, E.cam.tx + E.cam.esc * x, E.cam.ty + E.cam.esc * y)
  ctx.globalAlpha = alfa
  ctx.drawImage(at.imagen, c.x, c.y, c.w, c.h, -c.ax, -c.ay, c.w, c.h)
}

/** Partículas que sueltan los proyectiles mientras viajan (tasa por segundo real). */
export function actualizarProyectiles(E: Escena, p: Partida, dtS: number): void {
  const lista = p.proyectiles
  for (let i = 0; i < lista.length; i++) {
    const pr = lista[i]
    const x = pr.x
    switch (pr.tipo) {
      case 'tornado': {
        const base = E.sueloY - Math.max(0, pr.y - ALTO_TORNADO / 2)
        if (Math.random() < dtS * 16 * E.densidad) emitirPolvo(E, x, E.sueloY, 1, 24, 0.8)
        if (Math.random() < dtS * 10 * E.densidad) emitirMechones(E, x, base - Math.random() * ALTO_TORNADO, 1, 0, 0.6)
        if (Math.random() < dtS * 14 * E.densidad) emitirBrillos(E, x, base - Math.random() * ALTO_TORNADO, 1, 0, 30, 30)
        break
      }
      case 'spray': {
        const y = E.sueloY - (pr.y < 30 ? 120 : pr.y)
        if (Math.random() < dtS * 40 * E.densidad) {
          emitirNiebla(E, x + (Math.random() - 0.5) * 50, y + (Math.random() - 0.5) * 40, pr.mira * 60, -10, 16, 0.5, 1)
        }
        break
      }
      case 'rayo': {
        const y = E.sueloY - (pr.y < 30 ? 110 : pr.y)
        if (Math.random() < dtS * 30 * E.densidad) emitirElectricas(E, x, y, 1, 10)
        break
      }
      default:
        break
    }
  }
}

function dibujarTornado(E: Escena, pr: ProyectilEstado, atlas: readonly (AtlasPreparado | null)[]): void {
  const ctx = E.ctx
  const x = pr.x
  const base = E.sueloY - Math.max(0, pr.y - ALTO_TORNADO / 2)
  const t = E.s
  const nace = Math.min(1, pr.edad / 10)
  const H = ALTO_TORNADO * (0.6 + 0.4 * nace)
  const embudo = fx(E, FX_TORNADO)
  const conSprite = !!embudo || buscarEfecto(atlas, pr.duenio, 'tornado')
  // brillo de fondo
  ctx.globalCompositeOperation = 'lighter'
  spriteMundo(E, E.spr.brillo('#CFE6FF'), x, base - H * 0.5, 150, H * 1.25, 0, 0.32)
  if (embudo) {
    ctx.globalCompositeOperation = 'source-over'
    const ref = embudo.cuadros[0]
    dibujarFx(E, embudo, cuadroFx(embudo, E.ms, true), x, base - H * 0.5, H / ref.h, 0, pr.mira, 1)
    ctx.imageSmoothingEnabled = true
    ctx.globalCompositeOperation = 'lighter'
  } else if (EF.at && EF.c) {
    // el sprite pintado, «girando» con un espejo alternado y un leve latido
    const c = EF.c[Math.floor(pr.edad / 4) % EF.c.length]
    const espejo = Math.floor(E.ms / 90) % 2 === 0 ? 1 : -1
    ctx.globalCompositeOperation = 'source-over'
    spriteEfecto(E, EF.at, c, x, base - H * 0.5, H * (1 + 0.04 * Math.sin(t * 14)), 0, espejo, 0.95)
    ctx.globalCompositeOperation = 'lighter'
  }
  // anillos de viento (con el embudo animado sólo unos pocos, de refuerzo)
  enMundo(E)
  const anillos = embudo ? 3 : 8
  for (let j = 0; j < anillos; j++) {
    const f = j / (anillos - 1)
    const cy = base - f * H
    const rx = mezcla(12, 54, f) * (1 + 0.08 * Math.sin(t * 9 + j))
    const ry = rx * 0.27
    const meneo = Math.sin(t * 5 + f * 3) * 10 * f
    const ang = t * 14 + j * 0.9
    ctx.beginPath()
    ctx.ellipse(x + meneo, cy, rx, ry, 0, ang, ang + Math.PI * 1.3)
    ctx.globalAlpha = embudo ? 0.35 : conSprite ? 0.5 : 0.85
    ctx.strokeStyle = 'rgba(190,220,255,0.2)'
    ctx.lineWidth = 9
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'
    ctx.lineWidth = 2.2
    ctx.stroke()
  }
  ctx.globalCompositeOperation = 'source-over'
  // tijeras orbitando (adelante más grandes y opacas)
  const tijFx = fx(E, FX_TIJERA)
  buscarEfecto(atlas, pr.duenio, 'tijera')
  const tijAt = EF.at
  const tij = EF.c
  const spr = E.spr.tijera()
  const cuantas = embudo ? 4 : 6
  for (let k = 0; k < cuantas; k++) {
    const f = (k + 0.5) / cuantas
    const th = t * 9 + (k * TAU) / cuantas
    const r = mezcla(12, 54, f) * 1.08
    const prof = Math.sin(th)
    const meneo = Math.sin(t * 5 + f * 3) * 10 * f
    const px = x + meneo + Math.cos(th) * r
    const py = base - f * H + prof * r * 0.27
    const esc = 0.7 + 0.3 * prof
    const alfa = 0.55 + 0.45 * (prof * 0.5 + 0.5)
    if (tijFx) dibujarFx(E, tijFx, cuadroFx(tijFx, E.ms + k * 60, true), px, py, 1.25 * esc, 0, 1, alfa)
    else if (tijAt && tij) spriteEfecto(E, tijAt, tij[0], px, py, 30 * esc, t * 16 + k, 1, alfa)
    else spriteMundo(E, spr, px, py, 40 * esc, 40 * esc, t * 16 + k, alfa)
  }
  ctx.globalAlpha = 1
  ctx.imageSmoothingEnabled = true
}

/** Un sillón (el del atlas si lo hay, dejado en EF; si no, el dibujado a mano). */
function pintarSillon(E: Escena, x: number, y: number, rot: number, mira: number, alfa: number): void {
  if (EF.at && EF.c) {
    spriteEfecto(E, EF.at, EF.c[0], x, y, SILLON, rot, mira, alfa)
    return
  }
  const compartido = fx(E, FX_SILLON)
  if (compartido) {
    const ref = compartido.cuadros[0]
    dibujarFx(E, compartido, 0, x, y, SILLON / Math.max(ref.w, ref.h), rot, mira, alfa)
    E.ctx.imageSmoothingEnabled = true
    return
  }
  const ctx = E.ctx
  const img = E.spr.sillon()
  const kk = E.cam.esc
  const c = Math.cos(rot) * kk
  const s = Math.sin(rot) * kk
  ctx.setTransform(c * mira, s * mira, -s, c, E.cam.tx + kk * x, E.cam.ty + kk * y)
  ctx.globalAlpha = alfa
  ctx.drawImage(img, -SILLON / 2, -SILLON / 2, SILLON, SILLON)
}

function dibujarSillon(E: Escena, pr: ProyectilEstado, atlas: readonly (AtlasPreparado | null)[]): void {
  const ctx = E.ctx
  const mira = pr.mira < 0 ? -1 : 1
  // Sale de las manos: arranca donde está el sillón en especial1[1] del atlas y se funde con la
  // trayectoria del motor (quieto al soltarlo y acelerando, como un revoleo). La caja de golpe es
  // la del motor; esto es sólo el dibujo.
  const f = pr.edad < SALIDA_SILLON.ticks ? (1 - pr.edad / SALIDA_SILLON.ticks) ** 2 : 0
  const x = pr.x + mira * SALIDA_SILLON.dx * f
  const cy = E.sueloY - Math.max(pr.y + SALIDA_SILLON.dy * f, SILLON * 0.42)
  const giro = pr.rot * mira
  // sombra en el piso, más chica cuanto más alto vuela
  const alto = E.sueloY - cy
  const k = Math.max(0.3, 1 - alto / 360)
  spriteMundo(E, E.spr.sombra, x, E.sueloY + 2, 120 * k, 22 * k, 0, 0.5 * k)
  ctx.globalCompositeOperation = 'lighter'
  const color = atlas[pr.duenio]?.ficha.color ?? '#38D6FF'
  spriteMundo(E, E.spr.brillo(color), x, cy, 190, 190, 0, 0.45)
  ctx.globalCompositeOperation = 'source-over'
  buscarEfecto(atlas, pr.duenio, 'sillon')
  // dos fantasmas atrás: se lee el giro aunque vaya rápido
  const signo = pr.vx * mira >= 0 ? 1 : -1
  pintarSillon(E, x - pr.vx * 3.2, cy + pr.vy * 3.2, giro - signo * 0.6, mira, 0.14)
  pintarSillon(E, x - pr.vx * 1.6, cy + pr.vy * 1.6, giro - signo * 0.3, mira, 0.26)
  pintarSillon(E, x, cy, giro, mira, 1)
  // líneas de velocidad
  enMundo(E)
  ctx.globalCompositeOperation = 'lighter'
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.lineWidth = 2
  ctx.globalAlpha = 0.7
  ctx.beginPath()
  for (let i = 0; i < 4; i++) {
    const oy = cy - 40 + i * 26
    const largo = 40 + ((i * 37 + Math.floor(E.ms / 50)) % 3) * 18
    ctx.moveTo(x - mira * 62, oy)
    ctx.lineTo(x - mira * (62 + largo), oy)
  }
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
}

function dibujarSpray(E: Escena, pr: ProyectilEstado): void {
  const ctx = E.ctx
  const cy = E.sueloY - (pr.y < 30 ? 120 : pr.y)
  const mira = pr.mira < 0 ? -1 : 1
  const crece = Math.min(1, pr.edad / 16)
  const nubeFx = fx(E, FX_SPRAY)
  const conSprite = !!nubeFx
  ctx.globalCompositeOperation = 'lighter'
  if (nubeFx) {
    const ref = nubeFx.cuadros[0]
    const ms = (pr.edad / 60) * 1000
    dibujarFx(E, nubeFx, cuadroFx(nubeFx, ms, false), pr.x, cy, (190 / ref.w) * (0.7 + 0.3 * crece), 0, mira, 0.95)
    ctx.imageSmoothingEnabled = true
  }
  const nube = E.spr.nube[1]
  for (let b = 0; b < 7; b++) {
    const ox = (b - 2) * 17 * mira * crece
    const oy = Math.sin(b * 2.1 + pr.edad * 0.15) * 13 * crece
    const r = (28 + b * 6) * (0.55 + 0.45 * crece)
    spriteMundo(E, nube, pr.x + ox, cy + oy, r * 2, r * 1.7, 0, conSprite ? 0.18 : 0.3)
  }
  const destellos = E.spr.estrella[2]
  for (let b = 0; b < 3; b++) {
    const fase = E.s * 9 + b * 2.2
    const tam = 14 + 8 * Math.sin(fase)
    spriteMundo(E, destellos, pr.x + mira * (b * 26 - 20), cy + Math.cos(fase) * 16, tam, tam, 0, 0.8)
  }
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
}

function dibujarRayo(E: Escena, pr: ProyectilEstado, atlas: readonly (AtlasPreparado | null)[]): void {
  const ctx = E.ctx
  const cy = E.sueloY - (pr.y < 30 ? 110 : pr.y)
  const mira = pr.mira < 0 ? -1 : 1
  ctx.globalCompositeOperation = 'lighter'
  spriteMundo(E, E.spr.brillo('#FFC400'), pr.x, cy, 120, 120, 0, 0.7)
  const rayoFx = fx(E, FX_RAYO)
  if (rayoFx) {
    const ref = rayoFx.cuadros[0]
    dibujarFx(E, rayoFx, cuadroFx(rayoFx, E.ms, true), pr.x - mira * 50, cy, 140 / ref.h, mira > 0 ? -Math.PI / 2 : Math.PI / 2, 1, 1)
    ctx.imageSmoothingEnabled = true
  } else if (buscarEfecto(atlas, pr.duenio, 'rayo') && EF.at && EF.c) {
    spriteEfecto(E, EF.at, EF.c[Math.floor(pr.edad / 3) % EF.c.length], pr.x, cy, 90, 0, mira, 1)
  } else {
    enMundo(E)
    const largo = 130
    // el zigzag se sortea una vez y se traza dos veces (halo y núcleo alineados)
    for (let s = 0; s <= 8; s++) ZIGZAG[s] = s === 0 || s === 8 ? 0 : (Math.random() - 0.5) * 26
    ctx.lineJoin = 'round'
    for (let capa = 0; capa < 2; capa++) {
      ctx.beginPath()
      ctx.moveTo(pr.x + mira * 14, cy)
      for (let s = 1; s <= 8; s++) {
        ctx.lineTo(pr.x + mira * 14 - mira * (largo * s) / 8, cy + ZIGZAG[s])
      }
      ctx.globalAlpha = 1
      ctx.strokeStyle = capa === 0 ? 'rgba(255,196,0,0.5)' : '#FFFFFF'
      ctx.lineWidth = capa === 0 ? 8 : 2.2
      ctx.stroke()
    }
  }
  spriteMundo(E, E.spr.estrella[1], pr.x, cy, 54, 54, E.s * 8, 1)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
}

export function dibujarProyectiles(E: Escena, p: Partida, atlas: readonly (AtlasPreparado | null)[]): void {
  const lista = p.proyectiles
  if (lista.length === 0) return
  E.ctx.imageSmoothingEnabled = true
  for (let i = 0; i < lista.length; i++) {
    const pr = lista[i]
    switch (pr.tipo) {
      case 'tornado':
        dibujarTornado(E, pr, atlas)
        break
      case 'sillon':
        dibujarSillon(E, pr, atlas)
        break
      case 'spray':
        dibujarSpray(E, pr)
        break
      case 'rayo':
        dibujarRayo(E, pr, atlas)
        break
      default: {
        const cy = E.sueloY - Math.max(40, (pr as ProyectilEstado).y)
        E.ctx.globalCompositeOperation = 'lighter'
        spriteMundo(E, E.spr.brillo('#FFFFFF'), (pr as ProyectilEstado).x, cy, 80, 80, 0, 0.9)
        E.ctx.globalCompositeOperation = 'source-over'
      }
    }
  }
  E.ctx.globalAlpha = 1
}
