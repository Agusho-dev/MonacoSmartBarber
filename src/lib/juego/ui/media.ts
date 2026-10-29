/**
 * Hooks chicos de entorno (media queries y visibilidad de la pestaña) con
 * `useSyncExternalStore`: el servidor ve un valor fijo y el cliente el real, sin
 * setState dentro de efectos.
 */
import { useSyncExternalStore } from 'react'

function sinSuscripcion(): () => void {
  return () => {}
}

export function useConsultaMedia(consulta: string, valorServidor = false): boolean {
  return useSyncExternalStore(
    (avisar) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return sinSuscripcion()
      const m = window.matchMedia(consulta)
      m.addEventListener('change', avisar)
      return () => m.removeEventListener('change', avisar)
    },
    () =>
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(consulta).matches
        : valorServidor,
    () => valorServidor,
  )
}

export function usePestanaVisible(): boolean {
  return useSyncExternalStore(
    (avisar) => {
      document.addEventListener('visibilitychange', avisar)
      return () => document.removeEventListener('visibilitychange', avisar)
    },
    () => document.visibilityState !== 'hidden',
    () => true,
  )
}

export function usePantallaCompleta(): boolean {
  return useSyncExternalStore(
    (avisar) => {
      document.addEventListener('fullscreenchange', avisar)
      return () => document.removeEventListener('fullscreenchange', avisar)
    },
    () => !!document.fullscreenElement,
    () => false,
  )
}

/** Para leer en handlers (no en el render): ¿el jugador pidió menos movimiento? */
export function prefiereMenosMovimiento(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** ¿Hay un dedo como puntero (celular, tablet, compu táctil)? Para leer en handlers/efectos. */
export function esPantallaTactil(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(any-pointer: coarse)').matches
}
