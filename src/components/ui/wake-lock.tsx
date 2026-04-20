'use client'

import { useEffect, useRef } from 'react'

interface WakeLockSentinel extends EventTarget {
  released: boolean
  release: () => Promise<void>
}

/**
 * Mantiene la pantalla del tablet despierta mientras el panel del barbero
 * esté visible. Re-adquiere el lock al volver de background, cambiar de
 * orientación o redimensionar (algunos browsers liberan el lock en estos casos).
 */
export function WakeLock() {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)

  useEffect(() => {
    let isMounted = true

    const requestWakeLock = async () => {
      if (!isMounted) return
      if (typeof navigator === 'undefined') return
      if (!('wakeLock' in navigator)) return
      // Si ya tenemos uno activo, no pedimos otro.
      if (wakeLockRef.current && !wakeLockRef.current.released) return

      try {
        const navWithWakeLock = navigator as Navigator & {
          wakeLock: { request: (type: 'screen') => Promise<WakeLockSentinel> }
        }
        const sentinel = await navWithWakeLock.wakeLock.request('screen')
        wakeLockRef.current = sentinel
        sentinel.addEventListener('release', () => {
          // Perdimos el lock — se intentará re-adquirir si hace falta.
        })
      } catch {
        // Usualmente: "NotAllowedError" si la pestaña no está en foco.
        // Silencioso; se reintenta en visibilitychange.
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') requestWakeLock()
    }
    const handleOrientationOrResize = () => {
      // Algunos browsers liberan el lock en resize/orientationchange.
      requestWakeLock()
    }

    if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
      requestWakeLock()
      document.addEventListener('visibilitychange', handleVisibilityChange)
      window.addEventListener('focus', handleVisibilityChange)
      window.addEventListener('orientationchange', handleOrientationOrResize)
      window.addEventListener('resize', handleOrientationOrResize)
    }

    return () => {
      isMounted = false
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange)
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', handleVisibilityChange)
        window.removeEventListener('orientationchange', handleOrientationOrResize)
        window.removeEventListener('resize', handleOrientationOrResize)
      }
      wakeLockRef.current?.release().catch(() => {})
      wakeLockRef.current = null
    }
  }, [])

  return null
}
