'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { rateLimit, getClientIP } from '@/lib/rate-limit'
import { isValidUUID } from '@/lib/validation'
import { getLocalDateStr } from '@/lib/time-utils'
import type { Rango } from '@/lib/franjas'
import {
  getAvailableSlots,
  getPublicBranchAppointmentStaff,
  createAppointment,
  cancelAppointmentByToken,
  getAppointmentSettings,
} from '@/lib/actions/appointments'

// ─── Tipos públicos ──────────────────────────────────────────────────

export interface PublicBranch {
  id: string
  name: string
  slug: string
  organization_id: string
  operation_mode: string | null
  address: string | null
  phone: string | null
  timezone: string
}

export interface PublicService {
  id: string
  name: string
  price: number
  duration_minutes: number | null
  booking_mode: string
  /** `checkin | upsell | both`. El kiosko esconde los `upsell` (adicionales). */
  availability: string | null
}

export interface PublicStaff {
  id: string
  full_name: string
  avatar_url: string | null
  /** Días de la semana en que toma turnos (0=domingo … 6=sábado). */
  days: number[]
  /**
   * Franjas REALES en que se le puede reservar, por día. Es el cruce de la
   * ventana del barbero con la que la sucursal abre para turnos — o sea, lo
   * mismo que va a ofrecer el motor. Un día sin cruce no aparece acá.
   */
  windows: Record<number, Rango[]>
}

/** Barbero de la sucursal que NO toma turnos: sólo atiende por orden de llegada. */
export interface PublicWalkInStaff {
  id: string
  full_name: string
  avatar_url: string | null
}

export interface PublicSlotGroup {
  staff_id: string
  staff_name: string
  staff_avatar_url: string | null
  slots: Array<{ time: string; available: boolean }>
}

export interface PublicBookingResult {
  appointment_id: string
  cancellation_token: string
  barber_name: string | null
  /**
   * El cliente ya tiene una cara enrolada, así que la cámara de la tablet lo va
   * a reconocer. Define qué instrucción de llegada se le muestra: mirar la
   * cámara, o marcar que no está registrado y poner el teléfono.
   */
  client_has_face: boolean
  /** Primera reserva con este teléfono en la organización. */
  client_is_new: boolean
}

// ─── Lookup de sucursal por slug ────────────────────────────────────

type LookupOk = { ok: true; branch: PublicBranch; settings: { is_enabled: boolean; max_advance_days: number; appointment_days: number[]; cancellation_min_hours: number; brand_bg_color: string | null; brand_primary_color: string | null; brand_text_color: string | null; logo_url: string | null; welcome_message: string | null } }
type LookupError = { error: string }

export async function publicLookupBranch(slug: string): Promise<LookupOk | LookupError> {
  const ip = await getClientIP()
  const gate = await rateLimit('public_branch_lookup', ip, { limit: 30, window: 60 })
  if (!gate.allowed) return { error: 'Demasiadas solicitudes, esperá un momento' }

  if (!slug || slug.length > 100) return { error: 'Slug inválido' }

  const supabase = createAdminClient()

  const { data: branch } = await supabase
    .from('branches')
    .select('id, name, slug, organization_id, operation_mode, address, phone, timezone')
    .eq('slug', slug.toLowerCase())
    .eq('is_active', true)
    .maybeSingle()

  if (!branch) return { error: 'BRANCH_NOT_FOUND' }

  // Buscar logo de la org para incluirlo en branding
  const { data: org } = await supabase
    .from('organizations')
    .select('logo_url')
    .eq('id', branch.organization_id)
    .maybeSingle()

  const settings = await getAppointmentSettings(branch.organization_id, branch.id)

  return {
    ok: true,
    branch: branch as PublicBranch,
    settings: {
      is_enabled: settings?.is_enabled ?? false,
      max_advance_days: settings?.max_advance_days ?? 30,
      appointment_days: settings?.appointment_days ?? [1, 2, 3, 4, 5, 6],
      cancellation_min_hours: settings?.cancellation_min_hours ?? 2,
      brand_bg_color: settings?.brand_bg_color ?? null,
      brand_primary_color: settings?.brand_primary_color ?? null,
      brand_text_color: settings?.brand_text_color ?? null,
      logo_url: org?.logo_url ?? null,
      welcome_message: settings?.welcome_message ?? null,
    },
  }
}

