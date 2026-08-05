'use server'

import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { isValidUUID } from '@/lib/validation'
import { RateLimits } from '@/lib/rate-limit'
import { getAvailableSlots, getAppointmentSettings, createAppointment } from '@/lib/actions/appointments'
import { getTzOffsetISO } from '@/lib/time-utils'
import type { BranchOperationMode } from '@/lib/actions/turnos-mode'

// ─── Schemas de validación ────────────────────────────────────────────────────

const PhoneSchema = z
  .string()
  .trim()
  .regex(/^\d{10}$/, 'El teléfono debe tener 10 dígitos')

const BranchIdSchema = z.string().uuid('branch_id inválido')

// ─── Tipos retornados ─────────────────────────────────────────────────────────

export interface AppointmentInfo {
  id: string
  starts_at: string
  ends_at: string
  barber_name: string | null
  barber_id: string | null
  barber_avatar_url: string | null
  services: string[]
  client_id: string | null
  client_name: string
  client_phone: string
  status: string
  /** Minutos de tolerancia configurados por la sucursal */
  no_show_tolerance_minutes: number
}

export interface LookupAppointmentResult {
  found: boolean
  appointment: AppointmentInfo | null
}

export interface AvailableSlot {
  starts_at: string
  ends_at: string
  barber_id: string
  barber_name: string
}

export interface KioskBranchInfo {
  id: string
  name: string
  organization_id: string
  operation_mode: BranchOperationMode
  checkin_bg_color: string | null
  organizations: { name: string; logo_url: string | null } | null
}

// ─── getKioskBranchInfo ───────────────────────────────────────────────────────

/**
 * Obtiene info básica de la sucursal incluyendo operation_mode.
 * Usado por el server component del kiosk para rutear el flujo correcto.
 */
export async function getKioskBranchInfo(
  branchId: string
): Promise<{ ok: true; data: KioskBranchInfo } | { error: string }> {
  const parsed = BranchIdSchema.safeParse(branchId)
  if (!parsed.success) return { error: 'branch_id inválido' }

  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('branches')
    .select('id, name, organization_id, operation_mode, checkin_bg_color, organizations(name, logo_url)')
    .eq('id', branchId)
    .eq('is_active', true)
    .maybeSingle()

  if (error || !data) return { error: 'Sucursal no encontrada o inactiva' }

  return {
    ok: true,
    data: {
      ...data,
      operation_mode: (data.operation_mode ?? 'walk_in') as BranchOperationMode,
      organizations: (Array.isArray(data.organizations) ? data.organizations[0] : data.organizations) as { name: string; logo_url: string | null } | null,
    },
  }
}

// ─── lookupAppointmentByPhone ─────────────────────────────────────────────────

/**
 * Busca si el cliente tiene un turno confirmado para hoy en la sucursal.
 * Llama al RPC `lookup_appointment_by_phone`.
 * Rate limit: bucket `kiosk_checkin` (20/60s por branch).
 */
