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
    // body: { phone: "+549...", message: "texto", timestamp: 1234567890, org_id?: "uuid", branch_id?: "uuid" }
    const { phone, message, timestamp, org_id, branch_id } = body

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

    // Buscar canal WhatsApp activo filtrado por organización (via branch)
    const { data: waChannel } = await supabase
      .from('social_channels')
      .select('id, branch_id')
      .eq('platform', 'whatsapp')
      .eq('is_active', true)
      .in('branch_id', (await supabase
        .from('branches')
        .select('id')
        .eq('organization_id', organizationId)
      ).data?.map((b: { id: string }) => b.id) ?? [])
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
