import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getScopedBranchIds } from '@/lib/actions/branch-access'
import { getAppointmentsForDateMultiBranch, getAppointmentSettings } from '@/lib/actions/appointments'
import { getActiveTimezone } from '@/lib/i18n'
import { getLocalDateStr } from '@/lib/time-utils'
import { redirect } from 'next/navigation'
import { FilaClient } from './fila-client'
import { FilaTabsWrapper } from './fila-tabs-wrapper'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Fila | BarberOS',
}

export default async function FilaAdminPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')
  const branchIds = await getScopedBranchIds()
  const timezone = await getActiveTimezone()

  const supabase = createAdminClient()

  // Fecha en la TZ activa: con la fecha UTC, después de las 21:00 la pestaña
  // de turnos del día mostraba la agenda de mañana.
  const today = getLocalDateStr(timezone)

  const [
    { data: entries },
    { data: barbers },
    { data: branches },
    { data: breakConfigs },
    settings,
  ] = await Promise.all([
    branchIds.length > 0
      ? supabase
          .from('queue_entries')
          // El MISMO select que el refetch de `fila-client.tsx`, columna por
          // columna. Con `clients(*)` y `staff(*)` —y service role, que no pasa
          // por RLS— este render le mandaba al navegador el PIN de cada barbero
          // con alguien en la fila y el `pin_hash`, el `face_embedding` y el
          // email de cada cliente esperando: el tablero sólo dibuja nombre,
          // teléfono y avatar. Embeds por nombre de constraint (Known Risk #15).
          // El `*` es de `queue_entries` y trae `pidio_asesoria` y
          // `asesoria_vista_at` (mig 217): el sello de asesoría de las tarjetas.
          .select('*, client:clients!queue_entries_client_id_fkey(id, name, phone), barber:staff!queue_entries_barber_id_fkey(id, full_name, avatar_url)')
          .in('branch_id', branchIds)
          .in('status', ['waiting', 'in_progress'])
          // Mismo orden que el refetch: `priority_order` es el FIFO real y
          // `position` sólo desempata (se recicla y se repite).
          .order('priority_order')
          .order('position')
      : Promise.resolve({ data: [] }),
    branchIds.length > 0
      ? supabase
          .from('staff')
          .select('id, full_name, branch_id, status, is_active, hidden_from_checkin, avatar_url')
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
      : Promise.resolve({ data: [] }),
    branchIds.length > 0
      ? supabase
          .from('break_configs')
          .select('*')
          .in('branch_id', branchIds)
          .eq('is_active', true)
          .order('name')
      : Promise.resolve({ data: [] }),
    getAppointmentSettings(orgId),
  ])

  // Cargar turnos del día para todas las sucursales en una sola query
  // (en lugar de N queries con assertBranchAccess interno cada una).
  const allAppointments = await getAppointmentsForDateMultiBranch(
    (branches ?? []).map(b => b.id),
    today
  )

  return (
    <FilaTabsWrapper
      appointments={allAppointments}
      noShowToleranceMinutes={settings?.no_show_tolerance_minutes ?? 15}
    >
      <FilaClient
        initialEntries={entries ?? []}
        barbers={barbers ?? []}
        branches={branches ?? []}
        breakConfigs={breakConfigs ?? []}
        timezone={timezone}
        orgId={orgId}
      />
    </FilaTabsWrapper>
  )
}
