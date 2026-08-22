// Sender único de push a clientes (FCM HTTP v1). Lo invoca pg_cron cada minuto vía
// `trigger_send_push()` (mig 193), que antes corre `enqueue_due_appointment_reminders()`.
//
// Modelo — una sola cola de salida, `push_outbox`, espejando lo que ya funciona para WhatsApp
// (`scheduled_messages` + `claim_pending_messages` + cron): este proceso no decide A QUIÉN
// mandarle nada; eso lo decide quien encola (campañas del dashboard, triggers de turnos y
// premios, recordatorios). Acá sólo se entrega lo que está pendiente y se registra qué pasó.
//
// Por corrida:
//   1. `claim_pending_push(100)`: toma el lote atómicamente (FOR UPDATE SKIP LOCKED, attempts+1,
//      status='processing'). Dos crons solapados no se pisan.
//   2. Por fila (8 en vuelo): preferencia del cliente (`client_notification_preferences` según
//      `kind`) → tokens activos (`client_device_tokens`) → fila en `client_notifications` (la
//      bandeja in-app es el historial del push y su id viaja en el payload) → un POST a FCM por
//      token → persistir.
//   3. Al final: contadores y cierre de `push_campaigns`; estado de `appointment_reminders`.
//
// Reglas:
//   - Auth: `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` (deploy con --no-verify-jwt, igual
//     que process-scheduled-messages). El cron manda la service role key desde Vault.
//   - Chequear `error` de CADA insert/update y loguear con prefijo [send-push] (Known Risk #5).
//   - Sin `FCM_SERVICE_ACCOUNT_JSON`: el lote entero → `failed` 'FCM no configurado' y
//     200 `{ ok:false, reason:'FCM_NOT_CONFIGURED' }`. No tirar: tirar deja el lote en `processing`.
//   - Token UNREGISTERED / inválido → `client_device_tokens.is_active=false` + `last_error`.
//   - 429 / 5xx / timeout → vuelve a `pending` con backoff 5/15 min; al tercer intento, `failed`.
//   - Éxito en ≥1 token → `sent`. Sin ningún dispositivo válido o preferencia apagada → `skipped`.
//
// Deploy: supabase functions deploy send-push --no-verify-jwt   (ver README.md al lado)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  FcmAuthError,
  type FcmServiceAccount,
  getFcmAccessToken,
  loadFcmServiceAccount,
  resolveFcmProjectId,
  sendFcmMessage,
} from '../_shared/fcm.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const BATCH_SIZE = 100
const MAX_ATTEMPTS = 3
const CONCURRENCY = 8
/** Canal de Android. La app lo crea con flutter_local_notifications; sin canal, Android 8+ no muestra nada. */
const ANDROID_CHANNEL_ID = 'monaco_default'

// ---------------------------------------------------------------------------
// Tipos (shape EXACTO de CONTRACTS.md §3.3)
// ---------------------------------------------------------------------------

type OutboxKind = 'campaign' | 'appointment_reminder' | 'appointment_update' | 'reward' | 'points' | 'manual' | 'test'
type OutboxStatus = 'pending' | 'processing' | 'sent' | 'failed' | 'skipped' | 'cancelled'

interface PushOutboxRow {
  id: string
  organization_id: string
  client_id: string
  kind: OutboxKind
  title: string
  body: string
  image_url: string | null
  data: Record<string, unknown> | null
  deep_link: string | null
  campaign_id: string | null
  appointment_reminder_id: string | null
  appointment_id: string | null
  scheduled_for: string
  status: OutboxStatus
  attempts: number
  last_attempt_at: string | null
  last_error: string | null
  sent_at: string | null
}

interface DeviceTokenRow {
  id: string
  token: string
  platform: 'ios' | 'android'
}

interface PreferencesRow {
  campaigns: boolean
  appointment_reminders: boolean
  appointment_updates: boolean
  rewards: boolean
}
type PreferenceFlag = keyof PreferencesRow

/** Qué preferencia gobierna cada kind. `null` = se manda siempre (manual / test). */
const PREFERENCE_BY_KIND: Record<OutboxKind, PreferenceFlag | null> = {
  campaign: 'campaigns',
  appointment_reminder: 'appointment_reminders',
  appointment_update: 'appointment_updates',
  reward: 'rewards',
  points: 'rewards',
  manual: null,
  test: null,
}

