'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

// Altura base: 30 minutos = 60px. Factor de escala para el eje.
const PX_PER_MINUTE = 2

interface TimelineTimeAxisProps {
  startHour: number // hora de inicio del día (ej: 8)
  endHour: number   // hora de fin del día (ej: 21)
  className?: string
}

function minutesSinceStart(hour: number, minute: number, startHour: number): number {
  return (hour - startHour) * 60 + minute
}

export function TimelineTimeAxis({ startHour, endHour, className }: TimelineTimeAxisProps) {
  const [nowMinutes, setNowMinutes] = useState<number | null>(null)

  useEffect(() => {
    function calcNow() {
      const d = new Date()
      const mins = minutesSinceStart(d.getHours(), d.getMinutes(), startHour)
      setNowMinutes(mins)
    }
    calcNow()
    // Actualizar cada 60s según especificación
    const interval = setInterval(calcNow, 60_000)
    return () => clearInterval(interval)
  }, [startHour])

  const totalMinutes = (endHour - startHour) * 60
  const totalHeight = totalMinutes * PX_PER_MINUTE

  // Marcas cada 60 minutos para las horas completas
  const hourMarks: number[] = []
  for (let h = startHour; h <= endHour; h++) {
    hourMarks.push(h)
  }

  // La línea de hora actual solo aparece si está dentro del rango
  const showNowLine =
    nowMinutes !== null && nowMinutes >= 0 && nowMinutes <= totalMinutes
  const nowLineTop = nowMinutes !== null ? nowMinutes * PX_PER_MINUTE : 0

  return (
    <div
      className={cn('relative select-none', className)}
      style={{ height: totalHeight }}
    >
      {/* Marcas de hora */}
      {hourMarks.map((hour) => {
        const topPx = minutesSinceStart(hour, 0, startHour) * PX_PER_MINUTE
        const label = `${String(hour).padStart(2, '0')}:00`
        return (
          <div
            key={hour}
            className="absolute left-0 right-0 flex items-center gap-2"
            style={{ top: topPx }}
          >
            <span className="w-10 shrink-0 text-right text-[10px] font-medium text-muted-foreground/70 leading-none">
              {label}
            </span>
            <div className="h-px flex-1 bg-border/40" />
          </div>
        )
      })}

      {/* Marcas cada 15 min (cuartos de hora) — más sutiles */}
      {Array.from({ length: totalMinutes / 15 }, (_, i) => {
        const mins = (i + 1) * 15
        if (mins % 60 === 0) return null // ya cubierto por hourMarks
        const topPx = mins * PX_PER_MINUTE
        return (
          <div
            key={`q-${i}`}
            className="absolute left-10 right-0 flex items-center gap-2"
            style={{ top: topPx }}
          >
            <div className="h-px flex-1 bg-border/20" />
          </div>
        )
      })}

      {/* Línea de hora actual */}
      {showNowLine && (
        <div
          className="pointer-events-none absolute left-0 right-0 z-20 flex items-center gap-1"
          style={{ top: nowLineTop }}
        >
          <div className="size-2 shrink-0 rounded-full bg-red-500 ml-10" />
          <div className="h-0.5 flex-1 bg-red-500" />
        </div>
      )}
    </div>
  )
}

// Exportar constante para que otros componentes puedan calcular la posición
export { PX_PER_MINUTE }
