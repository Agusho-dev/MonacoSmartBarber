import { createClient } from '@/lib/supabase/server'
import { DescansosDashboard } from './descansos-client'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Descansos | Monaco Smart Barber',
}

export default async function DescansosPage() {
  const supabase = await createClient()
  const [{ data: breakConfigs }, { data: branches }, { data: breakRequests }] = await Promise.all([
    supabase.from('break_configs').select('*').order('name'),
    supabase.from('branches').select('*').eq('is_active', true).order('name'),
    supabase
      .from('break_requests')
      .select('*, staff:staff_id(id, full_name), break_config:break_config_id(name, duration_minutes)')
      .in('status', ['pending', 'approved'])
      .order('requested_at', { ascending: true }),
  ])
  return (
    <DescansosDashboard
      breakConfigs={breakConfigs ?? []}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      breakRequests={(breakRequests ?? []) as any}
    />
  )
}
