'use server'

/**
 * turnos.ts — Capa de orquestación para el dashboard de agenda.
 *
 * Expone las RPCs del sistema de turnos (book_appointment, get_available_slots,
 * cancel_appointment_by_id, reschedule_appointment) como server actions tipadas.
 * Toda la lógica de negocio vive en appointments.ts; este módulo adapta las
 * interfaces para el wizard del dashboard y agrega búsqueda/creación de clientes.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getCurrentOrgId } from './org'
import { assertBranchAccess } from './branch-access'
import {
  createAppointment,
  rescheduleAppointment as rescheduleAppointmentBase,
  cancelAppointment,
  getAvailableSlots,
  getBranchAppointmentStaff,
  getAppointmentsForDate,
  getAppointmentSettings,
} from './appointments'
import type { Appointment, AppointmentSettings } from '@/lib/types/database'

// ─── Tipos públicos del módulo ──────────────────────────────────────

export interface TurnosSlot {
  /** HH:MM */
  time: string
  available: boolean
  availableStaffIds: string[]
}

export interface TurnosStaff {
  id: string
  full_name: string
  avatar_url: string | null
}

export interface TurnosService {
  id: string
  name: string
  price: number
  duration_minutes: number
  branch_id: string | null
}

export interface TurnosClientResult {
  id: string
  name: string
  phone: string
}

// Appointment ya incluye los embeds necesarios (client, barber, service)
export type AgendaDayAppointment = Appointment

// ─── getAgendaForDay ────────────────────────────────────────────────

/**
 * Retorna los turnos del día para una sucursal. Aplica scope de acceso.
 */
export async function getAgendaForDay(
  branchId: string,
  date: string
): Promise<{ data: AgendaDayAppointment[] } | { error: string }> {
  try {
    const appointments = await getAppointmentsForDate(branchId, date)
    return { data: appointments as AgendaDayAppointment[] }
  } catch (e) {
    console.error('[turnos] getAgendaForDay error:', e)
    return { error: 'Error al cargar la agenda' }
  }
}

// ─── getAvailableSlotsForBranch ─────────────────────────────────────

/**
 * Retorna slots disponibles para una sucursal, fecha y duración total.
 * Llama al engine de disponibilidad existente y normaliza al formato TurnosSlot.
 */
export async function getAvailableSlotsForBranch(
  branchId: string,
  date: string,
  // Conservado en la firma por API contract; el slot engine subyacente infiere
  // duración desde appointment_settings.slot_interval_minutes. Cuando migremos
  // todas las superficies al RPC nuevo `get_available_slots(.., total_duration)`
  // este parámetro se va a usar (prefijo `_` lo silencia hasta entonces).
  _totalDurationMinutes: number,
  staffId?: string | null
): Promise<{ data: TurnosSlot[] } | { error: string }> {
  try {
    const result = await getAvailableSlots(
      branchId,
      date,
      undefined, // serviceId — usamos duración total directa
      staffId ?? undefined
    )

    if (result.error) return { error: result.error }

    // Consolidar slots por horario: disponible si al menos 1 barbero tiene ese slot libre
    const slotMap = new Map<string, { available: boolean; staffIds: string[] }>()

    for (const barberAvail of result.slots) {
      for (const slot of barberAvail.slots) {
        const existing = slotMap.get(slot.time)
        if (existing) {
          if (slot.available) {
            existing.available = true
            existing.staffIds.push(barberAvail.barberId)
          }
        } else {
          slotMap.set(slot.time, {
            available: slot.available,
            staffIds: slot.available ? [barberAvail.barberId] : [],
          })
        }
      }
    }

    const data: TurnosSlot[] = Array.from(slotMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([time, { available, staffIds }]) => ({
        time,
        available,
        availableStaffIds: staffIds,
      }))

    return { data }
  } catch (e) {
    console.error('[turnos] getAvailableSlotsForBranch error:', e)
    return { error: 'Error al obtener disponibilidad' }
  }
}

// ─── searchClientsForAgenda ─────────────────────────────────────────

/**
 * Búsqueda de clientes por nombre o teléfono para el wizard de agenda.
 * Debounced en el cliente, mínimo 2 caracteres.
 */
