import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/** Meta envía `value.contacts[].profile.name` (nombre en perfil WA) junto a los mensajes. */
type WaWebhookContact = {
  profile?: { name?: string }
  wa_id?: string
  /** Variantes vistas en payloads / partners */
  id?: string
  input?: string
  name?: string
}

function normalizeWaDigits(raw: string | undefined | null): string {
  if (!raw) return ''
  const beforeAt = String(raw).split('@')[0] ?? ''
  return beforeAt.replace(/\D/g, '')
}

function extractGlobalContacts(value: { contacts?: unknown }): WaWebhookContact[] {
  const c = value?.contacts
  if (!c) return []
  if (Array.isArray(c)) return c as WaWebhookContact[]
  if (typeof c === 'object') return Object.values(c as Record<string, WaWebhookContact>)
  return []
}

function contactDisplayName(c: WaWebhookContact): string | null {
  const n = c.profile?.name ?? c.name
  const t = typeof n === 'string' ? n.trim() : ''
  return t || null
}

function contactWaDigits(c: WaWebhookContact): string {
  return normalizeWaDigits(c.wa_id ?? c.input ?? c.id)
}

/** Mapa wa_id (completo y últimos 10 dígitos) → nombre mostrado en WhatsApp. */
function buildWhatsappContactNameMap(value: { contacts?: unknown }): Map<string, string> {
  const map = new Map<string, string>()
  const setKey = (key: string, label: string) => {
    if (!key || !label) return
    const prev = map.get(key)
    if (!prev || prev === label) map.set(key, label)
  }
  for (const c of extractGlobalContacts(value)) {
    const label = contactDisplayName(c)
    const full = contactWaDigits(c)
    if (!label || !full) continue
    setKey(full, label)
    if (full.length >= 10) setKey(full.slice(-10), label)
  }
  return map
}

/**
 * Resuelve el nombre de perfil del remitente a partir del webhook.
 * Incluye fallback si hay un solo mensaje y un solo contacto (wa_id a veces no coincide con `from`).
 */
function waProfileNameFromWebhookValue(
  value: { contacts?: unknown; messages?: unknown[] },
  from: string,
): string | null {
  const map = buildWhatsappContactNameMap(value)
  const fromDigits = normalizeWaDigits(from)
  if (fromDigits) {
    const byFull = map.get(fromDigits)
    if (byFull) return byFull
    if (fromDigits.length >= 10) {
      const bySuffix = map.get(fromDigits.slice(-10))
      if (bySuffix) return bySuffix
    }
  }
  const msgs = Array.isArray(value.messages) ? value.messages : []
  const contacts = extractGlobalContacts(value)
  if (msgs.length === 1 && contacts.length === 1) {
    const solo = contactDisplayName(contacts[0])
    if (solo) return solo
  }
  // Contacto con nombre pero sin wa_id en el JSON (Meta a veces omite el id)
  const distinctFromDigits = new Set<string>()
  for (const m of msgs) {
    if (m && typeof m === 'object' && typeof (m as { from?: string }).from === 'string') {
      const d = normalizeWaDigits((m as { from: string }).from)
      if (d) distinctFromDigits.add(d)
    }
  }
  const namedSansWaId = contacts.filter((c) => contactDisplayName(c) && !contactWaDigits(c))
  if (
    namedSansWaId.length === 1
    && distinctFromDigits.size === 1
    && fromDigits
    && distinctFromDigits.has(fromDigits)
  ) {
    const n = contactDisplayName(namedSansWaId[0])
    if (n) return n
  }
  return null
}

/**
 * Descarga un archivo multimedia de WhatsApp Graph API y lo sube a Supabase Storage.
 * Retorna la URL pública del archivo, o null si falla.
 */
