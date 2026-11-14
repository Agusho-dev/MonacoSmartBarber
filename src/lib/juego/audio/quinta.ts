/**
 * Sonidos de la quinta tanda (14/nov), todo sintetizado como el resto: las cartas y el dominio de Chino,
 * el theremín, la hipnosis y la tijera de Fran, el Gigante y el revoleo de Lautaro, las herramientas y
 * el spray de Leo, el error, el teclado y el código de Nacho, el pádel de Nehuen, los aros de vibráfono y
 * las púas de Nico M., y el monopatín eléctrico, los bronces, el sello y el sollozo del Despido de Tony.
 *
 * Las reglas de la mesa son las de elenco.ts: cada sonido es UNA voz con tope por tipo (TOPES en
 * mesa.ts) y anti-ráfaga donde llegan seguidos; los bucles (proyectiles en vuelo, el dominio, el
 * hipnotizado) devuelven su voz para que eventos.ts los panee y los corte. Volúmenes por debajo de los
 * golpes: bucles 0,28–0,5, impactos 0,55–0,9. Lo que suena en un tick del especial sin evento propio
 * (el Gigante que crece, el reaparecer de Nehuen, el papel del Despido) lo dispara eventos.ts con las
 * marcas del kit (audio/kit.ts).
 */
import type { Mesa, Voz } from './mesa'
import { aleatorio, barrido, envPercusion, envSostenida, midiHz, suavizar, variar } from './mesa'
import { campana } from './anuncios'
import { crepitar, cristal, tic, tun } from './elenco'

// ─── Chino ───────────────────────────────────────────────────────────────────

/** El «flick» de un naipe que sale (uno por carta). */
export function naipe(m: Mesa, t: number, pan: number, volumen = 0.62): void {
  const v = m.voz('naipe', t, { pan, reverb: 0.1, volumen, separacion: 0.025 })
  if (!v) return
  const g = m.ganancia(v, 0, v.salida)
  const f = m.filtro(v, 'bandpass', variar(4200, 0.08), 1.4, g)
  barrido(f.frequency, t, 5400, 2500, 0.05)
  const fin = envPercusion(g.gain, t, 0.001, 0.55, 0.05)
  m.ruido(v, t, fin + 0.01, f)
  tic(m, v, t, 'highpass', 6500, 0.7, 0.3, 0.008)
}

/** El naipe en vuelo: un «fwip» que aletea, más agudo que la pelota (bucle). */
export function naipeVolando(m: Mesa, t: number, pan: number, dur = 1): Voz | null {
  const v = m.voz('proyectil', t, { pan, volumen: 0.32 })
  if (!v) return null
  const fin = t + dur
  const env = m.ganancia(v, 0, v.salida)
  envSostenida(env.gain, t, 0.03, 0.5, dur - 0.1, 0.1)
  const am = m.ganancia(v, 0.5, env)
  m.lfo(v, 'square', 16, 0.45, t, fin + 0.02, am.gain)
  m.ruido(v, t, fin + 0.02, m.filtro(v, 'bandpass', 3600, 1.3, am))
  return v
}

/** El cachetazo de papel de la carta que entra. */
export function cachetazo(m: Mesa, t: number, pan: number): void {
  const v = m.voz('naipe', t, { pan, reverb: 0.12, volumen: 0.75 })
  if (!v) return
  tic(m, v, t, 'bandpass', 1800, 1.1, 0.7, 0.04)
  tic(m, v, t, 'highpass', 4000, 0.7, 0.35, 0.02)
  tun(m, v, t, 420, 240, 0.25, 0.05, 'triangle')
}

/** Un click seco (la carta que se cubre). */
export function clickSeco(m: Mesa, t: number, pan: number): void {
  const v = m.voz('naipe', t, { pan, volumen: 0.55, separacion: 0.02 })
  if (!v) return
  tic(m, v, t, 'bandpass', 2600, 3, 0.6, 0.012)
  tic(m, v, t, 'lowpass', 900, 1, 0.3, 0.02)
}

/** Fichas de casino que caen (tintineos agudos al azar). */
function fichas(m: Mesa, v: Voz, t: number, n: number, dur: number, pico: number): void {
  for (let i = 0; i < n; i++) {
    const tc = t + Math.random() * dur
    const g = m.ganancia(v, 0, v.salida)
    const fin = envPercusion(g.gain, tc, 0.001, aleatorio(pico * 0.5, pico), aleatorio(0.025, 0.05))
    m.osc(v, 'triangle', aleatorio(2300, 3700), tc, fin + 0.01, g)
  }
}

/**
 * El dominio del All In: zumbido grave y un barajar suave, mientras la contra está armada (bucle: lo
 * corta eventos.ts en el tick en que el dominio vuelve a 0).
 */
export function dominio(m: Mesa, t: number, pan: number, dur = 2): Voz | null {
  // 0,2: es un bucle de fondo (≈ −13 dBFS de pico, como el sismo de Brian); con 0,5 tapaba los golpes
  const v = m.voz('dominio', t, { pan, reverb: 0.25, volumen: 0.2 })
  if (!v) return null
  const fin = t + dur
  const env = m.ganancia(v, 0, v.salida)
  envSostenida(env.gain, t, 0.06, 0.5, dur - 0.15, 0.15)
  const f = m.filtro(v, 'lowpass', 320, 3, env)
  for (const hz of [55, 55.8]) m.osc(v, 'sawtooth', hz, t, fin + 0.02, f)
  m.osc(v, 'sine', 110, t, fin + 0.02, m.ganancia(v, 0.25, env))
  for (let tb = t + 0.05; tb < fin - 0.05; tb += aleatorio(0.06, 0.11)) tic(m, v, tb, 'bandpass', aleatorio(2400, 3200), 1.5, 0.16, 0.02)
  return v
}

