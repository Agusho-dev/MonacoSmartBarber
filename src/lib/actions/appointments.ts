'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getCurrentOrgId } from './org'
import { assertBranchAccess, getAllowedBranchIds, filterBranchesByAccess } from './branch-access'
import { RateLimits } from '@/lib/rate-limit'
import { absoluteUrl } from '@/lib/app-url'
import { isValidUUID } from '@/lib/validation'
import type { Appointment, AppointmentSettings, AppointmentStaff, AppointmentStatus, AppointmentPaymentMethod } from '@/lib/types/database'

// ─── Settings ───────────────────────────────────────────────────────

/**
 * Retorna los settings efectivos para una sucursal: override por branch si
 * existe, sino default de la org. Llamar con branchId=null devuelve el default.
 */
export async function getAppointmentSettings(
  orgId?: string,
  branchId?: string | null
) {
  const resolvedOrgId = orgId || await getCurrentOrgId()
  if (!resolvedOrgId) return null

  const supabase = createAdminClient()

  if (branchId) {
    const { data: override } = await supabase
      .from('appointment_settings')
      .select('*')
      .eq('organization_id', resolvedOrgId)
      .eq('branch_id', branchId)
      .maybeSingle()
    if (override) return override as AppointmentSettings
  }

  const { data } = await supabase
    .from('appointment_settings')
    .select('*')
    .eq('organization_id', resolvedOrgId)
    .is('branch_id', null)
    .maybeSingle()

  return data as AppointmentSettings | null
}

