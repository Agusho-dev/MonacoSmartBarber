// El período de la conciliación: días enteros en hora argentina.
//
// Se maneja como dos "YYYY-MM-DD" INCLUSIVOS (`desde`, `hasta`), que es lo que
// viaja en la URL (`?desde=2026-10-14&hasta=2026-10-20`) y lo que lee una
// persona. Recién al pedirle datos al servidor se convierte en instantes
// [desde 00:00, hasta+1 00:00) con el offset argentino del día.
//
// Por qué "7 días" y "Mes" terminan AYER y no hoy: una conciliación es sobre
// días cerrados. Con el día en curso adentro, los cobros de los últimos minutos
// todavía no se leyeron en Mercado Pago y el veredicto quedaría casi siempre en
// "Todavía no se puede saber". El día de hoy tiene su botón propio ("Hoy").
//
// Puro (sin React ni Supabase): lo usan el server component y el cliente, y se
// prueba con node.

import { MESES, ZONA_AR, diaCorto, diaLargo, diaMes } from './formato'

export type PresetPeriodo = 'ayer' | 'hoy' | '7d' | 'mes'

export interface Periodo {
  /** YYYY-MM-DD (inclusivo, hora argentina) */
  desde: string
  /** YYYY-MM-DD (inclusivo, hora argentina) */
  hasta: string
}

/** El servidor no concilia más de 62 días de una vez. */
export const MAX_DIAS_PERIODO = 62

export const PRESETS: { id: PresetPeriodo; etiqueta: string }[] = [
  { id: 'ayer', etiqueta: 'Ayer' },
  { id: 'hoy', etiqueta: 'Hoy' },
  { id: '7d', etiqueta: '7 días' },
  { id: 'mes', etiqueta: 'Mes' },
]

/** Cookie con el último preset elegido: el servidor la lee y precarga ese período sin parpadeo. */
export const COOKIE_PRESET = 'msb_conciliacion_periodo'

export function esPreset(v: unknown): v is PresetPeriodo {
  return v === 'ayer' || v === 'hoy' || v === '7d' || v === 'mes'
}

const RE_YMD = /^(\d{4})-(\d{2})-(\d{2})$/

/** ¿Es un "YYYY-MM-DD" de un día que existe? */
export function esYMD(v: unknown): v is string {
  if (typeof v !== 'string') return false
  const m = RE_YMD.exec(v)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const f = new Date(Date.UTC(y, mo - 1, d))
  return f.getUTCFullYear() === y && f.getUTCMonth() === mo - 1 && f.getUTCDate() === d
}

