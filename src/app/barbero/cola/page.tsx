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
  const { data: branch } = await supabase
    .from('branches')
    .select('name')
    .eq('id', session.branch_id)
    .single()

  return (
    <QueuePanel
      session={session}
      branchName={branch?.name ?? 'Sucursal'}
    />
  )
}
