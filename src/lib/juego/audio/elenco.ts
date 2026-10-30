/**
 * Sonidos del elenco nuevo (todo sintetizado, como el resto): el bombo con platillo de la
 * hinchada, la navaja, el celular, los anteojos, el guante con fuego, la moto que acelera y se
 * aleja, el tiro de dibujo animado, el aerosol y el estallido del graffiti, el scratch y el
 * molino del break, el trago y la botella (que se rompe sin crudeza), el grito y su onda, el
 * cuarteto, el zumbido del gorro, el rugido del dragón, la pelota, los chorros de leche y de agua
 * caliente, el pañal con sus moscas, el mate de calabaza, el sismo, el agarre, la curación y los
 * estados (aturdido, mareado, quemado).
 *
 * Reglas de la mesa: cada sonido es UNA voz (se descarta sola), con tope por tipo (TOPES en
 * mesa.ts) y anti-ráfaga donde llegan seguidos. Los bucles (los proyectiles en vuelo) devuelven
 * su voz para que eventos.ts los panee y los corte cuando el proyectil desaparece. Volúmenes por
 * debajo de los golpes: los bucles 0,35–0,55, los impactos 0,7–1.
 */
import type { FuerzaGolpe } from '../tipos'
import type { Mesa, Voz } from './mesa'
import { aleatorio, barrido, envPercusion, envSostenida, midiHz, variar } from './mesa'
import { campana } from './anuncios'
import { silbido } from './golpes'

// ─── Piezas chicas ───────────────────────────────────────────────────────────

/** Un «tic» de ruido filtrado (clics, mazazos chicos, piedritas). */
function tic(m: Mesa, v: Voz, t: number, tipo: BiquadFilterType, frec: number, q: number, pico: number, caida: number): void {
  const g = m.ganancia(v, 0, v.salida)
  const f = m.filtro(v, tipo, frec, q, g)
  const fin = envPercusion(g.gain, t, 0.0006, pico, caida)
  m.ruido(v, t, fin + 0.01, f)
}

/** Un «tun» de seno que cae (golpes graves). */
function tun(m: Mesa, v: Voz, t: number, desde: number, hasta: number, pico: number, caida: number, forma: OscillatorType = 'sine'): void {
  const g = m.ganancia(v, 0, v.salida)
  const fin = envPercusion(g.gain, t, 0.002, pico, caida)
  const o = m.osc(v, forma, desde, t, fin + 0.01, g)
  barrido(o.frequency, t, desde, hasta, Math.max(0.01, caida * 0.6))
}

/** Chisporroteo: ráfagas cortas al azar de ruido agudo entre t y fin (fuego, vapor, quemado). */
function crepitar(m: Mesa, v: Voz, t: number, fin: number, frec: number, pico: number, densidad = 1): void {
  const g = m.ganancia(v, 0, v.salida)
  const f = m.filtro(v, 'highpass', frec, 0.7, g)
  m.ruido(v, t, fin + 0.02, f)
  g.gain.setValueAtTime(0, t)
  let tc = t + aleatorio(0, 0.02)
  while (tc < fin - 0.03) {
    const d = aleatorio(0.006, 0.022)
    g.gain.setValueAtTime(0, tc)
    g.gain.linearRampToValueAtTime(aleatorio(pico * 0.4, pico), tc + 0.0015)
    g.gain.exponentialRampToValueAtTime(0.001, tc + d)
    tc += d + aleatorio(0.015, 0.08) / densidad
  }
}

// ─── Herramientas y especiales ───────────────────────────────────────────────

/** El bombo de la hinchada: «bum» grave con parche, el mazo y el platillo de arriba. */
export function bombo(m: Mesa, t: number, o: { pan: number; fuerza?: number }): void {
  const f = o.fuerza ?? 1
  const v = m.voz('bombo', t, { pan: o.pan, reverb: 0.32, volumen: 0.55 + 0.3 * f, saturar: f > 0.85 })
  if (!v) return
  const k = variar(1, 0.04)
  tun(m, v, t, 96 * k, 46 * k, 0.95, 0.42)
  tun(m, v, t, 180 * k, 120 * k, 0.35, 0.08, 'triangle')
  tic(m, v, t, 'bandpass', 2200, 1.2, 0.4, 0.015)
  // el platillo (bombo con platillo, como en la cancha)
  const tp = t + 0.004
  const gP = m.ganancia(v, 0, v.salida)
  const fP = m.filtro(v, 'bandpass', 8500, 0.6, gP)
  const pa = m.filtro(v, 'highpass', 5200, 0.7, fP)
  const finP = envPercusion(gP.gain, tp, 0.002, 0.2 * f, 0.38)
  m.ruido(v, tp, finP + 0.01, pa)
}

/** El bombo rodando por el piso: retumbe con un golpecito por vuelta. Lo corta el que lo sigue. */
export function bomboRodando(m: Mesa, t: number, pan: number, dur = 3): Voz | null {
  const v = m.voz('proyectil', t, { pan, volumen: 0.5 })
  if (!v) return null
  const fin = t + dur
  const env = m.ganancia(v, 0, v.salida)
  envSostenida(env.gain, t, 0.05, 0.5, dur - 0.2, 0.2)
  const am = m.ganancia(v, 0.6, env)
  m.lfo(v, 'sine', 7, 0.35, t, fin + 0.02, am.gain)
  const f = m.filtro(v, 'lowpass', 220, 1.2, am)
  m.ruido(v, t, fin + 0.02, f, 'marron')
  for (let tg = t + 0.08; tg < fin - 0.1; tg += aleatorio(0.15, 0.19)) {
    const g = m.ganancia(v, 0, v.salida)
    const finG = envPercusion(g.gain, tg, 0.003, 0.32, 0.07)
    const oG = m.osc(v, 'sine', 80, tg, finG + 0.01, g)
    barrido(oG.frequency, tg, 80, 52, 0.05)
  }
  return v
}

/** La navaja: el «shing» metálico del filo (silbido que sube + parciales de acero). */
export function navaja(m: Mesa, t: number, o: { pan: number; volumen?: number }): void {
  const v = m.voz('navaja', t, { pan: o.pan, reverb: 0.22, volumen: o.volumen ?? 0.8, separacion: 0.04 })
  if (!v) return
  const g = m.ganancia(v, 0, v.salida)
  const f = m.filtro(v, 'bandpass', 2500, 2.2, g)
  barrido(f.frequency, t, 2400, 7800, 0.09)
  const fin = envPercusion(g.gain, t, 0.01, 0.5, 0.12)
  m.ruido(v, t, fin + 0.01, f)
  const k = variar(1, 0.02)
  const ts = t + 0.03
  for (const [hz, a, d] of [
    [3150, 0.1, 0.32],
    [4950, 0.07, 0.26],
    [7350, 0.05, 0.2],
    [9400, 0.03, 0.14],
  ] as const) {
    const gs = m.ganancia(v, 0, v.salida)
    const finS = envPercusion(gs.gain, ts, 0.002, a, d)
    const os = m.osc(v, 'sine', hz * k * 0.985, ts, finS + 0.01, gs)
    os.frequency.exponentialRampToValueAtTime(hz * k, ts + 0.05)
  }
}

