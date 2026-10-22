// =============================================================================
// src/lib/conciliacion-mp/fechas.ts
// Períodos y formatos en hora argentina para la conciliación con Mercado Pago.
//
// PURO A PROPÓSITO: sin `server-only`, sin alias `@/` y sin dependencias. Lo
// importan el motor y la narrativa, que se prueban con `node` a secas (ver
// scratchpad/tests), y la pantalla. No reemplaza a `src/lib/time-utils.ts`
// para el resto del sistema: acá hacen falta cosas que allá no hay (inicio
// exacto del día local como instante, "hace 6 min", "lunes 20/10").
//
// NADA DE `toISOString().slice(0, 10)` PARA SABER EL DÍA: es la fecha UTC, y en
// Argentina después de las 21:00 ya es mañana (Known Risk de finanzas #33). El
// día de un cobro es el de la pared del local.
// =============================================================================

export const TZ_AR = 'America/Argentina/Buenos_Aires'

const MS_MIN = 60_000
const MS_DIA = 24 * 60 * MS_MIN

const fmtDia = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ_AR,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const fmtHora = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ_AR,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

const fmtOffset = new Intl.DateTimeFormat('en-US', { timeZone: TZ_AR, timeZoneName: 'longOffset' })

const fmtPlata = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })

const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

const RE_DIA = /^(\d{4})-(\d{2})-(\d{2})$/

type Instante = Date | string | number

function aMs(x: Instante): number {
  return x instanceof Date ? x.getTime() : typeof x === 'number' ? x : new Date(x).getTime()
}

/** Minutos de diferencia con UTC en ese instante (Argentina: -180). */
function offsetMinutos(ms: number): number {
  const parte = fmtOffset.formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')?.value ?? ''
  const m = parte.match(/([+-])(\d{2}):?(\d{2})/)
  if (!m) return 0
  const signo = m[1] === '-' ? -1 : 1
  return signo * (Number(m[2]) * 60 + Number(m[3]))
}

/** ¿Es un 'YYYY-MM-DD' válido? */
export function esDia(s: unknown): s is string {
  if (typeof s !== 'string') return false
  const m = s.match(RE_DIA)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
}

/** 'YYYY-MM-DD' del instante, en hora argentina. */
export function diaAR(x: Instante): string {
  return fmtDia.format(new Date(aMs(x)))
}

/** 'HH:MM' del instante, en hora argentina (24 h). */
export function hhmmAR(x: Instante): string {
  return fmtHora.format(new Date(aMs(x)))
}

/** Minutos desde la medianoche local (para "¿está dentro del horario del local?"). */
export function minutosDelDiaAR(x: Instante): number {
  const [h, m] = hhmmAR(x).split(':').map(Number)
  return h * 60 + m
}

/**
 * El instante en que empieza ese día en Argentina. Se calcula el offset del
 * propio día (y se corrige una vez) en vez de escribir "-03:00": hoy no hay
 * horario de verano, pero ya lo hubo, y este cálculo no se rompe si vuelve.
 */
export function inicioDelDiaAR(dia: string): Date {
  const m = dia.match(RE_DIA)
  if (!m) throw new Error(`Día inválido: ${dia}`)
  const medianocheUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const off1 = offsetMinutos(medianocheUtc)
  let t = medianocheUtc - off1 * MS_MIN
  const off2 = offsetMinutos(t)
  if (off2 !== off1) t = medianocheUtc - off2 * MS_MIN
  return new Date(t)
}

/** Suma (o resta) días calendario a un 'YYYY-MM-DD'. */
export function sumarDias(dia: string, n: number): string {
  const m = dia.match(RE_DIA)
  if (!m) throw new Error(`Día inválido: ${dia}`)
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + n * MS_DIA)
  return d.toISOString().slice(0, 10) // acá es seguro: es una fecha de calendario armada en UTC
}

/** Días calendario entre dos 'YYYY-MM-DD' (b − a). */
export function diasEntre(a: string, b: string): number {
  const ma = a.match(RE_DIA)
  const mb = b.match(RE_DIA)
  if (!ma || !mb) throw new Error('Día inválido')
  const ta = Date.UTC(Number(ma[1]), Number(ma[2]) - 1, Number(ma[3]))
  const tb = Date.UTC(Number(mb[1]), Number(mb[2]) - 1, Number(mb[3]))
  return Math.round((tb - ta) / MS_DIA)
}

/** Período de días completos [desde 00:00, hasta+1 00:00), con `hastaDia` INCLUSIVE. */
export function periodoDeDias(desdeDia: string, hastaDia: string): { desde: Date; hasta: Date } {
  return { desde: inicioDelDiaAR(desdeDia), hasta: inicioDelDiaAR(sumarDias(hastaDia, 1)) }
}

