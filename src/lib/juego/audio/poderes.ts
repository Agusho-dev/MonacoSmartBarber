/**
 * Poderes y estados: electricidad, hielo, vidrio, el sillón, el spray, los proyectiles en
 * vuelo (bucles que viven mientras el proyectil existe), el «super flash» de los especiales y
 * el remate «AL CERO».
 */
import type { IconoEspecial, TipoProyectil } from '../tipos'
import type { Mesa, Voz } from './mesa'
import { aleatorio, barrido, envPercusion, envSostenida, midiHz, variar } from './mesa'
import { maquina, silbido, tijera } from './golpes'

/** Corriente: dos ondas que saltan de tono al azar + chisporroteo en ráfagas. */
export function electrico(m: Mesa, t: number, o: { dur: number; pan: number; fuerza: number }): Voz | null {
  const v = m.voz('electrico', t, { pan: o.pan, reverb: 0.14, volumen: 0.5 + 0.4 * o.fuerza })
  if (!v) return null
  const dur = Math.max(o.dur, 0.1)
  const fin = t + dur
  const env = m.ganancia(v, 0, v.salida)
  envSostenida(env.gain, t, 0.01, 0.3, dur - 0.08, 0.08)
  const banda = m.filtro(v, 'bandpass', 1100, 1.4, env)
  const s1 = m.osc(v, 'sawtooth', 92, t, fin + 0.02, banda)
  const s2 = m.osc(v, 'square', 186, t, fin + 0.02, m.ganancia(v, 0.4, banda))
  for (let ti = t + 0.03; ti < fin; ti += aleatorio(0.025, 0.06)) {
    s1.frequency.setValueAtTime(aleatorio(70, 160), ti)
    s2.frequency.setValueAtTime(aleatorio(150, 330), ti)
  }
  const gCh = m.ganancia(v, 0, v.salida)
  const fCh = m.filtro(v, 'highpass', 2500, 0.7, gCh)
  m.ruido(v, t, fin + 0.02, fCh)
  gCh.gain.setValueAtTime(0, t)
  let tc = t + aleatorio(0, 0.01)
  while (tc < fin - 0.04) {
    const d = aleatorio(0.008, 0.03)
    gCh.gain.setValueAtTime(0, tc)
    gCh.gain.linearRampToValueAtTime(aleatorio(0.25, 0.7), tc + 0.0015)
    gCh.gain.exponentialRampToValueAtTime(0.001, tc + d)
    tc += d + aleatorio(0.006, 0.05)
  }
  return v
}

/** El impacto del Corte Relámpago: zap que sube y descarga. */
export function zap(m: Mesa, t: number, pan: number): void {
  const v = m.voz('electrico', t, { pan, reverb: 0.2, volumen: 0.8, saturar: true })
  if (!v) return
  const g = m.ganancia(v, 0, v.salida)
  const f = m.filtro(v, 'lowpass', 3000, 4, g)
  barrido(f.frequency, t, 900, 7000, 0.1)
  const fin = envPercusion(g.gain, t, 0.002, 0.35, 0.16)
  const o1 = m.osc(v, 'sawtooth', 220, t, fin + 0.01, f)
  barrido(o1.frequency, t, 220, 1900, 0.1)
}

const CRISTALES = [2637, 3136, 3520, 4186, 5274, 6272] as const

/** Congelado: el frío que pega («whomp»), el hielo que cruje y cristales que brillan. */
export function congelar(m: Mesa, t: number, pan: number): void {
  const v = m.voz('hielo', t, { pan, reverb: 0.4, volumen: 0.85 })
  if (!v) return
  const gW = m.ganancia(v, 0, v.salida)
  const finW = envPercusion(gW.gain, t, 0.003, 0.45, 0.18)
  const oW = m.osc(v, 'sine', 180, t, finW + 0.01, gW)
  barrido(oW.frequency, t, 180, 70, 0.16)

  const gC = m.ganancia(v, 0, v.salida)
  const am = m.ganancia(v, 0.5, gC)
  m.lfo(v, 'square', 45, 0.5, t, t + 0.82, am.gain)
  const fC = m.filtro(v, 'bandpass', 3500, 3, am)
  barrido(fC.frequency, t, 3500, 8000, 0.45)
  envSostenida(gC.gain, t, 0.05, 0.3, 0.35, 0.45)
  m.ruido(v, t, t + 0.82, fC)

  const k = variar(1, 0.02)
  CRISTALES.forEach((f, i) => {
    const ti = t + 0.04 + i * aleatorio(0.025, 0.045)
    const g = m.ganancia(v, 0, v.salida)
    const fin = envPercusion(g.gain, ti, 0.002, 0.07, 0.5 - i * 0.04)
    m.osc(v, 'sine', f * k * variar(1, 0.008), ti, fin + 0.01, g)
  })
}

