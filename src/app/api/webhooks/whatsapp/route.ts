import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// GET: Meta verifica el webhook con un challenge
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const mode      = searchParams.get('hub.mode')
  const token     = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode !== 'subscribe' || !token || !challenge) {
    return new NextResponse('Bad Request', { status: 400 })
  }

  const supabase = getSupabase()
  const { data: config } = await supabase
    .from('organization_whatsapp_config')
    .select('id')
    .eq('verify_token', token)
    .maybeSingle()

  if (!config) {
    console.error('[WA Webhook] verify_token no encontrado:', token)
    return new NextResponse('Forbidden', { status: 403 })
  }

  console.log('[WA Webhook] Verificación exitosa')
  return new NextResponse(challenge, { status: 200 })
}

// POST: Meta envía mensajes entrantes y actualizaciones de estado
export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return new NextResponse('Bad Request', { status: 400 })
  }

  console.log('[WA Webhook] POST recibido, object:', body.object)

  if (body.object !== 'whatsapp_business_account') {
    return NextResponse.json({ ok: true })
  }

  const supabase = getSupabase()

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue
      const value = change.value
      const phoneNumberId: string = value.metadata?.phone_number_id

      console.log('[WA Webhook] phoneNumberId:', phoneNumberId)
      console.log('[WA Webhook] mensajes entrantes:', value.messages?.length ?? 0)
      console.log('[WA Webhook] status updates:', value.statuses?.length ?? 0)

      if (!phoneNumberId) continue

      // Encontrar la org por phone_number_id
      const { data: waConfig, error: configErr } = await supabase
        .from('organization_whatsapp_config')
        .select('organization_id')
        .eq('whatsapp_phone_id', phoneNumberId)
        .maybeSingle()

      if (configErr) console.error('[WA Webhook] Error buscando config:', configErr.message)
      if (!waConfig) {
        console.error('[WA Webhook] No se encontró org para phoneNumberId:', phoneNumberId)
        continue
      }

      const orgId = waConfig.organization_id
      console.log('[WA Webhook] orgId encontrado:', orgId)

      // Encontrar canal WhatsApp de la org
      const { data: orgBranches } = await supabase
        .from('branches')
        .select('id')
        .eq('organization_id', orgId)

      const branchIds = orgBranches?.map((b: any) => b.id) ?? []
      if (branchIds.length === 0) {
        console.error('[WA Webhook] No hay branches para orgId:', orgId)
        continue
      }

      let { data: waChannel } = await supabase
        .from('social_channels')
        .select('id')
        .in('branch_id', branchIds)
        .eq('platform', 'whatsapp')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()

      if (!waChannel) {
        console.log('[WA Webhook] Canal no existe, creando...')
        const { data: newChannel, error: chErr } = await supabase
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
        if (chErr) console.error('[WA Webhook] Error creando canal:', chErr.message)
        waChannel = newChannel
      }

      if (!waChannel) continue

      // Procesar mensajes entrantes
      for (const message of value.messages ?? []) {
        console.log('[WA Webhook] Procesando mensaje tipo:', message.type, 'from:', message.from)

        if (!['text', 'image', 'audio', 'video', 'document'].includes(message.type)) continue

        const from: string          = message.from
        const platformMsgId: string = message.id
        const timestamp: string     = message.timestamp
        const text: string          = message.text?.body ?? ''
        const mediaUrl: string | undefined = message.image?.link ?? message.video?.link ?? message.audio?.link ?? message.document?.link
        const contentType = message.type === 'text' ? 'text' : message.type

        // Buscar cliente por teléfono
        const phoneSuffix = from.slice(-10)
        const { data: client } = await supabase
          .from('clients')
          .select('id, name')
          .eq('organization_id', orgId)
          .ilike('phone', `%${phoneSuffix}`)
          .maybeSingle()

        console.log('[WA Webhook] Cliente encontrado:', client?.name ?? 'ninguno')

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

          if (convErr) {
            console.error('[WA Webhook] Error creando conversación:', convErr.message)
            continue
          }
          if (!newConv) continue
          convId = newConv.id
          console.log('[WA Webhook] Nueva conversación creada:', convId)
        }

        // Evitar duplicados
        const { data: existing } = await supabase
          .from('messages')
          .select('id')
          .eq('platform_message_id', platformMsgId)
          .maybeSingle()
        if (existing) {
          console.log('[WA Webhook] Mensaje duplicado, ignorando:', platformMsgId)
          continue
        }

        const { error: msgErr } = await supabase.from('messages').insert({
          conversation_id: convId,
          direction: 'inbound',
          content_type: contentType,
          content: text || null,
          media_url: mediaUrl ?? null,
          platform_message_id: platformMsgId,
          status: 'delivered',
          created_at: new Date(parseInt(timestamp) * 1000).toISOString(),
        })

        if (msgErr) console.error('[WA Webhook] Error insertando mensaje:', msgErr.message)
        else console.log('[WA Webhook] Mensaje insertado OK')
      }

      // Procesar actualizaciones de estado
      for (const statusUpdate of value.statuses ?? []) {
        const metaMsgId: string = statusUpdate.id
        const newStatus: string = statusUpdate.status
        console.log('[WA Webhook] Status update:', metaMsgId, '→', newStatus)

        await supabase
          .from('messages')
          .update({ status: newStatus })
          .eq('platform_message_id', metaMsgId)
      }
    }
  }

  return NextResponse.json({ ok: true })
}
