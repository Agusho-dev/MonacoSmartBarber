/**
 * Sonidos de la interfaz (menús, elegir barbero, VS, resultado). Cortos y limpios: se tocan
 * mucho y no pueden cansar. Lo tonal va en La (como la música).
 */
import type { SonidoUi } from '../tipos'
import type { Mesa } from './mesa'
import { barrido, envPercusion, midiHz, variar } from './mesa'
import { electrico } from './poderes'

/** Dos o más notas cortas de pulso, en fila. */
function blips(m: Mesa, t: number, notas: readonly number[], paso: number, amp: number, forma: 'pulso' | 'triangle'): void {
  const v = m.voz('ui', t, { volumen: 0.6 })
  if (!v) return
  const f = m.filtro(v, 'lowpass', 4200, 0.7, v.salida)
  notas.forEach((n, i) => {
    const ti = t + i * paso
    const g = m.ganancia(v, 0, f)
    const fin = envPercusion(g.gain, ti, 0.002, amp, i === notas.length - 1 ? 0.14 : paso * 0.9)
    m.osc(v, forma === 'pulso' ? m.pulso25 : 'triangle', midiHz(n), ti, fin + 0.01, g)
  })
}

function tocar(m: Mesa, t: number): void {
  const v = m.voz('ui', t, { volumen: 0.45, separacion: 0.025 })
  if (!v) return
  const g = m.ganancia(v, 0, v.salida)
  const fin = envPercusion(g.gain, t, 0.001, 0.3, 0.03)
  const o = m.osc(v, 'sine', variar(1650, 0.02), t, fin + 0.01, g)
  barrido(o.frequency, t, 1650, 1200, 0.03)
  const gK = m.ganancia(v, 0, v.salida)
  const fK = m.filtro(v, 'highpass', 4000, 0.7, gK)
  const finK = envPercusion(gK.gain, t, 0.0005, 0.2, 0.006)
  m.ruido(v, t, finK + 0.01, fK)
}

function confirmar(m: Mesa, t: number): void {
  blips(m, t, [81, 88], 0.065, 0.2, 'pulso')
  const v = m.voz('ui', t + 0.065, { volumen: 0.5, reverb: 0.25 })
  if (!v) return
  const g = m.ganancia(v, 0, v.salida)
  const fin = envPercusion(g.gain, t + 0.065, 0.003, 0.08, 0.25)
  m.osc(v, 'sine', midiHz(100), t + 0.065, fin + 0.01, g)
}

/** Elegir barbero: «shing» de metal, acorde que se cierra y un golpe chico. */
function elegir(m: Mesa, t: number): void {
  const v = m.voz('ui', t, { volumen: 0.75, reverb: 0.3 })
  if (!v) return
  const gS = m.ganancia(v, 0, v.salida)
  const fS = m.filtro(v, 'bandpass', 2000, 3, gS)
  barrido(fS.frequency, t, 2000, 8000, 0.12)
  const finS = envPercusion(gS.gain, t, 0.004, 0.22, 0.16)
  m.ruido(v, t, finS + 0.01, fS)
  const gA = m.ganancia(v, 0, v.salida)
  const fA = m.filtro(v, 'lowpass', 3000, 2, gA)
  barrido(fA.frequency, t, 3000, 600, 0.25)
  const finA = envPercusion(gA.gain, t, 0.004, 0.1, 0.28)
  for (const n of [57, 64, 69]) m.osc(v, 'sawtooth', midiHz(n), t, finA + 0.01, fA)
  const gB = m.ganancia(v, 0, v.salida)
  const finB = envPercusion(gB.gain, t, 0.002, 0.5, 0.14)
  const oB = m.osc(v, 'sine', 140, t, finB + 0.01, gB)
  barrido(oB.frequency, t, 140, 50, 0.1)
}

/** VS: golpe enorme, platillo que se cierra y un chispazo. */
function vs(m: Mesa, t: number): void {
  const v = m.voz('anuncio', t, { volumen: 0.9, reverb: 0.4, saturar: true })
  if (v) {
    const gB = m.ganancia(v, 0, v.salida)
    const finB = envPercusion(gB.gain, t, 0.002, 0.9, 0.6)
    const oB = m.osc(v, 'sine', 120, t, finB + 0.01, gB)
    barrido(oB.frequency, t, 120, 35, 0.45)
    const gC = m.ganancia(v, 0, v.salida)
    const fC = m.filtro(v, 'lowpass', 5000, 0.8, gC)
    barrido(fC.frequency, t, 5000, 400, 0.8)
    const finC = envPercusion(gC.gain, t, 0.001, 0.6, 0.8)
    m.ruido(v, t, finC + 0.01, fC)
    const gA = m.ganancia(v, 0, v.salida)
    const fA = m.filtro(v, 'lowpass', 2500, 2, gA)
    barrido(fA.frequency, t, 2500, 300, 0.7)
    const finA = envPercusion(gA.gain, t, 0.004, 0.09, 0.8)
    for (const n of [33, 45, 52]) m.osc(v, 'sawtooth', midiHz(n), t, finA + 0.01, fA)
  }
  electrico(m, t + 0.03, { dur: 0.35, pan: 0, fuerza: 0.7 })
}

function error(m: Mesa, t: number): void {
  const v = m.voz('ui', t, { volumen: 0.5, separacion: 0.1 })
  if (!v) return
  const f = m.filtro(v, 'lowpass', 1500, 1, v.salida)
  const tonos: ReadonlyArray<readonly [number, number]> = [
    [0, 220],
    [0.1, 175],
  ]
  for (const [dt, hz] of tonos) {
    const g = m.ganancia(v, 0, f)
    const fin = envPercusion(g.gain, t + dt, 0.003, 0.22, 0.08)
    m.osc(v, 'square', hz, t + dt, fin + 0.01, g)
  }
}

/** Puntaje que cuenta: un «tic» cortito que sube de tono mientras dura la racha. */
function puntos(m: Mesa, t: number, racha: number): void {
  const v = m.voz('puntos', t, { volumen: 0.8, separacion: 0.03 })
  if (!v) return
  const hz = Math.min(900 * Math.pow(2, racha / 24), 2600)
  const g = m.ganancia(v, 0, v.salida)
  const fin = envPercusion(g.gain, t, 0.001, 0.2, 0.025)
  m.osc(v, 'triangle', hz, t, fin + 0.01, g)
}

/** `racha` = cuántos «puntos» seguidos van (lo lleva el que llama). */
export function sonidoUi(m: Mesa, t: number, s: SonidoUi, racha: number): void {
  switch (s) {
    case 'tocar':
      tocar(m, t)
      break
    case 'confirmar':
      confirmar(m, t)
      break
    case 'atras':
      blips(m, t, [88, 81], 0.06, 0.2, 'triangle')
      break
    case 'elegir':
      elegir(m, t)
      break
    case 'vs':
      vs(m, t)
      break
    case 'error':
      error(m, t)
      break
    case 'puntos':
      puntos(m, t, racha)
      break
  }
}