/** Se descongela solo (sin romperse): cristales que bajan y una gota. */
export function deshielo(m: Mesa, t: number, pan: number): void {
  const v = m.voz('hielo', t, { pan, reverb: 0.3, volumen: 0.5 })
  if (!v) return
  const notas = [4186, 3520, 3136, 2637, 2093]
  notas.forEach((f, i) => {
    const ti = t + i * 0.07
    const g = m.ganancia(v, 0, v.salida)
    const fin = envPercusion(g.gain, ti, 0.002, 0.06, 0.25)
    m.osc(v, 'sine', f, ti, fin + 0.01, g)
  })
  const tg = t + 0.32
  const gG = m.ganancia(v, 0, v.salida)
  const finG = envPercusion(gG.gain, tg, 0.001, 0.12, 0.07)
  const oG = m.osc(v, 'sine', 900, tg, finG + 0.01, gG)
  barrido(oG.frequency, tg, 900, 2200, 0.04)
}

/** Vidrio que se parte: «crac», esquirlas al azar (más densas al principio) y cola de cristalitos. */
export function rotura(m: Mesa, t: number, o: { pan: number; brillo: number; grave: boolean }): void {
  const v = m.voz('vidrio', t, { pan: o.pan, reverb: 0.3, volumen: 0.9 })
  if (!v) return
  const gK = m.ganancia(v, 0, v.salida)
  const fK = m.filtro(v, 'highpass', 2500, 0.7, gK)
  const finK = envPercusion(gK.gain, t, 0.0005, 0.7, 0.04)
  m.ruido(v, t, finK + 0.01, fK)
  if (o.grave) {
    const gG = m.ganancia(v, 0, v.salida)
    const finG = envPercusion(gG.gain, t, 0.002, 0.55, 0.22)
    const oG = m.osc(v, 'sine', 140, t, finG + 0.01, gG)
    barrido(oG.frequency, t, 140, 55, 0.2)
  }
  for (let i = 0; i < 14; i++) {
    const ti = t + 0.004 + Math.pow(Math.random(), 1.8) * 0.38
    const g = m.ganancia(v, 0, v.salida)
    const fin = envPercusion(g.gain, ti, 0.0008, aleatorio(0.03, 0.09), aleatorio(0.03, 0.12))
    m.osc(v, 'sine', aleatorio(2400, 8800) * o.brillo, ti, fin + 0.01, g)
  }
  const gT = m.ganancia(v, 0, v.salida)
  const fT = m.filtro(v, 'bandpass', 6500 * o.brillo, 1.5, gT)
  const finT = envPercusion(gT.gain, t, 0.01, 0.18, 0.5)
  m.ruido(v, t, finT + 0.01, fT)
}

/** ¡GUARDIA ROTA!: el vidrio del escudo + un tono que se desploma. */
export function guardiaRota(m: Mesa, t: number, pan: number): void {
  rotura(m, t, { pan, brillo: 0.85, grave: true })
  const v = m.voz('vidrio', t, { pan, reverb: 0.25, volumen: 0.6 })
  if (!v) return
  const g = m.ganancia(v, 0, v.salida)
  const f = m.filtro(v, 'lowpass', 2200, 2, g)
  const fin = envPercusion(g.gain, t + 0.02, 0.01, 0.22, 0.42)
  const o = m.osc(v, 'sawtooth', 700, t + 0.02, fin + 0.01, f)
  barrido(o.frequency, t + 0.02, 700, 110, 0.4)
}

const FIERRO_SILLON: ReadonlyArray<readonly [number, number, number]> = [
  [310, 0.25, 0.35],
  [487, 0.2, 0.28],
  [772, 0.16, 0.22],
  [1240, 0.1, 0.16],
  [1830, 0.06, 0.1],
]

