'use client'

import { useMemo } from 'react'
import { CalendarClock, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { findNextAppointment, protectionWindowMinutes } from '@/lib/queue-appointments'
import type { Appointment } from '@/lib/types/database'

interface NextAppointmentNoticeProps {
  /** Turnos del día de ESTE barbero (los del server + los refrescos posteriores). */
  appointments: Appointment[]
  /** Reloj del panel (ya late cada 5s ahí; no abrimos otro timer). */
  nowMs: number
  timeZone?: string | null
  /** `appointment_settings.buffer_minutes` de la sucursal. */
  bufferMinutes?: number | null
  /** El barbero no tiene corte ni descanso en curso. */
  isIdle: boolean
  /** Ya hay una entrada de turno esperando en su fila (el cliente llegó). */
  appointmentWaitingInQueue: boolean
  /** Walk-ins esperando en su fila: sirve para explicar a quiénes frena la ventana. */
  waitingWalkIns: number
  /**
   * Mostrar SÓLO la variante que explica por qué la fila no entrega walk-ins.
   *
   * En modo hybrid la tira de turnos ya anuncia el próximo con su cuenta
   * regresiva: repetirlo acá era una segunda banda diciendo lo mismo. Lo que la
   * tira NO puede decir es que el motor dejó de entregar cortes, y eso sí vale
   * una banda propia.
   */
  onlyWhenBlocking?: boolean
  className?: string
}

/**
 * Hace visible el turno que se viene ANTES de que el barbero se pregunte por qué
 * la fila no le entrega a nadie.
 *
 * Los walk-ins dejan de entrar cuando falta menos que la ventana de protección
 * (45 min de corte promedio + buffer de la sucursal): `claim_next_for_barber`
 * devuelve vacío y el panel se veía colgado. Este cartel es puramente
 * informativo — no cambia ninguna regla de la fila.
 */
export function NextAppointmentNotice({
  appointments,
  nowMs,
  timeZone,
  bufferMinutes,
  isIdle,
  appointmentWaitingInQueue,
  waitingWalkIns,
  onlyWhenBlocking = false,
  className,
}: NextAppointmentNoticeProps) {
  const next = useMemo(
    () => findNextAppointment(appointments, nowMs, timeZone),
    [appointments, nowMs, timeZone]
  )

  if (!next) return null

  const windowMinutes = protectionWindowMinutes(bufferMinutes)
  // Si el cliente del turno YA está en la fila, el barbero no está frenado:
  // `claim_next_for_barber` se lo entrega. El cartel entonces no debe decir
  // que no entra nadie.
  const isBlocked = isIdle && !appointmentWaitingInQueue && next.minutesUntil <= windowMinutes
  if (onlyWhenBlocking && !isBlocked) return null
  const showCountdown = next.minutesUntil <= 60

  const clientName = next.appointment.client?.name ?? 'Cliente'
  const serviceName = next.appointment.service?.name

  // El nombre ya va en el título cuando NO está frenado, así que en la segunda
  // línea sólo se repite en la variante bloqueada (donde el título es el aviso).
  const detailParts: string[] = []
  if (isBlocked) detailParts.push(clientName)
  if (serviceName) detailParts.push(serviceName)
  if (isBlocked && waitingWalkIns > 0) {
    detailParts.push(
      waitingWalkIns === 1
        ? 'El que está esperando entra después'
        : `Los ${waitingWalkIns} que están esperando entran después`
    )
  }
  if (!isBlocked && appointmentWaitingInQueue) {
    detailParts.push('Ya está esperando en tu fila')
  }

  return (
    <div
      className={cn(
        'flex items-center gap-3 border-b px-4 py-2.5',
        isBlocked
          ? 'border-violet-500/30 bg-violet-500/10'
          : 'border-border bg-muted/40',
        className
      )}
      role="status"
      aria-live="polite"
    >
      <div
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-xl',
          isBlocked ? 'bg-violet-500/20 text-violet-600' : 'bg-secondary text-muted-foreground'
        )}
      >
        <CalendarClock className="size-4" />
      </div>

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'text-sm font-semibold leading-tight',
            isBlocked ? 'text-violet-700 dark:text-violet-300' : 'text-foreground'
          )}
        >
          {isBlocked
            ? `No entra otro corte antes de tu turno de las ${next.timeLabel}`
            : `Próximo turno ${next.timeLabel} · ${clientName}`}
        </p>
        {detailParts.length > 0 && (
          <p className="truncate text-xs text-muted-foreground">{detailParts.join(' · ')}</p>
        )}
      </div>

      {showCountdown && (
        <span
          className={cn(
            'shrink-0 rounded-lg px-2 py-1 text-xs font-bold tabular-nums',
            isBlocked ? 'bg-violet-500/20 text-violet-700 dark:text-violet-300' : 'bg-secondary text-foreground'
          )}
        >
          {next.minutesUntil <= 1 ? 'ahora' : `en ${next.minutesUntil} min`}
        </span>
      )}

      {isBlocked && (
        <Info className="size-4 shrink-0 text-violet-500/70" aria-hidden="true" />
      )}
    </div>
  )
}
