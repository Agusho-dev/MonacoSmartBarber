/**
 * Instrumentos de la música (sintetizados nota por nota): bombo, caja, palmas, hi-hat,
 * platillo, bajo, arpegio de pulso filtrado, voz líder, colchón y campanita. Cada nota es una
 * voz de la mesa que se descarta sola; los temas (temas.ts) sólo dicen qué tocar y cuándo.
 */
import type { Mesa, Voz } from './mesa'
import { envPercusion, envSostenida, midiHz } from './mesa'
import { campana } from './anuncios'

/** Lo que recibe cada paso de 1/16 de un tema. */
export interface CtxPaso {
  m: Mesa
  /** Salida seca del tema (lleva el fundido del tema). */
  seco: AudioNode
  /** Envío al eco del tema. */
  eco: AudioNode
  /** Paso de 1/16 dentro del tema (0..pasos-1). */
  i: number
  /** Vueltas completas del loop. */
  vuelta: number
  /** Cuándo suena este paso (ya con el swing). */
  t: number
  /** Duración de 1/16 en segundos. */
  d16: number
  /** 0 normal, 1 round final, 2 TURBO. */
  intensidad: number
  /** Prefijo de los tipos de voz: dos temas en fundido no se roban voces entre sí. */
  prefijo: string
}

function vozM(c: CtxPaso, nombre: string, t: number, volumen: number, eco = 0): Voz | null {
  const v = c.m.voz(c.prefijo + ':' + nombre, t, { destino: c.seco, volumen })
  if (v && eco > 0) v.salida.connect(c.m.ganancia(v, eco, c.eco))
  return v
}

export function bombo(c: CtxPaso, t: number, vel = 1): void {
  const v = vozM(c, 'bombo', t, 0.85 * vel)
  if (!v) return
  const { m } = c
  const g = m.ganancia(v, 0, v.salida)
  const fin = envPercusion(g.gain, t, 0.002, 1, 0.34)
  const o = m.osc(v, 'sine', 160, t, fin + 0.01, g)
  o.frequency.exponentialRampToValueAtTime(52, t + 0.07)
  o.frequency.exponentialRampToValueAtTime(42, t + 0.3)
  // El clic hace que el bombo se oiga también en el parlante del celular.
  const gK = m.ganancia(v, 0, v.salida)
  const fK = m.filtro(v, 'bandpass', 3200, 1.2, gK)
  const finK = envPercusion(gK.gain, t, 0.0005, 0.3, 0.012)
  m.ruido(v, t, finK + 0.01, fK)
}

export function caja(c: CtxPaso, t: number, vel = 1): void {
  const v = vozM(c, 'caja', t, 0.5 * vel)
  if (!v) return
  const { m } = c
  const gT = m.ganancia(v, 0, v.salida)
  const finT = envPercusion(gT.gain, t, 0.001, 0.45, 0.1)
  const oT = m.osc(v, 'triangle', 190, t, finT + 0.01, gT)
  oT.frequency.exponentialRampToValueAtTime(150, t + 0.05)
  const gR = m.ganancia(v, 0, v.salida)
  const fR = m.filtro(v, 'bandpass', 3200, 0.6, gR)
  const pa = m.filtro(v, 'highpass', 900, 0.7, fR)
  const finR = envPercusion(gR.gain, t, 0.001, 0.6, 0.17)
  m.ruido(v, t, finR + 0.01, pa)
}

export function palmas(c: CtxPaso, t: number, vel = 1): void {
  const v = vozM(c, 'palmas', t, 0.45 * vel, 0.25)
  if (!v) return
  const { m } = c
  const g = m.ganancia(v, 0, v.salida)
  const f = m.filtro(v, 'bandpass', 1400, 1.2, g)
  g.gain.setValueAtTime(0, t)
  for (const dt of [0, 0.011, 0.022]) {
    g.gain.setValueAtTime(0.7, t + dt)
    g.gain.exponentialRampToValueAtTime(0.1, t + dt + 0.009)
  }
  g.gain.setValueAtTime(0.6, t + 0.033)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
  m.ruido(v, t, t + 0.17, f)
}

export function hihat(c: CtxPaso, t: number, vel = 1, abierto = false): void {
  const v = vozM(c, 'hat', t, 0.16 * vel)
  if (!v) return
  const { m } = c
  const g = m.ganancia(v, 0, v.salida)
  const b = m.filtro(v, 'bandpass', 10500, 0.8, g)
  const pa = m.filtro(v, 'highpass', 7000, 1, b)
  const fin = envPercusion(g.gain, t, 0.001, 1, abierto ? 0.2 : 0.035)
  m.ruido(v, t, fin + 0.01, pa)
}

export function platillo(c: CtxPaso, t: number, vel = 1): void {
  const v = vozM(c, 'platillo', t, 0.2 * vel)
  if (!v) return
  const { m } = c
  const g = m.ganancia(v, 0, v.salida)
  const b = m.filtro(v, 'bandpass', 7000, 0.5, g)
  const pa = m.filtro(v, 'highpass', 3000, 0.7, b)
  const fin = envPercusion(g.gain, t, 0.002, 1, 1.3)
  m.ruido(v, t, fin + 0.01, pa)
}

