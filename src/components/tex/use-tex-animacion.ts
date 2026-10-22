'use client'

// Si Tex se mueve o queda quieto. Lo deciden dos cosas:
//   1. prefers-reduced-motion del sistema (manda siempre);
//   2. la preferencia de este navegador ("Animaciones de Tex: completas /
//      quietas"), que se guarda en localStorage y se cambia desde el menú de Tex.
// Se lee con useSyncExternalStore: en el servidor no hay ninguna de las dos y
// la cara se pinta quieta (cuadro 1), que es justo lo que se ve antes de hidratar.

import { useSyncExternalStore } from 'react'

export type TexAnimacion = 'completa' | 'quieta'

const CLAVE = 'tex.animacion.v1'
const EVENTO = 'tex-animacion-cambio'

function leerPreferencia(): TexAnimacion {
  try {
    return window.localStorage.getItem(CLAVE) === 'quieta' ? 'quieta' : 'completa'
  } catch {
    return 'completa'
  }
}

function reduceMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function snapshot(): TexAnimacion {
  if (reduceMotion()) return 'quieta'
  return leerPreferencia()
}

function suscribir(avisar: () => void): () => void {
  const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
  mq?.addEventListener('change', avisar)
  window.addEventListener(EVENTO, avisar)
  window.addEventListener('storage', avisar)
  return () => {
    mq?.removeEventListener('change', avisar)
    window.removeEventListener(EVENTO, avisar)
    window.removeEventListener('storage', avisar)
  }
}

export function useTexAnimacion(): TexAnimacion {
  return useSyncExternalStore(suscribir, snapshot, () => 'quieta')
}

/** La preferencia guardada (sin mirar reduced-motion), para el selector del menú. */
export function useTexAnimacionPreferida(): TexAnimacion {
  return useSyncExternalStore(suscribir, leerPreferencia, () => 'completa')
}

export function guardarTexAnimacion(valor: TexAnimacion): void {
  try {
    window.localStorage.setItem(CLAVE, valor)
  } catch {
    /* modo privado o storage bloqueado: la preferencia dura lo que la pestaña */
  }
  window.dispatchEvent(new Event(EVENTO))
}