/** ¡ALL IN!: lluvia de fichas, un «ding» y un golpe grave. */
export function allIn(m: Mesa, t: number, pan: number): void {
  const v = m.voz('dominio', t, { pan, reverb: 0.4, volumen: 0.82, saturar: true })
  if (!v) return
  tun(m, v, t, 95, 38, 1, 0.4)
  campana(m, v, t + 0.02, midiHz(91), 0.2, 0.7)
  fichas(m, v, t + 0.05, 11, 0.45, 0.18)
}

/** La cola de fichas del golpe con todo (la embestida después de la contra). */
export function colaFichas(m: Mesa, t: number, pan: number): void {
  const v = m.voz('dominio', t, { pan, reverb: 0.3, volumen: 0.6 })
  if (v) fichas(m, v, t + 0.04, 7, 0.32, 0.15)
}

// ─── Fran ────────────────────────────────────────────────────────────────────

/** Los Lentes: un theremín que sube y un «ping» de vidrio. */
export function theremin(m: Mesa, t: number, pan: number): void {
  const v = m.voz('hipnosis', t, { pan, reverb: 0.45, volumen: 0.6 })
  if (!v) return
  const g = m.ganancia(v, 0, v.salida)
  const fin = envSostenida(g.gain, t, 0.05, 0.36, 0.32, 0.2)
  const o = m.osc(v, 'sine', 330, t, fin + 0.01, g)
  o.frequency.exponentialRampToValueAtTime(880, t + 0.4)
  m.lfo(v, 'sine', 6.5, 18, t, fin + 0.01, o.frequency)
  cristal(m, v, t + 0.04, variar(2637, 0.02), 0.12)
}

/** La mirada en vuelo: un «wah» que va y viene (bucle). */
export function wahVolando(m: Mesa, t: number, pan: number, dur = 1.2): Voz | null {
  const v = m.voz('proyectil', t, { pan, reverb: 0.2, volumen: 0.3 })
  if (!v) return null
  const fin = t + dur
  const env = m.ganancia(v, 0, v.salida)
  envSostenida(env.gain, t, 0.05, 0.5, dur - 0.15, 0.15)
  const f = m.filtro(v, 'bandpass', 800, 6, env)
  m.lfo(v, 'sine', 2.6, 520, t, fin + 0.02, f.frequency)
  m.osc(v, 'sawtooth', 196, t, fin + 0.02, f)
  return v
}

/** El hipnotizado: un tono que ondula mientras dura (bucle; lo corta el «pop»). */
export function hipnotizado(m: Mesa, t: number, pan: number, dur = 1.6): Voz | null {
  const v = m.voz('hipnosis', t, { pan, reverb: 0.35, volumen: 0.16 })
  if (!v) return null
  const fin = t + dur
  const env = m.ganancia(v, 0, v.salida)
  envSostenida(env.gain, t, 0.08, 0.42, dur - 0.2, 0.2)
  const am = m.ganancia(v, 0.65, env)
  m.lfo(v, 'sine', 2.1, 0.32, t, fin + 0.02, am.gain)
  for (const hz of [466, 473]) {
    const o = m.osc(v, 'sine', hz, t, fin + 0.02, am)
    m.lfo(v, 'sine', 3, 30, t, fin + 0.02, o.frequency)
  }
  m.osc(v, 'triangle', 233, t, fin + 0.02, m.ganancia(v, 0.3, am))
  return v
}

/** El «pop» del que se despierta de la hipnosis. */
export function pop(m: Mesa, t: number, pan: number): void {
  const v = m.voz('hipnosis', t, { pan, reverb: 0.2, volumen: 0.6, separacion: 0.05 })
  if (!v) return
  const g = m.ganancia(v, 0, v.salida)
  const fin = envPercusion(g.gain, t, 0.002, 0.5, 0.07)
  const o = m.osc(v, 'sine', 500, t, fin + 0.01, g)
  barrido(o.frequency, t, 500, 1300, 0.04)
  tic(m, v, t, 'highpass', 5000, 0.7, 0.2, 0.01)
}

/** El «shk» metálico de la tijera grande que se levanta (el Corte de Precisión). */
export function shk(m: Mesa, t: number, pan: number): void {
  const v = m.voz('metal', t, { pan, reverb: 0.2, volumen: 0.7, separacion: 0.05 })
  if (!v) return
  const g = m.ganancia(v, 0, v.salida)
  const fin = envPercusion(g.gain, t, 0.003, 0.5, 0.07)
  m.ruido(v, t, fin + 0.01, m.filtro(v, 'highpass', 5500, 0.8, g))
  for (const [hz, a] of [
    [4200, 0.08],
    [6100, 0.05],
  ] as const) {
    const gs = m.ganancia(v, 0, v.salida)
    const finS = envPercusion(gs.gain, t + 0.01, 0.002, a, 0.18)
    m.osc(v, 'sine', hz, t + 0.01, finS + 0.01, gs)
  }
}