/** El golpe seco del sillón: madera y cuero (grave enorme) + el fierro que suena cortito. */
export function golpeSillon(m: Mesa, t: number, pan: number): void {
  const v = m.voz('sillon', t, { pan, reverb: 0.3, volumen: 1, saturar: true })
  if (!v) return
  const gC = m.ganancia(v, 0, v.salida)
  const finC = envPercusion(gC.gain, t, 0.002, 0.9, 0.5)
  const oC = m.osc(v, 'sine', 110, t, finC + 0.01, gC)
  barrido(oC.frequency, t, 110, 38, 0.3)
  const gR = m.ganancia(v, 0, v.salida)
  const fR = m.filtro(v, 'lowpass', 1200, 0.9, gR)
  barrido(fR.frequency, t, 1200, 300, 0.3)
  const finR = envPercusion(gR.gain, t, 0.001, 0.75, 0.3)
  m.ruido(v, t, finR + 0.01, fR, 'rosa')
  const k = variar(1, 0.05)
  for (const [f, a, d] of FIERRO_SILLON) {
    const g = m.ganancia(v, 0, v.salida)
    const fin = envPercusion(g.gain, t, 0.001, a, d)
    m.osc(v, 'triangle', f * k, t, fin + 0.01, g)
  }
  const tc = t + 0.02
  const gK = m.ganancia(v, 0, v.salida)
  const fK = m.filtro(v, 'bandpass', 900, 2, gK)
  const finK = envPercusion(gK.gain, tc, 0.01, 0.2, 0.18)
  m.ruido(v, tc, finK + 0.01, fK)
}

/** El spray de fijación: clic de la válvula y el chorro (ruido agudo que pulsa apenas). */
export function spray(m: Mesa, t: number, o: { pan: number; dur: number; volumen?: number }): Voz | null {
  // separacion: si el motor avisa el mismo chorro por dos lados (swing y proyectil), suena uno.
  const v = m.voz('spray', t, { pan: o.pan, reverb: 0.1, volumen: o.volumen ?? 0.7, separacion: 0.25 })
  if (!v) return null
  const dur = Math.max(o.dur, 0.2)
  const gV = m.ganancia(v, 0, v.salida)
  const fV = m.filtro(v, 'bandpass', 1400, 2, gV)
  const finV = envPercusion(gV.gain, t, 0.0005, 0.35, 0.012)
  m.ruido(v, t, finV + 0.01, fV)
  const tc = t + 0.012
  const env = m.ganancia(v, 0, v.salida)
  envSostenida(env.gain, tc, 0.03, 0.45, dur - 0.15, 0.15)
  const am = m.ganancia(v, 0.8, env)
  m.lfo(v, 'sine', 17, 0.2, tc, tc + dur + 0.02, am.gain)
  const banda = m.filtro(v, 'bandpass', 6500, 0.8, am)
  const pasaAltos = m.filtro(v, 'highpass', 2400, 0.7, banda)
  m.ruido(v, tc, tc + dur + 0.02, pasaAltos)
  return v
}

/** El «pff» del spray cuando alcanza al rival. */
export function puffSpray(m: Mesa, t: number, pan: number): void {
  const v = m.voz('spray', t, { pan, reverb: 0.15, volumen: 0.6 })
  if (!v) return
  const g = m.ganancia(v, 0, v.salida)
  const f = m.filtro(v, 'bandpass', 2500, 1, g)
  barrido(f.frequency, t, 4000, 1800, 0.15)
  const fin = envPercusion(g.gain, t, 0.004, 0.45, 0.16)
  m.ruido(v, t, fin + 0.01, f)
}

