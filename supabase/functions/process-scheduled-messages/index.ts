// Procesa mensajes programados pendientes vía Meta Cloud API o microservicio Baileys.
// Ejecutado por pg_cron cada 1 minuto.
//
// CAMBIOS Migración 119/120/121/122 (Ola 3 perf audit):
// 1. Atomic claim vía claim_pending_messages() RPC: incrementa attempts y marca processing,
//    FOR UPDATE SKIP LOCKED evita double-send entre cron runs solapados.
// 2. Retry con backoff exponencial para errores transitorios (5xx, timeout, network).
// 3. last_error_kind = 'transient' | 'permanent' permite distinguir fallos retriable de definitivos.
// 4. Housekeeping (auto_close_inactive_conversations, expire_stale_workflow_executions) se movió
//    al pg_cron job 'workflow-housekeeping-5min' (corre cada 5 min en lugar de cada 1).
// 5. Patron obligatorio CLAUDE.md: chequear error de cada .insert()/.update().

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const META_API_VERSION = 'v22.0'
const BATCH_SIZE = 50
const MAX_ATTEMPTS = 3

// Shape mínimo de un scheduled_message tal como lo devuelve claim_pending_messages()
// y como lo consumimos en este archivo. No es exhaustivo: solo los campos que tocamos.
interface TemplateParamComponent {
  type: string
  parameters?: TemplateParamItem[]
}
interface TemplateParamItem {
  type: string
  text?: string
  image?: unknown
  document?: unknown
  video?: unknown
}
interface ScheduledMessage {
  id: string
  organization_id?: string | null
  channel_id?: string | null
  client_id?: string | null
  phone?: string | null
  content?: string | null
  template_name?: string | null
  template_language?: string | null
  template_params?: TemplateParamComponent[] | null
  workflow_id?: string | null
  workflow_trigger_data?: Record<string, unknown> | null
  broadcast_id?: string | null
  attempts?: number | null
}