/** El «ting» cristalino de la punta (crítico seguro). */
export function tingCristalino(m: Mesa, t: number, pan: number): void {
  const v = m.voz('metal', t, { pan, reverb: 0.5, volumen: 0.7 })
  if (!v) return
  cristal(m, v, t, 3951, 0.16)
  cristal(m, v, t + 0.03, 5274, 0.08)
}

// ─── Lautaro ─────────────────────────────────────────────────────────────────

/** El Gigante crece: un barrido que sube con chisporroteo eléctrico. */
export function crecer(m: Mesa, t: number, pan: number): void {
  const v = m.voz('gigante', t, { pan, reverb: 0.3, volumen: 0.66 })
  if (!v) return
  const dur = 0.62
  const g = m.ganancia(v, 0, v.salida)
  envSostenida(g.gain, t, 0.08, 0.42, dur * 0.7, dur * 0.3)
  const f = m.filtro(v, 'lowpass', 400, 3, g)
  barrido(f.frequency, t, 400, 2200, dur)
  const o = m.osc(v, 'sawtooth', 70, t, t + dur + 0.02, f)
  barrido(o.frequency, t, 70, 280, dur)
  crepitar(m, v, t, t + dur, 3200, 0.2, 1.2)
}

/** El paso enorme: un «boom» grave. */
export function pasoGigante(m: Mesa, t: number, pan: number): void {
  const v = m.voz('gigante', t, { pan, reverb: 0.35, volumen: 0.85, saturar: true })
  if (!v) return
  tun(m, v, t, 72, 34, 1, 0.5)
  tic(m, v, t, 'lowpass', 300, 0.8, 0.55, 0.3)
}

/** El aplastón: impacto muy grave y un derrumbe. */
export function aplaston(m: Mesa, t: number, pan: number): void {
  const v = m.voz('gigante', t, { pan, reverb: 0.42, volumen: 0.86, saturar: true })
  if (!v) return
  tun(m, v, t, 58, 24, 1, 0.8)
  tic(m, v, t, 'lowpass', 220, 0.8, 0.75, 0.7)
  for (let i = 0; i < 8; i++) tic(m, v, t + 0.05 + Math.random() * 0.5, 'bandpass', aleatorio(700, 1900), 4, aleatorio(0.2, 0.45), aleatorio(0.02, 0.045))
}

/** Se achica: un barrido que baja. */
export function achicar(m: Mesa, t: number, pan: number): void {
  const v = m.voz('gigante', t, { pan, reverb: 0.3, volumen: 0.55 })
  if (!v) return
  const dur = 0.45
  const g = m.ganancia(v, 0, v.salida)
  envSostenida(g.gain, t, 0.03, 0.36, dur * 0.6, dur * 0.4)
  const f = m.filtro(v, 'lowpass', 1800, 2.5, g)
  barrido(f.frequency, t, 1800, 380, dur)
  const o = m.osc(v, 'sawtooth', 260, t, t + dur + 0.02, f)
  barrido(o.frequency, t, 260, 70, dur)
}

/** El «hup» sordo del Lanzamiento Aéreo (distinto del gruñido de Brian). */
export function hup(m: Mesa, t: number, pan: number): void {
  const v = m.voz('agarre', t, { pan, reverb: 0.15, volumen: 0.8, saturar: true })
  if (!v) return
  const g = m.ganancia(v, 0, v.salida)
  const fin = envSostenida(g.gain, t, 0.01, 0.5, 0.09, 0.07)
  const f1 = m.filtro(v, 'bandpass', 650, 4, g)
  const f2 = m.filtro(v, 'bandpass', 1100, 5, m.ganancia(v, 0.6, g))
  const o = m.osc(v, 'sawtooth', 130, t, fin + 0.01, f1)
  o.connect(f2)
  o.frequency.linearRampToValueAtTime(108, fin)
  tic(m, v, t, 'lowpass', 700, 0.8, 0.45, 0.05)
}

/** El revoleo: un whoosh que sube. */
export function whooshSube(m: Mesa, t: number, pan: number): void {
  const v = m.voz('swing', t, { pan, volumen: 0.8 })
  if (!v) return
  const dur = 0.36
  const g = m.ganancia(v, 0, v.salida)
  const f = m.filtro(v, 'bandpass', 350, 1.4, g)
  barrido(f.frequency, t, 350, 3200, dur)
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(0.55, t + dur * 0.7)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  m.ruido(v, t, t + dur + 0.01, f)
}

/** El revoleado cae: un estruendo grave. */
export function estruendo(m: Mesa, t: number, pan: number): void {
  const v = m.voz('gigante', t, { pan, reverb: 0.4, volumen: 0.82, saturar: true })
  if (!v) return
  tun(m, v, t, 64, 28, 1, 0.7)
  const g = m.ganancia(v, 0, v.salida)
  const fin = envPercusion(g.gain, t, 0.002, 0.6, 0.55)
  m.ruido(v, t, fin + 0.01, m.filtro(v, 'lowpass', 200, 1, g), 'marron')
  for (let i = 0; i < 5; i++) tic(m, v, t + 0.04 + Math.random() * 0.35, 'bandpass', aleatorio(800, 1800), 4, aleatorio(0.2, 0.4), 0.03)
}

// ─── Leo ─────────────────────────────────────────────────────────────────────