/** El celular: clic de plástico y una vibración «bzz bzz». */
export function celular(m: Mesa, t: number, pan: number): void {
  const v = m.voz('celular', t, { pan, reverb: 0.08, volumen: 0.75, separacion: 0.05 })
  if (!v) return
  tic(m, v, t, 'bandpass', 1100, 3, 0.55, 0.04)
  tic(m, v, t, 'highpass', 5000, 0.7, 0.3, 0.006)
  const filtro = m.filtro(v, 'lowpass', 700, 1, v.salida)
  for (let i = 0; i < 3; i++) {
    const tb = t + 0.05 + i * 0.1
    const g = m.ganancia(v, 0, filtro)
    const fin = envSostenida(g.gain, tb, 0.004, 0.32, 0.06, 0.012)
    m.osc(v, 'square', variar(165, 0.02), tb, fin + 0.01, g)
  }
}

/** Los anteojos: dos chasquidos de la patilla y un brillo «cool». */
export function anteojos(m: Mesa, t: number, pan: number): void {
  const v = m.voz('celular', t, { pan, reverb: 0.25, volumen: 0.7, separacion: 0.05 })
  if (!v) return
  tic(m, v, t, 'highpass', 6000, 0.8, 0.6, 0.004)
  tic(m, v, t + 0.045, 'highpass', 5200, 0.8, 0.42, 0.005)
  tic(m, v, t, 'bandpass', 2800, 4, 0.3, 0.02)
  const tb = t + 0.06
  for (const [hz, a] of [
    [4186, 0.07],
    [6272, 0.05],
  ] as const) {
    const g = m.ganancia(v, 0, v.salida)
    const fin = envPercusion(g.gain, tb, 0.002, a, 0.28)
    m.osc(v, 'sine', hz, tb, fin + 0.01, g)
  }
}

/** Fuego: el «fuuush» (ruido rosa que se abre y se cierra) con chisporroteo. */
export function fuego(m: Mesa, t: number, o: { pan: number; dur: number; volumen?: number }): void {
  const v = m.voz('fuego', t, { pan: o.pan, reverb: 0.2, volumen: o.volumen ?? 0.75 })
  if (!v) return
  const dur = Math.max(0.15, o.dur)
  const fin = t + dur
  const g = m.ganancia(v, 0, v.salida)
  const f = m.filtro(v, 'bandpass', 500, 0.8, g)
  f.frequency.setValueAtTime(420, t)
  f.frequency.exponentialRampToValueAtTime(2200, t + dur * 0.35)
  f.frequency.exponentialRampToValueAtTime(800, fin)
  envSostenida(g.gain, t, dur * 0.2, 0.6, dur * 0.55, dur * 0.4)
  m.ruido(v, t, fin + 0.02, f, 'rosa')
  crepitar(m, v, t + 0.02, fin, 2600, 0.35, 0.8)
}

/** El guante en vuelo: un rugido de fuego que sigue al proyectil. */
export function fuegoVolando(m: Mesa, t: number, pan: number, dur = 1.5): Voz | null {
  const v = m.voz('proyectil', t, { pan, reverb: 0.1, volumen: 0.5 })
  if (!v) return null
  const fin = t + dur
  const env = m.ganancia(v, 0, v.salida)
  envSostenida(env.gain, t, 0.04, 0.55, dur - 0.15, 0.15)
  const am = m.ganancia(v, 0.7, env)
  m.lfo(v, 'square', 11, 0.25, t, fin + 0.02, am.gain)
  const f = m.filtro(v, 'lowpass', 1100, 1, am)
  m.ruido(v, t, fin + 0.02, f, 'rosa')
  crepitar(m, v, t, fin, 3000, 0.25, 1.2)
  return v
}

/** El guante que entra: piñón con fuego. */
export function guante(m: Mesa, t: number, pan: number): void {
  fuego(m, t, { pan, dur: 0.32, volumen: 0.7 })
  const v = m.voz('fuego', t, { pan, volumen: 0.8, saturar: true })
  if (!v) return
  tun(m, v, t, 90, 40, 0.9, 0.3)
}

/** La moto: el motor que acelera (sube de tono y abre el filtro) y se aleja (doppler y fundido). */
export function moto(m: Mesa, t: number, o: { pan: number; dur?: number; volumen?: number }): void {
  const dur = o.dur ?? 1.15
  // tope 1 (mesa.ts): la embestida pisa al «rrrm» del super flash, nunca se pierde
  const v = m.voz('moto', t, { pan: o.pan, reverb: 0.15, volumen: o.volumen ?? 0.85, saturar: true })
  if (!v) return
  const fin = t + dur
  const sube = t + dur * 0.55
  const env = m.ganancia(v, 0, v.salida)
  envSostenida(env.gain, t, 0.03, 0.55, dur * 0.6, dur * 0.4)
  // el motor «a explosiones»: modulación de amplitud que se acelera con las vueltas
  const am = m.ganancia(v, 0.55, env)
  const explos = m.lfo(v, 'square', 26, 0.4, t, fin + 0.02, am.gain)
  explos.frequency.exponentialRampToValueAtTime(52, sube)
  explos.frequency.exponentialRampToValueAtTime(40, fin)
  const filtro = m.filtro(v, 'lowpass', 800, 3, am)
  filtro.frequency.setValueAtTime(800, t)
  filtro.frequency.exponentialRampToValueAtTime(2600, sube)
  filtro.frequency.exponentialRampToValueAtTime(520, fin)
  const f0 = variar(58, 0.04)
  for (const [mult, forma] of [
    [1, 'sawtooth'],
    [1.008, 'square'],
    [0.5, 'sawtooth'],
  ] as const) {
    const o2 = m.osc(v, forma, f0 * mult, t, fin + 0.02, filtro)
    o2.frequency.exponentialRampToValueAtTime(f0 * mult * 2.5, sube)
    o2.frequency.exponentialRampToValueAtTime(f0 * mult * 1.9, fin)
  }
  // escape: ruido grave que acompaña
  const gE = m.ganancia(v, 0, v.salida)
  const fE = m.filtro(v, 'bandpass', 900, 1.2, gE)
  envSostenida(gE.gain, t, 0.05, 0.14, dur * 0.6, dur * 0.4)
  m.ruido(v, t, fin + 0.02, fE, 'rosa')
}

/** Tiro de dibujo animado: «pchiu» seco y corto, nada realista. */
export function disparo(m: Mesa, t: number, pan: number): void {
  const v = m.voz('disparo', t, { pan, reverb: 0.12, volumen: 0.7, separacion: 0.03 })
  if (!v) return
  tic(m, v, t, 'lowpass', 3200, 0.8, 0.65, 0.05)
  const g = m.ganancia(v, 0, v.salida)
  const fin = envPercusion(g.gain, t, 0.001, 0.32, 0.085)
  const o = m.osc(v, 'square', variar(1150, 0.05), t, fin + 0.01, m.filtro(v, 'lowpass', 2600, 1, g))
  barrido(o.frequency, t, variar(1150, 0.05), 170, 0.075)
  tun(m, v, t, 150, 62, 0.42, 0.06)
}

