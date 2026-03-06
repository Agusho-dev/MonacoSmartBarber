import { createClient } from '@/lib/supabase/server'
import { OverviewClient } from './overview-client'

export default async function DashboardPage() {
  const supabase = await createClient()

  const now = new Date()
  const todayStr = now.toISOString().slice(0, 10)
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().slice(0, 10)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthStartStr = monthStart.toISOString().slice(0, 10)

  const [
    { data: todayVisits },
    { data: occupancy },
    { count: newClientsCount },
    { data: recentVisits },
    { data: clientVisitData },
  ] = await Promise.all([
    supabase
      .from('visits')
      .select('*, client:clients(*), barber:staff(*), service:services(*)')
      .gte('completed_at', todayStr)
      .lt('completed_at', tomorrowStr)
      .order('completed_at', { ascending: false }),
    supabase.from('branch_occupancy').select('*'),
    supabase
      .from('clients')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', monthStartStr),
    supabase
      .from('visits')
      .select('*, client:clients(*), barber:staff(*), service:services(*)')
      .order('completed_at', { ascending: false })
      .limit(10),
    supabase
      .from('visits')
      .select('client_id, branch_id, completed_at')
      .gte('completed_at', new Date(now.getTime() - 40 * 86400000).toISOString()),
  ])

  return (
    <OverviewClient
      todayVisits={todayVisits ?? []}
      occupancy={occupancy ?? []}
      newClientsCount={newClientsCount ?? 0}
      recentVisits={recentVisits ?? []}
      clientVisitData={clientVisitData ?? []}
    />
  )
}
