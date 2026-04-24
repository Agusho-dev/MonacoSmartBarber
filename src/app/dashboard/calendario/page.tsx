import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getScopedBranchIds } from '@/lib/actions/branch-access'
import { redirect } from 'next/navigation'
import { CalendarioClient } from './calendario-client'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Calendario laboral | BarberOS',
}

export default async function CalendarioPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')

  const supabase = createAdminClient()
  const branchIds = await getScopedBranchIds()
  const [{ data: branches }, { data: barbers }] = await Promise.all([
    branchIds.length > 0
      ? supabase.from('branches').select('*').eq('organization_id', orgId).in('id', branchIds).eq('is_active', true).order('name')
      : Promise.resolve({ data: [] }),
    branchIds.length > 0
      ? supabase
          .from('staff')
          .select('id, full_name, branch_id, staff_schedules(*), staff_schedule_exceptions(*)')
          .eq('organization_id', orgId)
          .in('branch_id', branchIds)
          .or('role.eq.barber,is_also_barber.eq.true')
          .eq('is_active', true)
          .order('full_name')
      : Promise.resolve({ data: [] }),
  ])
  return <CalendarioClient branches={branches ?? []} barbers={barbers ?? []} />
}