// ─── Servicios disponibles para la sucursal ─────────────────────────

export async function publicGetBranchServices(branchId: string): Promise<PublicService[]> {
  if (!branchId) return []

  const supabase = createAdminClient()

  // Verificar que la sucursal existe y está activa
  const { data: branch } = await supabase
    .from('branches')
    .select('id, organization_id')
    .eq('id', branchId)
    .eq('is_active', true)
    .maybeSingle()

  if (!branch) return []

  const { data } = await supabase
    .from('services')
    .select('id, name, price, duration_minutes, booking_mode, availability, branch_id')
    .eq('is_active', true)
    .in('booking_mode', ['self_service', 'both'])
    .or(`branch_id.is.null,branch_id.eq.${branchId}`)
    .order('name')

  return ((data ?? []) as PublicService[])
}

// ─── Barberos disponibles para la sucursal ──────────────────────────

export async function publicGetAvailableStaff(branchId: string): Promise<PublicStaff[]> {
  return getPublicBranchAppointmentStaff(branchId)
}

/**
 * Todos los barberos de cara al cliente de la sucursal.
 *
 * El turnero lo usa para restarle los que SÍ se pueden reservar y nombrar al
 * resto como "atiende por orden de llegada". La resta se hace contra la lista
 * reservable de verdad (`publicGetAvailableStaff`) y no contra
 * `appointment_staff`: un barbero habilitado para turnos pero sin jornada
 * cargada no aparece en ninguna de las dos consultas —el motor lo saltea en
 * silencio— y terminaba desapareciendo de la pantalla entera. Para el cliente
 * ese barbero no toma turnos, y eso es exactamente lo que hay que decirle.
 *
 * `hidden_from_checkin` se respeta: es el mismo eje que decide si el barbero se
 * muestra en la tablet, y a alguien que el dueño escondió de cara al cliente no
 * corresponde resucitarlo acá.
 */
export async function publicGetBranchBarbers(branchId: string): Promise<PublicWalkInStaff[]> {
  if (!isValidUUID(branchId)) return []

  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('staff')
    .select('id, full_name, avatar_url')
    .eq('branch_id', branchId)
    .eq('is_active', true)
    .or('role.eq.barber,is_also_barber.eq.true')
    .or('hidden_from_checkin.is.null,hidden_from_checkin.eq.false')
    .order('full_name')

  if (error) {
    console.error('[publicGetBranchBarbers]', error.message)
    return []
  }

  return data ?? []
}

// ─── Identificación del cliente por teléfono ────────────────────────

export interface PublicClientLookup {
  found: boolean
  /** Primer token del nombre guardado. Vacío si no se encontró. */
  firstName: string
  /** Resto del nombre guardado (puede ser vacío aunque el cliente exista). */
  lastName: string
  /**
   * Turno activo que ya tiene en esta organización, si lo hay. Se devuelve para
   * poder AVISARLO en el primer paso: `createAppointment` rechaza un segundo
   * turno el mismo día, y hasta ahora el cliente se enteraba recién al final,
   * después de haber elegido servicio, día y hora.
   */
  upcoming: { date: string; time: string } | null
}

const VACIO: PublicClientLookup = { found: false, firstName: '', lastName: '', upcoming: null }

