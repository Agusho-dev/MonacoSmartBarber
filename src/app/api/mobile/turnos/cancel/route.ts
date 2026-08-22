/**
 * POST /api/mobile/turnos/cancel   body `{ appointment_id }`
 *
 * Cancela un turno DEL cliente autenticado por el camino TypeScript completo
 * (`cancelAppointment(id, 'client')`): cancela los `scheduled_messages`
 * pendientes y la entrada de la fila, manda el template de cancelación y avisa
 * a la lista de espera. La RPC `cancel_appointment_by_token` que usaba la app
 * no hacía nada de eso. Ver CONTRACTS.md §1.2.
 */
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { RateLimits } from '@/lib/rate-limit'
import { isValidUUID } from '@/lib/validation'
import { cancelAppointment } from '@/lib/actions/appointments'
import { requireMobileClient, isMobileAuthError } from '@/lib/mobile/auth'
import {
  badRequest,
  jsonOk,
  jsonError,
  rateLimited,
  readJsonObject,
  withMobileHandler,
} from '@/lib/mobile/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = withMobileHandler('turnos/cancel', async (req: NextRequest) => {
  const auth = await requireMobileClient(req)
  if (isMobileAuthError(auth)) return auth

  const raw = await readJsonObject(req)
  const appointmentId = typeof raw?.appointment_id === 'string' ? raw.appointment_id.trim() : ''
  if (!isValidUUID(appointmentId)) return badRequest('appointment_id tiene que ser un UUID.')

  const gate = await RateLimits.mobileCancel(auth.userId)
  if (!gate.allowed) return rateLimited()

  // Pertenencia: el turno tiene que ser del cliente del JWT. Un id ajeno se
  // responde como inexistente (no se confirma que exista).
  const supabase = createAdminClient()
  const { data: appointment, error } = await supabase
    .from('appointments')
    .select('id, client_id')
    .eq('id', appointmentId)
    .maybeSingle()

  if (error) throw new Error(`turnos/cancel lookup: ${error.message}`)
  if (!appointment || appointment.client_id !== auth.client.id) {
    return jsonError(404, 'NOT_FOUND', 'No encontramos ese turno.')
  }

  const result = await cancelAppointment(appointmentId, 'client')

  if (result.error) {
    const msg = result.error
    if (msg.includes('ya fue cancelado o completado')) {
      return jsonError(409, 'ALREADY_CLOSED', msg)
    }
    if (msg.startsWith('No se puede cancelar con menos de')) {
      return jsonError(409, 'TOO_LATE_TO_CANCEL', msg)
    }
    if (msg === 'Turno no encontrado') {
      return jsonError(404, 'NOT_FOUND', 'No encontramos ese turno.')
    }
    console.error('[api/mobile] turnos/cancel:', msg)
    return jsonError(500, 'CANCEL_FAILED', 'No pudimos cancelar el turno. Probá de nuevo.')
  }

  return jsonOk({ ok: true })
})
