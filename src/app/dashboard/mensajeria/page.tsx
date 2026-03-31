import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { MensajeriaClient } from './mensajeria-client'

export const dynamic = 'force-dynamic'

export default async function MensajeriaPage() {
  const supabase = createAdminClient()
  const orgId = await getCurrentOrgId()

  const [
    { data: conversations },
    { data: channels },
    { data: scheduled },
    { data: clients },
    { data: waConfig },
  ] = await Promise.all([
    supabase
      .from('conversations')
      .select(`
        *,
        channel:social_channels(id, platform, display_name, branch_id),
        client:clients(id, name, phone, instagram, notes)
      `)
      .order('last_message_at', { ascending: false, nullsFirst: false }),
    supabase
      .from('social_channels')
      .select('*')
      .eq('is_active', true)
      .order('platform'),
    supabase
      .from('scheduled_messages')
      .select(`
        *,
        channel:social_channels(platform, display_name),
        client:clients(name, phone),
        template:message_templates(name),
        created_by_staff:staff(full_name)
      `)
      .in('status', ['pending', 'sent', 'failed'])
      .order('scheduled_for', { ascending: true }),
    supabase
      .from('clients')
      .select('id, name, phone')
      .eq('organization_id', orgId ?? '')
      .order('name'),
    orgId
      ? supabase
          .from('organization_whatsapp_config')
          .select('*')
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
      clients={clients ?? []}
      waConfig={waConfig ?? null}
    />
  )
}