/**
 * ¿Este teléfono ya es cliente de la sucursal?
 *
 * Es el corazón del nuevo primer paso: el cliente pone el teléfono y, si ya
 * vino alguna vez, no vuelve a tipear su nombre.
 *
 * El match va por `find_client_id_by_phone` —últimos 10 dígitos, migs 149/150—
 * y NO por igualdad exacta. Tiene que ser la misma regla que usa
 * `createAppointment` para encontrar al cliente: si acá dijera "no te conozco"
 * y allá encontrara la ficha, el autocompletado quedaría mudo justo para los
 * clientes viejos, que son los que más lo aprovechan.
 *
 * Devuelve el nombre a partir de un teléfono, así que el endpoint es
 * enumerable por diseño. Se acota con un rate-limit propio y agresivo (12 por
 * minuto por IP+sucursal): alcanza de sobra para tipear un número, y no para
 * barrer un rango. No se devuelve NADA más que el nombre y la fecha del turno
 * — ni el token de gestión, ni el historial, ni los puntos.
 */
export async function publicLookupClient(
  branchId: string,
  phone: string
): Promise<PublicClientLookup> {
  if (!isValidUUID(branchId)) return VACIO

  const limpio = phone.trim().replace(/\s+/g, '')
  // Menos de 8 dígitos no es un teléfono: no se consulta ni se consume cuota.
  if (limpio.replace(/\D/g, '').length < 8) return VACIO

  const ip = await getClientIP()
  const gate = await rateLimit('public_client_lookup', `${ip}:${branchId}`, {
    limit: 12,
    window: 60,
  })
  if (!gate.allowed) return VACIO

  const supabase = createAdminClient()

  const { data: branch } = await supabase
    .from('branches')
    .select('organization_id, timezone')
    .eq('id', branchId)
    .eq('is_active', true)
    .maybeSingle()

  if (!branch) return VACIO

  const { data: clientId, error } = await supabase.rpc('find_client_id_by_phone', {
    p_org: branch.organization_id,
    p_phone: limpio,
  })

  if (error) {
    console.error('[publicLookupClient] find_client_id_by_phone:', error.message)
    return VACIO
  }
  if (!clientId) return VACIO

  const [{ data: client }, { data: turnos }] = await Promise.all([
    supabase.from('clients').select('name').eq('id', clientId as string).maybeSingle(),
    supabase
      .from('appointments')
      .select('appointment_date, start_time')
      .eq('organization_id', branch.organization_id)
      .eq('client_id', clientId as string)
      .in('status', ['pending_payment', 'confirmed', 'checked_in', 'in_progress'])
      // La fecha de corte es HOY EN LA SUCURSAL. Con `toISOString()` sería hoy
      // en UTC y, después de las 21:00 en Argentina, el turno de esta misma
      // tarde ya contaría como pasado y no se avisaría.
      .gte('appointment_date', getLocalDateStr(branch.timezone || undefined))
      .order('appointment_date')
      .order('start_time')
      .limit(1),
  ])

  const nombre = (client?.name ?? '').trim()
  const partes = nombre.split(/\s+/).filter(Boolean)
  const proximo = turnos?.[0]

  return {
    found: true,
    firstName: partes[0] ?? '',
    lastName: partes.slice(1).join(' '),
    upcoming: proximo
      ? { date: proximo.appointment_date, time: proximo.start_time.slice(0, 5) }
      : null,
  }
}

// ─── Slots disponibles ───────────────────────────────────────────────

export async function publicGetAvailableSlots(
  branchId: string,
  date: string,
  serviceIds: string | string[],
  staffId?: string
): Promise<{ slots: PublicSlotGroup[]; error?: string }> {
  const result = await getAvailableSlots(branchId, date, serviceIds, staffId)
  return {
    slots: result.slots.map(b => ({
      staff_id: b.barberId,
      staff_name: b.barberName,
      staff_avatar_url: b.barberAvatarUrl,
      slots: b.slots,
    })),
    error: result.error,
  }
}

// ─── Crear turno ─────────────────────────────────────────────────────

