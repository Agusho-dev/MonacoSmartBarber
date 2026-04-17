'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getCurrentOrgId, validateBranchAccess } from './org'
import type { Appointment, AppointmentSettings, AppointmentStaff } from '@/lib/types/database'

// ─── Settings ───────────────────────────────────────────────────────

export async function getAppointmentSettings(orgId?: string) {
  const resolvedOrgId = orgId || await getCurrentOrgId()
  if (!resolvedOrgId) return null

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('appointment_settings')
    .select('*')
    .eq('organization_id', resolvedOrgId)
    .maybeSingle()

  return data as AppointmentSettings | null
}

export async function updateAppointmentSettings(updates: Partial<AppointmentSettings>) {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Organización no encontrada' }

  const supabase = createAdminClient()

  const { data: existing } = await supabase
    .from('appointment_settings')
    .select('id')
    .eq('organization_id', orgId)
    .maybeSingle()

  const { organization_id: _, id: __, created_at: ___, updated_at: ____, ...safeUpdates } = updates as Record<string, unknown>

  if (existing) {
    const { error } = await supabase
      .from('appointment_settings')
      .update(safeUpdates)
      .eq('id', existing.id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase
      .from('appointment_settings')
      .insert({ ...safeUpdates, organization_id: orgId })
    if (error) return { error: error.message }
  }

  revalidatePath('/dashboard/configuracion')
  return { success: true }
}

// ─── Appointment Staff ──────────────────────────────────────────────

export async function getAppointmentStaff(orgId?: string) {
  const resolvedOrgId = orgId || await getCurrentOrgId()
  if (!resolvedOrgId) return []

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('appointment_staff')
    .select('*, staff:staff_id(id, full_name, branch_id, is_active)')
    .eq('organization_id', resolvedOrgId)
    .eq('is_active', true)

  return (data ?? []) as (AppointmentStaff & { staff: { id: string; full_name: string; branch_id: string; is_active: boolean } })[]
}

export async function toggleAppointmentStaff(staffId: string, isActive: boolean) {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Organización no encontrada' }

  const supabase = createAdminClient()

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
  const supabase = createAdminClient()

  const { data: branch } = await supabase
    .from('branches')
    .select('organization_id, timezone')
    .eq('id', branchId)
    .eq('is_active', true)
    .single()

  if (!branch) return { slots: [], error: 'Sucursal no encontrada' }

  const settings = await getAppointmentSettings(branch.organization_id)
  if (!settings?.is_enabled) return { slots: [], error: 'Turnos no habilitados' }

  const targetDate = new Date(date + 'T12:00:00')
  const dayOfWeek = targetDate.getDay()

  if (!settings.appointment_days.includes(dayOfWeek)) {
    return { slots: [], error: 'Día no habilitado para turnos' }
  }

  const today = new Date()
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

  // Cargar staff habilitado para turnos en esta sucursal
  const { data: appointmentStaff } = await supabase
    .from('appointment_staff')
    .select('staff_id, staff:staff_id(id, full_name, branch_id, is_active)')
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

  // Cargar horarios de trabajo para ese día
  const { data: schedules } = await supabase
    .from('staff_schedules')
    .select('staff_id, start_time, end_time')
    .in('staff_id', staffIds)
    .eq('day_of_week', dayOfWeek)
    .eq('is_active', true)

  // Cargar excepciones (ausencias)
  const { data: exceptions } = await supabase
    .from('staff_schedule_exceptions')
    .select('staff_id')
    .in('staff_id', staffIds)
    .eq('exception_date', date)
    .eq('is_absent', true)

  const absentStaff = new Set(exceptions?.map(e => e.staff_id) ?? [])

  // Cargar turnos existentes para ese día
  const { data: existingAppointments } = await supabase
    .from('appointments')
    .select('barber_id, start_time, end_time')
    .eq('branch_id', branchId)
    .eq('appointment_date', date)
    .not('status', 'in', '("cancelled","no_show")')

  const result: BarberAvailability[] = []

  for (const staffId of staffIds) {
    if (absentStaff.has(staffId)) continue

    const staffSchedules = schedules?.filter(s => s.staff_id === staffId) ?? []
    if (!staffSchedules.length) continue

    const staffRecord = branchStaff.find((s: any) => s.staff_id === staffId)
    const staffName = (staffRecord as any)?.staff?.full_name ?? ''
    const staffAppointments = existingAppointments?.filter(a => a.barber_id === staffId) ?? []

    // Generar slots
    const slots: AvailableSlot[] = []
    const openMinutes = timeToMinutes(settings.appointment_hours_open)
    const closeMinutes = timeToMinutes(settings.appointment_hours_close)

    for (let m = openMinutes; m + serviceDuration <= closeMinutes; m += settings.slot_interval_minutes) {
      const slotStart = minutesToTime(m)
      const slotEnd = minutesToTime(m + serviceDuration)

      const withinSchedule = staffSchedules.some(sch =>
        slotStart >= sch.start_time.substring(0, 5) && slotEnd <= sch.end_time.substring(0, 5)
      )

      if (!withinSchedule) {
        slots.push({ time: slotStart, available: false })
        continue
      }

      const overlaps = staffAppointments.some(appt => {
        const apptStart = appt.start_time.substring(0, 5)
        const apptEnd = appt.end_time.substring(0, 5)
        return slotStart < apptEnd && slotEnd > apptStart
      })

      // Si es hoy, excluir slots pasados
      const tz = branch.timezone || 'America/Argentina/Buenos_Aires'
      const nowInTz = new Date(new Date().toLocaleString('en-US', { timeZone: tz }))
      const isToday = date === nowInTz.toISOString().split('T')[0]
      const slotPassed = isToday && timeToMinutes(slotStart) <= nowInTz.getHours() * 60 + nowInTz.getMinutes()

      slots.push({ time: slotStart, available: !overlaps && !slotPassed })
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
  const supabase = createAdminClient()

  const { data: branch } = await supabase
    .from('branches')
    .select('id, organization_id, name')
    .eq('id', input.branchId)
    .eq('is_active', true)
    .single()

  if (!branch) return { error: 'Sucursal no encontrada' }
  const orgId = branch.organization_id

  const settings = await getAppointmentSettings(orgId)
  if (!settings?.is_enabled) return { error: 'Turnos no habilitados' }

  // Buscar o crear cliente
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

  // Calcular end_time
  const startMinutes = timeToMinutes(input.startTime)
  const endTime = minutesToTime(startMinutes + input.durationMinutes)

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

  // Generar token de cancelación
  const cancellationToken = crypto.randomUUID().replace(/-/g, '').substring(0, 24)

  // Obtener nombre del servicio para el mensaje
  let serviceName = ''
  if (input.serviceId) {
    const { data: service } = await supabase
      .from('services')
      .select('name')
      .eq('id', input.serviceId)
      .single()
    serviceName = service?.name ?? ''
  }

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
      status: 'confirmed',
      source: input.source,
      cancellation_token: cancellationToken,
      payment_flag: settings.payment_mode,
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

  // Programar mensaje de confirmación
  try {
    const { data: client } = await supabase
      .from('clients')
      .select('phone')
      .eq('id', clientId)
      .single()

    if (client?.phone) {
      const dateFormatted = new Date(input.appointmentDate + 'T12:00:00')
        .toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })

      if (settings.confirmation_template_name) {
        await supabase.from('scheduled_messages').insert({
          client_id: clientId,
          template_name: settings.confirmation_template_name,
          scheduled_for: new Date().toISOString(),
          phone: client.phone,
          status: 'pending',
        })
      } else {
        const managementUrl = `/turnos/gestionar/${cancellationToken}`
        const confirmationText = `Tu turno para ${serviceName} el ${dateFormatted} a las ${input.startTime} en ${branch.name} fue confirmado. Podés gestionar tu turno aquí: ${managementUrl}`
        await supabase.from('scheduled_messages').insert({
          client_id: clientId,
          content: confirmationText,
          scheduled_for: new Date().toISOString(),
          phone: client.phone,
          status: 'pending',
        })
      }

      // Programar recordatorio
      if (settings.reminder_hours_before > 0) {
        const appointmentDateTime = new Date(`${input.appointmentDate}T${input.startTime}:00`)
        const reminderTime = new Date(appointmentDateTime.getTime() - settings.reminder_hours_before * 60 * 60 * 1000)

        if (reminderTime > new Date()) {
          const reminderText = `Recordatorio: tenés un turno para ${serviceName} hoy a las ${input.startTime} en ${branch.name}.`

          if (settings.reminder_template_name) {
            await supabase.from('scheduled_messages').insert({
              client_id: clientId,
              template_name: settings.reminder_template_name,
              scheduled_for: reminderTime.toISOString(),
              phone: client.phone,
              status: 'pending',
            })
          } else {
            await supabase.from('scheduled_messages').insert({
              client_id: clientId,
              content: reminderText,
              scheduled_for: reminderTime.toISOString(),
              phone: client.phone,
              status: 'pending',
            })
          }
        }
      }
    }
  } catch (e) {
    console.error('[Appointments] Error programando mensajes:', e)
  }

  revalidatePath('/dashboard/fila')
  revalidatePath('/barbero/fila')
  return { success: true, appointment }
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

  if (cancelledBy === 'client') {
    const settings = await getAppointmentSettings(appointment.organization_id)
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

  // Cancelar mensajes programados pendientes para este cliente
  await supabase
    .from('scheduled_messages')
    .update({ status: 'cancelled' })
    .eq('client_id', appointment.client_id)
    .eq('status', 'pending')
    .gte('scheduled_for', new Date().toISOString())

  revalidatePath('/dashboard/fila')
  revalidatePath('/barbero/fila')
  return { success: true }
}

export async function cancelAppointmentByToken(token: string) {
  const supabase = createAdminClient()

  const { data: appointment } = await supabase
    .from('appointments')
    .select('id')
    .eq('cancellation_token', token)
    .maybeSingle()

  if (!appointment) return { error: 'Turno no encontrado' }
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
  if (!['confirmed', 'checked_in'].includes(appointment.status)) {
    return { error: 'El turno no está en un estado válido para marcar ausente' }
  }

  const settings = await getAppointmentSettings(appointment.organization_id)
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
  revalidatePath('/barbero/fila')
  return { success: true, queueEntryId: queueEntry.id }
}

// ─── Queries ────────────────────────────────────────────────────────

export async function getAppointmentsForDate(branchId: string, date: string) {
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
  const supabase = createAdminClient()

  const { data } = await supabase
    .from('appointments')
    .select('*, branch:branch_id(id, name, address, phone), barber:barber_id(id, full_name), service:service_id(id, name, price)')
    .eq('cancellation_token', token)
    .maybeSingle()

  return data as Appointment | null
}

