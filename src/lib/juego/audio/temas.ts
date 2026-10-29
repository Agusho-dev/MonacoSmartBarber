/**
 * Los cuatro temas: «pelea» (120 BPM, La menor, chiptune moderno con pegada), «menu» (98 BPM,
 * tranquilo, con swing), y los jingles de «victoria» (La mayor) y «derrota». Un tema es una
 * función que, para cada paso de 1/16, agenda lo que suena; el secuenciador (musica.ts) la
 * llama con anticipación, planificado contra currentTime.
 */
import type { TemaMusica } from '../tipos'
import type { CtxPaso } from './instrumentos'
import {
  acordeFinal,
  arpegio,
  bajo,
  bajoSuave,
  bombo,
  caja,
  campanita,
  colchon,
  hihat,
  lider,
  palmas,
  platillo,
} from './instrumentos'

export interface DefTema {
  bpm: number
  /** Pasos de 1/16 del loop o del jingle entero. */
  pasos: number
  loop: boolean
  /** 0..0,5 del 1/16: corre las semicorcheas impares (groove). */
  swing: number
  /** Segundos que sigue sonando después del último paso (colas y eco). */
  cola: number
  /** Eco del tema: realimentación, nivel de retorno, pasa bajos y tiempo (en pasos de 1/16). */
  eco: { retro: number; nivel: number; corte: number; pasos: number }
  /** Fundido de entrada (s). */
  entrada: number
  /**
   * Ganancia del tema. Calibrada en Chrome para que, con los volúmenes por defecto, la pelea quede
   * ~7 dB por debajo de los golpes (RMS ≈ -20 dB) y el menú un poco más abajo.
   */
  nivel: number
  paso(c: CtxPaso): void
}

/** [paso, nota MIDI (o semitonos), largo en pasos] */
type Nota = readonly [number, number, number]

// ─── Pelea ───────────────────────────────────────────────────────────────────

interface AcordePelea {
  raiz: number
  tonos: readonly number[]
}

/** Am | F | C | G || Am | F | Dm | E  (la sección B termina en la dominante: tensión). */
const PELEA_ACORDES: readonly AcordePelea[] = [
  { raiz: 45, tonos: [69, 72, 76, 81, 84] },
  { raiz: 41, tonos: [65, 69, 72, 77, 81] },
  { raiz: 48, tonos: [67, 72, 76, 79, 84] },
  { raiz: 43, tonos: [67, 71, 74, 79, 83] },
  { raiz: 45, tonos: [69, 72, 76, 81, 84] },
  { raiz: 41, tonos: [65, 69, 72, 77, 81] },
  { raiz: 38, tonos: [65, 69, 74, 77, 81] },
  { raiz: 40, tonos: [68, 71, 76, 80, 83] },
]

/** Bajo por compás: [paso, semitonos sobre la raíz, largo]. Octavas que empujan. */
const PELEA_BAJO: readonly Nota[] = [
  [0, 0, 2], [2, 0, 1], [3, 12, 1], [4, 0, 2], [6, 0, 1], [7, 12, 1],
  [8, 0, 2], [10, 0, 1], [11, 12, 1], [12, 0, 1], [13, 7, 1], [14, 12, 1], [15, 7, 1],
]

const PELEA_ARP = [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1] as const

/** La melodía (sección B, compases 4–7). */
const PELEA_LIDER_B: readonly (readonly Nota[])[] = [
  [[0, 76, 3], [3, 74, 1], [4, 76, 2], [6, 79, 2], [8, 81, 4], [12, 79, 2], [14, 76, 2]],
  [[0, 77, 3], [3, 76, 1], [4, 77, 2], [6, 81, 2], [8, 84, 4], [12, 81, 2], [14, 77, 2]],
  [[0, 74, 2], [2, 77, 2], [4, 81, 2], [6, 77, 2], [8, 86, 3], [11, 84, 1], [12, 81, 2], [14, 77, 2]],
  [[0, 80, 4], [4, 83, 4], [8, 88, 3], [11, 86, 1], [12, 84, 1], [13, 83, 1], [14, 80, 2]],
]

/** Contracanto de la sección A: sólo suena en TURBO. */
const PELEA_LIDER_A: readonly (readonly Nota[])[] = [
  PELEA_LIDER_B[0],
  PELEA_LIDER_B[1],
  [[0, 76, 3], [3, 74, 1], [4, 72, 2], [6, 76, 2], [8, 79, 4], [12, 76, 2], [14, 72, 2]],
  [[0, 74, 3], [3, 72, 1], [4, 71, 2], [6, 74, 2], [8, 79, 4], [12, 83, 2], [14, 79, 2]],
]

function notaDelCompas(lista: readonly Nota[], paso: number): Nota | undefined {
  for (const n of lista) if (n[0] === paso) return n
  return undefined
}

