// =============================================================================
// src/lib/tex/costo.ts
// Cuánto cuesta cada pedido a Claude Haiku 5.5, calculado AL GUARDAR el turno.
//
// Haiku 5.5 tiene dos tarifas y la elige el tamaño del prompt de CADA pedido
// (entrada sin caché + caché leída + caché escrita):
//   hasta 100K tokens   entrada $0,10 · salida $0,50 por millón (TEX_PRECIO_USD_MTOK)
//   más de 100K tokens  entrada $0,50 · salida $2,50 por millón
// y la caché va atada a la entrada de esa tarifa: leída 0,1× y escrita (5 min)
// 1,25×. O sea, por encima de 100K todo cuesta 5 veces más.
//
// Un turno de Tex son varios pedidos (uno por paso de herramientas, más el del
// título) y cada uno cae en su tarifa. Con los tokens del turno ya sumados no se
// puede saber cuál cruzó el umbral: por eso el costo se suma pedido a pedido y
// se guarda en `usage.costoUsd`, y "Uso del mes" suma esos costos.
//
// PURO: sin imports de runtime fuera del contrato (lo prueban los tests con node).
// =============================================================================

import { TEX_PRECIO_USD_MTOK, type TexUso } from './contrato'

/** Por encima de este prompt (por pedido) rige la tarifa larga. */
export const TEX_UMBRAL_PROMPT_LARGO = 100_000

/** La tarifa de un prompt de más de 100K tokens, en USD por millón de tokens. */
export const TEX_PRECIO_USD_MTOK_PROMPT_LARGO = {
  entrada: 0.5,
  salida: 2.5,
  cacheLeido: 0.05,
  cacheEscrito: 0.625,
} as const

/** El `usage` de un pedido tal como lo devuelve la API (o el snapshot de un stream cortado). */
export interface UsoDePedido {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

function tokens(n: number | null | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0
}

/** Redondeo a la milmillonésima de dólar: evita la basura de coma flotante al sumar muchos pedidos. */
export function redondearUsd(n: number): number {
  return Math.round(n * 1e9) / 1e9
}

/** El costo de UN pedido, con la tarifa que le corresponde por el tamaño de su prompt. */
export function costoDePedidoUsd(u: UsoDePedido | null | undefined): number {
  if (!u) return 0
  const entrada = tokens(u.input_tokens)
  const salida = tokens(u.output_tokens)
  const leido = tokens(u.cache_read_input_tokens)
  const escrito = tokens(u.cache_creation_input_tokens)
  const p = entrada + leido + escrito > TEX_UMBRAL_PROMPT_LARGO ? TEX_PRECIO_USD_MTOK_PROMPT_LARGO : TEX_PRECIO_USD_MTOK
  return redondearUsd((entrada * p.entrada + salida * p.salida + leido * p.cacheLeido + escrito * p.cacheEscrito) / 1_000_000)
}

/**
 * Respaldo para un turno guardado sin `costoUsd` (anterior a este cálculo): los tokens
 * del turno a la tarifa base. Puede quedarse corto si algún pedido pasó los 100K.
 */
export function costoEstimadoConTarifaBaseUsd(uso: Pick<TexUso, 'entrada' | 'salida' | 'cacheLeido' | 'cacheEscrito'>): number {
  const p = TEX_PRECIO_USD_MTOK
  return redondearUsd(
    (tokens(uso.entrada) * p.entrada + tokens(uso.salida) * p.salida + tokens(uso.cacheLeido) * p.cacheLeido + tokens(uso.cacheEscrito) * p.cacheEscrito) /
      1_000_000,
  )
}

/** Suma el `usage` de un pedido (tokens y su costo) al acumulado del turno. Muta `total`. */
export function sumarPedido(total: TexUso, u: UsoDePedido | null | undefined): void {
  if (!u) return
  total.entrada += tokens(u.input_tokens)
  total.salida += tokens(u.output_tokens)
  total.cacheLeido += tokens(u.cache_read_input_tokens)
  total.cacheEscrito += tokens(u.cache_creation_input_tokens)
  total.costoUsd = redondearUsd((total.costoUsd ?? 0) + costoDePedidoUsd(u))
}

/** Dos acumulados en uno (el turno más el título). */
export function sumarUsos(a: TexUso, b: TexUso): TexUso {
  return {
    entrada: a.entrada + b.entrada,
    salida: a.salida + b.salida,
    cacheLeido: a.cacheLeido + b.cacheLeido,
    cacheEscrito: a.cacheEscrito + b.cacheEscrito,
    costoUsd: redondearUsd((a.costoUsd ?? costoEstimadoConTarifaBaseUsd(a)) + (b.costoUsd ?? costoEstimadoConTarifaBaseUsd(b))),
  }
}

/** Un acumulado vacío. */
export function usoVacio(): TexUso {
  return { entrada: 0, salida: 0, cacheLeido: 0, cacheEscrito: 0, costoUsd: 0 }
}
