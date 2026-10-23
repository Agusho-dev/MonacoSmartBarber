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
 * botón flotante de Tex y, en el celular, la barra de secciones flotante. En
 * Mensajería (sin botón de Tex) van arriba de la barra en la lista de chats y,
 * en el celular, con una capa abierta (la pantalla inmersiva) arriba del
 * composer del chat o, sin composer (una sección, Programados), 12 px arriba
 * del área segura. Afuera del dashboard (el kiosko, la TV, el turnero) y en la
 * pantalla de Tex (sin barra ni botón) quedan donde siempre. En Configurar Tex
 * el botón no se monta: quedan 12 px arriba de la barra.
 *
 * Lo decide SÓLO la ruta —nada del store del giro—: el resultado es el mismo en
 * el servidor y en la hidratación, y no hay ningún instante con dos montados.
 * Lo que cambia sin cambiar la ruta (un chat abierto, el ancho, el botón de
 * Tex) lo resuelve el CSS de las variables.
 */
export function ToasterRaiz() {
  const pathname = usePathname()
  if (esPanelDelBarbero(pathname)) return null
  const corrimiento = corrimientoDeAvisos(pathname)
  if (corrimiento) return <Toaster offset={corrimiento} mobileOffset={corrimiento} />
  return <Toaster />
}

/**
 * Las alturas salen de globals.css y cambian solas con el ancho:
 * - `--avisos-abajo`: arriba de la barra del celular y, si está montado, del
 *   botón de Tex (`:has([data-tex-flotante])`): a quien no usa Tex (o en
 *   Configurar Tex, donde el shell no lo monta) los avisos no le quedan
 *   flotando sobre un hueco.
 * - `--avisos-abajo-mensajeria`: arriba de la barra en la lista; con una capa
 *   abierta en el celular (`html[data-pantalla-inmersiva]`), arriba del
 *   composer medido o del área segura; en la compu, arriba del composer.
 *
 * sonner 2.0.7: `offset` rige desde 601 px y `mobileOffset` hasta 600; con un
 * objeto, los lados que no se pasan quedan en sus valores de siempre (24 y 16 px).
 */
const AVISOS_DASHBOARD = { bottom: 'var(--avisos-abajo)' }
const AVISOS_MENSAJERIA = { bottom: 'var(--avisos-abajo-mensajeria)' }

function corrimientoDeAvisos(pathname: string | null) {
  if (!pathname || !enRuta(pathname, '/dashboard')) return null
  // La pantalla de Tex, y sólo ella (Configurar Tex tiene la barra): sin barra
  // ni botón flotante, como siempre.
  if (pathname === '/dashboard/asistente') return null
  if (enRuta(pathname, '/dashboard/mensajeria')) return AVISOS_MENSAJERIA
  return AVISOS_DASHBOARD
}

function enRuta(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(base + '/')
}

function esPanelDelBarbero(pathname: string | null): boolean {
  return pathname === '/barbero' || (pathname?.startsWith('/barbero/') ?? false)
}