/** Cada herramienta que sale: un «fsst» metálico (y el clic de la tijera en la del medio). */
export function fsstMetal(m: Mesa, t: number, pan: number, conTijera: boolean): void {
  const v = m.voz('metal', t, { pan, reverb: 0.15, volumen: 0.62, separacion: 0.03 })
  if (!v) return
  const g = m.ganancia(v, 0, v.salida)
  const f = m.filtro(v, 'bandpass', 5200, 2, g)
  barrido(f.frequency, t, 6500, 3500, 0.1)
  const fin = envPercusion(g.gain, t, 0.004, 0.45, 0.1)
  m.ruido(v, t, fin + 0.01, f)
  for (const [hz, a] of [
    [2900, 0.06],
    [4400, 0.04],
  ] as const) {
    const gs = m.ganancia(v, 0, v.salida)
    const finS = envPercusion(gs.gain, t + 0.02, 0.002, a, 0.14)
    m.osc(v, 'sine', hz, t + 0.02, finS + 0.01, gs)
  }
  if (conTijera) {
    tic(m, v, t + 0.03, 'bandpass', 3800, 4, 0.45, 0.015)
    tic(m, v, t + 0.09, 'bandpass', 4300, 4, 0.4, 0.015)
  }
}

/** Las herramientas en vuelo: un zumbido metálico (bucle). */
export function zumbidoMetal(m: Mesa, t: number, pan: number, dur = 1): Voz | null {
  const v = m.voz('proyectil', t, { pan, volumen: 0.3 })
  if (!v) return null
  const fin = t + dur
  const env = m.ganancia(v, 0, v.salida)
  envSostenida(env.gain, t, 0.03, 0.5, dur - 0.1, 0.1)
  const am = m.ganancia(v, 0.6, env)
  m.lfo(v, 'triangle', 22, 0.35, t, fin + 0.02, am.gain)
  const f = m.filtro(v, 'bandpass', 900, 2, am)
  m.osc(v, 'triangle', 310, t, fin + 0.02, f)
  m.osc(v, 'square', 467, t, fin + 0.02, m.ganancia(v, 0.3, f))
  return v
}

/** El «clank» metálico de la herramienta que entra. */
export function clank(m: Mesa, t: number, pan: number): void {
  const v = m.voz('metal', t, { pan, reverb: 0.22, volumen: 0.78 })
  if (!v) return
  for (const [hz, a, d] of [
    [690, 0.3, 0.22],
    [1130, 0.22, 0.18],
    [1870, 0.14, 0.14],
    [2650, 0.09, 0.1],
  ] as const) {
    const g = m.ganancia(v, 0, v.salida)
    const fin = envPercusion(g.gain, t, 0.001, a, d)
    m.osc(v, 'sine', hz * variar(1, 0.02), t, fin + 0.01, g)
  }
  tic(m, v, t, 'bandpass', 3000, 1.5, 0.5, 0.02)
}

/** El «tic» de la herramienta que se cubre. */
export function ticMetal(m: Mesa, t: number, pan: number): void {
  const v = m.voz('metal', t, { pan, volumen: 0.5, separacion: 0.02 })
  if (v) tic(m, v, t, 'bandpass', 3300, 5, 0.5, 0.015)
}

/** La lata del spray: «clac-clac» de la bolita. */
export function lata(m: Mesa, t: number, pan: number): void {
  const v = m.voz('metal', t, { pan, reverb: 0.1, volumen: 0.6 })
  if (!v) return
  tic(m, v, t, 'bandpass', 2400, 6, 0.5, 0.02)
  tic(m, v, t + 0.09, 'bandpass', 2600, 6, 0.45, 0.02)
}

/** El «psssshhh» que se abre (el Spray Cegador). */
export function psss(m: Mesa, t: number, pan: number): void {
  const v = m.voz('spray', t, { pan, reverb: 0.15, volumen: 0.6 })
  if (!v) return
  const dur = 0.5
  const g = m.ganancia(v, 0, v.salida)
  envSostenida(g.gain, t, 0.02, 0.45, dur * 0.65, dur * 0.35)
  const f = m.filtro(v, 'bandpass', 3000, 0.8, g)
  barrido(f.frequency, t, 3000, 7500, dur * 0.6)
  m.ruido(v, t, t + dur + 0.02, m.filtro(v, 'highpass', 2600, 0.7, f))
}

/** Cegado: un pitido apagado. */
export function pitidoApagado(m: Mesa, t: number, pan: number): void {
  const v = m.voz('estado', t, { pan, reverb: 0.3, volumen: 0.5, separacion: 0.2 })
  if (!v) return
  const g = m.ganancia(v, 0, v.salida)
  const fin = envSostenida(g.gain, t, 0.01, 0.35, 0.28, 0.1)
  const am = m.ganancia(v, 0.7, g)
  m.lfo(v, 'sine', 9, 0.3, t, fin + 0.01, am.gain)
  m.osc(v, 'sine', 980, t, fin + 0.01, m.filtro(v, 'lowpass', 1300, 1, am))
}

// ─── Nacho ───────────────────────────────────────────────────────────────────

/** El «bip» de error de sistema con estática (el agarre de Nacho). */
export function errorBip(m: Mesa, t: number, pan: number): void {
  const v = m.voz('glitch', t, { pan, reverb: 0.15, volumen: 0.6 })
  if (!v) return
  const f = m.filtro(v, 'lowpass', 3000, 1, v.salida)
  for (const [dt, hz] of [
    [0, 880],
    [0.12, 622],
  ] as const) {
    const g = m.ganancia(v, 0, f)
    const fin = envSostenida(g.gain, t + dt, 0.003, 0.28, 0.1, 0.02)
    m.osc(v, 'square', hz, t + dt, fin + 0.01, g)
  }
  // estática
  const gE = m.ganancia(v, 0, v.salida)
  gE.gain.setValueAtTime(0, t)
  for (let tc = t; tc < t + 0.26; tc += aleatorio(0.02, 0.05)) {
    gE.gain.setValueAtTime(aleatorio(0.05, 0.22), tc)
    gE.gain.setValueAtTime(0, tc + aleatorio(0.006, 0.018))
  }
  m.ruido(v, t, t + 0.3, m.filtro(v, 'bandpass', 2500, 0.8, gE))
}

