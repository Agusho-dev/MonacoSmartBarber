'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getCurrentOrgId } from './org'
import { assertBranchAccess } from './branch-access'
import { absoluteUrl } from '@/lib/app-url'
import { isValidUUID } from '@/lib/validation'
import { RateLimits } from '@/lib/rate-limit'
import type { AppointmentWaitlist } from '@/lib/types/database'

const WAITLIST_NOTIFICATION_WINDOW_HOURS = 2

// ─── Queries ───────────────────────────────────────────────────────

export async function listWaitlist(branchId: string) {
  const access = await assertBranchAccess(branchId)
  if (!access.ok) return []

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('appointment_waitlist')
    .select('*, client:client_id(id, name, phone), service:service_id(id, name), barber:barber_id(id, full_name)')
    .eq('branch_id', branchId)
    .in('status', ['waiting', 'notified'])
    .order('created_at', { ascending: true })

  return (data ?? []) as AppointmentWaitlist[]
}

// ─── Add to waitlist ───────────────────────────────────────────────

interface AddToWaitlistInput {
  branchId: string
  clientPhone: string
  clientName: string
  serviceId?: string | null
  barberId?: string | null
  preferredDateFrom: string
  preferredDateTo: string
  preferredTimeFrom?: string | null
  preferredTimeTo?: string | null
  source: 'public' | 'manual'
  notes?: string
}

export async function addToWaitlist(input: AddToWaitlistInput) {
  if (input.source === 'public') {
    const gate = await RateLimits.publicBookingCreateByIp()
    if (!gate.allowed) return { error: 'Demasiadas solicitudes' }
  }

  if (!isValidUUID(input.branchId)) return { error: 'Sucursal inválida' }

  const supabase = createAdminClient()

  const { data: branch } = await supabase
    .from('branches')
    .select('id, organization_id')
    .eq('id', input.branchId)
    .eq('is_active', true)
    .single()

  if (!branch) return { error: 'Sucursal no encontrada' }
  const orgId = branch.organization_id

  if (input.source === 'manual') {
    const access = await assertBranchAccess(input.branchId)
    if (!access.ok) return { error: 'Sin acceso a esta sucursal' }
  }

  // Upsert cliente
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

  // Evitar duplicados activos
  const { data: existing } = await supabase
    .from('appointment_waitlist')
    .select('id')
    .eq('organization_id', orgId)
    .eq('branch_id', input.branchId)
    .eq('client_id', clientId)
    .in('status', ['waiting', 'notified'])
    .limit(1)

  if (existing?.length) {
    return { error: 'Ya estás en la lista de espera' }
  }

  const accessToken = crypto.randomUUID().replace(/-/g, '')

  const { data: entry, error } = await supabase
    .from('appointment_waitlist')
    .insert({
      organization_id: orgId,
      branch_id: input.branchId,
      client_id: clientId,
      service_id: input.serviceId ?? null,
      barber_id: input.barberId ?? null,
      preferred_date_from: input.preferredDateFrom,
      preferred_date_to: input.preferredDateTo,
      preferred_time_from: input.preferredTimeFrom ?? null,
      preferred_time_to: input.preferredTimeTo ?? null,
      status: 'waiting',
      access_token: accessToken,
      source: input.source,
      notes: input.notes ?? null,
    })
    .select('*')
    .single()

  if (error) return { error: error.message }

  revalidatePath('/dashboard/turnos/agenda')
  return { success: true, entry }
}

export async function removeFromWaitlist(entryId: string) {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Sin sesión' }

  const supabase = createAdminClient()
  const { data: entry } = await supabase
    .from('appointment_waitlist')
    .select('id, branch_id, organization_id')
    .eq('id', entryId)
    .single()

  if (!entry || entry.organization_id !== orgId) return { error: 'No encontrado' }

  const access = await assertBranchAccess(entry.branch_id)
  if (!access.ok) return { error: 'Sin acceso a esta sucursal' }

  const { error } = await supabase
    .from('appointment_waitlist')
    .update({ status: 'cancelled' })
    .eq('id', entryId)

  if (error) return { error: error.message }

  revalidatePath('/dashboard/turnos/agenda')
  return { success: true }
}

// ─── Auto-notify al liberarse un slot ──────────────────────────────

interface NotifyContext {
  orgId: string
  branchId: string
  serviceId: string | null
  barberId: string | null
  date: string
}

