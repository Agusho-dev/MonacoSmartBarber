import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getScopedBranchIds } from '@/lib/actions/branch-access'
import type { DisciplinaDelMes } from '@/lib/actions/disciplinary'
import { redirect } from 'next/navigation'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { getActiveTimezone } from '@/lib/i18n'
import { limitesDelMes, mesDeHoy, SELECT_EVENTO_DISCIPLINA } from '@/lib/disciplina-mes'
import { DisciplinaClient } from './disciplina-client'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Disciplina | BarberOS',
}

export default async function DisciplinaPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')
  const branchIds = await getScopedBranchIds()

  const supabase = createAdminClient()

  // El mes en curso. Los anteriores los pide el cliente (getDisciplinaDelMes).
  const tz = await getActiveTimezone()
  const { desdeFecha: fromDate, desdeIso } = limitesDelMes(mesDeHoy(tz), tz)

  const [{ data: _branches }, { data: rules }, { data: staff }, { data: events, error: errorEventos }, attendanceLogs] = await Promise.all([
    branchIds.length > 0
      ? supabase.from('branches').select('*').eq('organization_id', orgId).in('id', branchIds).eq('is_active', true).order('name')
      : Promise.resolve({ data: [] }),
    branchIds.length > 0
      ? supabase.from('disciplinary_rules').select('*').in('branch_id', branchIds).order('event_type').order('occurrence_number')
      : Promise.resolve({ data: [] }),
    branchIds.length > 0
      ? supabase.from('staff').select('id, full_name, branch_id, role').eq('organization_id', orgId).in('branch_id', branchIds).eq('is_active', true).order('full_name')
      : Promise.resolve({ data: [] }),
    branchIds.length > 0
      ? supabase.from('disciplinary_events').select(SELECT_EVENTO_DISCIPLINA).in('branch_id', branchIds).gte('event_date', fromDate).order('event_date', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    branchIds.length > 0
      ? fetchAll<DisciplinaDelMes['attendanceLogs'][number]>(
          (from, to) =>
            supabase
              .from('attendance_logs')
              .select('id, staff_id, branch_id, action_type, recorded_at, face_verified')
              .in('branch_id', branchIds)
              .gte('recorded_at', desdeIso)
              .order('recorded_at', { ascending: false })
              .order('id')
              .range(from, to),
          { contexto: 'disciplina: fichadas del mes' },
        )
      : Promise.resolve([]),
  ])

  if (errorEventos) console.error('[disciplina] eventos del mes en curso:', errorEventos.message)

  return (
    <DisciplinaClient
      rules={rules ?? []}
      barbers={staff ?? []}
      events={events ?? []}
      errorEventos={Boolean(errorEventos)}
      fromDate={fromDate}
      attendanceLogs={attendanceLogs}
    />
  )
}
