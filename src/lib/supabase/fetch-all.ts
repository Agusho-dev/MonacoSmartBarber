const PAGE_SIZE = 1000

export interface OpcionesFetchAll {
  /**
   * true = ante un error de cualquier página TIRA, en vez de cortar y devolver lo
   * juntado. Es el modo de los números que se informan como ciertos (Tex, Known
   * Risk #15): un parcial de 1.000 visitas presentado como el total es peor que
   * un "no pude leer".
   */
  estricto?: boolean
  /** Para el log y el mensaje del error: "visitas", "gastos variables". */
  contexto?: string
}

/**
 * Pagina automáticamente queries de Supabase para superar el límite de 1000 filas de PostgREST.
 * Pide de a 1000 filas y concatena hasta que no haya más. La consulta tiene que traer un
 * `.order()` ESTABLE (con desempate por una columna única, como `id`): sin orden, Postgres no
 * garantiza que dos páginas no se pisen o se salteen filas.
 *
 * Ante un error de la query, por defecto lo LOGUEA y corta el paginado. Antes se lo tragaba en
 * silencio, y así un `order('created_at')` sobre una tabla sin esa columna hizo que el balance de
 * todas las cuentas mostrara $0 durante meses sin ninguna alarma (mig 160). Un $0 silencioso en una
 * pantalla de plata siempre tiene que dejar rastro. Con `{ estricto: true }`, TIRA.
 */
export async function fetchAll<T>(
  queryFn: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  opciones: OpcionesFetchAll = {},
): Promise<T[]> {
  const all: T[] = []
  let from = 0
  while (true) {
    const { data, error } = await queryFn(from, from + PAGE_SIZE - 1)
    if (error) {
      const msg = error instanceof Error ? error.message : leerMensaje(error)
      const contexto = opciones.contexto ?? 'consulta'
      if (opciones.estricto) throw new Error(`[fetchAll] ${contexto}: ${msg}`)
      console.error(`[fetchAll] ${contexto}: falló, corto el paginado:`, msg)
      break
    }
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
}

/** El `message` de un error de PostgREST ({message, code, details}) o el objeto entero. */
function leerMensaje(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof (error as { message: unknown }).message === 'string') {
    return (error as { message: string }).message
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}
