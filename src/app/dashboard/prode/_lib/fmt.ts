import { format } from 'date-fns'
import { es } from 'date-fns/locale'

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------

export function fmtKickoff(iso: string): string {
  return format(new Date(iso), "EEE d MMM, HH:mm", { locale: es })
}

export function fmtDateShort(iso: string): string {
  return format(new Date(iso), "d 'de' MMM", { locale: es })
}

export function fmtDayMonth(iso: string): string {
  return format(new Date(iso), 'd MMM', { locale: es })
}

export function fmtTime(iso: string): string {
  return format(new Date(iso), 'HH:mm', { locale: es })
}

/** Clave de día calendario (ARG) para agrupar/filtrar partidos. */
export function dayKey(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

export function fmtDayLabel(iso: string): string {
  // iso puede ser una fecha YYYY-MM-DD; normalizamos a mediodía para evitar
  // corrimientos de huso.
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00`) : new Date(iso)
  return format(d, "EEEE d 'de' MMMM", { locale: es })
}

/** "hace 5 min" / "hace 2 h" / "hace 3 días" — para el chip de última sync. */
export function fmtRelative(iso: string | null): string {
  if (!iso) return 'nunca'
  const diffMs = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diffMs / 60000)
  if (min < 1) return 'recién'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24)
  return `hace ${d} día${d === 1 ? '' : 's'}`
}

// ---------------------------------------------------------------------------
// Etiquetas de dominio
// ---------------------------------------------------------------------------

export const MATCH_STATUS_LABELS: Record<string, string> = {
  scheduled: 'Programado',
  live: 'En vivo',
  finished: 'Finalizado',
  cancelled: 'Cancelado',
}

export const STAGE_LABELS: Record<string, string> = {
  group: 'Fase de grupos',
  round_of_32: '16avos de final',
  round_of_16: 'Octavos de final',
  quarter_final: 'Cuartos de final',
  semi_final: 'Semifinal',
  third_place: 'Tercer puesto',
  final: 'Final',
}

export const STAGE_SHORT: Record<string, string> = {
  group: 'Grupos',
  round_of_32: '16avos',
  round_of_16: 'Octavos',
  quarter_final: 'Cuartos',
  semi_final: 'Semis',
  third_place: '3er puesto',
  final: 'Final',
}

export const TOURNAMENT_STATUS_LABELS: Record<string, string> = {
  upcoming: 'Próximamente',
  active: 'Activo',
  finished: 'Finalizado',
}

export const QUESTION_KIND_LABELS: Record<string, string> = {
  champion: 'Campeón',
  runner_up: 'Subcampeón',
  top_scorer: 'Goleador',
  surprise_team: 'Revelación',
  team_stage: 'Hasta dónde llega',
  bonus: 'Bonus',
}

export const ANSWER_TYPE_LABELS: Record<string, string> = {
  team: 'Selección',
  choice: 'Opción múltiple',
  number: 'Número',
  text: 'Texto libre',
}

/** Normaliza el jsonb `options` de una pregunta a string[]. */
export function parseOptions(options: unknown): string[] {
  if (Array.isArray(options)) {
    return options.map((o) =>
      typeof o === 'string'
        ? o
        : String(
            (o as { value?: unknown; label?: unknown })?.value ??
              (o as { label?: unknown })?.label ??
              o
          )
    )
  }
  return []
}