/** Cada bala que entra: un «tink» chiquito. */
function balaImpacto(m: Mesa, t: number, pan: number): void {
  const v = m.voz('disparo', t, { pan, volumen: 0.45, separacion: 0.03 })
  if (!v) return
  const g = m.ganancia(v, 0, v.salida)
  const fin = envPercusion(g.gain, t, 0.001, 0.18, 0.05)
  const o = m.osc(v, 'triangle', 1900, t, fin + 0.01, g)
  barrido(o.frequency, t, 1900, 900, 0.04)
}

/** El arma que se carga: «chk-chk». */
function cargarArma(m: Mesa, t: number, pan: number): void {
  const v = m.voz('disparo', t, { pan, volumen: 0.6 })
  if (!v) return
  tic(m, v, t, 'bandpass', 2100, 3, 0.5, 0.025)
  tic(m, v, t + 0.11, 'bandpass', 3300, 3, 0.55, 0.03)
  tic(m, v, t + 0.115, 'lowpass', 600, 1, 0.25, 0.04)
}

/** El aerosol: dos «clac» de la bolita y el «psss» (bucle mientras el graffiti se pinta). */
export function aerosol(m: Mesa, t: number, pan: number, dur = 0.6): Voz | null {
  const v = m.voz('graffiti', t, { pan, reverb: 0.1, volumen: 0.6 })
  if (!v) return null
  tic(m, v, t, 'bandpass', 3500, 4, 0.45, 0.012)
  tic(m, v, t + 0.07, 'bandpass', 3800, 4, 0.4, 0.012)
  const th = t + 0.12
  const fin = th + Math.max(0.2, dur)
  const env = m.ganancia(v, 0, v.salida)
  envSostenida(env.gain, th, 0.03, 0.34, fin - th - 0.08, 0.08)
  const am = m.ganancia(v, 0.82, env)
  m.lfo(v, 'sine', 13, 0.18, th, fin + 0.02, am.gain)
  const f = m.filtro(v, 'highpass', 3200, 0.7, am)
  m.ruido(v, th, fin + 0.02, m.filtro(v, 'bandpass', 7000, 0.7, f))
  return v
}

const PINTURA = [1568, 1976, 2349, 2637, 3136] as const

/** El graffiti estalla: golpe, «splat» de pintura y brillitos alegres. */
export function graffitiEstalla(m: Mesa, t: number, pan: number): void {
  const v = m.voz('graffiti', t, { pan, reverb: 0.38, volumen: 0.85, saturar: true })
  if (!v) return
  tun(m, v, t, 125, 44, 0.9, 0.42)
  const g = m.ganancia(v, 0, v.salida)
  const f = m.filtro(v, 'bandpass', 2500, 1, g)
  barrido(f.frequency, t, 2600, 480, 0.24)
  const fin = envPercusion(g.gain, t, 0.002, 0.62, 0.26)
  m.ruido(v, t, fin + 0.01, f)
  PINTURA.forEach((hz, i) => {
    const ti = t + 0.03 + i * 0.03
    const gs = m.ganancia(v, 0, v.salida)
    const finS = envPercusion(gs.gain, ti, 0.002, 0.07, 0.22)
    m.osc(v, 'sine', hz * variar(1, 0.01), ti, finS + 0.01, gs)
  })
}

/** El scratch del DJ: dos pasadas «wika-wika». */
export function scratch(m: Mesa, t: number, pan: number): void {
  const v = m.voz('break', t, { pan, volumen: 0.7 })
  if (!v) return
  const g = m.ganancia(v, 0, v.salida)
  const f = m.filtro(v, 'bandpass', 1200, 2, g)
  const o = m.osc(v, 'sawtooth', 180, t, t + 0.4, f)
  const pasos: ReadonlyArray<readonly [number, number]> = [
    [0, 180],
    [0.08, 560],
    [0.16, 150],
    [0.25, 520],
    [0.34, 170],
  ]
  f.frequency.setValueAtTime(720, t)
  for (const [dt, hz] of pasos) o.frequency.linearRampToValueAtTime(hz, t + dt)
  for (const [dt, hz] of pasos) f.frequency.linearRampToValueAtTime(hz * 4, t + dt)
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(0.42, t + 0.02)
  g.gain.linearRampToValueAtTime(0.05, t + 0.15)
  g.gain.linearRampToValueAtTime(0.42, t + 0.18)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38)
  const gR = m.ganancia(v, 0, v.salida)
  const fR = m.filtro(v, 'bandpass', 2000, 1.5, gR)
  fR.frequency.setValueAtTime(900, t)
  for (const [dt, hz] of pasos) fR.frequency.linearRampToValueAtTime(hz * 5, t + dt)
  envSostenida(gR.gain, t, 0.01, 0.12, 0.3, 0.06)
  m.ruido(v, t, t + 0.4, fR)
}

/** El molino del break: aire que gira (y el paneo da vueltas). */
export function molino(m: Mesa, t: number, o: { pan: number; dur: number }): void {
  const v = m.voz('break', t, { pan: o.pan, reverb: 0.12, volumen: 0.6, separacion: 0.15 })
  if (!v) return
  const dur = Math.max(0.2, o.dur)
  const fin = t + dur
  const env = m.ganancia(v, 0, v.salida)
  envSostenida(env.gain, t, 0.05, 0.5, dur - 0.12, 0.12)
  const am = m.ganancia(v, 0.6, env)
  m.lfo(v, 'sine', 6.5, 0.4, t, fin + 0.02, am.gain)
  const f = m.filtro(v, 'bandpass', 1000, 2.2, am)
  m.lfo(v, 'sine', 6.5, 650, t, fin + 0.02, f.frequency)
  m.ruido(v, t, fin + 0.02, f, 'rosa')
  if (v.pan) m.lfo(v, 'sine', 3.2, 0.35, t, fin + 0.02, v.pan.pan)
}

/** Burbujitas que suben (líquido, glu-glu). */
function burbujas(m: Mesa, v: Voz, t: number, n: number, desde: number, hasta: number): void {
  for (let i = 0; i < n; i++) {
    const tb = t + i * aleatorio(0.03, 0.06)
    const g = m.ganancia(v, 0, v.salida)
    const fin = envPercusion(g.gain, tb, 0.002, 0.16, 0.035)
    const o = m.osc(v, 'sine', aleatorio(desde, desde * 1.3), tb, fin + 0.01, g)
    barrido(o.frequency, tb, aleatorio(desde, desde * 1.3), aleatorio(hasta * 0.85, hasta), 0.03)
  }
}

/** Un «tin» de vidrio. */
function cristal(m: Mesa, v: Voz, t: number, base: number, amp: number): void {
  for (const [r, a, d] of [
    [1, 1, 0.22],
    [1.5, 0.6, 0.16],
    [2.76, 0.35, 0.1],
  ] as const) {
    const g = m.ganancia(v, 0, v.salida)
    const fin = envPercusion(g.gain, t, 0.001, amp * a, d)
    m.osc(v, 'sine', base * r, t, fin + 0.01, g)
  }
}

