// Helpers compartidos por las pestañas de /dashboard/fidelizacion: etiquetas
// humanas, formateadores y las paletas de presets de las categorías.

import type { LoyaltyEvent, LoyaltyNotificationKind, LoyaltyPointTxType, LoyaltyRewardKind, LoyaltyTierCode, ReferralStatus } from '@/lib/types/loyalty'

export const TABS = ['resumen', 'categorias', 'puntos', 'premios', 'referidos', 'notificaciones', 'clientes'] as const
export type Tab = (typeof TABS)[number]

export function numero(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString('es-AR')
}

export function pesos(n: number): string {
  return '$' + Math.round(n).toLocaleString('es-AR')
}

export function fmtFecha(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('es-AR', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d)
}

export function fmtFechaCorta(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('es-AR', { timeZone, day: '2-digit', month: '2-digit' }).format(d)
}

export function fmtFechaHora(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('es-AR', {
    timeZone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(d).replace(',', '')
}

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
  if (d < 60) return `hace ${d} d`
  return fmtFecha(iso)
}

/** Días enteros que faltan hasta `iso` (negativo si ya pasó). */
export function diasHasta(iso: string | null | undefined): number | null {
  if (!iso) return null
  const ms = new Date(iso).getTime() - Date.now()
  if (Number.isNaN(ms)) return null
  return Math.ceil(ms / 86400000)
}

export function anioDe(iso: string | null | undefined): string {
  if (!iso) return String(new Date().getFullYear())
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? String(new Date().getFullYear()) : String(d.getFullYear())
}

/** Suma días a hoy y devuelve la fecha corta (para las calculadoras). */
export function fechaEnDias(dias: number): string {
  const d = new Date()
  d.setDate(d.getDate() + dias)
  return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d)
}

// ── Premios ──────────────────────────────────────────────────────────────────

export const REWARD_KIND_LABEL: Record<LoyaltyRewardKind, string> = {
  descuento: 'Descuento',
  merch: 'Merchandising',
  especial: 'Especial',
}

// ── Movimientos de puntos ────────────────────────────────────────────────────

export const TX_TYPE_LABEL: Record<LoyaltyPointTxType, string> = {
  earned: 'Visita',
  welcome_bonus: 'Bono de bienvenida',
  referral_referrer: 'Recomendó a un amigo',
  referral_referred: 'Vino recomendado',
  manual_adjust: 'Ajuste manual',
  redeemed: 'Canje',
  expired: 'Vencidos',
  reversal: 'Reversión',
}

export const REFERRAL_STATUS_LABEL: Record<ReferralStatus, string> = {
  pending: 'Pendiente',
  completed: 'Completado',
  rejected: 'Rechazado',
  cancelled: 'Cancelado',
}

export const REFERRAL_STATUS_CLASS: Record<ReferralStatus, string> = {
  pending: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  completed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  rejected: 'border-destructive/30 bg-destructive/10 text-destructive',
  cancelled: 'border-border bg-muted text-muted-foreground line-through',
}

// ── Notificaciones ───────────────────────────────────────────────────────────

export const VARIABLES = [
  'nombre', 'categoria', 'categoria_siguiente', 'multiplicador', 'puntos', 'saldo', 'dias', 'fecha', 'premio', 'faltan', 'visitas', 'nombre_amigo',
] as const

export const VARIABLES_EJEMPLO: Record<(typeof VARIABLES)[number], string> = {
  nombre: 'Nico',
  categoria: 'Oro',
  categoria_siguiente: 'Platinum',
  multiplicador: '110',
  puntos: '110',
  saldo: '650',
  dias: '5',
  fecha: '28/12',
  premio: '30 % OFF en tu corte',
  faltan: '100',
  visitas: '7',
  nombre_amigo: 'Juan',
}

export type Variable = (typeof VARIABLES)[number]

