'use client'

import { useSyncExternalStore } from 'react'
import {
  esModoCss,
  leerGiro,
  leerGiroServidor,
  suscribirGiro,
  type EstadoGiro,
} from '@/lib/giro-panel/store'

/**
 * Estado completo del giro del panel (src/lib/giro-panel/store.ts). En el
 * servidor y durante la hidratación devuelve el estado inicial ('normal'): el
 * giro de la primera pintada lo pone el script pre-paint en <html>, no React, así
 * que no hay mismatch.
 *
 * Las acciones (alternarGiro, girarTeclado, alternarPantallaCompleta) se
 * importan directo del store: son funciones de módulo, no dependen del render.
 */
export function useGiroPanel(): EstadoGiro {
  return useSyncExternalStore(suscribirGiro, leerGiro, leerGiroServidor)
}

const siempreFalso = () => false

/**
 * true sólo con el panel girado por CSS. Fuera de /barbero el store nunca se
 * inicia y esto es SIEMPRE false: los wrappers de shadcn que lo usan (Select,
 * DropdownMenu) se comportan exactamente igual que antes en el dashboard y el
 * kiosko. Re-renderiza sólo cuando cambia este booleano, no con cada cambio del
 * store.
 */
export function useGiroCss(): boolean {
  return useSyncExternalStore(suscribirGiro, esModoCss, siempreFalso)
}
