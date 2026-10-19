'use client'

import { useEffect } from 'react'
import { precalentarReconocimiento } from '@/lib/face-recognition'

/**
 * Deja listo el reconocimiento facial mientras el kiosko espera en el inicio.
 *
 * Bajar los modelos (~7 MB) y compilar sus shaders en la GPU de la tablet lleva
 * varios segundos la primera vez, y los pagaba el primer cliente que tocaba
 * "Sí": "Cargando sistema de reconocimiento…" y una cámara que tardaba en
 * reaccionar. Arranca después de un rato en el inicio, para no competir con su
 * animación de entrada, y corre una sola vez por carga de la página (después de
 * un deploy, la recarga por versión lo vuelve a correr en reposo).
 */
export function usePrecalentarReconocimiento(activo: boolean) {
  useEffect(() => {
    if (!activo) return
    let idle: number | null = null
    const id = setTimeout(() => {
      const correr = () => {
        precalentarReconocimiento().catch((e) => {
          console.warn('[kiosko] no se pudo precalentar el reconocimiento facial', e)
        })
      }
      if (typeof window.requestIdleCallback === 'function') idle = window.requestIdleCallback(correr, { timeout: 3000 })
      else correr()
    }, 2500)
    return () => {
      clearTimeout(id)
      if (idle !== null) window.cancelIdleCallback?.(idle)
    }
  }, [activo])
}