export function renderPlantilla(tpl: string, vars: Record<string, string> = VARIABLES_EJEMPLO): string {
  return tpl.replace(/\{\{([a-z_]+)\}\}/g, (_, k: string) => vars[k] ?? '')
}

/**
 * Qué variables recibe cada regla. Es EXACTAMENTE el jsonb que le pasa la SQL
 * a `loyalty_notify` en cada punto de emisión (mig 197) más `nombre`, que va
 * siempre. `loyalty_render` reemplaza sólo esas claves y borra el resto
 * (`regexp_replace(... '\{\{[a-z_]+\}\}', '')`): una variable ajena a la regla
 * llega vacía al teléfono, así que la vista previa tiene que hacer lo mismo.
 */
interface RuleMeta {
  label: string
  descripcion: string
  grupo: 'categoria' | 'puntos' | 'referidos'
  usaDias?: boolean
  variables: readonly Variable[]
}

export const RULE_META: Record<LoyaltyNotificationKind, RuleMeta> = {
  tier_up: { label: 'Subió de categoría', descripcion: 'Cuando el cliente llega a una categoría superior.', grupo: 'categoria', variables: ['nombre', 'categoria', 'multiplicador', 'visitas'] },
  near_tier: { label: 'A una visita de subir', descripcion: 'Cuando le falta exactamente una visita para la siguiente categoría.', grupo: 'categoria', variables: ['nombre', 'categoria_siguiente', 'visitas'] },
  tier_grace_warning: { label: 'Nivel por vencer', descripcion: 'Cuando deja de cumplir su categoría y empieza el período de gracia.', grupo: 'categoria', variables: ['nombre', 'categoria', 'dias', 'fecha'] },
  tier_grace_reminder: { label: 'Recordatorio de gracia', descripcion: 'Unos días antes de que termine la gracia.', grupo: 'categoria', usaDias: true, variables: ['nombre', 'categoria', 'dias'] },
  tier_down: { label: 'Bajó de categoría', descripcion: 'Cuando termina la gracia sin recuperar la frecuencia.', grupo: 'categoria', variables: ['nombre', 'categoria', 'visitas'] },
  points_earned: { label: 'Sumó puntos', descripcion: 'Después de cada visita cobrada. Apagada por default: en cada corte sería spam.', grupo: 'puntos', variables: ['nombre', 'puntos', 'saldo', 'categoria'] },
  points_expiring: { label: 'Puntos por vencer', descripcion: 'Cuando un lote está a pocos días de vencer.', grupo: 'puntos', usaDias: true, variables: ['nombre', 'puntos', 'dias', 'fecha'] },
  reward_unlocked: { label: 'Premio desbloqueado', descripcion: 'Cuando el saldo alcanza para un premio que antes no podía.', grupo: 'puntos', variables: ['nombre', 'premio', 'saldo'] },
  near_reward: { label: 'Cerca de un premio', descripcion: 'Cuando le falta menos del 25 % para el próximo premio.', grupo: 'puntos', variables: ['nombre', 'premio', 'faltan', 'saldo'] },
  benefit_new: { label: 'Beneficio nuevo', descripcion: 'Cuando canjea un premio y queda en Mis premios.', grupo: 'puntos', variables: ['nombre', 'premio', 'fecha'] },
  referral_completed_referrer: { label: 'Recomendación completada', descripcion: 'Al recomendador, cuando su amigo terminó la primera visita.', grupo: 'referidos', variables: ['nombre', 'nombre_amigo', 'puntos'] },
  referral_completed_referred: { label: 'Bienvenida al referido', descripcion: 'Al cliente nuevo, cuando se acreditan sus primeros puntos.', grupo: 'referidos', variables: ['nombre', 'puntos'] },
}

/** Valores de ejemplo SÓLO de las variables que esa regla recibe: el resto se ve vacío, igual que en el envío. */
export function ejemploPara(kind: LoyaltyNotificationKind): Record<string, string> {
  return Object.fromEntries(RULE_META[kind].variables.map(v => [v, VARIABLES_EJEMPLO[v]]))
}

