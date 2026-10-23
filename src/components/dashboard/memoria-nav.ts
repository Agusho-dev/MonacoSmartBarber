'use client'

// Lo que el menú recuerda por persona en este navegador: el orden de los grupos
// y la última pestaña usada de cada uno. Vive en localStorage, que puede no
// estar (modo privado, datos bloqueados) o fallar al escribir (cuota): en ese
// caso queda en memoria mientras dure la pestaña y el menú anda igual.
//
// Se lee con useSyncExternalStore y con snapshot de servidor null: el HTML del
// servidor y la hidratación usan el orden por defecto (sin desajuste de
// hidratación) y React vuelve a dibujar con lo guardado apenas hidrata.

import { useSyncExternalStore } from 'react'

const EVENTO = 'msb:memoria-nav'
const enMemoria = new Map<string, string>()

function suscribir(avisar: () => void): () => void {
  // Otra pestaña del mismo navegador cambió algo: manda lo de localStorage.
  const desdeOtraPestana = (e: StorageEvent) => {
    if (e.key === null) enMemoria.clear()
    else enMemoria.delete(e.key)
    avisar()
  }
  window.addEventListener('storage', desdeOtraPestana)
  window.addEventListener(EVENTO, avisar)
  return () => {
    window.removeEventListener('storage', desdeOtraPestana)
    window.removeEventListener(EVENTO, avisar)
  }
}

export function leerMemoriaNav(clave: string): string | null {
  const local = enMemoria.get(clave)
  if (local !== undefined) return local
  try {
    return window.localStorage.getItem(clave)
  } catch {
    return null
  }
}

export function guardarMemoriaNav(clave: string, valor: string): void {
  if (leerMemoriaNav(clave) === valor) return
  enMemoria.set(clave, valor)
  try {
    window.localStorage.setItem(clave, valor)
  } catch {
    // Modo privado o cuota llena: queda en memoria por esta sesión.
  }
  window.dispatchEvent(new Event(EVENTO))
}

const sinValorEnServidor = () => null

/** El texto guardado en `clave` (null si no hay, y siempre null en el servidor y al hidratar). */
export function useMemoriaNav(clave: string): string | null {
  return useSyncExternalStore(suscribir, () => leerMemoriaNav(clave), sinValorEnServidor)
}