/** El trago: líquido que se sacude, glu-glu y el vaso que tintinea. */
export function trago(m: Mesa, t: number, pan: number): void {
  const v = m.voz('liquido', t, { pan, reverb: 0.18, volumen: 0.75 })
  if (!v) return
  tic(m, v, t, 'lowpass', 900, 0.8, 0.35, 0.15)
  burbujas(m, v, t + 0.02, 3, 420, 900)
  cristal(m, v, t + 0.04, variar(2637, 0.02), 0.11)
}

/** El trago que salpica (al caer o al pegar). */
export function salpicadura(m: Mesa, t: number, pan: number, volumen = 0.75): void {
  const v = m.voz('liquido', t, { pan, reverb: 0.2, volumen, separacion: 0.04 })
  if (!v) return
  const g = m.ganancia(v, 0, v.salida)
  const f = m.filtro(v, 'bandpass', 2400, 0.8, g)
  barrido(f.frequency, t, 2600, 650, 0.2)
  const fin = envPercusion(g.gain, t, 0.002, 0.6, 0.2)
  m.ruido(v, t, fin + 0.01, f)
  burbujas(m, v, t + 0.04, 4, 500, 1100)
}

/** La botella que se rompe SIN crudeza: un crujido suave y campanitas de vidrio. */
export function botellaRota(m: Mesa, t: number, pan: number): void {
  const v = m.voz('vidrio', t, { pan, reverb: 0.32, volumen: 0.6, separacion: 0.04 })
  if (!v) return
  tic(m, v, t, 'highpass', 3600, 0.7, 0.32, 0.05)
  const notas = [2093, 2637, 3136, 3951, 4186, 5274]
  for (let i = 0; i < notas.length; i++) {
    const ti = t + 0.01 + Math.pow(Math.random(), 1.5) * 0.24
    const g = m.ganancia(v, 0, v.salida)
    const fin = envPercusion(g.gain, ti, 0.001, aleatorio(0.05, 0.09), aleatorio(0.12, 0.28))
    m.osc(v, 'sine', notas[i] * variar(1, 0.01), ti, fin + 0.01, g)
  }
}

/** Las botellas del flair: un «clink» de dos botellas y el aire. */
function flair(m: Mesa, t: number, pan: number): void {
  const v = m.voz('vidrio', t, { pan, reverb: 0.3, volumen: 0.55 })
  if (!v) return
  cristal(m, v, t, 1760, 0.12)
  cristal(m, v, t + 0.12, 2093, 0.1)
  silbido(m, t + 0.04, { fuerza: 'medio', pan })
}

/** El grito con micrófono: «AAAH» de sierras por formantes, con vibrato y saturado. */
export function grito(m: Mesa, t: number, pan: number): void {
  const v = m.voz('grito', t, { pan: pan * 0.6, reverb: 0.42, volumen: 0.85, saturar: true })
  if (!v) return
  const dur = 0.85
  const fin = t + dur
  const env = m.ganancia(v, 0, v.salida)
  envSostenida(env.gain, t, 0.05, 0.6, dur - 0.25, 0.25)
  const f0 = variar(185, 0.03)
  const formantes: ReadonlyArray<readonly [number, number, number]> = [
    [780, 6, 1],
    [1180, 7, 0.75],
    [2500, 8, 0.32],
  ]
  const bandas = formantes.map(([hz, q, a]) => m.filtro(v, 'bandpass', hz, q, m.ganancia(v, a, env)))
  for (const mult of [1, 1.004, 0.5]) {
    const o = m.osc(v, 'sawtooth', f0 * mult, t, fin + 0.02, bandas[0])
    for (let i = 1; i < bandas.length; i++) o.connect(bandas[i])
    o.frequency.exponentialRampToValueAtTime(f0 * mult * 1.4, t + 0.22)
    const vib = m.modulador(v, 0, o.frequency)
    m.osc(v, 'sine', 5.6, t, fin + 0.02, vib)
    vib.gain.setValueAtTime(0, t + 0.18)
    vib.gain.linearRampToValueAtTime(f0 * mult * 0.03, t + 0.35)
  }
  // aire de la voz
  m.ruido(v, t, fin + 0.02, m.filtro(v, 'bandpass', 1600, 1, m.ganancia(v, 0.12, env)))
}

/** La onda del grito en vuelo: un zumbido grave que ondula y el aire que arrastra. */
export function ondaVolando(m: Mesa, t: number, pan: number, dur = 2.5): Voz | null {
  const v = m.voz('proyectil', t, { pan, reverb: 0.25, volumen: 0.32 })
  if (!v) return null
  const fin = t + dur
  const env = m.ganancia(v, 0, v.salida)
  envSostenida(env.gain, t, 0.1, 0.5, dur - 0.25, 0.25)
  const am = m.ganancia(v, 0.6, env)
  m.lfo(v, 'sine', 5, 0.35, t, fin + 0.02, am.gain)
  const f = m.filtro(v, 'lowpass', 600, 2, am)
  m.osc(v, 'sine', 72, t, fin + 0.02, f)
  m.osc(v, 'triangle', 144, t, fin + 0.02, m.ganancia(v, 0.5, f))
  const b = m.filtro(v, 'bandpass', 700, 2, m.ganancia(v, 0.5, am))
  m.lfo(v, 'sine', 2.5, 350, t, fin + 0.02, b.frequency)
  m.ruido(v, t, fin + 0.02, b, 'rosa')
  return v
}

/** «Tap tap» al micrófono antes del grito. */
function microfono(m: Mesa, t: number, pan: number): void {
  const v = m.voz('grito', t, { pan, reverb: 0.5, volumen: 0.6 })
  if (!v) return
  for (const dt of [0, 0.16]) {
    tun(m, v, t + dt, 140, 70, 0.6, 0.12)
    tic(m, v, t + dt, 'lowpass', 1400, 1, 0.3, 0.03)
  }
}

/**
 * El «tunga-tunga» del cuarteto cordobés: bajo en el uno, el acorde del piano en el contratiempo
 * y la güira raspando. En La mayor (como los festejos).
 */
export function cuarteto(m: Mesa, t: number, pan: number): void {
  const v = m.voz('cuarteto', t, { pan: pan * 0.5, reverb: 0.3, volumen: 0.8 })
  if (!v) return
  const paso = 0.118
  const bajos = [45, 40, 45, 40]
  for (let i = 0; i < 4; i++) {
    const tb = t + i * 2 * paso
    if (i < 2) {
      const g = m.ganancia(v, 0, v.salida)
      const fin = envPercusion(g.gain, tb, 0.004, 0.55, 0.16)
      m.osc(v, 'triangle', midiHz(bajos[i]), tb, fin + 0.01, m.filtro(v, 'lowpass', 600, 1, g))
      m.osc(v, 'sine', midiHz(bajos[i] - 12), tb, fin + 0.01, g)
    }
    const ta = tb + paso
    if (i < 2) {
      const g = m.ganancia(v, 0, v.salida)
      const fin = envPercusion(g.gain, ta, 0.003, 0.16, 0.12)
      const f = m.filtro(v, 'lowpass', 3200, 1, g)
      for (const n of [57, 61, 64, 69]) m.osc(v, m.pulso25, midiHz(n), ta, fin + 0.01, f)
    }
    // güira: raspado corto en cada paso
    tic(m, v, t + i * paso, 'highpass', 6500, 0.8, i % 2 === 0 ? 0.22 : 0.12, 0.04)
  }
}