/** Los apretones: una ráfaga de teclado. */
export function teclado(m: Mesa, t: number, pan: number): void {
  const v = m.voz('glitch', t, { pan, volumen: 0.55, separacion: 0.04 })
  if (!v) return
  let tc = t
  for (let i = 0; i < 6; i++) {
    tic(m, v, tc, 'bandpass', aleatorio(2600, 4200), 3, aleatorio(0.3, 0.45), 0.012)
    tc += aleatorio(0.03, 0.05)
  }
}

/** El tirón: golpe grave y un «crash» de dos notas que bajan. */
export function crashSistema(m: Mesa, t: number, pan: number): void {
  const v = m.voz('glitch', t, { pan, reverb: 0.3, volumen: 0.78, saturar: true })
  if (!v) return
  tun(m, v, t, 90, 40, 0.9, 0.35)
  const f = m.filtro(v, 'lowpass', 2600, 1, v.salida)
  for (const [dt, nota] of [
    [0.02, 76],
    [0.17, 69],
  ] as const) {
    const g = m.ganancia(v, 0, f)
    const fin = envSostenida(g.gain, t + dt, 0.005, 0.3, 0.12, 0.08)
    m.osc(v, 'triangle', midiHz(nota), t + dt, fin + 0.01, g)
    m.osc(v, 'square', midiHz(nota) * 0.5, t + dt, fin + 0.01, m.ganancia(v, 0.25, g))
  }
}

/** El robo de carga: un barrido que baja. */
export function barridoBaja(m: Mesa, t: number, pan: number): void {
  const v = m.voz('glitch', t, { pan, reverb: 0.25, volumen: 0.5, separacion: 0.1 })
  if (!v) return
  const g = m.ganancia(v, 0, v.salida)
  const fin = envSostenida(g.gain, t, 0.01, 0.34, 0.3, 0.15)
  const o = m.osc(v, 'sine', 1200, t, fin + 0.01, g)
  barrido(o.frequency, t, 1200, 180, 0.45)
}

/** El Laptopazo: clac de plástico y un pique digital. */
export function laptop(m: Mesa, t: number, pan: number): void {
  const v = m.voz('glitch', t, { pan, volumen: 0.6, separacion: 0.03 })
  if (!v) return
  tic(m, v, t, 'bandpass', 1500, 2, 0.6, 0.03)
  const g = m.ganancia(v, 0, v.salida)
  const fin = envPercusion(g.gain, t + 0.01, 0.002, 0.16, 0.06)
  const o = m.osc(v, 'square', 1800, t + 0.01, fin + 0.01, m.filtro(v, 'lowpass', 3000, 1, g))
  barrido(o.frequency, t + 0.01, 1800, 600, 0.05)
}

/** Las manos al piso del Terremoto: golpe sordo y un zumbido de datos. */
export function manosAlPiso(m: Mesa, t: number, pan: number): void {
  const v = m.voz('codigo', t, { pan, reverb: 0.3, volumen: 0.8, saturar: true })
  if (!v) return
  tun(m, v, t, 82, 40, 0.9, 0.3)
  const g = m.ganancia(v, 0, v.salida)
  const fin = envSostenida(g.gain, t + 0.03, 0.02, 0.26, 0.35, 0.15)
  const am = m.ganancia(v, 0.6, g)
  m.lfo(v, 'square', 38, 0.4, t + 0.03, fin + 0.01, am.gain)
  m.osc(v, 'square', 110, t + 0.03, fin + 0.01, m.filtro(v, 'bandpass', 900, 2, am))
}

/** El aviso de cada columna: «tic-tic-tic» que sube. */
export function ticTicTic(m: Mesa, t: number, pan: number, dur: number): void {
  const v = m.voz('codigo', t, { pan, volumen: 0.5 })
  if (!v) return
  for (let i = 0; i < 3; i++) {
    const tc = t + (i * dur) / 3
    const g = m.ganancia(v, 0, v.salida)
    const fin = envPercusion(g.gain, tc, 0.001, 0.28, 0.03)
    m.osc(v, 'triangle', 1100 * Math.pow(1.25, i), tc, fin + 0.01, g)
  }
}

/** Una columna revienta el piso: golpe grave con un derrumbe corto. */
export function estallaColumna(m: Mesa, t: number, pan: number): void {
  const v = m.voz('codigo', t, { pan, reverb: 0.3, volumen: 0.78, saturar: true })
  if (!v) return
  tun(m, v, t, 70, 30, 1, 0.35)
  tic(m, v, t, 'lowpass', 260, 0.8, 0.6, 0.3)
  for (let i = 0; i < 4; i++) tic(m, v, t + 0.03 + Math.random() * 0.25, 'bandpass', aleatorio(800, 1800), 4, aleatorio(0.15, 0.3), 0.03)
}

// ─── Nehuen ──────────────────────────────────────────────────────────────────

