import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getScopedBranchIds } from '@/lib/actions/branch-access'
import { getActiveTimezone } from '@/lib/i18n'
import { getLocalDayBounds } from '@/lib/time-utils'
import { redirect } from 'next/navigation'
import { BarberosClient } from './barberos-client'

export default async function BarberosPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')
  const branchIds = await getScopedBranchIds()

  const supabase = createAdminClient()

  // Bounds del "hoy" en TZ de la org (no UTC). Ver doc en /equipo/page.tsx
  // sobre el bug previo del UTC slice cuando hora local cruza medianoche UTC.
  const tz = await getActiveTimezone()
  const { start: todayStart, end: todayEnd } = getLocalDayBounds(tz)

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
      ? supabase.from('visits').select('barber_id, amount').in('branch_id', branchIds).gte('completed_at', todayStart).lte('completed_at', todayEnd)
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
