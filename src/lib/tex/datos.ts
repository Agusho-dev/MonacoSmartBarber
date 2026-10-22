import 'server-only'

// =============================================================================
// src/lib/tex/datos.ts
// Lecturas comunes de las herramientas de Tex y del "pulso del día".
//
// Regla de toda lectura de acá: si falla, TIRA. Nada de devolver lo que se
// juntó hasta el error (`fetchAll` de `src/lib/supabase/fetch-all.ts` corta el
// paginado y devuelve lo parcial: para un tablero de plata eso es el Known
// Risk #15, un número chico que parece cierto). Quien llama atrapa y muestra
// "no pude leer", nunca un cero.
// =============================================================================

import { createAdminClient } from '@/lib/supabase/server'
import { getDayBounds } from '@/lib/time-utils'
import { esErrorSucursal, type SucursalElegida } from './sucursales'
import type { TexContexto, TexResultado } from './herramientas/tipos'

const PAGINA = 1000

type RespuestaPagina<T> = { data: T[] | null; error: { message: string } | null }

/**
 * Pagina con `.range()` de a 1000 (el `max-rows` de PostgREST corta ahí sin
 * avisar) hasta que no haya más. La consulta tiene que tener un `.order()`
 * estable o las páginas se pisan. Tope de filas para no traer una tabla entera
 * por un error de filtro.
 */
export async function leerTodas<T>(
  consulta: (desde: number, hasta: number) => PromiseLike<RespuestaPagina<T>>,
  opciones: { maxFilas?: number; contexto?: string } = {},
): Promise<T[]> {
  const maxFilas = opciones.maxFilas ?? 50_000
  const filas: T[] = []
  for (let desde = 0; desde < maxFilas; desde += PAGINA) {
    const { data, error } = await consulta(desde, desde + PAGINA - 1)
    if (error) throw new Error(`[tex] ${opciones.contexto ?? 'lectura'}: ${error.message}`)
    const pagina = data ?? []
    filas.push(...pagina)
    if (pagina.length < PAGINA) return filas
  }
  throw new Error(`[tex] ${opciones.contexto ?? 'lectura'}: más de ${maxFilas} filas`)
}

/** Inicio y fin de un día de pared en Argentina, con offset: "2026-10-21T00:00:00-03:00". */
export function limitesDelDia(fecha: string): { desde: string; hasta: string } {
  const { start, end } = getDayBounds(fecha)
  return { desde: start, hasta: end }
}

/** Las sucursales a leer: la elegida o todas las del alcance. */
export function idsDeSucursales(ctx: TexContexto, elegida: SucursalElegida): string[] {
  if (elegida && !esErrorSucursal(elegida)) return [elegida.id]
  return ctx.sucursalesIds
}

/** "Paraná" · "Todas las sucursales" · "Tus 2 sucursales" (para la fuente de cada cifra). */
export function textoAlcance(ctx: TexContexto, elegida: SucursalElegida): string {
  if (elegida && !esErrorSucursal(elegida)) return elegida.nombre
  if (ctx.sucursales.length === 1) return ctx.sucursales[0].nombre
  if (ctx.todasLasSucursales === false) return `Tus ${ctx.sucursales.length} sucursales`
  return 'Todas las sucursales'
}

/** La respuesta a "Rondeau" que no matchea (o matchea varias): el modelo repregunta. */
export function sucursalNoResuelta(e: { mensaje: string; disponibles: string[] }): TexResultado {
  return {
    paraModelo: { error: 'sucursal_no_resuelta', mensaje: e.mensaje, disponibles: e.disponibles },
    paraUI: { bloques: [{ tipo: 'aviso', tono: 'info', texto: e.mensaje }] },
  }
}

/** Un corte es una visita atada a un servicio o a la fila (Known Risk #31: una sola definición). */
export function esCorte(v: { service_id?: string | null; queue_entry_id?: string | null }): boolean {
  return Boolean(v.service_id || v.queue_entry_id)
}

export interface TotalesDia {
  ingresos: number
  cortes: number
  visitas: number
}

/**
 * Cortes e ingresos de un tramo, en las sucursales dadas. Ingresos = todo lo
 * cobrado (servicios + productos), como "Ingresos" de Estadísticas y Finanzas;
 * cortes = `esCorte`. Tira si no pudo leer.
 */
export async function totalesDeVisitas(sucursalesIds: string[], desde: string, hasta: string): Promise<TotalesDia> {
  if (sucursalesIds.length === 0) return { ingresos: 0, cortes: 0, visitas: 0 }
  const supabase = createAdminClient()
  const filas = await leerTodas<{ amount: number | string | null; service_id: string | null; queue_entry_id: string | null }>(
    (a, b) =>
      supabase
        .from('visits')
        .select('id, amount, service_id, queue_entry_id')
        .in('branch_id', sucursalesIds)
        .gte('completed_at', desde)
        .lte('completed_at', hasta)
        .order('completed_at', { ascending: true })
        .order('id', { ascending: true })
        .range(a, b),
    { contexto: 'visitas del tramo' },
  )
  let ingresos = 0
  let cortes = 0
  for (const v of filas) {
    ingresos += Number(v.amount ?? 0)
    if (esCorte(v)) cortes++
  }
  return { ingresos, cortes, visitas: filas.length }
}
