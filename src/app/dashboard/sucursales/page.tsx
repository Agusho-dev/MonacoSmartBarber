import { createClient } from '@/lib/supabase/server'
import { SucursalesClient } from './sucursales-client'

export default async function SucursalesPage() {
  const supabase = await createClient()

  const now = new Date()
  const todayStr = now.toISOString().slice(0, 10)
  const tomorrowStr = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    .toISOString()
    .slice(0, 10)

  const [{ data: branches }, { data: staff }, { data: todayVisits }, { data: occupancy }] =
    await Promise.all([
      supabase.from('branches').select('*').order('name'),
      supabase
        .from('staff')
        .select('id, branch_id, is_active')
        .eq('is_active', true),
      supabase
        .from('visits')
        .select('branch_id, amount')
        .gte('completed_at', todayStr)
        .lt('completed_at', tomorrowStr),
      supabase.from('branch_occupancy').select('*'),
    ])

  return (
    <SucursalesClient
      branches={branches ?? []}
      staff={staff ?? []}
      todayVisits={todayVisits ?? []}
      occupancy={occupancy ?? []}
    />
  )
}
