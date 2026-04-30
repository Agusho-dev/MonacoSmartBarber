// Edge Function: procesa recordatorios push de turnos pendientes.
// Disparada por pg_cron cada 1 minuto (migración 122).
//
// Flujo:
// 1. Verifica Authorization: Bearer ${CRON_SECRET}.
// 2. Consulta appointment_reminders pendientes con scheduled_for <= now()
//    y cuyo appointment esté en estado scheduled/confirmed.
// 3. Por cada uno: lookup tokens activos, construye payload por kind
//    (push_24h / push_2h), envía via Expo y persiste sent/failed/skipped.
// 4. Cada falla individual no rompe el lote.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendExpoPush } from './push-sender.ts'
import type { PendingReminder, ReminderResult } from './types.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const BATCH_SIZE = 100

Deno.serve(async (req: Request) => {
  // 1. Auth
  const cronSecret = Deno.env.get('CRON_SECRET')
  const authHeader = req.headers.get('Authorization')

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    // 2. Lookup reminders + appointment info en una sola query con embeds
    const { data: rawReminders, error: fetchErr } = await supabase
      .from('appointment_reminders')
      .select(`
        id,
        appointment_id,
        organization_id,
        kind,
        scheduled_for,
        appointments!inner (
          status,
          appointment_date,
          start_time,
          duration_minutes,
          client_id,
          clients:client_id ( name ),
          branches:branch_id ( name, address, timezone ),
          staff:barber_id ( full_name ),
          appointment_services ( sort_order, services:service_id ( name ) )
        )
      `)
      .eq('status', 'pending')
      .lte('scheduled_for', new Date().toISOString())
      .in('appointments.status', ['scheduled', 'confirmed'])
      .order('scheduled_for', { ascending: true })
      .limit(BATCH_SIZE)

    if (fetchErr) {
      console.error('[push-reminders] fetch error:', fetchErr.message)
      return new Response(
        JSON.stringify({ error: 'fetch_failed', detail: fetchErr.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    if (!rawReminders || rawReminders.length === 0) {
      return new Response(
        JSON.stringify({ processed: 0, results: [] }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }

    // 3. Mapear filas embed a PendingReminder
    const reminders: PendingReminder[] = (rawReminders as unknown as Array<Record<string, unknown>>)
      .map((r) => {
        const appt = r.appointments as Record<string, unknown> | undefined
        if (!appt) return null
        const client = (appt.clients as Record<string, unknown> | undefined) ?? {}
        const branch = (appt.branches as Record<string, unknown> | undefined) ?? {}
        const staffRow = appt.staff as Record<string, unknown> | undefined
        const services = (appt.appointment_services as Array<{ sort_order: number; services: { name: string } | null }> | undefined) ?? []
        const sortedServices = [...services].sort((a, b) => a.sort_order - b.sort_order)

        return {
          id: r.id as string,
          appointment_id: r.appointment_id as string,
          organization_id: r.organization_id as string,
          kind: r.kind as PendingReminder['kind'],
          scheduled_for: r.scheduled_for as string,
          appointment_status: appt.status as string,
          starts_at_local: '',
          appointment_date: appt.appointment_date as string,
          start_time: appt.start_time as string,
          client_id: appt.client_id as string,
          client_name: (client.name as string) ?? null,
          branch_name: (branch.name as string) ?? null,
          branch_address: (branch.address as string) ?? null,
          branch_timezone: (branch.timezone as string) ?? 'America/Argentina/Buenos_Aires',
          barber_name: (staffRow?.full_name as string) ?? null,
          service_names: sortedServices.map((s) => s.services?.name ?? 'Servicio').filter(Boolean),
          duration_minutes: (appt.duration_minutes as number) ?? 0,
        }
      })
      .filter((r): r is PendingReminder => r !== null)

    // 4. Procesar uno por uno (cada falla aislada)
    const results: ReminderResult[] = []
    for (const reminder of reminders) {
      const r = await processReminder(reminder)
      results.push(r)
    }

    return new Response(
      JSON.stringify({ processed: results.length, results }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    const err = error as Error
    console.error('[push-reminders] uncaught:', err.message)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})

async function processReminder(reminder: PendingReminder): Promise<ReminderResult> {
  try {
    // Branch por kind: push_* usa Expo, wa_* delega al sistema de scheduled_messages
    if (reminder.kind === 'wa_24h' || reminder.kind === 'wa_2h') {
      return await processWhatsAppReminder(reminder)
    }

    // push_24h | push_2h
    const { data: tokens, error: tokensErr } = await supabase
      .from('client_device_tokens')
      .select('token, platform')
      .eq('client_id', reminder.client_id)
      .eq('is_active', true)

    if (tokensErr) {
      console.error(
        `[push-reminders] tokens error client=${reminder.client_id} reminder=${reminder.id}:`,
        tokensErr.message
      )
      return await markReminder(reminder.id, 'failed', `tokens: ${tokensErr.message}`)
    }

    if (!tokens || tokens.length === 0) {
      return await markReminder(reminder.id, 'skipped', null)
    }

    const { title, body } = buildPushPayload(reminder)
    const pushData: Record<string, unknown> = {
      type: 'appointment_reminder',
      appointment_id: reminder.appointment_id,
      kind: reminder.kind,
    }

    let atLeastOneSent = false
    const errors: string[] = []
    for (const { token } of tokens) {
      const { success, error: pushError } = await sendExpoPush(token, title, body, pushData)
      if (success) atLeastOneSent = true
      else if (pushError) errors.push(pushError)
    }

    if (atLeastOneSent) {
      return await markReminder(reminder.id, 'sent', null)
    }

    const combinedError = errors.join('; ')
    console.error(
      `[push-reminders] todos los tokens fallaron reminder=${reminder.id}:`,
      combinedError
    )
    return await markReminder(reminder.id, 'failed', combinedError)
  } catch (e: unknown) {
    const err = e as Error
    console.error(`[push-reminders] excepción reminder=${reminder.id}:`, err.message)
    return await markReminder(reminder.id, 'failed', `excepción: ${err.message}`)
  }
}

function buildPushPayload(r: PendingReminder): { title: string; body: string } {
  // start_time ya es 'HH:MM:SS' local — extraemos HH:MM
  const timeStr = r.start_time.slice(0, 5)
  const barbero = r.barber_name ?? 'tu barbero'
  const sucursal = r.branch_name ?? 'la sucursal'
  const servicio = r.service_names.length > 0 ? r.service_names.join(' + ') : 'tu servicio'
  const direccion = r.branch_address ?? sucursal

  if (r.kind === 'push_24h') {
    return {
      title: 'Recordatorio de turno',
      body: `Mañana ${timeStr} hs — ${servicio} con ${barbero} en ${sucursal}`,
    }
  }
  if (r.kind === 'push_2h') {
    return {
      title: 'Tu turno es en 2 horas',
      body: `${timeStr} hs con ${barbero} · ${direccion}`,
    }
  }
  // Fallback (si llegan kinds wa_* sin v2 implementada)
  return {
    title: 'Recordatorio de turno',
    body: `${timeStr} hs con ${barbero} en ${sucursal}`,
  }
}

/**
 * Procesa un reminder de WhatsApp encolando un `scheduled_message`.
 * Si la org no tiene canal WA configurado, marca el reminder como 'skipped'
 * (no es error — el flow espera que producto active WA cuando esté listo).
 *
 * Esta función es deliberadamente conservadora: NO envía WhatsApp directo
 * porque eso ya está implementado en `process-scheduled-messages` con todo
 * el manejo de templates, language_code, retry, etc.
 */
async function processWhatsAppReminder(reminder: PendingReminder): Promise<ReminderResult> {
  // Verificar si la org tiene canal WhatsApp activo
  const { data: channel, error: chErr } = await supabase
    .from('social_channels')
    .select('id')
    .eq('organization_id', reminder.organization_id)
    .eq('channel_type', 'whatsapp')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (chErr) {
    console.error(`[wa-reminders] channel lookup reminder=${reminder.id}:`, chErr.message)
    return await markReminder(reminder.id, 'failed', `channel: ${chErr.message}`)
  }

  if (!channel) {
    // No hay canal WA — saltear silenciosamente (config esperada para v1)
    return await markReminder(reminder.id, 'skipped', null)
  }

  // Buscar template por convención de nombre: 'recordatorio_24h' o 'recordatorio_2h'
  const templateKey = reminder.kind === 'wa_24h' ? 'recordatorio_24h' : 'recordatorio_2h'

  const { data: template, error: tplErr } = await supabase
    .from('whatsapp_templates')
    .select('id')
    .eq('organization_id', reminder.organization_id)
    .eq('name', templateKey)
    .eq('status', 'APPROVED')
    .limit(1)
    .maybeSingle()

  if (tplErr) {
    console.error(`[wa-reminders] template lookup reminder=${reminder.id}:`, tplErr.message)
    return await markReminder(reminder.id, 'failed', `template: ${tplErr.message}`)
  }

  if (!template) {
    // Template no configurado — saltear (producto debe crear/aprobar en Meta primero)
    return await markReminder(reminder.id, 'skipped', null)
  }

  // Encolar scheduled_message para que process-scheduled-messages lo procese
  const { error: insErr } = await supabase.from('scheduled_messages').insert({
    organization_id: reminder.organization_id,
    channel_id: channel.id,
    template_id: template.id,
    appointment_id: reminder.appointment_id,
    client_id: reminder.client_id,
    scheduled_for: new Date().toISOString(),
    status: 'pending',
    template_variables: {
      cliente: reminder.client_name ?? 'Cliente',
      fecha: reminder.appointment_date,
      hora: reminder.start_time.slice(0, 5),
      barbero: reminder.barber_name ?? '',
      sucursal: reminder.branch_name ?? '',
      servicio: reminder.service_names.join(' + ') || 'Servicio',
    },
  })

  if (insErr) {
    console.error(`[wa-reminders] insert scheduled_message reminder=${reminder.id}:`, insErr.message)
    return await markReminder(reminder.id, 'failed', `enqueue: ${insErr.message}`)
  }

  return await markReminder(reminder.id, 'sent', null)
}

async function markReminder(
  reminderId: string,
  status: 'sent' | 'failed' | 'skipped',
  errorMessage: string | null
): Promise<ReminderResult> {
  const updateData: Record<string, unknown> = { status, error_message: errorMessage }
  if (status === 'sent') updateData.sent_at = new Date().toISOString()

  const { error: updateErr } = await supabase
    .from('appointment_reminders')
    .update(updateData)
    .eq('id', reminderId)

  if (updateErr) {
    console.error(
      `[push-reminders] update reminder=${reminderId} status=${status}:`,
      updateErr.message
    )
  }

  return { id: reminderId, status, error: errorMessage }
}
