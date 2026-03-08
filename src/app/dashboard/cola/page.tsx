import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { ColaClient } from './cola-client'

export const metadata: Metadata = {
  title: 'Cola | Monaco Smart Barber',
}

export default async function ColaAdminPage() {
  const supabase = await createClient()

  const [
    { data: entries },
    { data: barbers },
    { data: branches },
  ] = await Promise.all([
    supabase
      .from('queue_entries')
      .select('*, client:clients(*), barber:staff(*)')
      .in('status', ['waiting', 'in_progress'])
      .order('position'),
    supabase
      .from('staff')
      .select('id, full_name, branch_id, status, is_active')
      .eq('role', 'barber')
      .eq('is_active', true)
      .order('full_name'),
    supabase
      .from('branches')
      .select('id, name')
      .eq('is_active', true),
  ])

  return (
    <ColaClient
      initialEntries={entries ?? []}
      barbers={barbers ?? []}
      branches={branches ?? []}
    />
  )
}
