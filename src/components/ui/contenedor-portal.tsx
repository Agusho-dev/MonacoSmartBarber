'use client'

import { createContext, useContext } from 'react'

/**
 * Dónde portalean Dialog, AlertDialog y Sheet. null = <body>, como siempre.
 *
 * El panel del barbero lo fija en #giro-portales (GiroPanelRaiz), adentro de la
 * caja que se gira 180°: así los diálogos giran con el panel sin tocar ningún
 * call site. Es el mismo contenedor en los dos modos a propósito: si cambiara con
 * el modo, girar con un cobro abierto remontaría el diálogo (se pierde lo cargado
 * y el <video> del escáner queda negro). En modo normal #giro-portales es un div
 * sin transform, así que fixed y z-index se comportan igual que en <body>.
 *
 * Fuera de /barbero nadie provee el contexto y los wrappers quedan idénticos.
 */
export const ContenedorPortalContext = createContext<HTMLElement | null>(null)

export function useContenedorPortal(): HTMLElement | null {
  return useContext(ContenedorPortalContext)
}
