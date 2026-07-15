const PAGE_SIZE = 1000

/**
 * Pagina automáticamente queries de Supabase para superar el límite de 1000 filas de PostgREST.
 * Pide de a 1000 filas y concatena hasta que no haya más.
 *
 * Ante un error de la query lo LOGUEA y corta el paginado. Antes se lo tragaba en silencio,
 * y así un `order('created_at')` sobre una tabla sin esa columna hizo que el balance de todas
 * las cuentas mostrara $0 durante meses sin ninguna alarma (mig 160). Un $0 silencioso en una
 * pantalla de plata siempre tiene que dejar rastro.
 */
export async function fetchAll<T>(
  queryFn: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const all: T[] = []
  let from = 0
  while (true) {
    const { data, error } = await queryFn(from, from + PAGE_SIZE - 1)
    if (error) {
      const msg = error instanceof Error ? error.message : JSON.stringify(error)
      console.error('[fetchAll] query falló, corto el paginado:', msg)
      break
    }
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
}