/** Desaparece: un «fsss» que se apaga con eco. */
export function fsssEco(m: Mesa, t: number, pan: number): void {
  const v = m.voz('padel', t, { pan, reverb: 0.5, volumen: 0.6 })
  if (!v) return
  for (const [dt, a] of [
    [0, 0.42],
    [0.13, 0.2],
    [0.26, 0.1],
  ] as const) {
    const g = m.ganancia(v, 0, v.salida)
    const fin = envSostenida(g.gain, t + dt, 0.01, a, 0.12, 0.18)
    m.ruido(v, t + dt, fin + 0.01, m.filtro(v, 'bandpass', 2200, 1, g))
  }
}

/** Reaparece: un «whoom» inverso (crece y se corta). */
export function whoomInverso(m: Mesa, t: number, pan: number): void {
  const v = m.voz('padel', t, { pan, reverb: 0.3, volumen: 0.62 })
  if (!v) return
  const dur = 0.26
  const g = m.ganancia(v, 0, v.salida)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.5, t + dur)
  g.gain.linearRampToValueAtTime(0, t + dur + 0.03)
  const f = m.filtro(v, 'lowpass', 500, 1.5, g)
  barrido(f.frequency, t, 500, 2600, dur)
  m.ruido(v, t, t + dur + 0.05, f)
  const o = m.osc(v, 'sine', 120, t, t + dur + 0.05, m.ganancia(v, 0.5, g))
  barrido(o.frequency, t, 120, 240, dur)
}

/** El «pock» de la pelota de pádel (más agudo al devolver). */
export function pock(m: Mesa, t: number, pan: number, agudo = false): void {
  const v = m.voz('padel', t, { pan, reverb: 0.15, volumen: 0.75, separacion: 0.03 })
  if (!v) return
  tic(m, v, t, 'bandpass', agudo ? 2600 : 1800, 2, 0.6, 0.03)
  tun(m, v, t, agudo ? 1200 : 850, agudo ? 800 : 560, 0.45, 0.04, 'triangle')
}

/** La paleta que barre: «zwip». */
export function zwip(m: Mesa, t: number, pan: number): void {
  const v = m.voz('swing', t, { pan, volumen: 0.75 })
  if (!v) return
  const g = m.ganancia(v, 0, v.salida)
  const f = m.filtro(v, 'bandpass', 1200, 1.6, g)
  barrido(f.frequency, t, 1200, 5200, 0.12)
  const fin = envSostenida(g.gain, t, 0.02, 0.5, 0.06, 0.06)
  m.ruido(v, t, fin + 0.01, f)
}

/** El tiro devuelto: «clang» vidrioso (el blindex de la cancha). */
export function clangVidrioso(m: Mesa, t: number, pan: number): void {
  const v = m.voz('vidrio', t, { pan, reverb: 0.5, volumen: 0.55 })
  if (!v) return
  for (const [hz, a, d] of [
    [1850, 0.16, 0.5],
    [2860, 0.11, 0.4],
    [4120, 0.07, 0.3],
  ] as const) {
    const g = m.ganancia(v, 0, v.salida)
    const fin = envPercusion(g.gain, t, 0.001, a, d)
    m.osc(v, 'sine', hz * variar(1, 0.01), t, fin + 0.01, g)
  }
}

/** La pelota en vuelo: un silbido corto (bucle). */
export function silbidoPelota(m: Mesa, t: number, pan: number, dur = 0.9): Voz | null {
  const v = m.voz('proyectil', t, { pan, volumen: 0.28 })
  if (!v) return null
  const fin = t + dur
  const env = m.ganancia(v, 0, v.salida)
  envSostenida(env.gain, t, 0.03, 0.45, dur - 0.1, 0.1)
  const o = m.osc(v, 'sine', 2300, t, fin + 0.02, env)
  m.lfo(v, 'sine', 18, 40, t, fin + 0.02, o.frequency)
  m.ruido(v, t, fin + 0.02, m.filtro(v, 'bandpass', 3000, 1.5, m.ganancia(v, 0.25, env)))
  return v
}

// ─── Nico M. ─────────────────────────────────────────────────────────────────

/** Señala: un «ting» agudo. */
export function tingAgudo(m: Mesa, t: number, pan: number): void {
  const v = m.voz('anillos', t, { pan, reverb: 0.45, volumen: 0.6 })
  if (!v) return
  for (const [hz, a] of [
    [3136, 0.2],
    [4699, 0.1],
  ] as const) {
    const g = m.ganancia(v, 0, v.salida)
    const fin = envPercusion(g.gain, t, 0.001, a, 0.3)
    m.osc(v, 'sine', hz, t, fin + 0.01, g)
  }
}

/** Cada anillo de la Orden Final: un «uom» de vibráfono, cada uno más agudo (`paso` 0, 1, 2). */
export function vibrafono(m: Mesa, t: number, pan: number, paso: number): void {
  const v = m.voz('anillos', t, { pan, reverb: 0.45, volumen: 0.7 })
  if (!v) return
  const NOTAS = [64, 67, 71, 74]
  const f = midiHz(NOTAS[Math.max(0, Math.min(NOTAS.length - 1, paso))])
  const g = m.ganancia(v, 0, v.salida)
  const fin = envPercusion(g.gain, t, 0.004, 0.42, 0.7)
  const am = m.ganancia(v, 0.75, g)
  m.lfo(v, 'sine', 6, 0.25, t, fin + 0.01, am.gain)
  m.osc(v, 'sine', f, t, fin + 0.01, am)
  m.osc(v, 'sine', f * 4, t, fin + 0.01, m.ganancia(v, 0.12, am))
}

