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
    // Obtener mensajes pendientes cuyo scheduled_for ya pasó (máx 10 por tick)
    const { data: pendingMessages, error } = await supabase
      .from('scheduled_messages')
      .select('id, phone, content, client_id, channel_id')
      .eq('status', 'pending')
      .lte('scheduled_for', new Date().toISOString())
      .limit(10)

    if (error) throw error

    const results: Array<{ id: string; sent: boolean; error: string | null }> = []

    for (const msg of (pendingMessages ?? [])) {
      let sent = false
      let errorMsg: string | null = null

      // Resolver el canal y la config de WA para este mensaje
      // El channel_id ya está en el scheduled_message
      const { data: channel } = await supabase
        .from('social_channels')
        .select('id, branch_id, platform')
        .eq('id', msg.channel_id)
        .maybeSingle()

      if (!channel) {
        errorMsg = 'Canal no encontrado'
      } else if (channel.platform !== 'whatsapp') {
        errorMsg = 'Solo se soporta envío programado por WhatsApp'
      } else {
        // Resolver org desde el branch del canal
        const { data: branch } = await supabase
          .from('branches')
          .select('organization_id')
          .eq('id', channel.branch_id)
          .maybeSingle()

        if (!branch) {
          errorMsg = 'Sucursal del canal no encontrada'
        } else {
          // Obtener config de WA para esta org
          const { data: waConfig } = await supabase
            .from('organization_whatsapp_config')
            .select('whatsapp_access_token, whatsapp_phone_id')
            .eq('organization_id', branch.organization_id)
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
      }

      // Si se envió, crear conversación + mensaje para que aparezca en el dashboard
      if (sent && channel) {
        const phoneClean = (msg.phone as string).replace(/\D/g, '')

        let convId: string | null = null
        const { data: existingConv } = await supabase
          .from('conversations')
          .select('id')
          .eq('channel_id', channel.id)
          .eq('platform_user_id', phoneClean)
          .maybeSingle()

        if (existingConv) {
          convId = existingConv.id
        } else {
          const { data: newConv } = await supabase
            .from('conversations')
            .insert({
              channel_id: channel.id,
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