export async function updateAppointmentSettings(
  updates: Partial<AppointmentSettings>,
  branchId?: string | null
) {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Organización no encontrada' }

  if (branchId) {
    const access = await assertBranchAccess(branchId)
    if (!access.ok) return { error: 'Sin acceso a esta sucursal' }
  }

  const supabase = createAdminClient()

  const existingQuery = supabase
    .from('appointment_settings')
    .select('id')
    .eq('organization_id', orgId)

  const { data: existing } = branchId
    ? await existingQuery.eq('branch_id', branchId).maybeSingle()
    : await existingQuery.is('branch_id', null).maybeSingle()

  const { organization_id: _, id: __, created_at: ___, updated_at: ____, branch_id: _____, ...safeUpdates } = updates as Record<string, unknown>

  if (existing) {
    const { error } = await supabase
      .from('appointment_settings')
      .update(safeUpdates)
      .eq('id', existing.id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase
      .from('appointment_settings')
      .insert({ ...safeUpdates, organization_id: orgId, branch_id: branchId ?? null })
    if (error) return { error: error.message }
  }

  revalidatePath('/dashboard/configuracion')
  revalidatePath('/dashboard/turnos/configuracion')
  revalidatePath('/dashboard/turnos/personalizacion')
  return { success: true }
}

// ─── Appointment Staff ──────────────────────────────────────────────

export async function getAppointmentStaff(orgId?: string) {
  const resolvedOrgId = orgId || await getCurrentOrgId()
  if (!resolvedOrgId) return []

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('appointment_staff')
    .select('*, staff:staff_id(id, full_name, branch_id, is_active, avatar_url)')
    .eq('organization_id', resolvedOrgId)
    .eq('is_active', true)

  const rows = (data ?? []) as (AppointmentStaff & { staff: { id: string; full_name: string; branch_id: string; is_active: boolean; avatar_url: string | null } })[]

  // Aplicar scope de sucursal (si el usuario está limitado)
  const allowed = await getAllowedBranchIds()
  if (allowed === null) return rows
  return rows.filter(r => !r.staff?.branch_id || allowed.includes(r.staff.branch_id))
}

export async function toggleAppointmentStaff(staffId: string, isActive: boolean) {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Organización no encontrada' }

  const supabase = createAdminClient()

  // Verificar scope: el staff debe pertenecer a una sucursal accesible
  const { data: staff } = await supabase
    .from('staff')
    .select('branch_id, organization_id')
    .eq('id', staffId)
    .maybeSingle()

  if (!staff || staff.organization_id !== orgId) {
    return { error: 'Staff no encontrado' }
  }

  if (staff.branch_id) {
    const access = await assertBranchAccess(staff.branch_id)
    if (!access.ok) return { error: 'Sin acceso a la sucursal de este staff' }
  }

  const { data: existing } = await supabase
    .from('appointment_staff')
    .select('id')
    .eq('staff_id', staffId)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('appointment_staff')
      .update({ is_active: isActive })
      .eq('id', existing.id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase
      .from('appointment_staff')
      .insert({ organization_id: orgId, staff_id: staffId, is_active: isActive })
    if (error) return { error: error.message }
  }

  revalidatePath('/dashboard/configuracion')
  revalidatePath('/dashboard/turnos/configuracion')
  return { success: true }
}

export async function updateAppointmentStaffWalkinMode(
  staffId: string,
  walkinMode: 'both' | 'appointments_only'
) {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Organización no encontrada' }

  const supabase = createAdminClient()

  const { data: existing } = await supabase
    .from('appointment_staff')
    .select('id, organization_id')
    .eq('staff_id', staffId)
    .maybeSingle()

  if (!existing || existing.organization_id !== orgId) {
    return { error: 'Staff no habilitado para turnos en esta organización' }
  }

  // Verificar scope via branch del staff
  const { data: staff } = await supabase
    .from('staff')
    .select('branch_id')
    .eq('id', staffId)
    .maybeSingle()

  if (staff?.branch_id) {
    const access = await assertBranchAccess(staff.branch_id)
    if (!access.ok) return { error: 'Sin acceso a la sucursal de este staff' }
  }

  const { error } = await supabase
    .from('appointment_staff')
    .update({ walkin_mode: walkinMode })
    .eq('id', existing.id)

  if (error) return { error: error.message }

  revalidatePath('/dashboard/turnos/configuracion')
  return { success: true }
}

// ─── Availability Engine ────────────────────────────────────────────

export interface AvailableSlot {
  time: string
  available: boolean
}

export interface BarberAvailability {
  barberId: string
  barberName: string
  slots: AvailableSlot[]
}

export async function getAvailableSlots(
  branchId: string,
  date: string,
  serviceId?: string,
  barberId?: string
): Promise<{ slots: BarberAvailability[]; error?: string }> {
  // Rate-limit: endpoint público, sin auth
  const gate = await RateLimits.publicBookingList(branchId)
  if (!gate.allowed) {
    return { slots: [], error: 'Demasiadas consultas, esperá un momento' }
  }

  if (!isValidUUID(branchId)) return { slots: [], error: 'Sucursal inválida' }

  const supabase = createAdminClient()

  const { data: branch } = await supabase
    .from('branches')
    .select('organization_id, timezone')
    .eq('id', branchId)
    .eq('is_active', true)
    .single()

  if (!branch) return { slots: [], error: 'Sucursal no encontrada' }

  const settings = await getAppointmentSettings(branch.organization_id, branchId)
  if (!settings?.is_enabled) return { slots: [], error: 'Turnos no habilitados' }

  const tz = branch.timezone || 'America/Argentina/Buenos_Aires'

  const targetDate = new Date(date + 'T12:00:00')
  const dayOfWeek = targetDate.getDay()

  if (!settings.appointment_days.includes(dayOfWeek)) {
    return { slots: [], error: 'Día no habilitado para turnos' }
  }

  const maxDate = new Date()
  maxDate.setDate(maxDate.getDate() + settings.max_advance_days)
  if (targetDate > maxDate) {
    return { slots: [], error: 'Fecha fuera del rango permitido' }
  }

  let serviceDuration = settings.slot_interval_minutes
  if (serviceId) {
    const { data: service } = await supabase
      .from('services')
      .select('duration_minutes')
      .eq('id', serviceId)
      .single()
    if (service?.duration_minutes) {
      serviceDuration = service.duration_minutes
    }
  }

  // Staff habilitado para turnos en esta sucursal
  const { data: appointmentStaff } = await supabase
    .from('appointment_staff')
    .select('staff_id, walkin_mode, staff:staff_id(id, full_name, branch_id, is_active, avatar_url)')
    .eq('organization_id', branch.organization_id)
    .eq('is_active', true)

  if (!appointmentStaff?.length) return { slots: [] }

  const branchStaff = appointmentStaff.filter(
    (as: any) => as.staff?.branch_id === branchId && as.staff?.is_active
  )

  if (barberId) {
    const found = branchStaff.find((s: any) => s.staff_id === barberId)
    if (!found) return { slots: [], error: 'Barbero no disponible para turnos' }
  }

  const staffIds = barberId
    ? [barberId]
    : branchStaff.map((s: any) => s.staff_id)

  if (!staffIds.length) return { slots: [] }

  // Horarios de trabajo para ese día
  const { data: schedules } = await supabase
    .from('staff_schedules')
    .select('staff_id, start_time, end_time')
    .in('staff_id', staffIds)
    .eq('day_of_week', dayOfWeek)
    .eq('is_active', true)

  // Excepciones (ausencias)
  const { data: exceptions } = await supabase
    .from('staff_schedule_exceptions')
    .select('staff_id')
    .in('staff_id', staffIds)
    .eq('exception_date', date)
    .eq('is_absent', true)

  const absentStaff = new Set(exceptions?.map(e => e.staff_id) ?? [])

  // Turnos existentes para ese día
  const { data: existingAppointments } = await supabase
    .from('appointments')
    .select('barber_id, start_time, end_time')
    .eq('branch_id', branchId)
    .eq('appointment_date', date)
    .not('status', 'in', '("cancelled","no_show")')

  // Bloqueos para ese día
  const dayStart = new Date(date + 'T00:00:00').toISOString()
  const dayEnd = new Date(date + 'T23:59:59').toISOString()
  const { data: blocks } = await supabase
    .from('appointment_blocks')
    .select('branch_id, barber_id, start_at, end_at')
    .eq('organization_id', branch.organization_id)
    .or(`branch_id.is.null,branch_id.eq.${branchId}`)
    .lt('start_at', dayEnd)
    .gt('end_at', dayStart)

  const openMinutes = timeToMinutes(settings.appointment_hours_open)
  const closeMinutes = timeToMinutes(settings.appointment_hours_close)
  const buffer = settings.buffer_minutes ?? 0

  // "Ahora" en timezone de la sucursal
  const nowInTz = new Date(new Date().toLocaleString('en-US', { timeZone: tz }))
  const todayStr = nowInTz.toISOString().split('T')[0]
  const isToday = date === todayStr
  const nowMinutesInTz = nowInTz.getHours() * 60 + nowInTz.getMinutes()
  const earliestBookableMinute = nowMinutesInTz + (settings.lead_time_minutes ?? 0)

  const result: BarberAvailability[] = []

  for (const staffId of staffIds) {
    if (absentStaff.has(staffId)) continue

    const staffSchedules = schedules?.filter(s => s.staff_id === staffId) ?? []
    if (!staffSchedules.length) continue

    const staffRecord = branchStaff.find((s: any) => s.staff_id === staffId)
    const staffName = (staffRecord as any)?.staff?.full_name ?? ''
    const staffAppointments = existingAppointments?.filter(a => a.barber_id === staffId) ?? []

    // Bloques aplicables a este barbero: de org (branch=null), de sucursal (branch=X, barber=null), o específicos
    const staffBlocks = (blocks ?? []).filter(b => {
      if (b.branch_id === null) return true
      if (b.branch_id === branchId && b.barber_id === null) return true
      if (b.branch_id === branchId && b.barber_id === staffId) return true
      return false
    })

    const slots: AvailableSlot[] = []

    // Slot step: usamos la duración del servicio para que los horarios no se superpongan.
    // Fallback al slot_interval de settings si no hay servicio seleccionado.
    const slotStep = serviceDuration > 0 ? serviceDuration : settings.slot_interval_minutes
    for (let m = openMinutes; m + serviceDuration <= closeMinutes; m += slotStep) {
      const slotStart = minutesToTime(m)
      const slotEnd = minutesToTime(m + serviceDuration)

      const withinSchedule = staffSchedules.some(sch =>
        slotStart >= sch.start_time.substring(0, 5) && slotEnd <= sch.end_time.substring(0, 5)
      )

      if (!withinSchedule) {
        slots.push({ time: slotStart, available: false })
        continue
      }

      // Overlap extendiendo cada turno existente por buffer_minutes a ambos lados
      const overlaps = staffAppointments.some(appt => {
        const apptStart = timeToMinutes(appt.start_time.substring(0, 5)) - buffer
        const apptEnd = timeToMinutes(appt.end_time.substring(0, 5)) + buffer
        return m < apptEnd && (m + serviceDuration) > apptStart
      })

      // Overlap con bloqueos (vacaciones, descansos, feriados)
      const slotStartMs = new Date(`${date}T${slotStart}:00`).getTime()
      const slotEndMs = new Date(`${date}T${slotEnd}:00`).getTime()
      const isBlocked = staffBlocks.some(b => {
        const bStart = new Date(b.start_at).getTime()
        const bEnd = new Date(b.end_at).getTime()
        return slotStartMs < bEnd && slotEndMs > bStart
      })

      // Lead time: si es hoy, no reservar antes de (ahora + lead_time_minutes)
      const tooSoon = isToday && m < earliestBookableMinute

      slots.push({ time: slotStart, available: !overlaps && !isBlocked && !tooSoon })
    }

    result.push({ barberId: staffId, barberName: staffName, slots })
  }

  return { slots: result }
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// ─── Messaging helpers ──────────────────────────────────────────────

/**
 * Resuelve el channel_id de WhatsApp default de la org (si está configurado).
 * Devuelve null si no hay canal — en ese caso los mensajes se omiten
 * silenciosamente (graceful degradation — los turnos siguen funcionando sin WA).
 */
async function resolveOrgWhatsAppChannelId(orgId: string): Promise<string | null> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('social_channels')
    .select('id')
    .eq('organization_id', orgId)
    .eq('platform', 'whatsapp')
    .is('branch_id', null)
    .eq('is_active', true)
    .maybeSingle()
  return data?.id ?? null
}

async function getTemplateNameById(templateId: string | null): Promise<string | null> {
  if (!templateId) return null
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('message_templates')
    .select('name')
    .eq('id', templateId)
    .maybeSingle()
  return data?.name ?? null
}

function buildAppointmentTemplateParams(vars: {
  clientName: string
  serviceName: string
  dateFormatted: string
  startTime: string
  branchName: string
}) {
  return [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: vars.clientName },
        { type: 'text', text: vars.serviceName },
        { type: 'text', text: vars.dateFormatted },
        { type: 'text', text: vars.startTime },
        { type: 'text', text: vars.branchName },
      ],
    },
  ]
}

