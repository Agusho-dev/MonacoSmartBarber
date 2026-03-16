import { createClient } from '@/lib/supabase/server'
import { MensajeriaClient } from './mensajeria-client'

export const dynamic = 'force-dynamic'

export default async function MensajeriaPage() {
  const supabase = await createClient()

  const { data: conversations } = await supabase
    .from('conversations')
    .select(`
      *,
      channel:social_channels(id, platform, display_name, branch_id),
      client:clients(id, name, phone, instagram, notes)
    `)
    .order('last_message_at', { ascending: false, nullsFirst: false })

  const { data: channels } = await supabase
    .from('social_channels')
    .select('*')
    .eq('is_active', true)
    .order('platform')

  const { data: scheduled } = await supabase
    .from('scheduled_messages')
    .select(`
      *,
      channel:social_channels(platform, display_name),
      client:clients(name, phone),
      template:message_templates(name),
      created_by_staff:staff(full_name)
    `)
    .in('status', ['pending', 'sent', 'failed'])
    .order('scheduled_for', { ascending: true })

  const { data: templates } = await supabase
    .from('message_templates')
    .select('*')
    .eq('status', 'approved')
    .order('name')

  const { data: clients } = await supabase
    .from('clients')
    .select('id, name, phone')
    .order('name')

  return (
    <MensajeriaClient
      initialConversations={conversations ?? []}
      channels={channels ?? []}
      scheduledMessages={scheduled ?? []}
      templates={templates ?? []}
      clients={clients ?? []}
    />
  )
}
