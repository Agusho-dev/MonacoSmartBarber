/**
 * POST   /api/mobile/push/token  `{ token, platform, device_id, app_version? }`
 * DELETE /api/mobile/push/token  `{ device_id }`
 *
 * Registro y baja del token FCM del dispositivo en `client_device_tokens`.
 * Upsert por `(client_id, device_id)`; la baja es lógica (`is_active=false`).
 * Ver CONTRACTS.md §1.2.
 */
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { RateLimits } from '@/lib/rate-limit'
import { requireMobileClient, isMobileAuthError } from '@/lib/mobile/auth'
import {
  badRequest,
  jsonOk,
  jsonError,
  optionalString,
  rateLimited,
  readJsonObject,
  withMobileHandler,
} from '@/lib/mobile/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const PLATFORMS = ['ios', 'android'] as const
type Platform = (typeof PLATFORMS)[number]

const TOKEN_MAX = 4096
const DEVICE_ID_MAX = 200
const APP_VERSION_MAX = 50

/** Columna que PostgREST no conoce (mig 193 sin aplicar) o que Postgres no tiene. */
function esColumnaAusente(code: string | undefined): boolean {
  return code === 'PGRST204' || code === '42703'
}

export const POST = withMobileHandler('push/token', async (req: NextRequest) => {
  const auth = await requireMobileClient(req)
  if (isMobileAuthError(auth)) return auth

  const raw = await readJsonObject(req)
  if (!raw) return badRequest('El body tiene que ser un objeto JSON.')

  const token = optionalString(raw.token, TOKEN_MAX + 1)
  const deviceId = optionalString(raw.device_id, DEVICE_ID_MAX + 1)
  const platform = raw.platform
  const appVersion = optionalString(raw.app_version, APP_VERSION_MAX)

  if (!token || token.length > TOKEN_MAX) return badRequest('token es obligatorio.')
  if (!deviceId || deviceId.length > DEVICE_ID_MAX) return badRequest('device_id es obligatorio.')
  if (typeof platform !== 'string' || !PLATFORMS.includes(platform as Platform)) {
    return badRequest("platform tiene que ser 'ios' o 'android'.")
  }

  const gate = await RateLimits.mobileBootstrap(auth.userId)
  if (!gate.allowed) return rateLimited()

  const supabase = createAdminClient()
  const now = new Date().toISOString()

  // El UNIQUE (client_id, token) vivo en prod rompe el upsert por
  // (client_id, device_id) cuando el mismo token quedó registrado con otro
  // device_id (reinstalación que regeneró el id). Se borra esa fila primero.
  // `device_id` es NOT NULL desde la mig 193 (y la tabla nacía vacía), así que
  // el `neq` no deja filas NULL afuera.
  const { error: cleanupError } = await supabase
    .from('client_device_tokens')
    .delete()
    .eq('client_id', auth.client.id)
    .eq('token', token)
    .neq('device_id', deviceId)

  if (cleanupError) {
    console.error('[api/mobile] push/token cleanup:', cleanupError.message)
    return jsonError(500, 'INTERNAL', 'No pudimos registrar el dispositivo. Probá de nuevo.')
  }

  const base = {
    client_id: auth.client.id,
    token,
    platform: platform as Platform,
    device_id: deviceId,
    is_active: true,
    updated_at: now,
  }

  let { error } = await supabase
    .from('client_device_tokens')
    .upsert(
      { ...base, provider: 'fcm', last_seen_at: now, app_version: appVersion ?? null },
      { onConflict: 'client_id,device_id' }
    )

  // Si el dashboard se deployó antes de aplicar la mig 193, las columnas
  // nuevas no existen todavía: se guarda con el formato legacy en vez de dejar
  // al cliente sin push hasta que alguien se dé cuenta.
  if (error && esColumnaAusente(error.code)) {
    console.warn('[api/mobile] push/token: columnas de la mig 193 ausentes, guardando formato legacy')
    ;({ error } = await supabase
      .from('client_device_tokens')
      .upsert(base, { onConflict: 'client_id,device_id' }))
  }

  if (error) {
    if (error.code === '23505') {
      return jsonError(
        409,
        'TOKEN_CONFLICT',
        'Ese token ya está registrado en otro dispositivo. Probá de nuevo.'
      )
    }
    console.error('[api/mobile] push/token upsert:', error.message)
    return jsonError(500, 'INTERNAL', 'No pudimos registrar el dispositivo. Probá de nuevo.')
  }

  return jsonOk({ ok: true })
})

export const DELETE = withMobileHandler('push/token', async (req: NextRequest) => {
  const auth = await requireMobileClient(req)
  if (isMobileAuthError(auth)) return auth

  const raw = await readJsonObject(req)
  const deviceId = optionalString(raw?.device_id, DEVICE_ID_MAX + 1)
  if (!deviceId || deviceId.length > DEVICE_ID_MAX) return badRequest('device_id es obligatorio.')

  const gate = await RateLimits.mobileBootstrap(auth.userId)
  if (!gate.allowed) return rateLimited()

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('client_device_tokens')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('client_id', auth.client.id)
    .eq('device_id', deviceId)

  if (error) {
    console.error('[api/mobile] push/token DELETE:', error.message)
    return jsonError(500, 'INTERNAL', 'No pudimos dar de baja el dispositivo. Probá de nuevo.')
  }

  // Idempotente: si no había fila, igual está "dado de baja".
  return jsonOk({ ok: true })
})