interface MetaTemplatePayload {
  messaging_product: 'whatsapp'
  to: string
  type: 'template'
  template: {
    name: string
    language: { code: string }
    components?: Array<{
      type: string
      parameters: Array<Record<string, unknown>>
    }>
  }
}

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get('Authorization')
  if (authHeader !== `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const waApiKey = Deno.env.get('WA_API_KEY')

    // Atomic claim: incrementa attempts, marca processing, devuelve el lote.
    // Otros cron runs concurrentes ven status=processing y skipean (FOR UPDATE SKIP LOCKED).
    const { data: pendingMessages, error: claimErr } = await supabase
      .rpc('claim_pending_messages', { p_batch_size: BATCH_SIZE })

    if (claimErr) {
      console.error('[scheduled] claim_pending_messages RPC error:', claimErr.message)
      throw claimErr
    }

    if (!pendingMessages || pendingMessages.length === 0) {
      return new Response(
        JSON.stringify({ processed: 0, results: [] }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Cache de configuración por org_id (evita N×lookups)
    // Las Maps son thread-safe en Deno (single-threaded async): la concurrencia es
    // por interleaving de awaits, no por paralelismo real de hilos.
    const orgSettingsCache = new Map<string, { wa_api_url: string | null }>()
    const orgChannelCache = new Map<string, { id: string }[]>()
    const orgConfigCache = new Map<string, { whatsapp_access_token: string; whatsapp_phone_id: string } | null>()
    const broadcastCounters = new Map<string, { sent: number; failed: number }>()
    const results: Array<{ id: string; sent: boolean; error: string | null; retry: boolean }> = []

    // Procesa el batch con concurrencia limitada (8 mensajes en vuelo simultáneamente).
    // Esto reduce el tiempo de procesamiento de un batch de 50 de ~50×RTT a ~7×RTT
    // sin sobrecargar Meta Cloud API ni el microservicio Baileys.
    const typedPending = pendingMessages as ScheduledMessage[]
    await processWithConcurrency(typedPending, 8, async (msg) => {
      let sent = false
      let errorMsg: string | null = null
      let httpStatus: number | undefined

      // Resolver organization_id (preferimos la columna directa)
      let orgId: string | null = msg.organization_id ?? null

      if (!orgId && msg.channel_id) {
        const { data: channelData, error: chErr } = await supabase
          .from('social_channels')
          .select('organization_id, branch_id')
          .eq('id', msg.channel_id)
          .maybeSingle()
        if (chErr) console.error('[scheduled] social_channels lookup error msg_id=' + msg.id + ':', chErr.message)
        orgId = channelData?.organization_id ?? null
        if (!orgId && channelData?.branch_id) {
          const { data: branchData, error: brErr } = await supabase
            .from('branches')
            .select('organization_id')
            .eq('id', channelData.branch_id)
            .maybeSingle()
          if (brErr) console.error('[scheduled] branches lookup error msg_id=' + msg.id + ':', brErr.message)
          orgId = branchData?.organization_id ?? null
        }
      }

      if (!orgId && msg.client_id) {
        const { data: clientData, error: clErr } = await supabase
          .from('clients')
          .select('organization_id')
          .eq('id', msg.client_id)
          .maybeSingle()
        if (clErr) console.error('[scheduled] clients lookup error msg_id=' + msg.id + ':', clErr.message)
        orgId = clientData?.organization_id ?? null
      }

      if (!orgId) {
        // Permanente: no se puede resolver org. No tiene sentido reintentar.
        errorMsg = 'No se pudo resolver la organización del mensaje programado'
        await persistResult(msg, false, errorMsg, false /* willRetry */, 'permanent')
        results.push({ id: msg.id, sent: false, error: errorMsg, retry: false })
        trackBroadcast(broadcastCounters, msg.broadcast_id, false)
        continue
      }

      // Obtener config del microservicio WA (con cache)
      if (!orgSettingsCache.has(orgId)) {
        const { data: settings, error: setErr } = await supabase
          .from('app_settings')
          .select('wa_api_url')
          .eq('organization_id', orgId)
          .maybeSingle()
        if (setErr) console.error('[scheduled] app_settings error org=' + orgId + ':', setErr.message)
        const settingsRow = settings as { wa_api_url?: string | null } | null
        orgSettingsCache.set(orgId, { wa_api_url: settingsRow?.wa_api_url ?? null })
      }
      const waApiUrl = orgSettingsCache.get(orgId)!.wa_api_url

      if (waApiUrl && waApiKey && msg.phone) {
        // Envío vía microservicio Baileys
        try {
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 15000)
          const res = await fetch(`${waApiUrl}/send`, {
            method: 'POST',
            headers: {
              'x-api-key': waApiKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ phone: msg.phone, message: msg.content }),
            signal: controller.signal,
          })
          clearTimeout(timeout)
          httpStatus = res.status
          const result = await res.json()
          if (res.ok && !result.error) {
            sent = true
          } else {
            errorMsg = result.error || `Error HTTP ${res.status} del microservicio`
          }
        } catch (e: unknown) {
          const err = e as { name?: string; message?: string }
          errorMsg = err.name === 'AbortError'
            ? 'Timeout al contactar microservicio WA (15s)'
            : `Error de conexión: ${err.message ?? String(e)}`
        }
      } else {
        // Envío vía Meta Cloud API
        if (!orgConfigCache.has(orgId)) {
          const { data: waConfig, error: cfgErr } = await supabase
            .from('organization_whatsapp_config')
            .select('whatsapp_access_token, whatsapp_phone_id')
            .eq('organization_id', orgId)
            .eq('is_active', true)
            .maybeSingle()
          if (cfgErr) console.error('[scheduled] organization_whatsapp_config error org=' + orgId + ':', cfgErr.message)
          orgConfigCache.set(orgId, waConfig ?? null)
        }
        const waConfig = orgConfigCache.get(orgId)

        if (!waConfig?.whatsapp_access_token || !waConfig?.whatsapp_phone_id) {
          errorMsg = 'Config de WhatsApp no encontrada para esta organización'
        } else if (!msg.phone) {
          errorMsg = 'Falta teléfono en el mensaje programado'
        } else {
          const phone = normalizePhone(msg.phone)
          const payload = msg.template_name
            ? buildTemplatePayload(phone, msg.template_name, msg.template_language ?? null, msg.template_params ?? null)
            : { messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: msg.content } }

          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 15000)

          try {
            const res = await fetch(
              `https://graph.facebook.com/${META_API_VERSION}/${waConfig.whatsapp_phone_id}/messages`,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${waConfig.whatsapp_access_token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
                signal: controller.signal,
              }
            )
            clearTimeout(timeout)
            httpStatus = res.status

            const result = await res.json()
            if (res.ok && result.messages?.[0]?.id) {
              sent = true
            } else {
              errorMsg = result.error?.message || `Error HTTP ${res.status}`
            }
          } catch (e: unknown) {
            clearTimeout(timeout)
            const err = e as { name?: string; message?: string }
            errorMsg = err.name === 'AbortError'
              ? 'Timeout al contactar Meta API (15s)'
              : `Error de conexión: ${err.message ?? String(e)}`
          }
        }
      }

      // Registrar en conversaciones si fue exitoso
      if (sent) {
        try {
          await recordInConversation(msg, orgId, orgChannelCache)
        } catch (recErr: unknown) {
          const message = recErr instanceof Error ? recErr.message : String(recErr)
          console.error('[recordInConversation] error msg_id=' + msg.id + ':', message)
        }
      }

      // Decidir si reintentar o marcar como definitivo
      const isTransient = !sent && classifyError(errorMsg, httpStatus) === 'transient'
      const willRetry = isTransient && (msg.attempts ?? 1) < MAX_ATTEMPTS
      const finalKind: 'transient' | 'permanent' | null = sent ? null : (isTransient ? 'transient' : 'permanent')

      await persistResult(msg, sent, errorMsg, willRetry, finalKind)
      trackBroadcast(broadcastCounters, msg.broadcast_id, sent)
      results.push({ id: msg.id, sent, error: errorMsg, retry: willRetry })
    }) // fin processWithConcurrency

    // Actualizar contadores de broadcasts (con error checks)
    await updateBroadcastCounters(broadcastCounters)

    return new Response(
      JSON.stringify({ processed: results.length, results }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[scheduled] unhandled error:', message)
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})