function aUTC(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function deUTC(f: Date): string {
  return `${f.getUTCFullYear()}-${String(f.getUTCMonth() + 1).padStart(2, '0')}-${String(f.getUTCDate()).padStart(2, '0')}`
}

export function sumarDias(ymd: string, n: number): string {
  const f = aUTC(ymd)
  f.setUTCDate(f.getUTCDate() + n)
  return deUTC(f)
}

/** Días entre dos fechas, contando las dos puntas (desde = hasta → 1). */
export function diasDelPeriodo(p: Periodo): number {
  return Math.round((aUTC(p.hasta).getTime() - aUTC(p.desde).getTime()) / 86_400_000) + 1
}

export function primerDiaDelMes(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`
}

export function ultimoDiaDelMes(ymd: string): string {
  const [y, m] = ymd.split('-').map(Number)
  return deUTC(new Date(Date.UTC(y, m, 0)))
}

/** Desde el 1 hasta el último día de un mismo mes. */
export function esMesCompleto(p: Periodo): boolean {
  return p.desde.slice(0, 7) === p.hasta.slice(0, 7) && p.desde.endsWith('-01') && p.hasta === ultimoDiaDelMes(p.desde)
}

/** Del 1 de un mes hasta algún día de ese mismo mes (el mes "en curso" visto ayer). */
function esMesHastaUnDia(p: Periodo): boolean {
  return p.desde.slice(0, 7) === p.hasta.slice(0, 7) && p.desde.endsWith('-01')
}

/** Hoy (YYYY-MM-DD) en Argentina. Impuro: llamarlo en handlers o en el servidor, nunca al dibujar. */
export function hoyEnArgentina(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_AR }).format(ahora)
}

export function rangoDePreset(preset: PresetPeriodo, hoy: string): Periodo {
  const ayer = sumarDias(hoy, -1)
  switch (preset) {
    case 'ayer':
      return { desde: ayer, hasta: ayer }
    case 'hoy':
      return { desde: hoy, hasta: hoy }
    case '7d':
      return { desde: sumarDias(hoy, -7), hasta: ayer }
    case 'mes':
      // El 1 del mes todavía no hay días cerrados: el mes anterior entero.
      if (hoy.endsWith('-01')) return { desde: primerDiaDelMes(ayer), hasta: ayer }
      return { desde: primerDiaDelMes(hoy), hasta: ayer }
  }
}

/** Qué preset es este período hoy (null: lo eligió a mano). */
export function presetDe(p: Periodo, hoy: string): PresetPeriodo | null {
  for (const { id } of PRESETS) {
    const r = rangoDePreset(id, hoy)
    if (r.desde === p.desde && r.hasta === p.hasta) return id
  }
  return null
}

export function mismoPeriodo(a: Periodo, b: Periodo): boolean {
  return a.desde === b.desde && a.hasta === b.hasta
}

export function clavePeriodo(p: Periodo): string {
  return `${p.desde}_${p.hasta}`
}

/**
 * ‹ y ›: un día se mueve de a un día; un mes calendario, de a un mes; cualquier
 * otro rango, de a su largo. Nunca hacia el futuro: devuelve null si no se puede.
 */
export function moverPeriodo(p: Periodo, direccion: -1 | 1, hoy: string): Periodo | null {
  let r: Periodo
  if (p.desde === p.hasta) {
    const d = sumarDias(p.desde, direccion)
    r = { desde: d, hasta: d }
  } else if (esMesCompleto(p) || esMesHastaUnDia(p)) {
    const [y, m] = p.desde.split('-').map(Number)
    const inicio = deUTC(new Date(Date.UTC(y, m - 1 + direccion, 1)))
    const fin = ultimoDiaDelMes(inicio)
    // El mes en curso va hasta ayer (o hasta hoy, si hoy es el único día).
    const ayer = sumarDias(hoy, -1)
    if (inicio > hoy) return null
    if (fin >= hoy) r = { desde: inicio, hasta: ayer >= inicio ? ayer : hoy }
    else r = { desde: inicio, hasta: fin }
  } else {
    const n = diasDelPeriodo(p)
    r = { desde: sumarDias(p.desde, n * direccion), hasta: sumarDias(p.hasta, n * direccion) }
  }
  if (r.hasta > hoy) return null
  return r
}

/**
 * Los límites para el servidor: [desde 00:00, hasta + 1 día 00:00) con el offset
 * argentino de cada punta (hoy es −03:00 todo el año; si vuelve el horario de
 * verano, esto sigue dando bien).
 */
export function limitesISO(p: Periodo): { desde: string; hasta: string } {
  const fin = sumarDias(p.hasta, 1)
  return { desde: `${p.desde}T00:00:00${offsetAR(p.desde)}`, hasta: `${fin}T00:00:00${offsetAR(fin)}` }
}

/** "-03:00": el offset argentino al mediodía de ese día. */
export function offsetAR(ymd: string): string {
  try {
    const f = new Date(`${ymd}T15:00:00Z`)
    const parte = new Intl.DateTimeFormat('en-US', { timeZone: ZONA_AR, timeZoneName: 'longOffset' })
      .formatToParts(f)
      .find((x) => x.type === 'timeZoneName')
    const m = parte?.value.match(/([+-])(\d{2}):?(\d{2})/)
    if (m) return `${m[1]}${m[2]}:${m[3]}`
  } catch {
    // Motores sin 'longOffset': Argentina no tiene horario de verano desde 2009.
  }
  return '-03:00'
}

function nombreMes(ymd: string, hoy: string): string {
  const mes = MESES[Number(ymd.slice(5, 7)) - 1]
  return ymd.slice(0, 4) === hoy.slice(0, 4) ? mes : `${mes} de ${ymd.slice(0, 4)}`
}

/** Para preguntarle a Tex: "de ayer", "del martes 20/10", "de octubre", "del 14/10 al 20/10". */
export function fraseDePeriodo(p: Periodo, hoy: string): string {
  if (p.desde === p.hasta) {
    if (p.desde === hoy) return 'de hoy'
    if (p.desde === sumarDias(hoy, -1)) return 'de ayer'
    return `del ${diaLargo(p.desde)}`
  }
  if (esMesCompleto(p)) return `de ${nombreMes(p.desde, hoy)}`
  return `del ${diaMes(p.desde)} al ${diaMes(p.hasta)}`
}

/** Lo que muestra el control "‹ mar 20/10 ›". */
export function textoDelControl(p: Periodo, hoy: string): { principal: string; detalle: string | null } {
  if (p.desde === p.hasta) {
    const detalle = p.desde === hoy ? 'Hoy' : p.desde === sumarDias(hoy, -1) ? 'Ayer' : null
    return { principal: diaCorto(p.desde), detalle }
  }
  const n = diasDelPeriodo(p)
  if (esMesCompleto(p) || esMesHastaUnDia(p)) {
    const mes = nombreMes(p.desde, hoy)
    return { principal: `${diaMes(p.desde)} – ${diaMes(p.hasta)}`, detalle: mes.charAt(0).toUpperCase() + mes.slice(1) }
  }
  return { principal: `${diaMes(p.desde)} – ${diaMes(p.hasta)}`, detalle: `${n} días` }
}

/**
 * El período con el que abre la pantalla: el de la URL si es válido; si no, el
 * último preset elegido (cookie); si no, Ayer.
 */
export function periodoInicial(
  params: { desde?: string | null; hasta?: string | null },
  presetGuardado: string | null | undefined,
  hoy: string,
): Periodo {
  const { desde, hasta } = params
  if (esYMD(desde) && desde <= hoy) {
    const fin = esYMD(hasta) && hasta >= desde ? (hasta > hoy ? hoy : hasta) : desde
    const p = { desde, hasta: fin }
    if (diasDelPeriodo(p) <= MAX_DIAS_PERIODO) return p
  }
  return rangoDePreset(esPreset(presetGuardado) ? presetGuardado : 'ayer', hoy)
}

/** Un rango elegido en el calendario, acotado a lo que el servidor acepta. */
export function normalizarElegido(desde: string, hasta: string, hoy: string): Periodo | { error: string } {
  let a = desde
  let b = hasta
  if (b < a) [a, b] = [b, a]
  if (a > hoy) return { error: 'Elegí días que ya pasaron.' }
  if (b > hoy) b = hoy
  if (diasDelPeriodo({ desde: a, hasta: b }) > MAX_DIAS_PERIODO) {
    return { error: `Elegí hasta ${MAX_DIAS_PERIODO} días.` }
  }
  return { desde: a, hasta: b }
}