async function downloadAndStoreWhatsAppMedia(
  mediaId: string,
  accessToken: string,
  supabase: ReturnType<typeof getSupabase>,
  orgId: string,
  contentType: string,
): Promise<{ url: string; mimeType: string } | null> {
  try {
    // 1. Obtener URL de descarga del media
    const metaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!metaRes.ok) {
      console.error('[WA Media] Error obteniendo metadata:', metaRes.status, await metaRes.text())
      return null
    }
    const metaJson = await metaRes.json() as { url?: string; mime_type?: string }
    if (!metaJson.url) return null

    // 2. Descargar el binario
    const mediaRes = await fetch(metaJson.url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!mediaRes.ok) {
      console.error('[WA Media] Error descargando media:', mediaRes.status)
      return null
    }

    const mimeType = metaJson.mime_type || mediaRes.headers.get('content-type') || 'application/octet-stream'
    const buffer = await mediaRes.arrayBuffer()

    // 3. Determinar extensión
    const extMap: Record<string, string> = {
      'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
      'video/mp4': 'mp4', 'video/3gpp': '3gp',
      'audio/aac': 'aac', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/amr': 'amr', 'audio/opus': 'opus',
      'application/pdf': 'pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
      'application/msword': 'doc',
      'application/vnd.ms-excel': 'xls',
      'text/plain': 'txt',
    }
    const ext = extMap[mimeType] || 'bin'
    const fileName = `${orgId}/${contentType}/${Date.now()}_${mediaId}.${ext}`

    // 4. Subir a Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('chat-media')
      .upload(fileName, buffer, { contentType: mimeType, upsert: false })

    if (uploadError) {
      console.error('[WA Media] Error subiendo a storage:', uploadError.message)
      return null
    }

    // 5. Obtener URL pública
    const { data: publicUrl } = supabase.storage.from('chat-media').getPublicUrl(fileName)
    return { url: publicUrl.publicUrl, mimeType }
  } catch (err) {
    console.error('[WA Media] Error inesperado:', err)
    return null
  }
}

function isPlainWhatsAppAddressLabel(s: string | null | undefined): boolean {
  if (!s) return true
  const d = s.replace(/\D/g, '')
  if (d.length < 10) return false
  return !/[a-zA-Z\u00C0-\u024F]/.test(s)
}

