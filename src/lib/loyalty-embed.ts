/**
 * `client_loyalty_state` tiene UNIQUE (client_id): PostgREST la embebe como un
 * OBJETO (relación 1:1), no como una lista. El código leía `loyalty?.[0]` y daba
 * SIEMPRE undefined: el chip "Primer Corte" salía para todos los clientes y el de
 * categoría nunca. Esto acepta las dos formas, por si algún select la trae como lista.
 */
export interface LoyaltyEmbed {
  total_visits: number
  tier_code?: string | null
  visits_in_window?: number | null
}

export function leerLoyaltyEmbed(
  l: LoyaltyEmbed | LoyaltyEmbed[] | null | undefined,
): LoyaltyEmbed | null {
  if (!l) return null
  return Array.isArray(l) ? (l[0] ?? null) : l
}