export async function lookupAppointmentByPhone(
  branchId: string,
  phone: string
): Promise<{ ok: true; data: LookupAppointmentResult } | { error: string }> {
  const branchParsed = BranchIdSchema.safeParse(branchId)
  if (!branchParsed.success) return { error: 'branch_id inválido' }

  const phoneParsed = PhoneSchema.safeParse(phone)
  if (!phoneParsed.success) return { error: 'Teléfono inválido (10 dígitos)' }

  // Rate limit compartido con el check-in normal
  const gate = await RateLimits.kioskCheckin(branchId)
  if (!gate.allowed) {
    return { error: 'Demasiados intentos. Esperá un momento.' }
  }

  const supabase = createAdminClient()

  const { data, error } = await supabase.rpc('lookup_appointment_by_phone', {
    p_branch_id: branchId,
    p_phone: phoneParsed.data,
  })

  if (error) {
    console.error('[lookupAppointmentByPhone] RPC error:', error.message)
    return { error: 'Error al buscar turno. Intentá de nuevo.' }
  }

  // El RPC retorna jsonb: { found: bool, appointment?: {...} }
  // `services` viene como array de OBJETOS ({id, name, duration}); la UI espera
  // nombres. Sin este mapeo la tarjeta mostraba "[object Object]".
  const result = data as {
    found: boolean
    appointment?: {
      id: string
      starts_at: string
      ends_at: string | null
      barber_name: string | null
      barber_id: string | null
      barber_avatar_url?: string | null
      services: Array<{ name?: string }> | string[] | null
      client_id?: string | null
      client_name: string
      client_phone: string
      status: string
      duration_minutes?: number | null
      no_show_tolerance_minutes?: number
    }
  }

  const appt = result.appointment

  if (!result.found || !appt) {
    return { ok: true, data: { found: false, appointment: null } }
  }

  const serviceNames = (appt.services ?? [])
    .map(s => (typeof s === 'string' ? s : s?.name ?? ''))
    .filter(Boolean)

  // El RPC no devuelve la tolerancia; se lee de los settings efectivos.
  const { data: branchRow } = await supabase
    .from('branches')
    .select('organization_id')
    .eq('id', branchId)
    .maybeSingle()

  let tolerance = appt.no_show_tolerance_minutes ?? null
  if (tolerance == null && branchRow?.organization_id) {
    const settings = await getAppointmentSettings(branchRow.organization_id, branchId)
    tolerance = settings?.no_show_tolerance_minutes ?? null
  }

  // ends_at puede faltar en turnos viejos: se deriva de la duración.
  const endsAt =
    appt.ends_at ??
    new Date(
      new Date(appt.starts_at).getTime() + (appt.duration_minutes ?? 30) * 60_000
    ).toISOString()

  return {
    ok: true,
    data: {
      found: true,
      appointment: {
        id: appt.id,
        starts_at: appt.starts_at,
        ends_at: endsAt,
        barber_name: appt.barber_name,
        barber_id: appt.barber_id,
        barber_avatar_url: appt.barber_avatar_url ?? null,
        services: serviceNames,
        client_id: appt.client_id ?? null,
        client_name: appt.client_name,
        client_phone: appt.client_phone,
        status: appt.status,
        no_show_tolerance_minutes: tolerance ?? 15,
      },
    },
  }
}

// ─── lookupAppointmentForClient ───────────────────────────────────────────────

/**
 * Igual que `lookupAppointmentByPhone` pero partiendo del `client_id`, que es
 * lo que devuelve el reconocimiento facial. Sin esto, después de reconocer la
 * cara había que pedirle igual el teléfono al cliente, que es justo lo que el
 * Face ID viene a evitar.
 *
 * No pasa por el RPC (que resuelve por teléfono): consulta directo, en la TZ de
 * la sucursal — con `CURRENT_DATE` (UTC), después de las 21:00 en Argentina se
 * buscarían los turnos de mañana.
 */
