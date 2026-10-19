'use client'

import { useEffect, useState } from 'react'
import { computeMinutes } from '@/hooks/use-timer-stage'
import { cn } from '@/lib/utils'

/**
 * Regla de minutos de la ficha que está en la silla: la escala del reloj de
 * fichar, de 0 al final del tramo, con una aguja en el minuto actual.
 *
 * El cronómetro dice cuánto va; la regla dice cuánto falta para el próximo
 * color del semáforo, y se lee de reojo sin leer números. Mide con
 * `computeMinutes`, la MISMA cuenta que el semáforo (pausas incluidas): si
 * midieran distinto, la aguja y el color se contradirían.
 *
 * Sin palabras a propósito: el cliente sentado la ve, y la regla no dice
 * "apurate", sólo dónde va el corte. Se dibuja con el color del texto de la
 * tarjeta (`currentColor`), así sirve sobre cualquier color del semáforo.
 */
export function ReglaMinutos({
  inicio,
  pausaSegundos = 0,
  pausadoDesde,
  maximo,
  marcas = [],
  conCifras = true,
  className,
}: {
  /** `started_at` de la entrada. */
  inicio: string | null | undefined
  pausaSegundos?: number
  pausadoDesde?: string | null
  /** Minuto donde termina la regla (45 en un corte: ahí el semáforo llega al rojo). */
  maximo: number
  /** Minutos con marca alta: los cambios de color del semáforo. */
  marcas?: number[]
  /**
   * Minutos de referencia debajo de la regla. En el corte NO van: el cliente
   * sentado compararía "45" con el cronómetro, y al barbero le alcanzan las
   * marcas altas de los cambios de color. En el descanso (es del barbero) sí.
   */
  conCifras?: boolean
  className?: string
}) {
  // La tarjeta se dibuja sólo en el cliente (la fila se lee después de montar),
  // así que la primera lectura puede salir del reloj sin desfasar la hidratación.
  const [minutos, setMinutos] = useState<number | null>(() =>
    computeMinutes(inicio, pausaSegundos, pausadoDesde, Date.now()),
  )

  useEffect(() => {
    const leer = () => setMinutos(computeMinutes(inicio, pausaSegundos, pausadoDesde, Date.now()))
    // Primera lectura fuera del cuerpo del efecto (mismo criterio que useTimerStage).
    const primera = setTimeout(leer, 0)
    // Pausado no se mueve: una lectura alcanza hasta que cambie la entrada.
    if (pausadoDesde) return () => clearTimeout(primera)
    // Cada 10 s alcanza: en la escala de 45 min la aguja avanza ~3 px por lectura,
    // el "tic" de un reloj (sin transición: animar left/width obliga a relayout).
    const id = setInterval(leer, 10_000)
    return () => {
      clearTimeout(primera)
      clearInterval(id)
    }
  }, [inicio, pausaSegundos, pausadoDesde])

  if (maximo <= 0) return null

  const pct = minutos === null ? 0 : Math.min(100, (minutos / maximo) * 100)
  const paso = maximo <= 20 ? 1 : 5
  const rayas: number[] = []
  for (let m = paso; m < maximo; m += paso) rayas.push(m)
  const etiquetas = maximo % 15 === 0 ? [0, maximo / 3, (2 * maximo) / 3, maximo] : [0, maximo]

  return (
    <div aria-hidden className={cn('relative select-none', conCifras ? 'h-10' : 'h-6', className)}>
      {/* Riel */}
      <div className="absolute inset-x-0 top-2.5 h-2 rounded-full bg-current/15" />
      {/* Recorrido */}
      <div
        className="absolute left-0 top-2.5 h-2 rounded-full bg-current/30"
        style={{ width: `${pct}%` }}
      />
      {/* Rayas cada 5 min; las de cambio de color, más altas */}
      {rayas.map((m) => {
        const alta = marcas.includes(m)
        return (
          <span
            key={m}
            className={cn(
              'absolute w-px -translate-x-1/2 bg-current',
              alta ? 'top-1 h-5 opacity-45' : 'top-2 h-3 opacity-25',
            )}
            style={{ left: `${(m / maximo) * 100}%` }}
          />
        )
      })}
      {/* Aguja */}
      {minutos !== null && (
        <span
          className="absolute top-0 h-[1.375rem] w-1 -translate-x-1/2 rounded-full bg-current shadow-[0_1px_3px_oklch(0_0_0/0.3)]"
          style={{ left: `${pct}%` }}
        />
      )}
      {/* Minutos de referencia */}
      {conCifras && etiquetas.map((m, i) => (
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
