'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { isValidUUID } from '@/lib/validation'
import { getLocalDateStr } from '@/lib/time-utils'
import { getBarberSession } from '@/lib/actions/auth'
import type { Appointment } from '@/lib/types/database'

// Barber panel usa PIN auth (no JWT), por lo que todas las llamadas usan createAdminClient()
// y el scope se valida por staffId + branchId del barber_session cookie.

/**
 * Valida el scope contra la COOKIE de sesión del barbero, no contra lo que
 * manda el componente cliente.
 *
 * Antes sólo se chequeaba que staffId y branchId pertenecieran a la misma
 * organización: cualquiera que llamara la server action con un par válido de
 * OTRA barbería podía marcar no-show o completar turnos ajenos. Los params se
 * siguen aceptando por compatibilidad de firma, pero la fuente de verdad es
 * la sesión.
 */
async function validateScope(staffId: string, branchId: string): Promise<boolean> {
  const session = await getBarberSession()
  if (!session) return false
  if (staffId && session.staff_id !== staffId) return false
  if (branchId && session.branch_id !== branchId) return false

  const supabase = createAdminClient()
  const { data: branch } = await supabase
    .from('branches')
    .select('organization_id')
    .eq('id', session.branch_id)
    .eq('is_active', true)
    .maybeSingle()

  return branch?.organization_id === session.organization_id
}

/**
 * Registra la llegada del cliente desde el panel del barbero.
 *
 * Sin esto un turno sólo podía arrancar desde la tablet del kiosko: si la
 * barbería no tiene tablet (o el cliente entra directo), el turno se quedaba
 * en `confirmed` para siempre, nunca generaba `queue_entry` y por lo tanto
 * nunca se podía cobrar. Delega en el RPC `check_in_appointment`, que es el
 * único lugar donde se crea la entrada de fila vinculada al turno.
 */
export async function checkInAppointmentFromPanel(
  appointmentId: string,
  staffId: string,
  branchId: string
): Promise<{ ok: true; queueEntryId: string } | { error: string }> {
  if (!isValidUUID(appointmentId)) return { error: 'ID inválido' }

  const valid = await validateScope(staffId, branchId)
  if (!valid) return { error: 'No autorizado' }

  const supabase = createAdminClient()

  const { data: appointment } = await supabase
    .from('appointments')
    .select('id, branch_id, barber_id, status')
    .eq('id', appointmentId)
    .eq('branch_id', branchId)
    .maybeSingle()

  if (!appointment) return { error: 'Turno no encontrado' }

  const { data, error } = await supabase.rpc('check_in_appointment', {
    p_appointment_id: appointmentId,
    // Turno "con cualquiera disponible": lo toma el barbero que registra la
    // llegada. Si ya tiene barbero asignado, el RPC ignora este parámetro.
    p_staff_id_assign: appointment.barber_id ?? staffId,
  })

  if (error) {
    console.error('[checkInAppointmentFromPanel] rpc:', error.message)
    return { error: 'No pudimos registrar la llegada. Reintentá.' }
  }

  const result = data as { success?: boolean; error?: string; queue_entry_id?: string } | null

  if (!result?.success) {
    const map: Record<string, string> = {
      NOT_FOUND: 'Turno no encontrado',
      INVALID_STATUS: 'Este turno ya no está pendiente',
      STAFF_REQUIRED: 'El turno no tiene barbero asignado',
      TOO_EARLY: 'Todavía falta más de una hora para el turno',
      TOO_LATE: 'Pasó la tolerancia del turno. Marcalo como ausente o reprogramalo.',
    }
    return { error: map[result?.error ?? ''] ?? 'No pudimos registrar la llegada' }
  }

  revalidatePath('/barbero/fila')
  revalidatePath('/dashboard/fila')
  revalidatePath('/dashboard/turnos/agenda')
  return { ok: true, queueEntryId: result.queue_entry_id! }
}

/**
 * Marca un turno como "en progreso" desde el panel del barbero.
 * Utiliza `startAppointmentService` internamente pero sin require auth de dashboard.
 */
