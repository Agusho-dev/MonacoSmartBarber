'use client'

// ¿La pantalla es la del celular? El mismo corte que usa el shell: debajo de lg
// (1024 px) hay barra inferior y no hay menú lateral. Para lo que no se puede
// resolver con clases `max-lg:` (atributos como `inert`, o pedirle algo al
// shell). En el servidor y al hidratar dice "no": quien lo use tiene que dibujar
// bien la compu primero.

import { useSyncExternalStore } from 'react'

const CONSULTA = '(max-width: 1023.98px)'

function suscribir(avisar: () => void): () => void {
  const lista = window.matchMedia(CONSULTA)
  lista.addEventListener('change', avisar)
  return () => lista.removeEventListener('change', avisar)
}

const leer = () => window.matchMedia(CONSULTA).matches
const leerEnServidor = () => false

export function useEsCelular(): boolean {
  return useSyncExternalStore(suscribir, leer, leerEnServidor)
}
