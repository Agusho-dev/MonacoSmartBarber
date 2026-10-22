// Formatos y colores de los bloques de Tex en pantalla. Los números, la paleta
// y el armado de los gráficos vienen de src/lib/tex/bloques-formato.ts, el
// mismo módulo que usa el PDF: el chat y el informe dicen lo mismo. Acá sólo
// se suma lo que es de la pantalla (clases de Tailwind por tono).
//
// El dashboard es SIEMPRE oscuro y `dark:` no funciona en esta app: los tonos
// van escritos para fondo oscuro (texto -300/-400, fondos /10, bordes /30).

import { filasDeKpis } from '@/lib/tex/bloques-formato'

export * from '@/lib/tex/bloques-formato'

export type TonoBloque = 'ok' | 'revisar' | 'desconocido' | 'error' | 'info'

/** Tarjeta por tono: borde, fondo, texto e ícono. */
export const CLASES_TONO: Record<TonoBloque, { caja: string; texto: string; icono: string }> = {
  ok: { caja: 'border-emerald-500/30 bg-emerald-500/10', texto: 'text-emerald-300', icono: 'text-emerald-400' },
  revisar: { caja: 'border-amber-500/30 bg-amber-500/10', texto: 'text-amber-200', icono: 'text-amber-300' },
  desconocido: { caja: 'border-white/10 bg-white/[0.04]', texto: 'text-zinc-300', icono: 'text-zinc-400' },
  error: { caja: 'border-red-500/30 bg-red-500/10', texto: 'text-red-200', icono: 'text-red-400' },
  info: { caja: 'border-white/10 bg-white/[0.03]', texto: 'text-zinc-300', icono: 'text-zinc-400' },
}

/** Color del delta de un KPI según el tono que manda la herramienta (no se infiere si es un gasto). */
export const CLASE_DELTA = {
  sube: 'text-emerald-400',
  baja: 'text-red-400',
  neutro: 'text-zinc-400',
} as const

// Grilla de KPIs: 12 columnas y cada tarjeta ocupa 12 / (tarjetas de su
// fila), así todas las filas llenan el ancho (5 → 3 + 2 con las dos de abajo
// más anchas). Con container queries: se mide el ancho del bloque, no de la
// ventana (el panel lateral de 420 px en un monitor grande es "angosto").
//   angosto  hasta 2 por fila
//   @md      (≥ 448 px) hasta 3
//   @2xl     (≥ 672 px) hasta 4
// Las clases van escritas enteras: Tailwind las encuentra leyendo el código.
const SPAN_BASE: Record<number, string> = { 1: 'col-span-12', 2: 'col-span-6' }
const SPAN_MD: Record<number, string> = { 1: '@md:col-span-12', 2: '@md:col-span-6', 3: '@md:col-span-4' }
const SPAN_2XL: Record<number, string> = { 1: '@2xl:col-span-12', 2: '@2xl:col-span-6', 3: '@2xl:col-span-4', 4: '@2xl:col-span-3' }

function tamanoDeFila(filas: number[], i: number): number {
  let acumulado = 0
  for (const f of filas) {
    acumulado += f
    if (i < acumulado) return f
  }
  return filas[filas.length - 1] ?? 1
}

/** Las clases de columna de la tarjeta `i` de `n`. */
export function claseColumnaKpi(i: number, n: number, compacto: boolean): string {
  const base = SPAN_BASE[tamanoDeFila(filasDeKpis(n, 2), i)]
  if (compacto) return base
  return [base, SPAN_MD[tamanoDeFila(filasDeKpis(n, 3), i)], SPAN_2XL[tamanoDeFila(filasDeKpis(n, 4), i)]].join(' ')
}

/**
 * Alto de cada fila de un ranking (barras horizontales) según cuántas series
 * lleva. Vive acá y no junto a recharts: la tarjeta calcula el alto antes de
 * que se baje el dibujo, y importarlo de allá arrastraría recharts al chat.
 */
export function altoFilaHorizontal(series: number): number {
  return series <= 1 ? 30 : 14 + series * 10
}
