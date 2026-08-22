import type { PushCampaignStatus } from '@/lib/push/constants'

/** Fecha y hora cortas en la zona horaria de la org (ej. "21/08 15:00"). */
export function fmtFechaHora(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('es-AR', {
    timeZone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(d).replace(',', '')
}

/** Fecha larga ("jueves 21 de agosto, 15:00") para confirmaciones. */
export function fmtFechaLarga(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('es-AR', {
    timeZone, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(d)
}

/** "hace 3 min", "hace 2 h", "hace 5 d". */
export function fmtRelativo(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms)) return '—'
  const min = Math.round(ms / 60000)
  if (min < 1) return 'recién'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 48) return `hace ${h} h`
  const d = Math.round(h / 24)
  return `hace ${d} d`
}

/** YYYY-MM-DD de HOY en la zona horaria dada (para el `min` del date input). */
export function hoyEn(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date())
}

/** Clases del badge de estado de una campaña. */
export const STATUS_BADGE: Record<PushCampaignStatus, string> = {
  draft: 'border-border bg-muted text-muted-foreground',
  scheduled: 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400',
  sending: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  sent: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  cancelled: 'border-border bg-muted text-muted-foreground line-through',
  failed: 'border-destructive/30 bg-destructive/10 text-destructive',
}

export function plural(n: number, singular: string, pluralForm: string): string {
  return `${n.toLocaleString('es-AR')} ${n === 1 ? singular : pluralForm}`
}