interface ScheduleContext {
  orgId: string
  appointmentId: string
  clientId: string
  phone: string
  clientName: string
  serviceName: string
  branchName: string
  dateFormatted: string
  startTime: string
  appointmentDateTime: Date
  managementUrl: string
}

/**
 * Encola mensajes de confirmación + N recordatorios para un turno.
 * Silent no-op si: no hay teléfono, no hay canal WA configurado. Errores se
 * loguean pero no abortan la operación (los turnos no requieren CRM).
 */
async function scheduleAppointmentMessages(
  ctx: ScheduleContext,
  settings: AppointmentSettings,
  kind: 'create' | 'reschedule'
) {
  try {
    if (!ctx.phone) return

    const supabase = createAdminClient()
    const channelId = await resolveOrgWhatsAppChannelId(ctx.orgId)

    // ── Confirmación / Reprogramación ──────────────────────────────
    const confirmationTplId = kind === 'reschedule'
      ? (settings.reschedule_template_id ?? settings.confirmation_template_id)
      : settings.confirmation_template_id

    const confirmationTplName = await getTemplateNameById(confirmationTplId)
      ?? (kind === 'reschedule' ? null : settings.confirmation_template_name)

    const confirmationRow: Record<string, unknown> = {
      organization_id: ctx.orgId,
      appointment_id: ctx.appointmentId,
      client_id: ctx.clientId,
      channel_id: channelId,
      scheduled_for: new Date().toISOString(),
      phone: ctx.phone,
      status: 'pending',
    }

    const params = buildAppointmentTemplateParams({
      clientName: ctx.clientName,
      serviceName: ctx.serviceName,
      dateFormatted: ctx.dateFormatted,
      startTime: ctx.startTime,
      branchName: ctx.branchName,
    })

    if (confirmationTplId && confirmationTplName) {
      confirmationRow.template_id = confirmationTplId
      confirmationRow.template_name = confirmationTplName
      confirmationRow.template_params = params
    } else if (confirmationTplName) {
      confirmationRow.template_name = confirmationTplName
      confirmationRow.template_params = params
    } else {
      const prefix = kind === 'reschedule' ? 'Tu turno fue reprogramado: ' : ''
      confirmationRow.content = `${prefix}${ctx.serviceName} el ${ctx.dateFormatted} a las ${ctx.startTime} en ${ctx.branchName}. Gestionalo acá: ${ctx.managementUrl}`
    }

    await supabase.from('scheduled_messages').insert(confirmationRow)

    // ── Recordatorios (lista configurable) ──────────────────────────
    const reminderHours = Array.isArray(settings.reminder_hours_before_list)
      && settings.reminder_hours_before_list.length > 0
        ? settings.reminder_hours_before_list
        : (settings.reminder_hours_before > 0 ? [settings.reminder_hours_before] : [])

    const reminderTplId = settings.reminder_template_id
    const reminderTplName = await getTemplateNameById(reminderTplId)
      ?? settings.reminder_template_name

    const now = Date.now()
    const reminderRows: Record<string, unknown>[] = []

    for (const hoursBefore of reminderHours) {
      const reminderTime = new Date(ctx.appointmentDateTime.getTime() - hoursBefore * 60 * 60 * 1000)
      if (reminderTime.getTime() <= now) continue

      const row: Record<string, unknown> = {
        organization_id: ctx.orgId,
        appointment_id: ctx.appointmentId,
        client_id: ctx.clientId,
        channel_id: channelId,
        scheduled_for: reminderTime.toISOString(),
        phone: ctx.phone,
        status: 'pending',
      }

      if (reminderTplId && reminderTplName) {
        row.template_id = reminderTplId
        row.template_name = reminderTplName
        row.template_params = params
      } else if (reminderTplName) {
        row.template_name = reminderTplName
        row.template_params = params
      } else {
        row.content = `Recordatorio: ${ctx.serviceName} el ${ctx.dateFormatted} a las ${ctx.startTime} en ${ctx.branchName}.`
      }

      reminderRows.push(row)
    }

    if (reminderRows.length) {
      await supabase.from('scheduled_messages').insert(reminderRows)
    }
  } catch (e) {
    console.error('[Appointments] Error programando mensajes:', e)
  }
}

/**
 * Cancela solo los mensajes pendientes asociados a un turno específico.
 * Usa el nuevo `appointment_id` (migración 105) para no afectar otros
 * mensajes del cliente (ej. promociones, workflows independientes).
 */
async function cancelScheduledMessagesForAppointment(appointmentId: string) {
  try {
    const supabase = createAdminClient()
    await supabase
      .from('scheduled_messages')
      .update({ status: 'cancelled' })
      .eq('appointment_id', appointmentId)
      .eq('status', 'pending')
      .gte('scheduled_for', new Date().toISOString())
  } catch (e) {
    console.error('[Appointments] Error cancelando mensajes:', e)
  }
}

// ─── Create Appointment ─────────────────────────────────────────────

interface CreateAppointmentInput {
  branchId: string
  clientPhone: string
  clientName: string
  barberId?: string | null
  serviceId: string
  appointmentDate: string
  startTime: string
  durationMinutes: number
  source: 'public' | 'manual'
  notes?: string
  createdByStaffId?: string
}