export async function lookupAppointmentForClient(
  branchId: string,
  clientId: string
): Promise<{ ok: true; data: LookupAppointmentResult } | { error: string }> {
  if (!isValidUUID(branchId)) return { error: 'branch_id inválido' }
  if (!isValidUUID(clientId)) return { error: 'client_id inválido' }

  const gate = await RateLimits.kioskCheckin(branchId)
  if (!gate.allowed) return { error: 'Demasiados intentos. Esperá un momento.' }

  const supabase = createAdminClient()

  const { data: branch } = await supabase
    .from('branches')
    .select('organization_id, timezone')
    .eq('id', branchId)
    .eq('is_active', true)
    .maybeSingle()

  if (!branch) return { error: 'Sucursal no encontrada' }

  const tz = branch.timezone || 'America/Argentina/Buenos_Aires'
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: tz })

  const { data: appt, error } = await supabase
    .from('appointments')
    .select(`
      id, start_time, end_time, duration_minutes, status, barber_id, client_id,
      barber:barber_id(full_name, avatar_url),
      client:client_id(name, phone),
      appointment_services(sort_order, service:service_id(name))
    `)
    .eq('branch_id', branchId)
    .eq('client_id', clientId)
    .eq('appointment_date', hoy)
    .in('status', ['scheduled', 'confirmed', 'checked_in'])
    .order('start_time')
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[lookupAppointmentForClient]', error.message)
    return { error: 'Error al buscar turno. Intentá de nuevo.' }
  }

  if (!appt) return { ok: true, data: { found: false, appointment: null } }

  const tzOffset = getTzOffsetISO(new Date(`${hoy}T12:00:00Z`), tz)
  const startsAt = new Date(`${hoy}T${appt.start_time.slice(0, 8)}${tzOffset}`)
  const endsAt = new Date(startsAt.getTime() + (appt.duration_minutes ?? 30) * 60_000)

  const settings = await getAppointmentSettings(branch.organization_id, branchId)
  const barber = (Array.isArray(appt.barber) ? appt.barber[0] : appt.barber) as
    { full_name?: string; avatar_url?: string | null } | null
  const client = (Array.isArray(appt.client) ? appt.client[0] : appt.client) as
    { name?: string; phone?: string } | null

  const servicios = ((appt.appointment_services ?? []) as Array<{
    sort_order: number
    service: { name?: string } | { name?: string }[] | null
  }>)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(row => {
      const s = Array.isArray(row.service) ? row.service[0] : row.service
      return s?.name ?? ''
    })
    .filter(Boolean)

  return {
    ok: true,
    data: {
      found: true,
      appointment: {
        id: appt.id,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        barber_name: barber?.full_name ?? null,
        barber_id: appt.barber_id,
        barber_avatar_url: barber?.avatar_url ?? null,
        services: servicios,
        client_id: appt.client_id,
        client_name: client?.name ?? '',
        client_phone: client?.phone ?? '',
        status: appt.status,
        no_show_tolerance_minutes: settings?.no_show_tolerance_minutes ?? 15,
      },
    },
  }
}

// ─── confirmAppointmentArrival ────────────────────────────────────────────────

/**
 * Registra la llegada del cliente con turno.
 * Llama al RPC `check_in_appointment` que crea la queue_entry vinculada.
 * Errores posibles del RPC: NOT_FOUND, INVALID_STATUS, STAFF_REQUIRED, TOO_EARLY, TOO_LATE.
 */
export async function confirmAppointmentArrival(
  appointmentId: string,
  staffIdAssign?: string
): Promise<
  | { ok: true; queueEntryId: string; staffId: string | null; adoptedExistingEntry: boolean }
  | { error: string; code?: string; startsAt?: string }
