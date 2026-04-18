import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getAppointmentSettings } from '@/lib/actions/appointments'
import { createAdminClient } from '@/lib/supabase/server'
import { AgendaClient } from './agenda-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Agenda de Turnos | Monaco Smart Barber',
}

export default async function AgendaPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')

  const supabase = createAdminClient()

  const [settings, { data: branches }] = await Promise.all([
    getAppointmentSettings(orgId),
    supabase
      .from('branches')
      .select('id, name')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .order('name'),
  ])

  return (
    <AgendaClient
      settings={settings}
      branches={branches ?? []}
    />
  )
}