export async function createAppointment(input: CreateAppointmentInput) {
  // Rate-limit por IP antes de tocar DB (solo para creación vía turnero público).
  if (input.source === 'public') {
    const ipGate = await RateLimits.publicBookingCreateByIp()
    if (!ipGate.allowed) {
      return { error: 'Demasiadas reservas desde esta dirección, esperá un minuto' }
    }
  }

  if (!isValidUUID(input.branchId)) return { error: 'Sucursal inválida' }

  const supabase = createAdminClient()

  const { data: branch } = await supabase
    .from('branches')
    .select('id, organization_id, name, timezone')
    .eq('id', input.branchId)
    .eq('is_active', true)
    .single()

  if (!branch) return { error: 'Sucursal no encontrada' }
  const orgId = branch.organization_id

  // Para origen 'manual' (dashboard), enforcear scope server-side
  if (input.source === 'manual') {
    const access = await assertBranchAccess(input.branchId)
    if (!access.ok) return { error: 'Sin acceso a esta sucursal' }
  }

  const settings = await getAppointmentSettings(orgId, input.branchId)
  if (!settings?.is_enabled) return { error: 'Turnos no habilitados' }

  // Rate-limit por teléfono+org (anti-spam orientado al turnero público)
  if (input.source === 'public') {
    const phoneGate = await RateLimits.publicBookingCreateByPhone(input.clientPhone, orgId)
    if (!phoneGate.allowed) {
      return { error: 'Ya creaste varios turnos recientemente. Contactanos si necesitás más.' }
    }
  }

  // Buscar o crear cliente (tenant-scoped por phone+org)
  let clientId: string

  const { data: existingClient } = await supabase
    .from('clients')
    .select('id')
    .eq('phone', input.clientPhone)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (existingClient) {
    clientId = existingClient.id
    await supabase.from('clients').update({ name: input.clientName }).eq('id', clientId)
  } else {
    const { data: newClient, error } = await supabase
      .from('clients')
      .insert({ name: input.clientName, phone: input.clientPhone, organization_id: orgId })
      .select('id')
      .single()
    if (error || !newClient) return { error: 'Error al registrar cliente' }
    clientId = newClient.id
  }

  // Anti-doble-booking: un cliente no puede tener otro turno activo el mismo día en esta org
  const { data: clientAppointmentsToday } = await supabase
    .from('appointments')
    .select('id')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .eq('appointment_date', input.appointmentDate)
    .in('status', ['pending_payment', 'confirmed', 'checked_in', 'in_progress'])
    .limit(1)

  if (clientAppointmentsToday?.length) {
    return { error: 'Ya tenés un turno activo para esa fecha' }
  }

  // Calcular end_time, clampeando al cierre del horario de turnos
  const startMinutes = timeToMinutes(input.startTime)
  const closeMinutes = timeToMinutes(settings.appointment_hours_close)
  const rawEndMinutes = startMinutes + input.durationMinutes

  if (rawEndMinutes > closeMinutes) {
    return { error: 'El servicio no termina dentro del horario de atención' }
  }

  const endTime = minutesToTime(rawEndMinutes)

  // Auto-asignar barbero si no se especificó
  let barberId = input.barberId || null
  if (!barberId) {
    const { slots } = await getAvailableSlots(input.branchId, input.appointmentDate, input.serviceId)
    const available = slots.filter(b =>
      b.slots.some(s => s.time === input.startTime && s.available)
    )
    if (!available.length) return { error: 'No hay barberos disponibles en ese horario' }

    // Elegir el que tiene menos turnos ese día
    const { data: counts } = await supabase
      .from('appointments')
      .select('barber_id')
      .eq('branch_id', input.branchId)
      .eq('appointment_date', input.appointmentDate)
      .not('status', 'in', '("cancelled","no_show")')
      .in('barber_id', available.map(a => a.barberId))

    const countMap: Record<string, number> = {}
    for (const a of available) countMap[a.barberId] = 0
    for (const c of counts ?? []) {
      if (c.barber_id) countMap[c.barber_id] = (countMap[c.barber_id] || 0) + 1
    }

    barberId = Object.entries(countMap).sort((a, b) => a[1] - b[1])[0][0]
  }

  // Generar token de cancelación + expiración (turno + 24h, mitiga replay)
  const cancellationToken = crypto.randomUUID().replace(/-/g, '').substring(0, 24)
  const tokenExpiresAt = new Date(`${input.appointmentDate}T${input.startTime}:00`)
  tokenExpiresAt.setHours(tokenExpiresAt.getHours() + 24)

  // Obtener nombre y precio del servicio (precio necesario para prepago)
  let serviceName = ''
  let servicePrice = 0
  if (input.serviceId) {
    const { data: service } = await supabase
      .from('services')
      .select('name, price')
      .eq('id', input.serviceId)
      .single()
    serviceName = service?.name ?? ''
    servicePrice = Number(service?.price ?? 0)
  }

  // Si la org está en prepago, el turno nace como pending_payment y no
  // reserva comunicación hasta que el staff confirme el cobro.
  const isPrepago = settings.payment_mode === 'prepago'
  const initialStatus: AppointmentStatus = isPrepago ? 'pending_payment' : 'confirmed'

  const { data: appointment, error: insertError } = await supabase
    .from('appointments')
    .insert({
      organization_id: orgId,
      branch_id: input.branchId,
      client_id: clientId,
      barber_id: barberId,
      service_id: input.serviceId,
      appointment_date: input.appointmentDate,
      start_time: input.startTime,
      end_time: endTime,
      duration_minutes: input.durationMinutes,
      status: initialStatus,
      source: input.source,
      cancellation_token: cancellationToken,
      token_expires_at: tokenExpiresAt.toISOString(),
      payment_flag: settings.payment_mode,
      payment_status: 'unpaid',
      created_by_staff_id: input.createdByStaffId || null,
      notes: input.notes || null,
    })
    .select('*')
    .single()

  if (insertError) {
    if (insertError.code === '23505') {
      return { error: 'Ya existe un turno en ese horario para ese barbero' }
    }
    return { error: 'Error al crear turno: ' + insertError.message }
  }

  // Programar mensajes (graceful — si no hay WA configurado, no falla)
  const dateFormatted = new Date(input.appointmentDate + 'T12:00:00')
    .toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
  const managementUrl = await absoluteUrl(`/turnos/gestionar/${cancellationToken}`)

  if (isPrepago) {
    // Solicitud de pago (la confirmación + recordatorios se encolan recién al
    // confirmarse el pago; ver confirmAppointmentPrepayment).
    const prepaymentAmount = calculatePrepaymentAmount(settings, servicePrice)
    await schedulePaymentRequestMessage({
      orgId,
      appointmentId: appointment.id,
      clientId,
      phone: input.clientPhone,
      clientName: input.clientName,
      serviceName,
      branchName: branch.name,
      dateFormatted,
      startTime: input.startTime,
      managementUrl,
      amount: prepaymentAmount,
      instructions: settings.payment_instructions ?? null,
      templateId: settings.payment_request_template_id ?? null,
    })
  } else {
    await scheduleAppointmentMessages(
      {
        orgId,
        appointmentId: appointment.id,
        clientId,
        phone: input.clientPhone,
        clientName: input.clientName,
        serviceName,
        branchName: branch.name,
        dateFormatted,
        startTime: input.startTime,
        appointmentDateTime: new Date(`${input.appointmentDate}T${input.startTime}:00`),
        managementUrl,
      },
      settings,
      'create'
    )
  }

  revalidatePath('/dashboard/fila')
  revalidatePath('/dashboard/turnos/agenda')
  revalidatePath('/barbero/fila')
  return { success: true, appointment }
}

/**
 * Calcula el monto a prepagar según la configuración:
 *   - fixed: 100% del precio del servicio
 *   - percentage: servicePrice * prepayment_percentage / 100
 */
function calculatePrepaymentAmount(settings: AppointmentSettings, servicePrice: number): number {
  if (!servicePrice || servicePrice <= 0) return 0
  if (settings.prepayment_type === 'fixed') return servicePrice
  const pct = Math.min(100, Math.max(1, Number(settings.prepayment_percentage ?? 50)))
  return Math.round((servicePrice * pct) / 100)
}

interface PaymentRequestContext {
  orgId: string
  appointmentId: string
  clientId: string
  phone: string
  clientName: string
  serviceName: string
  branchName: string
  dateFormatted: string
  startTime: string
  managementUrl: string
  amount: number
  instructions: string | null
  templateId: string | null
}

/**
 * Encola UN mensaje con el pedido de pago previo al servicio. Graceful no-op
 * si no hay canal WA o teléfono. El cliente recibe:
 *   - Template payment_request si está configurado
 *   - Sino texto libre armado con los datos del turno + instructions
 */
