import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getBarberSession } from '@/lib/actions/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { QueuePanel } from '@/components/barber/queue-panel'
import { getAppointmentsForBarber, getAppointmentSettings } from '@/lib/actions/appointments'
import { getLocalDateStr } from '@/lib/time-utils'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Fila | BarberOS',
}

export default async function FilaPage() {
  const session = await getBarberSession()
  if (!session) redirect('/barbero/login')

  const supabase = createAdminClient()

  const { data: branch } = await supabase
    .from('branches')
    .select('name, operation_mode, timezone')
    .eq('id', session.branch_id)
    .single()

  // Día en la TZ de la sucursal: con la fecha UTC, después de las 21:00 el
  // panel mostraba la agenda de mañana y los turnos pendientes desaparecían.
  const today = getLocalDateStr(branch?.timezone || undefined)

  const [{ data: breakConfigs }, appointments, settings] = await Promise.all([
    supabase
      .from('break_configs')
      .select('*')
      .eq('branch_id', session.branch_id)
      .eq('is_active', true)
      .order('name'),
    getAppointmentsForBarber(session.staff_id, today),
    // Settings efectivos de ESTA sucursal (antes tomaba siempre el default de
    // la org e ignoraba el override por sucursal).
    getAppointmentSettings(session.organization_id, session.branch_id),
  ])

  const operationMode = (branch?.operation_mode as 'walk_in' | 'appointments' | 'hybrid' | null) ?? 'walk_in'

  return (
    <QueuePanel
      session={session}
      branchName={branch?.name ?? 'Sucursal'}
      breakConfigs={breakConfigs ?? []}
      appointments={appointments}
      noShowToleranceMinutes={settings?.no_show_tolerance_minutes ?? 15}
      operationMode={operationMode}
      timezone={branch?.timezone ?? null}
      // La ventana de protección de la fila es 45 min de corte promedio + este
      // buffer: el panel la calcula con el mismo número que la DB.
      bufferMinutes={settings?.buffer_minutes ?? null}
    />
  )
}
