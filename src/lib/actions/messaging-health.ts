'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from './org'

const META_API_VERSION = 'v22.0'

export interface PlatformTokenHealth {
  configured: boolean
  valid: boolean
  /** Mensaje de error de Meta si el token es inválido (ej: "Session has expired"). */
  error: string | null
  /** true si el error es específicamente un token vencido/ inválido (code 190). */
  expired: boolean
}

export interface MetaTokenHealth {
  instagram: PlatformTokenHealth
  whatsapp: PlatformTokenHealth
}

const UNCONFIGURED: PlatformTokenHealth = { configured: false, valid: true, error: null, expired: false }

async function probe(url: string): Promise<PlatformTokenHealth> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (res.ok) return { configured: true, valid: true, error: null, expired: false }
    let code: number | null = null
    let message = `HTTP ${res.status}`
    try {
      const data = await res.json()
      code = data?.error?.code ?? null
      message = data?.error?.message ?? message
    } catch { /* noop */ }
    // 190 = token vencido/invalidado; 102 = sesión inválida.
    const expired = code === 190 || code === 102
    return { configured: true, valid: false, error: message.slice(0, 300), expired }
  } catch (e) {
    // Error de red: no afirmamos que el token esté mal (evitar falsos positivos).
    return { configured: true, valid: true, error: `No se pudo verificar: ${(e as Error).message}`, expired: false }
  }
}

/**
 * Verifica que los tokens de Meta (Instagram / WhatsApp) sigan vigentes.
 * Se llama desde el cliente al abrir Mensajería para mostrar un banner si hay
 * que reconectar — los tokens long-lived de Meta vencen a los ~60 días y, sin
 * esto, el envío y la sincronización de perfiles se rompen EN SILENCIO.
 */
export async function checkMetaTokenHealth(): Promise<MetaTokenHealth> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { instagram: UNCONFIGURED, whatsapp: UNCONFIGURED }

  const supabase = createAdminClient()
  const [{ data: ig }, { data: wa }] = await Promise.all([
    supabase.from('organization_instagram_config')
      .select('instagram_page_access_token, is_active').eq('organization_id', orgId).maybeSingle(),
    supabase.from('organization_whatsapp_config')
      .select('whatsapp_access_token, whatsapp_phone_id, is_active').eq('organization_id', orgId).maybeSingle(),
  ])

  const [instagram, whatsapp] = await Promise.all([
    (ig?.is_active && ig?.instagram_page_access_token)
      ? probe(`https://graph.instagram.com/${META_API_VERSION}/me?fields=id&access_token=${encodeURIComponent(ig.instagram_page_access_token)}`)
      : Promise.resolve(UNCONFIGURED),
    (wa?.is_active && wa?.whatsapp_access_token && wa?.whatsapp_phone_id)
      ? probe(`https://graph.facebook.com/${META_API_VERSION}/${wa.whatsapp_phone_id}?fields=id&access_token=${encodeURIComponent(wa.whatsapp_access_token)}`)
      : Promise.resolve(UNCONFIGURED),
  ])

  return { instagram, whatsapp }
}