// Procesa items con concurrencia limitada a `limit` tareas simultáneas.
// En Deno (single-threaded async) esto es seguro: los Maps compartidos se acceden
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

// Persiste el resultado del envío. Si willRetry, re-agenda con backoff y vuelve a pending.
async function persistResult(
  msg: ScheduledMessage,
  sent: boolean,
  errorMsg: string | null,
  willRetry: boolean,
  errorKind: 'transient' | 'permanent' | null
): Promise<void> {
  let updateData: Record<string, unknown>

  if (sent) {
    updateData = {
      status: 'sent',
      sent_at: new Date().toISOString(),
      error_message: null,
      last_error_kind: null,
    }
  } else if (willRetry) {
    // Backoff exponencial: 5min, 15min, 45min
    const attempts = msg.attempts ?? 1
    const minutes = Math.pow(3, attempts - 1) * 5
    updateData = {
      status: 'pending',
      sent_at: null,
      error_message: errorMsg,
      last_error_kind: errorKind,
      scheduled_for: new Date(Date.now() + minutes * 60 * 1000).toISOString(),
    }
  } else {
    updateData = {
      status: 'failed',
      sent_at: null,
      error_message: errorMsg,
      last_error_kind: errorKind,
    }
  }

  const { error: updErr } = await supabase
    .from('scheduled_messages')
    .update(updateData)
    .eq('id', msg.id)

  if (updErr) {
    console.error('[scheduled] persistResult update error msg_id=' + msg.id + ' status=' + updateData.status + ':', updErr.message)
  }
}