async function schedulePaymentRequestMessage(ctx: PaymentRequestContext) {
  try {
    if (!ctx.phone) return
    const supabase = createAdminClient()
    const channelId = await resolveOrgWhatsAppChannelId(ctx.orgId)

    const templateName = await getTemplateNameById(ctx.templateId)

    const row: Record<string, unknown> = {
      organization_id: ctx.orgId,
      appointment_id: ctx.appointmentId,
      client_id: ctx.clientId,
      channel_id: channelId,
      scheduled_for: new Date().toISOString(),
      phone: ctx.phone,
      status: 'pending',
    }

    if (ctx.templateId && templateName) {
      row.template_id = ctx.templateId
      row.template_name = templateName
      row.template_params = [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: ctx.clientName },
            { type: 'text', text: ctx.serviceName },
            { type: 'text', text: ctx.dateFormatted },
            { type: 'text', text: ctx.startTime },
            { type: 'text', text: ctx.branchName },
            { type: 'text', text: formatARS(ctx.amount) },
            { type: 'text', text: ctx.instructions ?? '' },
          ],
        },
      ]
    } else {
      const amountLabel = ctx.amount > 0 ? ` (${formatARS(ctx.amount)})` : ''
      const instructionsBlock = ctx.instructions ? `\n${ctx.instructions}` : ''
      row.content = `Hola ${ctx.clientName}, tu turno para ${ctx.serviceName} el ${ctx.dateFormatted} a las ${ctx.startTime} en ${ctx.branchName} queda pendiente hasta recibir el pago${amountLabel}.${instructionsBlock}\nCuando lo confirmemos te avisamos. Gestioná tu turno acá: ${ctx.managementUrl}`
    }

    await supabase.from('scheduled_messages').insert(row)
  } catch (e) {
    console.error('[Appointments] Error enviando solicitud de pago:', e)
  }
}

function formatARS(amount: number): string {
  try {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `$${amount}`
  }
}

// ─── Reschedule Appointment ────────────────────────────────────────

interface RescheduleAppointmentInput {
  appointmentId: string
  newDate: string
  newStartTime: string
  newBarberId?: string | null
  newDurationMinutes?: number
}

export async function rescheduleAppointment(input: RescheduleAppointmentInput) {
  const supabase = createAdminClient()

  const { data: existing } = await supabase
    .from('appointments')
    .select('*, branch:branch_id(organization_id, name, timezone)')
    .eq('id', input.appointmentId)
    .single()

  if (!existing) return { error: 'Turno no encontrado' }
  if (['cancelled', 'completed', 'no_show'].includes(existing.status)) {
    return { error: 'No se puede reprogramar un turno en este estado' }
  }

  const access = await assertBranchAccess(existing.branch_id)
  if (!access.ok) return { error: 'Sin acceso a esta sucursal' }

  const orgId = existing.organization_id
  const settings = await getAppointmentSettings(orgId, existing.branch_id)
  if (!settings) return { error: 'Settings no encontrados' }

  const duration = input.newDurationMinutes ?? existing.duration_minutes
  const startMinutes = timeToMinutes(input.newStartTime)
  const closeMinutes = timeToMinutes(settings.appointment_hours_close)
  if (startMinutes + duration > closeMinutes) {
    return { error: 'El servicio no termina dentro del horario de atención' }
  }
  const endTime = minutesToTime(startMinutes + duration)

  const barberId = input.newBarberId !== undefined ? input.newBarberId : existing.barber_id

  // Regenerar token (invalida el anterior)
  const cancellationToken = crypto.randomUUID().replace(/-/g, '').substring(0, 24)
  const tokenExpiresAt = new Date(`${input.newDate}T${input.newStartTime}:00`)
  tokenExpiresAt.setHours(tokenExpiresAt.getHours() + 24)

  const { error: updateError } = await supabase
    .from('appointments')
    .update({
      appointment_date: input.newDate,
      start_time: input.newStartTime,
      end_time: endTime,
      duration_minutes: duration,
      barber_id: barberId,
      cancellation_token: cancellationToken,
      token_expires_at: tokenExpiresAt.toISOString(),
    })
    .eq('id', input.appointmentId)

  if (updateError) {
    if (updateError.code === '23505') {
      return { error: 'Ya existe un turno en ese horario para ese barbero' }
    }
    return { error: updateError.message }
  }

  // Cancelar mensajes pendientes del turno anterior
  await cancelScheduledMessagesForAppointment(input.appointmentId)

  // Reprogramar mensajes con los nuevos datos
  const { data: client } = await supabase
    .from('clients')
    .select('name, phone')
    .eq('id', existing.client_id)
    .single()

  let serviceName = ''
  if (existing.service_id) {
    const { data: service } = await supabase
      .from('services')
      .select('name')
      .eq('id', existing.service_id)
      .single()
    serviceName = service?.name ?? ''
  }

  const dateFormatted = new Date(input.newDate + 'T12:00:00')
    .toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
  const managementUrl = await absoluteUrl(`/turnos/gestionar/${cancellationToken}`)

  if (client?.phone) {
    await scheduleAppointmentMessages(
      {
        orgId,
        appointmentId: input.appointmentId,
        clientId: existing.client_id,
        phone: client.phone,
        clientName: client.name ?? '',
        serviceName,
        branchName: (existing.branch as any)?.name ?? '',
        dateFormatted,
        startTime: input.newStartTime,
        appointmentDateTime: new Date(`${input.newDate}T${input.newStartTime}:00`),
        managementUrl,
      },
      settings,
      'reschedule'
    )
  }

  revalidatePath('/dashboard/turnos/agenda')
  revalidatePath('/dashboard/fila')
  return { success: true }
}

export async function updateAppointmentDuration(appointmentId: string, newDurationMinutes: number) {
  if (newDurationMinutes <= 0 || newDurationMinutes > 480) {
    return { error: 'Duración inválida' }
  }

  const supabase = createAdminClient()

  const { data: existing } = await supabase
    .from('appointments')
    .select('id, branch_id, appointment_date, start_time')
    .eq('id', appointmentId)
    .single()

  if (!existing) return { error: 'Turno no encontrado' }

  const access = await assertBranchAccess(existing.branch_id)
  if (!access.ok) return { error: 'Sin acceso a esta sucursal' }

  const startMinutes = timeToMinutes(existing.start_time.substring(0, 5))
  const endTime = minutesToTime(startMinutes + newDurationMinutes)

  const { error } = await supabase
    .from('appointments')
    .update({
      duration_minutes: newDurationMinutes,
      end_time: endTime,
    })
    .eq('id', appointmentId)

  if (error) {
    if (error.code === '23505') {
      return { error: 'La nueva duración solapa con otro turno' }
    }
    return { error: error.message }
  }

  revalidatePath('/dashboard/turnos/agenda')
  return { success: true }
}

// ─── Cancel Appointment ─────────────────────────────────────────────