> {
  if (!isValidUUID(appointmentId)) return { error: 'ID de turno inválido' }

  const supabase = createAdminClient()

  // Turnos reservados "con cualquiera disponible" tienen barber_id NULL y el
  // RPC responde STAFF_REQUIRED: el cliente quedaba trabado en la tablet sin
  // ninguna salida. Se resuelve acá con el mismo repartidor justo que usa el
  // walk-in, para que la asignación siga el orden de la casa.
  let assign = staffIdAssign && isValidUUID(staffIdAssign) ? staffIdAssign : undefined

  if (!assign) {
    const { data: appt } = await supabase
      .from('appointments')
      .select('barber_id, branch_id')
      .eq('id', appointmentId)
      .maybeSingle()

    if (appt && !appt.barber_id) {
      const { data: fair, error: fairError } = await supabase.rpc('get_fair_barber', {
        p_branch_id: appt.branch_id,
      })
      if (fairError) {
        console.error('[confirmAppointmentArrival] get_fair_barber:', fairError.message)
      } else if (fair) {
        assign = fair as string
      }
    }
  }

  const { data, error } = await supabase.rpc('check_in_appointment', {
    p_appointment_id: appointmentId,
    ...(assign ? { p_staff_id_assign: assign } : {}),
  })

  if (error) {
    console.error('[confirmAppointmentArrival] RPC error:', error.message)
    return { error: 'Error al confirmar llegada. Intentá de nuevo.' }
  }

  const result = data as {
    success: boolean
    queue_entry_id?: string
    staff_id?: string
    error?: string
    starts_at?: string
    adopted_existing_entry?: boolean
  }

  if (!result.success) {
    const code = result.error ?? 'UNKNOWN'
    const mensajes: Record<string, string> = {
      NOT_FOUND: 'No encontramos el turno.',
      INVALID_STATUS: 'Este turno ya fue procesado o cancelado.',
      STAFF_REQUIRED: 'Falta asignarle un barbero al turno. Avisá en el mostrador.',
      TOO_EARLY: 'Llegaste bastante antes de tu turno. Volvé más cerca de la hora.',
      TOO_LATE: 'Pasó la tolerancia de tu turno. Avisá en el mostrador.',
      QUEUE_CONFLICT: 'Ya estás anotado. Avisá en el mostrador.',
    }
    return {
      error: mensajes[code] ?? 'No pudimos confirmar la llegada.',
      code,
      startsAt: result.starts_at,
    }
  }

  return {
    ok: true,
    queueEntryId: result.queue_entry_id ?? '',
    staffId: result.staff_id ?? null,
    adoptedExistingEntry: !!result.adopted_existing_entry,
  }
}

// ─── quickBookFromKiosk ───────────────────────────────────────────────────────

/**
 * Reserva un turno inline desde el kiosk (modo appointments o hybrid).
 * Llama al RPC `book_appointment`.
 * Rate limit: mismo bucket `kiosk_checkin`.
 */
export async function quickBookFromKiosk(params: {
  branchId: string
  serviceIds: string[]
  staffId: string
  startsAt: string
  phone: string
  clientName: string
}): Promise<{ ok: true; appointmentId: string } | { error: string }> {
  const branchParsed = BranchIdSchema.safeParse(params.branchId)
  if (!branchParsed.success) return { error: 'branch_id inválido' }

  const phoneParsed = PhoneSchema.safeParse(params.phone)
  if (!phoneParsed.success) return { error: 'Teléfono inválido (10 dígitos)' }

  if (!params.serviceIds.length) return { error: 'Seleccioná al menos un servicio' }
  if (!isValidUUID(params.staffId)) return { error: 'Barbero inválido' }
  if (!params.startsAt) return { error: 'Hora de inicio inválida' }
  if (!params.clientName.trim()) return { error: 'El nombre es requerido' }

  // Rate limit compartido
  const gate = await RateLimits.kioskCheckin(params.branchId)
  if (!gate.allowed) {
    return { error: 'Demasiados intentos. Esperá un momento.' }
  }

  const supabase = createAdminClient()

  const { data: branchData } = await supabase
    .from('branches')
    .select('organization_id, timezone')
    .eq('id', params.branchId)
    .eq('is_active', true)
    .maybeSingle()

  if (!branchData) return { error: 'Sucursal no encontrada' }

  // La reserva va por `createAppointment`, el mismo camino que el turnero
  // público y la agenda. Antes llamaba al RPC `book_appointment`, que era un
  // tercer motor con tres problemas propios: buscaba el cliente por teléfono
  // EXACTO (mientras todo el resto del sistema matchea por los últimos 10
  // dígitos, así que un cliente guardado como "+54 9 351 …" se duplicaba y el
  // turno quedaba colgado del duplicado), usaba EXTRACT(ISODOW) contra
  // `business_days` —que en este proyecto es 0=Domingo— así que una sucursal
  // abierta los domingos siempre daba BRANCH_CLOSED_DAY, y sumaba
  // `buffer_minutes` dentro de `duration_minutes`, haciendo que el turno
  // mintiera sobre cuánto dura. Además devolvía sus códigos crudos
  // (SLOT_TAKEN, BELOW_LEAD_TIME…) a la pantalla del cliente.
  const tz = branchData.timezone || 'America/Argentina/Buenos_Aires'
  const inicio = new Date(params.startsAt)
  const fecha = inicio.toLocaleDateString('en-CA', { timeZone: tz })
  const hora = inicio.toLocaleTimeString('es-AR', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  })

  const { data: servicios } = await supabase
    .from('services')
    .select('id, duration_minutes')
    .in('id', params.serviceIds)

  const settings = await getAppointmentSettings(branchData.organization_id, params.branchId)
  const duracion = params.serviceIds.reduce((acc, id) => {
    const s = servicios?.find(r => r.id === id)
    return acc + (s?.duration_minutes ?? settings?.slot_interval_minutes ?? 30)
  }, 0)

  const result = await createAppointment({
    branchId: params.branchId,
    clientPhone: phoneParsed.data,
    clientName: params.clientName.trim(),
    barberId: params.staffId,
    serviceId: params.serviceIds[0],
    serviceIds: params.serviceIds,
    appointmentDate: fecha,
    startTime: hora,
    durationMinutes: duracion || (settings?.slot_interval_minutes ?? 30),
    source: 'public',
    viaKiosk: true,
  })

  if ('error' in result && result.error) return { error: result.error }
  if (!('success' in result) || !result.appointment) {
    return { error: 'No se pudo crear el turno. Intentá de nuevo.' }
  }

  return { ok: true, appointmentId: result.appointment.id }
}

