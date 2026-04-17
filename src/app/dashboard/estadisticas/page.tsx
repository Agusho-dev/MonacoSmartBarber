import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
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

  const [data, { data: branches }, { data: orgRow }] = await Promise.all([
    fetchStats(from, to),
    supabase
      .from('branches')
      .select('id, name')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .order('name'),
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
