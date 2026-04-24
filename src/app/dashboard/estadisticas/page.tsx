import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getScopedBranchIds } from '@/lib/actions/branch-access'
import { redirect } from 'next/navigation'
import { fetchStats } from '@/lib/actions/stats'
import { EstadisticasClient } from './estadisticas-client'
import { getMonthBoundsStr, getLocalDayBounds } from '@/lib/time-utils'

export default async function EstadisticasPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')

  const supabase = createAdminClient()
  const { start: from } = getMonthBoundsStr(1)
  const { end: to } = getLocalDayBounds()
  const branchIds = await getScopedBranchIds()

  const [data, { data: branches }, { data: orgRow }] = await Promise.all([
    fetchStats(from, to),
    branchIds.length > 0
      ? supabase
          .from('branches')
          .select('id, name')
          .eq('organization_id', orgId)
          .in('id', branchIds)
          .eq('is_active', true)
          .order('name')
      : Promise.resolve({ data: [] }),
    supabase.from('organizations').select('name').eq('id', orgId).maybeSingle(),
  ])

  return (
    <EstadisticasClient
      initialData={data}
      branches={branches ?? []}
      orgName={orgRow?.name ?? 'BarberOS'}
    />
  )
}
