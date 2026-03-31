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
    .from('organization_instagram_config')
    .select('id')
    .eq('verify_token', token)
    .maybeSingle()

  if (!config) {
    console.error('[IG Webhook] verify_token no encontrado:', token)
    return new NextResponse('Forbidden', { status: 403 })
  }

  console.log('[IG Webhook] Verificación exitosa')
  return new NextResponse(challenge, { status: 200 })
}

// POST: Meta envía mensajes entrantes de Instagram DM
export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return new NextResponse('Bad Request', { status: 400 })
  }

  console.log('[IG Webhook] POST recibido, object:', body.object)

  if (body.object !== 'instagram') {
    return NextResponse.json({ ok: true })
  }

  const supabase = getSupabase()

  for (const entry of body.entry ?? []) {
    const pageId: string = entry.id
    console.log('[IG Webhook] pageId:', pageId)

    // Buscar org por page_id
    const { data: igConfig, error: configErr } = await supabase
      .from('organization_instagram_config')
      .select('organization_id')
      .eq('instagram_page_id', pageId)
      .maybeSingle()

    if (configErr) console.error('[IG Webhook] Error buscando config:', configErr.message)
    if (!igConfig) {
      console.error('[IG Webhook] No se encontró org para pageId:', pageId)
      continue
    }

    const orgId = igConfig.organization_id
    console.log('[IG Webhook] orgId encontrado:', orgId)

    // Buscar canal Instagram de la org
    const { data: orgBranches } = await supabase
      .from('branches')
      .select('id')
      .eq('organization_id', orgId)

    const branchIds = orgBranches?.map((b: any) => b.id) ?? []
    if (branchIds.length === 0) {
      console.error('[IG Webhook] No hay branches para orgId:', orgId)
      continue
    }

    let { data: igChannel } = await supabase
      .from('social_channels')
      .select('id')
      .in('branch_id', branchIds)
      .eq('platform', 'instagram')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()

    if (!igChannel) {
      console.log('[IG Webhook] Canal no existe, creando...')
      const { data: newChannel, error: chErr } = await supabase
        .from('social_channels')
        .insert({
          branch_id: branchIds[0],
          platform: 'instagram',
          platform_account_id: pageId,
          display_name: 'Instagram Business',
          is_active: true,
        })
        .select('id')
        .single()
      if (chErr) console.error('[IG Webhook] Error creando canal:', chErr.message)
      igChannel = newChannel
    }

    if (!igChannel) continue

    // Procesar mensajes entrantes (messaging array)
    for (const messaging of entry.messaging ?? []) {
      // Ignorar echo (mensajes enviados por la página misma)
      if (messaging.message?.is_echo) continue

      const senderId: string = messaging.sender?.id
      const recipientId: string = messaging.recipient?.id
      const platformMsgId: string = messaging.message?.mid
      const timestamp: number = messaging.timestamp
      const text: string = messaging.message?.text ?? ''

      if (!senderId || !platformMsgId) continue

      // El remitente es el usuario (no la página)
      const from = senderId === pageId ? recipientId : senderId
      console.log('[IG Webhook] Mensaje de:', from, 'texto:', text.slice(0, 50))

      // Buscar cliente por instagram handle (si lo tenemos)
      const { data: client } = await supabase
        .from('clients')
        .select('id, name')
        .eq('organization_id', orgId)
        .eq('instagram', from)
        .maybeSingle()

      console.log('[IG Webhook] Cliente encontrado:', client?.name ?? 'ninguno')

      // Buscar o crear conversación
      const { data: existingConv } = await supabase
        .from('conversations')
        .select('id, unread_count')
        .eq('channel_id', igChannel.id)
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
            channel_id: igChannel.id,
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
          console.error('[IG Webhook] Error creando conversación:', convErr.message)
          continue
        }
        if (!newConv) continue
        convId = newConv.id
        console.log('[IG Webhook] Nueva conversación creada:', convId)
      }

      // Evitar duplicados
      const { data: existing } = await supabase
        .from('messages')
        .select('id')
        .eq('platform_message_id', platformMsgId)
        .maybeSingle()
      if (existing) {
        console.log('[IG Webhook] Mensaje duplicado, ignorando:', platformMsgId)
        continue
      }

      const { error: msgErr } = await supabase.from('messages').insert({
        conversation_id: convId,
        direction: 'inbound',
        content_type: 'text',
        content: text || null,
        platform_message_id: platformMsgId,
        status: 'delivered',
        created_at: new Date(timestamp * 1000).toISOString(),
      })

      if (msgErr) console.error('[IG Webhook] Error insertando mensaje:', msgErr.message)
      else console.log('[IG Webhook] Mensaje insertado OK')
    }
  }

  return NextResponse.json({ ok: true })
}