/** El tercero estalla: golpe brillante con cola de campanitas. */
export function campanitas(m: Mesa, t: number, pan: number): void {
  const v = m.voz('anillos', t, { pan, reverb: 0.5, volumen: 0.6 })
  if (!v) return
  ;[88, 91, 95].forEach((n, i) => campana(m, v, t + i * 0.07, midiHz(n), 0.14, 0.6))
}

/** Los pelos de punta: un «zing» eléctrico que sube. */
export function zing(m: Mesa, t: number, pan: number): void {
  const v = m.voz('puas', t, { pan, reverb: 0.3, volumen: 0.62 })
  if (!v) return
  const dur = 0.3
  const g = m.ganancia(v, 0, v.salida)
  envSostenida(g.gain, t, 0.02, 0.36, dur * 0.6, dur * 0.4)
  const f = m.filtro(v, 'bandpass', 1800, 3, g)
  const o = m.osc(v, 'sawtooth', 500, t, t + dur + 0.02, f)
  barrido(o.frequency, t, 500, 2600, dur)
  crepitar(m, v, t, t + dur, 4000, 0.22, 1.4)
}

/** Cada púa que sale: un «fiu» corto. */
export function fiu(m: Mesa, t: number, pan: number): void {
  const v = m.voz('puas', t, { pan, volumen: 0.55, separacion: 0.03 })
  if (!v) return
  const g = m.ganancia(v, 0, v.salida)
  const fin = envPercusion(g.gain, t, 0.004, 0.35, 0.09)
  const o = m.osc(v, 'sine', 2100, t, fin + 0.01, g)
  barrido(o.frequency, t, 2100, 900, 0.08)
}

/** La púa que se clava: un «tock» metálico. */
export function tockMetal(m: Mesa, t: number, pan: number): void {
  const v = m.voz('puas', t, { pan, volumen: 0.6, separacion: 0.03 })
  if (!v) return
  tic(m, v, t, 'bandpass', 1700, 6, 0.6, 0.04)
  const g = m.ganancia(v, 0, v.salida)
  const fin = envPercusion(g.gain, t, 0.001, 0.25, 0.06)
  m.osc(v, 'sine', 1250, t, fin + 0.01, g)
}

/** La púa clavada que pisan: «crack». */
export function crack(m: Mesa, t: number, pan: number): void {
  const v = m.voz('puas', t, { pan, volumen: 0.78, saturar: true })
  if (!v) return
  tic(m, v, t, 'highpass', 3000, 0.7, 0.85, 0.03)
  tun(m, v, t, 140, 60, 0.7, 0.12)
}

/** Una púa que se apaga: un «tin» suave. */
export function tinSuave(m: Mesa, t: number, pan: number): void {
  const v = m.voz('puas', t, { pan, reverb: 0.3, volumen: 0.35, separacion: 0.05 })
  if (!v) return
  const g = m.ganancia(v, 0, v.salida)
  const fin = envPercusion(g.gain, t, 0.002, 0.22, 0.2)
  m.osc(v, 'sine', 2800, t, fin + 0.01, g)
}

/** Pelo de punta: el que pega se pincha, un «tsk» chico. */
export function tsk(m: Mesa, t: number, pan: number): void {
  const v = m.voz('puas', t, { pan, volumen: 0.35, separacion: 0.05 })
  if (v) tic(m, v, t, 'highpass', 7000, 0.7, 0.5, 0.02)
}

// ─── Tony ────────────────────────────────────────────────────────────────────

/** El revoleo del monopatín: un «whoosh» grave en círculo. */
export function whooshGrave(m: Mesa, t: number, pan: number): void {
  const v = m.voz('monopatin', t, { pan, reverb: 0.15, volumen: 0.7 })
  if (!v) return
  const dur = 0.42
  const g = m.ganancia(v, 0, v.salida)
  envSostenida(g.gain, t, 0.05, 0.5, dur * 0.55, dur * 0.45)
  const f = m.filtro(v, 'bandpass', 260, 1.4, g)
  f.frequency.setValueAtTime(260, t)
  f.frequency.exponentialRampToValueAtTime(700, t + dur * 0.5)
  f.frequency.exponentialRampToValueAtTime(300, t + dur)
  m.ruido(v, t, t + dur + 0.02, f, 'rosa')
  if (v.pan) m.lfo(v, 'sine', 3.5, 0.4, t, t + dur + 0.02, v.pan.pan)
}

/** Las frecuencias base de cada motor (para afinarlo con la velocidad del monopatín). */
const MOTORES = new WeakMap<Voz, { param: AudioParam; base: number }[]>()

/**
 * El monopatín en vuelo: un zumbido de motor eléctrico (bucle). El tono lo sube `afinarMotor` en cada
 * cuadro con la velocidad del proyectil.
 */