export async function markAppointmentInProgress(
  appointmentId: string,
  staffId: string,
  branchId: string
): Promise<{ ok: true } | { error: string }> {
  if (!isValidUUID(appointmentId)) return { error: 'ID inválido' }

  const valid = await validateScope(staffId, branchId)
  if (!valid) return { error: 'No autorizado' }

  const supabase = createAdminClient()

  const { data: appointment } = await supabase
    .from('appointments')
    .select('id, branch_id, barber_id, queue_entry_id, status')
    .eq('id', appointmentId)
    .eq('branch_id', branchId)
    .maybeSingle()

  if (!appointment) return { error: 'Turno no encontrado' }
  if (!appointment.queue_entry_id) return { error: 'El turno todavía no fue chequeado. Verificá el check-in primero.' }
  if (appointment.status !== 'checked_in') return { error: 'El turno no está en espera' }

  const { error: qError } = await supabase
    .from('queue_entries')
    .update({ status: 'in_progress', started_at: new Date().toISOString() })
    .eq('id', appointment.queue_entry_id)
    .eq('status', 'waiting')

  if (qError) return { error: 'Error al iniciar el servicio' }

  const { error: aError } = await supabase
    .from('appointments')
    .update({ status: 'in_progress' })
    .eq('id', appointmentId)

  if (aError) return { error: 'Error al actualizar el turno' }

  revalidatePath('/barbero/fila')
  return { ok: true }
}

/**
 * Marca un turno como completado. El cobro real se hace via completeService()
 * en queue.ts a través del queue_entry_id asociado. Esta action solo sincroniza
 * el status de appointments.
 */
export async function markAppointmentCompleted(
  appointmentId: string,
  staffId: string,
  branchId: string
): Promise<{ ok: true } | { error: string }> {
  if (!isValidUUID(appointmentId)) return { error: 'ID inválido' }

  const valid = await validateScope(staffId, branchId)
  if (!valid) return { error: 'No autorizado' }

  const supabase = createAdminClient()

  const { data: appointment } = await supabase
    .from('appointments')
    .select('id, branch_id, status')
    .eq('id', appointmentId)
    .eq('branch_id', branchId)
    .maybeSingle()

  if (!appointment) return { error: 'Turno no encontrado' }
  if (appointment.status !== 'in_progress') return { error: 'El turno no está en progreso' }

  const { error } = await supabase
    .from('appointments')
    .update({ status: 'completed' })
    .eq('id', appointmentId)

  if (error) return { error: error.message }

  revalidatePath('/barbero/fila')
  revalidatePath('/dashboard/turnos/agenda')
  return { ok: true }
}

/**
 * Marca no-show desde el panel del barbero. Valida tolerancia y cancela mensajes pendientes.
 */
export async function markAppointmentNoShow(
  appointmentId: string,
  staffId: string,
  branchId: string
): Promise<{ ok: true } | { error: string }> {
  if (!isValidUUID(appointmentId)) return { error: 'ID inválido' }

  const valid = await validateScope(staffId, branchId)
  if (!valid) return { error: 'No autorizado' }

  const supabase = createAdminClient()

  const { data: appointment } = await supabase
    .from('appointments')
    .select('id, branch_id, status, appointment_date, start_time, queue_entry_id')
    .eq('id', appointmentId)
    .eq('branch_id', branchId)
    .maybeSingle()

  if (!appointment) return { error: 'Turno no encontrado' }
  if (!['confirmed', 'checked_in'].includes(appointment.status)) {
    return { error: 'El turno no puede marcarse como ausente en su estado actual' }
  }

  const { error } = await supabase
    .from('appointments')
    .update({
      status: 'no_show',
      no_show_marked_at: new Date().toISOString(),
      no_show_marked_by: staffId,
    })
    .eq('id', appointmentId)

  if (error) return { error: error.message }

  // Cancelar queue entry asociada si existe
  if (appointment.queue_entry_id) {
    const { error: qError } = await supabase
      .from('queue_entries')
      .update({ status: 'cancelled' })
      .eq('id', appointment.queue_entry_id)
    if (qError) console.error('[markAppointmentNoShow] error cancelando queue_entry:', qError.message)
  }

  // Cancelar mensajes pendientes de este turno
  const { error: msgError } = await supabase
    .from('scheduled_messages')
    .update({ status: 'cancelled' })
    .eq('appointment_id', appointmentId)
    .eq('status', 'pending')
    .gte('scheduled_for', new Date().toISOString())
  if (msgError) console.error('[markAppointmentNoShow] error cancelando mensajes:', msgError.message)

  revalidatePath('/barbero/fila')
  revalidatePath('/dashboard/turnos/agenda')
  return { ok: true }
}

