'use client'

import { cn } from '@/lib/utils'
import type { Appointment, AppointmentStatus } from '@/lib/types/database'

interface Props {
  appointment: Appointment
  /** Posición top relativa al inicio de la grilla (en px) */
  topPx: number
  /** Altura proporcional a la duración (en px) */
  heightPx: number
  /** Píxeles por minuto — para calcular proporciones */
  pxPerMinute: number
  isSelected: boolean
  onClick: () => void
  className?: string
}

const STATUS_CONFIG: Record<AppointmentStatus, { label: string; bg: string; border: string; text: string }> = {
  pending_payment: {
    label: 'Pago pendiente',
    bg: 'bg-amber-50 dark:bg-amber-950/40',
    border: 'border-amber-400',
    text: 'text-amber-800 dark:text-amber-300',
  },
  confirmed: {
    label: 'Confirmado',
    bg: 'bg-blue-50 dark:bg-blue-950/40',
    border: 'border-blue-500',
    text: 'text-blue-800 dark:text-blue-300',
  },
  checked_in: {
    label: 'En recepción',
    bg: 'bg-violet-50 dark:bg-violet-950/40',
    border: 'border-violet-500',
    text: 'text-violet-800 dark:text-violet-300',
  },
  in_progress: {
    label: 'En atención',
    bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    border: 'border-emerald-500',
    text: 'text-emerald-800 dark:text-emerald-300',
  },
  completed: {
    label: 'Completado',
    bg: 'bg-slate-50 dark:bg-slate-900/60',
    border: 'border-slate-400',
    text: 'text-slate-600 dark:text-slate-400',
  },
  cancelled: {
    label: 'Cancelado',
    bg: 'bg-red-50 dark:bg-red-950/40',
    border: 'border-red-400',
    text: 'text-red-700 dark:text-red-400',
  },
  no_show: {
    label: 'No vino',
    bg: 'bg-red-50 dark:bg-red-950/30',
    border: 'border-red-300',
    text: 'text-red-600 dark:text-red-400',
  },
}

function formatTimeHM(t: string) {
  return t.slice(0, 5)
}

export function AppointmentBlock({
  appointment,
  topPx,
  heightPx,
  isSelected,
  onClick,
  className,
}: Props) {
  const config = STATUS_CONFIG[appointment.status] ?? STATUS_CONFIG.confirmed
  const isShort = heightPx < 48

  return (
    <button
      type="button"
      onClick={onClick}
      style={{ top: topPx, height: heightPx }}
      className={cn(
        'absolute left-0.5 right-0.5 z-10 overflow-hidden rounded border-l-2 px-1.5 py-0.5 text-left transition-all hover:z-20 hover:shadow-md',
        config.bg,
        config.border,
        isSelected && 'ring-2 ring-primary ring-offset-1 z-30',
        className
      )}
      aria-label={`Turno de ${appointment.client?.name ?? 'cliente'} a las ${formatTimeHM(appointment.start_time)}`}
    >
      {isShort ? (
        /* Bloque compacto para slots < 48px de alto */
        <p className={cn('truncate text-[10px] font-semibold leading-none', config.text)}>
          {formatTimeHM(appointment.start_time)} · {appointment.client?.name ?? '—'}
        </p>
      ) : (
        /* Bloque completo */
        <div className="flex h-full flex-col justify-between overflow-hidden">
          <div>
            <p className={cn('truncate text-[11px] font-bold leading-tight', config.text)}>
              {appointment.client?.name ?? '—'}
            </p>
            {appointment.service?.name && (
              <p className="truncate text-[10px] text-muted-foreground leading-tight">
                {appointment.service.name}
              </p>
            )}
          </div>
          <p className={cn('text-[10px] font-mono', config.text)}>
            {formatTimeHM(appointment.start_time)} – {formatTimeHM(appointment.end_time)}
          </p>
        </div>
      )}
    </button>
  )
}