const PREFERENCE_LABEL: Record<PreferenceFlag, string> = {
  campaigns: 'las campañas',
  appointment_reminders: 'los recordatorios de turno',
  appointment_updates: 'los avisos de cambios de turno',
  rewards: 'los avisos de premios y puntos',
}

/** `client_notifications.type` (CHECK de la mig 193). `manual` no tiene tipo propio: va como `alert`. */
const NOTIFICATION_TYPE_BY_KIND: Record<OutboxKind, string> = {
  campaign: 'campaign',
  appointment_reminder: 'appointment_reminder',
  appointment_update: 'appointment_update',
  reward: 'reward',
  points: 'points',
  manual: 'alert',
  test: 'test',
}

/** `data.type` del payload (CONTRACTS §6.7). `manual` viaja como `campaign`: el handler lo rutea a /home. */
const PAYLOAD_TYPE_BY_KIND: Record<OutboxKind, string> = {
  campaign: 'campaign',
  appointment_reminder: 'appointment_reminder',
  appointment_update: 'appointment_update',
  reward: 'reward',
  points: 'points',
  manual: 'campaign',
  test: 'test',
}

type Outcome =
  | { status: 'sent' }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string }
  /** Vuelve a `pending` con backoff. */
  | { status: 'retry'; error: string }

interface RunStats {
  processed: number
  sent: number
  failed: number
  skipped: number
  retrying: number
}

