/**
 * Lógica de encolado de recordatorios "jugá hoy" del Prode Mundial.
 *
 * ⚠️ NO es un módulo 'use server'. Vive acá (helper server-only) a propósito:
 * si se exportara desde un archivo 'use server', Next.js la registraría como un
 * endpoint de server-action invocable por cualquiera, y al recibir `orgId` por
 * parámetro permitiría que un anónimo dispare envíos de WhatsApp contra cualquier
 * tenant. La consumen: la server action sendReminders() (que deriva orgId de la
 * sesión) y el cron route /api/cron/prode-reminders (org hardcodeada Monaco).
 */
import { createAdminClient } from '@/lib/supabase/server'

export const REMINDER_TEMPLATE_NAME = 'prode_recordatorio'
// IMPORTANTE: debe coincidir EXACTAMENTE con el language que Meta registra para
// el template; si no, el envío falla con error 132001 (Known Risk #4).
export const REMINDER_TEMPLATE_LANGUAGE = 'es_AR'

/** Torneo "activo" de la org: active → upcoming → último por starts_at. */
async function resolveTournamentId(orgId: string): Promise<string | null> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('prode_tournament')
    .select('id, status, starts_at')
    .eq('organization_id', orgId)
    .order('starts_at', { ascending: false })

  if (!data || data.length === 0) return null
  const active = data.find((t) => t.status === 'active')
  if (active) return active.id
  const upcoming = data.find((t) => t.status === 'upcoming')
  if (upcoming) return upcoming.id
  return data[0].id
}

/**
 * Encola un recordatorio por cada participante que NO predijo el próximo partido
 * (dentro de ~24h, priorizando el destacado). Idempotente: skippea clientes que
 * ya tienen un prode_recordatorio encolado hoy (ARG). El cron
 * process-scheduled-messages se encarga del envío real a Meta.
 */
export async function enqueueProdeReminders(
  orgId: string
): Promise<{ enqueued: number; reason?: string }> {
  const supabase = createAdminClient()

  // 1) Torneo activo
  const tournamentId = await resolveTournamentId(orgId)
  if (!tournamentId) return { enqueued: 0, reason: 'Sin torneo configurado' }

  // 2) Partido objetivo: próximo 'scheduled' con kickoff > now y dentro de ~24h,
  //    priorizando is_featured.
  const nowMs = Date.now()
  const horizonIso = new Date(nowMs + 24 * 60 * 60 * 1000).toISOString()
  const { data: matches, error: matchErr } = await supabase
    .from('prode_matches')
    .select('id, home_team_label, away_team_label, kickoff_at, is_featured')
    .eq('organization_id', orgId)
    .eq('tournament_id', tournamentId)
    .eq('status', 'scheduled')
    .gt('kickoff_at', new Date(nowMs).toISOString())
    .lte('kickoff_at', horizonIso)
    .order('kickoff_at', { ascending: true })

  if (matchErr) {
    console.error('[Prode] enqueue matches query', matchErr.message)
    return { enqueued: 0, reason: 'Error al buscar partidos' }
  }
  if (!matches || matches.length === 0) {
    return { enqueued: 0, reason: 'No hay partidos en las próximas 24h' }
  }

  // Preferir featured; si no hay, el primero por kickoff.
  const target = matches.find((m) => m.is_featured) ?? matches[0]
  const matchLabel = `${target.home_team_label ?? '?'} vs ${target.away_team_label ?? '?'}`

  // 3) Participantes que NO predijeron ese partido.
  const { data: participants, error: partErr } = await supabase
    .from('prode_participants')
    .select('id, display_name, client_id, clients(name, phone)')
    .eq('organization_id', orgId)
    .eq('tournament_id', tournamentId)

  if (partErr) {
    console.error('[Prode] enqueue participants query', partErr.message)
    return { enqueued: 0, reason: 'Error al buscar participantes' }
  }
  if (!participants || participants.length === 0) {
    return { enqueued: 0, reason: 'Sin participantes' }
  }

  // Predicciones existentes para el partido objetivo.
  const { data: preds } = await supabase
    .from('prode_match_predictions')
    .select('participant_id')
    .eq('organization_id', orgId)
    .eq('match_id', target.id)
  const predictedSet = new Set((preds ?? []).map((p) => p.participant_id))

  // 4) Idempotencia: clientes que YA tienen un scheduled_messages de
  //    prode_recordatorio creado hoy (ARG) — evita doble encolado.
  const todayArg = new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  }) // YYYY-MM-DD
  const startOfDayArgIso = new Date(`${todayArg}T00:00:00-03:00`).toISOString()
  const { data: alreadyQueued } = await supabase
    .from('scheduled_messages')
    .select('client_id')
    .eq('organization_id', orgId)
    .eq('template_name', REMINDER_TEMPLATE_NAME)
    .gte('created_at', startOfDayArgIso)
  const alreadySet = new Set((alreadyQueued ?? []).map((r) => r.client_id))

  // Canal WA org-scope (org-wide branch_id NULL preferido). Opcional para el cron.
  const { data: ch } = await supabase
    .from('social_channels')
    .select('id')
    .eq('organization_id', orgId)
    .eq('platform', 'whatsapp')
    .eq('is_active', true)
    .order('branch_id', { ascending: true, nullsFirst: true })
    .limit(1)
    .maybeSingle()
  const channelId: string | null = ch?.id ?? null

  // 5) Construir filas a encolar.
  const nowIso = new Date().toISOString()
  type ClientRel = { name: string | null; phone: string | null } | { name: string | null; phone: string | null }[] | null
  const rows: Array<Record<string, unknown>> = []
  for (const p of participants) {
    if (predictedSet.has(p.id)) continue
    if (!p.client_id || alreadySet.has(p.client_id)) continue

    const rel = p.clients as ClientRel
    const client = Array.isArray(rel) ? rel[0] : rel
    const phone = client?.phone
    if (!phone) continue

    const fullName = (client?.name ?? p.display_name ?? '').trim()
    const firstName = fullName.split(/\s+/)[0] || 'crack'

    rows.push({
      organization_id: orgId,
      client_id: p.client_id,
      phone,
      template_name: REMINDER_TEMPLATE_NAME,
      template_language: REMINDER_TEMPLATE_LANGUAGE,
      template_params: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: firstName },
            { type: 'text', text: matchLabel },
          ],
        },
      ],
      scheduled_for: nowIso,
      status: 'pending',
      channel_id: channelId,
    })
  }

  if (rows.length === 0) {
    return { enqueued: 0, reason: 'Todos los participantes ya jugaron o ya fueron notificados' }
  }

  const BATCH = 500
  let enqueued = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    const { error } = await supabase.from('scheduled_messages').insert(batch)
    if (error) {
      console.error('[Prode] enqueue insert', error.message)
      continue
    }
    enqueued += batch.length
  }

  return { enqueued }
}