/** El tornado de tijeras en vuelo: viento que gira + «tsk» de tijeritas. Lo corta el que lo sigue. */
export function torbellino(m: Mesa, t: number, pan: number, dur = 4): Voz | null {
  const v = m.voz('proyectil', t, { pan, reverb: 0.15, volumen: 0.6 })
  if (!v) return null
  const fin = t + dur
  const env = m.ganancia(v, 0, v.salida)
  envSostenida(env.gain, t, 0.15, 0.5, dur - 0.3, 0.3)
  const am = m.ganancia(v, 0.65, env)
  m.lfo(v, 'sine', 9, 0.35, t, fin + 0.02, am.gain)
  const b1 = m.filtro(v, 'bandpass', 900, 3, am)
  m.lfo(v, 'sine', 5, 500, t, fin + 0.02, b1.frequency)
  m.ruido(v, t, fin + 0.02, b1, 'rosa')
  const b2 = m.filtro(v, 'bandpass', 2600, 4, m.ganancia(v, 0.5, am))
  m.lfo(v, 'sine', 7.3, 900, t, fin + 0.02, b2.frequency)
  m.ruido(v, t, fin + 0.02, b2)
  const gT = m.ganancia(v, 0, v.salida)
  const fT = m.filtro(v, 'highpass', 5500, 0.8, gT)
  m.ruido(v, t, fin + 0.02, fT)
  gT.gain.setValueAtTime(0, t)
  for (let tc = t + 0.08; tc < fin - 0.1; tc += aleatorio(0.09, 0.16)) {
    gT.gain.setValueAtTime(0, tc)
    gT.gain.linearRampToValueAtTime(aleatorio(0.12, 0.28), tc + 0.002)
    gT.gain.exponentialRampToValueAtTime(0.001, tc + 0.03)
  }
  return v
}

/** El sillón girando en el aire: «vuuum vuuum». */
export function sillonVolando(m: Mesa, t: number, pan: number, dur = 3): Voz | null {
  const v = m.voz('proyectil', t, { pan, reverb: 0.1, volumen: 0.7 })
  if (!v) return null
  const fin = t + dur
  const env = m.ganancia(v, 0, v.salida)
  envSostenida(env.gain, t, 0.06, 0.45, dur - 0.2, 0.2)
  const am = m.ganancia(v, 0.55, env)
  m.lfo(v, 'sine', 6, 0.45, t, fin + 0.02, am.gain)
  const b = m.filtro(v, 'bandpass', 700, 1.5, am)
  m.lfo(v, 'sine', 6, 250, t, fin + 0.02, b.frequency)
  m.ruido(v, t, fin + 0.02, b, 'rosa')
  return v
}

/** Lanzamiento de un proyectil (el bucle en vuelo va aparte). */
export function lanzamiento(m: Mesa, t: number, tipo: TipoProyectil, pan: number): void {
  if (tipo === 'tornado') {
    silbido(m, t, { fuerza: 'especial', pan })
    tijera(m, t + 0.03, { pan, cortes: 3, volumen: 0.6 })
  } else if (tipo === 'sillon') {
    silbido(m, t, { fuerza: 'especial', pan })
    const v = m.voz('sillon', t, { pan, volumen: 0.7, saturar: true })
    if (!v) return
    const g = m.ganancia(v, 0, v.salida)
    const f = m.filtro(v, 'lowpass', 500, 1.5, g)
    const fin = envPercusion(g.gain, t, 0.01, 0.45, 0.2)
    const o = m.osc(v, 'sawtooth', 95, t, fin + 0.01, f)
    barrido(o.frequency, t, 95, 70, 0.2)
  } else if (tipo === 'rayo') {
    zap(m, t, pan)
    electrico(m, t, { dur: 0.25, pan, fuerza: 0.6 })
  } else if (tipo === 'spray') {
    // El cono de spray es corto: un chorro de medio segundo cubre el disparo entero.
    spray(m, t, { pan, dur: 0.5 })
  } else {
    // Los del elenco nuevo suenan con lanzamientoElenco (elenco.ts): esto es sólo la red.
    silbido(m, t, { fuerza: 'especial', pan })
  }
}

const CORO = [57, 64, 69, 72] as const

/**
 * El «super flash» de un especial (el mundo se congela 0,4 s): golpe hondo, un coro «aah»
 * de sierras por formantes, brillo que sube, y la capa propia de cada poder.
 */
