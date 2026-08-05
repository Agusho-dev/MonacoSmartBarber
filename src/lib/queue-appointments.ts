/**
 * Lectura de TURNOS dentro de la fila. Sólo presentación: nada de acá muta la
 * cola ni decide a quién se atiende — eso vive en `claim_next_for_barber`.
 *
 * Está fuera de `src/lib/actions/` a propósito: lo consumen componentes de
 * cliente del dashboard, del panel del barbero y de la TV, y un archivo
 * `'use server'` sólo puede exportar funciones async.
 */

import { getTzOffsetISO } from '@/lib/time-utils'
import type { Appointment } from '@/lib/types/database'

/** Constante `v_avg_service_minutes` de `claim_next_for_barber` (mig 168). */
export const AVG_SERVICE_MINUTES = 45

/** Default de `appointment_settings.buffer_minutes` cuando la sucursal no lo configuró. */
export const DEFAULT_BUFFER_MINUTES = 10

/**
 * Ventana de protección: cuánto antes de un turno el motor de la fila deja de
 * entregarle walk-ins al barbero (45 + buffer = 55 min con los defaults).
 *
 * Se calcula con los MISMOS números que la DB para que el cartel del panel no
 * prometa un corte que `claim_next_for_barber` no va a entregar.
 */
export function protectionWindowMinutes(bufferMinutes?: number | null): number {
  return AVG_SERVICE_MINUTES + (bufferMinutes ?? DEFAULT_BUFFER_MINUTES)
}

/** HH:MM en la timezone de la sucursal (o la del dispositivo si no se pasa). */
export function formatHourMinute(
  instant: string | number | Date,
  timeZone?: string | null
): string {
  const d = instant instanceof Date ? instant : new Date(instant)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...(timeZone ? { timeZone } : {}),
  }).format(d)
}

/**
 * Hora RESERVADA de una entrada de fila que entró por un turno.
 *
 * `check_in_appointment` (mig 168) escribe `priority_order = HORA DEL TURNO`,
 * no la hora de llegada: es la clave de toda la convivencia (el turno tiene
 * precedencia absoluta desde que su hora llegó). Por eso es el dato que se
 * muestra en la tarjeta, y no `checked_in_at`.
 */
export function appointmentTimeLabel(
  entry: { priority_order: string },
  timeZone?: string | null
): string {
  return formatHourMinute(entry.priority_order, timeZone)
}

/**
 * Instante real de un turno a partir de `appointment_date` + `start_time`, que
 * son hora de PARED de la sucursal.
 *
 * `new Date('YYYY-MM-DDTHH:MM')` los interpretaría en la TZ del proceso (UTC en
 * Vercel) y correría el turno tres horas. Tolera 'HH:MM' y 'HH:MM:SS'.
 */
export function appointmentInstantMs(
  date: string,
  startTime: string,
  timeZone?: string | null
): number {
  const tz = timeZone || 'America/Argentina/Buenos_Aires'
  const hhmmss = startTime.length === 5 ? `${startTime}:00` : startTime.substring(0, 8)
  const offset = getTzOffsetISO(new Date(`${date}T12:00:00Z`), tz)
  return new Date(`${date}T${hhmmss}${offset}`).getTime()
}

export interface NextAppointmentInfo {
  appointment: Appointment
  startsAtMs: number
  /** Minutos que faltan para el turno (redondeado hacia arriba). */
  minutesUntil: number
  /** HH:MM en hora de la sucursal. */
  timeLabel: string
}

/**
 * Próximo turno de la lista que todavía no arrancó.
 *
 * Usa el MISMO criterio que la ventana de protección de `claim_next_for_barber`
 * (status `confirmed`/`checked_in` y hora futura). Si mirásemos otros estados
 * el cartel anunciaría turnos que el motor de la fila ignora.
 */
export function findNextAppointment(
  appointments: Appointment[],
  nowMs: number,
  timeZone?: string | null
): NextAppointmentInfo | null {
  let best: NextAppointmentInfo | null = null

  for (const appointment of appointments) {
    if (appointment.status !== 'confirmed' && appointment.status !== 'checked_in') continue
    const startsAtMs = appointmentInstantMs(
      appointment.appointment_date,
      appointment.start_time,
      timeZone
    )
    if (Number.isNaN(startsAtMs) || startsAtMs <= nowMs) continue
    if (best && startsAtMs >= best.startsAtMs) continue

    best = {
      appointment,
      startsAtMs,
      minutesUntil: Math.ceil((startsAtMs - nowMs) / 60_000),
      timeLabel: formatHourMinute(startsAtMs, timeZone),
    }
  }

  return best
}
