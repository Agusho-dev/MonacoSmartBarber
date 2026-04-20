'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

interface LiveTimerTextProps {
  /** ISO timestamp de inicio (queue_entries.started_at). Si es null, muestra placeholder. */
  startedAt: string | null | undefined
  /** Segundos pausados acumulados. */
  pausedDurationSeconds?: number
  /** ISO de pausa activa — si existe, el contador se congela visualmente. */
  pausedAt?: string | null | undefined
  /** Formato "m:ss" (default) o "h:mm:ss" cuando supera 1h. */
  className?: string
  placeholder?: string
  ariaLabel?: string
}

function format(totalSeconds: number): string {
  if (totalSeconds < 0) totalSeconds = 0
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * Timer live que escribe directamente al DOM vía requestAnimationFrame.
 * No provoca re-renders de React, ideal para el recuadro del cliente activo
 * que se actualiza cada segundo sin afectar el árbol.
 */
export function LiveTimerText({
  startedAt,
  pausedDurationSeconds = 0,
  pausedAt,
  className,
  placeholder = '0:00',
  ariaLabel = 'Tiempo de servicio',
}: LiveTimerTextProps) {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    if (!startedAt) {
      el.textContent = placeholder
      return
    }

    const start = new Date(startedAt).getTime()
    if (!Number.isFinite(start)) {
      el.textContent = placeholder
      return
    }

    let rafId = 0
    let lastSec = -1
    let cancelled = false

    const tick = () => {
      if (cancelled) return

      let elapsedMs = Date.now() - start - pausedDurationSeconds * 1000
      if (pausedAt) {
        const pausedSince = new Date(pausedAt).getTime()
        if (Number.isFinite(pausedSince)) {
          elapsedMs -= Math.max(0, Date.now() - pausedSince)
        }
      }
      const totalSec = Math.max(0, Math.floor(elapsedMs / 1000))

      if (totalSec !== lastSec) {
        el.textContent = format(totalSec)
        lastSec = totalSec
      }

      // Si está pausado, podemos salir del bucle — solo se re-arma al cambiar props.
      if (pausedAt) return

      rafId = requestAnimationFrame(tick)
    }

    tick()

    return () => {
      cancelled = true
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [startedAt, pausedDurationSeconds, pausedAt, placeholder])

  return (
    <span
      ref={ref}
      className={cn('tabular-nums', className)}
      aria-label={ariaLabel}
      role="timer"
      suppressHydrationWarning
    >
      {placeholder}
    </span>
  )
}
