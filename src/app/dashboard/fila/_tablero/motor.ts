/**
 * Qué haría `claim_next_for_barber` (mig 170) con una silla libre, leído en el
 * browser para que el tablero no sugiera lo que el motor no haría. Módulo plano:
 * no muta nada; el corte lo arranca `startService` con la entrada exacta que se
 * muestra.
 *
 * El orden es el del RPC, y no hay que "simplificarlo":
 *  1. un descanso pendiente sin clientes PROPIOS que hayan llegado antes va
 *     primero (propios = `barber_id` de él, también los dinámicos con su pista,
 *     igual que el `NOT EXISTS` del RPC);
 *  2. [A] un turno suyo cuya HORA REAL ya llegó tiene precedencia absoluta;
 *  3. [B] si su próximo turno cae dentro de la ventana de protección (o sólo
 *     atiende turnos), los walk-ins no entran: se atiende al del turno inminente
 *     si ya está, y si no, la silla espera;
 *  4. si no, FIFO de walk-ins: los suyos y los de Menor espera, por llegada.
 *
 * La hora de un turno sale de la AGENDA (`appointments`), nunca de
 * `priority_order`: en una entrada adoptada de un walk-in ése es la hora de
 * llegada, y decidir con él adelantaba a un cliente de las 15:00 que llegó a las
 * 13:00 por encima de los que llegaron antes (la inversión que corrigió la 170).
 */

import type { NextAppointmentInfo } from '@/lib/queue-appointments'
import type { QueueEntry } from '@/lib/types/database'
import { esDelPool, porOrdenDeLlegada } from './derivados'

export type DecisionSilla =
  /** Le toca el descanso: lo arranca su tablet (el dashboard no arranca descansos). */
  | { tipo: 'descanso'; descanso: QueueEntry }
  /** El cliente del turno ya está y le toca. `aTiempo` = su hora ya llegó ([A]). */
  | { tipo: 'turno'; entry: QueueEntry; aTiempo: boolean }
  /** La ventana de protección frena los walk-ins y el del turno todavía no llegó. */
  | { tipo: 'protegida'; turno: NextAppointmentInfo | null }
  /** Walk-ins por llegada; `tope` = el descanso pendiente (nadie después de él). */
  | { tipo: 'fifo'; tope: number | null }

const prioridad = (e: QueueEntry) => new Date(e.priority_order).getTime()

export function decidirSilla({
  barberoId,
  fila,
  ahora,
  ventanaMinutos,
  soloTurnos,
  proximoTurno,
  inicioDeTurno,
}: {
  barberoId: string
  /** Toda la fila que espera en la sucursal de la silla. */
  fila: QueueEntry[]
  ahora: number
  ventanaMinutos: number
  /** `appointment_staff.walkin_mode = 'appointments_only'`. */
  soloTurnos: boolean
  proximoTurno: NextAppointmentInfo | null | undefined
  /** Hora reservada (ms) de una entrada de turno. */
  inicioDeTurno: (e: QueueEntry) => number
}): DecisionSilla {
  const propias = fila.filter((e) => e.barber_id === barberoId)

  const descanso = propias.filter((e) => e.is_break).sort(porOrdenDeLlegada)[0]
  const tope = descanso ? prioridad(descanso) : null
  if (descanso && !propias.some((e) => !e.is_break && prioridad(e) < prioridad(descanso))) {
    return { tipo: 'descanso', descanso }
  }

  const turnos = propias
    .filter((e) => e.is_appointment && !e.is_break && (tope === null || prioridad(e) < tope))
    .sort((a, b) => inicioDeTurno(a) - inicioDeTurno(b))

  const vencido = turnos.find((e) => inicioDeTurno(e) <= ahora)
  if (vencido) return { tipo: 'turno', entry: vencido, aTiempo: true }

  const ventanaMs = ventanaMinutos * 60_000
  const protege = soloTurnos || (!!proximoTurno && proximoTurno.startsAtMs <= ahora + ventanaMs)
  if (protege) {
    const presente = turnos.find((e) => inicioDeTurno(e) <= ahora + ventanaMs)
    if (presente) return { tipo: 'turno', entry: presente, aTiempo: false }
    return { tipo: 'protegida', turno: proximoTurno ?? null }
  }

  return { tipo: 'fifo', tope }
}

/**
 * ¿Lo puede tomar esta silla por el camino FIFO del RPC? Walk-in (ni turno ni
 * descanso), de hoy, suyo o de Menor espera, y anterior al descanso pendiente.
 */
export function candidatoFifo(
  e: QueueEntry,
  barberoId: string,
  tope: number | null,
  esDeHoy: (iso: string) => boolean,
): boolean {
  if (e.is_break || e.is_appointment) return false
  if (!(esDelPool(e) || e.barber_id === barberoId)) return false
  if (!esDeHoy(e.checked_in_at)) return false
  return tope === null || prioridad(e) < tope
}
