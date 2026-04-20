import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getBarberSession } from '@/lib/actions/auth'
import { fetchBarberShiftSummary } from '@/lib/actions/shift'
import { createAdminClient } from '@/lib/supabase/server'
import { CerrarTurnoClient } from './cerrar-turno-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Cerrar turno | BarberOS',
}

export default async function CerrarTurnoPage() {
  const session = await getBarberSession()
  if (!session) redirect('/barbero/login')

  const supabase = createAdminClient()

  const [summary, { data: branch }, { data: existingClose }] = await Promise.all([
    fetchBarberShiftSummary(session.staff_id, session.branch_id),
    supabase.from('branches').select('name, timezone').eq('id', session.branch_id).single(),
    supabase
      .from('shift_closes')
      .select('id, cash_counted, cash_diff, closed_at, notes')
      .eq('staff_id', session.staff_id)
      .eq('branch_id', session.branch_id)
      .order('closed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if ('error' in summary) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-8">
        <div className="rounded-2xl border bg-card p-6 text-center">
          <p className="font-semibold text-destructive">Error</p>
          <p className="mt-1 text-sm text-muted-foreground">{summary.error}</p>
        </div>
      </div>
    )
  }

  // Si ya hay un cierre HOY, lo pasamos para re-aperturar UX.
  const tz = branch?.timezone ?? 'America/Argentina/Buenos_Aires'
  const todayLocal = new Date(new Date().toLocaleString('en-US', { timeZone: tz })).toDateString()
  const closedToday = existingClose?.closed_at
    ? new Date(new Date(existingClose.closed_at).toLocaleString('en-US', { timeZone: tz })).toDateString() === todayLocal
    : false

  return (
    <CerrarTurnoClient
      summary={summary}
      barberName={session.full_name}
      branchName={branch?.name ?? 'Sucursal'}
      previousClose={closedToday && existingClose ? {
        cashCounted: existingClose.cash_counted !== null ? Number(existingClose.cash_counted) : null,
        cashDiff: existingClose.cash_diff !== null ? Number(existingClose.cash_diff) : null,
        closedAt: existingClose.closed_at,
        notes: existingClose.notes,
      } : null}
    />
  )
}