/** Los días ('YYYY-MM-DD') que toca un período [desde, hasta). */
export function diasDelPeriodo(desde: Date, hasta: Date): string[] {
  const dias: string[] = []
  if (hasta.getTime() <= desde.getTime()) return dias
  const ultimo = diaAR(hasta.getTime() - 1)
  let d = diaAR(desde)
  for (let i = 0; i < 400 && d <= ultimo; i++) {
    dias.push(d)
    d = sumarDias(d, 1)
  }
  return dias
}

function partesDia(dia: string): { d: number; m: number; semana: number } {
  const m = dia.match(RE_DIA)
  if (!m) throw new Error(`Día inválido: ${dia}`)
  const fecha = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return { d: fecha.getUTCDate(), m: fecha.getUTCMonth() + 1, semana: fecha.getUTCDay() }
}

/** "20/10" */
export function diaMes(dia: string): string {
  const p = partesDia(dia)
  return `${p.d}/${p.m}`
}

/** "lunes 20/10" */
export function fechaLarga(dia: string): string {
  const p = partesDia(dia)
  return `${DIAS_SEMANA[p.semana]} ${p.d}/${p.m}`
}

/** "lun 20/10" */
export function fechaCorta(dia: string): string {
  const p = partesDia(dia)
  return `${DIAS_CORTOS[p.semana]} ${p.d}/${p.m}`
}

/** "$1.384.000" — sin decimales, con $ pegado y punto de miles. */
export function plata(n: number): string {
  const r = Math.round(n)
  return (r < 0 ? '-$' : '$') + fmtPlata.format(Math.abs(r))
}

/** "hace 6 min" · "hace 2 h" · "hace 3 días" · "hace menos de 1 min" */
export function haceCuanto(desde: Instante, ahora: Instante): string {
  const min = Math.floor((aMs(ahora) - aMs(desde)) / MS_MIN)
  if (min < 1) return 'hace menos de 1 min'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 48) return `hace ${h} h`
  return `hace ${Math.floor(h / 24)} días`
}

export interface DescripcionPeriodo {
  /** "Ayer" · "Hoy" · "lunes 20/10" · "Del 14/10 al 20/10" */
  etiqueta: string
  /** Para "No hubo transferencias {frase}": "ayer" · "hoy" · "el lunes 20/10" · "del 14/10 al 20/10" */
  frase: string
  /** Para "Las 76 transferencias {de}": "de ayer" · "de hoy" · "del lunes 20/10" · "del período" */
  de: string
  /** Primer y último día (inclusive) en hora argentina. */
  primerDia: string
  ultimoDia: string
  unDia: boolean
}

/** Cómo se nombra un período [desde, hasta) en los textos. */
export function describirPeriodo(desde: Date, hasta: Date, ahora: Date): DescripcionPeriodo {
  const primerDia = diaAR(desde)
  const ultimoDia = diaAR(Math.max(desde.getTime(), hasta.getTime() - 1))
  const hoy = diaAR(ahora)
  const ayer = sumarDias(hoy, -1)
  if (primerDia === ultimoDia) {
    if (primerDia === hoy) return { etiqueta: 'Hoy', frase: 'hoy', de: 'de hoy', primerDia, ultimoDia, unDia: true }
    if (primerDia === ayer) return { etiqueta: 'Ayer', frase: 'ayer', de: 'de ayer', primerDia, ultimoDia, unDia: true }
    const larga = fechaLarga(primerDia)
    return { etiqueta: larga, frase: `el ${larga}`, de: `del ${larga}`, primerDia, ultimoDia, unDia: true }
  }
  const rango = `del ${diaMes(primerDia)} al ${diaMes(ultimoDia)}`
  return {
    etiqueta: `Del ${diaMes(primerDia)} al ${diaMes(ultimoDia)}`,
    frase: rango,
    de: 'del período',
    primerDia,
    ultimoDia,
    unDia: false,
  }
}

/**
 * Fecha para la API de Mercado Pago: 'yyyy-MM-ddTHH:mm:ss.SSS-03:00'. Es el
 * formato del ejemplo de la documentación ("gestión de pagos recibidos"), con
 * milisegundos y el offset de Argentina explícito.
 */
export function fechaParaMp(x: Instante): string {
  const ms = aMs(x)
  const off = offsetMinutos(ms)
  const local = new Date(ms + off * MS_MIN)
  const signo = off < 0 ? '-' : '+'
  const abs = Math.abs(off)
  const hh = String(Math.floor(abs / 60)).padStart(2, '0')
  const mm = String(abs % 60).padStart(2, '0')
  return local.toISOString().replace('Z', `${signo}${hh}:${mm}`)
}
