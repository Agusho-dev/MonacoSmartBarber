import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { FilaClient } from './fila-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Fila | Monaco Smart Barber',
}

export default async function FilaAdminPage() {
  const supabase = await createClient()

  const [
    { data: entries },
    { data: barbers },
    { data: branches },
    { data: breakConfigs },
  ] = await Promise.all([
    supabase
      .from('queue_entries')
      .select('*, client:clients(*), barber:staff(*)')
      .in('status', ['waiting', 'in_progress'])
      .order('position'),
    supabase
      .from('staff')
      .select('id, full_name, branch_id, status, is_active, hidden_from_checkin, avatar_url')
      .eq('role', 'barber')
      .eq('is_active', true)
      .order('full_name'),
    supabase
      .from('branches')
      .select('id, name')
      .eq('is_active', true),
    supabase
      .from('break_configs')
      .select('*')
      .eq('is_active', true)
      .order('name'),
  ])

  return (
    <FilaClient
      initialEntries={entries ?? []}
      barbers={barbers ?? []}
      branches={branches ?? []}
      breakConfigs={breakConfigs ?? []}
    />
  )
}
