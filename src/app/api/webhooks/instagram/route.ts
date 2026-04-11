import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Obtener el nombre/username del usuario de Instagram vía Graph API
async function fetchIgUserProfile(userId: string, accessToken: string): Promise<{ name: string | null; username: string | null }> {
  try {
    const res = await fetch(
      `https://graph.instagram.com/${userId}?fields=name,username&access_token=${encodeURIComponent(accessToken)}`,
      { signal: AbortSignal.timeout(5000) }
    )
    if (!res.ok) {
      // Fallback: intentar con graph.facebook.com (para IG-scoped IDs)
      const fbRes = await fetch(
        `https://graph.facebook.com/v21.0/${userId}?fields=name,username&access_token=${encodeURIComponent(accessToken)}`,
        { signal: AbortSignal.timeout(5000) }
      )
      if (!fbRes.ok) return { name: null, username: null }
      const fbData = await fbRes.json()
      return { name: fbData.name ?? null, username: fbData.username ?? null }
    }
    const data = await res.json()
    return { name: data.name ?? null, username: data.username ?? null }
  } catch (err) {
    console.warn('[IG Webhook] Error obteniendo perfil de usuario:', (err as Error).message)
    return { name: null, username: null }
  }
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

  // Log diagnóstico: qué envía Meta (sin datos sensibles)
  console.log('[IG Webhook] object:', body.object, 'entries:', body.entry?.length ?? 0,
    'entry_ids:', body.entry?.map((e: any) => e.id),
    'has_messaging:', body.entry?.map((e: any) => (e.messaging?.length ?? 0)),
    'has_changes:', body.entry?.map((e: any) => (e.changes?.length ?? 0)))

  // Aceptar tanto 'instagram' como 'page' — Meta puede enviar cualquiera
  // dependiendo de la configuración del webhook
  if (body.object !== 'instagram' && body.object !== 'page') {
    console.log('[IG Webhook] Ignorando object:', body.object)
    return NextResponse.json({ ok: true })
  }

  const supabase = getSupabase()
  const signature = req.headers.get('x-hub-signature-256')

  for (const entry of body.entry ?? []) {
    const entryId: string = entry.id

    // Buscar org por cualquier ID que Meta envíe como entry.id
    // Puede ser: Facebook Page ID, Instagram Account ID, o IG-scoped ID
    let igConfig: { organization_id: string; app_secret: string | null; instagram_page_access_token: string | null } | null = null

    const { data: configByPageId } = await supabase
      .from('organization_instagram_config')
      .select('organization_id, app_secret, instagram_page_access_token')
      .eq('instagram_page_id', entryId)
      .maybeSingle()

    if (configByPageId) {
      igConfig = configByPageId
    } else {
      const { data: configByAccountId } = await supabase
        .from('organization_instagram_config')
        .select('organization_id, app_secret, instagram_page_access_token')
        .eq('instagram_account_id', entryId)
        .maybeSingle()
      igConfig = configByAccountId
    }

    if (!igConfig) {
      console.warn('[IG Webhook] Config no encontrada para entry.id:', entryId)
      continue
    }

    // Verificar HMAC si app_secret está configurado
    // TODO: hacer estricto (continue en vez de warn) una vez confirmado
    if (igConfig.app_secret && signature) {
      const valid = await verifyHmacSignature(rawBody, signature, igConfig.app_secret)
      if (!valid) {
        console.warn('[IG Webhook] HMAC no coincide — verificar app_secret')
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
          platform_account_id: entryId,
          display_name: 'Instagram Business',
          is_active: true,
        })
        .select('id')
        .single()
      igChannel = newChannel
    }

    if (!igChannel) continue

    // Normalizar eventos: Instagram puede enviar entry.messaging o entry.changes
    const messagingEvents: any[] = []

    // Formato estándar: entry.messaging (array de eventos)
    if (entry.messaging?.length > 0) {
      messagingEvents.push(...entry.messaging)
    }

    // Formato alternativo: entry.changes (usado en algunas suscripciones)
    if (entry.changes?.length > 0) {
      for (const change of entry.changes) {
        if (change.field === 'messaging' || change.field === 'messages') {
          const val = change.value
          // changes.value puede ser un evento individual o contener un array
          if (val?.sender && val?.message) {
            messagingEvents.push(val)
          } else if (Array.isArray(val)) {
            messagingEvents.push(...val)
          }
        }
      }
    }

    if (messagingEvents.length === 0) {
      console.warn('[IG Webhook] Sin eventos de mensajería en entry. Keys:', Object.keys(entry),
        'changes:', JSON.stringify(entry.changes?.map((c: any) => ({ field: c.field, valueKeys: Object.keys(c.value ?? {}) }))))
    }

    for (const messaging of messagingEvents) {
      // Ignorar echo (mensajes enviados por la página misma)
      if (messaging.message?.is_echo) continue

      const senderId: string = messaging.sender?.id
      const recipientId: string = messaging.recipient?.id
      const platformMsgId: string = messaging.message?.mid
      const rawTimestamp = messaging.timestamp
      const text: string = messaging.message?.text ?? ''

      if (!senderId || !platformMsgId) {
        console.warn('[IG Webhook] Evento sin sender o mid, keys:', Object.keys(messaging))
        continue
      }

      // Parsear timestamp de forma robusta (puede ser segundos, milisegundos, o string ISO)
      let msgDate: Date
      if (typeof rawTimestamp === 'number') {
        msgDate = rawTimestamp > 1e12 ? new Date(rawTimestamp) : new Date(rawTimestamp * 1000)
      } else if (typeof rawTimestamp === 'string') {
        msgDate = new Date(rawTimestamp)
      } else {
        msgDate = new Date()
      }
      const createdAt = isNaN(msgDate.getTime()) ? new Date().toISOString() : msgDate.toISOString()

      // El remitente es el usuario de Instagram (no la cuenta business)
      const from = senderId === entryId ? recipientId : senderId

      // Deduplicación ANTES de crear/actualizar conversación
      const { data: existingMsg } = await supabase
        .from('messages')
        .select('id')
        .eq('platform_message_id', platformMsgId)
        .maybeSingle()
      if (existingMsg) continue

      // Buscar cliente por instagram ID (filtrado por org)
      const { data: client } = await supabase
        .from('clients')
        .select('id, name')
        .eq('organization_id', orgId)
        .eq('instagram', from)
        .maybeSingle()

      // Intentar obtener el nombre del perfil de Instagram si no hay cliente vinculado
      let displayName: string = client?.name ?? from
      if (!client?.name && igConfig.instagram_page_access_token) {
        const profile = await fetchIgUserProfile(from, igConfig.instagram_page_access_token)
        if (profile.name) {
          displayName = profile.name
        } else if (profile.username) {
          displayName = `@${profile.username}`
        }
      }

      // Buscar o crear conversación
      const { data: existingConv } = await supabase
        .from('conversations')
        .select('id, unread_count, platform_user_name')
        .eq('channel_id', igChannel.id)
        .eq('platform_user_id', from)
        .maybeSingle()

      let convId: string
      const replyUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

      if (existingConv) {
        convId = existingConv.id
        // Actualizar nombre si antes era el ID numérico y ahora tenemos uno mejor
        const shouldUpdateName = existingConv.platform_user_name === from && displayName !== from
        await supabase
          .from('conversations')
          .update({
            unread_count: (existingConv.unread_count || 0) + 1,
            last_message_at: new Date().toISOString(),
            client_id: client?.id ?? null,
            can_reply_until: replyUntil,
            ...(shouldUpdateName ? { platform_user_name: displayName } : {}),
          })
          .eq('id', convId)
      } else {
        const { data: newConv, error: convErr } = await supabase
          .from('conversations')
          .insert({
            channel_id: igChannel.id,
            client_id: client?.id ?? null,
            platform_user_id: from,
            platform_user_name: displayName,
            status: 'open',
            unread_count: 1,
            last_message_at: new Date().toISOString(),
            can_reply_until: replyUntil,
          })
          .select('id')
          .single()

        if (convErr || !newConv) {
          console.error('[IG Webhook] Error creando conversación:', convErr?.message)
          continue
        }
        convId = newConv.id
      }

      const { error: msgErr } = await supabase.from('messages').insert({
        conversation_id: convId,
        direction: 'inbound',
        content_type: 'text',
        content: text || null,
        platform_message_id: platformMsgId,
        status: 'delivered',
        created_at: createdAt,
      })
      if (msgErr) {
        console.error('[IG Webhook] Error insertando mensaje:', msgErr.message)
      }

      // ── Workflow Engine: evaluar reglas y workflows ──
      if (igConfig.instagram_page_access_token) {
        try {
          // Detectar quick_reply (respuestas a botones en IG)
          const quickReply = messaging.message?.quick_reply
          let igInteractivePayload: { type?: string; button_reply?: { id: string; title: string } } | undefined
          let igMessageType = 'text'

          if (quickReply) {
            igMessageType = 'interactive'
            igInteractivePayload = {
              type: 'button_reply',
              button_reply: { id: quickReply.payload ?? '', title: text },
            }
          }

          const { evaluateIncomingMessage } = await import('@/lib/workflow-engine')
          await evaluateIncomingMessage({
            orgId,
            conversationId: convId,
            text,
            platform: 'instagram',
            messageType: igMessageType,
            interactivePayload: igInteractivePayload,
            igConfig: {
              instagram_page_access_token: igConfig.instagram_page_access_token,
            },
            platformUserId: from,
          })
        } catch (engineErr) {
          console.error('[IG Webhook] Error en workflow engine:', engineErr)
        }
      }
    }
  }

  return NextResponse.json({ ok: true })
}
