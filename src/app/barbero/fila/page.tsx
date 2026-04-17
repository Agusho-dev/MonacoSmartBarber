import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getBarberSession } from '@/lib/actions/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { QueuePanel } from '@/components/barber/queue-panel'
import { getAppointmentsForBarber, getAppointmentSettings } from '@/lib/actions/appointments'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Fila | Monaco Smart Barber',
}

export default async function FilaPage() {
  const session = await getBarberSession()
  if (!session) redirect('/barbero/login')

  const supabase = createAdminClient()
  const today = new Date().toISOString().split('T')[0]

  const [{ data: branch }, { data: breakConfigs }, appointments, settings] = await Promise.all([
    supabase
      .from('branches')
      .select('name')
      .eq('id', session.branch_id)
      .single(),
    supabase
      .from('break_configs')
      .select('*')
      .eq('branch_id', session.branch_id)
      .eq('is_active', true)
      .order('name'),
    getAppointmentsForBarber(session.staff_id, today),
    getAppointmentSettings(session.organization_id),
  ])

  return (
    <QueuePanel
      session={session}
      branchName={branch?.name ?? 'Sucursal'}
      breakConfigs={breakConfigs ?? []}
      appointments={appointments}
      noShowToleranceMinutes={settings?.no_show_tolerance_minutes ?? 15}
    />
  )
}
