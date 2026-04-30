'use server'

/**
 * PIN configurable para acceso al kiosk de Check-in.
 *
 * Mismo patrón que `barber_session`: cookie httpOnly firmada que persiste
 * la validación del PIN. La cookie se setea cuando `validateCheckinPinForOrg`
 * matchea contra `organizations.checkin_pin_hash`.
 */

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'

const PinSchema = z
  .string()
  .trim()
  .regex(/^\d{4,8}$/, 'PIN debe ser 4–8 dígitos')

const COOKIE_NAME = 'checkin_session'
/** 12 horas — un turno completo de barbería. */
const COOKIE_MAX_AGE = 60 * 60 * 12

// ───────────────────────────────────────────────────────────────────────────
// Admin actions (dashboard / onboarding)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Setea o cambia el PIN de check-in de la org del usuario actual.
 * Pasar `null` o `''` lo elimina (acceso libre).
 */
export async function setCheckinPin(
  pin: string | null
): Promise<{ ok: true; cleared?: boolean } | { error: string }> {
  // Si vino vacío/null → limpiar
  if (pin === null || pin === '' || pin === undefined) {
    const supabase = createAdminClient()
    const { data, error } = await supabase.rpc('set_checkin_pin', { p_pin: null })
    if (error) {
      console.error('[setCheckinPin] clear error:', error.message)
      return { error: 'CLEAR_FAILED' }
    }
    const result = data as { success: boolean; cleared?: boolean; error?: string } | null
    if (!result?.success) return { error: result?.error ?? 'CLEAR_FAILED' }
    revalidatePath('/dashboard/configuracion')
    revalidatePath('/onboarding')
    return { ok: true, cleared: true }
  }

  const parsed = PinSchema.safeParse(pin)
  if (!parsed.success) return { error: 'PIN_LENGTH_INVALID' }

  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'UNAUTHORIZED' }

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('set_checkin_pin', { p_pin: parsed.data })
  if (error) {
    console.error('[setCheckinPin] rpc error:', error.message)
    return { error: 'RPC_FAILED' }
  }
  const result = data as { success: boolean; error?: string } | null
  if (!result?.success) return { error: result?.error ?? 'RPC_FAILED' }

  revalidatePath('/dashboard/configuracion')
  revalidatePath('/onboarding')
  return { ok: true }
}

/**
 * Devuelve si la org del usuario actual tiene PIN configurado.
 * Útil para el dashboard al renderizar el card de configuración.
 */
export async function getCheckinPinStatus(): Promise<{ hasPin: boolean }> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { hasPin: false }

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('organizations')
    .select('checkin_pin_hash')
    .eq('id', orgId)
    .maybeSingle()

  return { hasPin: !!data?.checkin_pin_hash }
}

// ───────────────────────────────────────────────────────────────────────────
// Public actions (kiosk gate)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Valida el PIN para una org dada por slug y, si es correcto, setea cookie
 * `checkin_session` httpOnly. Si la org no tiene PIN configurado, devuelve
 * éxito y setea la cookie igual (acceso libre = sesión válida sin PIN).
 */
export async function validateCheckinPinForOrg(
  orgSlug: string,
  pin: string
): Promise<{ ok: true; noPinRequired?: boolean } | { error: string }> {
  if (!orgSlug || typeof orgSlug !== 'string') return { error: 'INVALID_INPUT' }

  // Permitir pin vacío sólo si la org no tiene PIN (lo valida el RPC)
  const safePin = typeof pin === 'string' ? pin : ''

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('validate_checkin_pin', {
    p_org_slug: orgSlug,
    p_pin: safePin,
  })

  if (error) {
    console.error('[validateCheckinPinForOrg] rpc error:', error.message)
    return { error: 'RPC_FAILED' }
  }

  const result = data as {
    success: boolean
    org_id?: string
    no_pin_required?: boolean
    error?: string
  } | null

  if (!result?.success) {
    return { error: result?.error ?? 'INVALID_PIN' }
  }

  // Setear cookie de sesión kiosk
  const cookieStore = await cookies()
  const session = JSON.stringify({
    org_slug: orgSlug,
    org_id: result.org_id,
    issued_at: Date.now(),
  })

  cookieStore.set(COOKIE_NAME, session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  })

  return { ok: true, noPinRequired: result.no_pin_required }
}

/**
 * Lee la cookie de sesión kiosk. Devuelve null si no existe / inválida.
 */
export async function getCheckinSession(): Promise<{
  orgSlug: string
  orgId: string
  issuedAt: number
} | null> {
  const cookieStore = await cookies()
  const cookie = cookieStore.get(COOKIE_NAME)
  if (!cookie) return null
  try {
    const parsed = JSON.parse(cookie.value) as {
      org_slug?: string
      org_id?: string
      issued_at?: number
    }
    if (!parsed.org_slug || !parsed.org_id || !parsed.issued_at) return null
    return {
      orgSlug: parsed.org_slug,
      orgId: parsed.org_id,
      issuedAt: parsed.issued_at,
    }
  } catch {
    return null
  }
}

/**
 * Verifica si una org dada tiene la cookie válida y la org coincide.
 * Útil para el server component que decide si mostrar el PIN gate.
 */
export async function hasValidCheckinSessionForOrg(orgSlug: string): Promise<boolean> {
  const session = await getCheckinSession()
  if (!session) return false
  return session.orgSlug === orgSlug
}

/**
 * Cierra la sesión del kiosk (logout). Útil para "Cambiar barbería".
 */
export async function clearCheckinSession() {
  const cookieStore = await cookies()
  cookieStore.delete(COOKIE_NAME)
  return { ok: true }
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers públicos (sin auth)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Devuelve si una org dada por slug requiere PIN (sin exponer el hash).
 * Se llama desde el server component del kiosk para decidir el render.
 */
export async function orgRequiresCheckinPin(orgSlug: string): Promise<boolean> {
  if (!orgSlug) return false
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('has_checkin_pin', { p_org_slug: orgSlug })
  if (error) {
    console.error('[orgRequiresCheckinPin] rpc error:', error.message)
    return false
  }
  return data === true
}
