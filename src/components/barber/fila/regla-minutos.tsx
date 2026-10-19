'use client'

import { useEffect, useState } from 'react'
import { computeMinutes } from '@/hooks/use-timer-stage'
import { cn } from '@/lib/utils'

/**
 * Regla del descanso: de 0 a la duración del descanso, con una aguja en el
 * minuto actual y los minutos de referencia abajo. Se dibuja con el color del
 * texto de la tarjeta (`currentColor`).
 *
 * Sólo en el descanso. En el corte NO va: el cliente sentado ve la tablet y una
 * línea que avanza hacia un final le hace sentir que el barbero se apura (lo
 * pidió sacar el dueño). Ahí el color del semáforo alcanza.
 */
export function ReglaMinutos({
  inicio,
  maximo,
  className,
}: {
  /** `started_at` del descanso. */
  inicio: string | null | undefined
  /** Duración del descanso en minutos: donde termina la regla. */
  maximo: number
  className?: string
}) {
  // El descanso se dibuja sólo en el cliente (la fila se lee después de montar),
  // así que la primera lectura puede salir del reloj sin desfasar la hidratación.
  const [minutos, setMinutos] = useState<number | null>(() => computeMinutes(inicio, 0, null, Date.now()))

  useEffect(() => {
    const leer = () => setMinutos(computeMinutes(inicio, 0, null, Date.now()))
    // Primera lectura fuera del cuerpo del efecto (mismo criterio que useTimerStage).
    const primera = setTimeout(leer, 0)
    // Cada 10 s alcanza: la aguja avanza de a poco, como la de un reloj (sin
    // transición: animar left/width obliga a relayout).
    const id = setInterval(leer, 10_000)
    return () => {
      clearTimeout(primera)
      clearInterval(id)
    }
  }, [inicio])

  if (maximo <= 0) return null

  const pct = minutos === null ? 0 : Math.min(100, (minutos / maximo) * 100)
  const paso = maximo <= 20 ? 1 : 5
  const rayas: number[] = []
  for (let m = paso; m < maximo; m += paso) rayas.push(m)
  const etiquetas = maximo % 15 === 0 ? [0, maximo / 3, (2 * maximo) / 3, maximo] : [0, maximo]

  return (
    <div aria-hidden className={cn('relative h-10 select-none', className)}>
      {/* Riel */}
      <div className="absolute inset-x-0 top-2.5 h-2 rounded-full bg-current/15" />
      {/* Recorrido */}
      <div className="absolute left-0 top-2.5 h-2 rounded-full bg-current/30" style={{ width: `${pct}%` }} />
      {/* Rayas */}
      {rayas.map((m) => (
        <span
          key={m}
          className="absolute top-2 h-3 w-px -translate-x-1/2 bg-current opacity-25"
          style={{ left: `${(m / maximo) * 100}%` }}
        />
      ))}
      {/* Aguja */}
      {minutos !== null && (
        <span
          className="absolute top-0 h-[1.375rem] w-1 -translate-x-1/2 rounded-full bg-current shadow-[0_1px_3px_oklch(0_0_0/0.3)]"
          style={{ left: `${pct}%` }}
        />
      )}
      {/* Minutos de referencia */}
      {etiquetas.map((m, i) => (
        <span
          key={m}
          className={cn(
            'absolute top-6 font-mono text-[0.8125rem] font-semibold tabular-nums',
            i === 0 ? 'left-0' : i === etiquetas.length - 1 ? 'right-0' : '-translate-x-1/2',
          )}
          style={i === 0 || i === etiquetas.length - 1 ? undefined : { left: `${(m / maximo) * 100}%` }}
        >
          {m}
        </span>
      ))}
    </div>
  )
}
