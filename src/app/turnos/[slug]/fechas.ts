/**
 * Formateo de fechas del turnero, en castellano y en MAYÚSCULA INICIAL.
 *
 * `toLocaleDateString('es-AR')` devuelve todo en minúscula ("miércoles, 6 de
 * agosto") y la clase `capitalize` de Tailwind arregla eso mal: sube la
 * primera letra de CADA palabra ("Miércoles, 6 De Agosto"). Se resuelve en el
 * dato, no en el CSS, así ninguna pantalla vuelve a caer en la trampa.
 */

/** Sólo la primera letra en mayúscula; el resto se respeta. */
export function capitalizar(texto: string): string {
  if (!texto) return texto
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

/** "Miércoles, 6 de agosto" */
export function fechaLarga(d: Date): string {
  return capitalizar(
    d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
  )
}

/** "Miércoles, 6 de agosto" a partir de un YYYY-MM-DD. */
export function fechaLargaDeStr(str: string): string {
  // Mediodía: `new Date('YYYY-MM-DD')` se parsea en UTC y en Argentina
  // devuelve el día anterior.
  return fechaLarga(new Date(`${str}T12:00:00`))
}

/** "Mié 6 ago" a partir de un YYYY-MM-DD, para chips angostos. */
export function fechaCortaDeStr(str: string): string {
  const texto = new Date(`${str}T12:00:00`)
    .toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })
    .replace(/[.,]/g, '')
  return capitalizar(texto)
}
