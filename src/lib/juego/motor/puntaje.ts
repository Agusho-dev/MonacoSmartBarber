/**
 * Puntaje del ranking. Las partes suman exactamente el total (el desglose de la pantalla de
 * resultado se puede animar parte por parte).
 */
import type { DesglosePuntaje, Dificultad, Lado, Partida } from '../tipos'
import { internoSiExiste } from './interno'

export const PUNTOS = {
  danio: 1,
  comboMax: 40,
  critico: 30,
  especialAcertado: 120,
  roundGanado: 500,
  perfecto: 1000,
  segundoKO: 10,
  alCero: 1500,
} as const

export const MULTIPLICADOR_DIFICULTAD: Readonly<Record<Dificultad, number>> = { facil: 0.6, normal: 1, dificil: 1.6 }

const NOMBRE_DIFICULTAD: Readonly<Record<Dificultad, string>> = { facil: 'fácil', normal: 'normal', dificil: 'difícil' }

/**
 * Umbrales de rango, ajustados con el simulador (29/oct/2026): ganar en fácil da C o B, en normal
 * B o A, en difícil A o S (S = la mitad de arriba de las victorias en difícil); perder, D o C.
 */
export const RANGOS: readonly { rango: string; desde: number }[] = [
  { rango: 'S', desde: 10000 },
  { rango: 'A', desde: 6500 },
  { rango: 'B', desde: 3500 },
  { rango: 'C', desde: 1800 },
  { rango: 'D', desde: 0 },
]

export function rangoDe(total: number): string {
  for (const r of RANGOS) if (total >= r.desde) return r.rango
  return 'D'
}

function decimal(n: number): string {
  return String(n).replace('.', ',')
}

export function calcularPuntaje(p: Partida, lado: Lado): DesglosePuntaje {
  const st = p.estadisticas[lado]
  const segundosKO = internoSiExiste(p)?.segundosKO[lado] ?? 0
  const partes: { etiqueta: string; puntos: number }[] = []
  const sumar = (etiqueta: string, puntos: number) => {
    const n = Math.round(puntos)
    if (n !== 0) partes.push({ etiqueta, puntos: n })
  }
  sumar('Daño hecho', st.danioHecho * PUNTOS.danio)
  sumar(`Combo máximo: ${st.comboMax} golpes`, st.comboMax * PUNTOS.comboMax)
  sumar(`Críticos: ${st.criticos}`, st.criticos * PUNTOS.critico)
  sumar(`Especiales que entraron: ${st.especialesAcertados}`, st.especialesAcertados * PUNTOS.especialAcertado)
  sumar(`Rounds ganados: ${p.rondasGanadas[lado]}`, p.rondasGanadas[lado] * PUNTOS.roundGanado)
  sumar(`Rounds perfectos: ${st.rondasPerfectas}`, st.rondasPerfectas * PUNTOS.perfecto)
  sumar(`Reloj sobrante en tus KO: ${segundosKO} s`, segundosKO * PUNTOS.segundoKO)
  if (st.finalAlCero) sumar('¡Al cero!', PUNTOS.alCero)
  const base = partes.reduce((s, x) => s + x.puntos, 0)

  const dificultad = p.config.dificultad
  const mult = MULTIPLICADOR_DIFICULTAD[dificultad] ?? 1
  const conDificultad = Math.round(base * mult)
  sumar(`Dificultad ${NOMBRE_DIFICULTAD[dificultad] ?? dificultad} ×${decimal(mult)}`, conDificultad - base)

  let total = conDificultad
  if (p.ganadorPartida !== null && p.ganadorPartida !== lado) {
    const mitad = Math.floor(total / 2)
    sumar('Derrota: la mitad', mitad - total)
    total = mitad
  }
  return { total, partes, rango: rangoDe(total) }
}
