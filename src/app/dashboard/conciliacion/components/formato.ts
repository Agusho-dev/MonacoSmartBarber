// Formatos de la conciliación: plata, horas y fechas en hora argentina.
//
// Lo usan el server component (page.tsx) y el cliente, así que todo tiene que
// dar EXACTAMENTE lo mismo en Node y en el navegador: una diferencia de un
// carácter entre los dos es un error de hidratación. Por eso los nombres de
// días y meses van en tablas propias (el "mar" de un motor puede ser "mar." en
// otro) y las horas se arman con formatToParts, no con el texto de Intl.
//
// Puro: sin imports de runtime, para poder probarlo con node.

export const ZONA_AR = 'America/Argentina/Buenos_Aires'

const NUMERO = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })

const PARTES_AR = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONA_AR,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'] as const
export const DIAS_LARGOS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'] as const
export const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
] as const

/** "$1.384.000". Sin decimales; un negativo lleva el signo menos tipográfico. */
export function plata(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const r = Math.round(n)
  return `${r < 0 ? '−' : ''}$${NUMERO.format(Math.abs(r))}`
}

/** "+$2.000" / "−$2.000" / "$0": para diferencias (Mercado Pago − sistema). */
export function plataConSigno(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const r = Math.round(n)
  if (r === 0) return '$0'
  return `${r > 0 ? '+' : '−'}$${NUMERO.format(Math.abs(r))}`
}

export function numero(n: number): string {
  return Number.isFinite(n) ? NUMERO.format(Math.round(n)) : '—'
}

/** "96 %" (con espacio, como el resto de los textos de la conciliación). */
export function porcentaje(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return `${Math.round(Math.max(0, Math.min(100, n)))} %`
}

/** "1 cobro" / "23 cobros". */
export function plural(n: number, singular: string, pluralTexto?: string): string {
  return `${numero(n)} ${n === 1 ? singular : (pluralTexto ?? `${singular}s`)}`
}

interface PartesAR {
  y: number
  m: number
  d: number
  hh: string
  mm: string
}

/** Fecha y hora de un instante ISO en hora argentina. null si el ISO no sirve. */
export function partesAR(iso: string | null | undefined): PartesAR | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const p: Record<string, string> = {}
  for (const parte of PARTES_AR.formatToParts(new Date(t))) p[parte.type] = parte.value
  // Algunos motores devuelven "24" para la medianoche aun con h23.
  const hh = p.hour === '24' ? '00' : p.hour
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), hh, mm: p.minute }
}

/** "18:42" en hora argentina. */
export function horaAR(iso: string | null | undefined): string {
  const p = partesAR(iso)
  return p ? `${p.hh}:${p.mm}` : '—'
}

/** "2026-10-20": el día (argentino) de un instante. */
export function ymdAR(iso: string | null | undefined): string | null {
  const p = partesAR(iso)
  if (!p) return null
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`
}

/** "20/10 18:42" */
export function fechaHoraAR(iso: string | null | undefined): string {
  const p = partesAR(iso)
  if (!p) return '—'
  return `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')} ${p.hh}:${p.mm}`
}

/** "20/10/2026" (para el CSV). */
export function fechaCompletaAR(iso: string | null | undefined): string {
  const p = partesAR(iso)
  if (!p) return ''
  return `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${p.y}`
}

/** Día de la semana (0 = domingo) de un "YYYY-MM-DD", sin depender de la zona del equipo. */
export function diaDeSemana(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** "20/10" */
export function diaMes(ymd: string): string {
  const [, m, d] = ymd.split('-')
  return `${Number(d)}/${Number(m)}`
}

/** "mar 20/10" */
export function diaCorto(ymd: string): string {
  return `${DIAS_CORTOS[diaDeSemana(ymd)]} ${diaMes(ymd)}`
}

/** "martes 20/10" */
export function diaLargo(ymd: string): string {
  return `${DIAS_LARGOS[diaDeSemana(ymd)]} ${diaMes(ymd)}`
}

/** "jueves 24/10 a las 15:40": cuándo vence un link. */
export function vencimientoAR(iso: string | null | undefined): string {
  const ymd = ymdAR(iso)
  if (!ymd) return ''
  return `${diaLargo(ymd)} a las ${horaAR(iso)}`
}

/** "sáb 24/10 15:40": lo mismo, corto, para una tarjeta. */
export function vencimientoCortoAR(iso: string | null | undefined): string {
  const ymd = ymdAR(iso)
  if (!ymd) return ''
  return `${diaCorto(ymd)} ${horaAR(iso)}`
}

/**
 * "hace 6 min", "hace 2 h", "recién": la frescura y las tarjetas contadas con el
 * reloj de la pantalla. Redondea para abajo, como el servidor (fechas.ts): al
 * hidratar no salta de "hace 6 min" a "hace 7 min".
 */
export function haceCuanto(iso: string | null | undefined, ahoraMs: number): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const min = Math.max(0, Math.floor((ahoraMs - t) / 60_000))
  if (min < 1) return 'recién'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 48) return `hace ${h} h`
  return `hace ${Math.floor(h / 24)} días`
}

/**
 * "1 min antes" / "3 min después" / "en el mismo minuto": cuánto antes entró la
 * plata en Mercado Pago respecto del cobro. `retrasoSeg` = t_sistema − t_mp
 * (positivo: Mercado Pago antes, que es lo normal: acredita ~1 min antes de que
 * se registre el cobro).
 */
export function textoRetraso(retrasoSeg: number | null | undefined): string | null {
  if (retrasoSeg == null || !Number.isFinite(retrasoSeg)) return null
  const min = Math.round(Math.abs(retrasoSeg) / 60)
  if (min === 0) return 'En el mismo minuto'
  return `${min} min ${retrasoSeg > 0 ? 'antes' : 'después'}`
}
