/**
 * Formateadores i18n. Aceptan opciones por org (locale/currency/timezone).
 * Defaults: es-AR / ARS / America/Argentina/Buenos_Aires — históricos de Monaco.
 * Para usar con contexto de org, importá los helpers de `src/lib/i18n.ts`.
 */

export interface FormatOptions {
  locale?: string
  currency?: string
  timezone?: string
}

const DEFAULT_LOCALE = 'es-AR'
const DEFAULT_CURRENCY = 'ARS'
const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires'

// Símbolos por moneda (ampliable — LatAm focus)
const CURRENCY_SYMBOL: Record<string, string> = {
  ARS: '$', USD: 'US$', BRL: 'R$', CLP: '$', UYU: '$U', PEN: 'S/',
  COP: '$', MXN: '$', PYG: '₲', BOB: 'Bs', EUR: '€',
}

export function formatCurrency(amount: number, opts?: FormatOptions): string {
  const locale = opts?.locale ?? DEFAULT_LOCALE
  const currency = opts?.currency ?? DEFAULT_CURRENCY
  const symbol = CURRENCY_SYMBOL[currency] ?? currency + ' '
  return symbol + amount.toLocaleString(locale, { maximumFractionDigits: 0 })
}

export function formatDate(dateStr: string, opts?: FormatOptions): string {
  const locale = opts?.locale ?? DEFAULT_LOCALE
  return new Date(dateStr).toLocaleDateString(locale, {
    timeZone: opts?.timezone ?? DEFAULT_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function formatDateTime(dateStr: string, opts?: FormatOptions): string {
  const locale = opts?.locale ?? DEFAULT_LOCALE
  return new Date(dateStr).toLocaleString(locale, {
    timeZone: opts?.timezone ?? DEFAULT_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
