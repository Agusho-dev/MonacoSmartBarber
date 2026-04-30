// Helper para enviar notificaciones push via Expo Push API.
// Maneja desactivación automática de tokens inválidos (DeviceNotRegistered).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { ExpoPushMessage, ExpoPushTicket } from './types.ts'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

/**
 * Envía una notificación push a un token Expo. Devuelve {success, error}.
 * Si el token es DeviceNotRegistered, lo desactiva en client_device_tokens.
 */
export async function sendExpoPush(
  token: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {}
): Promise<{ success: boolean; error: string | null }> {
  const message: ExpoPushMessage = {
    to: token,
    title,
    body,
    data,
    sound: 'default',
  }

  let responseBody: { data?: ExpoPushTicket[] } | null = null

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([message]),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!res.ok) {
      return { success: false, error: `Expo API HTTP ${res.status}` }
    }

    responseBody = await res.json()
  } catch (e: unknown) {
    const err = e as Error
    const errorMsg =
      err.name === 'AbortError'
        ? 'Timeout Expo Push API (10s)'
        : `Conexión con Expo: ${err.message}`
    return { success: false, error: errorMsg }
  }

  const ticket = responseBody?.data?.[0]
  if (!ticket) return { success: false, error: 'Respuesta vacía Expo Push API' }

  if (ticket.status === 'error') {
    const errorCode = ticket.details?.error

    if (errorCode === 'DeviceNotRegistered') {
      console.error(`[push-reminders] Token inválido, desactivando: ${token.slice(0, 20)}…`)
      const { error: deactivateErr } = await supabase
        .from('client_device_tokens')
        .update({ is_active: false })
        .eq('token', token)

      if (deactivateErr) {
        console.error('[push-reminders] Error desactivando token:', deactivateErr.message)
      }
      return { success: false, error: 'DeviceNotRegistered' }
    }

    return { success: false, error: ticket.message ?? `Expo error ${errorCode}` }
  }

  return { success: true, error: null }
}
