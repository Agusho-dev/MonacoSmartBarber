// =============================================================================
// src/lib/tex/periodo.ts
// El período de una herramienta de Tex: un nombre ("hoy", "ayer", "semana",
// "mes", "mes_pasado") o dos días ("desde" / "hasta"), resuelto contra la fecha
// de PARED de Argentina que trae el contexto (`ctx.hoy`). Nunca contra la hora
// del proceso: en Vercel es UTC y de 21 a 24 h ya sería "mañana".
//
// Los días viajan como 'YYYY-MM-DD' y los dos extremos son INCLUSIVOS. Quien
// consulta la base convierte con `limitesDelDia` (src/lib/tex/datos.ts).
//
// PURO: sólo usa src/lib/tex/formato.ts. Lo prueban los tests del scratchpad.
// =============================================================================

import { diasEntre, esFecha, nombreDelMes, rangoFechas, sumarDias } from './formato'

export const PERIODOS_TEX = ['hoy', 'ayer', 'semana', 'mes', 'mes_pasado'] as const
export type NombrePeriodoTex = (typeof PERIODOS_TEX)[number]

export interface EntradaPeriodoTex {
  periodo?: NombrePeriodoTex
  desde?: string
  hasta?: string
}

export interface PeriodoTex {
  /** Primer día, inclusive. */
  desde: string
  /** Último día, inclusive (nunca después de hoy). */
  hasta: string
  /** Para la fuente: "1–22 oct", "28 sep–4 oct". */
  rango: string
  /** Para el modelo: "del 1 al 22 de octubre (el mes en curso)". */
  descripcion: string
  /** Llega hasta hoy: el día de hoy (y quizás el mes) todavía no terminó. */
  enCurso: boolean
  /** Se pidió hasta un día futuro y se cortó en hoy. */
  recortadoAHoy: boolean
}

export type ResultadoPeriodoTex = PeriodoTex | { error: string }

/** El tope de días de una consulta (como el resto de las herramientas de Tex). */
export const MAX_DIAS_PERIODO_TEX = 400

function primeroDelMes(fecha: string): string {
  return `${fecha.slice(0, 8)}01`
}

function describir(desde: string, hasta: string, hoy: string, nombre?: NombrePeriodoTex): string {
  const enCurso = hasta === hoy
  switch (nombre) {
    case 'hoy':
      return 'hoy (el día todavía no terminó)'
    case 'ayer':
      return `ayer (${rangoFechas(desde, hasta, hoy)})`
    case 'semana':
      return `los últimos 7 días, hoy incluido (${rangoFechas(desde, hasta, hoy)})`
    case 'mes':
      return `${nombreDelMes(desde)} del 1 al ${Number(hasta.slice(8, 10))} (el mes en curso)`
    case 'mes_pasado':
      return `${nombreDelMes(desde)} completo (${rangoFechas(desde, hasta, hoy)})`
    default:
      return `${rangoFechas(desde, hasta, hoy)}${enCurso ? ' (llega hasta hoy, que todavía no terminó)' : ''}`
  }
}

/**
 * El período pedido o un error para el modelo. Reglas:
 *   - `desde` manda sobre `periodo`. Sin `hasta`, va hasta hoy.
 *   - Un `hasta` futuro se corta en hoy (y queda dicho en `recortadoAHoy`).
 *   - Nada pedido = `porDefecto` (el mes en curso, salvo que la herramienta diga otra cosa).
 */
export function resolverPeriodoTex(hoy: string, entrada: EntradaPeriodoTex, porDefecto: NombrePeriodoTex = 'mes'): ResultadoPeriodoTex {
  if (!esFecha(hoy)) return { error: 'No pude saber la fecha de hoy.' }

  const armar = (desde: string, hasta: string, nombre?: NombrePeriodoTex, recortado = false): PeriodoTex => ({
    desde,
    hasta,
    rango: rangoFechas(desde, hasta, hoy),
    descripcion: describir(desde, hasta, hoy, nombre),
    enCurso: hasta === hoy,
    recortadoAHoy: recortado,
  })

  if (entrada.desde || entrada.hasta) {
    if (!entrada.desde) return { error: 'Falta el día "desde" (AAAA-MM-DD).' }
    const desde = entrada.desde
    const pedidoHasta = entrada.hasta ?? hoy
    if (!esFecha(desde) || !esFecha(pedidoHasta)) return { error: 'Las fechas van como AAAA-MM-DD y tienen que existir.' }
    if (desde > hoy) return { error: `Ese período todavía no empezó: hoy es ${hoy}.` }
    if (pedidoHasta < desde) return { error: 'La fecha de inicio es posterior a la de fin.' }
    const hasta = pedidoHasta > hoy ? hoy : pedidoHasta
    if (diasEntre(desde, hasta) + 1 > MAX_DIAS_PERIODO_TEX) return { error: `Pedí como máximo ${MAX_DIAS_PERIODO_TEX} días por consulta.` }
    return armar(desde, hasta, undefined, pedidoHasta > hoy)
  }

  switch (entrada.periodo ?? porDefecto) {
    case 'hoy':
      return armar(hoy, hoy, 'hoy')
    case 'ayer': {
      const ayer = sumarDias(hoy, -1)
      return armar(ayer, ayer, 'ayer')
    }
    case 'semana':
      return armar(sumarDias(hoy, -6), hoy, 'semana')
    case 'mes_pasado': {
      const ultimoDelAnterior = sumarDias(primeroDelMes(hoy), -1)
      return armar(primeroDelMes(ultimoDelAnterior), ultimoDelAnterior, 'mes_pasado')
    }
    case 'mes':
    default:
      return armar(primeroDelMes(hoy), hoy, 'mes')
  }
}

/**
 * Parte un período en tramos de hasta `dias` días (inclusivos, sin solaparse),
 * para consultar de a pedazos lo que en una sola llamada sería lento.
 */
export function tramosDelPeriodo(desde: string, hasta: string, dias = 31): { desde: string; hasta: string }[] {
  const tramos: { desde: string; hasta: string }[] = []
  let inicio = desde
  while (inicio <= hasta) {
    const fin = sumarDias(inicio, dias - 1)
    tramos.push({ desde: inicio, hasta: fin < hasta ? fin : hasta })
    inicio = sumarDias(inicio, dias)
  }
  return tramos
}
