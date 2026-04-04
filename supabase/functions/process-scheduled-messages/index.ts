// Procesa mensajes programados pendientes vía Meta Cloud API
// Ejecutado por pg_cron cada 1 minuto o llamado manualmente

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const META_API_VERSION = 'v22.0'

Deno.serve(async (req: Request) => {
  // Verificar authorization
  const authHeader = req.headers.get('Authorization')
  if (authHeader !== `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const waApiKey = Deno.env.get('WA_API_KEY')

    // Obtener mensajes pendientes cuyo scheduled_for ya pasó (máx 10 por tick)
    // Incluir channel_id para resolver la org de cada mensaje
    const { data: pendingMessages, error } = await supabase
      .from('scheduled_messages')
      .select('id, phone, content, client_id, channel_id')
      .eq('status', 'pending')
      .lte('scheduled_for', new Date().toISOString())
      .limit(10)

    if (error) throw error

    // Cache de configuración por org_id para no repetir queries
    const orgSettingsCache = new Map<string, { wa_api_url: string | null }>()
    const orgChannelCache = new Map<string, { id: string } | null>()

    const results: Array<{ id: string; sent: boolean; error: string | null }> = []

    for (const msg of (pendingMessages ?? [])) {
      let sent = false
      let errorMsg: string | null = null

      // Resolver organization_id del mensaje:
      // 1. Via channel_id -> social_channels.branch_id -> branches.organization_id
      // 2. Fallback: via client_id -> clients.organization_id
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
        continue
      }

      // Obtener config del microservicio WA para esta org (con cache)
      if (!orgSettingsCache.has(orgId)) {
        const { data: settings } = await supabase
          .from('app_settings')
          .select('wa_api_url')
          .eq('organization_id', orgId)
          .maybeSingle()
        orgSettingsCache.set(orgId, { wa_api_url: (settings as any)?.wa_api_url ?? null })
      }
      const waApiUrl = orgSettingsCache.get(orgId)!.wa_api_url

      // Enviar vía WA Microservice si está configurado y el mensaje tiene teléfono directo
      if (waApiUrl && waApiKey && msg.phone) {
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
        // Enviar vía Meta Cloud API
        const { data: waConfig } = await supabase
          .from('organization_whatsapp_config')
          .select('whatsapp_access_token, whatsapp_phone_id')
          .eq('organization_id', orgId)
          .eq('is_active', true)
          .maybeSingle()

        if (!waConfig?.whatsapp_access_token || !waConfig?.whatsapp_phone_id) {
          errorMsg = 'Config de WhatsApp no encontrada para esta organización'
        } else if (!msg.phone) {
          errorMsg = 'Falta teléfono en el mensaje programado'
        } else {
          // Normalizar teléfono para Meta Cloud API
          let phone = (msg.phone as string).replace(/\D/g, '')
          if (!phone.startsWith('54')) {
            if (phone.startsWith('9') && phone.length === 11) {
              phone = '54' + phone.slice(1)
            } else {
              phone = '54' + phone
            }
          } else if (phone.startsWith('549') && phone.length === 13) {
            phone = '54' + phone.slice(3)
          }

          // Enviar vía Meta Cloud API con timeout
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
                body: JSON.stringify({
                  messaging_product: 'whatsapp',
                  to: phone,
                  type: 'text',
                  text: { body: msg.content },
                }),
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

      // Si se envió, crear conversación + mensaje para que aparezca en el dashboard
      if (sent) {
        // Buscar canal WhatsApp activo para esta org (con cache)
        if (!orgChannelCache.has(orgId)) {
          const { data: orgBranches } = await supabase
            .from('branches')
            .select('id')
            .eq('organization_id', orgId)
          const branchIds = orgBranches?.map((b: { id: string }) => b.id) ?? []

          if (branchIds.length > 0) {
            const { data: ch } = await supabase
              .from('social_channels')
              .select('id')
              .eq('platform', 'whatsapp')
              .eq('is_active', true)
              .in('branch_id', branchIds)
              .limit(1)
              .maybeSingle()
            orgChannelCache.set(orgId, ch)
          } else {
            orgChannelCache.set(orgId, null)
          }
        }
        const waChannel = orgChannelCache.get(orgId)

        if (waChannel) {
          const phoneClean = (msg.phone as string).replace(/\D/g, '')
          let convId: string | null = null
          const { data: existingConv } = await supabase
            .from('conversations')
            .select('id')
            .eq('channel_id', waChannel.id)
            .eq('platform_user_id', phoneClean)
            .maybeSingle()

          if (existingConv) {
            convId = existingConv.id
          } else {
            const { data: newConv } = await supabase
              .from('conversations')
              .insert({
                channel_id: waChannel.id,
                client_id: msg.client_id,
                platform_user_id: phoneClean,
                status: 'open',
                unread_count: 0,
                last_message_at: new Date().toISOString(),
              })
              .select('id')
              .single()
            convId = newConv?.id ?? null
          }

          if (convId) {
            await supabase.from('messages').insert({
              conversation_id: convId,
              direction: 'outbound',
              content_type: 'text',
              content: msg.content,
              status: 'sent',
            })

            await supabase
              .from('conversations')
              .update({ last_message_at: new Date().toISOString() })
              .eq('id', convId)
          }
        }
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

      results.push({ id: msg.id, sent, error: errorMsg })
    }

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
