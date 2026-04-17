/**
 * Helpers i18n de org. Retornan FormatOptions listos para pasar a src/lib/format.ts y time-utils.ts.
 * Evitan hacer query a organizations en cada render: usá estos helpers en server components
 * que ya tienen org en contexto, o usá el hook en client components.
 */

import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import type { FormatOptions } from '@/lib/format'

export interface OrgLocaleContext {
  locale: string
  currency: string
  timezone: string
  country_code: string
  primary_color: string
}

const FALLBACK: OrgLocaleContext = {
  locale: 'es-AR',
  currency: 'ARS',
  timezone: 'America/Argentina/Buenos_Aires',
  country_code: 'AR',
  primary_color: '#3f3f46',
}

/**
 * Obtiene el contexto i18n de la org activa. Cacheado por request.
 * Seguro para server components.
 */
export const getOrgLocaleContext = cache(async function getOrgLocaleContext(): Promise<OrgLocaleContext> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return FALLBACK

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('organizations')
    .select('locale, currency, timezone, country_code, primary_color')
    .eq('id', orgId)
    .maybeSingle()

  if (!data) return FALLBACK
  return {
    locale: data.locale ?? FALLBACK.locale,
    currency: data.currency ?? FALLBACK.currency,
    timezone: data.timezone ?? FALLBACK.timezone,
    country_code: data.country_code ?? FALLBACK.country_code,
    primary_color: data.primary_color ?? FALLBACK.primary_color,
  }
})

/** Convierte OrgLocaleContext en FormatOptions para los formatters. */
export function toFormatOptions(ctx: OrgLocaleContext): FormatOptions {
  return { locale: ctx.locale, currency: ctx.currency, timezone: ctx.timezone }
}

/** Shortcut para obtener el timezone de la org activa (cacheado). */
export async function getActiveTimezone(): Promise<string> {
  const ctx = await getOrgLocaleContext()
  return ctx.timezone
}

/** Shortcut para obtener locale de la org activa. */
export async function getActiveLocale(): Promise<string> {
  const ctx = await getOrgLocaleContext()
  return ctx.locale
}
