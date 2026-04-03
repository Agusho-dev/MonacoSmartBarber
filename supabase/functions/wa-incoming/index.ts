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
    // body: { phone: "+549...", message: "texto", timestamp: 1234567890, phone_number_id?: "..." }
    const { phone, message, timestamp, phone_number_id } = body

    if (!phone || !message) {
      return new Response(
        JSON.stringify({ error: 'phone y message son requeridos' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const phoneClean = (phone as string).replace(/\D/g, '')

    // Buscar canal WhatsApp activo — filtrado por org si tenemos phone_number_id
    let waChannel: { id: string } | null = null
    let orgId: string | null = null

    if (phone_number_id) {
      // Resolver org desde la config de WA
      const { data: waConfig } = await supabase
        .from('organization_whatsapp_config')
        .select('organization_id')
        .eq('whatsapp_phone_id', phone_number_id)
        .maybeSingle()

      if (waConfig) {
        orgId = waConfig.organization_id
        const { data: branches } = await supabase
          .from('branches')
          .select('id')
          .eq('organization_id', orgId)
        const branchIds = branches?.map((b: any) => b.id) ?? []

        if (branchIds.length > 0) {
          const { data: channel } = await supabase
            .from('social_channels')
            .select('id')
            .in('branch_id', branchIds)
            .eq('platform', 'whatsapp')
            .eq('is_active', true)
            .limit(1)
            .maybeSingle()
          waChannel = channel
        }
      }
    }

    // Fallback: buscar por teléfono del cliente para inferir la org
    if (!waChannel) {
      const { data: client } = await supabase
        .from('clients')
        .select('organization_id')
        .eq('phone', phone)
        .maybeSingle()

      if (client?.organization_id) {
        orgId = client.organization_id
        const { data: branches } = await supabase
          .from('branches')
          .select('id')
          .eq('organization_id', orgId)
        const branchIds = branches?.map((b: any) => b.id) ?? []

        if (branchIds.length > 0) {
          const { data: channel } = await supabase
            .from('social_channels')
            .select('id')
            .in('branch_id', branchIds)
            .eq('platform', 'whatsapp')
            .eq('is_active', true)
            .limit(1)
            .maybeSingle()
          waChannel = channel
        }
      }
    }

    // Último recurso: primer canal activo (single-tenant legacy)
    if (!waChannel) {
      const { data: channel } = await supabase
        .from('social_channels')
        .select('id')
        .eq('platform', 'whatsapp')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()
      waChannel = channel
    }

    if (!waChannel) {
      return new Response(
        JSON.stringify({ error: 'No hay canal WhatsApp configurado' }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Buscar cliente por teléfono (filtrado por org si lo tenemos)
    let clientQuery = supabase
      .from('clients')
      .select('id, name')
      .eq('phone', phone)
    if (orgId) {
      clientQuery = clientQuery.eq('organization_id', orgId)
    }
    const { data: client } = await clientQuery.maybeSingle()

    // Buscar o crear conversación
    let convId: string
    const { data: existingConv } = await supabase
      .from('conversations')
      .select('id, unread_count')
      .eq('channel_id', waChannel.id)
      .eq('platform_user_id', phoneClean)
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
        })
        .eq('id', convId)
    } else {
      const { data: newConv, error: convError } = await supabase
        .from('conversations')
        .insert({
          channel_id: waChannel.id,
          client_id: (client as any)?.id ?? null,
          platform_user_id: phoneClean,
          platform_user_name: (client as any)?.name ?? phone,
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