function resolveWaConversationLabel(args: {
  client: { name: string } | null | undefined
  profileName: string | null
  existingName: string | null | undefined
  from: string
}): string {
  if (args.client?.name) return args.client.name
  if (args.profileName) return args.profileName
  if (args.existingName && !isPlainWhatsAppAddressLabel(args.existingName)) return args.existingName
  return args.from
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

  const msgs = body.entry?.[0]?.changes?.[0]?.value?.messages ?? []
  await supabase.from('webhook_debug_log').insert({
    endpoint: 'whatsapp', method: 'POST',
    body: {
      object: body.object,
      entry_count: body.entry?.length,
      first_entry_id: body.entry?.[0]?.id,
      first_change_field: body.entry?.[0]?.changes?.[0]?.field,
      phone_number_id: body.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id,
      messages_count: msgs.length,
      statuses_count: body.entry?.[0]?.changes?.[0]?.value?.statuses?.length ?? 0,
      // DEBUG temporal: capturamos los mensajes crudos para diagnosticar botones
      messages_raw: msgs.map((m: any) => ({
        type: m.type,
        text: m.text,
        button: m.button,
        interactive: m.interactive,
        context: m.context,
      })),
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

      // Procesar mensajes entrantes (incluye interactive para botones/listas)
      for (const message of value.messages ?? []) {
        if (!['text', 'image', 'audio', 'video', 'document', 'interactive', 'button'].includes(message.type)) continue

        const from: string          = message.from
        const platformMsgId: string = message.id
        const timestamp: string     = message.timestamp

        // Extraer texto según tipo de mensaje
        let text: string = ''
        let interactivePayload: { type?: string; button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string; description?: string } } | undefined

        if (message.type === 'text') {
          text = message.text?.body ?? ''
        } else if (message.type === 'interactive') {
          // Respuesta a botones o listas interactivas
          if (message.interactive?.type === 'button_reply') {
            interactivePayload = {
              type: 'button_reply',
              button_reply: message.interactive.button_reply,
            }
            text = message.interactive.button_reply?.title ?? ''
          } else if (message.interactive?.type === 'list_reply') {
            interactivePayload = {
              type: 'list_reply',
              list_reply: message.interactive.list_reply,
            }
            text = message.interactive.list_reply?.title ?? ''
          }
        } else if (message.type === 'button') {
          // Respuesta a botones de templates (Quick Reply)
          interactivePayload = {
            type: 'button_reply',
            button_reply: { id: message.button?.payload ?? '', title: message.button?.text ?? '' },
          }
          text = message.button?.text ?? ''
        }

        // Extraer media ID (WhatsApp envía ID, no URL directa)
        const mediaId: string | undefined = message.image?.id ?? message.video?.id ?? message.audio?.id ?? message.document?.id
        const mediaCaption: string | undefined = message.image?.caption ?? message.video?.caption ?? message.document?.caption
        if (mediaCaption && !text) text = mediaCaption
        const contentType = message.type === 'text' ? 'text' : message.type === 'interactive' || message.type === 'button' ? 'text' : message.type

        // Descargar y almacenar media si corresponde
        let mediaUrl: string | null = null
        if (mediaId && waConfig.whatsapp_access_token && ['image', 'video', 'audio', 'document'].includes(contentType)) {
          const stored = await downloadAndStoreWhatsAppMedia(
            mediaId, waConfig.whatsapp_access_token, supabase, orgId, contentType
          )
          if (stored) mediaUrl = stored.url
        }

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
        // Usamos sufijo de teléfono para evitar duplicados por diferencia de formato
        // (ej: startConversation guarda 54xxx, Meta envía 549xxx)
        // IMPORTANTE: limit(1) antes de maybeSingle() para evitar error 406 si hay
        // múltiples conversaciones con el mismo sufijo (legacy duplicates)
        const fromSuffix = from.slice(-10)
        const profileName = waProfileNameFromWebhookValue(value, from)

        const { data: existingConv } = await supabase
          .from('conversations')
          .select('id, unread_count, platform_user_id, platform_user_name, client_id')
          .eq('channel_id', waChannel.id)
          .ilike('platform_user_id', `%${fromSuffix}`)
          .order('last_message_at', { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle()

        let convId: string
        const replyUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

        const platformUserName = resolveWaConversationLabel({
          client: client ?? undefined,
          profileName,
          existingName: existingConv?.platform_user_name,
          from,
        })

        if (existingConv) {
          convId = existingConv.id
          await supabase
            .from('conversations')
            .update({
              unread_count: (existingConv.unread_count || 0) + 1,
              last_message_at: new Date().toISOString(),
              client_id: client?.id ?? null,
              can_reply_until: replyUntil,
              platform_user_name: platformUserName,
              // Normalizar al formato canónico de Meta para evitar futuros desmatches
              ...(existingConv.platform_user_id !== from ? { platform_user_id: from } : {}),
            })
            .eq('id', convId)
        } else {
          const { data: newConv, error: convErr } = await supabase
            .from('conversations')
            .insert({
              channel_id: waChannel.id,
              client_id: client?.id ?? null,
              platform_user_id: from,
              platform_user_name: platformUserName,
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

        // ── Workflow Engine: evaluar reglas y workflows ──
        if (waConfig.whatsapp_access_token && waConfig.whatsapp_phone_id) {
          try {
            const { evaluateIncomingMessage } = await import('@/lib/workflow-engine')
            await evaluateIncomingMessage({
              orgId,
              conversationId: convId,
              text,
              platform: 'whatsapp',
              messageType: message.type,
              interactivePayload,
              waConfig: {
                whatsapp_access_token: waConfig.whatsapp_access_token,
                whatsapp_phone_id: waConfig.whatsapp_phone_id,
              },
              platformUserId: from,
            })
          } catch (engineErr) {
            console.error('[WA Webhook] Error en workflow engine:', engineErr)
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
