import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET: Meta verifica el webhook con un challenge
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const mode      = searchParams.get('hub.mode')
  const token     = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode !== 'subscribe' || !token || !challenge) {
    return new NextResponse('Bad Request', { status: 400 })
  }

  // Buscamos la org que tiene ese verify_token
  const { data: config } = await supabase
    .from('organization_whatsapp_config')
    .select('id')
    .eq('verify_token', token)
    .maybeSingle()

  if (!config) {
    return new NextResponse('Forbidden', { status: 403 })
  }

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

  if (body.object !== 'whatsapp_business_account') {
    return NextResponse.json({ ok: true })
  }

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue
      const value = change.value
      const phoneNumberId: string = value.metadata?.phone_number_id

      if (!phoneNumberId) continue

      // Encontrar la org por phone_number_id
      const { data: waConfig } = await supabase
        .from('organization_whatsapp_config')
        .select('organization_id')
        .eq('whatsapp_phone_id', phoneNumberId)
        .maybeSingle()

      if (!waConfig) continue

      const orgId = waConfig.organization_id

      // Encontrar o crear canal social de WhatsApp para esta org
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

      // Si no existe canal, crearlo automáticamente en el primer branch
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

        const from: string         = message.from
        const platformMsgId: string = message.id
        const timestamp: string    = message.timestamp
        const text: string         = message.text?.body ?? ''
        const mediaUrl: string | undefined = message.image?.link ?? message.video?.link ?? message.audio?.link ?? message.document?.link

        const contentType = message.type === 'text' ? 'text' : message.type

        // Buscar cliente por teléfono (últimos 10 dígitos para tolerancia de código de país)
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
          const { data: newConv } = await supabase
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

          if (!newConv) continue
          convId = newConv.id
        }

        // Evitar duplicados por platform_message_id
        const { data: existing } = await supabase
          .from('messages')
          .select('id')
          .eq('platform_message_id', platformMsgId)
          .maybeSingle()
        if (existing) continue

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
      }

      // Procesar actualizaciones de estado (leído, entregado, fallido)
      for (const statusUpdate of value.statuses ?? []) {
        const metaMsgId: string = statusUpdate.id
        const newStatus: string = statusUpdate.status // 'sent' | 'delivered' | 'read' | 'failed'

        await supabase
          .from('messages')
          .update({ status: newStatus })
          .eq('platform_message_id', metaMsgId)
      }
    }
  }

  return NextResponse.json({ ok: true })
}
