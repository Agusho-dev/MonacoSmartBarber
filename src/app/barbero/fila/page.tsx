import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getBarberSession } from '@/lib/actions/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { QueuePanel } from '@/components/barber/queue-panel'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Fila | BarberOS',
}

export default async function FilaPage() {
  const session = await getBarberSession()
  if (!session) redirect('/barbero/login')

  const supabase = createAdminClient()

  const [{ data: branch }, { data: breakConfigs }] = await Promise.all([
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
  ])

  return (
    <QueuePanel
      session={session}
      branchName={branch?.name ?? 'Sucursal'}
      breakConfigs={breakConfigs ?? []}
    />
  )
}