export function superFlash(m: Mesa, t: number, icono: IconoEspecial, pan: number): void {
  const v = m.voz('especial', t, { pan: pan * 0.5, reverb: 0.45, volumen: 0.95 })
  if (!v) return
  const gB = m.ganancia(v, 0, v.salida)
  const finB = envPercusion(gB.gain, t, 0.002, 0.8, 0.55)
  const oB = m.osc(v, 'sine', 160, t, finB + 0.01, gB)
  barrido(oB.frequency, t, 160, 40, 0.25)
  const gK = m.ganancia(v, 0, v.salida)
  const fK = m.filtro(v, 'highpass', 3000, 0.7, gK)
  const finK = envPercusion(gK.gain, t, 0.0005, 0.35, 0.03)
  m.ruido(v, t, finK + 0.01, fK)

  const gCoro = m.ganancia(v, 0, v.salida)
  const finCoro = envSostenida(gCoro.gain, t, 0.03, 0.2, 0.25, 0.5)
  const f1 = m.filtro(v, 'bandpass', 800, 5, gCoro)
  const f2 = m.filtro(v, 'bandpass', 1150, 6, gCoro)
  for (const n of CORO) {
    const o = m.osc(v, 'sawtooth', midiHz(n) * variar(1, 0.003), t, finCoro + 0.01, f1)
    o.connect(f2)
  }

  const gS = m.ganancia(v, 0, v.salida)
  const fS = m.filtro(v, 'bandpass', 1500, 3, gS)
  barrido(fS.frequency, t, 1500, 9000, 0.35)
  const finS = envPercusion(gS.gain, t, 0.01, 0.18, 0.4)
  m.ruido(v, t, finS + 0.01, fS)

  if (icono === 'rayo') electrico(m, t + 0.02, { dur: 0.4, pan, fuerza: 0.8 })
  else if (icono === 'tijera') tijera(m, t + 0.05, { pan, cortes: 3, volumen: 0.7 })
  else if (icono === 'sillon') grunido(m, t, pan)
  else if (icono === 'spray') brilloHelado(m, t + 0.03, pan)
  // los del elenco nuevo suman su capa desde eventos.ts (superFlashElenco, elenco.ts)
}

/** Sillonazo Brutal: un gruñido grave saturado. */
function grunido(m: Mesa, t: number, pan: number): void {
  const v = m.voz('sillon', t, { pan, volumen: 0.6, saturar: true })
  if (!v) return
  const g = m.ganancia(v, 0, v.salida)
  const f = m.filtro(v, 'lowpass', 420, 3, g)
  const fin = envSostenida(g.gain, t, 0.02, 0.5, 0.22, 0.2)
  m.osc(v, 'sawtooth', 55, t, fin + 0.01, f)
  m.osc(v, 'sawtooth', 82.4, t, fin + 0.01, f)
}

/** Fijación Extrema: destello helado (cristales rápidos que suben). */
function brilloHelado(m: Mesa, t: number, pan: number): void {
  const v = m.voz('hielo', t, { pan, reverb: 0.4, volumen: 0.6 })
  if (!v) return
  CRISTALES.forEach((f, i) => {
    const ti = t + i * 0.03
    const g = m.ganancia(v, 0, v.salida)
    const fin = envPercusion(g.gain, ti, 0.002, 0.06, 0.3)
    m.osc(v, 'triangle', f / 2, ti, fin + 0.01, g)
  })
}

const ACORDE_AL_CERO = [57, 61, 64, 69, 73, 76] as const

/** «¡AL CERO!»: la máquina, el estallido, el pelo que vuela y un acorde mayor de festejo. */
export function alCero(m: Mesa, t: number, pan: number): void {
  maquina(m, t, { dur: 0.3, pan, fuerza: 1 })
  const ti = t + 0.18
  rotura(m, ti, { pan, brillo: 1.2, grave: false })
  const v = m.voz('especial', ti, { pan: pan * 0.4, reverb: 0.5, volumen: 1, saturar: true })
  if (!v) return
  const gB = m.ganancia(v, 0, v.salida)
  const finB = envPercusion(gB.gain, ti, 0.003, 1, 1.2)
  const oB = m.osc(v, 'sine', 80, ti, finB + 0.01, gB)
  barrido(oB.frequency, ti, 80, 28, 0.9)
  const gP = m.ganancia(v, 0, v.salida)
  const fP = m.filtro(v, 'bandpass', 3000, 1.2, gP)
  barrido(fP.frequency, ti, 3000, 400, 0.9)
  envSostenida(gP.gain, ti, 0.02, 0.5, 0.3, 0.6)
  m.ruido(v, ti, ti + 0.95, fP, 'rosa')
  const gA = m.ganancia(v, 0, v.salida)
  const fA = m.filtro(v, 'lowpass', 5000, 1, gA)
  barrido(fA.frequency, ti + 0.05, 5000, 900, 1.1)
  const finA = envSostenida(gA.gain, ti + 0.05, 0.01, 0.1, 0.5, 0.8)
  for (const n of ACORDE_AL_CERO) m.osc(v, 'sawtooth', midiHz(n) * variar(1, 0.002), ti + 0.05, finA + 0.01, fA)
}
