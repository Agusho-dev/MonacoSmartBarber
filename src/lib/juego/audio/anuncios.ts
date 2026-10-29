/**
 * Los sonidos del «locutor» y del ritmo de la pelea: gong del round, «¡A PELEAR!», K.O.,
 * PERFECTO, TIEMPO, TURBO, la carga de la máquina, la tensión de «¡DEJALO AL CERO!», el
 * contador de combo y las burlas. Lo tonal va en La menor (como la música) para que pegue.
 */
import type { Mesa, Voz } from './mesa'
import { barrido, envPercusion, envSostenida, limitar, midiHz, variar } from './mesa'
import { electrico } from './poderes'

const PARCIALES_GONG: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0.5, 3.2],
  [1.48, 0.32, 2.6],
  [1.97, 0.26, 2.2],
  [2.43, 0.2, 1.8],
  [2.97, 0.15, 1.4],
  [3.6, 0.1, 1.1],
  [4.17, 0.08, 0.9],
  [5.3, 0.05, 0.6],
  [8.9, 0.04, 0.4],
  [12.1, 0.03, 0.3],
]

/** Gong del round: parciales inarmónicos (los tres primeros con batido) + el mazazo. */
export function gong(m: Mesa, t: number, final: boolean): void {
  const v = m.voz('gong', t, { reverb: 0.45, volumen: 0.8 })
  if (!v) return
  const f = final ? 82 : 98
  PARCIALES_GONG.forEach(([r, a, d], i) => {
    const g = m.ganancia(v, 0, v.salida)
    const fin = envPercusion(g.gain, t, 0.004, a, d)
    m.osc(v, 'sine', f * r * variar(1, 0.004), t, fin + 0.01, g)
    if (i < 3) m.osc(v, 'sine', f * r + 0.6 + i * 0.3, t, fin + 0.01, g)
  })
  const gM = m.ganancia(v, 0, v.salida)
  const fM = m.filtro(v, 'lowpass', 400, 0.8, gM)
  const finM = envPercusion(gM.gain, t, 0.001, 0.6, 0.08)
  m.ruido(v, t, finM + 0.01, fM, 'rosa')
  const gS = m.ganancia(v, 0, v.salida)
  const finS = envPercusion(gS.gain, t, 0.002, 0.5, 0.25)
  m.osc(v, 'sine', 60, t, finS + 0.01, gS)
  if (final) {
    // ROUND FINAL: un segundo golpe, más grave, que lo hace solemne.
    const t2 = t + 0.42
    const g2 = m.ganancia(v, 0, v.salida)
    const fin2 = envPercusion(g2.gain, t2, 0.004, 0.35, 2.2)
    m.osc(v, 'sine', f * 0.75, t2, fin2 + 0.01, g2)
    m.osc(v, 'sine', f * 0.75 * 1.48, t2, fin2 + 0.01, g2)
  }
}

const BRONCES = [45, 57, 64, 69, 72, 76] as const

/** «¡A PELEAR!»: bombo, platillo y un acorde de bronces en La menor que se cierra. */
export function aPelear(m: Mesa, t: number): void {
  const v = m.voz('anuncio', t, { reverb: 0.35, volumen: 0.85, saturar: true })
  if (!v) return
  const gB = m.ganancia(v, 0, v.salida)
  const finB = envPercusion(gB.gain, t, 0.002, 0.8, 0.35)
  const oB = m.osc(v, 'sine', 150, t, finB + 0.01, gB)
  barrido(oB.frequency, t, 150, 45, 0.12)
  const gP = m.ganancia(v, 0, v.salida)
  const fP = m.filtro(v, 'highpass', 5000, 0.7, gP)
  const finP = envPercusion(gP.gain, t, 0.002, 0.3, 0.6)
  m.ruido(v, t, finP + 0.01, fP)
  const gA = m.ganancia(v, 0, v.salida)
  const fA = m.filtro(v, 'lowpass', 4500, 1.5, gA)
  barrido(fA.frequency, t, 4500, 700, 0.45)
  const finA = envPercusion(gA.gain, t, 0.005, 0.12, 0.5)
  for (const n of BRONCES) m.osc(v, 'sawtooth', midiHz(n) * variar(1, 0.003), t, finA + 0.01, fA)
}

