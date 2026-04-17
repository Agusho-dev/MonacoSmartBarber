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

function buildAppUrl(): string {
  const explicit =
    process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL
  if (explicit) return explicit.replace(/\/$/, '')

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

  const url = `${buildAppUrl()}/partners/auth/callback?token=${raw}`

  return { token: raw, url, expiresAt }
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
