'use client'

import { usePathname } from 'next/navigation'
import { VisorHora } from './visor-hora'

/**
 * Banda de arriba del panel: la hora y nada más (decisión del dueño). Está en
 * el layout de /barbero, así que es la misma en todas las pantallas y no se
 * vuelve a montar al navegar: la hora nunca parpadea ni cambia de lugar.
 *
 * Pegajosa: en las pantallas que scrollean (historial, asistencia) sigue a la
 * vista. Los encabezados de esas pantallas se pegan DEBAJO de ella con
 * `top-[var(--alto-banda)]`, y la fila descuenta su alto del de la pantalla.
 *
 * En el PIN no va: esa pantalla es la de bloqueo y tiene su propio reloj grande.
 */
export function BandaReloj() {
  const pathname = usePathname()
  if (pathname === '/barbero/login') return null

  return (
    <div
      className="sticky top-0 z-40 flex h-[var(--alto-banda)] shrink-0 items-center justify-center border-b border-border/70 bg-background"
    >
      <VisorHora />
    </div>
  )
}
