import 'server-only'

// =============================================================================
// src/lib/conciliacion-mp/paginar.ts
// Paginación que TIRA ante un error.
//
// PostgREST corta en 1000 filas sin avisar, así que toda lectura que pueda
// crecer va por páginas. Y acá no sirve `fetchAll` (src/lib/supabase/fetch-all.ts):
// ante un error loguea y devuelve lo que juntó, o sea un parcial EN SILENCIO.
// En un tablero de plata eso es exactamente el Known Risk #15 —"$0 y 100 %
// conciliado" sobre una lectura incompleta—, así que este paginador falla
// entero: o leyó todo, o el que llama se entera y lo muestra como error.
// =============================================================================

export const TAMANO_PAGINA = 1000

/** Por encima de esto algo está mal (un filtro que no filtró): mejor cortar que traer la base entera. */
const MAX_FILAS = 60_000

type Respuesta<T> = { data: T[] | null; error: { message: string } | null }

/**
 * Lee todas las páginas. `pedir(desde, hasta)` arma la consulta con
 * `.range(desde, hasta)` y un ORDEN TOTAL (sin orden estable, dos páginas
 * pueden repetir o saltear filas).
 */
export async function paginarTodo<T>(
  pedir: (desde: number, hasta: number) => PromiseLike<Respuesta<T>>,
  contexto: string,
  opciones: { tamano?: number; maxFilas?: number } = {},
): Promise<T[]> {
  const tamano = opciones.tamano ?? TAMANO_PAGINA
  const maxFilas = opciones.maxFilas ?? MAX_FILAS
  const filas: T[] = []
  for (let desde = 0; ; desde += tamano) {
    const { data, error } = await pedir(desde, desde + tamano - 1)
    if (error) throw new Error(`No pudimos leer ${contexto}: ${error.message}`)
    const pagina = data ?? []
    filas.push(...pagina)
    if (pagina.length < tamano) return filas
    if (filas.length >= maxFilas) {
      throw new Error(`No pudimos leer ${contexto}: hay más de ${maxFilas} filas para el período pedido.`)
    }
  }
}

/** Parte una lista en lotes (para `.in()` sin URLs gigantes). */
export function enLotes<T>(items: T[], tamano: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += tamano) out.push(items.slice(i, i + tamano))
  return out
}

/** Corre `f` sobre cada elemento con a lo sumo `limite` en vuelo. Si una falla, falla todo. */
export async function conConcurrencia<T, R>(items: T[], limite: number, f: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let siguiente = 0
  const trabajador = async () => {
    while (siguiente < items.length) {
      const i = siguiente++
      out[i] = await f(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, trabajador))
  return out
}
