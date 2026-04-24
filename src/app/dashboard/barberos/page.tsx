import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getScopedBranchIds } from '@/lib/actions/branch-access'
import { redirect } from 'next/navigation'
import { BarberosClient } from './barberos-client'

export default async function BarberosPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')
  const branchIds = await getScopedBranchIds()

  const supabase = createAdminClient()

  const now = new Date()
  const todayStr = now.toISOString().slice(0, 10)
  const tomorrowStr = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    .toISOString()
    .slice(0, 10)

  const [{ data: barbers }, { data: branches }, { data: todayVisits }, { data: roles }] = await Promise.all([
    branchIds.length > 0
      ? supabase
          .from('staff')
          .select('*, branch:branches(*)')
          .eq('organization_id', orgId)
          .in('branch_id', branchIds)
          .is('deleted_at', null)
          .order('full_name')
      : Promise.resolve({ data: [] }),
    branchIds.length > 0
      ? supabase.from('branches').select('*').eq('organization_id', orgId).in('id', branchIds).eq('is_active', true).order('name')
      : Promise.resolve({ data: [] }),
    branchIds.length > 0
      ? supabase.from('visits').select('barber_id, amount').in('branch_id', branchIds).gte('completed_at', todayStr).lt('completed_at', tomorrowStr)
      : Promise.resolve({ data: [] }),
    supabase.from('roles').select('*').eq('organization_id', orgId).order('name'),
  ])

  return (
    <BarberosClient
      barbers={barbers ?? []}
      branches={branches ?? []}
      todayVisits={todayVisits ?? []}
      roles={roles ?? []}
    />
  )
}
