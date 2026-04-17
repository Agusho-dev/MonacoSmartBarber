import { headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { generateRawToken, hashTokenForStorage } from './session'
import type { PartnerMagicLinkPurpose } from '@/lib/types/database'

const INVITATION_TTL_HOURS = 72
const LOGIN_TTL_MINUTES = 15

export interface MagicLinkResult {
  token: string
  url: string
  expiresAt: string
}

/**
 * Resuelve el origin de la app. Prioridad:
 * 1. Env explícito (NEXT_PUBLIC_APP_URL / NEXT_PUBLIC_SITE_URL) — para custom domain
 * 2. Headers del request (x-forwarded-host + x-forwarded-proto) — funciona en cualquier deploy
 * 3. VERCEL env vars — fallback si no hay request context
 * 4. localhost — solo desarrollo
 */
async function buildAppUrl(): Promise<string> {
  const explicit =
    process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL
  if (explicit) return explicit.replace(/\/$/, '')

  try {
    const h = await headers()
    const host = h.get('x-forwarded-host') || h.get('host')
    const proto = h.get('x-forwarded-proto') || 'https'
    if (host) return `${proto}://${host}`
  } catch {
    // No request context (cron, background jobs) — caer a Vercel env
  }

  const vercelHost =
    process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL
  if (vercelHost) return `https://${vercelHost}`

  return 'http://localhost:3000'
}

export async function generatePartnerMagicLink(
  partnerId: string,
  purpose: PartnerMagicLinkPurpose
): Promise<MagicLinkResult> {
  const supabase = createAdminClient()
  const raw = generateRawToken()
  const hash = hashTokenForStorage(raw)

  const ttlMs =
    purpose === 'invitation'
      ? INVITATION_TTL_HOURS * 60 * 60 * 1000
      : LOGIN_TTL_MINUTES * 60 * 1000

  const expiresAt = new Date(Date.now() + ttlMs).toISOString()

  const { error } = await supabase.from('partner_magic_links').insert({
    partner_id: partnerId,
    token_hash: hash,
    purpose,
    expires_at: expiresAt,
  })

  if (error) throw new Error(error.message)

  const url = `${await buildAppUrl()}/partners/auth/callback?token=${raw}`

  return { token: raw, url, expiresAt }
}

/**
 * Valida el token sin consumirlo. Usar en GETs idempotentes (callback page)
 * para evitar que crawlers de previews de links (Meta, antivirus, Safe Browsing,
 * Chrome prerender, etc.) quemen el magic link antes que el usuario haga click.
 */
export async function validatePartnerMagicLink(
  token: string
): Promise<{ ok: true; partnerId: string } | { ok: false; error: string }> {
  if (!token || token.length < 32) return { ok: false, error: 'Link inválido.' }

  const supabase = createAdminClient()
  const hash = hashTokenForStorage(token)

  const { data: link } = await supabase
    .from('partner_magic_links')
    .select('partner_id, expires_at, used_at')
    .eq('token_hash', hash)
    .maybeSingle()

  if (!link) return { ok: false, error: 'Link inválido.' }
  if (link.used_at) return { ok: false, error: 'Este link ya fue utilizado.' }
  if (new Date(link.expires_at) < new Date())
    return { ok: false, error: 'El link expiró. Pedí uno nuevo.' }

  return { ok: true, partnerId: link.partner_id }
}

/** Consume el token si es válido. Devuelve partner_id si éxito. */
export async function consumePartnerMagicLink(
  token: string
): Promise<{ partnerId: string } | { error: string }> {
  if (!token || token.length < 32) return { error: 'Token inválido' }

  const supabase = createAdminClient()
  const hash = hashTokenForStorage(token)
  const now = new Date().toISOString()

  const { data: link } = await supabase
    .from('partner_magic_links')
    .select('id, partner_id, expires_at, used_at')
    .eq('token_hash', hash)
    .maybeSingle()

  if (!link) return { error: 'Link inválido o caducado' }
  if (link.used_at) return { error: 'Este link ya fue utilizado' }
  if (new Date(link.expires_at) < new Date())
    return { error: 'El link expiró. Pedí uno nuevo.' }

  await supabase
    .from('partner_magic_links')
    .update({ used_at: now })
    .eq('id', link.id)

  return { partnerId: link.partner_id }
}

/** Invalida cualquier link activo previo al generar uno nuevo. */
export async function invalidatePreviousMagicLinks(
  partnerId: string,
  purpose: PartnerMagicLinkPurpose
): Promise<void> {
  const supabase = createAdminClient()
  await supabase
    .from('partner_magic_links')
    .update({ used_at: new Date().toISOString() })
    .eq('partner_id', partnerId)
    .eq('purpose', purpose)
    .is('used_at', null)
}
