import { createClient } from '@/lib/supabase/server'
import { TvClient } from './tv-client'

export const dynamic = 'force-dynamic'

export default async function TvPage() {
  const supabase = await createClient()

  // Initial data fetch
  const { data: initialEntries } = await supabase
    .from('queue_entries')
    .select('*, client:clients(*), barber:staff(*)')
    .in('status', ['waiting', 'in_progress'])
    .order('position')

  const { data: barbers } = await supabase
    .from('staff')
    .select('id, full_name, branch_id, status, is_active, avatar_url')
    .eq('role', 'barber')
    .eq('is_active', true)
    .order('full_name')

  const { data: branches } = await supabase
    .from('branches')
    .select('id, name')

  return (
    <TvClient
      initialEntries={initialEntries || []}
      barbers={barbers || []}
      branches={branches || []}
    />
  )
}