/** Bajo de pelea: sierra + sub cuadrada, filtro resonante que se cierra (pegada «chiptune moderno»). */
export function bajo(c: CtxPaso, t: number, nota: number, dur: number, vel = 1): void {
  const v = vozM(c, 'bajo', t, 0.32 * vel)
  if (!v) return
  const { m } = c
  const f = midiHz(nota)
  const g = m.ganancia(v, 0, v.salida)
  const fin = envSostenida(g.gain, t, 0.004, 0.8, dur * 0.75, 0.04)
  const filt = m.filtro(v, 'lowpass', 1800, 7, g)
  filt.frequency.setValueAtTime(260 + 1600 * vel, t)
  filt.frequency.exponentialRampToValueAtTime(220, t + Math.max(dur * 0.9, 0.05))
  m.osc(v, 'sawtooth', f, t, fin + 0.01, filt)
  m.osc(v, 'square', f / 2, t, fin + 0.01, m.ganancia(v, 0.35, filt))
}

/** Bajo del menú: triángulo redondo con un sub. */
export function bajoSuave(c: CtxPaso, t: number, nota: number, dur: number, vel = 1): void {
  const v = vozM(c, 'bajo', t, 0.42 * vel)
  if (!v) return
  const { m } = c
  const f = midiHz(nota)
  const g = m.ganancia(v, 0, v.salida)
  const fin = envSostenida(g.gain, t, 0.01, 0.8, dur * 0.85, 0.08)
  const filt = m.filtro(v, 'lowpass', 700, 1, g)
  m.osc(v, 'triangle', f, t, fin + 0.01, filt)
  m.osc(v, 'sine', f / 2, t, fin + 0.01, m.ganancia(v, 0.5, filt))
}

/** Arpegio de onda de pulso filtrada (el brillo lo abre). */
export function arpegio(c: CtxPaso, t: number, nota: number, dur: number, vel = 1, brillo = 0): void {
  const v = vozM(c, 'arp', t, 0.11 * vel, 0.5)
  if (!v) return
  const { m } = c
  const g = m.ganancia(v, 0, v.salida)
  const fin = envPercusion(g.gain, t, 0.002, 1, Math.max(dur, 0.12))
  const filt = m.filtro(v, 'lowpass', 2200, 2, g)
  filt.frequency.setValueAtTime(2200 + 2600 * brillo, t)
  filt.frequency.exponentialRampToValueAtTime(1100, t + 0.09)
  m.osc(v, brillo > 0.5 ? m.pulso12 : m.pulso25, midiHz(nota), t, fin + 0.01, filt)
}

/** Voz líder: pulso con una entradita de tono y vibrato que llega tarde. */
export function lider(c: CtxPaso, t: number, nota: number, dur: number, vel = 1): void {
  const v = vozM(c, 'lider', t, 0.14 * vel, 0.35)
  if (!v) return
  const { m } = c
  const f = midiHz(nota)
  const g = m.ganancia(v, 0, v.salida)
  const fin = envSostenida(g.gain, t, 0.01, 0.9, dur * 0.85, 0.08)
  const filt = m.filtro(v, 'lowpass', 3200, 1, g)
  const o = m.osc(v, m.pulso25, f * 0.985, t, fin + 0.01, filt)
  o.frequency.exponentialRampToValueAtTime(f, t + 0.03)
  if (dur > 0.18) {
    const prof = m.modulador(v, 0, o.frequency)
    m.osc(v, 'sine', 5.5, t, fin + 0.01, prof)
    prof.gain.setValueAtTime(0, t + 0.12)
    prof.gain.linearRampToValueAtTime(f * 0.007, t + 0.25)
  }
}

/** Colchón de acordes: dos sierras desafinadas por nota, filtro que respira. */
export function colchon(c: CtxPaso, t: number, notas: readonly number[], dur: number, vel = 1): void {
  const v = vozM(c, 'pad', t, 0.06 * vel, 0.2)
  if (!v) return
  const { m } = c
  const g = m.ganancia(v, 0, v.salida)
  const fin = envSostenida(g.gain, t, 0.25, 1, Math.max(dur - 0.1, 0.3), 0.5)
  const filt = m.filtro(v, 'lowpass', 1100, 0.7, g)
  m.lfo(v, 'sine', 0.2, 300, t, fin + 0.01, filt.frequency)
  for (const n of notas) {
    for (const desafine of [-7, 7]) {
      const o = m.osc(v, 'sawtooth', midiHz(n), t, fin + 0.01, filt)
      o.detune.value = desafine
    }
  }
}

/** Campanita FM del menú. */
export function campanita(c: CtxPaso, t: number, nota: number, vel = 1): void {
  const v = vozM(c, 'campana', t, 0.5 * vel, 0.45)
  if (!v) return
  campana(c.m, v, t, midiHz(nota), 0.2, 0.7)
}

/** Golpe de acorde final de los jingles (bronces de sierra que se cierran). */
export function acordeFinal(c: CtxPaso, t: number, notas: readonly number[], dur: number, vel = 1): void {
  const v = vozM(c, 'acorde', t, 0.16 * vel, 0.3)
  if (!v) return
  const { m } = c
  const g = m.ganancia(v, 0, v.salida)
  const fin = envSostenida(g.gain, t, 0.006, 1, dur * 0.4, dur * 0.6)
  const filt = m.filtro(v, 'lowpass', 4000, 1.4, g)
  filt.frequency.setValueAtTime(4000, t)
  filt.frequency.exponentialRampToValueAtTime(900, t + dur)
  for (const n of notas) m.osc(v, 'sawtooth', midiHz(n), t, fin + 0.01, filt)
}