export async function cancelAppointment(
  appointmentId: string,
  cancelledBy: 'client' | 'staff' | 'system'
) {
  const supabase = createAdminClient()

  const { data: appointment } = await supabase
    .from('appointments')
    .select('*, branch:branch_id(organization_id, timezone)')
    .eq('id', appointmentId)
    .single()

  if (!appointment) return { error: 'Turno no encontrado' }
  if (appointment.status === 'cancelled' || appointment.status === 'completed') {
    return { error: 'El turno ya fue cancelado o completado' }
  }

  // Scope check para staff — clientes cancelan vía cancelAppointmentByToken (público)
  if (cancelledBy === 'staff') {
    const access = await assertBranchAccess(appointment.branch_id)
    if (!access.ok) return { error: 'Sin acceso a esta sucursal' }
  }

  if (cancelledBy === 'client') {
    const settings = await getAppointmentSettings(appointment.organization_id, appointment.branch_id)
    if (settings?.cancellation_min_hours) {
      const appointmentDateTime = new Date(`${appointment.appointment_date}T${appointment.start_time}`)
      const hoursUntil = (appointmentDateTime.getTime() - Date.now()) / (1000 * 60 * 60)
      if (hoursUntil < settings.cancellation_min_hours) {
        return { error: `No se puede cancelar con menos de ${settings.cancellation_min_hours} horas de antelación` }
      }
    }
  }

  const { error } = await supabase
    .from('appointments')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancelled_by: cancelledBy,
    })
    .eq('id', appointmentId)

  if (error) return { error: error.message }

  // Cancelar queue entry si existe
  if (appointment.queue_entry_id) {
    await supabase
      .from('queue_entries')
      .update({ status: 'cancelled' })
      .eq('id', appointment.queue_entry_id)
  }

  // Cancelar solo los mensajes programados de este turno (por appointment_id,
  // no por client_id — evita cancelar promos/workflows del cliente).
  await cancelScheduledMessagesForAppointment(appointmentId)

  // Programar mensaje de cancelación informativo (si hay template configurado)
  try {
    const settings = await getAppointmentSettings(appointment.organization_id, appointment.branch_id)
    if (settings?.cancellation_template_id) {
      const tplName = await getTemplateNameById(settings.cancellation_template_id)
      if (tplName) {
        const { data: client } = await supabase
          .from('clients')
          .select('name, phone')
          .eq('id', appointment.client_id)
          .single()

        if (client?.phone) {
          const channelId = await resolveOrgWhatsAppChannelId(appointment.organization_id)
          const dateFormatted = new Date(appointment.appointment_date + 'T12:00:00')
            .toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })

          await supabase.from('scheduled_messages').insert({
            organization_id: appointment.organization_id,
            appointment_id: appointmentId,
            client_id: appointment.client_id,
            channel_id: channelId,
            template_id: settings.cancellation_template_id,
            template_name: tplName,
            template_params: buildAppointmentTemplateParams({
              clientName: client.name ?? '',
              serviceName: '',
              dateFormatted,
              startTime: appointment.start_time.substring(0, 5),
              branchName: '',
            }),
            scheduled_for: new Date().toISOString(),
            phone: client.phone,
            status: 'pending',
          })
        }
      }
    }
  } catch (e) {
    console.error('[Appointments] Error programando mensaje de cancelación:', e)
  }

  // Trigger waitlist notification (best-effort)
  try {
    const { notifyNextWaitlistCandidate } = await import('./waitlist')
    await notifyNextWaitlistCandidate({
      orgId: appointment.organization_id,
      branchId: appointment.branch_id,
      serviceId: appointment.service_id,
      barberId: appointment.barber_id,
      date: appointment.appointment_date,
    })
  } catch { /* waitlist module no requerido */ }

  revalidatePath('/dashboard/fila')
  revalidatePath('/dashboard/turnos/agenda')
  revalidatePath('/barbero/fila')
  return { success: true }
}

export async function cancelAppointmentByToken(token: string) {
  const gate = await RateLimits.publicBookingCancel(token)
  if (!gate.allowed) {
    return { error: 'Demasiados intentos, esperá un momento' }
  }

  const supabase = createAdminClient()

  const { data: appointment } = await supabase
    .from('appointments')
    .select('id, token_expires_at')
    .eq('cancellation_token', token)
    .maybeSingle()

  if (!appointment) return { error: 'Turno no encontrado' }

  // Validar expiración del token
  if (appointment.token_expires_at && new Date(appointment.token_expires_at) < new Date()) {
    return { error: 'El link expiró' }
  }

  return cancelAppointment(appointment.id, 'client')
}

// ─── Mark No-Show ───────────────────────────────────────────────────

