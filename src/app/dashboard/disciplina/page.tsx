import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId, getOrgBranchIds } from '@/lib/actions/org'
import { redirect } from 'next/navigation'
import { DisciplinaClient } from './disciplina-client'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Disciplina | Monaco Smart Barber',
}

export default async function DisciplinaPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')
  const branchIds = await getOrgBranchIds()

  const supabase = createAdminClient()

  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  const fromDate = startOfMonth.toISOString().slice(0, 10)

  const [{ data: branches }, { data: rules }, { data: staff }, { data: events }, { data: attendanceLogs }] = await Promise.all([
    supabase.from('branches').select('*').eq('organization_id', orgId).eq('is_active', true).order('name'),
    branchIds.length > 0
      ? supabase.from('disciplinary_rules').select('*').in('branch_id', branchIds).order('event_type').order('occurrence_number')
      : Promise.resolve({ data: [] }),
    supabase.from('staff').select('id, full_name, branch_id, role').eq('organization_id', orgId).eq('is_active', true).order('full_name'),
    branchIds.length > 0
      ? supabase.from('disciplinary_events').select('*, staff:staff(id, full_name, branch_id)').in('branch_id', branchIds).gte('event_date', fromDate).order('event_date', { ascending: false })
      : Promise.resolve({ data: [] }),
    branchIds.length > 0
      ? supabase.from('attendance_logs').select('id, staff_id, branch_id, action_type, recorded_at, face_verified').in('branch_id', branchIds).gte('recorded_at', fromDate).order('recorded_at', { ascending: false })
      : Promise.resolve({ data: [] }),
  ])

  return (
    <DisciplinaClient
      rules={rules ?? []}
      barbers={staff ?? []}
      events={events ?? []}
      fromDate={fromDate}
      attendanceLogs={attendanceLogs ?? []}
    />
  )
}