// Clasifica un error como retriable o no.
// Transient: 5xx HTTP, timeouts, network errors, rate limits (429).
// Permanent: 4xx HTTP (excepto 429), template missing, config missing, validation.
function classifyError(errorMsg: string | null, httpStatus?: number): 'transient' | 'permanent' {
  if (!errorMsg) return 'permanent'
  const lower = errorMsg.toLowerCase()

  if (httpStatus !== undefined) {
    if (httpStatus >= 500 && httpStatus < 600) return 'transient'
    if (httpStatus === 429) return 'transient'
    if (httpStatus >= 400 && httpStatus < 500) return 'permanent'
  }

  if (lower.includes('timeout')) return 'transient'
  if (lower.includes('error de conexión') || lower.includes('econn') || lower.includes('network')) return 'transient'
  if (lower.includes('rate limit')) return 'transient'

  // Errores típicamente permanentes
  if (lower.includes('132001') || lower.includes('template')) return 'permanent'
  if (lower.includes('config') || lower.includes('no encontrada') || lower.includes('falta')) return 'permanent'

  // Default: si no podemos categorizar, asumimos permanente (no re-spamear al cliente)
  return 'permanent'
}

// Normaliza un teléfono argentino al formato internacional de Meta
function normalizePhone(raw: string): string {
  let phone = raw.replace(/\D/g, '')
  if (!phone.startsWith('54')) {
    if (phone.startsWith('9') && phone.length === 11) {
      phone = '54' + phone.slice(1)
    } else {
      phone = '54' + phone
    }
  } else if (phone.startsWith('549') && phone.length === 13) {
    phone = '54' + phone.slice(3)
  }
  return phone
}

// Construye el payload de template con componentes/variables para Meta Cloud API
function buildTemplatePayload(
  phone: string,
  templateName: string,
  templateLanguage: string | null,
  templateParams: TemplateParamComponent[] | null | undefined,
): MetaTemplatePayload {
  const payload: MetaTemplatePayload = {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'template',
    template: {
      name: templateName,
      language: { code: templateLanguage || 'es_AR' },
    },
  }

  if (templateParams && Array.isArray(templateParams) && templateParams.length > 0) {
    payload.template.components = templateParams.map((comp: TemplateParamComponent) => ({
      type: comp.type,
      parameters: comp.parameters?.map((p: TemplateParamItem) => {
        if (p.type === 'text') return { type: 'text', text: p.text || '' }
        if (p.type === 'image') return { type: 'image', image: p.image }
        if (p.type === 'document') return { type: 'document', document: p.document }
        if (p.type === 'video') return { type: 'video', video: p.video }
        return p as unknown as Record<string, unknown>
      }) ?? [],
    }))
  }

  return payload
}