/** El gorro chino girando: zumbido de aspas (bucle mientras vuela). */
export function zumbido(m: Mesa, t: number, pan: number, dur = 2): Voz | null {
  const v = m.voz('proyectil', t, { pan, reverb: 0.1, volumen: 0.75 })
  if (!v) return null
  const fin = t + dur
  const env = m.ganancia(v, 0, v.salida)
  envSostenida(env.gain, t, 0.05, 0.5, dur - 0.15, 0.15)
  const am = m.ganancia(v, 0.55, env)
  m.lfo(v, 'triangle', 16, 0.45, t, fin + 0.02, am.gain)
  const f = m.filtro(v, 'bandpass', 950, 2, am)
  m.osc(v, 'triangle', 160, t, fin + 0.02, f)
  m.osc(v, 'sawtooth', 241, t, fin + 0.02, m.ganancia(v, 0.4, f))
  m.ruido(v, t, fin + 0.02, m.filtro(v, 'bandpass', 1600, 1.4, m.ganancia(v, 0.6, am)), 'rosa')
  return v
}

/** El rugido del dragón: sierras graves con «gruñido», el fuego que se abre y el crepitar. */
export function dragon(m: Mesa, t: number, o: { pan: number; dur?: number }): void {
  const dur = o.dur ?? 0.7
  const v = m.voz('fuego', t, { pan: o.pan, reverb: 0.32, volumen: 0.9, saturar: true, separacion: 0.2 })
  if (!v) return
  const fin = t + dur
  const env = m.ganancia(v, 0, v.salida)
  envSostenida(env.gain, t, 0.04, 0.5, dur * 0.6, dur * 0.4)
  const am = m.ganancia(v, 0.7, env)
  m.lfo(v, 'square', 23, 0.3, t, fin + 0.02, am.gain)
  const f = m.filtro(v, 'lowpass', 700, 4, am)
  for (const mult of [1, 1.5]) {
    const o2 = m.osc(v, 'sawtooth', 68 * mult, t, fin + 0.02, f)
    o2.frequency.exponentialRampToValueAtTime(108 * mult, t + dur * 0.3)
    o2.frequency.exponentialRampToValueAtTime(60 * mult, fin)
  }
  fuego(m, t + 0.03, { pan: o.pan, dur: dur * 0.9, volumen: 0.7 })
}

/** La patada a la pelota: «pum» hueco de cuero y el aire. */
export function pelota(m: Mesa, t: number, pan: number): void {
  const v = m.voz('pelota', t, { pan, reverb: 0.16, volumen: 0.8, separacion: 0.04 })
  if (!v) return
  tun(m, v, t, variar(215, 0.04), 118, 0.8, 0.09)
  tic(m, v, t, 'bandpass', 1400, 1.5, 0.5, 0.03)
  const g = m.ganancia(v, 0, v.salida)
  const f = m.filtro(v, 'bandpass', 800, 1.2, g)
  barrido(f.frequency, t, 800, 2200, 0.12)
  const fin = envPercusion(g.gain, t + 0.01, 0.02, 0.2, 0.12)
  m.ruido(v, t + 0.01, fin + 0.01, f)
}

/** La pelota que pica. */
export function pique(m: Mesa, t: number, pan: number, volumen = 0.6): void {
  const v = m.voz('pelota', t, { pan, volumen, separacion: 0.05 })
  if (!v) return
  tun(m, v, t, 185, 150, 0.6, 0.08)
  tic(m, v, t, 'bandpass', 1300, 1.5, 0.3, 0.02)
}

/** Un chorro a presión (leche o agua caliente): bucle mientras el chorro existe. */
export function chorro(m: Mesa, t: number, o: { pan: number; dur?: number; caliente: boolean }): Voz | null {
  const dur = o.dur ?? 2
  const v = m.voz('proyectil', t, { pan: o.pan, reverb: 0.12, volumen: 0.45 })
  if (!v) return null
  const fin = t + dur
  // el «squish» del arranque
  const gS = m.ganancia(v, 0, v.salida)
  const finS = envPercusion(gS.gain, t, 0.004, 0.18, 0.06)
  const oS = m.osc(v, 'sine', 900, t, finS + 0.01, gS)
  barrido(oS.frequency, t, 900, 1500, 0.05)
  const env = m.ganancia(v, 0, v.salida)
  envSostenida(env.gain, t, 0.04, 0.55, dur - 0.12, 0.12)
  const am = m.ganancia(v, 0.7, env)
  m.lfo(v, 'sine', o.caliente ? 11 : 22, 0.28, t, fin + 0.02, am.gain)
  const f = m.filtro(v, 'bandpass', o.caliente ? 1500 : 2600, 1.1, am)
  m.ruido(v, t, fin + 0.02, f)
  m.ruido(v, t, fin + 0.02, m.filtro(v, 'lowpass', 600, 1, m.ganancia(v, 0.25, env)), 'rosa')
  if (o.caliente) {
    // el vapor: siseo agudo
    const gV = m.ganancia(v, 0, v.salida)
    envSostenida(gV.gain, t, 0.15, 0.16, dur - 0.2, 0.15)
    m.ruido(v, t, fin + 0.02, m.filtro(v, 'highpass', 5000, 0.7, gV))
  }
  return v
}

/** Moscas: dos sierras con vibrato y aleteo (con un paneo que va y viene). */
function moscas(m: Mesa, t: number, pan: number, dur: number, volumen: number): void {
  const v = m.voz('moscas', t, { pan, volumen, separacion: 0.3 })
  if (!v) return
  const fin = t + dur
  const env = m.ganancia(v, 0, v.salida)
  envSostenida(env.gain, t, dur * 0.3, 0.1, dur * 0.4, dur * 0.4)
  const am = m.ganancia(v, 0.7, env)
  m.lfo(v, 'square', 28, 0.3, t, fin + 0.02, am.gain)
  const f = m.filtro(v, 'bandpass', 620, 3, am)
  for (const hz of [218, 247]) {
    const o = m.osc(v, 'sawtooth', hz, t, fin + 0.02, f)
    m.lfo(v, 'sine', aleatorio(7, 11), 18, t, fin + 0.02, o.frequency)
  }
  if (v.pan) m.lfo(v, 'sine', 0.8, 0.4, t, fin + 0.02, v.pan.pan)
}

/** El pañal: «plaf» blandito y las moscas que se juntan. */
export function panal(m: Mesa, t: number, pan: number): void {
  const v = m.voz('liquido', t, { pan, reverb: 0.15, volumen: 0.8, separacion: 0.1 })
  if (v) {
    tic(m, v, t, 'lowpass', 700, 0.8, 0.85, 0.12)
    tun(m, v, t, 150, 68, 0.5, 0.1)
  }
  moscas(m, t + 0.08, pan, 1.3, 0.55)
}

