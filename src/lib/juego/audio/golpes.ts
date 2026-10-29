/**
 * Golpes, bloqueos, silbidos, movimientos y las herramientas (máquina, tijera, peine).
 * Todo sintetizado. Cada llamada varía un poco el tono, el filtro y la textura del ruido
 * (arranca en otro punto del buffer) para que cien golpes seguidos no cansen.
 */
import type { FuerzaGolpe, Herramienta } from '../tipos'
import type { Mesa } from './mesa'
import { aleatorio, barrido, envPercusion, envSostenida, variar } from './mesa'

interface PerfilGolpe {
  /** Frecuencia del «pum» al empezar y al terminar el barrido. */
  f0: number
  f1: number
  cuerpo: number
  amp: number
  /** Pasa bajos del ruido del contacto. */
  corte: number
  ruido: number
  ampRuido: number
  sub: number
  reverb: number
}

const PERFIL: Readonly<Record<FuerzaGolpe, PerfilGolpe>> = {
  leve: { f0: 220, f1: 85, cuerpo: 0.085, amp: 0.55, corte: 4200, ruido: 0.05, ampRuido: 0.4, sub: 0, reverb: 0.03 },
  medio: { f0: 180, f1: 65, cuerpo: 0.12, amp: 0.65, corte: 3400, ruido: 0.075, ampRuido: 0.48, sub: 0, reverb: 0.05 },
  fuerte: { f0: 150, f1: 50, cuerpo: 0.19, amp: 0.75, corte: 2700, ruido: 0.11, ampRuido: 0.55, sub: 0.5, reverb: 0.1 },
  especial: { f0: 130, f1: 42, cuerpo: 0.3, amp: 0.82, corte: 2300, ruido: 0.17, ampRuido: 0.6, sub: 0.65, reverb: 0.2 },
}

export interface OpcionesImpacto {
  fuerza: FuerzaGolpe
  critico: boolean
  pan: number
  /** Cámara lenta (el golpe del KO): más grave y más largo. */
  lento: boolean
}

/** El golpe que entra: «pum» grave + ruido del contacto + chasquido + (sub en los pesados). */
export function impacto(m: Mesa, t: number, o: OpcionesImpacto): void {
  const pf = PERFIL[o.fuerza]
  const pesado = o.critico || o.fuerza === 'fuerte' || o.fuerza === 'especial'
  const v = m.voz('golpe', t, {
    pan: o.pan,
    reverb: o.critico ? 0.26 : pf.reverb,
    saturar: pesado,
    volumen: o.critico ? 1 : 0.92,
  })
  if (!v) return
  const tono = variar(1, 0.08) * (o.lento ? 0.7 : 1)
  const largo = o.lento ? 1.8 : 1

  // 1) El «pum»: sinusoide grave que cae.
  const gC = m.ganancia(v, 0, v.salida)
  const finC = envPercusion(gC.gain, t, 0.0015, pf.amp, pf.cuerpo * largo)
  const oC = m.osc(v, 'sine', pf.f0 * tono, t, finC + 0.01, gC)
  barrido(oC.frequency, t, pf.f0 * tono, pf.f1 * tono, pf.cuerpo * 0.6 * largo)

  // 2) El ruido del contacto, con el filtro que se va cerrando.
  const gR = m.ganancia(v, 0, v.salida)
  const corte = variar(pf.corte, 0.2) * (o.lento ? 0.75 : 1)
  const fR = m.filtro(v, 'lowpass', corte, 0.9, gR)
  barrido(fR.frequency, t, corte, Math.max(380, corte * 0.18), pf.ruido * largo)
  const finR = envPercusion(gR.gain, t, 0.001, pf.ampRuido, pf.ruido * largo)
  m.ruido(v, t, finR + 0.01, fR, Math.random() < 0.5 ? 'blanco' : 'rosa')

  // 3) El chasquido agudo: la «pegada».
  const gK = m.ganancia(v, 0, v.salida)
  const fK = m.filtro(v, 'highpass', variar(5200, 0.2), 0.7, gK)
  const finK = envPercusion(gK.gain, t, 0.0004, o.critico ? 0.42 : 0.3, aleatorio(0.01, 0.02))
  m.ruido(v, t, finK + 0.01, fK)

  // 4) Sub para los pesados.
  if (pf.sub > 0 || o.critico) {
    const gS = m.ganancia(v, 0, v.salida)
    const finS = envPercusion(gS.gain, t, 0.003, Math.max(pf.sub, 0.5), 0.26 * largo)
    const oS = m.osc(v, 'sine', 72 * tono, t, finS + 0.01, gS)
    barrido(oS.frequency, t, 72 * tono, 34 * tono, 0.22 * largo)
  }

  // 5) Uno de cada tres trae una «cachetada» de banda media: otra textura.
  if (Math.random() < 0.35) {
    const tc = t + aleatorio(0.002, 0.008)
    const gB = m.ganancia(v, 0, v.salida)
    const fB = m.filtro(v, 'bandpass', variar(1500, 0.25), 1.3, gB)
    const finB = envPercusion(gB.gain, tc, 0.0008, 0.32, 0.022)
    m.ruido(v, tc, finB + 0.01, fB)
  }

  if (o.critico) brilloCritico(m, t, o.pan)
}

