import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getScopedBranchIds } from '@/lib/actions/branch-access'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { MensajeriaClient } from './mensajeria-client'

export const dynamic = 'force-dynamic'

export default async function MensajeriaPage() {
  const supabase = createAdminClient()
  const orgId = await getCurrentOrgId()

  // Obtener branches permitidas al usuario para filtrar el inbox
  const scopedIds = await getScopedBranchIds()
  const { data: orgBranches } = orgId && scopedIds.length > 0
    ? await supabase.from('branches').select('id, name').eq('organization_id', orgId).in('id', scopedIds).order('name')
    : { data: [] }
  const branchIds = orgBranches?.map((b) => b.id) ?? []

  // Obtener canales de la org: pueden estar scopeados por `organization_id`
  // (modelo org-wide, nuevo) o por `branch_id` (legacy). Sin este OR, los
  // canales de WhatsApp/Instagram globales quedan invisibles y el inbox
  // aparece vacío aunque existan cientos de conversaciones activas.
  const channelFilters: string[] = []
  if (orgId) channelFilters.push(`organization_id.eq.${orgId}`)
  if (branchIds.length > 0) channelFilters.push(`branch_id.in.(${branchIds.join(',')})`)

  const { data: orgChannels } = channelFilters.length > 0
    ? await supabase.from('social_channels').select('id').or(channelFilters.join(','))
    : { data: [] }
  const channelIds = orgChannels?.map((c) => c.id) ?? []

  const [
    { data: conversations },
    { data: channels },
    { data: scheduled },
    clients,
    { data: waConfig },
    { data: igConfig },
    { data: aiConfig },
    { data: tags },
    { data: appSettings },
  ] = await Promise.all([
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
          .order('last_message_at', { ascending: false, nullsFirst: false })
      : Promise.resolve({ data: [] }),
    channelFilters.length > 0
      ? supabase
          .from('social_channels')
          .select('*')
          .or(channelFilters.join(','))
          .eq('is_active', true)
          .order('platform')
      : Promise.resolve({ data: [] }),
    channelIds.length > 0
      ? supabase
          .from('scheduled_messages')
          .select(`
            *,
            channel:social_channels(platform, display_name),
            client:clients(name, phone),
            template:message_templates(name),
            created_by_staff:staff(full_name)
          `)
          .in('channel_id', channelIds)
          .in('status', ['pending', 'sent', 'failed'])
          .order('scheduled_for', { ascending: true })
      : Promise.resolve({ data: [] }),
    fetchAll((from, to) =>
      supabase
        .from('clients')
        .select('id, name, phone')
        .eq('organization_id', orgId ?? '')
        .order('name')
        .range(from, to)
    ),
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
    orgId
      ? supabase
          .from('organization_ai_config')
          .select('*')
          .eq('organization_id', orgId)
          .maybeSingle()
          .then((r) => ({ data: r.data }))
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
  ])

  // Hidratar último mensaje de cada conversación para el preview en el inbox.
  // Sin esto, al recargar la página el preview muestra el teléfono hasta que
  // llega el realtime update (o sea, nunca si no hay tráfico).
  const convIds = (conversations ?? []).map((c: any) => c.id)
  let conversationsWithPreview = conversations ?? []
  if (convIds.length > 0) {
    const { data: lastMsgs } = await supabase.rpc('get_last_messages_for_conversations', { conv_ids: convIds })
    if (lastMsgs) {
      const lmMap: Record<string, unknown> = {}
      for (const m of lastMsgs as Array<{ conversation_id: string; content: string | null; direction: string; content_type: string; created_at: string }>) {
        lmMap[m.conversation_id] = m
      }
      conversationsWithPreview = (conversations ?? []).map((c: any) => ({
        ...c,
        last_message: lmMap[c.id] ? [lmMap[c.id]] : [],
      }))
    }
  }

  return (
    <MensajeriaClient
      initialConversations={conversationsWithPreview}
      channels={channels ?? []}
      scheduledMessages={scheduled ?? []}
      clients={clients}
      waConfig={waConfig ?? null}
      igConfig={igConfig ?? null}
      aiConfig={aiConfig ?? null}
      initialTags={tags ?? []}
      appSettings={appSettings ?? null}
      branches={(orgBranches ?? []) as { id: string; name: string }[]}
    />
  )
}
