'use client'

import { useEffect, useState } from 'react'
import { computeMinutes } from '@/hooks/use-timer-stage'
import { CifraEspera } from './tarjeta-espera'

/**
 * Cuánto lleva el corte (o el descanso), en minutos: "32 min", "1 h 05".
 *
 * Reemplaza al "32:01" en la silla. Con la hora del visor arriba ("14:32"), un
 * cronómetro en formato m:ss se leía como otra hora —en los primeros minutos,
 * "8:01" ES una hora válida—, y los segundos cambiaban todo el tiempo frente al
 * cliente. En minutos no se confunde con nada y sólo se mueve una vez por minuto.
 *
 * Mide con `computeMinutes`, la misma cuenta que el semáforo (pausas incluidas),
 * y se re-dibuja justo al cumplirse cada minuto.
 */
export function MinutosEnVivo({
  inicio,
  pausaSegundos = 0,
  pausadoDesde,
  className,
  claseUnidad,
  ariaLabel,
}: {
  inicio: string | null | undefined
  pausaSegundos?: number
  pausadoDesde?: string | null
  className?: string
  claseUnidad?: string
  ariaLabel: string
}) {
  // La silla se dibuja sólo en el cliente (la fila se lee después de montar).
  const [minutos, setMinutos] = useState(() => computeMinutes(inicio, pausaSegundos, pausadoDesde, Date.now()) ?? 0)

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined
    const leer = () => {
      const m = computeMinutes(inicio, pausaSegundos, pausadoDesde, Date.now()) ?? 0
      setMinutos(m)
      // Pausado no avanza: una lectura alcanza hasta que cambie la entrada.
      if (pausadoDesde) return
      // Próximo minuto entero de servicio (+50 ms para caer ya adentro).
      const faltaMs = (Math.floor(m) + 1 - m) * 60_000 + 50
      timeout = setTimeout(leer, faltaMs)
    }
    // Primera lectura fuera del cuerpo del efecto (mismo criterio que useTimerStage).
    timeout = setTimeout(leer, 0)
    // Al volver de un reposo los timers vienen atrasados: se vuelve a leer.
    const alVolver = () => {
      if (document.visibilityState !== 'visible') return
      clearTimeout(timeout)
      leer()
    }
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      clearTimeout(timeout)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [inicio, pausaSegundos, pausadoDesde])

  return (
    <span role="timer" aria-label={`${ariaLabel}: ${Math.floor(minutos)} minutos`} className={className}>
      <CifraEspera minutos={minutos} claseUnidad={claseUnidad} />
    </span>
  )
}
