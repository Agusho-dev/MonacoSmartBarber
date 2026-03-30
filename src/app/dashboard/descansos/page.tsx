import { createAdminClient } from '@/lib/supabase/server'
import { getOrgBranchIds } from '@/lib/actions/org'
import { DescansosDashboard } from './descansos-client'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Descansos | Monaco Smart Barber',
}

export default async function DescansosPage() {
  const supabase = createAdminClient()
  const branchIds = await getOrgBranchIds()

  if (branchIds.length === 0) {
    return <DescansosDashboard breakConfigs={[]} breakRequests={[]} />
  }

  const [{ data: breakConfigs }, { data: breakRequests }] = await Promise.all([
    supabase
      .from('break_configs')
      .select('*')
      .in('branch_id', branchIds)
      .order('name'),
    supabase
      .from('break_requests')
      .select('*, staff:staff_id(id, full_name), break_config:break_config_id(name, duration_minutes)')
      .in('branch_id', branchIds)
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
