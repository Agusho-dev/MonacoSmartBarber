import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Verifica la firma HMAC-SHA256 del payload enviado por Meta
async function verifyHmacSignature(
  body: string,
  signature: string | null,
  appSecret: string
): Promise<boolean> {
  if (!signature) return false
  const expectedSig = signature.replace('sha256=', '')
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
  const hexSig = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return hexSig === expectedSig
}

// GET: Meta verifica el webhook con un challenge
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const mode      = searchParams.get('hub.mode')
  const token     = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  const supabase = getSupabase()

  // DEBUG: Loguear verificación
  await supabase.from('webhook_debug_log').insert({
    endpoint: 'whatsapp', method: 'GET',
    body: { mode, token_prefix: token?.slice(0, 8), has_challenge: !!challenge },
  })

  if (mode !== 'subscribe' || !token || !challenge) {
    return new NextResponse('Bad Request', { status: 400 })
  }

  const { data: config } = await supabase
    .from('organization_whatsapp_config')
    .select('id')
    .eq('verify_token', token)
    .maybeSingle()

  if (!config) {
    await supabase.from('webhook_debug_log').insert({
      endpoint: 'whatsapp', method: 'GET',
      error: `verify_token not found in DB. Token prefix: ${token.slice(0, 8)}`,
    })
    return new NextResponse('Forbidden', { status: 403 })
  }

  return new NextResponse(challenge, { status: 200 })
}