/** K.O.: bum grave con cola larga, estallido que se cierra y retumbe. */
export function ko(m: Mesa, t: number, perfecto: boolean): void {
  const v = m.voz('ko', t, { reverb: 0.5, saturar: true, volumen: 1 })
  if (v) {
    const gB = m.ganancia(v, 0, v.salida)
    const finB = envPercusion(gB.gain, t, 0.003, 1, 1.6)
    const oB = m.osc(v, 'sine', 75, t, finB + 0.01, gB)
    barrido(oB.frequency, t, 75, 27, 1.1)
    // armónico para que el bum se oiga también en el parlante del celular
    const gH = m.ganancia(v, 0, v.salida)
    const finH = envPercusion(gH.gain, t, 0.002, 0.45, 0.5)
    const oH = m.osc(v, 'triangle', 150, t, finH + 0.01, gH)
    barrido(oH.frequency, t, 150, 55, 0.45)
    const gE = m.ganancia(v, 0, v.salida)
    const fE = m.filtro(v, 'lowpass', 7000, 0.8, gE)
    barrido(fE.frequency, t, 7000, 250, 1)
    const finE = envPercusion(gE.gain, t, 0.001, 0.8, 1.2)
    m.ruido(v, t, finE + 0.01, fE)
    const gR = m.ganancia(v, 0, v.salida)
    const fR = m.filtro(v, 'lowpass', 300, 0.7, gR)
    const finR = envPercusion(gR.gain, t, 0.01, 0.6, 1.5)
    m.ruido(v, t, finR + 0.01, fR, 'marron')
  }
  if (perfecto) campanasPerfecto(m, t + 0.55)
}

const PERFECTO = [81, 85, 88, 93, 97] as const

/** PERFECTO: campanitas FM en La mayor que suben. */
export function campanasPerfecto(m: Mesa, t: number): void {
  const v = m.voz('anuncio', t, { reverb: 0.5, volumen: 0.7 })
  if (!v) return
  PERFECTO.forEach((n, i) => campana(m, v, t + i * 0.09, midiHz(n), 0.16, 0.9))
}

/** Campanita FM (portadora + moduladora ×2 con índice que cae). */
export function campana(m: Mesa, v: Voz, t: number, f: number, amp: number, dur: number): void {
  const g = m.ganancia(v, 0, v.salida)
  const fin = envPercusion(g.gain, t, 0.002, amp, dur)
  const p = m.osc(v, 'sine', f, t, fin + 0.01, g)
  const indice = m.modulador(v, 0, p.frequency)
  indice.gain.setValueAtTime(f * 1.6, t)
  indice.gain.exponentialRampToValueAtTime(f * 0.08, t + dur * 0.5)
  m.osc(v, 'sine', f * 2, t, fin + 0.01, indice)
}

/** ¡TIEMPO!: chicharra disonante + un golpe grave. */
export function tiempo(m: Mesa, t: number): void {
  const v = m.voz('anuncio', t, { reverb: 0.25, volumen: 0.75 })
  if (!v) return
  const env = m.ganancia(v, 0, v.salida)
  envSostenida(env.gain, t, 0.005, 0.2, 0.7, 0.15)
  const am = m.ganancia(v, 0.8, env)
  m.lfo(v, 'square', 12, 0.2, t, t + 0.9, am.gain)
  const f = m.filtro(v, 'lowpass', 1800, 1, am)
  m.osc(v, 'square', 220, t, t + 0.9, f)
  m.osc(v, 'square', 233, t, t + 0.9, f)
  const gG = m.ganancia(v, 0, v.salida)
  const finG = envPercusion(gG.gain, t, 0.002, 0.6, 0.4)
  const oG = m.osc(v, 'sine', 70, t, finG + 0.01, gG)
  barrido(oG.frequency, t, 70, 40, 0.3)
}

const ARPEGIO_TURBO = [81, 84, 88, 93] as const

/** TURBO: sierra que sube con el filtro abriéndose, ruido que sube, arpegio de poder y un rayo. */
export function turbo(m: Mesa, t: number): void {
  const v = m.voz('anuncio', t, { reverb: 0.3, volumen: 0.9 })
  if (!v) return
  const g = m.ganancia(v, 0, v.salida)
  envSostenida(g.gain, t, 0.05, 0.22, 0.6, 0.2)
  const f = m.filtro(v, 'lowpass', 400, 6, g)
  barrido(f.frequency, t, 400, 6000, 0.7)
  const o = m.osc(v, 'sawtooth', 110, t, t + 0.82, f)
  barrido(o.frequency, t, 110, 880, 0.7)
  const gR = m.ganancia(v, 0, v.salida)
  const fR = m.filtro(v, 'bandpass', 800, 2, gR)
  barrido(fR.frequency, t, 800, 8000, 0.7)
  envSostenida(gR.gain, t, 0.4, 0.2, 0.62, 0.15)
  m.ruido(v, t, t + 0.8, fR)
  ARPEGIO_TURBO.forEach((n, i) => {
    const ti = t + 0.6 + i * 0.06
    const gN = m.ganancia(v, 0, v.salida)
    const fin = envPercusion(gN.gain, ti, 0.002, 0.16, i === ARPEGIO_TURBO.length - 1 ? 0.45 : 0.08)
    m.osc(v, m.pulso25, midiHz(n), ti, fin + 0.01, gN)
  })
  electrico(m, t + 0.62, { dur: 0.18, pan: 0, fuerza: 0.5 })
}

