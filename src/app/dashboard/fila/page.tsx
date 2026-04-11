import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId, getOrgBranchIds } from '@/lib/actions/org'
import { redirect } from 'next/navigation'
import { FilaClient } from './fila-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Fila | Monaco Smart Barber',
}

export default async function FilaAdminPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')
  const branchIds = await getOrgBranchIds()

  const supabase = createAdminClient()

  const [
    { data: entries },
    { data: barbers },
    { data: branches },
    { data: breakConfigs },
  ] = await Promise.all([
    branchIds.length > 0
      ? supabase
          .from('queue_entries')
          .select('*, client:clients(*), barber:staff(*)')
          .in('branch_id', branchIds)
          .in('status', ['waiting', 'in_progress'])
          .order('position')
      : Promise.resolve({ data: [] }),
    supabase
      .from('staff')
      .select('id, full_name, branch_id, status, is_active, hidden_from_checkin, avatar_url')
      .eq('organization_id', orgId)
      .eq('role', 'barber')
      .eq('is_active', true)
      .order('full_name'),
    supabase
      .from('branches')
      .select('id, name')
      .eq('organization_id', orgId)
      .eq('is_active', true),
    branchIds.length > 0
      ? supabase
          .from('break_configs')
          .select('*')
          .in('branch_id', branchIds)
          .eq('is_active', true)
          .order('name')
      : Promise.resolve({ data: [] }),
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
