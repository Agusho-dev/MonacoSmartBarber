'use client'

import { useEffect, useRef } from 'react'

/**
 * Auto-reset por inactividad del kiosko.
 *
 * La tablet vive en el salón, a la vista de todos: una pantalla que quedó a
 * mitad del flujo sigue mostrando nombre, teléfono, barbero y servicios del
 * cliente anterior hasta que alguien la toque. Ninguna pantalla intermedia del
 * flujo de turnos tenía timeout, así que eso pasaba con cada persona que se iba
 * sin terminar.
 *
 * Dos ventanas:
 *   - 45s en pantallas con datos personales (nombre, teléfono, turno).
 *   - 90s en pantallas neutras (bienvenida, teclado vacío, cámara), donde cortar
 *     rápido molesta al que está tipeando y no expone nada.
 */
export const IDLE_MS_PERSONAL = 45_000
export const IDLE_MS_NEUTRAL = 90_000

const EVENTOS = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const

export function useIdleReset({
  enabled = true,
  timeoutMs,
  resetKey,
  onIdle,
}: {
  enabled?: boolean
  timeoutMs: number
  /**
   * Cambiar este valor reprograma el timer. Pasar el step actual: dos pantallas
   * con la misma ventana no reiniciarían la cuenta si sólo dependiéramos de
   * `timeoutMs`.
   */
  resetKey: string | number
  onIdle: () => void
}) {
  // El callback suele ser una arrow nueva en cada render; guardarlo en una ref
  // evita re-suscribir los listeners (y reiniciar el timer) en cada render.
  const onIdleRef = useRef(onIdle)
  useEffect(() => {
    onIdleRef.current = onIdle
  }, [onIdle])

  useEffect(() => {
    if (!enabled || timeoutMs <= 0) return

    let timer: ReturnType<typeof setTimeout>

    const programar = () => {
      clearTimeout(timer)
      timer = setTimeout(() => onIdleRef.current(), timeoutMs)
    }

    programar()
    for (const ev of EVENTOS) {
      window.addEventListener(ev, programar, { passive: true })
    }

    return () => {
      clearTimeout(timer)
      for (const ev of EVENTOS) window.removeEventListener(ev, programar)
    }
  }, [enabled, timeoutMs, resetKey])
}
