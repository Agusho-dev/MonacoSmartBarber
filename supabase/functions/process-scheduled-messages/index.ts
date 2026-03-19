// Procesa mensajes programados pendientes vía WA Microservice (Baileys)
// Ejecutado por pg_cron cada 1 minuto o llamado manualmente

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

Deno.serve(async (req: Request) => {
  // Verificar authorization
  const authHeader = req.headers.get('Authorization')
  if (authHeader !== `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    // Obtener config del microservicio WA
    const { data: settings } = await supabase
      .from('app_settings')
      .select('wa_api_url')
      .maybeSingle()

    const waApiUrl = (settings as any)?.wa_api_url as string | null
    const waApiKey = Deno.env.get('WA_API_KEY')

    // Obtener mensajes pendientes cuyo scheduled_for ya pasó (máx 10 por tick)
    const { data: pendingMessages, error } = await supabase
      .from('scheduled_messages')
      .select('id, phone, content, client_id')
      .eq('status', 'pending')
      .lte('scheduled_for', new Date().toISOString())
      .limit(10)

    if (error) throw error

    // Buscar canal WhatsApp activo una sola vez, fuera del loop
    const { data: waChannel } = await supabase
      .from('social_channels')
      .select('id')
      .eq('platform', 'whatsapp')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()

    const results: Array<{ id: string; sent: boolean; error: string | null }> = []

    for (const msg of (pendingMessages ?? [])) {
      let sent = false
      let errorMsg: string | null = null

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
        errorMsg = 'Microservicio WA no configurado o falta teléfono en el mensaje'
      }

      // Si se envió, crear conversación + mensaje para que aparezca en el dashboard
      if (sent) {

        if (waChannel) {
          const phoneClean = (msg.phone as string).replace(/\D/g, '')

          // Buscar o crear conversación
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
            // Insertar mensaje saliente en la conversación
            await supabase.from('messages').insert({
              conversation_id: convId,
              direction: 'outbound',
              content_type: 'text',
              content: msg.content,
              status: 'sent',
            })

            // Actualizar last_message_at de la conversación
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
