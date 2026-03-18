import { createClient } from '@/lib/supabase/server'
import { fetchStats } from '@/lib/actions/stats'
import { EstadisticasClient } from './estadisticas-client'

export default async function EstadisticasPage() {
  const supabase = await createClient()
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), 1)
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)

  const [data, { data: branches }] = await Promise.all([
    fetchStats(from.toISOString(), to.toISOString()),
    supabase
      .from('branches')
      .select('id, name')
      .eq('is_active', true)
      .order('name'),
  ])

  return <EstadisticasClient initialData={data} branches={branches ?? []} />
}
