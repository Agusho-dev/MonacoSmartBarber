import { createClient } from '@/lib/supabase/server'
import { BarberosClient } from './barberos-client'

export default async function BarberosPage() {
  const supabase = await createClient()

  const now = new Date()
  const todayStr = now.toISOString().slice(0, 10)
  const tomorrowStr = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    .toISOString()
    .slice(0, 10)

  const [{ data: barbers }, { data: branches }, { data: todayVisits }, { data: roles }] = await Promise.all([
    supabase
      .from('staff')
      .select('*, branch:branches(*)')
      .order('full_name'),
    supabase.from('branches').select('*').eq('is_active', true).order('name'),
    supabase
      .from('visits')
      .select('barber_id, amount')
      .gte('completed_at', todayStr)
      .lt('completed_at', tomorrowStr),
    supabase.from('roles').select('*').order('name'),
  ])

  return (
    <BarberosClient
      barbers={barbers ?? []}
      todayVisits={todayVisits ?? []}
      roles={roles ?? []}
    />
  )
}