// ─── getAvailableSlotsForKiosk ────────────────────────────────────────────────

/**
 * Obtiene slots disponibles para una fecha y duración dadas.
 *
 * Usa el MISMO motor que la agenda del dashboard y el turnero público
 * (`getAvailableSlots` en appointments.ts). Antes llamaba al RPC
 * `get_available_slots`, que era un segundo motor divergente y encima estaba
 * caído en prod (42703 por `ab.staff_id`): el kiosko no podía ofrecer ni un
 * horario. Además el RPC devuelve `{slot_start, available_staff_ids}` y acá se
 * casteaba a `{starts_at, ends_at, barber_id, barber_name}` sin mapear, así que
 * aun arreglando el SQL la pantalla habría explotado al parsear.
 */
export async function getAvailableSlotsForKiosk(params: {
  branchId: string
  date: string
  totalDurationMinutes: number
  staffId?: string
}): Promise<{ ok: true; slots: AvailableSlot[] } | { error: string }> {
  const branchParsed = BranchIdSchema.safeParse(params.branchId)
  if (!branchParsed.success) return { error: 'branch_id inválido' }
  if (!params.date) return { error: 'Fecha requerida' }
  if (params.totalDurationMinutes <= 0) return { error: 'Duración inválida' }

  const supabase = createAdminClient()
  const { data: branch } = await supabase
    .from('branches')
    .select('timezone')
    .eq('id', params.branchId)
    .maybeSingle()

  const tz = branch?.timezone || 'America/Argentina/Buenos_Aires'
  const offset = getTzOffsetISO(new Date(`${params.date}T12:00:00Z`), tz)

  const result = await getAvailableSlots(
    params.branchId,
    params.date,
    undefined,
    params.staffId && isValidUUID(params.staffId) ? params.staffId : undefined,
    params.totalDurationMinutes
  )

  if (result.error) return { error: result.error }

  const slots: AvailableSlot[] = []
  for (const barber of result.slots) {
    for (const slot of barber.slots) {
      if (!slot.available) continue
      const start = new Date(`${params.date}T${slot.time}:00${offset}`)
      const end = new Date(start.getTime() + params.totalDurationMinutes * 60_000)
      slots.push({
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        barber_id: barber.barberId,
        barber_name: barber.barberName,
      })
    }
  }

  slots.sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  return { ok: true, slots }
}
