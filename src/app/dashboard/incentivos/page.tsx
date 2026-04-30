import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getScopedBranchIds } from '@/lib/actions/branch-access'
import { redirect } from 'next/navigation'
import { IncentivosClient } from './incentivos-client'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Incentivos | BarberOS',
}

export default async function IncentivosPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')
  const branchIds = await getScopedBranchIds()

  const supabase = createAdminClient()
  const today = new Date()
  const defaultPeriod = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`

  const [{ data: _branches }, { data: rules }, { data: barbers }, { data: achievements }] = await Promise.all([
    branchIds.length > 0
      ? supabase.from('branches').select('*').eq('organization_id', orgId).in('id', branchIds).eq('is_active', true).order('name')
      : Promise.resolve({ data: [] }),
    branchIds.length > 0
      ? supabase.from('incentive_rules').select('*').in('branch_id', branchIds).order('name')
      : Promise.resolve({ data: [] }),
    branchIds.length > 0
      ? supabase.from('staff').select('id, full_name, branch_id').eq('organization_id', orgId).in('branch_id', branchIds).or('role.eq.barber,is_also_barber.eq.true').eq('is_active', true).order('full_name')
      : Promise.resolve({ data: [] }),
    supabase.from('incentive_achievements').select('*, rule:incentive_rules(name)').eq('period_label', defaultPeriod),
  ])

  return (
    <IncentivosClient
      rules={rules ?? []}
      barbers={
        (barbers ?? []).map((b) => ({
          id: b.id,
          full_name: b.full_name,
          branch_id: b.branch_id,
        }))
      }
      achievements={(achievements ?? []) as Parameters<typeof IncentivosClient>[0]['achievements']}
      defaultPeriod={defaultPeriod}
    />
  )
}
