import { createClient } from '@/lib/supabase/server'
import { MensajeriaClient } from './mensajeria-client'

export const dynamic = 'force-dynamic'

export default async function MensajeriaPage() {
  const supabase = await createClient()

  const [
    { data: conversations },
    { data: channels },
    { data: scheduled },
    { data: templates },
    { data: clients },
    { data: appSettings },
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
      .from('message_templates')
      .select('*')
      .eq('status', 'approved')
      .order('name'),
    supabase
      .from('clients')
      .select('id, name, phone')
      .order('name'),
    supabase
      .from('app_settings')
      .select('*')
      .maybeSingle(),
  ])

  return (
    <MensajeriaClient
      initialConversations={conversations ?? []}
      channels={channels ?? []}
      scheduledMessages={scheduled ?? []}
      templates={templates ?? []}
      clients={clients ?? []}
      appSettings={appSettings}
    />
  )
}
