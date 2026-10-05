'use client'

import { usePathname } from 'next/navigation'
import { Toaster } from '@/components/ui/sonner'

/**
 * Toaster del root layout para todas las superficies MENOS el panel del barbero.
 *
 * /barbero monta el suyo adentro de la caja que se gira 180° (GiroPanelRaiz):
 * sonner dibuja en el lugar del árbol donde está su Toaster, y uno colgado de
 * <body> saldría al revés con el panel girado. Dos Toaster sin id duplican cada
 * aviso (sonner manda cada toast a todos), así que acá se apaga el global.
 *
 * Lo decide SÓLO la ruta —nada del store del giro—: el resultado es el mismo en
 * el servidor y en la hidratación, y no hay ningún instante con dos montados.
 */
export function ToasterRaiz() {
  const pathname = usePathname()
  if (esPanelDelBarbero(pathname)) return null
  return <Toaster />
}

function esPanelDelBarbero(pathname: string | null): boolean {
  return pathname === '/barbero' || (pathname?.startsWith('/barbero/') ?? false)
}
