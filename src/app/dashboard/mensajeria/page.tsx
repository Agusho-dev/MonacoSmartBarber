import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { MensajeriaClient } from './mensajeria-client'

export const dynamic = 'force-dynamic'

export default async function MensajeriaPage() {
  const supabase = createAdminClient()
  const orgId = await getCurrentOrgId()

  // Obtener branches de la org para filtrar por tenant
  const { data: orgBranches } = orgId
    ? await supabase.from('branches').select('id, name').eq('organization_id', orgId).order('name')
    : { data: [] }
  const branchIds = orgBranches?.map((b) => b.id) ?? []

  // Obtener canales de las branches de esta org
  const { data: orgChannels } = branchIds.length > 0
    ? await supabase.from('social_channels').select('id').in('branch_id', branchIds)
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
    branchIds.length > 0
      ? supabase
          .from('social_channels')
          .select('*')
          .in('branch_id', branchIds)
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

  return (
    <MensajeriaClient
      initialConversations={conversations ?? []}
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