// ── Mantenimiento diario ─────────────────────────────────────────────────────

/** Hora UTC del cron `loyalty-daily-maintenance` ('0 6 * * *', mig 197). */
export const MANTENIMIENTO_HORA_UTC = 6

/** La hora del cron expresada en la zona de la org ("03:00" en Buenos Aires). */
export function horaMantenimientoLocal(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('es-AR', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .format(new Date(Date.UTC(2026, 0, 1, MANTENIMIENTO_HORA_UTC, 0)))
  } catch {
    return `${String(MANTENIMIENTO_HORA_UTC).padStart(2, '0')}:00 UTC`
  }
}

// ── Eventos (timeline) ───────────────────────────────────────────────────────

export interface EventoHumano {
  titulo: string
  detalle: string | null
  tono: 'neutral' | 'ok' | 'warn' | 'bad' | 'info'
}

function s(v: unknown): string {
  return v == null ? '' : String(v)
}

export function describirEvento(e: LoyaltyEvent, tiers?: Record<string, string>): EventoHumano {
  const d = e.data ?? {}
  const nombreTier = (code: unknown) => tiers?.[s(code)] ?? s(code)
  const quien = e.client_name ?? 'Un cliente'
  switch (e.kind) {
    case 'enrolled': return { titulo: `${quien} entró al programa como ${nombreTier(d.tier)}`, detalle: `${s(d.visits)} visitas en la ventana`, tono: 'info' }
    case 'tier_up': return { titulo: `${quien} subió a ${nombreTier(d.to)}`, detalle: `Venía de ${nombreTier(d.from)} · ${s(d.visits)} visitas recientes`, tono: 'ok' }
    case 'tier_down': return { titulo: `${quien} bajó a ${nombreTier(d.to)}`, detalle: `Era ${nombreTier(d.from)} · ${s(d.visits)} visitas recientes`, tono: 'warn' }
    case 'grace_started': return { titulo: `${quien} entró en gracia`, detalle: `Tiene hasta el ${fmtFecha(s(d.until))} para mantener ${nombreTier(d.tier)}`, tono: 'warn' }
    case 'grace_recovered': return { titulo: `${quien} recuperó su categoría`, detalle: `Sigue siendo ${nombreTier(d.tier)}`, tono: 'ok' }
    case 'points_earned': return { titulo: `${quien} sumó ${numero(Number(d.points))} pts`, detalle: `Saldo: ${numero(Number(d.balance))} pts`, tono: 'ok' }
    case 'points_expired': return { titulo: `A ${quien} se le vencieron ${numero(Number(d.points))} pts`, detalle: null, tono: 'neutral' }
    case 'welcome_bonus': return { titulo: `${quien} recibió el bono de bienvenida`, detalle: `${numero(Number(d.points))} pts`, tono: 'ok' }
    case 'reward_redeemed': return { titulo: `${quien} canjeó ${s(d.reward_name)}`, detalle: `${numero(Number(d.points))} pts · desde ${s(d.channel) === 'dashboard' ? 'el dashboard' : 'la app'}`, tono: 'ok' }
    case 'reward_used': return { titulo: `${quien} usó ${s(d.reward_name)}`, detalle: null, tono: 'ok' }
    case 'reward_cancelled': return { titulo: `Se canceló un beneficio de ${quien}`, detalle: `${s(d.reason)}${Number(d.points_restored) > 0 ? ` · ${numero(Number(d.points_restored))} pts devueltos` : ''}`, tono: 'warn' }
    case 'referral_created': return { titulo: `${quien} trajo a un amigo`, detalle: null, tono: 'info' }
    case 'referral_completed': return { titulo: `Referido completado (${quien})`, detalle: `${numero(Number(d.points))} pts acreditados`, tono: 'ok' }
    case 'referral_rejected': return { titulo: `Referido rechazado (${quien})`, detalle: s(d.reason) || null, tono: 'bad' }
    case 'referral_cancelled': return { titulo: `Referido cancelado (${quien})`, detalle: s(d.reason) || null, tono: 'warn' }
    case 'reversal': return { titulo: `Se revirtieron ${numero(Number(d.points_reverted))} pts de ${quien}`, detalle: `${s(d.reason)}${Number(d.points_already_spent) > 0 ? ` · ya había gastado ${numero(Number(d.points_already_spent))}` : ''}`, tono: 'warn' }
    case 'manual_adjust': return { titulo: `Ajuste manual a ${quien}: ${Number(d.points) > 0 ? '+' : ''}${numero(Number(d.points))} pts`, detalle: s(d.reason) || null, tono: 'info' }
    case 'backfill': return { titulo: `Se asignó categoría inicial a ${numero(Number(d.enrolled))} clientes`, detalle: `Ventana de ${s(d.window_weeks)} semanas`, tono: 'info' }
    case 'program_enabled': return { titulo: 'Programa activado', detalle: `${numero(Number(d.enrolled))} clientes enrolados`, tono: 'ok' }
    case 'program_disabled': return { titulo: 'Programa apagado', detalle: null, tono: 'neutral' }
    case 'notification_sent': return { titulo: `Notificación enviada a ${quien}`, detalle: s(d.title) || null, tono: 'neutral' }
    case 'error': return { titulo: `Error del programa${e.client_name ? ` con ${e.client_name}` : ''}`, detalle: `${s(d.what)}: ${s(d.message)}`, tono: 'bad' }
    default: return { titulo: `${e.kind} (${quien})`, detalle: null, tono: 'neutral' }
  }
}