interface SendContext {
  projectId: string
  accessToken: string
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get('Authorization')
  if (authHeader !== `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    // Claim atómico: incrementa attempts, marca processing, devuelve el lote.
    const { data: claimed, error: claimErr } = await supabase
      .rpc('claim_pending_push', { p_batch_size: BATCH_SIZE })

    if (claimErr) {
      console.error('[send-push] claim_pending_push RPC error:', claimErr.message)
      throw claimErr
    }

    const rows = (claimed ?? []) as PushOutboxRow[]
    if (rows.length === 0) {
      return json({ ok: true, processed: 0, sent: 0, failed: 0, skipped: 0, retrying: 0 })
    }

    const campaignIds = new Set<string>()
    const stats: RunStats = { processed: rows.length, sent: 0, failed: 0, skipped: 0, retrying: 0 }

    // --- Configuración de FCM -------------------------------------------------------------
    let serviceAccount: FcmServiceAccount | null = null
    let configError: string | null = null
    try {
      serviceAccount = loadFcmServiceAccount()
    } catch (e) {
      configError = e instanceof Error ? e.message : String(e)
    }

    if (!serviceAccount) {
      // Modo sin Firebase: no se tira, se deja constancia en cada fila y se contesta 200.
      const reason = configError ? `FCM mal configurado: ${configError}` : 'FCM no configurado'
      console.error(`[send-push] ${reason}; ${rows.length} push marcados failed`)
      await processWithConcurrency(rows, CONCURRENCY, async (row) => {
        await persistOutcome(row, { status: 'failed', error: reason })
        if (row.campaign_id) campaignIds.add(row.campaign_id)
        stats.failed++
      })
      await finalizeCampaigns(campaignIds)
      return json({ ok: false, reason: 'FCM_NOT_CONFIGURED', ...stats })
    }

    const projectId = resolveFcmProjectId(serviceAccount)

    // --- Access token: UNA vez por corrida (cacheado 50 min en el isolate) ------------------
    let accessToken: string
    try {
      accessToken = await getFcmAccessToken(serviceAccount)
    } catch (e) {
      const retryable = e instanceof FcmAuthError ? e.retryable : true
      const detail = e instanceof Error ? e.message : String(e)
      const reason = `FCM: no se pudo obtener el access token — ${detail}`
      console.error('[send-push]', reason)
      await processWithConcurrency(rows, CONCURRENCY, async (row) => {
        const outcome = retryable ? retryOrFail(row, reason) : ({ status: 'failed', error: reason } as Outcome)
        await persistOutcome(row, outcome)
        if (row.campaign_id) campaignIds.add(row.campaign_id)
        bump(stats, outcome)
      })
      await finalizeCampaigns(campaignIds)
      return json({ ok: false, reason: 'FCM_AUTH_FAILED', ...stats })
    }

    const ctx: SendContext = { projectId, accessToken }

    // --- Lote -----------------------------------------------------------------------------
    await processWithConcurrency(rows, CONCURRENCY, async (row) => {
      let outcome: Outcome
      try {
        outcome = await processRow(row, ctx)
      } catch (e) {
        // Nada de lo de adentro debería tirar; si pasa, que la fila no quede en `processing`.
        const detail = e instanceof Error ? e.message : String(e)
        console.error(`[send-push] error inesperado outbox=${row.id}:`, detail)
        outcome = retryOrFail(row, `Error inesperado: ${detail}`)
      }
      await persistOutcome(row, outcome)
      if (row.campaign_id) campaignIds.add(row.campaign_id)
      bump(stats, outcome)
    })

    await finalizeCampaigns(campaignIds)

    return json({ ok: true, ...stats })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[send-push] unhandled error:', message)
    return json({ error: message }, 500)
  }
})

// ---------------------------------------------------------------------------
// Por fila
// ---------------------------------------------------------------------------

async function processRow(row: PushOutboxRow, ctx: SendContext): Promise<Outcome> {
  const kind = row.kind
  if (!(kind in PREFERENCE_BY_KIND)) {
    return { status: 'failed', error: `kind desconocido: ${String(kind)}` }
  }

  // 1. Preferencia del cliente. Sin fila = todo en true (defaults de la tabla).
  const flag = PREFERENCE_BY_KIND[kind]
  if (flag) {
    const { data: prefs, error: prefErr } = await supabase
      .from('client_notification_preferences')
      .select('campaigns, appointment_reminders, appointment_updates, rewards')
      .eq('client_id', row.client_id)
      .maybeSingle()
    if (prefErr) {
      console.error(`[send-push] client_notification_preferences error outbox=${row.id}:`, prefErr.message)
      return retryOrFail(row, `No se pudo leer la preferencia del cliente: ${prefErr.message}`)
    }
    const p = prefs as PreferencesRow | null
    if (p && p[flag] === false) {
      return { status: 'skipped', reason: `El cliente desactivó ${PREFERENCE_LABEL[flag]}` }
    }
  }

  // 2. Tokens activos del cliente.
  const { data: tokensData, error: tokErr } = await supabase
    .from('client_device_tokens')
    .select('id, token, platform')
    .eq('client_id', row.client_id)
    .eq('is_active', true)
  if (tokErr) {
    console.error(`[send-push] client_device_tokens error outbox=${row.id}:`, tokErr.message)
    return retryOrFail(row, `No se pudieron leer los dispositivos del cliente: ${tokErr.message}`)
  }
  const tokens = (tokensData ?? []) as DeviceTokenRow[]
  if (tokens.length === 0) {
    return { status: 'skipped', reason: 'Sin dispositivos con la app (ningún token activo)' }
  }

  // 3. Bandeja in-app ANTES de enviar: el id viaja en el payload (`notification_id`) para que la
  //    app marque la notificación como leída al tocarla. Si al final no se envió a nadie, se borra.
  const payloadType = PAYLOAD_TYPE_BY_KIND[kind]
  const rawData = isPlainObject(row.data) ? row.data : {}
  const value = typeof rawData.value === 'string' && rawData.value
    ? rawData.value
    : (row.appointment_id ?? row.campaign_id ?? '')
  const deepLink = row.deep_link ?? (typeof rawData.deep_link === 'string' ? rawData.deep_link : '')

  const { data: notif, error: notifErr } = await supabase
    .from('client_notifications')
    .insert({
      client_id: row.client_id,
      organization_id: row.organization_id,
      type: NOTIFICATION_TYPE_BY_KIND[kind],
      title: row.title,
      body: row.body,
      data: { ...rawData, type: payloadType, value, deep_link: deepLink },
      deep_link: deepLink || null,
      push_outbox_id: row.id,
      is_read: false,
    })
    .select('id')
    .single()
  if (notifErr) {
    // El push es lo que importa: se manda igual, sin id de bandeja, y queda registrado.
    console.error(`[send-push] client_notifications.insert error outbox=${row.id}:`, notifErr.message)
  }
  const notificationId: string | null = (notif as { id?: string } | null)?.id ?? null

  // Badge de iOS = no leídas del cliente (con la recién insertada). Si falla, 1.
  let badge = 1
  const { count: unread, error: cntErr } = await supabase
    .from('client_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', row.client_id)
    .eq('is_read', false)
  if (cntErr) {
    console.error(`[send-push] client_notifications.count error outbox=${row.id}:`, cntErr.message)
  } else if (typeof unread === 'number' && unread > 0) {
    badge = unread
  }

  const data: Record<string, string> = {
    ...stringifyValues(rawData),
    type: payloadType,
    value,
    deep_link: deepLink,
    notification_id: notificationId ?? '',
  }

  // 4. Un POST por token. La concurrencia es entre filas; acá es secuencial (1–2 tokens por cliente).
  let successes = 0
  let deactivated = 0
  let retryableError: string | null = null
  let fatalError: string | null = null

  for (const tok of tokens) {
    const result = await sendFcmMessage(
      {
        projectId: ctx.projectId,
        token: tok.token,
        notification: { title: row.title, body: row.body, image: row.image_url ?? undefined },
        data,
        androidChannelId: ANDROID_CHANNEL_ID,
        badge,
      },
      { accessToken: ctx.accessToken },
    )

    if (result.ok) {
      successes++
      continue
    }

    const detail = [
      result.kind,
      result.code ? `(${result.code})` : null,
      result.status ? `HTTP ${result.status}` : null,
      `${tok.platform}:`,
      result.error,
    ].filter(Boolean).join(' ')

    if (result.kind === 'unregistered' || result.kind === 'invalid') {
      await deactivateToken(tok, detail)
      deactivated++
    } else if (result.kind === 'retryable') {
      retryableError = detail
    } else {
      fatalError = detail
    }
  }

  if (successes > 0) return { status: 'sent' }

  // No salió por ningún lado: la bandeja no puede anunciar algo que no llegó.
  if (notificationId) await deleteNotification(notificationId)

  if (retryableError) return retryOrFail(row, retryableError)
  if (fatalError) return { status: 'failed', error: fatalError }
  return {
    status: 'skipped',
    reason: `Sin dispositivos válidos: ${deactivated} token(s) dado(s) de baja por FCM (no registrado o inválido)`,
  }
}

async function deactivateToken(tok: DeviceTokenRow, detail: string): Promise<void> {
  const { error } = await supabase
    .from('client_device_tokens')
    .update({ is_active: false, last_error: detail.slice(0, 500), last_error_at: new Date().toISOString() })
    .eq('id', tok.id)
  if (error) console.error(`[send-push] client_device_tokens.update (baja) error token=${tok.id}:`, error.message)
}

async function deleteNotification(notificationId: string): Promise<void> {
  const { error } = await supabase.from('client_notifications').delete().eq('id', notificationId)
  if (error) console.error(`[send-push] client_notifications.delete error id=${notificationId}:`, error.message)
}

// ---------------------------------------------------------------------------
// Persistencia del resultado
// ---------------------------------------------------------------------------

function retryOrFail(row: PushOutboxRow, error: string): Outcome {
  // `attempts` ya viene incrementado por el claim (1 en el primer intento).
  return (row.attempts ?? 1) < MAX_ATTEMPTS ? { status: 'retry', error } : { status: 'failed', error }
}

/** Backoff: 5 min, 15 min, 45 min según el intento (mismo esquema que process-scheduled-messages). */
function backoffMinutes(attempts: number): number {
  return Math.pow(3, Math.max(0, (attempts ?? 1) - 1)) * 5
}

async function persistOutcome(row: PushOutboxRow, outcome: Outcome): Promise<void> {
  const nowIso = new Date().toISOString()
  let update: Record<string, unknown>
  switch (outcome.status) {
    case 'sent':
      update = { status: 'sent', sent_at: nowIso, last_error: null }
      break
    case 'skipped':
      update = { status: 'skipped', last_error: outcome.reason }
      break
    case 'failed':
      update = { status: 'failed', last_error: outcome.error }
      break
    case 'retry':
      update = {
        status: 'pending',
        last_error: outcome.error,
        scheduled_for: new Date(Date.now() + backoffMinutes(row.attempts) * 60 * 1000).toISOString(),
      }
      break
  }

  const { error: updErr } = await supabase.from('push_outbox').update(update).eq('id', row.id)
  if (updErr) {
    console.error(`[send-push] push_outbox.update error id=${row.id} status=${String(update.status)}:`, updErr.message)
  }

  // El recordatorio de turno refleja el estado FINAL del push. Mientras se reintenta no se toca
  // (enqueue_due_appointment_reminders lo dejó en 'sent' al encolar; el outbox lleva el estado real).
  if (row.appointment_reminder_id && outcome.status !== 'retry') {
    const remUpdate = outcome.status === 'sent'
      ? { status: 'sent', sent_at: nowIso, error_message: null }
      : { status: outcome.status, error_message: outcome.status === 'skipped' ? outcome.reason : outcome.error }
    const { error: remErr } = await supabase
      .from('appointment_reminders')
      .update(remUpdate)
      .eq('id', row.appointment_reminder_id)
    if (remErr) {
      console.error(`[send-push] appointment_reminders.update error id=${row.appointment_reminder_id}:`, remErr.message)
    }
  }
}

function bump(stats: RunStats, outcome: Outcome): void {
  if (outcome.status === 'sent') stats.sent++
  else if (outcome.status === 'failed') stats.failed++
  else if (outcome.status === 'skipped') stats.skipped++
  else stats.retrying++
}

// ---------------------------------------------------------------------------
// Campañas
// ---------------------------------------------------------------------------

/**
 * Recalcula los contadores de cada campaña tocada DESDE `push_outbox` (no se acumula: una
 * corrida interrumpida no puede dejar el contador corrido) y la cierra cuando no queda nada
 * pendiente ni en proceso. `no_token_count` = los que nunca se encolaron (sin token al crear
 * la campaña: `audience_count − filas`) + los `skipped` del outbox.
 */
async function finalizeCampaigns(campaignIds: Set<string>): Promise<void> {
  const nowIso = new Date().toISOString()
  for (const campaignId of campaignIds) {
    const { data: campaign, error: cErr } = await supabase
      .from('push_campaigns')
      .select('id, audience_count, status')
      .eq('id', campaignId)
      .maybeSingle()
    if (cErr) {
      console.error(`[send-push] push_campaigns lookup error campaign=${campaignId}:`, cErr.message)
      continue
    }
    if (!campaign) continue

    const [sent, failed, skipped, open, total] = await Promise.all([
      countOutbox(campaignId, ['sent']),
      countOutbox(campaignId, ['failed']),
      countOutbox(campaignId, ['skipped']),
      countOutbox(campaignId, ['pending', 'processing']),
      countOutbox(campaignId, ['pending', 'processing', 'sent', 'failed', 'skipped', 'cancelled']),
    ])
    if ([sent, failed, skipped, open, total].some((n) => n === null)) continue

    const audience = typeof campaign.audience_count === 'number' ? campaign.audience_count : total!
    const neverEnqueued = Math.max(0, audience - total!)

    const { error: updErr } = await supabase
      .from('push_campaigns')
      .update({
        sent_count: sent,
        failed_count: failed,
        no_token_count: neverEnqueued + skipped!,
        updated_at: nowIso,
      })
      .eq('id', campaignId)
    if (updErr) {
      console.error(`[send-push] push_campaigns.update counters error campaign=${campaignId}:`, updErr.message)
      continue
    }

    // Sólo se cierra una campaña que sigue 'sending': una cancelada no vuelve a 'sent'.
    if (open === 0 && campaign.status === 'sending') {
      const { error: closeErr } = await supabase
        .from('push_campaigns')
        .update({ status: 'sent', completed_at: nowIso, updated_at: nowIso })
        .eq('id', campaignId)
        .eq('status', 'sending')
      if (closeErr) {
        console.error(`[send-push] push_campaigns.update close error campaign=${campaignId}:`, closeErr.message)
      }
    }
  }
}

async function countOutbox(campaignId: string, statuses: OutboxStatus[]): Promise<number | null> {
  const { count, error } = await supabase
    .from('push_outbox')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .in('status', statuses)
  if (error) {
    console.error(`[send-push] push_outbox.count error campaign=${campaignId} statuses=${statuses.join(',')}:`, error.message)
    return null
  }
  return count ?? 0
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Procesa items con concurrencia limitada a `limit` tareas simultáneas.
// En Deno (single-threaded async) esto es seguro: los Maps/Sets compartidos se acceden
// de forma interleaved entre awaits, nunca en paralelo real.
async function processWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items]
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (queue.length > 0) {
        const item = queue.shift()
        if (item !== undefined) await fn(item)
      }
    })
  )
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** FCM exige `data` como map<string,string>: lo que no sea string se serializa. */
function stringifyValues(obj: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue
    out[k] = typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v)
  }
  return out
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