interface BookAppointmentInput {
  branch_slug: string
  branch_id: string
  client_phone: string
  client_name: string
  staff_id: string | null
  starts_at: string       // ISO date "YYYY-MM-DD"
  start_time: string      // "HH:MM"
  service_ids: string[]
  duration_minutes: number
}

type BookOk = { ok: true; data: PublicBookingResult }
type BookError = { error: string }

export async function publicBookAppointment(
  input: BookAppointmentInput
): Promise<BookOk | BookError> {
  // Validaciones básicas antes del rate-limit (fail fast)
  const nameClean = input.client_name.trim()
  const phoneClean = input.client_phone.trim().replace(/\s+/g, '')

  if (nameClean.length < 2) {
    return { error: 'INVALID_NAME' }
  }

  // Regex argentino lax: acepta 10-15 dígitos, con o sin + y espacios
  const phoneRegex = /^\+?[\d\s\-]{8,15}$/
  if (!phoneRegex.test(phoneClean)) {
    return { error: 'INVALID_PHONE' }
  }

  if (!input.service_ids.length) {
    return { error: 'Seleccioná al menos un servicio' }
  }

  // El primero es el servicio principal (FK de la fila); el resto se persiste
  // en `appointment_services`.
  const primaryServiceId = input.service_ids[0]

  const result = await createAppointment({
    branchId: input.branch_id,
    clientPhone: phoneClean,
    clientName: nameClean,
    barberId: input.staff_id,
    serviceId: primaryServiceId,
    serviceIds: input.service_ids,
    appointmentDate: input.starts_at,
    startTime: input.start_time,
    durationMinutes: input.duration_minutes,
    source: 'public',
  })

  if ('error' in result && result.error) {
    // Mapear errores internos a códigos públicos comprensibles.
    // Comparar en minúsculas: antes "Ya existe un turno..." no matcheaba
    // 'ya existe' y el cliente terminaba viendo el texto interno.
    const msg = result.error
    const low = msg.toLowerCase()
    if (low.includes('teléfono') || low.includes('phone')) {
      return { error: 'INVALID_PHONE' }
    }
    if (low.includes('varios turnos') || low.includes('quota') || low.includes('límite')) {
      return { error: 'PHONE_QUOTA_EXCEEDED' }
    }
    if (low.includes('ya existe') || low.includes('no hay barberos disponibles')) {
      return { error: 'SLOT_TAKEN' }
    }
    if (low.includes('ya tenés un turno activo')) {
      return { error: 'ALREADY_BOOKED_TODAY' }
    }
    if (low.includes('no está dentro del horario') || low.includes('no termina dentro') || low.includes('cerrado')) {
      return { error: 'TOO_LATE' }
    }
    return { error: msg }
  }

  if (!result.success || !result.appointment) {
    return { error: 'Error al crear el turno, intentá nuevamente' }
  }

  const appt = result.appointment

  return {
    ok: true,
    data: {
      appointment_id: appt.id,
      cancellation_token: appt.cancellation_token,
      barber_name: null, // se resuelve en el cliente a partir del staff seleccionado
      client_has_face: 'clientHasFace' in result ? !!result.clientHasFace : false,
      client_is_new: 'clientIsNew' in result ? !!result.clientIsNew : true,
    },
  }
}

// ─── Cancelar turno por token ────────────────────────────────────────

type CancelOk = { ok: true }
type CancelError = { error: string }

export async function publicCancelByToken(token: string): Promise<CancelOk | CancelError> {
  if (!token || token.length < 8) return { error: 'NOT_FOUND_OR_NOT_CANCELLABLE' }

  const result = await cancelAppointmentByToken(token)

  if (result.error) {
    if (result.error.includes('expiró') || result.error.includes('no encontrado')) {
      return { error: 'NOT_FOUND_OR_NOT_CANCELLABLE' }
    }
    return { error: result.error }
  }

  return { ok: true }
}