function pasoPelea(c: CtxPaso): void {
  const compas = Math.floor(c.i / 16)
  const p = c.i % 16
  const seccionB = compas >= 4
  const turbo = c.intensidad >= 2
  const finalOTurbo = c.intensidad >= 1
  const acorde = PELEA_ACORDES[compas]
  const t = c.t
  const d = c.d16

  // Batería
  if (p % 4 === 0) bombo(c, t, 1)
  if ((compas === 3 || compas === 7) && p === 10) bombo(c, t, 0.6)
  if (turbo && p === 14) bombo(c, t, 0.7)
  if (p === 4 || p === 12) caja(c, t, 1)
  const redoble = compas === 7 || (turbo && compas === 3)
  if (redoble && p >= 13) caja(c, t, 0.4 + (p - 13) * 0.25)
  else if (seccionB && p === 15) caja(c, t, 0.3)
  if (p % 4 === 2) hihat(c, t, 0.9, turbo && p === 14)
  else if ((seccionB || finalOTurbo) && p % 2 === 1) hihat(c, t, 0.45)
  if (p === 0 && (compas === 0 || compas === 4)) platillo(c, t, compas === 0 ? 0.8 : 0.6)

  // Bajo
  const b = notaDelCompas(PELEA_BAJO, p)
  if (b) bajo(c, t, acorde.raiz + b[1], b[2] * d, p % 4 === 0 ? 1 : 0.75)

  // Arpegio (en TURBO, una octava arriba y más brillante)
  const tono = acorde.tonos[PELEA_ARP[p]]
  arpegio(c, t, tono + (turbo ? 12 : 0), d * 1.2, p % 4 === 0 ? 1 : 0.7, turbo ? 0.8 : seccionB ? 0.35 : 0.1)

  // Melodía
  const lineas = seccionB ? PELEA_LIDER_B : turbo ? PELEA_LIDER_A : null
  if (lineas) {
    const n = notaDelCompas(lineas[compas % 4], p)
    if (n) lider(c, t, n[1], n[2] * d, 1)
  }
}

// ─── Menú ────────────────────────────────────────────────────────────────────

interface AcordeMenu {
  raiz: number
  colchon: readonly number[]
  campana: readonly number[]
}

/** Am7 | Fmaj7 | Cmaj7 | G6 || Am7 | Fmaj7 | Dm7 | E7 */
const MENU_ACORDES: readonly AcordeMenu[] = [
  { raiz: 45, colchon: [57, 60, 64, 67], campana: [81, 84, 88, 91] },
  { raiz: 41, colchon: [53, 57, 60, 64], campana: [81, 84, 88, 89] },
  { raiz: 48, colchon: [55, 60, 64, 71], campana: [79, 84, 88, 91] },
  { raiz: 43, colchon: [55, 59, 62, 64], campana: [79, 83, 86, 88] },
  { raiz: 45, colchon: [57, 60, 64, 67], campana: [81, 84, 88, 91] },
  { raiz: 41, colchon: [53, 57, 60, 64], campana: [81, 84, 88, 89] },
  { raiz: 38, colchon: [53, 57, 60, 62], campana: [77, 81, 84, 86] },
  { raiz: 40, colchon: [52, 56, 59, 62], campana: [76, 80, 83, 86] },
]

const MENU_BAJO: readonly Nota[] = [[0, 0, 6], [6, 7, 2], [8, 0, 4], [14, 12, 2]]
/** Campanita: [paso, índice del tono] — sincopada. */
const MENU_CAMPANA: ReadonlyArray<readonly [number, number]> = [[0, 3], [3, 2], [6, 1], [10, 2], [12, 0]]
const MENU_CAMPANA_B: ReadonlyArray<readonly [number, number]> = [[0, 3], [2, 2], [3, 1], [6, 2], [8, 3], [10, 1], [12, 0], [14, 1]]
const SHAKER = [0.35, 0.15, 0.25, 0.15] as const

function pasoMenu(c: CtxPaso): void {
  const compas = Math.floor(c.i / 16)
  const p = c.i % 16
  const acorde = MENU_ACORDES[compas]
  const seccionB = compas >= 4
  const t = c.t
  const d = c.d16

  if (p === 0) bombo(c, t, 0.75)
  if (p === 10) bombo(c, t, 0.55)
  if (p === 4 || p === 12) palmas(c, t, 0.7)
  hihat(c, t, SHAKER[p % 4], p === 14 && compas % 2 === 1)
  if (p === 0) colchon(c, t, acorde.colchon, 16 * d, 1)
  const b = notaDelCompas(MENU_BAJO, p)
  if (b) bajoSuave(c, t, acorde.raiz + b[1], b[2] * d, 1)
  for (const [paso, idx] of seccionB ? MENU_CAMPANA_B : MENU_CAMPANA) {
    if (paso === p) campanita(c, t, acorde.campana[idx], seccionB ? 0.8 : 1)
  }
}

