import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getScopedBranchIds } from '@/lib/actions/branch-access'
import { getAppointmentSettings, getAppointmentStaff } from '@/lib/actions/appointments'
import { listTemplatesForPicker } from '@/lib/actions/messaging'
import { createAdminClient } from '@/lib/supabase/server'
import { TurnosConfigClient } from './turnos-config-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Configuración de Turnos | Monaco Smart Barber',
}

export default async function TurnosConfigPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')

  const supabase = createAdminClient()
  const branchIds = await getScopedBranchIds()

  const [settings, appointmentStaff, { data: allStaff }, { data: branches }, templatesResult] = await Promise.all([
    getAppointmentSettings(orgId),
    getAppointmentStaff(orgId),
    branchIds.length > 0
      ? supabase
          .from('staff')
          .select('id, full_name, branch_id, role, is_active, avatar_url')
          .eq('organization_id', orgId)
          .in('branch_id', branchIds)
          .or('role.eq.barber,is_also_barber.eq.true')
          .eq('is_active', true)
          .order('full_name')
      : Promise.resolve({ data: [] }),
    branchIds.length > 0
      ? supabase
          .from('branches')
          .select('id, name')
          .eq('organization_id', orgId)
          .in('id', branchIds)
          .eq('is_active', true)
          .order('name')
      : Promise.resolve({ data: [] }),
    listTemplatesForPicker(),
  ])

  const staffMap = new Map(appointmentStaff.map(s => [s.staff_id, s]))

  return (
    <TurnosConfigClient
      settings={settings}
      allStaff={(allStaff ?? []).map(s => {
        const cfg = staffMap.get(s.id)
        return {
          ...s,
          enabledForAppointments: !!cfg,
          walkinMode: cfg?.walkin_mode ?? 'both',
        }
      })}
      branches={branches ?? []}
      templates={templatesResult.data}
      hasWhatsAppChannel={templatesResult.hasChannel}
    />
  )
}
