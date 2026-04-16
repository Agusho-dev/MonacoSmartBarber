import { cookies } from 'next/headers'
import { createHash, randomBytes } from 'crypto'
import { createAdminClient } from '@/lib/supabase/server'
import type { CommercialPartner } from '@/lib/types/database'

export const PARTNER_COOKIE = 'partner_session'
const SESSION_TTL_DAYS = 30

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function generateRawToken(): string {
  return randomBytes(32).toString('hex')
}

export async function createPartnerSession(partnerId: string): Promise<string> {
  const supabase = createAdminClient()
  const raw = generateRawToken()
  const hash = hashToken(raw)
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000)

  await supabase.from('partner_sessions').insert({
    partner_id: partnerId,
    session_token_hash: hash,
    expires_at: expiresAt.toISOString(),
  })

  const cookieStore = await cookies()
  cookieStore.set(PARTNER_COOKIE, raw, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  })

  return raw
}

export async function getCurrentPartner(): Promise<CommercialPartner | null> {
  const cookieStore = await cookies()
  const raw = cookieStore.get(PARTNER_COOKIE)?.value
  if (!raw) return null

  const supabase = createAdminClient()
  const hash = hashToken(raw)
  const now = new Date().toISOString()

  const { data: session } = await supabase
    .from('partner_sessions')
    .select('id, partner_id, expires_at')
    .eq('session_token_hash', hash)
    .gt('expires_at', now)
    .maybeSingle()

  if (!session) return null

  // Refrescar last_used_at en background (fire-and-forget)
  void supabase
    .from('partner_sessions')
    .update({ last_used_at: now })
    .eq('id', session.id)
    .then(() => {})

  const { data: partner } = await supabase
    .from('commercial_partners')
    .select('*')
    .eq('id', session.partner_id)
    .maybeSingle()

  return partner
}

export async function destroyPartnerSession(): Promise<void> {
  const cookieStore = await cookies()
  const raw = cookieStore.get(PARTNER_COOKIE)?.value
  cookieStore.delete(PARTNER_COOKIE)

  if (!raw) return
  const supabase = createAdminClient()
  await supabase
    .from('partner_sessions')
    .delete()
    .eq('session_token_hash', hashToken(raw))
}

export function hashTokenForStorage(token: string): string {
  return hashToken(token)
}
