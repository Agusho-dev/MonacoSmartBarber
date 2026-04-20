'use client'

import { useSyncExternalStore } from 'react'

/**
 * Suscribe al estado online/offline del navegador usando `useSyncExternalStore`,
 * que es el pattern idiomático para leer de fuentes externas sin violar las
 * reglas de purity de React 19 / React Compiler.
 *
 * En SSR retorna `true` para evitar mostrar el banner de offline en el primer
 * render del servidor (donde no hay Navigator API).
 */
function subscribe(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}

function getSnapshot(): boolean {
  if (typeof navigator === 'undefined') return true
  return navigator.onLine
}

function getServerSnapshot(): boolean {
  return true
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
