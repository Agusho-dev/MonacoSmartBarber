import { createClient } from '@/lib/supabase/server'
import { DisciplinaClient } from './disciplina-client'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Disciplina | Monaco Smart Barber',
}

export default async function DisciplinaPage() {
  const supabase = await createClient()

  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  const fromDate = startOfMonth.toISOString().slice(0, 10)

  const [{ data: branches }, { data: rules }, { data: barbers }, { data: events }] = await Promise.all([
    supabase.from('branches').select('*').eq('is_active', true).order('name'),
    supabase.from('disciplinary_rules').select('*').order('event_type').order('occurrence_number'),
    supabase.from('staff').select('id, full_name, branch_id').eq('role', 'barber').eq('is_active', true).order('full_name'),
    supabase
      .from('disciplinary_events')
      .select('*, staff:staff(id, full_name, branch_id)')
      .gte('event_date', fromDate)
      .order('event_date', { ascending: false }),
  ])

  return (
    <DisciplinaClient
      branches={branches ?? []}
      rules={rules ?? []}
      barbers={barbers ?? []}
      events={events ?? []}
      fromDate={fromDate}
    />
  )
}
