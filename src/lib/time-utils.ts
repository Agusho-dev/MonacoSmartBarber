/**
 * Helpers de tiempo por timezone. Los defaults son Argentina pero la idea es
 * pasar explícitamente el TZ de la branch/org desde el caller. Para servidor con
 * contexto de org usá `getOrgLocaleContext()` en `src/lib/i18n.ts`.
 */

const DEFAULT_TZ = 'America/Argentina/Buenos_Aires'

/**
 * Calcula el offset ISO (ej. "-03:00", "+00:00") de un timezone en un momento dado.
 * Crítico para generar ranges correctos en queries Supabase timestamptz en TZ distintos de AR.
 */
export function getTzOffsetISO(date: Date, timeZone: string): string {
  // Intl.DateTimeFormat con timeZoneName: 'longOffset' devuelve "GMT-03:00"
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
  const part = fmt.formatToParts(date).find(p => p.type === 'timeZoneName')
  if (!part) return '+00:00'
  // "GMT-03:00" -> "-03:00", "GMT" -> "+00:00"
  const m = part.value.match(/([+-]\d{2}:?\d{2})/)
  if (!m) return '+00:00'
  let off = m[1]
  if (!off.includes(':')) off = off.slice(0, 3) + ':' + off.slice(3)
  return off
}

export function getLocalNow(timeZone = DEFAULT_TZ): Date {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)

  const p: Record<string, string> = {}
  for (const part of parts) p[part.type] = part.value
  return new Date(Date.UTC(
    parseInt(p.year),
    parseInt(p.month) - 1,
    parseInt(p.day),
    parseInt(p.hour),
    parseInt(p.minute),
    parseInt(p.second),
  ))
}

/** YYYY-MM-DD en la timezone dada. */
export function getLocalDateStr(timeZone = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date())
}

/** Rango ISO del día local en la TZ dada. Usa offset dinámico (no hardcoded). */
export function getLocalDayBounds(timeZone = DEFAULT_TZ): { start: string; end: string } {
  const now = new Date()
  const localDateStr = getLocalDateStr(timeZone)
  const offset = getTzOffsetISO(now, timeZone)
  return {
    start: `${localDateStr}T00:00:00${offset}`,
    end:   `${localDateStr}T23:59:59.999${offset}`,
  }
}

/** Rango ISO de N meses atrás hasta hoy, en la TZ dada. */
export function getMonthBoundsStr(
  monthsBack: number,
  timeZone = DEFAULT_TZ,
  referenceDate?: Date,
): { start: string; end: string } {
  const localNow = referenceDate ?? getLocalNow(timeZone)
  const y = localNow.getUTCFullYear()
  const m = localNow.getUTCMonth()

  const startDate = new Date(Date.UTC(y, m - monthsBack + 1, 1))
  const endDate   = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999))

  const sYear  = startDate.getUTCFullYear()
  const sMonth = String(startDate.getUTCMonth() + 1).padStart(2, '0')
  const sDay   = String(startDate.getUTCDate()).padStart(2, '0')
  const eYear  = endDate.getUTCFullYear()
  const eMonth = String(endDate.getUTCMonth() + 1).padStart(2, '0')
  const eDay   = String(endDate.getUTCDate()).padStart(2, '0')

  const offset = getTzOffsetISO(new Date(), timeZone)
  return {
    start: `${sYear}-${sMonth}-${sDay}T00:00:00${offset}`,
    end:   `${eYear}-${eMonth}-${eDay}T23:59:59.999${offset}`,
  }
}

/** Rango ISO de un día específico YYYY-MM-DD en la TZ dada. */
export function getDayBounds(dateStr: string, timeZone = DEFAULT_TZ): { start: string; end: string } {
  const offset = getTzOffsetISO(new Date(), timeZone)
  return {
    start: `${dateStr}T00:00:00${offset}`,
    end:   `${dateStr}T23:59:59.999${offset}`,
  }
}
