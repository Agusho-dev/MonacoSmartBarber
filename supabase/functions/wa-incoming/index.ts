// Recibe mensajes entrantes del microservicio Baileys
// y los inserta en la base de datos para aparecer en /dashboard/mensajeria
// Nota: Este endpoint es para el microservicio Baileys (no-oficial).
// Los mensajes de Meta Cloud API llegan via /api/webhooks/whatsapp.
//
// PATRÓN OBLIGATORIO (CLAUDE.md): chequear error de cada .insert()/.update()/.select().
// Sin esto, fallos silenciosos en supabase rompen todo el flujo sin trazabilidad.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  // Verificar API key del microservicio
  const apiKey = req.headers.get('x-api-key')
  if (apiKey !== Deno.env.get('WA_API_KEY')) {
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const body = await req.json()
    // body: { phone, message, timestamp, org_id?, branch_id?, push_name?, external_id? }
    const { phone, message, timestamp, org_id, branch_id, push_name, external_id } = body

    if (!phone || !message) {
      return new Response(
        JSON.stringify({ error: 'phone y message son requeridos' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    if (!org_id && !branch_id) {
      return new Response(
        JSON.stringify({ error: 'org_id o branch_id es requerido para identificar la organización' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const phoneClean = (phone as string).replace(/\D/g, '')
    const pushName =
      typeof push_name === 'string' && push_name.trim().length > 0 ? push_name.trim() : null

    // Resolver organization_id desde org_id directo o desde branch_id
    let organizationId: string | null = org_id || null
    if (!organizationId && branch_id) {
      const { data: branchData, error: branchErr } = await supabase
        .from('branches')
        .select('organization_id')
        .eq('id', branch_id)
        .maybeSingle()
      if (branchErr) {
        console.error('[wa-incoming] branches lookup error branch_id=' + branch_id + ':', branchErr.message)
        return new Response(
          JSON.stringify({ error: 'Error consultando branches' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        )
      }
      organizationId = branchData?.organization_id ?? null
    }

    if (!organizationId) {
      return new Response(
        JSON.stringify({ error: 'No se pudo resolver la organización' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Org-scope desde migración 103: el canal puede ser org-wide (branch_id NULL)
    // o por sucursal. Filtramos por organization_id directo.
    const { data: waChannel, error: chErr } = await supabase
      .from('social_channels')
      .select('id, branch_id')
      .eq('platform', 'whatsapp')
      .eq('is_active', true)
      .eq('organization_id', organizationId)
      .order('branch_id', { ascending: true, nullsFirst: true })
      .limit(1)
      .maybeSingle()
    if (chErr) {
      console.error('[wa-incoming] social_channels lookup error org=' + organizationId + ':', chErr.message)
      return new Response(
        JSON.stringify({ error: 'Error consultando canales WhatsApp' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    if (!waChannel) {
      return new Response(
        JSON.stringify({ error: 'No hay canal WhatsApp configurado para esta organización' }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Buscar cliente por teléfono dentro de la organización
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('id, name')
      .eq('phone', phone)
      .eq('organization_id', organizationId)
      .maybeSingle()
    if (clientErr) {
      console.error('[wa-incoming] clients lookup error phone=' + phoneClean + ':', clientErr.message)
      // No es fatal: la conversación se puede crear sin client_id (cliente desconocido)
    }

    // Deduplicación por external_id si vino del microservicio.
    // Si ya existe, devolvemos OK sin insertar de nuevo (idempotente).
    if (external_id) {
      const { data: existingMsg } = await supabase
        .from('messages')
        .select('id')
        .eq('external_id', external_id)
        .maybeSingle()
      if (existingMsg) {
        return new Response(
          JSON.stringify({ success: true, deduplicated: true }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      }
    }

    // Buscar o crear conversación
    // Usamos sufijo de teléfono para evitar duplicados por diferencia de formato
    // IMPORTANTE: limit(1) antes de maybeSingle() para evitar error 406
    // cuando hay múltiples conversaciones con el mismo sufijo de teléfono
    const phoneSuffix = phoneClean.slice(-10)
    let convId: string
    const { data: existingConv, error: convLookupErr } = await supabase
      .from('conversations')
      .select('id, unread_count, platform_user_id, platform_user_name')
      .eq('channel_id', waChannel.id)
      .ilike('platform_user_id', `%${phoneSuffix}`)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()
    if (convLookupErr) {
      console.error('[wa-incoming] conversations lookup error phone=' + phoneClean + ':', convLookupErr.message)
      return new Response(
        JSON.stringify({ error: 'Error consultando conversación' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const clientRow = client as { id?: string; name?: string } | null

    if (existingConv) {
      convId = existingConv.id
      const { error: convUpdErr } = await supabase
        .from('conversations')
        .update({
          unread_count: (existingConv.unread_count || 0) + 1,
          last_message_at: new Date().toISOString(),
          client_id: clientRow?.id ?? null,
          can_reply_until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          platform_user_name: clientRow?.name ?? pushName ?? existingConv.platform_user_name ?? phone,
          // Normalizar al formato que llega para evitar futuros desmatches
          ...(existingConv.platform_user_id !== phoneClean ? { platform_user_id: phoneClean } : {}),
        })
        .eq('id', convId)
      if (convUpdErr) {
        console.error('[wa-incoming] conversations.update error conv=' + convId + ':', convUpdErr.message)
        // No bloqueamos: el mensaje sí lo insertamos, el contador se puede recalcular después.
      }
    } else {
      const { data: newConv, error: convInsErr } = await supabase
        .from('conversations')
        .insert({
          channel_id: waChannel.id,
          client_id: clientRow?.id ?? null,
          platform_user_id: phoneClean,
          platform_user_name: clientRow?.name ?? pushName ?? phone,
          status: 'open',
          unread_count: 1,
          last_message_at: new Date().toISOString(),
          can_reply_until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        })
        .select('id')
        .single()

      if (convInsErr || !newConv) {
        console.error('[wa-incoming] conversations.insert error phone=' + phoneClean + ':', convInsErr?.message)
        return new Response(
          JSON.stringify({ error: `Error creando conversación: ${convInsErr?.message}` }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        )
      }
      convId = newConv.id
    }

    // Insertar mensaje entrante con error check obligatorio
    const msgTimestamp = timestamp
      ? new Date((timestamp as number) * 1000).toISOString()
      : new Date().toISOString()

    const { error: msgInsErr } = await supabase.from('messages').insert({
      conversation_id: convId,
      direction: 'inbound',
      content_type: 'text',
      content: message,
      status: 'delivered',
      created_at: msgTimestamp,
      ...(external_id ? { external_id } : {}),
    })
    if (msgInsErr) {
      console.error('[wa-incoming] messages.insert error conv=' + convId + ' phone=' + phoneClean + ':', msgInsErr.message)
      return new Response(
        JSON.stringify({ error: `Error guardando mensaje: ${msgInsErr.message}` }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[wa-incoming] unhandled error:', message)
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
