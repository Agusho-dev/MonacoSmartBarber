import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getBarberSession } from '@/lib/actions/auth'
import { createClient } from '@/lib/supabase/server'
import { QueuePanel } from '@/components/barber/queue-panel'

export const metadata: Metadata = {
  title: 'Cola | Monaco Smart Barber',
}

export default async function ColaPage() {
  const session = await getBarberSession()
  if (!session) redirect('/barbero/login')

  const supabase = await createClient()

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