export async function searchClientsForAgenda(
  query: string
): Promise<{ data: TurnosClientResult[] } | { error: string }> {
  if (!query || query.trim().length < 2) return { data: [] }

  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Organización no encontrada' }

  const supabase = createAdminClient()
  const trimmed = query.trim()

  const [byName, byPhone] = await Promise.all([
    supabase
      .from('clients')
      .select('id, name, phone')
      .eq('organization_id', orgId)
      .ilike('name', `%${trimmed}%`)
      .order('name')
      .limit(8),
    supabase
      .from('clients')
      .select('id, name, phone')
      .eq('organization_id', orgId)
      .ilike('phone', `%${trimmed}%`)
      .order('name')
      .limit(8),
  ])

  if (byName.error || byPhone.error) {
    console.error('[turnos] searchClients error:', byName.error ?? byPhone.error)
    return { error: 'Error al buscar clientes' }
  }

  const seen = new Set<string>()
  const merged: TurnosClientResult[] = []
  for (const row of [...(byName.data ?? []), ...(byPhone.data ?? [])]) {
    if (!seen.has(row.id)) {
      seen.add(row.id)
      merged.push({ id: row.id, name: row.name, phone: row.phone })
    }
  }

  return { data: merged.slice(0, 10) }
}

// ─── findOrCreateClient ─────────────────────────────────────────────

/**
 * Busca un cliente por teléfono en la org. Si no existe, lo crea.
 * Retorna el id del cliente.
 */
export async function findOrCreateClient(input: {
  name: string
  phone: string
}): Promise<{ data: { id: string; name: string; phone: string } } | { error: string }> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Organización no encontrada' }

  const name = input.name.trim()
  const phone = input.phone.trim()

  if (!name) return { error: 'El nombre es obligatorio' }
  if (!phone) return { error: 'El teléfono es obligatorio' }

  const supabase = createAdminClient()

  const { data: existing } = await supabase
    .from('clients')
    .select('id, name, phone')
    .eq('phone', phone)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (existing) {
    // Actualizar nombre si cambió
    await supabase
      .from('clients')
      .update({ name })
      .eq('id', existing.id)
      .eq('organization_id', orgId)

    return { data: { id: existing.id, name, phone: existing.phone } }
  }

  const { data: newClient, error } = await supabase
    .from('clients')
    .insert({ name, phone, organization_id: orgId })
    .select('id, name, phone')
    .single()

  if (error || !newClient) {
    return { error: 'Error al crear el cliente' }
  }

  revalidatePath('/dashboard/clientes')
  return { data: { id: newClient.id, name: newClient.name, phone: newClient.phone } }
}

// ─── bookAppointment ────────────────────────────────────────────────

/**
 * Interfaz de alto nivel del wizard: crea un turno desde el dashboard.
 * Equivalente a la RPC book_appointment — delega a createAppointment.
 */
export interface BookAppointmentInput {
  branchId: string
  clientId: string
  /** Solo el primer serviceId se usa como referencia para el nombre en v1 */
  serviceIds: string[]
  staffId: string | null
  startsAt: string
  /** HH:MM */
  startTime: string
  /** YYYY-MM-DD */
  appointmentDate: string
  totalDurationMinutes: number
  notes?: string
  createdByStaffId?: string
}

export async function bookAppointment(
  input: BookAppointmentInput
): Promise<{ ok: true; appointmentId: string } | { error: string }> {
  const supabase = createAdminClient()

  // Resolver datos del cliente
  const { data: client } = await supabase
    .from('clients')
    .select('id, name, phone')
    .eq('id', input.clientId)
    .single()

  if (!client) return { error: 'Cliente no encontrado' }

  const primaryServiceId = input.serviceIds[0]
  if (!primaryServiceId) return { error: 'Se requiere al menos un servicio' }

  const result = await createAppointment({
    branchId: input.branchId,
    clientPhone: client.phone,
    clientName: client.name,
    barberId: input.staffId,
    serviceId: primaryServiceId,
    appointmentDate: input.appointmentDate,
    startTime: input.startTime,
    durationMinutes: input.totalDurationMinutes,
    source: 'manual',
    notes: input.notes,
    createdByStaffId: input.createdByStaffId,
  })

  if ('error' in result && result.error) {
    return { error: mapRpcError(result.error) }
  }

  revalidatePath('/dashboard/turnos/agenda')
  return { ok: true, appointmentId: (result as { appointment?: { id: string } }).appointment?.id ?? '' }
}

// ─── cancelAppointmentById ──────────────────────────────────────────

/**
 * Cancela un turno por ID desde el dashboard (cancelledBy=staff).
 * Equivalente a cancel_appointment_by_id RPC.
 */
export async function cancelAppointmentById(
  appointmentId: string
): Promise<{ ok: true } | { error: string }> {
  const result = await cancelAppointment(appointmentId, 'staff')

  if ('error' in result && result.error) {
    return { error: mapRpcError(result.error) }
  }

  revalidatePath('/dashboard/turnos/agenda')
  return { ok: true }
}

// ─── rescheduleAppointmentViaRpc ────────────────────────────────────

