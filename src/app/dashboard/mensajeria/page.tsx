import { createAdminClient } from '@/lib/supabase/server'
import { countConversations } from '@/lib/actions/conversations'
import { INBOX_PAGE_SIZE } from '@/lib/inbox'
import { COLUMNAS_AI_CONFIG_MENSAJERIA } from '@/lib/ai-config-columnas'
import { alcanceDeMensajeria, leerProgramados } from '@/lib/mensajeria/programados'
import type { OrgAiConfig } from '@/lib/actions/ai-config'
import { MensajeriaClient } from './mensajeria-client'

export const dynamic = 'force-dynamic'

export default async function MensajeriaPage() {
  const supabase = createAdminClient()

  // La org de la sesión, las sucursales permitidas al usuario (filtran el
  // inbox) y los canales: org-wide o legacy por sucursal. Es el mismo alcance
  // que usa la action que relee Programados (src/lib/mensajeria/programados.ts).
  const { orgId, branches: orgBranches, channelFilters, channelIds } = await alcanceDeMensajeria(supabase)

  const [
    { data: conversations },
    { data: channels },
    { data: scheduled },
    { data: waConfig },
    { data: igConfig },
    { data: aiConfig },
    { data: tags },
    { data: appSettings },
    totalConversations,
  ] = await Promise.all([
    // PRIMERA PÁGINA, con `.limit()` explícito. Antes iba sin límite y se comía
    // en silencio el tope de PostgREST (`max-rows` = 1000): con 6.367
    // conversaciones, el inbox mostraba sólo los últimos 10 días y todo lo
    // anterior era inalcanzable — ni scrolleando ni buscando. Ahora el resto
    // llega por `loadMoreConversations` (scroll) y `searchConversations`
    // (búsqueda contra la tabla entera).
    channelIds.length > 0
      ? supabase
          .from('conversations')
          .select(`
            *,
            channel:social_channels(id, platform, display_name, branch_id),
            client:clients(id, name, phone, instagram, notes),
            tags:conversation_tag_assignments(tag_id, tag:conversation_tags(id, name, color))
          `)
          .in('channel_id', channelIds)
          .not('last_message_at', 'is', null)
          .order('last_message_at', { ascending: false })
          .limit(INBOX_PAGE_SIZE)
      : Promise.resolve({ data: [] }),
    channelFilters.length > 0
      ? supabase
          .from('social_channels')
          .select('*')
          .or(channelFilters.join(','))
          .eq('is_active', true)
          .order('platform')
      : Promise.resolve({ data: [] }),
    // Programados: todos los pendientes y los últimos enviados o fallidos (no
    // los 100 más viejos, como antes: ver leerProgramados).
    leerProgramados(supabase, channelIds),
    // clients removido del initial load: NewChatDialog y ScheduleDialog
    // usan searchClients() on-demand para evitar traer 10k+ clientes en cada carga.
    orgId
      ? supabase
          .from('organization_whatsapp_config')
          .select('*')
          .eq('organization_id', orgId)
          .maybeSingle()
          .then((r) => ({ data: r.data }))
      : Promise.resolve({ data: null }),
    orgId
      ? supabase
          .from('organization_instagram_config')
          .select('*')
          .eq('organization_id', orgId)
          .maybeSingle()
          .then((r) => ({ data: r.data }))
      : Promise.resolve({ data: null }),
    // Columnas EXPLÍCITAS: la fila tiene la clave cifrada de Tex y su configuración, y todo
    // lo que se lee acá viaja al navegador (src/lib/ai-config-columnas.ts). Sin las columnas
    // `assistant_*` de `OrgAiConfig`: Mensajería no las lee.
    orgId
      ? supabase
          .from('organization_ai_config')
          .select(COLUMNAS_AI_CONFIG_MENSAJERIA)
          .eq('organization_id', orgId)
          .maybeSingle()
          .then((r) => ({ data: r.data as unknown as OrgAiConfig | null }))
      : Promise.resolve({ data: null }),
    orgId
      ? supabase
          .from('conversation_tags')
          .select('*')
          .eq('organization_id', orgId)
          .order('name')
          .then((r) => ({ data: r.data }))
      : Promise.resolve({ data: [] }),
    orgId
      ? supabase
          .from('app_settings')
          .select('review_auto_send, review_delay_minutes, review_template_name')
          .eq('organization_id', orgId)
          .maybeSingle()
          .then((r) => ({ data: r.data }))
      : Promise.resolve({ data: null }),
    countConversations(),
  ])

  // Hidratar último mensaje de cada conversación para el preview en el inbox.
  // Sin esto, al recargar la página el preview muestra el teléfono hasta que
  // llega el realtime update (o sea, nunca si no hay tráfico).
  type ConvLite = { id: string; [key: string]: unknown }
  const convList = (conversations ?? []) as ConvLite[]
  const convIds = convList.map((c) => c.id)
  let conversationsWithPreview: ConvLite[] = convList
  if (convIds.length > 0) {
    const { data: lastMsgs } = await supabase.rpc('get_last_messages_for_conversations', { conv_ids: convIds })
    if (lastMsgs) {
      const lmMap: Record<string, unknown> = {}
      for (const m of lastMsgs as Array<{ conversation_id: string; content: string | null; direction: string; content_type: string; created_at: string }>) {
        lmMap[m.conversation_id] = m
      }
      conversationsWithPreview = convList.map((c) => ({
        ...c,
        last_message: lmMap[c.id] ? [lmMap[c.id]] : [],
      }))
    }
  }

  return (
    <MensajeriaClient
      initialConversations={conversationsWithPreview as unknown as Parameters<typeof MensajeriaClient>[0]['initialConversations']}
      channels={channels ?? []}
      scheduledMessages={scheduled ?? []}
      waConfig={waConfig ?? null}
      igConfig={igConfig ?? null}
      aiConfig={aiConfig ?? null}
      initialTags={tags ?? []}
      appSettings={appSettings ?? null}
      branches={(orgBranches ?? []) as { id: string; name: string }[]}
      totalConversations={totalConversations.total}
    />
  )
}