/**
 * Notifica al cliente que ya puede pasar (mensaje WhatsApp si hay canal configurado).
 * Silent no-op si no hay canal WA — nunca falla el flujo principal.
 */
export async function notifyClientArrival(
  appointmentId: string,
  staffId: string,
  branchId: string
): Promise<{ ok: true } | { error: string }> {
  if (!isValidUUID(appointmentId)) return { error: 'ID inválido' }

  const valid = await validateScope(staffId, branchId)
  if (!valid) return { error: 'No autorizado' }

  try {
    const supabase = createAdminClient()

    const { data: appointment } = await supabase
      .from('appointments')
      .select('*, client:client_id(name, phone), branch:branch_id(organization_id, name)')
      .eq('id', appointmentId)
      .eq('branch_id', branchId)
      .maybeSingle()

    if (!appointment) return { error: 'Turno no encontrado' }

    const clientPhone = (appointment.client as { phone?: string } | null)?.phone
    if (!clientPhone) return { ok: true } // Sin teléfono, no hay nada que hacer

    const orgId = (appointment.branch as { organization_id?: string } | null)?.organization_id
    if (!orgId) return { ok: true }

    // Buscar canal WhatsApp org-wide (nunca por branch_id para no excluir canales globales)
    const { data: channel } = await supabase
      .from('social_channels')
      .select('id')
      .eq('organization_id', orgId)
      .eq('platform', 'whatsapp')
      .is('branch_id', null)
      .eq('is_active', true)
      .maybeSingle()

    if (!channel) return { ok: true } // Sin canal, graceful no-op

    const branchName = (appointment.branch as { name?: string } | null)?.name ?? ''
    const clientName = (appointment.client as { name?: string } | null)?.name ?? 'Cliente'

    const { error: insertError } = await supabase.from('scheduled_messages').insert({
      organization_id: orgId,
      appointment_id: appointmentId,
      client_id: appointment.client_id,
      channel_id: channel.id,
      scheduled_for: new Date().toISOString(),
      phone: clientPhone,
      status: 'pending',
      content: `Hola ${clientName}, te avisamos que tu barbero está listo para atenderte en ${branchName}. ¡Ya podés pasar!`,
    })

    if (insertError) console.error('[notifyClientArrival] error insertando mensaje:', insertError.message)
  } catch (e) {
    console.error('[notifyClientArrival] error inesperado:', e)
  }

  return { ok: true }
}

/**
 * Retorna los turnos del día para un barbero específico, incluyendo relaciones.
 * Usada por el panel del barbero para render server-side o re-fetch client-side.
 */
export async function getTodayAppointmentsForStaff(
  staffId: string,
  branchId: string
): Promise<Appointment[]> {
  if (!isValidUUID(staffId) || !isValidUUID(branchId)) return []

  const valid = await validateScope(staffId, branchId)
  if (!valid) return []

  const supabase = createAdminClient()

  // Fecha en la TZ de la sucursal. Con toISOString() (UTC) el panel perdía los
  // turnos de la tarde a partir de las 21:00 hora local: pedía los de mañana.
  const { data: branch } = await supabase
    .from('branches')
    .select('timezone')
    .eq('id', branchId)
    .maybeSingle()
  const today = getLocalDateStr(branch?.timezone || undefined)

  const { data } = await supabase
    .from('appointments')
    .select('*, client:client_id(id, name, phone), service:service_id(id, name, price, duration_minutes)')
    .eq('barber_id', staffId)
    .eq('branch_id', branchId)
    .eq('appointment_date', today)
    .not('status', 'in', '("cancelled")')
    .order('start_time')

  return (data ?? []) as Appointment[]
}