export async function notifyNextWaitlistCandidate(ctx: NotifyContext) {
  const supabase = createAdminClient()

  // Buscar el primer candidato que matchea (FIFO por created_at)
  let query = supabase
    .from('appointment_waitlist')
    .select('id, client_id, service_id, barber_id, preferred_date_from, preferred_date_to, access_token, branch:branch_id(name)')
    .eq('organization_id', ctx.orgId)
    .eq('branch_id', ctx.branchId)
    .eq('status', 'waiting')
    .lte('preferred_date_from', ctx.date)
    .gte('preferred_date_to', ctx.date)
    .order('created_at', { ascending: true })
    .limit(5)

  const { data: candidates } = await query
  if (!candidates?.length) return { notified: 0 }

  // Filtrar por barbero/servicio cuando está especificado
  const match = candidates.find(c => {
    if (c.barber_id && ctx.barberId && c.barber_id !== ctx.barberId) return false
    if (c.service_id && ctx.serviceId && c.service_id !== ctx.serviceId) return false
    return true
  })

  if (!match) return { notified: 0 }

  // Marcar como notificado
  const notifExpiresAt = new Date()
  notifExpiresAt.setHours(notifExpiresAt.getHours() + WAITLIST_NOTIFICATION_WINDOW_HOURS)

  await supabase
    .from('appointment_waitlist')
    .update({
      status: 'notified',
      notified_at: new Date().toISOString(),
      notification_expires_at: notifExpiresAt.toISOString(),
      notification_count: 1,
    })
    .eq('id', match.id)

  // Encolar mensaje de notificación
  try {
    const { data: settings } = await supabase
      .from('appointment_settings')
      .select('waitlist_template_id')
      .eq('organization_id', ctx.orgId)
      .or(`branch_id.eq.${ctx.branchId},branch_id.is.null`)
      .order('branch_id', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()

    const { data: client } = await supabase
      .from('clients')
      .select('name, phone')
      .eq('id', match.client_id)
      .single()

    if (!client?.phone) return { notified: 1 }

    const { data: channel } = await supabase
      .from('social_channels')
      .select('id')
      .eq('organization_id', ctx.orgId)
      .eq('platform', 'whatsapp')
      .is('branch_id', null)
      .eq('is_active', true)
      .maybeSingle()

    const bookUrl = await absoluteUrl(`/turnos/espera/${match.access_token}`)
    const branchName = (match.branch as any)?.name ?? ''

    const row: Record<string, unknown> = {
      organization_id: ctx.orgId,
      client_id: match.client_id,
      channel_id: channel?.id ?? null,
      scheduled_for: new Date().toISOString(),
      phone: client.phone,
      status: 'pending',
    }

    if (settings?.waitlist_template_id) {
      const { data: tpl } = await supabase
        .from('message_templates')
        .select('name')
        .eq('id', settings.waitlist_template_id)
        .maybeSingle()

      if (tpl?.name) {
        row.template_id = settings.waitlist_template_id
        row.template_name = tpl.name
        row.template_params = [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: client.name ?? '' },
              { type: 'text', text: ctx.date },
              { type: 'text', text: branchName },
              { type: 'text', text: bookUrl },
            ],
          },
        ]
      } else {
        row.content = `Se liberó un turno en ${branchName} para el ${ctx.date}. Reservalo acá: ${bookUrl}`
      }
    } else {
      row.content = `Se liberó un turno en ${branchName} para el ${ctx.date}. Reservalo acá: ${bookUrl}`
    }

    await supabase.from('scheduled_messages').insert(row)
  } catch (e) {
    console.error('[Waitlist] Error notificando candidato:', e)
  }

  return { notified: 1, candidateId: match.id }
}

// ─── Public: activar reserva desde link ────────────────────────────

export async function getWaitlistByToken(token: string) {
  const gate = await RateLimits.publicBookingManage(token)
  if (!gate.allowed) return null

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('appointment_waitlist')
    .select('*, client:client_id(id, name, phone), service:service_id(id, name, duration_minutes), branch:branch_id(id, name, address)')
    .eq('access_token', token)
    .maybeSingle()

  if (!data) return null
  if (data.status === 'expired' || data.status === 'cancelled') return null

  // Si está notificado, chequear ventana
  if (data.status === 'notified' && data.notification_expires_at) {
    if (new Date(data.notification_expires_at) < new Date()) {
      // Expirado — marcar y devolver null
      await supabase
        .from('appointment_waitlist')
        .update({ status: 'expired' })
        .eq('id', data.id)
      return null
    }
  }

  return data as AppointmentWaitlist
}

export async function markWaitlistBooked(entryId: string, appointmentId: string) {
  const supabase = createAdminClient()
  await supabase
    .from('appointment_waitlist')
    .update({
      status: 'booked',
      booked_appointment_id: appointmentId,
    })
    .eq('id', entryId)
}
