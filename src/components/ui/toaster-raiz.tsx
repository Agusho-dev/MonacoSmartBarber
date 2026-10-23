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
 * En el dashboard los avisos se corren hacia arriba: abajo a la derecha está el
 * botón flotante de Tex y, en el celular, la barra de secciones. Afuera del
 * dashboard (el kiosko, la TV, el turnero) y en las pantallas donde el botón no
 * va (Tex y Mensajería), quedan donde siempre.
 *
 * Lo decide SÓLO la ruta —nada del store del giro—: el resultado es el mismo en
 * el servidor y en la hidratación, y no hay ningún instante con dos montados.
 */
export function ToasterRaiz() {
  const pathname = usePathname()
  if (esPanelDelBarbero(pathname)) return null
  if (avisosCorridos(pathname)) return <Toaster offset={AVISOS_DASHBOARD} mobileOffset={AVISOS_DASHBOARD} />
  return <Toaster />
}

/**
 * La altura sale de `--avisos-abajo` (globals.css), que cambia sola con el ancho
 * y con que el botón de Tex esté o no (`:has([data-tex-flotante])`): a quien no
 * usa Tex los avisos no le quedan flotando sobre un hueco.
 *
 * sonner 2.0.7: `offset` rige desde 601 px y `mobileOffset` hasta 600; con un
 * objeto, los lados que no se pasan quedan en sus valores de siempre (24 y 16 px).
 */
const AVISOS_DASHBOARD = { bottom: 'var(--avisos-abajo)' }

function avisosCorridos(pathname: string | null): boolean {
  if (!pathname || !enRuta(pathname, '/dashboard')) return false
  return !enRuta(pathname, '/dashboard/asistente') && !enRuta(pathname, '/dashboard/mensajeria')
}

function enRuta(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(base + '/')
}

function esPanelDelBarbero(pathname: string | null): boolean {
  return pathname === '/barbero' || (pathname?.startsWith('/barbero/') ?? false)
}