// Registra el mensaje enviado en la tabla de conversaciones para que aparezca en el inbox.
async function recordInConversation(msg: ScheduledMessage, orgId: string, orgChannelCache: Map<string, { id: string }[]>) {
  if (!orgChannelCache.has(orgId)) {
    const { data: channels, error: chErr } = await supabase
      .from('social_channels')
      .select('id')
      .eq('platform', 'whatsapp')
      .eq('is_active', true)
      .eq('organization_id', orgId)
    if (chErr) {
      console.error('[recordInConversation] social_channels lookup error org=' + orgId + ':', chErr.message)
    }
    orgChannelCache.set(orgId, channels ?? [])
  }
  const waChannels = orgChannelCache.get(orgId) as { id: string }[]
  const waChannel = waChannels[0] ?? null
  if (!waChannel) {
    console.error('[recordInConversation] No hay canal whatsapp activo para org=' + orgId + ' (msg_id=' + msg.id + ')')
    return
  }

  const phoneNorm = normalizePhone(msg.phone)
  const phoneSuffix = phoneNorm.slice(-10)
  const allChannelIds = waChannels.map(c => c.id)

  const { data: existingConv, error: lookupErr } = await supabase
    .from('conversations')
    .select('id')
    .in('channel_id', allChannelIds)
    .ilike('platform_user_id', `%${phoneSuffix}`)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  if (lookupErr) {
    console.error('[recordInConversation] conversations lookup error:', lookupErr.message)
  }

  let convId: string | null = null
  if (existingConv) {
    convId = existingConv.id
  } else {
    const { data: newConv, error: convInsErr } = await supabase
      .from('conversations')
      .insert({
        channel_id: waChannel.id,
        client_id: msg.client_id,
        platform_user_id: phoneNorm,
        status: 'open',
        unread_count: 0,
        last_message_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (convInsErr) {
      console.error('[recordInConversation] conversations.insert error msg_id=' + msg.id + ':', convInsErr.message)
    }
    convId = newConv?.id ?? null
  }

  if (!convId) {
    console.error('[recordInConversation] convId nulo, abortando msg_id=' + msg.id)
    return
  }

  const { error: msgInsErr } = await supabase.from('messages').insert({
    conversation_id: convId,
    direction: 'outbound',
    content_type: msg.template_name ? 'template' : 'text',
    content: msg.content || (msg.template_name ? `[Template: ${msg.template_name}]` : null),
    template_name: msg.template_name || null,
    status: 'sent',
  })
  if (msgInsErr) {
    console.error('[recordInConversation] messages.insert error msg_id=' + msg.id + ':', msgInsErr.message)
  }

  const { error: convUpdErr } = await supabase
    .from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', convId)
  if (convUpdErr) {
    console.error('[recordInConversation] conversations.update error conv=' + convId + ':', convUpdErr.message)
  }

  // Workflow execution (con waiting_since correcto desde migración 119+)
  if (msg.workflow_id && msg.workflow_trigger_data) {
    const triggerData = msg.workflow_trigger_data as Record<string, unknown>
    const nextNodeId = (triggerData.next_node_id as string | null | undefined) ?? null
    const entryNodeId = (triggerData.entry_node_id as string | null | undefined) ?? null
    const firstActionNodeId = (triggerData.first_action_node_id as string | null | undefined) ?? null
    const clientName = (triggerData.client_name as string | undefined) ?? ''
    const firstName = clientName.split(/\s+/)[0] ?? ''

    const { error: cancelErr } = await supabase
      .from('workflow_executions')
      .update({ status: 'cancelled', completed_at: new Date().toISOString() })
      .eq('conversation_id', convId)
      .in('status', ['active', 'waiting_reply'])
    if (cancelErr) {
      console.error('[Workflow] cancel previas error conv=' + convId + ':', cancelErr.message)
    }

    const currentNodeId = nextNodeId ?? firstActionNodeId
    const execStatus = nextNodeId ? 'waiting_reply' : 'completed'

    const { data: execution, error: execErr } = await supabase
      .from('workflow_executions')
      .insert({
        workflow_id: msg.workflow_id,
        conversation_id: convId,
        current_node_id: currentNodeId,
        status: execStatus,
        context: { client_name: clientName, client_first_name: firstName },
        triggered_by: 'post_service',
        // waiting_since es indispensable para que expire_stale_workflow_executions() pueda procesarlo.
        // Sin esto, las executions quedan stuck para siempre y rompen overlap_policy='skip_if_active'.
        waiting_since: execStatus === 'waiting_reply' ? new Date().toISOString() : null,
        completed_at: execStatus === 'completed' ? new Date().toISOString() : null,
      })
      .select('id')
      .single()
    if (execErr) {
      console.error('[Workflow] insert execution error msg_id=' + msg.id + ':', execErr.message)
      return
    }

    if (execution && entryNodeId) {
      const { error: logErr } = await supabase.from('workflow_execution_log').insert({
        execution_id: execution.id,
        node_id: entryNodeId,
        node_type: 'trigger',
        status: 'success',
        output_data: { triggered_by: 'post_service' },
      })
      if (logErr) console.error('[Workflow] log trigger error:', logErr.message)
    }
    if (execution && firstActionNodeId) {
      const { error: logErr } = await supabase.from('workflow_execution_log').insert({
        execution_id: execution.id,
        node_id: firstActionNodeId,
        node_type: msg.template_name ? 'send_template' : 'send_message',
        status: 'success',
        output_data: { template_name: msg.template_name, content: msg.content },
      })
      if (logErr) console.error('[Workflow] log action error:', logErr.message)
    }
  }
}

function trackBroadcast(counters: Map<string, { sent: number; failed: number }>, broadcastId: string | null, sent: boolean) {
  if (!broadcastId) return
  const existing = counters.get(broadcastId) ?? { sent: 0, failed: 0 }
  if (sent) existing.sent++
  else existing.failed++
  counters.set(broadcastId, existing)
}

async function updateBroadcastCounters(counters: Map<string, { sent: number; failed: number }>) {
  for (const [broadcastId, counts] of counters) {
    const { data: broadcast, error: bcErr } = await supabase
      .from('broadcasts')
      .select('audience_count, sent_count, failed_count')
      .eq('id', broadcastId)
      .single()

    if (bcErr) {
      console.error('[broadcasts] lookup error broadcast=' + broadcastId + ':', bcErr.message)
      continue
    }
    if (!broadcast) continue

    const newSent = (broadcast.sent_count ?? 0) + counts.sent
    const newFailed = (broadcast.failed_count ?? 0) + counts.failed
    const total = broadcast.audience_count ?? 0
    const allProcessed = (newSent + newFailed) >= total

    const { error: bcUpdErr } = await supabase
      .from('broadcasts')
      .update({
        sent_count: newSent,
        delivered_count: newSent,
        failed_count: newFailed,
        ...(allProcessed ? { status: 'sent', completed_at: new Date().toISOString() } : {}),
      })
      .eq('id', broadcastId)
    if (bcUpdErr) {
      console.error('[broadcasts] update error broadcast=' + broadcastId + ':', bcUpdErr.message)
    }

    if (counts.sent > 0) {
      const { data: sentMsgs, error: smErr } = await supabase
        .from('scheduled_messages')
        .select('client_id')
        .eq('broadcast_id', broadcastId)
        .eq('status', 'sent')
        .limit(counts.sent)
      if (smErr) {
        console.error('[broadcasts] sent_msgs lookup error broadcast=' + broadcastId + ':', smErr.message)
      }

      if (sentMsgs && sentMsgs.length > 0) {
        const clientIds = sentMsgs.map(m => m.client_id)
        const { error: brUpdErr } = await supabase
          .from('broadcast_recipients')
          .update({ status: 'sent', sent_at: new Date().toISOString() })
          .eq('broadcast_id', broadcastId)
          .in('client_id', clientIds)
          .eq('status', 'pending')
        if (brUpdErr) {
          console.error('[broadcasts] recipients sent update error broadcast=' + broadcastId + ':', brUpdErr.message)
        }
      }
    }

    if (counts.failed > 0) {
      const { data: failedMsgs, error: fmErr } = await supabase
        .from('scheduled_messages')
        .select('client_id, error_message')
        .eq('broadcast_id', broadcastId)
        .eq('status', 'failed')
        .limit(counts.failed)
      if (fmErr) {
        console.error('[broadcasts] failed_msgs lookup error broadcast=' + broadcastId + ':', fmErr.message)
      }

      if (failedMsgs && failedMsgs.length > 0) {
        for (const fm of failedMsgs) {
          const { error: brUpdErr } = await supabase
            .from('broadcast_recipients')
            .update({ status: 'failed', error_message: fm.error_message })
            .eq('broadcast_id', broadcastId)
            .eq('client_id', fm.client_id)
            .eq('status', 'pending')
          if (brUpdErr) {
            console.error('[broadcasts] recipients failed update error broadcast=' + broadcastId + ' client=' + fm.client_id + ':', brUpdErr.message)
          }
        }
      }
    }
  }
}