// ── Presets de color por categoría ───────────────────────────────────────────

export interface Paleta { nombre: string; primary: string; secondary: string; text: string }

export const PRESETS: Record<LoyaltyTierCode, Paleta[]> = {
  bronce: [
    { nombre: 'Cobre', primary: '#7A4A22', secondary: '#C78A4E', text: '#FFFFFF' },
    { nombre: 'Terracota', primary: '#5C2E1A', secondary: '#B5673E', text: '#FFFFFF' },
    { nombre: 'Café', primary: '#3E2A1E', secondary: '#8C6248', text: '#FFFFFF' },
    { nombre: 'Ámbar', primary: '#8A4B12', secondary: '#E0A050', text: '#FFFFFF' },
  ],
  plata: [
    { nombre: 'Acero', primary: '#3E444D', secondary: '#A9B1BA', text: '#FFFFFF' },
    { nombre: 'Titanio', primary: '#2A2E35', secondary: '#9AA3AE', text: '#FFFFFF' },
    { nombre: 'Perla', primary: '#6B7280', secondary: '#B8BDC6', text: '#FFFFFF' },
    { nombre: 'Azul frío', primary: '#334155', secondary: '#94A3B8', text: '#FFFFFF' },
  ],
  oro: [
    { nombre: 'Oro', primary: '#7A5A12', secondary: '#D8AE3C', text: '#FFFFFF' },
    { nombre: 'Champán', primary: '#8C6B2E', secondary: '#C9A96A', text: '#FFFFFF' },
    { nombre: 'Oro viejo', primary: '#5C4310', secondary: '#C9A24A', text: '#FFFFFF' },
    { nombre: 'Miel', primary: '#9A6B00', secondary: '#E0B33B', text: '#FFFFFF' },
  ],
  platinum: [
    { nombre: 'Obsidiana', primary: '#0B0B0D', secondary: '#3A3A44', text: '#FFFFFF' },
    { nombre: 'Grafito', primary: '#141416', secondary: '#4B4B55', text: '#FFFFFF' },
    { nombre: 'Medianoche', primary: '#0A0F1F', secondary: '#2C3A5C', text: '#FFFFFF' },
    { nombre: 'Carbón violeta', primary: '#120A1E', secondary: '#3D2A5C', text: '#FFFFFF' },
  ],
}
