'use client'

import { useEffect } from 'react'

/**
 * Registra el service worker del panel (public/sw.js) con scope acotado a
 * /barbero/ — así NO intercepta el dashboard admin, el kiosko ni la TV.
 *
 * El SW cachea los assets inmutables de Next para arranque instantáneo en
 * tablets lentas y muestra una página offline si se cae el wifi. La lógica
 * de caché vive en public/sw.js; acá solo lo enganchamos.
 */
export function SwRegister() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

    const register = () => {
      navigator.serviceWorker
        // scope /barbero/ es un narrowing del scope máximo de /sw.js (raíz),
        // permitido sin header Service-Worker-Allowed.
        .register('/sw.js', { scope: '/barbero/' })
        .catch((err) => {
          console.error('[sw] registro falló:', err)
        })
    }

    // Esperamos a 'load' para no competir con la carga inicial en la tablet.
    if (document.readyState === 'complete') {
      register()
    } else {
      window.addEventListener('load', register, { once: true })
      return () => window.removeEventListener('load', register)
    }
  }, [])

  return null
}