/** La nube en el piso: un «fsss» bajito (bucle mientras está). */
export function gas(m: Mesa, t: number, pan: number, dur = 3.2): Voz | null {
  const v = m.voz('proyectil', t, { pan, volumen: 0.48 })
  if (!v) return null
  const fin = t + dur
  const env = m.ganancia(v, 0, v.salida)
  envSostenida(env.gain, t, 0.2, 0.45, dur - 0.4, 0.4)
  const am = m.ganancia(v, 0.7, env)
  m.lfo(v, 'sine', 0.9, 0.25, t, fin + 0.02, am.gain)
  m.ruido(v, t, fin + 0.02, m.filtro(v, 'bandpass', 1100, 0.8, am), 'rosa')
  return v
}

/** El mate: golpe hueco de calabaza. */
export function mate(m: Mesa, t: number, pan: number, volumen = 0.8): void {
  const v = m.voz('mate', t, { pan, reverb: 0.2, volumen, separacion: 0.03 })
  if (!v) return
  const k = variar(1, 0.06)
  tic(m, v, t, 'bandpass', 780 * k, 9, 0.95, 0.09)
  tun(m, v, t, 430 * k, 380 * k, 0.4, 0.08)
  const g = m.ganancia(v, 0, v.salida)
  const fin = envPercusion(g.gain, t, 0.001, 0.12, 0.04)
  m.osc(v, 'sine', 1180 * k, t, fin + 0.01, g)
}

/** El sorbo de la bombilla: un gorgoteo que sube. */
function sorbo(m: Mesa, t: number, pan: number): void {
  const v = m.voz('mate', t, { pan, reverb: 0.2, volumen: 0.6 })
  if (!v) return
  const dur = 0.36
  const g = m.ganancia(v, 0, v.salida)
  const f = m.filtro(v, 'bandpass', 900, 3, g)
  barrido(f.frequency, t, 900, 2600, dur)
  g.gain.setValueAtTime(0, t)
  for (let tc = t; tc < t + dur - 0.02; tc += aleatorio(0.018, 0.035)) {
    g.gain.setValueAtTime(aleatorio(0.1, 0.45), tc)
    g.gain.linearRampToValueAtTime(0.02, tc + 0.012)
  }
  g.gain.setValueAtTime(0, t + dur)
  m.ruido(v, t, t + dur + 0.02, f)
}

/** Vapor: siseo que se apaga (el termo, el quemado). */
function vapor(m: Mesa, t: number, pan: number, dur: number, volumen: number): void {
  const v = m.voz('liquido', t, { pan, reverb: 0.15, volumen, separacion: 0.1 })
  if (!v) return
  const g = m.ganancia(v, 0, v.salida)
  envSostenida(g.gain, t, 0.03, 0.4, dur * 0.5, dur * 0.5)
  m.ruido(v, t, t + dur + 0.02, m.filtro(v, 'bandpass', 6200, 1.2, m.filtro(v, 'highpass', 3800, 0.7, g)))
}

/** El puño al piso: estruendo grave y piedras que caen. */
export function sismo(m: Mesa, t: number, pan: number): void {
  const v = m.voz('sismo', t, { pan: pan * 0.5, reverb: 0.4, volumen: 0.72, saturar: true })
  if (!v) return
  tun(m, v, t, 62, 27, 1, 1)
  tic(m, v, t, 'lowpass', 260, 0.8, 0.85, 0.9)
  for (let i = 0; i < 7; i++) {
    const tr = t + 0.04 + Math.random() * 0.45
    tic(m, v, tr, 'bandpass', aleatorio(800, 2000), 4, aleatorio(0.25, 0.5), aleatorio(0.02, 0.045))
  }
}

/** La onda sísmica corriendo: retumbe con piedritas (bucle). */
export function retumbe(m: Mesa, t: number, pan: number, dur = 2): Voz | null {
  const v = m.voz('proyectil', t, { pan, reverb: 0.2, volumen: 0.45 })
  if (!v) return null
  const fin = t + dur
  const env = m.ganancia(v, 0, v.salida)
  envSostenida(env.gain, t, 0.05, 0.6, dur - 0.15, 0.15)
  const am = m.ganancia(v, 0.7, env)
  m.lfo(v, 'square', 13, 0.28, t, fin + 0.02, am.gain)
  m.ruido(v, t, fin + 0.02, m.filtro(v, 'lowpass', 170, 1.2, am), 'marron')
  m.osc(v, 'sine', 44, t, fin + 0.02, m.ganancia(v, 0.35, am))
  for (let tr = t + 0.05; tr < fin - 0.05; tr += aleatorio(0.07, 0.15)) {
    tic(m, v, tr, 'bandpass', aleatorio(700, 1800), 4, aleatorio(0.12, 0.28), aleatorio(0.015, 0.03))
  }
  return v
}

/** El agarre: el agarrón (ropa y golpe) y el apretón (un gruñido que cruje). */
export function agarre(m: Mesa, t: number, pan: number): void {
  const v = m.voz('agarre', t, { pan, reverb: 0.15, volumen: 0.85, saturar: true })
  if (!v) return
  tic(m, v, t, 'bandpass', 900, 1, 0.7, 0.06)
  tun(m, v, t, 120, 70, 0.6, 0.08)
  const ta = t + 0.1
  const g = m.ganancia(v, 0, v.salida)
  const fin = envSostenida(g.gain, ta, 0.05, 0.34, 0.42, 0.16)
  const f = m.filtro(v, 'lowpass', 420, 6, g)
  const o = m.osc(v, 'sawtooth', 72, ta, fin + 0.01, f)
  o.frequency.linearRampToValueAtTime(56, fin)
  m.lfo(v, 'sine', 17, 4, ta, fin + 0.01, o.frequency)
  // el «ñiic» de algo que se aprieta
  const gC = m.ganancia(v, 0, v.salida)
  const finC = envSostenida(gC.gain, ta + 0.05, 0.04, 0.05, 0.3, 0.1)
  const oC = m.osc(v, 'sine', 620, ta + 0.05, finC + 0.01, gC)
  oC.frequency.linearRampToValueAtTime(470, finC)
  m.lfo(v, 'sine', 7, 14, ta + 0.05, finC + 0.01, oC.frequency)
}

/** Un gruñido corto (el arranque del agarre). */
function grunido(m: Mesa, t: number, pan: number): void {
  const v = m.voz('agarre', t, { pan, volumen: 0.6, saturar: true })
  if (!v) return
  const g = m.ganancia(v, 0, v.salida)
  const fin = envSostenida(g.gain, t, 0.02, 0.45, 0.2, 0.15)
  const f = m.filtro(v, 'lowpass', 500, 4, g)
  m.osc(v, 'sawtooth', 62, t, fin + 0.01, f)
  m.osc(v, 'sawtooth', 93, t, fin + 0.01, f)
}

/** Escala de la curación: pentatónica de La mayor que sube con cada pedacito curado. */
const ESCALA_CURA = [81, 83, 85, 88, 90, 93, 95, 97, 100, 102] as const

