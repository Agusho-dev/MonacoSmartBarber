'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { rateLimit, getClientIP } from '@/lib/rate-limit'
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
}

export interface PublicStaff {
  id: string
  full_name: string
  avatar_url: string | null
}

export interface PublicSlotGroup {
  staff_id: string
  staff_name: string
  slots: Array<{ time: string; available: boolean }>
}

export interface PublicBookingResult {
  appointment_id: string
  cancellation_token: string
  barber_name: string | null
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
    .select('id, name, price, duration_minutes, booking_mode, branch_id')
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

// ─── Slots disponibles ───────────────────────────────────────────────

export async function publicGetAvailableSlots(
  branchId: string,
  date: string,
  serviceId: string,
  staffId?: string
): Promise<{ slots: PublicSlotGroup[]; error?: string }> {
  const result = await getAvailableSlots(branchId, date, serviceId, staffId)
  return {
    slots: result.slots.map(b => ({
      staff_id: b.barberId,
      staff_name: b.barberName,
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

  // Usar el primer servicio para el flujo de booking (multi-servicio como extensión futura)
  const primaryServiceId = input.service_ids[0]

  const result = await createAppointment({
    branchId: input.branch_id,
    clientPhone: phoneClean,
    clientName: nameClean,
    barberId: input.staff_id,
    serviceId: primaryServiceId,
    appointmentDate: input.starts_at,
    startTime: input.start_time,
    durationMinutes: input.duration_minutes,
    source: 'public',
  })

  if ('error' in result && result.error) {
    // Mapear errores internos a códigos públicos comprensibles
    const msg = result.error
    if (msg.includes('teléfono') || msg.toLowerCase().includes('phone')) {
      return { error: 'INVALID_PHONE' }
    }
    if (msg.includes('varios turnos') || msg.includes('Quota') || msg.includes('límite')) {
      return { error: 'PHONE_QUOTA_EXCEEDED' }
    }
    if (msg.includes('no existe un turno en ese horario') || msg.includes('ya existe')) {
      return { error: 'SLOT_TAKEN' }
    }
    if (msg.includes('no está dentro del horario') || msg.includes('cerrado')) {
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