/** Escala de la carga: pentatónica de La menor, una nota por unidad (de Mi5 a Re7). */
const ESCALA_CARGA = [76, 79, 81, 84, 86, 88, 91, 93, 96, 98] as const

/**
 * «Ding» de la carga. `lista` = alcanzó el costo de un especial; `llena` = 10 de 10.
 * El común suena bajito (llega uno cada 2,2 s toda la partida); el de «lista» se destaca.
 */
export function carga(m: Mesa, t: number, o: { nivel: number; lista: boolean; llena: boolean; pan: number }): void {
  const destacado = o.lista || o.llena
  const v = m.voz('carga', t, { pan: o.pan, reverb: 0.2, volumen: destacado ? 0.6 : 0.36, separacion: 0.03 })
  if (!v) return
  const n = ESCALA_CARGA[limitar(Math.round(o.nivel) - 1, 0, ESCALA_CARGA.length - 1)]
  campana(m, v, t, midiHz(n), 0.3, 0.45)
  if (destacado) {
    campana(m, v, t + 0.07, midiHz(n + 7), 0.22, 0.5)
    const gB = m.ganancia(v, 0, v.salida)
    const fB = m.filtro(v, 'highpass', 7000, 0.7, gB)
    const finB = envPercusion(gB.gain, t + 0.07, 0.01, 0.1, 0.18)
    m.ruido(v, t + 0.07, finB + 0.01, fB)
  }
  if (o.llena) campana(m, v, t + 0.14, midiHz(n + 12), 0.18, 0.7)
}

/** Apretó un especial sin carga: «bzzt» grave doble (corto, para no molestar). */
export function sinCarga(m: Mesa, t: number): void {
  const v = m.voz('ui', t, { volumen: 0.55, separacion: 0.12 })
  if (!v) return
  const f = m.filtro(v, 'lowpass', 900, 1, v.salida)
  for (const dt of [0, 0.11]) {
    const g = m.ganancia(v, 0, f)
    const fin = envSostenida(g.gain, t + dt, 0.004, 0.28, 0.06, 0.02)
    m.osc(v, 'square', 140, t + dt, fin + 0.01, g)
  }
}

/**
 * «¡DEJALO AL CERO!»: latido que se acelera, dron grave que sube y tic-tac. Se agenda entero
 * (3,4 s) y lo corta el remate o el fin de la partida.
 */
export function tension(m: Mesa, t: number, dur = 3.4): Voz | null {
  const v = m.voz('tension', t, { volumen: 0.6 })
  if (!v) return null
  const fin = t + dur
  const gD = m.ganancia(v, 0, v.salida)
  gD.gain.setValueAtTime(0, t)
  gD.gain.linearRampToValueAtTime(0.2, t + dur * 0.8)
  gD.gain.linearRampToValueAtTime(0, fin)
  const fD = m.filtro(v, 'lowpass', 220, 4, gD)
  m.lfo(v, 'sine', 0.8, 90, t, fin + 0.02, fD.frequency)
  const d1 = m.osc(v, 'sawtooth', 55, t, fin + 0.02, fD)
  d1.frequency.linearRampToValueAtTime(61.7, fin)
  m.osc(v, 'sawtooth', 55.4, t, fin + 0.02, fD)

  let periodo = 0.62
  for (let tb = t; tb < fin - 0.15; tb += periodo) {
    for (const [dt, a] of [
      [0, 0.75],
      [0.13, 0.5],
    ] as const) {
      const tl = tb + dt
      const g = m.ganancia(v, 0, v.salida)
      const finL = envPercusion(g.gain, tl, 0.004, a, 0.12)
      const o = m.osc(v, 'sine', 68, tl, finL + 0.01, g)
      barrido(o.frequency, tl, 68, 42, 0.1)
    }
    periodo = Math.max(0.36, periodo * 0.9)
  }
  for (let tt = t + 0.25; tt < fin - 0.05; tt += 0.25) {
    const g = m.ganancia(v, 0, v.salida)
    const f = m.filtro(v, 'bandpass', 3800, 6, g)
    const finT = envPercusion(g.gain, tt, 0.0005, 0.14, 0.02)
    m.ruido(v, tt, finT + 0.01, f)
  }
  return v
}

