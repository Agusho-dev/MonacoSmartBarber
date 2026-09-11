import type { ReactNode } from 'react'

/**
 * Datos de contacto y del responsable que aparecen en TODAS las páginas
 * públicas de Monaco (/privacidad, /terminos, /eliminar-cuenta, /soporte).
 *
 * Existe porque hasta el 10/9/2026 había tres emails distintos según la
 * pantalla: la app mostraba `studios.sys.work@gmail.com`
 * (`AppConstants.supportEmail`), y la política, los términos y el botón de
 * arrepentimiento un hotmail personal. Apple y Google exigen que el contacto de
 * la ficha, el de la política y el de la app sean el mismo, y la Ley 25.326
 * (art. 6) pide identificar al responsable con un canal real. Un solo lugar,
 * un solo valor.
 *
 * El WhatsApp es el mismo de `AppConstants.supportWhatsappUrl` (confirmado por
 * el dueño el 22/ago/2026). Para `wa.me` un móvil argentino va SIEMPRE con el
 * `9` después del 54.
 */
export const MONACO = {
  appName: 'Monaco',
  companyName: 'Monaco Barber Studio',
  city: 'Córdoba, Argentina',
  email: 'studios.sys.work@gmail.com',
  whatsappDisplay: '+54 9 351 769-1830',
  whatsappUrl: 'https://wa.me/5493517691830',
  instagramHandle: '@monaco.barberia',
  instagramUrl: 'https://www.instagram.com/monaco.barberia',
} as const

/**
 * Identificación legal del responsable del tratamiento (art. 6 Ley 25.326).
 *
 * Son PLACEHOLDERS a propósito: no se inventan datos legales. El dueño los
 * completa antes de publicar; mientras sigan entre corchetes se pintan en
 * ámbar en la página (ver `Dato`) para que nadie los pase por alto.
 */
export const RESPONSABLE = {
  razonSocial: '[RAZÓN SOCIAL]',
  cuit: '[CUIT]',
  domicilio: '[DOMICILIO LEGAL, Córdoba, Argentina]',
} as const

/** `true` si el valor todavía es un placeholder sin completar. */
export function esPlaceholder(valor: string): boolean {
  return valor.startsWith('[') && valor.endsWith(']')
}

/**
 * Imprime un dato del responsable. Si todavía es placeholder lo resalta en
 * ámbar: es la señal visual de "esto falta cargar", tanto para el dueño que
 * revisa la página como para quien la lea antes de tiempo.
 */
export function Dato({ valor }: { valor: string }): ReactNode {
  if (!esPlaceholder(valor)) return valor
  return (
    <mark className="rounded bg-amber-100 px-1 font-semibold text-amber-900" title="Dato pendiente de completar">
      {valor}
    </mark>
  )
}

/** Link `mailto:` con asunto (y opcionalmente cuerpo) prellenados. */
export function mailto(asunto: string, cuerpo?: string): string {
  const params = new URLSearchParams({ subject: asunto })
  if (cuerpo) params.set('body', cuerpo)
  return `mailto:${MONACO.email}?${params.toString().replace(/\+/g, '%20')}`
}

/** Link a WhatsApp con el mensaje prellenado. */
export function whatsapp(mensaje: string): string {
  return `${MONACO.whatsappUrl}?text=${encodeURIComponent(mensaje)}`
}
