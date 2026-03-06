import { createClient } from '@/lib/supabase/server'
import { fetchGoals } from '@/lib/actions/goals'
import { MetasClient } from './metas-client'

export default async function MetasPage() {
  const supabase = await createClient()
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

  const goals = await fetchGoals(currentMonth)

  const { data: branches } = await supabase
    .from('branches')
    .select('*')
    .eq('is_active', true)
    .order('name')

  const { data: barbers } = await supabase
    .from('staff')
    .select('*, branch:branches(name)')
    .eq('role', 'barber')
    .eq('is_active', true)
    .order('full_name')

  return (
    <MetasClient
      initialGoals={goals}
      branches={branches ?? []}
      barbers={barbers ?? []}
      currentMonth={currentMonth}
    />
  )
}
