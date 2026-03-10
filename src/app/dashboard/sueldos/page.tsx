import { createClient } from '@/lib/supabase/server'
import { SueldosClient } from './sueldos-client'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Sueldos | Monaco Smart Barber',
}

export default async function SueldosPage() {
  const supabase = await createClient()
  const [{ data: branches }, { data: barbersRaw }, { data: payments }] = await Promise.all([
    supabase.from('branches').select('*').eq('is_active', true).order('name'),
    supabase
      .from('staff')
      .select('id, full_name, commission_pct, branch_id, salary_configs(*)')
      .eq('role', 'barber')
      .eq('is_active', true)
      .order('full_name'),
    supabase
      .from('salary_payments')
      .select('*, staff:staff(id, full_name, branch_id)')
      .order('period_start', { ascending: false })
      .limit(100),
  ])

  return (
    <SueldosClient
      branches={branches ?? []}
      barbers={barbersRaw ?? []}
      payments={payments ?? []}
    />
  )
}