export function motorMonopatin(m: Mesa, t: number, pan: number, dur = 1.8): Voz | null {
  const v = m.voz('proyectil', t, { pan, reverb: 0.1, volumen: 0.24 })
  if (!v) return null
  const fin = t + dur
  const env = m.ganancia(v, 0, v.salida)
  envSostenida(env.gain, t, 0.05, 0.5, dur - 0.15, 0.15)
  const f = m.filtro(v, 'lowpass', 1400, 2, env)
  const perillas: { param: AudioParam; base: number }[] = []
  for (const [forma, mult, a] of [
    ['sawtooth', 1, 1],
    ['square', 2.01, 0.35],
    ['sine', 0.5, 0.6],
  ] as const) {
    const o = m.osc(v, forma, 90 * mult, t, fin + 0.02, m.ganancia(v, a, f))
    perillas.push({ param: o.frequency, base: 90 * mult })
  }
  const am = m.ganancia(v, 0.08, env)
  m.ruido(v, t, fin + 0.02, m.filtro(v, 'bandpass', 2400, 1.5, am))
  MOTORES.set(v, perillas)
  return v
}

/** Sube el tono del motor con la velocidad: `f` 0 (sale) a 1 (va al tope). */
export function afinarMotor(m: Mesa, v: Voz, f: number): void {
  const perillas = MOTORES.get(v)
  if (!perillas) return
  const k = 1 + 1.7 * Math.max(0, Math.min(1, f))
  const ahora = m.ctx.currentTime
  for (const p of perillas) suavizar(p.param, p.base * k, ahora, 0.05)
}

/** El monopatín que entra: golpe metálico y un chispazo. */
export function chispazo(m: Mesa, t: number, pan: number): void {
  clank(m, t, pan)
  const v = m.voz('monopatin', t, { pan, volumen: 0.6 })
  if (!v) return
  const g = m.ganancia(v, 0, v.salida)
  const fin = envPercusion(g.gain, t, 0.001, 0.3, 0.12)
  const o = m.osc(v, 'square', 1400, t, fin + 0.01, m.filtro(v, 'highpass', 600, 0.7, g))
  barrido(o.frequency, t, 1400, 300, 0.1)
  m.ruido(v, t, fin + 0.01, m.filtro(v, 'highpass', 5000, 0.7, m.ganancia(v, 0.5, g)))
}

/** El aura del Despido: un acorde de bronces que sube. */
export function bronces(m: Mesa, t: number, pan: number): void {
  const v = m.voz('despido', t, { pan, reverb: 0.45, volumen: 0.66 })
  if (!v) return
  const dur = 0.85
  const g = m.ganancia(v, 0, v.salida)
  envSostenida(g.gain, t, 0.1, 0.28, dur * 0.6, dur * 0.4)
  const f = m.filtro(v, 'lowpass', 500, 2, g)
  barrido(f.frequency, t, 500, 2800, dur * 0.7)
  for (const n of [55, 59, 62, 67]) {
    const o = m.osc(v, 'sawtooth', midiHz(n) * variar(1, 0.003), t, t + dur + 0.02, f)
    o.frequency.exponentialRampToValueAtTime(midiHz(n + 2), t + dur * 0.6)
    m.lfo(v, 'sine', 5.5, midiHz(n) * 0.008, t, t + dur + 0.02, o.frequency)
  }
}

/** El papel: un «fsst» de hoja. */
export function fsstHoja(m: Mesa, t: number, pan: number): void {
  const v = m.voz('despido', t, { pan, volumen: 0.55, separacion: 0.1 })
  if (!v) return
  const g = m.ganancia(v, 0, v.salida)
  const fin = envSostenida(g.gain, t, 0.005, 0.45, 0.06, 0.06)
  const f = m.filtro(v, 'bandpass', 4200, 0.9, g)
  barrido(f.frequency, t, 3200, 5200, 0.1)
  m.ruido(v, t, fin + 0.01, f)
}

/** El sello de goma del despido: «¡PUM!». */
export function sello(m: Mesa, t: number, pan: number): void {
  const v = m.voz('despido', t, { pan, reverb: 0.25, volumen: 0.85, saturar: true })
  if (!v) return
  tun(m, v, t, 160, 60, 0.9, 0.14)
  tic(m, v, t, 'lowpass', 500, 0.8, 0.6, 0.06)
}

/** El arrodillado llora: un sollozo sintetizado corto (dos «hu» que caen, sin voz grabada). */
export function sollozo(m: Mesa, t: number, pan: number): void {
  const v = m.voz('estado', t, { pan, reverb: 0.3, volumen: 0.95, separacion: 0.3 })
  if (!v) return
  for (const [dt, desde, hasta] of [
    [0, 300, 236],
    [0.24, 290, 214],
  ] as const) {
    const tb = t + dt
    const g = m.ganancia(v, 0, v.salida)
    const fin = envSostenida(g.gain, tb, 0.02, 0.36, 0.12, 0.07)
    const f1 = m.filtro(v, 'bandpass', 700, 5, g)
    const f2 = m.filtro(v, 'bandpass', 1150, 6, m.ganancia(v, 0.5, g))
    const o = m.osc(v, 'sawtooth', desde, tb, fin + 0.01, f1)
    o.connect(f2)
    o.frequency.exponentialRampToValueAtTime(hasta, fin)
    m.lfo(v, 'sine', 9, 6, tb, fin + 0.01, o.frequency)
  }
}

/** La patada del Despido: el platillo. */
export function platillo(m: Mesa, t: number, pan: number): void {
  const v = m.voz('despido', t, { pan, reverb: 0.4, volumen: 0.55 })
  if (!v) return
  const g = m.ganancia(v, 0, v.salida)
  const fin = envPercusion(g.gain, t, 0.002, 0.4, 0.8)
  m.ruido(v, t, fin + 0.01, m.filtro(v, 'bandpass', 8500, 0.6, m.filtro(v, 'highpass', 5800, 0.7, g)))
}
