import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { redirect } from 'next/navigation'
import { CalendarioClient } from './calendario-client'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Calendario laboral | Monaco Smart Barber',
}

export default async function CalendarioPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')

  const supabase = createAdminClient()
  const [{ data: branches }, { data: barbers }] = await Promise.all([
    supabase.from('branches').select('*').eq('organization_id', orgId).eq('is_active', true).order('name'),
    supabase
      .from('staff')
      .select('id, full_name, branch_id, staff_schedules(*), staff_schedule_exceptions(*)')
      .eq('organization_id', orgId)
      .eq('role', 'barber')
      .eq('is_active', true)
      .order('full_name'),
  ])
  return <CalendarioClient branches={branches ?? []} barbers={barbers ?? []} />
}