const PARCIALES_CRITICO: ReadonlyArray<readonly [number, number, number]> = [
  [1760, 0.15, 0.5],
  [2640, 0.12, 0.4],
  [3950, 0.08, 0.3],
  [5280, 0.05, 0.22],
]

/** El «¡shing!» del crítico: una campanita de metal y un barrido que sube. */
export function brilloCritico(m: Mesa, t: number, pan: number): void {
  const v = m.voz('anuncio', t, { pan, reverb: 0.35, volumen: 0.85 })
  if (!v) return
  const k = variar(1, 0.03)
  const ti = t + 0.006
  for (const [f, a, d] of PARCIALES_CRITICO) {
    const g = m.ganancia(v, 0, v.salida)
    const fin = envPercusion(g.gain, ti, 0.001, a, d)
    m.osc(v, 'sine', f * k, ti, fin + 0.01, g)
  }
  const gN = m.ganancia(v, 0, v.salida)
  const fN = m.filtro(v, 'bandpass', 2500, 4, gN)
  barrido(fN.frequency, t, 2500, 9000, 0.16)
  const finN = envPercusion(gN.gain, t, 0.004, 0.16, 0.18)
  m.ruido(v, t, finN + 0.01, fN)
}

export interface OpcionesBloqueo {
  fuerza: FuerzaGolpe
  pan: number
  /** Color del escudo: 1 = oro (Simón), ~1,35 = hielo (Chipi). */
  tono: number
}

/** Golpe a la guardia: «toc» seco + el escudo de energía que vibra (+ chispas si es pesado). */
export function bloqueo(m: Mesa, t: number, o: OpcionesBloqueo): void {
  const pesado = o.fuerza === 'fuerte' || o.fuerza === 'especial'
  const v = m.voz('bloqueo', t, { pan: o.pan, reverb: 0.08, volumen: pesado ? 0.85 : 0.7 })
  if (!v) return
  const k = variar(1, 0.06)
  const gT = m.ganancia(v, 0, v.salida)
  const finT = envPercusion(gT.gain, t, 0.001, 0.55, pesado ? 0.09 : 0.06)
  const oT = m.osc(v, 'triangle', 330 * k, t, finT + 0.01, gT)
  barrido(oT.frequency, t, 330 * k, 170 * k, 0.06)

  const gR = m.ganancia(v, 0, v.salida)
  const fR = m.filtro(v, 'bandpass', variar(1600, 0.15), 1.6, gR)
  const finR = envPercusion(gR.gain, t, 0.0008, 0.5, pesado ? 0.07 : 0.045)
  m.ruido(v, t, finR + 0.01, fR)

  const te = t + 0.004
  const escudo: ReadonlyArray<readonly [number, number]> = [
    [1046 * o.tono, 0.09],
    [1568 * o.tono * 1.004, 0.06],
  ]
  for (const [f, a] of escudo) {
    const g = m.ganancia(v, 0, v.salida)
    const fin = envPercusion(g.gain, te, 0.002, a, pesado ? 0.3 : 0.2)
    m.osc(v, 'sine', f * k, te, fin + 0.01, g)
  }

  if (pesado) {
    const tc = t + 0.01
    const gC = m.ganancia(v, 0, v.salida)
    const fC = m.filtro(v, 'highpass', 4200, 0.8, gC)
    const finC = envPercusion(gC.gain, tc, 0.004, 0.2, 0.14)
    m.ruido(v, tc, finC + 0.01, fC)
  }
}

const SILBIDO: Readonly<Record<FuerzaGolpe, { desde: number; hasta: number; dur: number; amp: number }>> = {
  leve: { desde: 900, hasta: 2800, dur: 0.09, amp: 0.5 },
  medio: { desde: 700, hasta: 2300, dur: 0.12, amp: 0.6 },
  fuerte: { desde: 520, hasta: 1900, dur: 0.17, amp: 0.75 },
  especial: { desde: 420, hasta: 1700, dur: 0.24, amp: 0.85 },
}

