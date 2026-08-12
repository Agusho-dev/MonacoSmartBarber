/**
 * Qué FORMA tiene un template de WhatsApp.
 *
 * Meta rechaza el envío entero —132000, "number of parameters does not
 * match"— si le mandamos una variable de más o de menos, y los templates los
 * edita el dueño en Business Manager. O sea: la cantidad de variables de un
 * template es un dato a LEER, no a asumir. Estas funciones lo leen de los
 * `components` que el sync ya guarda en `message_templates`.
 *
 * Vive fuera de `src/lib/actions/` porque los consumen dos archivos
 * `'use server'`, donde sólo se pueden exportar funciones async.
 */

export interface MetaComponent {
  type?: string
  text?: string
  buttons?: Array<{ type?: string; url?: string; text?: string }>
}

/** Mayor {{n}} que aparece en un texto. 0 si no tiene variables. */
export function contarVariables(texto: string): number {
  let max = 0
  for (const m of texto.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    const n = Number(m[1])
    if (n > max) max = n
  }
  return max
}

export function componentesDe(raw: unknown): MetaComponent[] {
  return Array.isArray(raw) ? (raw as MetaComponent[]) : []
}

/**
 * Variables declaradas en el BODY.
 *
 * Sin BODY legible devuelve 5, que es la forma de todos los `monaco_turno_*`
 * aprobados: es el default que menos rompe.
 */
export function variablesDelBody(componentes: MetaComponent[]): number {
  const body = componentes.find(c => (c.type ?? '').toUpperCase() === 'BODY')
  return body?.text ? contarVariables(body.text) : 5
}

/** Índice del botón URL con sufijo dinámico, o null si no tiene ninguno. */
export function indiceBotonUrl(componentes: MetaComponent[]): number | null {
  const botones = componentes.find(c => (c.type ?? '').toUpperCase() === 'BUTTONS')?.buttons ?? []
  const idx = botones.findIndex(
    b => (b.type ?? '').toUpperCase() === 'URL' && !!b.url && /\{\{\s*\d+\s*\}\}/.test(b.url)
  )
  return idx >= 0 ? idx : null
}

/**
 * ¿Este template puede llevar el link para cancelar el turno?
 *
 * Dos formas válidas: una sexta variable de body (viaja la URL completa, que
 * WhatsApp vuelve tocable sola) o un botón URL con sufijo dinámico (viaja sólo
 * el token). Cualquiera de las dos alcanza.
 */
export function llevaLinkDeGestion(raw: unknown): boolean {
  const componentes = componentesDe(raw)
  return variablesDelBody(componentes) >= 6 || indiceBotonUrl(componentes) !== null
}
