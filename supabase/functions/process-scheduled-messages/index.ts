// Procesa mensajes programados pendientes vía Meta Cloud API
// Ejecutado por pg_cron cada 1 minuto o llamado manualmente

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const META_API_VERSION = 'v22.0'
const BATCH_SIZE = 50

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get('Authorization')
  if (authHeader !== `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    // Housekeeping previo: cerrar conversaciones inactivas y expirar workflows colgados
    try {
      const [{ data: closed }, { data: expired }] = await Promise.all([
        supabase.rpc('auto_close_inactive_conversations'),
        supabase.rpc('expire_stale_workflow_executions'),
      ])
      console.log('[housekeeping]', { closed, expired })
    } catch (hkErr) {
      console.error('[housekeeping] error:', hkErr)
    }

    const waApiKey = Deno.env.get('WA_API_KEY')

    const { data: pendingMessages, error } = await supabase
      .from('scheduled_messages')
      .select('id, phone, content, client_id, channel_id, template_name, template_language, template_params, workflow_id, workflow_trigger_data, broadcast_id')
      .eq('status', 'pending')
      .lte('scheduled_for', new Date().toISOString())
      .limit(BATCH_SIZE)

    if (error) throw error

    // Cache de configuración por org_id
    const orgSettingsCache = new Map<string, { wa_api_url: string | null }>()
    const orgChannelCache = new Map<string, { id: string }[]>()
    const orgConfigCache = new Map<string, { whatsapp_access_token: string; whatsapp_phone_id: string } | null>()

    // Contadores de broadcast para actualizar al final
    const broadcastCounters = new Map<string, { sent: number; failed: number }>()

    const results: Array<{ id: string; sent: boolean; error: string | null }> = []

    for (const msg of (pendingMessages ?? [])) {
      let sent = false
      let errorMsg: string | null = null

      // Resolver organization_id
      let orgId: string | null = null

      if (msg.channel_id) {
        const { data: channelData } = await supabase
          .from('social_channels')
          .select('branch_id')
          .eq('id', msg.channel_id)
          .maybeSingle()
        if (channelData?.branch_id) {
          const { data: branchData } = await supabase
            .from('branches')
            .select('organization_id')
            .eq('id', channelData.branch_id)
            .maybeSingle()
          orgId = branchData?.organization_id ?? null
        }
      }

      if (!orgId && msg.client_id) {
        const { data: clientData } = await supabase
          .from('clients')
          .select('organization_id')
          .eq('id', msg.client_id)
          .maybeSingle()
        orgId = clientData?.organization_id ?? null
      }

      if (!orgId) {
        errorMsg = 'No se pudo resolver la organización del mensaje programado'
        await supabase
          .from('scheduled_messages')
          .update({ status: 'failed', error_message: errorMsg })
          .eq('id', msg.id)
        results.push({ id: msg.id, sent: false, error: errorMsg })
        trackBroadcast(broadcastCounters, msg.broadcast_id, false)
        continue
      }

      // Obtener config del microservicio WA (con cache)
      if (!orgSettingsCache.has(orgId)) {
        const { data: settings } = await supabase
          .from('app_settings')
          .select('wa_api_url')
          .eq('organization_id', orgId)
          .maybeSingle()
        orgSettingsCache.set(orgId, { wa_api_url: (settings as any)?.wa_api_url ?? null })
      }
      const waApiUrl = orgSettingsCache.get(orgId)!.wa_api_url

      if (waApiUrl && waApiKey && msg.phone) {
        // Envío vía microservicio WA (Baileys)
        try {
          const res = await fetch(`${waApiUrl}/send`, {
            method: 'POST',
            headers: {
              'x-api-key': waApiKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ phone: msg.phone, message: msg.content }),
          })
          const result = await res.json()
          if (res.ok && !result.error) {
            sent = true
          } else {
            errorMsg = result.error || `Error HTTP ${res.status} del microservicio`
          }
        } catch (e: any) {
          errorMsg = `Error de conexión: ${e.message}`
        }
      } else {
        // Envío vía Meta Cloud API
        if (!orgConfigCache.has(orgId)) {
          const { data: waConfig } = await supabase
            .from('organization_whatsapp_config')
            .select('whatsapp_access_token, whatsapp_phone_id')
            .eq('organization_id', orgId)
            .eq('is_active', true)
            .maybeSingle()
          orgConfigCache.set(orgId, waConfig ?? null)
        }
        const waConfig = orgConfigCache.get(orgId)

        if (!waConfig?.whatsapp_access_token || !waConfig?.whatsapp_phone_id) {
          errorMsg = 'Config de WhatsApp no encontrada para esta organización'
        } else if (!msg.phone) {
          errorMsg = 'Falta teléfono en el mensaje programado'
        } else {
          const phone = normalizePhone(msg.phone)

          const isTemplate = !!msg.template_name
          const payload = isTemplate
            ? buildTemplatePayload(phone, msg.template_name, msg.template_language, msg.template_params)
            : {
                messaging_product: 'whatsapp',
                to: phone,
                type: 'text',
                text: { body: msg.content },
              }

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

            const result = await res.json()
            if (res.ok && result.messages?.[0]?.id) {
              sent = true
            } else {
              errorMsg = result.error?.message || `Error HTTP ${res.status}`
            }
          } catch (e: any) {
            clearTimeout(timeout)
            errorMsg = e.name === 'AbortError'
              ? 'Timeout al contactar Meta API (15s)'
              : `Error de conexión: ${e.message}`
          }
        }
      }

      // Registrar en conversaciones si fue exitoso
      if (sent) {
        await recordInConversation(msg, orgId, orgChannelCache)
      }

      // Actualizar estado del scheduled_message
      await supabase
        .from('scheduled_messages')
        .update({
          status: sent ? 'sent' : 'failed',
          sent_at: sent ? new Date().toISOString() : null,
          error_message: errorMsg,
        })
        .eq('id', msg.id)

      trackBroadcast(broadcastCounters, msg.broadcast_id, sent)
      results.push({ id: msg.id, sent, error: errorMsg })
    }

    // Actualizar contadores de broadcasts procesados
    await updateBroadcastCounters(broadcastCounters)

    return new Response(
      JSON.stringify({ processed: results.length, results }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})

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
  templateParams: any
) {
  const payload: any = {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'template',
    template: {
      name: templateName,
      language: { code: templateLanguage || 'es_AR' },
    },
  }

  // Si hay template_params, convertirlos al formato de Meta Cloud API components
  if (templateParams && Array.isArray(templateParams) && templateParams.length > 0) {
    payload.template.components = templateParams.map((comp: any) => ({
      type: comp.type,
      parameters: comp.parameters?.map((p: any) => {
        if (p.type === 'text') return { type: 'text', text: p.text || '' }
        if (p.type === 'image') return { type: 'image', image: p.image }
        if (p.type === 'document') return { type: 'document', document: p.document }
        if (p.type === 'video') return { type: 'video', video: p.video }
        return p
      }) ?? [],
    }))
  }

  return payload
}

// Registra el mensaje enviado en la tabla de conversaciones para que aparezca en el inbox
async function recordInConversation(msg: any, orgId: string, orgChannelCache: Map<string, { id: string }[]>) {
  if (!orgChannelCache.has(orgId)) {
    const { data: orgBranches } = await supabase
      .from('branches')
      .select('id')
      .eq('organization_id', orgId)
    const branchIds = orgBranches?.map((b: { id: string }) => b.id) ?? []

    if (branchIds.length > 0) {
      const { data: channels } = await supabase
        .from('social_channels')
        .select('id')
        .eq('platform', 'whatsapp')
        .eq('is_active', true)
        .in('branch_id', branchIds)
      orgChannelCache.set(orgId, channels ?? [])
    } else {
      orgChannelCache.set(orgId, [])
    }
  }
  const waChannels = orgChannelCache.get(orgId) as { id: string }[]
  const waChannel = waChannels[0] ?? null
  if (!waChannel) return

  const phoneNorm = normalizePhone(msg.phone)
  const phoneSuffix = phoneNorm.slice(-10)
  const allChannelIds = waChannels.map(c => c.id)

  const { data: existingConv } = await supabase
    .from('conversations')
    .select('id')
    .in('channel_id', allChannelIds)
    .ilike('platform_user_id', `%${phoneSuffix}`)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  let convId: string | null = null
  if (existingConv) {
    convId = existingConv.id
  } else {
    const { data: newConv } = await supabase
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
    convId = newConv?.id ?? null
  }

  if (!convId) return

  await supabase.from('messages').insert({
    conversation_id: convId,
    direction: 'outbound',
    content_type: msg.template_name ? 'template' : 'text',
    content: msg.content || (msg.template_name ? `[Template: ${msg.template_name}]` : null),
    template_name: msg.template_name || null,
    status: 'sent',
  })

  await supabase
    .from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', convId)

  // Workflow execution
  if (msg.workflow_id && msg.workflow_trigger_data) {
    try {
      const triggerData = msg.workflow_trigger_data as Record<string, any>
      const nextNodeId = triggerData.next_node_id as string | null
      const entryNodeId = triggerData.entry_node_id as string | null
      const firstActionNodeId = triggerData.first_action_node_id as string | null
      const clientName = (triggerData.client_name as string) ?? ''
      const firstName = clientName.split(/\s+/)[0] ?? ''

      await supabase
        .from('workflow_executions')
        .update({ status: 'cancelled', completed_at: new Date().toISOString() })
        .eq('conversation_id', convId)
        .in('status', ['active', 'waiting_reply'])

      const currentNodeId = nextNodeId ?? firstActionNodeId
      const execStatus = nextNodeId ? 'waiting_reply' : 'completed'

      const { data: execution } = await supabase
        .from('workflow_executions')
        .insert({
          workflow_id: msg.workflow_id,
          conversation_id: convId,
          current_node_id: currentNodeId,
          status: execStatus,
          context: { client_name: clientName, client_first_name: firstName },
          triggered_by: 'post_service',
          completed_at: execStatus === 'completed' ? new Date().toISOString() : null,
        })
        .select('id')
        .single()

      if (execution && entryNodeId) {
        await supabase.from('workflow_execution_log').insert({
          execution_id: execution.id,
          node_id: entryNodeId,
          node_type: 'trigger',
          status: 'success',
          output_data: { triggered_by: 'post_service' },
        })
      }
      if (execution && firstActionNodeId) {
        await supabase.from('workflow_execution_log').insert({
          execution_id: execution.id,
          node_id: firstActionNodeId,
          node_type: msg.template_name ? 'send_template' : 'send_message',
          status: 'success',
          output_data: { template_name: msg.template_name, content: msg.content },
        })
      }
    } catch (wfErr: any) {
      console.error('[Workflow] Error creando ejecución:', wfErr.message)
    }
  }
}

// Acumula contadores por broadcast_id
function trackBroadcast(counters: Map<string, { sent: number; failed: number }>, broadcastId: string | null, sent: boolean) {
  if (!broadcastId) return
  const existing = counters.get(broadcastId) ?? { sent: 0, failed: 0 }
  if (sent) existing.sent++
  else existing.failed++
  counters.set(broadcastId, existing)
}

// Actualiza contadores de broadcasts y marca como completado si corresponde
async function updateBroadcastCounters(counters: Map<string, { sent: number; failed: number }>) {
  for (const [broadcastId, counts] of counters) {
    // Incrementar contadores atómicamente
    const { data: broadcast } = await supabase
      .from('broadcasts')
      .select('audience_count, sent_count, failed_count')
      .eq('id', broadcastId)
      .single()

    if (!broadcast) continue

    const newSent = (broadcast.sent_count ?? 0) + counts.sent
    const newFailed = (broadcast.failed_count ?? 0) + counts.failed
    const total = broadcast.audience_count ?? 0
    const allProcessed = (newSent + newFailed) >= total

    await supabase
      .from('broadcasts')
      .update({
        sent_count: newSent,
        delivered_count: newSent,
        failed_count: newFailed,
        ...(allProcessed ? { status: 'sent', completed_at: new Date().toISOString() } : {}),
      })
      .eq('id', broadcastId)

    // Actualizar estados individuales de broadcast_recipients
    if (counts.sent > 0) {
      const { data: sentMsgs } = await supabase
        .from('scheduled_messages')
        .select('client_id')
        .eq('broadcast_id', broadcastId)
        .eq('status', 'sent')
        .limit(counts.sent)

      if (sentMsgs) {
        const clientIds = sentMsgs.map(m => m.client_id)
        await supabase
          .from('broadcast_recipients')
          .update({ status: 'sent', sent_at: new Date().toISOString() })
          .eq('broadcast_id', broadcastId)
          .in('client_id', clientIds)
          .eq('status', 'pending')
      }
    }

    if (counts.failed > 0) {
      const { data: failedMsgs } = await supabase
        .from('scheduled_messages')
        .select('client_id, error_message')
        .eq('broadcast_id', broadcastId)
        .eq('status', 'failed')
        .limit(counts.failed)

      if (failedMsgs) {
        for (const fm of failedMsgs) {
          await supabase
            .from('broadcast_recipients')
            .update({ status: 'failed', error_message: fm.error_message })
            .eq('broadcast_id', broadcastId)
            .eq('client_id', fm.client_id)
            .eq('status', 'pending')
        }
      }
    }
  }
}
