'use server'

import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { isValidUUID } from '@/lib/validation'
import { RateLimits } from '@/lib/rate-limit'
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
  services: string[]
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
  const result = data as {
    found: boolean
    appointment?: {
      id: string
      starts_at: string
      ends_at: string
      barber_name: string | null
      barber_id: string | null
      services: string[]
      client_name: string
      client_phone: string
      status: string
      no_show_tolerance_minutes?: number
    }
  }

  return {
    ok: true,
    data: {
      found: result.found,
      appointment: result.appointment
        ? {
            ...result.appointment,
            no_show_tolerance_minutes: result.appointment.no_show_tolerance_minutes ?? 15,
          }
        : null,
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
  appointmentId: string
): Promise<
  | { ok: true; queueEntryId: string; staffId: string | null }
  | { error: string; code?: string }
> {
  if (!isValidUUID(appointmentId)) return { error: 'ID de turno inválido' }

  const supabase = createAdminClient()

  const { data, error } = await supabase.rpc('check_in_appointment', {
    p_appointment_id: appointmentId,
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
  }

  if (!result.success) {
    const code = result.error ?? 'UNKNOWN'
    const mensajes: Record<string, string> = {
      NOT_FOUND: 'No se encontró el turno.',
      INVALID_STATUS: 'Este turno ya fue procesado o cancelado.',
      STAFF_REQUIRED: 'Se requiere asignación de barbero antes de confirmar.',
      TOO_EARLY: 'Llegaste muy temprano para este turno. Volvé más cerca de la hora.',
      TOO_LATE: 'El tiempo límite para confirmar este turno ya pasó.',
    }
    return {
      error: mensajes[code] ?? 'No se pudo confirmar la llegada.',
      code,
    }
  }

  return {
    ok: true,
    queueEntryId: result.queue_entry_id ?? '',
    staffId: result.staff_id ?? null,
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

  // Buscar o crear cliente por teléfono
  const { data: branchData } = await supabase
    .from('branches')
    .select('organization_id')
    .eq('id', params.branchId)
    .eq('is_active', true)
    .maybeSingle()

  if (!branchData) return { error: 'Sucursal no encontrada' }

  let clientId: string
  const { data: existingClient } = await supabase
    .from('clients')
    .select('id')
    .eq('phone', phoneParsed.data)
    .eq('organization_id', branchData.organization_id)
    .maybeSingle()

  if (existingClient) {
    clientId = existingClient.id
  } else {
    const { data: newClient, error: clientError } = await supabase
      .from('clients')
      .insert({
        name: params.clientName.trim(),
        phone: phoneParsed.data,
        organization_id: branchData.organization_id,
      })
      .select('id')
      .single()

    if (clientError || !newClient) {
      console.error('[quickBookFromKiosk] client insert error:', clientError?.message)
      return { error: 'Error al registrar cliente' }
    }
    clientId = newClient.id
  }

  const { data, error } = await supabase.rpc('book_appointment', {
    p_branch_id: params.branchId,
    p_service_ids: params.serviceIds,
    p_staff_id: params.staffId,
    p_starts_at: params.startsAt,
    p_client_id: clientId,
    p_created_via: 'kiosk',
  })

  if (error) {
    console.error('[quickBookFromKiosk] RPC error:', error.message)
    return { error: 'No se pudo crear el turno. Intentá de nuevo.' }
  }

  const result = data as { id?: string; appointment_id?: string; error?: string }

  if (result.error) {
    return { error: result.error }
  }

  const appointmentId = result.id ?? result.appointment_id
  if (!appointmentId) {
    return { error: 'Respuesta inesperada del servidor' }
  }

  return { ok: true, appointmentId }
}

// ─── getAvailableSlotsForKiosk ────────────────────────────────────────────────

/**
 * Obtiene slots disponibles para una fecha y duración dadas.
 * Wrappea el RPC `get_available_slots`.
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

  const rpcParams: Record<string, unknown> = {
    p_branch_id: params.branchId,
    p_date: params.date,
    p_total_duration_minutes: params.totalDurationMinutes,
  }
  if (params.staffId && isValidUUID(params.staffId)) {
    rpcParams.p_staff_id = params.staffId
  }

  const { data, error } = await supabase.rpc('get_available_slots', rpcParams)

  if (error) {
    console.error('[getAvailableSlotsForKiosk] RPC error:', error.message)
    return { error: 'Error al cargar slots disponibles.' }
  }

  return { ok: true, slots: (data ?? []) as AvailableSlot[] }
}
