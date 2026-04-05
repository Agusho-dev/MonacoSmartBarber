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
    return new NextResponse('Forbidden', { status: 403 })
  }

  return new NextResponse(challenge, { status: 200 })
}

// POST: Meta envía mensajes entrantes de Instagram DM
export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  let body: any
  try {
    body = JSON.parse(rawBody)
  } catch {
    return new NextResponse('Bad Request', { status: 400 })
  }

  // Log temporal para debug — ELIMINAR después de diagnosticar
  console.log('[IG Webhook] body.object:', body.object, 'entries:', JSON.stringify(body.entry?.map((e: any) => ({ id: e.id, messaging: e.messaging?.length ?? 0, changes: e.changes?.length ?? 0 }))))

  if (body.object !== 'instagram') {
    return NextResponse.json({ ok: true })
  }

  const supabase = getSupabase()
  const signature = req.headers.get('x-hub-signature-256')

  for (const entry of body.entry ?? []) {
    const pageId: string = entry.id

    // Log temporal para debug: ver qué entry.id envía Meta
    console.log('[IG Webhook] entry.id:', pageId, 'entry keys:', Object.keys(entry))

    // Buscar org por page_id
    // Instagram webhooks envían el Page ID de Facebook conectado como entry.id
    // Intentamos buscar por instagram_page_id primero, luego por instagram_account_id
    let igConfig: { organization_id: string; app_secret: string | null } | null = null

    const { data: configByPageId } = await supabase
      .from('organization_instagram_config')
      .select('organization_id, app_secret')
      .eq('instagram_page_id', pageId)
      .maybeSingle()

    if (configByPageId) {
      igConfig = configByPageId
    } else {
      // Fallback: buscar por instagram_account_id (IG Business Account ID)
      const { data: configByAccountId } = await supabase
        .from('organization_instagram_config')
        .select('organization_id, app_secret')
        .eq('instagram_account_id', pageId)
        .maybeSingle()
      igConfig = configByAccountId
    }

    if (!igConfig) {
      console.log('[IG Webhook] NO se encontró config para entry.id:', pageId)
      continue
    }
    console.log('[IG Webhook] Config encontrada, orgId:', igConfig.organization_id)

    // Verificar HMAC si app_secret está configurado
    if (igConfig.app_secret) {
      const valid = await verifyHmacSignature(rawBody, signature, igConfig.app_secret)
      if (!valid) {
        console.error('[IG Webhook] Firma HMAC inválida')
        return new NextResponse('Forbidden', { status: 403 })
      }
    }

    const orgId = igConfig.organization_id

    // Buscar canal Instagram de la org
    const { data: orgBranches } = await supabase
      .from('branches')
      .select('id')
      .eq('organization_id', orgId)

    const branchIds = orgBranches?.map((b: any) => b.id) ?? []
    if (branchIds.length === 0) continue

    let { data: igChannel } = await supabase
      .from('social_channels')
      .select('id')
      .in('branch_id', branchIds)
      .eq('platform', 'instagram')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()

    if (!igChannel) {
      const { data: newChannel } = await supabase
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
      igChannel = newChannel
    }

    if (!igChannel) {
      console.log('[IG Webhook] NO se encontró/creó canal IG')
      continue
    }
    console.log('[IG Webhook] Canal encontrado:', igChannel.id)

    // Procesar mensajes entrantes (messaging array)
    console.log('[IG Webhook] Mensajes en entry.messaging:', entry.messaging?.length ?? 0)
    for (const messaging of entry.messaging ?? []) {
      // Ignorar echo (mensajes enviados por la página misma)
      if (messaging.message?.is_echo) {
        console.log('[IG Webhook] Mensaje echo, ignorando')
        continue
      }

      const senderId: string = messaging.sender?.id
      const recipientId: string = messaging.recipient?.id
      const platformMsgId: string = messaging.message?.mid
      const timestamp: number = messaging.timestamp
      const text: string = messaging.message?.text ?? ''

      console.log('[IG Webhook] sender:', senderId, 'recipient:', recipientId, 'mid:', platformMsgId, 'text:', text?.slice(0, 30))

      if (!senderId || !platformMsgId) {
        console.log('[IG Webhook] Faltan senderId o platformMsgId, skip')
        continue
      }

      // El remitente es el usuario (no la página)
      const from = senderId === pageId ? recipientId : senderId
      console.log('[IG Webhook] from (usuario):', from)

      // Deduplicación ANTES de crear/actualizar conversación
      const { data: existingMsg } = await supabase
        .from('messages')
        .select('id')
        .eq('platform_message_id', platformMsgId)
        .maybeSingle()
      if (existingMsg) continue

      // Buscar cliente por instagram handle (filtrado por org)
      const { data: client } = await supabase
        .from('clients')
        .select('id, name')
        .eq('organization_id', orgId)
        .eq('instagram', from)
        .maybeSingle()

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

        if (convErr || !newConv) {
          console.log('[IG Webhook] Error creando conversación:', convErr?.message)
          continue
        }
        convId = newConv.id
        console.log('[IG Webhook] Conversación creada:', convId)
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
      if (msgErr) console.log('[IG Webhook] Error insertando mensaje:', msgErr.message)
      else console.log('[IG Webhook] Mensaje insertado OK en conv:', convId)
    }
  }

  return NextResponse.json({ ok: true })
}