// POST: Meta envía mensajes entrantes y actualizaciones de estado
export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const supabase = getSupabase()

  // DEBUG: Loguear todo request que llegue al webhook
  let body: any
  try {
    body = JSON.parse(rawBody)
  } catch {
    await supabase.from('webhook_debug_log').insert({
      endpoint: 'whatsapp', method: 'POST',
      body: { raw: rawBody.slice(0, 500) },
      error: 'JSON parse failed',
    })
    return new NextResponse('Bad Request', { status: 400 })
  }

  await supabase.from('webhook_debug_log').insert({
    endpoint: 'whatsapp', method: 'POST',
    body: {
      object: body.object,
      entry_count: body.entry?.length,
      first_entry_id: body.entry?.[0]?.id,
      first_change_field: body.entry?.[0]?.changes?.[0]?.field,
      phone_number_id: body.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id,
      messages_count: body.entry?.[0]?.changes?.[0]?.value?.messages?.length ?? 0,
      statuses_count: body.entry?.[0]?.changes?.[0]?.value?.statuses?.length ?? 0,
    },
  })

  if (body.object !== 'whatsapp_business_account') {
    return NextResponse.json({ ok: true })
  }

  const signature = req.headers.get('x-hub-signature-256')

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue
      const value = change.value
      const phoneNumberId: string = value.metadata?.phone_number_id

      if (!phoneNumberId) continue

      // Encontrar la org por phone_number_id
      const { data: waConfig } = await supabase
        .from('organization_whatsapp_config')
        .select('organization_id, app_secret, whatsapp_access_token, whatsapp_phone_id')
        .eq('whatsapp_phone_id', phoneNumberId)
        .maybeSingle()

      if (!waConfig) continue

      // Verificar HMAC si app_secret está configurado
      // TODO: hacer estricto una vez confirmado que funciona
      if (waConfig.app_secret && signature) {
        const valid = await verifyHmacSignature(rawBody, signature, waConfig.app_secret)
        if (!valid) {
          console.warn('[WA Webhook] HMAC no coincide — verificar app_secret. Continuando de todas formas.')
        }
      }

      const orgId = waConfig.organization_id

      // Encontrar canal WhatsApp de la org
      const { data: orgBranches } = await supabase
        .from('branches')
        .select('id')
        .eq('organization_id', orgId)

      const branchIds = orgBranches?.map((b: any) => b.id) ?? []
      if (branchIds.length === 0) continue

      let { data: waChannel } = await supabase
        .from('social_channels')
        .select('id')
        .in('branch_id', branchIds)
        .eq('platform', 'whatsapp')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()

      if (!waChannel) {
        const { data: newChannel } = await supabase
          .from('social_channels')
          .insert({
            branch_id: branchIds[0],
            platform: 'whatsapp',
            platform_account_id: phoneNumberId,
            display_name: 'WhatsApp Business',
            is_active: true,
          })
          .select('id')
          .single()
        waChannel = newChannel
      }

      if (!waChannel) continue

      // Procesar mensajes entrantes
      for (const message of value.messages ?? []) {
        if (!['text', 'image', 'audio', 'video', 'document'].includes(message.type)) continue

        const from: string          = message.from
        const platformMsgId: string = message.id
        const timestamp: string     = message.timestamp
        const text: string          = message.text?.body ?? ''
        const mediaUrl: string | undefined = message.image?.link ?? message.video?.link ?? message.audio?.link ?? message.document?.link
        const contentType = message.type === 'text' ? 'text' : message.type

        // Deduplicación ANTES de crear/actualizar conversación
        const { data: existingMsg } = await supabase
          .from('messages')
          .select('id')
          .eq('platform_message_id', platformMsgId)
          .maybeSingle()
        if (existingMsg) continue

        // Buscar cliente por teléfono (filtrado por org)
        const phoneSuffix = from.slice(-10)
        const { data: client } = await supabase
          .from('clients')
          .select('id, name')
          .eq('organization_id', orgId)
          .ilike('phone', `%${phoneSuffix}`)
          .maybeSingle()

        // Buscar o crear conversación
        const { data: existingConv } = await supabase
          .from('conversations')
          .select('id, unread_count')
          .eq('channel_id', waChannel.id)
          .eq('platform_user_id', from)
          .maybeSingle()

        let convId: string
        const replyUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

        if (existingConv) {
          convId = existingConv.id
          await supabase
            .from('conversations')
            .update({
              unread_count: (existingConv.unread_count || 0) + 1,
              last_message_at: new Date().toISOString(),
              client_id: client?.id ?? null,
              can_reply_until: replyUntil,
            })
            .eq('id', convId)
        } else {
          const { data: newConv, error: convErr } = await supabase
            .from('conversations')
            .insert({
              channel_id: waChannel.id,
              client_id: client?.id ?? null,
              platform_user_id: from,
              platform_user_name: client?.name ?? from,
              status: 'open',
              unread_count: 1,
              last_message_at: new Date().toISOString(),
              can_reply_until: replyUntil,
            })
            .select('id')
            .single()

          if (convErr || !newConv) continue
          convId = newConv.id
        }

        await supabase.from('messages').insert({
          conversation_id: convId,
          direction: 'inbound',
          content_type: contentType,
          content: text || null,
          media_url: mediaUrl ?? null,
          platform_message_id: platformMsgId,
          status: 'delivered',
          created_at: new Date(parseInt(timestamp) * 1000).toISOString(),
        })

        // ── Auto-reply: evaluar reglas por palabra clave ──
        if (text && contentType === 'text' && waConfig.whatsapp_access_token && waConfig.whatsapp_phone_id) {
          try {
            const { data: rules } = await supabase
              .from('auto_reply_rules')
              .select('*')
              .eq('organization_id', orgId)
              .eq('is_active', true)
              .in('platform', ['all', 'whatsapp'])
              .order('priority', { ascending: false })

            if (rules && rules.length > 0) {
              const lowerText = text.toLowerCase()
              for (const rule of rules) {
                const keywords: string[] = rule.keywords ?? []
                const matched = rule.match_mode === 'exact'
                  ? keywords.some((kw: string) => lowerText === kw.toLowerCase())
                  : keywords.some((kw: string) => lowerText.includes(kw.toLowerCase()))

                if (matched && rule.response_type === 'text' && rule.response_text) {
                  // Enviar respuesta via Meta Cloud API
                  const sendRes = await fetch(
                    `https://graph.facebook.com/v21.0/${waConfig.whatsapp_phone_id}/messages`,
                    {
                      method: 'POST',
                      headers: {
                        Authorization: `Bearer ${waConfig.whatsapp_access_token}`,
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify({
                        messaging_product: 'whatsapp',
                        to: from,
                        type: 'text',
                        text: { body: rule.response_text },
                      }),
                    }
                  )
                  const sendData = await sendRes.json()
                  const platformReplyId = sendData.messages?.[0]?.id ?? null

                  // Guardar mensaje de auto-respuesta
                  await supabase.from('messages').insert({
                    conversation_id: convId,
                    direction: 'outbound',
                    content_type: 'text',
                    content: rule.response_text,
                    platform_message_id: platformReplyId,
                    status: platformReplyId ? 'sent' : 'failed',
                    error_message: platformReplyId ? null : JSON.stringify(sendData).slice(0, 500),
                    created_at: new Date().toISOString(),
                  })

                  // Actualizar last_message_at en la conversación
                  await supabase
                    .from('conversations')
                    .update({ last_message_at: new Date().toISOString() })
                    .eq('id', convId)

                  break // Solo responder con la primera regla que matchee
                }
              }
            }
          } catch (autoReplyErr) {
            console.error('[WA Webhook] Error en auto-reply:', autoReplyErr)
          }
        }
      }

      // Procesar actualizaciones de estado
      for (const statusUpdate of value.statuses ?? []) {
        const metaMsgId: string = statusUpdate.id
        const newStatus: string = statusUpdate.status

        await supabase
          .from('messages')
          .update({ status: newStatus })
          .eq('platform_message_id', metaMsgId)
      }
    }
  }

  return NextResponse.json({ ok: true })
}