/** El silbido del brazo o la pierna cortando el aire. */
export function silbido(m: Mesa, t: number, o: { fuerza: FuerzaGolpe; pan: number }): void {
  const s = SILBIDO[o.fuerza]
  const v = m.voz('swing', t, { pan: o.pan, volumen: 0.9 })
  if (!v) return
  const dur = variar(s.dur, 0.12)
  const g = m.ganancia(v, 0, v.salida)
  const f = m.filtro(v, 'bandpass', s.desde, variar(1.6, 0.2), g)
  barrido(f.frequency, t, variar(s.desde, 0.12), variar(s.hasta, 0.12), dur * 0.75)
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(s.amp, t + dur * 0.35)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  m.ruido(v, t, t + dur + 0.01, f)
}

/**
 * La máquina de cortar: motor que arranca (sube de tono), traqueteo de la cuchilla (modulación
 * de amplitud ~36 Hz), un vaivén lento del tono y el zumbido metálico arriba.
 */
export function maquina(m: Mesa, t: number, o: { dur: number; pan: number; fuerza: number }): void {
  const v = m.voz('maquina', t, { pan: o.pan, volumen: 0.55 + 0.35 * o.fuerza, reverb: 0.05 })
  if (!v) return
  const f0 = variar(118, 0.04)
  const fin = t + Math.max(o.dur, 0.08)
  const env = m.ganancia(v, 0, v.salida)
  envSostenida(env.gain, t, 0.025, 0.5, fin - t - 0.05, 0.05)
  const am = m.ganancia(v, 0.62, env)
  m.lfo(v, 'triangle', variar(36, 0.1), 0.38, t, fin + 0.02, am.gain)
  const banda = m.filtro(v, 'bandpass', variar(1700, 0.1), 1.1, am)
  const pasaAltos = m.filtro(v, 'highpass', 260, 0.7, banda)
  const o1 = m.osc(v, 'sawtooth', f0 * 0.6, t, fin + 0.02, pasaAltos)
  o1.frequency.exponentialRampToValueAtTime(f0, t + 0.06)
  m.lfo(v, 'sine', 7, f0 * 0.025, t, fin + 0.02, o1.frequency)
  const g2 = m.ganancia(v, 0.35, pasaAltos)
  const o2 = m.osc(v, 'square', f0 * 1.2, t, fin + 0.02, g2)
  o2.frequency.exponentialRampToValueAtTime(f0 * 2.01, t + 0.06)
  const gZ = m.ganancia(v, 0.14, am)
  const fZ = m.filtro(v, 'bandpass', 4600, 3, gZ)
  m.ruido(v, t, fin + 0.02, fZ)
}

/** La tijera: «snip» metálico (raspado del filo + «tin» + las hojas que cierran), una o dos veces. */
export function tijera(m: Mesa, t: number, o: { pan: number; cortes?: number; volumen?: number }): void {
  const cortes = o.cortes ?? 2
  const v = m.voz('tijera', t, { pan: o.pan, reverb: 0.12, volumen: o.volumen ?? 0.8 })
  if (!v) return
  let tk = t
  for (let k = 0; k < cortes; k++) {
    const sube = 1 + k * 0.06
    const gR = m.ganancia(v, 0, v.salida)
    const fR = m.filtro(v, 'bandpass', variar(6400, 0.1) * sube, 5, gR)
    const fP = m.filtro(v, 'highpass', 3200, 0.7, fR)
    const finR = envPercusion(gR.gain, tk, 0.004, 0.5, 0.03)
    m.ruido(v, tk, finR + 0.01, fP)
    const tt = tk + 0.012
    const tin: ReadonlyArray<readonly [number, number, number]> = [
      [3150, 0.1, 0.07],
      [4720, 0.07, 0.05],
    ]
    for (const [f, a, d] of tin) {
      const g = m.ganancia(v, 0, v.salida)
      const finT = envPercusion(g.gain, tt, 0.001, a, d)
      m.osc(v, 'sine', variar(f, 0.03) * sube, tt, finT + 0.01, g)
    }
    const tc = tk + 0.02
    const gC = m.ganancia(v, 0, v.salida)
    const fC = m.filtro(v, 'bandpass', 2200, 1, gC)
    const finC = envPercusion(gC.gain, tc, 0.0003, 0.35, 0.008)
    m.ruido(v, tc, finC + 0.01, fC)
    tk += variar(0.095, 0.15)
  }
}