/**
 * Reprograma un turno con lock optimista (expected_updated_at).
 * Si updated_at no coincide con expected_updated_at, retorna STALE_DATA.
 * Equivalente a reschedule_appointment RPC.
 */
export async function rescheduleAppointmentViaRpc(input: {
  appointmentId: string
  newDate: string
  newStartTime: string
  newStaffId?: string | null
  expectedUpdatedAt?: string | null
}): Promise<{ ok: true } | { error: string }> {
  const supabase = createAdminClient()

  // Lock optimista: verificar que updated_at no cambió desde que se leyó el turno
  if (input.expectedUpdatedAt) {
    const { data: current } = await supabase
      .from('appointments')
      .select('updated_at, status')
      .eq('id', input.appointmentId)
      .single()

    if (!current) return { error: 'Turno no encontrado' }

    if (current.updated_at !== input.expectedUpdatedAt) {
      return { error: 'El turno fue modificado por otra sesión. Actualizá la vista.' }
    }

    if (['cancelled', 'completed', 'no_show'].includes(current.status)) {
      return { error: 'No se puede reprogramar un turno en este estado' }
    }
  }

  const result = await rescheduleAppointmentBase({
    appointmentId: input.appointmentId,
    newDate: input.newDate,
    newStartTime: input.newStartTime,
    newBarberId: input.newStaffId,
  })

  if (result?.error) {
    return { error: mapRpcError(result.error) }
  }

  revalidatePath('/dashboard/turnos/agenda')
  return { ok: true }
}

// ─── getServicesForBranch ───────────────────────────────────────────

/**
 * Retorna servicios habilitados para turnos en una sucursal.
 * Incluye servicios de org (branch_id=null) y específicos de la sucursal.
 */
export async function getServicesForBranch(
  branchId: string
): Promise<{ data: TurnosService[] } | { error: string }> {
  const access = await assertBranchAccess(branchId)
  if (!access.ok) return { error: 'Sin acceso a esta sucursal' }

  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('services')
    .select('id, name, price, duration_minutes, branch_id')
    .eq('is_active', true)
    .in('availability', ['appointment', 'all', 'both'])
    .or(`branch_id.is.null,branch_id.eq.${branchId}`)
    .order('name')

  if (error) {
    console.error('[turnos] getServicesForBranch error:', error)
    return { error: 'Error al cargar servicios' }
  }

  return {
    data: (data ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      price: Number(s.price),
      duration_minutes: s.duration_minutes ?? 30,
      branch_id: s.branch_id,
    })),
  }
}

// ─── getStaffForBranch ──────────────────────────────────────────────

/**
 * Retorna staff habilitado para turnos en una sucursal.
 */
export async function getStaffForBranch(
  branchId: string
): Promise<{ data: TurnosStaff[] } | { error: string }> {
  try {
    const staff = await getBranchAppointmentStaff(branchId)
    return { data: staff }
  } catch (e) {
    console.error('[turnos] getStaffForBranch error:', e)
    return { error: 'Error al cargar barberos' }
  }
}

// ─── getSettingsForBranch ───────────────────────────────────────────

/**
 * Settings efectivos de una sucursal (override > org default).
 */
export async function getSettingsForBranch(
  branchId: string
): Promise<{ data: AppointmentSettings | null } | { error: string }> {
  try {
    const orgId = await getCurrentOrgId()
    if (!orgId) return { error: 'Organización no encontrada' }
    const settings = await getAppointmentSettings(orgId, branchId)
    return { data: settings }
  } catch (e) {
    console.error('[turnos] getSettingsForBranch error:', e)
    return { error: 'Error al cargar configuración' }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Mapea códigos de error del sistema de turnos a mensajes amigables en español.
 */
function mapRpcError(raw: string): string {
  const errorMap: Record<string, string> = {
    BRANCH_NOT_FOUND: 'Sucursal no encontrada',
    APPOINTMENTS_DISABLED: 'Los turnos están deshabilitados para esta sucursal',
    INVALID_SERVICES_OR_DURATION: 'Servicio o duración inválidos',
    OUTSIDE_BOOKING_WINDOW: 'Fecha fuera del rango permitido para reservas',
    BELOW_LEAD_TIME: 'El turno es demasiado próximo, superá el tiempo mínimo de anticipación',
    BRANCH_CLOSED_DAY: 'La sucursal no atiende ese día',
    OUTSIDE_BUSINESS_HOURS: 'El horario está fuera del rango de atención',
    SLOT_TAKEN: 'Ese horario ya no está disponible',
    STALE_DATA: 'El turno fue modificado por otra sesión. Actualizá la vista.',
    NOT_CANCELLABLE: 'Este turno ya no puede cancelarse',
  }
  return errorMap[raw] ?? raw
}