// ─── Victoria ────────────────────────────────────────────────────────────────

const VICTORIA_LIDER: readonly Nota[] = [
  [0, 76, 2], [2, 81, 2], [4, 85, 2], [6, 88, 4], [10, 86, 1], [11, 85, 1], [12, 83, 2], [14, 85, 2],
  [16, 88, 3], [19, 86, 1], [20, 85, 2], [22, 83, 2], [24, 93, 8],
]
const VICTORIA_BAJO: readonly Nota[] = [[0, 45, 6], [8, 45, 4], [12, 52, 4], [16, 50, 4], [20, 52, 4], [24, 45, 8]]
const VICTORIA_ARP: ReadonlyArray<readonly number[]> = [
  [69, 73, 76, 81],
  [74, 78, 81, 86],
  [76, 80, 83, 88],
]

function pasoVictoria(c: CtxPaso): void {
  const p = c.i
  const t = c.t
  const d = c.d16
  if (p < 24 && p % 4 === 0) bombo(c, t, 0.9)
  if (p === 4 || p === 12 || p === 20) caja(c, t, 0.9)
  if (p >= 21 && p <= 23) caja(c, t, 0.45 + (p - 21) * 0.2)
  if (p < 24 && p % 2 === 0) hihat(c, t, 0.7)
  if (p === 0) platillo(c, t, 0.7)
  if (p === 24) {
    bombo(c, t, 1)
    platillo(c, t, 1)
    acordeFinal(c, t, [57, 61, 64, 69, 73, 76], 1.6, 1)
  }
  const b = notaDelCompas(VICTORIA_BAJO, p)
  if (b) bajo(c, t, b[1], b[2] * d, 0.9)
  if (p < 24) {
    const arp = VICTORIA_ARP[p < 16 ? 0 : p < 20 ? 1 : 2]
    arpegio(c, t, arp[p % 4] + 12, d, 0.6, 0.6)
  }
  const n = notaDelCompas(VICTORIA_LIDER, p)
  if (n) lider(c, t, n[1], n[2] * d, 1.15)
}

// ─── Derrota ─────────────────────────────────────────────────────────────────

const DERROTA_LIDER: readonly Nota[] = [[0, 76, 4], [4, 74, 4], [8, 72, 4], [12, 71, 4], [16, 69, 8]]
const DERROTA_ACORDES: ReadonlyArray<readonly [number, readonly number[]]> = [
  [0, [57, 60, 64]],
  [4, [55, 59, 62]],
  [8, [53, 57, 60]],
  [12, [52, 56, 59]],
  [16, [45, 57, 60, 64]],
]
const DERROTA_BAJO: readonly Nota[] = [[0, 45, 4], [4, 43, 4], [8, 41, 4], [12, 40, 4], [16, 33, 8]]

function pasoDerrota(c: CtxPaso): void {
  const p = c.i
  const t = c.t
  const d = c.d16
  if (p === 0 || p === 8) bombo(c, t, 0.6)
  if (p === 16) bombo(c, t, 0.9)
  for (const [paso, notas] of DERROTA_ACORDES) {
    if (paso === p) colchon(c, t, notas, (p === 16 ? 10 : 4) * d, p === 16 ? 1.3 : 1)
  }
  const b = notaDelCompas(DERROTA_BAJO, p)
  if (b) bajoSuave(c, t, b[1], b[2] * d, 0.9)
  const n = notaDelCompas(DERROTA_LIDER, p)
  if (n) lider(c, t, n[1], n[2] * d, 0.9)
}

export const TEMAS: Readonly<Record<TemaMusica, DefTema>> = {
  pelea: {
    bpm: 120,
    pasos: 128,
    loop: true,
    swing: 0,
    cola: 0.6,
    eco: { retro: 0.3, nivel: 0.35, corte: 2600, pasos: 3 },
    entrada: 0.35,
    nivel: 0.43,
    paso: pasoPelea,
  },
  menu: {
    bpm: 98,
    pasos: 128,
    loop: true,
    swing: 0.14,
    cola: 1,
    eco: { retro: 0.38, nivel: 0.45, corte: 2200, pasos: 3 },
    entrada: 1.2,
    nivel: 0.38,
    paso: pasoMenu,
  },
  victoria: {
    bpm: 150,
    pasos: 32,
    loop: false,
    swing: 0,
    cola: 2,
    eco: { retro: 0.28, nivel: 0.35, corte: 3000, pasos: 3 },
    entrada: 0.01,
    nivel: 0.76,
    paso: pasoVictoria,
  },
  derrota: {
    bpm: 108,
    pasos: 24,
    loop: false,
    swing: 0,
    cola: 2.2,
    eco: { retro: 0.3, nivel: 0.4, corte: 1800, pasos: 4 },
    entrada: 0.01,
    nivel: 0.76,
    paso: pasoDerrota,
  },
}
