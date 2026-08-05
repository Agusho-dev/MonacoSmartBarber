import { CalendarClock } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TurnoBadgeProps {
  /** Hora reservada en formato HH:MM (sale de `appointmentTimeLabel`). */
  time: string
  className?: string
  iconClassName?: string
}

/**
 * Distintivo de "esta persona reservó hora", compartido por el dashboard de
 * fila, el panel del barbero y la TV para que las tres superficies hablen el
 * mismo idioma visual.
 *
 * El violeta es exclusivo de los turnos: ámbar son descansos, verde el corte en
 * curso y amarillo/azul los dinámicos ("menor espera").
 */
export function TurnoBadge({ time, className, iconClassName }: TurnoBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md border border-violet-500/40 bg-violet-500/15',
        'px-1.5 py-px text-[10px] font-bold uppercase tracking-wider',
        'text-violet-600 dark:text-violet-300',
        className
      )}
    >
      <CalendarClock className={cn('size-3 shrink-0', iconClassName)} />
      <span>Turno {time}</span>
    </span>
  )
}