/** El peine raspando: un tren de «dientes» (cuadrada ~95→52 Hz que abre y cierra el ruido) + roce. */
export function peine(m: Mesa, t: number, o: { pan: number; dur?: number }): void {
  const dur = variar(o.dur ?? 0.2, 0.1)
  const v = m.voz('peine', t, { pan: o.pan, volumen: 0.75, reverb: 0.05 })
  if (!v) return
  const fin = t + dur
  const env = m.ganancia(v, 0, v.salida)
  envSostenida(env.gain, t, 0.015, 0.5, dur - 0.05, 0.05)
  const am = m.ganancia(v, 0.5, env)
  const dientes = m.lfo(v, 'square', 95, 0.5, t, fin + 0.02, am.gain)
  dientes.frequency.exponentialRampToValueAtTime(52, fin)
  const f = m.filtro(v, 'bandpass', variar(3100, 0.12), 2.4, am)
  m.ruido(v, t, fin + 0.02, f)
  const gS = m.ganancia(v, 0, v.salida)
  const fS = m.filtro(v, 'bandpass', 1200, 0.8, gS)
  envSostenida(gS.gain, t, 0.03, 0.14, dur - 0.04, 0.06)
  m.ruido(v, t, fin + 0.02, fS, 'rosa')
}

/** La capa de la herramienta que acompaña al impacto. Rayo, tornado, sillón y spray van aparte. */
export function capaHerramienta(m: Mesa, t: number, h: Herramienta, pan: number): void {
  if (h === 'maquina') maquina(m, t, { dur: 0.13, pan, fuerza: 0.7 })
  else if (h === 'tijera') tijera(m, t, { pan, cortes: 1, volumen: 0.65 })
  else if (h === 'peine') peine(m, t, { pan, dur: 0.11 })
}

export function salto(m: Mesa, t: number, pan: number): void {
  const v = m.voz('salto', t, { pan, volumen: 0.8, separacion: 0.05 })
  if (!v) return
  const g = m.ganancia(v, 0, v.salida)
  const f = m.filtro(v, 'bandpass', 600, 1.2, g)
  barrido(f.frequency, t, variar(600, 0.1), variar(1900, 0.1), 0.12)
  const fin = envPercusion(g.gain, t, 0.03, 0.6, 0.1)
  m.ruido(v, t, fin + 0.01, f)
}

export function aterrizaje(m: Mesa, t: number, pan: number, fuerte: boolean): void {
  const v = m.voz('aterrizaje', t, { pan, volumen: fuerte ? 0.75 : 0.45, separacion: 0.04 })
  if (!v) return
  const f0 = variar(120, 0.08)
  const gC = m.ganancia(v, 0, v.salida)
  const finC = envPercusion(gC.gain, t, 0.002, 0.6, fuerte ? 0.16 : 0.08)
  const oC = m.osc(v, 'sine', f0, t, finC + 0.01, gC)
  barrido(oC.frequency, t, f0, f0 * 0.42, 0.08)
  const gR = m.ganancia(v, 0, v.salida)
  const fR = m.filtro(v, 'lowpass', fuerte ? 1100 : 700, 0.8, gR)
  const finR = envPercusion(gR.gain, t, 0.002, fuerte ? 0.5 : 0.35, fuerte ? 0.12 : 0.06)
  m.ruido(v, t, finR + 0.01, fR, 'rosa')
}

/** Esquive: un «zip» de aire que sube. */
export function dash(m: Mesa, t: number, pan: number): void {
  const v = m.voz('dash', t, { pan, volumen: 0.8, separacion: 0.05 })
  if (!v) return
  const g = m.ganancia(v, 0, v.salida)
  const f = m.filtro(v, 'bandpass', 1100, 2, g)
  barrido(f.frequency, t, variar(1100, 0.1), variar(5200, 0.1), 0.1)
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(0.85, t + 0.025)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15)
  m.ruido(v, t, t + 0.16, f)
  const gT = m.ganancia(v, 0, v.salida)
  const fin = envPercusion(gT.gain, t, 0.005, 0.12, 0.08)
  const oT = m.osc(v, 'triangle', 300, t, fin + 0.01, gT)
  barrido(oT.frequency, t, 300, 950, 0.08)
}

/** El cuerpo contra el piso, con un rebote. */
export function derribo(m: Mesa, t: number, pan: number): void {
  const v = m.voz('derribo', t, { pan, volumen: 0.9, reverb: 0.12, saturar: true })
  if (!v) return
  const golpes: ReadonlyArray<readonly [number, number, number]> = [
    [0, 0.85, 0.4],
    [0.14, 0.38, 0.14],
  ]
  for (const [dt, a, d] of golpes) {
    const tg = t + dt
    const gC = m.ganancia(v, 0, v.salida)
    const finC = envPercusion(gC.gain, tg, 0.002, a, d)
    const oC = m.osc(v, 'sine', 95, tg, finC + 0.01, gC)
    barrido(oC.frequency, tg, 95, 36, d * 0.8)
    const gR = m.ganancia(v, 0, v.salida)
    const fR = m.filtro(v, 'lowpass', 700, 0.8, gR)
    const finR = envPercusion(gR.gain, tg, 0.002, a * 0.7, d * 0.6)
    m.ruido(v, tg, finR + 0.01, fR, 'rosa')
  }
}
