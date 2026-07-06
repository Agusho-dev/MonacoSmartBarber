'use client'

import { useEffect } from 'react'

/**
 * Guardián del botón "atrás" de Android para el modo kiosco (APK/TWA instalada).
 *
 * Problema: en el TWA, cuando el barbero llega al fondo del historial y aprieta
 * "atrás", Android cierra la pestaña del panel y la app queda colgada en el
 * splash del launcher (el logo "bos" en blanco). Es un limbo del que solo se
 * sale des-anclando y volviendo a anclar la pantalla.
 *
 * Solución: atrapamos el botón atrás re-empujando el estado actual en cada
 * `popstate`, así el panel nunca sale. Toda la navegación del panel es por
 * Links (BarberNav + botones "Volver"), nunca por el botón atrás, por lo que
 * esto NO rompe ningún flujo (los clicks siguen funcionando igual).
 *
 * Se activa SOLO en la app instalada (display standalone/fullscreen, o referrer
 * `android-app://`). En un navegador normal no atrapamos nada, para no molestar
 * en desarrollo ni si alguien abre el panel en una pestaña común.
 */
export function KioskBackGuard() {
  useEffect(() => {
    if (typeof window === 'undefined') return

    const isInstalledApp =
      window.matchMedia?.('(display-mode: standalone)')?.matches ||
      window.matchMedia?.('(display-mode: fullscreen)')?.matches ||
      (typeof document !== 'undefined' &&
        document.referrer.startsWith('android-app://'))

    if (!isInstalledApp) return

    // Sembramos un estado y lo re-sembramos en cada intento de "atrás".
    history.pushState(null, '', location.href)
    const onPopState = () => {
      history.pushState(null, '', location.href)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  return null
}
