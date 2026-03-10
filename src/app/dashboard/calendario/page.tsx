import { createClient } from '@/lib/supabase/server'
import { CalendarioClient } from './calendario-client'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Calendario laboral | Monaco Smart Barber',
}

export default async function CalendarioPage() {
  const supabase = await createClient()
  const [{ data: branches }, { data: barbers }] = await Promise.all([
    supabase.from('branches').select('*').eq('is_active', true).order('name'),
    supabase
      .from('staff')
      .select('id, full_name, branch_id, staff_schedules(*), staff_schedule_exceptions(*)')
      .eq('role', 'barber')
      .eq('is_active', true)
      .order('full_name'),
  ])
  return <CalendarioClient branches={branches ?? []} barbers={barbers ?? []} />
}