export async function markNoShow(appointmentId: string, staffId: string) {
  const supabase = createAdminClient()

  const { data: appointment } = await supabase
    .from('appointments')
    .select('*, branch:branch_id(organization_id)')
    .eq('id', appointmentId)
    .single()

  if (!appointment) return { error: 'Turno no encontrado' }

  const access = await assertBranchAccess(appointment.branch_id)
  if (!access.ok) return { error: 'Sin acceso a esta sucursal' }

  if (!['confirmed', 'checked_in'].includes(appointment.status)) {
    return { error: 'El turno no está en un estado válido para marcar ausente' }
  }

  const settings = await getAppointmentSettings(appointment.organization_id, appointment.branch_id)
  if (settings) {
    const appointmentDateTime = new Date(`${appointment.appointment_date}T${appointment.start_time}`)
    const toleranceEnd = new Date(appointmentDateTime.getTime() + settings.no_show_tolerance_minutes * 60 * 1000)
    if (new Date() < toleranceEnd) {
      return { error: `Debe esperar ${settings.no_show_tolerance_minutes} minutos de tolerancia` }
    }
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

  // Cancelar mensajes pendientes (no tiene sentido enviar recordatorios si ya faltó)
  await cancelScheduledMessagesForAppointment(appointmentId)

  // Cancelar queue entry si existe
  if (appointment.queue_entry_id) {
    await supabase
      .from('queue_entries')
      .update({ status: 'cancelled' })
      .eq('id', appointment.queue_entry_id)
  }

  // Aplicar tag "Ausente" a la conversación del cliente
  try {
    const { data: tag } = await supabase
      .from('conversation_tags')
      .select('id')
      .eq('organization_id', appointment.organization_id)
      .eq('name', 'Ausente')
      .maybeSingle()

    if (tag) {
      const { data: conversations } = await supabase
        .from('conversations')
        .select('id')
        .eq('client_id', appointment.client_id)
        .limit(1)

      if (conversations?.length) {
        await supabase.from('conversation_tag_assignments').upsert({
          conversation_id: conversations[0].id,
          tag_id: tag.id,
        }, { onConflict: 'conversation_id,tag_id', ignoreDuplicates: true })
      }
    }
  } catch (e) {
    console.error('[Appointments] Error aplicando tag Ausente:', e)
  }

  revalidatePath('/dashboard/fila')
  revalidatePath('/dashboard/turnos/agenda')
  revalidatePath('/barbero/fila')
  return { success: true }
}

// ─── Check-in Appointment (create queue entry) ─────────────────────

export async function checkinAppointment(appointmentId: string) {
  const supabase = createAdminClient()

  const { data: appointment } = await supabase
    .from('appointments')
    .select('*')
    .eq('id', appointmentId)
    .eq('status', 'confirmed')
    .single()

  if (!appointment) return { error: 'Turno no encontrado o no está confirmado' }

  const access = await assertBranchAccess(appointment.branch_id)
  if (!access.ok) return { error: 'Sin acceso a esta sucursal' }

  const { data: position } = await supabase.rpc('next_queue_position', {
    p_branch_id: appointment.branch_id,
  })

  const now = new Date().toISOString()
  const { data: queueEntry, error: queueError } = await supabase
    .from('queue_entries')
    .insert({
      branch_id: appointment.branch_id,
      client_id: appointment.client_id,
      barber_id: appointment.barber_id,
      service_id: appointment.service_id,
      position: position ?? 1,
      status: 'waiting',
      is_dynamic: false,
      is_appointment: true,
      appointment_id: appointmentId,
      priority_order: now,
    })
    .select('id')
    .single()

  if (queueError || !queueEntry) {
    return { error: 'Error al agregar a la fila de turnos' }
  }

  await supabase
    .from('appointments')
    .update({ status: 'checked_in', queue_entry_id: queueEntry.id })
    .eq('id', appointmentId)

  revalidatePath('/dashboard/fila')
  revalidatePath('/dashboard/turnos/agenda')
  revalidatePath('/barbero/fila')
  return { success: true, queueEntryId: queueEntry.id }
}

/**
 * Inicia el servicio de un turno ya checked-in. Marca la queue_entry asociada
 * como in_progress y sincroniza el status del appointment. Asume que el turno
 * ya pasó por checkinAppointment (tiene queue_entry_id y barber_id).
 */
export async function startAppointmentService(appointmentId: string) {
  if (!isValidUUID(appointmentId)) return { error: 'ID inválido' }

  const supabase = createAdminClient()

  const { data: appointment } = await supabase
    .from('appointments')
    .select('id, branch_id, barber_id, queue_entry_id, status')
    .eq('id', appointmentId)
    .single()

  if (!appointment) return { error: 'Turno no encontrado' }
  if (!appointment.queue_entry_id) return { error: 'El turno no fue checkeado todavía' }
  if (!appointment.barber_id) return { error: 'El turno no tiene barbero asignado' }
  if (appointment.status !== 'checked_in') return { error: 'El turno no está en espera' }

  const access = await assertBranchAccess(appointment.branch_id)
  if (!access.ok) return { error: 'Sin acceso a esta sucursal' }

  const { error: updateError } = await supabase
    .from('queue_entries')
    .update({
      status: 'in_progress',
      started_at: new Date().toISOString(),
    })
    .eq('id', appointment.queue_entry_id)
    .eq('status', 'waiting')

  if (updateError) return { error: 'Error al iniciar el servicio' }

  await supabase
    .from('appointments')
    .update({ status: 'in_progress' })
    .eq('id', appointmentId)

  revalidatePath('/dashboard/fila')
  revalidatePath('/dashboard/turnos/agenda')
  revalidatePath('/barbero/fila')
  return { success: true }
}

/**
 * Devuelve la queue_entry asociada a un turno (para abrir el diálogo de
 * finalización reutilizando el flujo walk-in de completeService).
 */
export async function getAppointmentQueueEntry(appointmentId: string) {
  if (!isValidUUID(appointmentId)) return null
  const supabase = createAdminClient()

  const { data: appointment } = await supabase
    .from('appointments')
    .select('queue_entry_id, branch_id')
    .eq('id', appointmentId)
    .single()

  if (!appointment?.queue_entry_id) return null

  const access = await assertBranchAccess(appointment.branch_id)
  if (!access.ok) return null

  const { data: entry } = await supabase
    .from('queue_entries')
    .select('*, client:clients(*), barber:staff(*)')
    .eq('id', appointment.queue_entry_id)
    .single()

  return entry
}

// ─── Payment ───────────────────────────────────────────────────────

interface MarkPaymentInput {
  appointmentId: string
  amount: number
  method: 'efectivo' | 'transferencia' | 'mercadopago' | 'tarjeta_debito' | 'tarjeta_credito' | 'otro'
  status: 'paid' | 'partial'
  staffId?: string | null
  notes?: string
}

export async function markAppointmentPayment(input: MarkPaymentInput) {
  const supabase = createAdminClient()

  const { data: existing } = await supabase
    .from('appointments')
    .select('id, branch_id, payment_status')
    .eq('id', input.appointmentId)
    .single()

  if (!existing) return { error: 'Turno no encontrado' }

  const access = await assertBranchAccess(existing.branch_id)
  if (!access.ok) return { error: 'Sin acceso a esta sucursal' }

  if (existing.payment_status === 'refunded') {
    return { error: 'El turno ya fue reembolsado' }
  }

  if (input.amount <= 0) return { error: 'Monto inválido' }

  const { error } = await supabase
    .from('appointments')
    .update({
      payment_status: input.status,
      payment_amount: input.amount,
      payment_method: input.method,
      paid_at: new Date().toISOString(),
      paid_by_staff_id: input.staffId ?? null,
      payment_notes: input.notes ?? null,
    })
    .eq('id', input.appointmentId)

  if (error) return { error: error.message }

  revalidatePath('/dashboard/turnos/agenda')
  revalidatePath('/dashboard/fila')
  return { success: true }
}

// ─── Prepayment confirmation ───────────────────────────────────────

interface ConfirmPrepaymentInput {
  appointmentId: string
  method: AppointmentPaymentMethod
  /** Opcional: override del monto calculado por settings. */
  amount?: number
  paymentAccountId?: string | null
  staffId?: string | null
  notes?: string
}

/**
 * Confirma manualmente el prepago de un turno en 'pending_payment'. Efecto:
 *  1) Crea una visita (impacta caja/finanzas al momento de la confirmación).
 *  2) Marca el turno como 'confirmed' + payment_status ('paid' o 'partial').
 *  3) Dispara el encolado de confirmación + recordatorios (que no se mandaron
 *     al crear el turno porque estaba esperando pago).
 *
 * El monto por defecto lo dicta appointment_settings:
 *  - prepayment_type='fixed'      → precio del servicio
 *  - prepayment_type='percentage' → precio * prepayment_percentage / 100
 */
export async function confirmAppointmentPrepayment(input: ConfirmPrepaymentInput) {
  if (!isValidUUID(input.appointmentId)) return { error: 'ID inválido' }

  const supabase = createAdminClient()

  const { data: appointment } = await supabase
    .from('appointments')
    .select('*, service:service_id(id, name, price), client:client_id(id, name, phone)')
    .eq('id', input.appointmentId)
    .single()

  if (!appointment) return { error: 'Turno no encontrado' }
  if (appointment.status !== 'pending_payment') {
    return { error: 'El turno no está esperando pago' }
  }
  if (!appointment.barber_id) return { error: 'Asigná un barbero antes de confirmar el pago' }

  const access = await assertBranchAccess(appointment.branch_id)
  if (!access.ok) return { error: 'Sin acceso a esta sucursal' }

  const settings = await getAppointmentSettings(appointment.organization_id, appointment.branch_id)
  if (!settings) return { error: 'Settings no encontrados' }

  const servicePrice = Number(appointment.service?.price ?? 0)
  const defaultAmount = calculatePrepaymentAmount(settings, servicePrice)
  const amount = input.amount && input.amount > 0 ? input.amount : defaultAmount

  if (amount <= 0) return { error: 'Monto inválido — definí un precio en el servicio o pasá amount' }

  const { data: branch } = await supabase
    .from('branches')
    .select('id, organization_id, name, timezone')
    .eq('id', appointment.branch_id)
    .single()

  if (!branch) return { error: 'Sucursal no encontrada' }

  const visitPaymentMethod = mapAppointmentPaymentMethodToVisit(input.method)
  const now = new Date().toISOString()

  // Crea la visita (impacta caja/finanzas YA; queue_entry_id=NULL porque aún
  // no hubo servicio). El trigger on_queue_completed, cuando el servicio
  // eventualmente se complete, reutilizará esta visita via appointment_id.
  const { error: visitError } = await supabase
    .from('visits')
    .insert({
      organization_id: branch.organization_id,
      branch_id: appointment.branch_id,
      client_id: appointment.client_id,
      barber_id: appointment.barber_id,
      service_id: appointment.service_id,
      appointment_id: appointment.id,
      queue_entry_id: null,
      payment_method: visitPaymentMethod,
      payment_account_id: input.paymentAccountId ?? null,
      amount,
      commission_pct: 0,
      commission_amount: 0,
      started_at: now,
      completed_at: now,
      notes: input.notes?.trim() ? `[Prepago] ${input.notes.trim()}` : '[Prepago]',
    })

  if (visitError) return { error: 'Error al registrar pago: ' + visitError.message }

  // Decidir payment_status según si el amount cubre el total del servicio.
  const isFullPayment = servicePrice > 0 ? amount >= servicePrice : true
  const paymentStatus: 'paid' | 'partial' = isFullPayment ? 'paid' : 'partial'

  const { error: updateError } = await supabase
    .from('appointments')
    .update({
      status: 'confirmed',
      payment_status: paymentStatus,
      payment_amount: amount,
      payment_method: input.method,
      paid_at: now,
      paid_by_staff_id: input.staffId ?? null,
      payment_notes: input.notes?.trim() || null,
    })
    .eq('id', appointment.id)

  if (updateError) return { error: 'Error al actualizar turno: ' + updateError.message }

  // Encolar confirmación + recordatorios (no se mandaron al crear el turno).
  const dateFormatted = new Date(appointment.appointment_date + 'T12:00:00')
    .toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
  const managementUrl = await absoluteUrl(`/turnos/gestionar/${appointment.cancellation_token}`)

  await scheduleAppointmentMessages(
    {
      orgId: branch.organization_id,
      appointmentId: appointment.id,
      clientId: appointment.client_id,
      phone: appointment.client?.phone ?? '',
      clientName: appointment.client?.name ?? '',
      serviceName: appointment.service?.name ?? '',
      branchName: branch.name,
      dateFormatted,
      startTime: appointment.start_time,
      appointmentDateTime: new Date(`${appointment.appointment_date}T${appointment.start_time}:00`),
      managementUrl,
    },
    settings,
    'create'
  )

  revalidatePath('/dashboard/turnos/agenda')
  revalidatePath('/dashboard/fila')
  revalidatePath('/dashboard/finanzas')
  revalidatePath('/dashboard/caja')
  return { success: true, amount, paymentStatus }
}

/**
 * Mapea el método de pago del turno al enum `payment_method` de visits
 * (cash/card/transfer). MercadoPago y transferencia se cuentan como transfer;
 * tarjetas como card; efectivo como cash; 'otro' como transfer (fallback).
 */
function mapAppointmentPaymentMethodToVisit(method: AppointmentPaymentMethod): 'cash' | 'card' | 'transfer' {
  switch (method) {
    case 'efectivo': return 'cash'
    case 'tarjeta_debito':
    case 'tarjeta_credito': return 'card'
    case 'transferencia':
    case 'mercadopago':
    case 'otro': return 'transfer'
  }
}

// ─── Queries ────────────────────────────────────────────────────────

/**
 * Listado público (rate-limited) de barberos habilitados para turnos en una
 * sucursal. Devuelve sólo nombre + avatar — seguro para exponer en el turnero.
 */
export async function getPublicBranchAppointmentStaff(branchId: string) {
  const gate = await RateLimits.publicBookingList(branchId)
  if (!gate.allowed) return []

  if (!isValidUUID(branchId)) return []

  const supabase = createAdminClient()
  const { data: branch } = await supabase
    .from('branches')
    .select('organization_id')
    .eq('id', branchId)
    .eq('is_active', true)
    .maybeSingle()

  if (!branch) return []

  const { data } = await supabase
    .from('appointment_staff')
    .select('staff_id, staff:staff_id(id, full_name, branch_id, is_active, avatar_url)')
    .eq('organization_id', branch.organization_id)
    .eq('is_active', true)

  return (data ?? [])
    .filter((as: any) => as.staff?.branch_id === branchId && as.staff?.is_active)
    .map((as: any) => ({
      id: as.staff.id,
      full_name: as.staff.full_name,
      avatar_url: as.staff.avatar_url as string | null,
    }))
}

/**
 * Listado interno (sin rate-limit) de barberos habilitados para turnos en una
 * sucursal. Uso: dashboard/agenda, dialogs de mensajería.
 */
export async function getBranchAppointmentStaff(branchId: string) {
  const access = await assertBranchAccess(branchId)
  if (!access.ok) return []

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('appointment_staff')
    .select('staff_id, staff:staff_id(id, full_name, branch_id, is_active, avatar_url)')
    .eq('organization_id', access.orgId)
    .eq('is_active', true)

  return (data ?? [])
    .filter((as: any) => as.staff?.branch_id === branchId && as.staff?.is_active)
    .map((as: any) => ({
      id: as.staff.id as string,
      full_name: as.staff.full_name as string,
      avatar_url: as.staff.avatar_url as string | null,
    }))
}

export async function getAppointmentsForDate(branchId: string, date: string) {
  const access = await assertBranchAccess(branchId)
  if (!access.ok) return []

  const supabase = createAdminClient()

  const { data } = await supabase
    .from('appointments')
    .select('*, client:client_id(id, name, phone), barber:barber_id(id, full_name), service:service_id(id, name, price, duration_minutes)')
    .eq('branch_id', branchId)
    .eq('appointment_date', date)
    .not('status', 'in', '("cancelled")')
    .order('start_time')

  return (data ?? []) as Appointment[]
}

/**
 * Vista consolidada multi-sucursal (para owner/admin). Respeta el scope.
 */
export async function getAppointmentsForDateMultiBranch(branchIds: string[], date: string) {
  const filtered = await filterBranchesByAccess(branchIds)
  if (!filtered.length) return []

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('appointments')
    .select('*, client:client_id(id, name, phone), barber:barber_id(id, full_name), branch:branch_id(id, name), service:service_id(id, name, price, duration_minutes)')
    .in('branch_id', filtered)
    .eq('appointment_date', date)
    .not('status', 'in', '("cancelled")')
    .order('start_time')

  return (data ?? []) as Appointment[]
}

export async function getAppointmentsForBarber(barberId: string, date: string) {
  const supabase = createAdminClient()

  const { data } = await supabase
    .from('appointments')
    .select('*, client:client_id(id, name, phone), service:service_id(id, name, price, duration_minutes)')
    .eq('barber_id', barberId)
    .eq('appointment_date', date)
    .not('status', 'in', '("cancelled")')
    .order('start_time')

  return (data ?? []) as Appointment[]
}

export async function getAppointmentsForClient(clientId: string) {
  const supabase = createAdminClient()

  const { data } = await supabase
    .from('appointments')
    .select('*, branch:branch_id(id, name), barber:barber_id(id, full_name), service:service_id(id, name)')
    .eq('client_id', clientId)
    .order('appointment_date', { ascending: false })
    .order('start_time', { ascending: false })
    .limit(20)

  return (data ?? []) as Appointment[]
}

export async function getAppointmentByToken(token: string) {
  const gate = await RateLimits.publicBookingManage(token)
  if (!gate.allowed) return null

  const supabase = createAdminClient()

  const { data } = await supabase
    .from('appointments')
    .select('*, branch:branch_id(id, name, address, phone), barber:barber_id(id, full_name), service:service_id(id, name, price)')
    .eq('cancellation_token', token)
    .maybeSingle()

  if (!data) return null

  // Rechazar si el token expiró
  if (data.token_expires_at && new Date(data.token_expires_at) < new Date()) {
    return null
  }

  return data as Appointment
}