/** Campanitas de la curación. `paso` = cuántos pedacitos van (cada uno, una nota más arriba). */
export function curacion(m: Mesa, t: number, pan: number, paso: number): void {
  const v = m.voz('cura', t, { pan, reverb: 0.45, volumen: 0.75, separacion: 0.06 })
  if (!v) return
  const n = ESCALA_CURA[Math.min(ESCALA_CURA.length - 1, Math.max(0, paso))]
  campana(m, v, t, midiHz(n), 0.22, 0.5)
  campana(m, v, t + 0.06, midiHz(n + 7), 0.12, 0.45)
  const g = m.ganancia(v, 0, v.salida)
  const f = m.filtro(v, 'bandpass', 4000, 2, g)
  barrido(f.frequency, t, 4000, 9000, 0.25)
  const fin = envPercusion(g.gain, t, 0.03, 0.05, 0.25)
  m.ruido(v, t, fin + 0.01, f)
}

/** Aturdido: pajaritos de dibujo animado y un «boing». */
export function aturdido(m: Mesa, t: number, pan: number): void {
  const v = m.voz('estado', t, { pan, reverb: 0.3, volumen: 0.75, separacion: 0.2 })
  if (!v) return
  for (let i = 0; i < 3; i++) {
    const tc = t + i * 0.1
    const g = m.ganancia(v, 0, v.salida)
    const fin = envPercusion(g.gain, tc, 0.004, 0.12, 0.06)
    const o = m.osc(v, 'sine', 2500, tc, fin + 0.01, g)
    o.frequency.setValueAtTime(2500, tc)
    o.frequency.exponentialRampToValueAtTime(3500, tc + 0.03)
    o.frequency.exponentialRampToValueAtTime(2800, tc + 0.06)
  }
  const tb = t + 0.3
  const g = m.ganancia(v, 0, v.salida)
  const fin = envPercusion(g.gain, tb, 0.005, 0.28, 0.4)
  const o = m.osc(v, 'triangle', 310, tb, fin + 0.01, g)
  barrido(o.frequency, tb, 310, 170, 0.38)
  m.lfo(v, 'sine', 12, 28, tb, fin + 0.01, o.frequency)
}

/** Mareado: dos tonos que se desafinan y se hamacan, y un «hip». */
export function mareado(m: Mesa, t: number, pan: number): void {
  const v = m.voz('estado', t, { pan, reverb: 0.35, volumen: 0.55, separacion: 0.2 })
  if (!v) return
  const g = m.ganancia(v, 0, v.salida)
  const fin = envSostenida(g.gain, t, 0.05, 0.2, 0.55, 0.25)
  const f = m.filtro(v, 'lowpass', 1800, 1, g)
  for (const hz of [440, 447]) {
    const o = m.osc(v, 'triangle', hz, t, fin + 0.01, f)
    o.frequency.linearRampToValueAtTime(hz * 0.8, t + 0.4)
    o.frequency.linearRampToValueAtTime(hz * 0.92, fin)
    m.lfo(v, 'sine', 1.7, 34, t, fin + 0.01, o.frequency)
  }
  // «¡hip!»
  const th = t + 0.48
  tic(m, v, th, 'bandpass', 1200, 2, 0.3, 0.04)
  const gH = m.ganancia(v, 0, v.salida)
  const finH = envPercusion(gH.gain, th, 0.003, 0.16, 0.07)
  const oH = m.osc(v, 'sine', 700, th, finH + 0.01, gH)
  barrido(oH.frequency, th, 700, 1150, 0.05)
}

/** Quemado: el «tsss» del agua caliente sobre la piel (siseo con chispitas). */
export function quemado(m: Mesa, t: number, pan: number): void {
  const v = m.voz('estado', t, { pan, reverb: 0.2, volumen: 0.6, separacion: 0.2 })
  if (!v) return
  const dur = 0.6
  const g = m.ganancia(v, 0, v.salida)
  envSostenida(g.gain, t, 0.01, 0.4, dur * 0.4, dur * 0.6)
  m.ruido(v, t, t + dur + 0.02, m.filtro(v, 'bandpass', 5800, 1.4, g))
  crepitar(m, v, t, t + dur, 3500, 0.35, 1.2)
  for (let i = 0; i < 3; i++) tun(m, v, t + aleatorio(0.05, 0.4), 220, 140, 0.18, 0.025)
}

// ─── Capas por evento ────────────────────────────────────────────────────────

/**
 * El «swing» de una herramienta del elenco (el movimiento, antes del contacto). Devuelve false si
 * la herramienta no es del elenco nuevo (que suene lo de siempre).
 */
export function swingElenco(m: Mesa, t: number, h: string, fuerza: FuerzaGolpe, pan: number): boolean {
  switch (h) {
    case 'navaja':
      navaja(m, t, { pan, volumen: 0.7 })
      return true
    case 'celular':
    case 'anteojos':
    case 'bombo':
    case 'trago':
    case 'botella':
    case 'gorro':
    case 'mate':
    case 'panal':
      silbido(m, t, { fuerza, pan })
      return true
    case 'guante':
      fuego(m, t, { pan, dur: 0.26, volumen: 0.55 })
      silbido(m, t, { fuerza: 'fuerte', pan })
      return true
    case 'moto':
      moto(m, t, { pan })
      return true
    case 'break':
      molino(m, t, { pan, dur: 0.5 })
      return true
    case 'baile':
      silbido(m, t, { fuerza: 'medio', pan })
      return true
    case 'dragon':
      dragon(m, t, { pan, dur: 0.5 })
      silbido(m, t, { fuerza: 'especial', pan })
      return true
    case 'pesado':
    case 'agarre':
    case 'sismo':
      silbido(m, t, { fuerza: 'fuerte', pan })
      return true
    case 'pelota':
    case 'leche':
    case 'agua':
    case 'graffiti':
    case 'onda':
    case 'nube':
    case 'bala':
      // estos suenan con su proyectil (o su disparo): el swing no agrega nada
      return true
    default:
      return false
  }
}

/** La capa propia de la herramienta cuando el golpe ENTRA (además del impacto). */
export function capaElenco(m: Mesa, t: number, h: string, pan: number): void {
  switch (h) {
    case 'bombo':
      bombo(m, t, { pan, fuerza: 0.6 })
      break
    case 'navaja':
      navaja(m, t, { pan, volumen: 0.65 })
      break
    case 'celular':
      celular(m, t, pan)
      break
    case 'anteojos':
      anteojos(m, t, pan)
      break
    case 'guante':
      guante(m, t, pan)
      break
    case 'bala':
      balaImpacto(m, t, pan)
      break
    case 'baile':
    case 'onda': {
      const v = m.voz('cuarteto', t, { pan, reverb: 0.3, volumen: 0.5, separacion: 0.08 })
      if (!v) break
      const g = m.ganancia(v, 0, v.salida)
      const fin = envPercusion(g.gain, t, 0.003, 0.16, 0.2)
      const f = m.filtro(v, 'lowpass', 3500, 1, g)
      for (const n of [57, 61, 64, 69]) m.osc(v, m.pulso25, midiHz(n), t, fin + 0.01, f)
      break
    }
    case 'dragon':
      fuego(m, t, { pan, dur: 0.3, volumen: 0.6 })
      break
    case 'pelota':
      pique(m, t, pan)
      break
    case 'leche':
      salpicadura(m, t, pan, 0.45)
      break
    case 'agua':
      salpicadura(m, t, pan, 0.4)
      vapor(m, t, pan, 0.3, 0.35)
      break
    case 'panal':
      panal(m, t, pan)
      break
    case 'sismo': {
      const v = m.voz('sismo', t, { pan, volumen: 0.6 })
      if (!v) break
      for (let i = 0; i < 4; i++) tic(m, v, t + Math.random() * 0.2, 'bandpass', aleatorio(800, 1800), 4, 0.35, 0.03)
      break
    }
    case 'pesado': {
      const v = m.voz('golpe', t, { pan, volumen: 0.7, saturar: true })
      if (v) tun(m, v, t, 70, 32, 0.8, 0.3)
      break
    }
    case 'graffiti':
    case 'trago':
    case 'botella':
    case 'mate':
      // el estallido, la salpicadura o el vidrio suenan cuando el proyectil desaparece
      break
    default:
      break
  }
}

