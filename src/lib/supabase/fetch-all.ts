const PAGE_SIZE = 1000

/**
 * Pagina automáticamente queries de Supabase para superar el límite de 1000 filas de PostgREST.
 * Pide de a 1000 filas y concatena hasta que no haya más.
 */
export async function fetchAll<T>(
  queryFn: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>
): Promise<T[]> {
  const all: T[] = []
  let from = 0
  while (true) {
    const { data } = await queryFn(from, from + PAGE_SIZE - 1)
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
}
