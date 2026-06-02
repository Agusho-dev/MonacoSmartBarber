import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Obtener nombre / username / foto de perfil del usuario de Instagram vía Graph API.
type IgProfile = { name: string | null; username: string | null; profilePic: string | null }
async function fetchIgUserProfile(userId: string, accessToken: string): Promise<IgProfile> {
  const parse = (d: Record<string, unknown>): IgProfile => ({
    name: (d.name as string) ?? null,
    username: (d.username as string) ?? null,
    profilePic: (d.profile_pic as string) ?? null,
  })
  try {
    const res = await fetch(
      `https://graph.instagram.com/${userId}?fields=name,username,profile_pic&access_token=${encodeURIComponent(accessToken)}`,
      { signal: AbortSignal.timeout(5000) }
    )
    if (!res.ok) {
      // Fallback: intentar con graph.facebook.com (para IG-scoped IDs)
      const fbRes = await fetch(
        `https://graph.facebook.com/v21.0/${userId}?fields=name,username,profile_pic&access_token=${encodeURIComponent(accessToken)}`,
        { signal: AbortSignal.timeout(5000) }
      )
      if (!fbRes.ok) {
        // Log del motivo (token vencido = code 190) para diagnóstico.
        try { const e = await res.json(); console.warn('[IG Webhook] perfil no disponible:', e?.error?.message) } catch { /* noop */ }
        return { name: null, username: null, profilePic: null }
      }
      return parse(await fbRes.json())
    }
    return parse(await res.json())
  } catch (err) {
    console.warn('[IG Webhook] Error obteniendo perfil de usuario:', (err as Error).message)
    return { name: null, username: null, profilePic: null }
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

type IgAttachment = {
  type?: string
  payload?: { url?: string }
}
type IgMessagingEvent = {
  sender?: { id?: string }
  recipient?: { id?: string }
  timestamp?: number | string
  read?: unknown
  delivery?: unknown
  message?: {
    mid?: string
    text?: string
    is_echo?: boolean
    quick_reply?: { payload?: string }
    attachments?: IgAttachment[]
  }
}
type IgChange = {
  field?: string
  value?: unknown
}
type IgEntry = {
  id?: string
  messaging?: IgMessagingEvent[]
  changes?: IgChange[]
}
type IgWebhookBody = {
  object?: string
  entry?: IgEntry[]
}

// POST: Meta envía mensajes entrantes de Instagram DM
export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  let body: IgWebhookBody
  try {
    body = JSON.parse(rawBody) as IgWebhookBody
  } catch {
    return new NextResponse('Bad Request', { status: 400 })
  }

  // Log diagnóstico: qué envía Meta (sin datos sensibles)
  console.log('[IG Webhook] object:', body.object, 'entries:', body.entry?.length ?? 0,
    'entry_ids:', body.entry?.map((e) => e.id),
    'has_messaging:', body.entry?.map((e) => (e.messaging?.length ?? 0)),
    'has_changes:', body.entry?.map((e) => (e.changes?.length ?? 0)))

  // Aceptar tanto 'instagram' como 'page' — Meta puede enviar cualquiera
  // dependiendo de la configuración del webhook
  if (body.object !== 'instagram' && body.object !== 'page') {
    console.log('[IG Webhook] Ignorando object:', body.object)
    return NextResponse.json({ ok: true })
  }

  const supabase = getSupabase()
  const signature = req.headers.get('x-hub-signature-256')

  for (const entry of body.entry ?? []) {
    if (!entry.id) continue
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

    // Canal Instagram de la org. Matcheamos por organization_id porque los canales
    // pueden ser org-wide (branch_id = null) o legacy por sucursal.
    let { data: igChannel } = await supabase
      .from('social_channels')
      .select('id')
      .eq('organization_id', orgId)
      .eq('platform', 'instagram')
      .eq('is_active', true)
      .order('branch_id', { ascending: true, nullsFirst: true })
      .limit(1)
      .maybeSingle()

    if (!igChannel) {
      const { data: newChannel, error: newChannelErr } = await supabase
        .from('social_channels')
        .insert({
          organization_id: orgId,
          branch_id: null,
          platform: 'instagram',
          platform_account_id: entryId,
          display_name: 'Instagram Business',
          is_active: true,
        })
        .select('id')
        .single()
      if (newChannelErr) {
        console.error('[IG Webhook] No se pudo crear canal fallback:', newChannelErr.message)
      }
      igChannel = newChannel
    }

    if (!igChannel) continue

    // Normalizar eventos: Instagram puede enviar entry.messaging o entry.changes
    const messagingEvents: IgMessagingEvent[] = []

    // Formato estándar: entry.messaging (array de eventos)
    if ((entry.messaging?.length ?? 0) > 0) {
      messagingEvents.push(...(entry.messaging ?? []))
    }

    // Formato alternativo: entry.changes (usado en algunas suscripciones)
    if ((entry.changes?.length ?? 0) > 0) {
      for (const change of entry.changes ?? []) {
        if (change.field === 'messaging' || change.field === 'messages') {
          const val = change.value as IgMessagingEvent | IgMessagingEvent[] | undefined
          // changes.value puede ser un evento individual o contener un array
          if (val && !Array.isArray(val) && val.sender && val.message) {
            messagingEvents.push(val)
          } else if (Array.isArray(val)) {
            messagingEvents.push(...val)
          }
        }
      }
    }

    if (messagingEvents.length === 0) {
      console.warn('[IG Webhook] Sin eventos de mensajería en entry. Keys:', Object.keys(entry),
        'changes:', JSON.stringify(entry.changes?.map((c) => ({ field: c.field, valueKeys: Object.keys((c.value ?? {}) as Record<string, unknown>) }))))
    }

    for (const messaging of messagingEvents) {
      // ── Leer receipts: marcar conversación como leída ──
      if (messaging.read) {
        const readSenderId = messaging.sender?.id
        // Si quien leyó es la página (business), resetear unread
        if (readSenderId === entryId) {
          const readRecipient = messaging.recipient?.id
          if (readRecipient) {
            await supabase
              .from('conversations')
              .update({ unread_count: 0 })
              .eq('channel_id', igChannel.id)
              .eq('platform_user_id', readRecipient)
          }
        }
        continue
      }

      // Ignorar delivery receipts
      if (messaging.delivery) continue

      const senderId = messaging.sender?.id
      const recipientId = messaging.recipient?.id
      const platformMsgId = messaging.message?.mid
      const rawTimestamp = messaging.timestamp
      const text: string = messaging.message?.text ?? ''
      const isEcho = !!messaging.message?.is_echo

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

      // Para echo: el "from" es el recipient (la persona a quien le respondimos)
      // Para inbound: el "from" es el sender (el usuario que nos escribió)
      const from: string | undefined = isEcho ? recipientId : (senderId === entryId ? recipientId : senderId)
      if (!from) {
        console.warn('[IG Webhook] Mensaje sin from resoluble, ignorando')
        continue
      }

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

      // Conversación existente (para saber si ya tenemos nombre/foto guardados)
      const { data: existingConv } = await supabase
        .from('conversations')
        .select('id, unread_count, platform_user_name, platform_user_avatar, client_id')
        .eq('channel_id', igChannel.id)
        .eq('platform_user_id', from)
        .maybeSingle()

      // Traer perfil de IG (nombre + @usuario + foto) cuando es inbound y falta
      // info: sin cliente vinculado, o el nombre guardado es el ID numérico (un
      // fetch viejo falló — típicamente por token vencido), o aún no hay avatar.
      let displayName: string = client?.name ?? existingConv?.platform_user_name ?? from
      let igHandle: string | null = null
      let igAvatar: string | null = null
      const storedName = existingConv?.platform_user_name
      const nameLooksNumeric = !storedName || /^[0-9]+$/.test(storedName)
      const needsProfile = !isEcho && !!igConfig.instagram_page_access_token && !client?.name
        && (nameLooksNumeric || !existingConv?.platform_user_avatar)
      if (needsProfile) {
        const profile = await fetchIgUserProfile(from, igConfig.instagram_page_access_token!)
        if (profile.name) displayName = profile.name
        else if (profile.username) displayName = `@${profile.username}`
        igHandle = profile.username
        igAvatar = profile.profilePic
      }

      let convId: string
      const replyUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

      if (existingConv) {
        convId = existingConv.id
        if (isEcho) {
          // Echo = la página respondió → resetear unread y actualizar timestamp
          await supabase
            .from('conversations')
            .update({
              unread_count: 0,
              last_message_at: new Date().toISOString(),
              client_id: client?.id ?? existingConv.client_id,
            })
            .eq('id', convId)
        } else {
          // Inbound = usuario escribió → incrementar unread
          const shouldUpdateName = (existingConv.platform_user_name === from || !existingConv.platform_user_name) && displayName !== from
          await supabase
            .from('conversations')
            .update({
              unread_count: (existingConv.unread_count || 0) + 1,
              last_message_at: new Date().toISOString(),
              client_id: client?.id ?? null,
              can_reply_until: replyUntil,
              ...(shouldUpdateName ? { platform_user_name: displayName } : {}),
              ...(igHandle ? { platform_user_handle: igHandle } : {}),
              ...(igAvatar ? { platform_user_avatar: igAvatar } : {}),
            })
            .eq('id', convId)
        }
      } else {
        const { data: newConv, error: convErr } = await supabase
          .from('conversations')
          .insert({
            channel_id: igChannel.id,
            client_id: client?.id ?? null,
            platform_user_id: from,
            platform_user_name: displayName,
            platform_user_handle: igHandle,
            platform_user_avatar: igAvatar,
            status: 'open',
            unread_count: isEcho ? 0 : 1,
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

      const quickReply = !isEcho ? messaging.message?.quick_reply : undefined

      let contentType = isEcho ? 'text' : quickReply ? 'interactive' : 'text'
      let mediaUrl = null
      let caption = text || null

      const attachments = messaging.message?.attachments
      if (attachments && attachments.length > 0) {
        const attachment = attachments[0]
        mediaUrl = attachment.payload?.url || null
        if (attachment.type === 'story_mention') {
          contentType = 'image'
          caption = caption ? `[Mención en Historia]\n${caption}` : '[Mención en Historia]'
        } else if (attachment.type === 'image') {
          contentType = 'image'
        } else if (attachment.type === 'video') {
          contentType = 'video'
        } else if (attachment.type === 'audio') {
          contentType = 'audio'
        } else if (attachment.type === 'file') {
          contentType = 'document'
        } else if (mediaUrl) {
          // Tipo no mapeado (sticker/gif/reel/etc.) pero trae archivo: mostrarlo
          // como imagen — es lo más común en IG y evita perder el contenido.
          contentType = 'image'
        } else if (attachment.type && ['fallback', 'share'].includes(attachment.type)) {
           // Meta also sends share or fallback types sometimes.
           contentType = 'text'
           caption = caption ? `[Adjunto: ${attachment.type}]\n${caption}` : `[Adjunto: ${attachment.type}]`
        } else if (attachment.type) {
          contentType = 'text'
          caption = caption ? `[${attachment.type}]\n${caption}` : `[${attachment.type}]`
        }
      }

      // Anti-fantasma: un sticker/“like” de Instagram puede llegar SIN texto ni
      // adjunto con URL. Sin esto se inserta content=NULL y el inbox dibuja una
      // burbuja vacía que parece un mensaje del negocio "que apareció primero".
      if (!isEcho && !caption && !mediaUrl && contentType === 'text') {
        caption = '[Sticker]'
      }

      const { error: msgErr } = await supabase.from('messages').insert({
        conversation_id: convId,
        direction: isEcho ? 'outbound' : 'inbound',
        content_type: contentType,
        content: caption,
        media_url: mediaUrl,
        platform_message_id: platformMsgId,
        status: isEcho ? 'sent' : 'delivered',
        created_at: createdAt,
      })
      if (msgErr) {
        console.error('[IG Webhook] Error insertando mensaje:', msgErr.message)
      }

      // ── Workflow Engine: solo para mensajes inbound ──
      if (!isEcho && igConfig.instagram_page_access_token) {
        try {
          // quick_reply ya usado arriba para content_type al insertar
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