/** La burla: un silbido pícaro de dos subidas. */
export function burla(m: Mesa, t: number, pan: number): void {
  const v = m.voz('anuncio', t, { pan, reverb: 0.2, volumen: 0.5 })
  if (!v) return
  const subidas: ReadonlyArray<readonly [number, number, number, number]> = [
    [0, 1100, 1900, 0.12],
    [0.2, 1300, 2300, 0.16],
  ]
  for (const [dt, desde, hasta, d] of subidas) {
    const ts = t + dt
    const g = m.ganancia(v, 0, v.salida)
    const fin = envSostenida(g.gain, ts, 0.01, 0.22, d, 0.05)
    const o = m.osc(v, 'sine', desde, ts, fin + 0.01, g)
    barrido(o.frequency, ts, desde, hasta, d)
    m.lfo(v, 'sine', 7, 25, ts, fin + 0.01, o.frequency)
  }
}

/** Presentación: aire que sube y un golpe con brillo cuando posan. */
export function presentacion(m: Mesa, t: number): void {
  const v = m.voz('anuncio', t, { reverb: 0.35, volumen: 0.75 })
  if (!v) return
  const g = m.ganancia(v, 0, v.salida)
  const f = m.filtro(v, 'bandpass', 300, 1.5, g)
  barrido(f.frequency, t, 300, 3500, 0.6)
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(0.25, t + 0.5)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7)
  m.ruido(v, t, t + 0.72, f, 'rosa')
  const tg = t + 0.6
  const gB = m.ganancia(v, 0, v.salida)
  const finB = envPercusion(gB.gain, tg, 0.002, 0.7, 0.4)
  const oB = m.osc(v, 'sine', 120, tg, finB + 0.01, gB)
  barrido(oB.frequency, tg, 120, 40, 0.3)
  const gM = m.ganancia(v, 0, v.salida)
  const finM = envPercusion(gM.gain, tg, 0.001, 0.08, 0.6)
  m.osc(v, 'sine', 1760, tg, finM + 0.01, gM)
  m.osc(v, 'sine', 2640, tg, finM + 0.01, gM)
}

const ESCALA_COMBO = [81, 84, 86, 88, 91, 93, 96, 98, 100, 103] as const

/** Contador de combo: un «tic» que sube por la pentatónica con cada golpe encadenado. */
export function comboTic(m: Mesa, t: number, golpes: number, pan: number): void {
  const v = m.voz('combo', t, { pan, volumen: 0.7, separacion: 0.04 })
  if (!v) return
  const n = ESCALA_COMBO[limitar(golpes - 2, 0, ESCALA_COMBO.length - 1)]
  const f = m.filtro(v, 'lowpass', 5000, 0.7, v.salida)
  const g = m.ganancia(v, 0, f)
  const fin = envPercusion(g.gain, t, 0.001, 0.2, 0.09)
  m.osc(v, m.pulso25, midiHz(n), t, fin + 0.01, g)
  const g2 = m.ganancia(v, 0, f)
  const fin2 = envPercusion(g2.gain, t, 0.001, 0.09, 0.12)
  m.osc(v, 'triangle', midiHz(n + 12), t, fin2 + 0.01, g2)
}

/** Fin del round: tres notas que suben (ganó el jugador) o dos que bajan (perdió). */
export function finRound(m: Mesa, t: number, gano: boolean): void {
  const v = m.voz('anuncio', t + 0.25, { reverb: 0.3, volumen: 0.55 })
  if (!v) return
  const notas = gano ? [81, 84, 88] : [76, 72]
  notas.forEach((n, i) => {
    const ti = t + 0.25 + i * (gano ? 0.09 : 0.16)
    const g = m.ganancia(v, 0, v.salida)
    const fin = envPercusion(g.gain, ti, 0.003, 0.16, i === notas.length - 1 ? 0.45 : 0.12)
    m.osc(v, gano ? m.pulso25 : 'triangle', midiHz(n), ti, fin + 0.01, g)
  })
}
