import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId, getOrgBranchIds } from '@/lib/actions/org'
import { redirect } from 'next/navigation'
import { IncentivosClient } from './incentivos-client'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Incentivos | Monaco Smart Barber',
}

export default async function IncentivosPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')
  const branchIds = await getOrgBranchIds()

  const supabase = createAdminClient()
  const today = new Date()
  const defaultPeriod = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`

  const [{ data: branches }, { data: rules }, { data: barbers }, { data: achievements }] = await Promise.all([
    supabase.from('branches').select('*').eq('organization_id', orgId).eq('is_active', true).order('name'),
    branchIds.length > 0
      ? supabase.from('incentive_rules').select('*').in('branch_id', branchIds).order('name')
      : Promise.resolve({ data: [] }),
    supabase.from('staff').select('id, full_name, branch_id').eq('organization_id', orgId).eq('role', 'barber').eq('is_active', true).order('full_name'),
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
      achievements={(achievements ?? []) as any}
      defaultPeriod={defaultPeriod}
    />
  )
}