/**
 * La capa de cada especial del elenco en el «super flash» (lo de Simón y Chipi sigue en
 * poderes.ts). Devuelve false si el icono no es del elenco.
 */
export function superFlashElenco(m: Mesa, t: number, icono: string, pan: number): boolean {
  switch (icono) {
    case 'bombo':
      bombo(m, t, { pan, fuerza: 0.7 })
      bombo(m, t + 0.18, { pan, fuerza: 0.9 })
      return true
    case 'navaja':
      navaja(m, t + 0.03, { pan })
      return true
    case 'cura': {
      const v = m.voz('liquido', t, { pan, volumen: 0.6 })
      if (v) burbujas(m, v, t, 3, 380, 800)
      curacion(m, t + 0.12, pan, 0)
      return true
    }
    case 'guante':
      fuego(m, t + 0.02, { pan, dur: 0.4, volumen: 0.65 })
      return true
    case 'moto':
      moto(m, t, { pan, dur: 0.6, volumen: 0.6 })
      return true
    case 'pistola':
      cargarArma(m, t + 0.04, pan)
      return true
    case 'break':
      scratch(m, t + 0.02, pan)
      return true
    case 'graffiti':
      aerosol(m, t + 0.02, pan, 0.3)
      return true
    case 'trago':
      trago(m, t + 0.02, pan)
      return true
    case 'botella':
      flair(m, t + 0.02, pan)
      return true
    case 'baile':
      cuarteto(m, t + 0.02, pan)
      return true
    case 'grito':
      microfono(m, t + 0.03, pan)
      return true
    case 'gorro':
      silbido(m, t + 0.04, { fuerza: 'especial', pan })
      return true
    case 'dragon':
      dragon(m, t + 0.02, { pan, dur: 0.5 })
      return true
    case 'pelota':
      pique(m, t + 0.03, pan, 0.5)
      pique(m, t + 0.24, pan, 0.45)
      return true
    case 'chilena':
      silbido(m, t + 0.03, { fuerza: 'especial', pan })
      pique(m, t + 0.08, pan, 0.4)
      return true
    case 'mamadera': {
      const v = m.voz('liquido', t, { pan, reverb: 0.25, volumen: 0.55 })
      if (!v) return true
      const g = m.ganancia(v, 0, v.salida)
      const fin = envSostenida(g.gain, t + 0.02, 0.01, 0.16, 0.12, 0.06)
      const o = m.osc(v, 'sine', 1200, t + 0.02, fin + 0.01, g)
      o.frequency.linearRampToValueAtTime(1650, fin)
      m.lfo(v, 'sine', 9, 40, t + 0.02, fin + 0.01, o.frequency)
      burbujas(m, v, t + 0.2, 2, 420, 900)
      return true
    }
    case 'panal':
      moscas(m, t, pan, 0.7, 0.45)
      return true
    case 'mate':
      sorbo(m, t + 0.02, pan)
      return true
    case 'termo':
      vapor(m, t + 0.02, pan, 0.45, 0.5)
      return true
    case 'agarre':
      grunido(m, t + 0.02, pan)
      return true
    case 'sismo': {
      const v = m.voz('sismo', t, { pan, volumen: 0.6 })
      if (v) tic(m, v, t, 'lowpass', 220, 0.8, 0.7, 0.5)
      return true
    }
    default:
      return false
  }
}

/** El lanzamiento de un proyectil del elenco. Devuelve false si el tipo no es del elenco. */
export function lanzamientoElenco(m: Mesa, t: number, tipo: string, pan: number): boolean {
  switch (tipo) {
    case 'bombo':
      bombo(m, t, { pan, fuerza: 1 })
      return true
    case 'bala':
      // el tiro suena con su evento `disparo` (uno por bala)
      return true
    case 'graffiti':
    case 'onda':
    case 'leche':
    case 'agua':
    case 'nube':
    case 'sismo':
      // arrancan con su bucle (o con su evento) y no repiten acá
      if (tipo === 'onda') grito(m, t, pan)
      return true
    case 'trago':
      trago(m, t, pan)
      silbido(m, t, { fuerza: 'medio', pan })
      return true
    case 'botella':
      silbido(m, t, { fuerza: 'medio', pan })
      return true
    case 'gorro':
      silbido(m, t, { fuerza: 'fuerte', pan })
      return true
    case 'pelota':
      pelota(m, t, pan)
      return true
    case 'panal':
    case 'mate':
      silbido(m, t, { fuerza: 'leve', pan })
      return true
    case 'guante':
      fuego(m, t, { pan, dur: 0.3, volumen: 0.6 })
      silbido(m, t, { fuerza: 'especial', pan })
      return true
    default:
      return false
  }
}

/** El bucle de un proyectil del elenco en vuelo (null: ése no lleva). */
export function bucleElenco(m: Mesa, t: number, tipo: string, pan: number): Voz | null | undefined {
  switch (tipo) {
    case 'bombo':
      return bomboRodando(m, t, pan)
    case 'graffiti':
      return aerosol(m, t, pan, 0.55)
    case 'onda':
      return ondaVolando(m, t, pan)
    case 'gorro':
      return zumbido(m, t, pan)
    case 'leche':
      return chorro(m, t, { pan, caliente: false })
    case 'agua':
      return chorro(m, t, { pan, caliente: true })
    case 'nube':
      return gas(m, t, pan)
    case 'sismo':
      return retumbe(m, t, pan)
    case 'guante':
      return fuegoVolando(m, t, pan)
    case 'bala':
    case 'trago':
    case 'botella':
    case 'pelota':
    case 'panal':
    case 'mate':
      return null
    default:
      return undefined
  }
}

/** Cuando un proyectil del elenco desaparece en pantalla (cae, pega o estalla). */
export function finElenco(m: Mesa, t: number, tipo: string, pan: number): void {
  switch (tipo) {
    case 'trago':
      salpicadura(m, t, pan)
      break
    case 'botella':
      botellaRota(m, t, pan)
      break
    case 'mate':
      mate(m, t, pan)
      break
    case 'pelota':
      pique(m, t, pan, 0.4)
      break
    case 'bombo': {
      const v = m.voz('bombo', t, { pan, volumen: 0.45 })
      if (v) tun(m, v, t, 90, 50, 0.5, 0.18)
      break
    }
    case 'guante':
      fuego(m, t, { pan, dur: 0.22, volumen: 0.45 })
      break
    default:
      break
  }
}
