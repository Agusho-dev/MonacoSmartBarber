// Recibe mensajes entrantes del microservicio Baileys
// y los inserta en la base de datos para aparecer en /dashboard/mensajeria
// Nota: Este endpoint es para el microservicio Baileys (no-oficial).
// Los mensajes de Meta Cloud API llegan via /api/webhooks/whatsapp.

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
    // body: { phone, message, timestamp, org_id?, branch_id?, push_name? } — push_name = nombre en perfil WhatsApp (Baileys)
    const { phone, message, timestamp, org_id, branch_id, push_name } = body

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
      const { data: branchData } = await supabase
        .from('branches')
        .select('organization_id')
        .eq('id', branch_id)
        .maybeSingle()
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
    const { data: waChannel } = await supabase
      .from('social_channels')
      .select('id, branch_id')
      .eq('platform', 'whatsapp')
      .eq('is_active', true)
      .eq('organization_id', organizationId)
      .order('branch_id', { ascending: true, nullsFirst: true })
      .limit(1)
      .maybeSingle()

    if (!waChannel) {
      return new Response(
        JSON.stringify({ error: 'No hay canal WhatsApp configurado para esta organización' }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Buscar cliente por teléfono dentro de la organización
    const { data: client } = await supabase
      .from('clients')
      .select('id, name')
      .eq('phone', phone)
      .eq('organization_id', organizationId)
      .maybeSingle()

    // Buscar o crear conversación
    // Usamos sufijo de teléfono para evitar duplicados por diferencia de formato
    // IMPORTANTE: limit(1) antes de maybeSingle() para evitar error 406
    // cuando hay múltiples conversaciones con el mismo sufijo de teléfono
    const phoneSuffix = phoneClean.slice(-10)
    let convId: string
    const { data: existingConv } = await supabase
      .from('conversations')
      .select('id, unread_count, platform_user_id, platform_user_name')
      .eq('channel_id', waChannel.id)
      .ilike('platform_user_id', `%${phoneSuffix}`)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()

    if (existingConv) {
      convId = existingConv.id
      await supabase
        .from('conversations')
        .update({
          unread_count: (existingConv.unread_count || 0) + 1,
          last_message_at: new Date().toISOString(),
          client_id: (client as any)?.id ?? null,
          can_reply_until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          platform_user_name: (client as any)?.name ?? pushName ?? existingConv.platform_user_name ?? phone,
          // Normalizar al formato que llega para evitar futuros desmatches
          ...(existingConv.platform_user_id !== phoneClean ? { platform_user_id: phoneClean } : {}),
        })
        .eq('id', convId)
    } else {
      const { data: newConv, error: convError } = await supabase
        .from('conversations')
        .insert({
          channel_id: waChannel.id,
          client_id: (client as any)?.id ?? null,
          platform_user_id: phoneClean,
          platform_user_name: (client as any)?.name ?? pushName ?? phone,
          status: 'open',
          unread_count: 1,
          last_message_at: new Date().toISOString(),
          can_reply_until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        })
        .select('id')
        .single()

      if (convError || !newConv) {
        throw new Error(`Error creando conversación: ${convError?.message}`)
      }
      convId = newConv.id
    }

    // Insertar mensaje entrante
    const msgTimestamp = timestamp
      ? new Date((timestamp as number) * 1000).toISOString()
      : new Date().toISOString()

    await supabase.from('messages').insert({
      conversation_id: convId,
      direction: 'inbound',
      content_type: 'text',
      content: message,
      status: 'delivered',
      created_at: msgTimestamp,
    })

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
