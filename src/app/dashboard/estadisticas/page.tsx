import { createClient } from '@/lib/supabase/server'
import { fetchStats } from '@/lib/actions/stats'
import { EstadisticasClient } from './estadisticas-client'
import { getMonthBoundsStr, getLocalDayBounds } from '@/lib/time-utils'

export default async function EstadisticasPage() {
  const supabase = await createClient()
  const { start: from } = getMonthBoundsStr(1)
  const { end: to } = getLocalDayBounds()

  const [data, { data: branches }] = await Promise.all([
    fetchStats(from, to),
    supabase
      .from('branches')
      .select('id, name')
      .eq('is_active', true)
      .order('name'),
  ])

  return <EstadisticasClient initialData={data} branches={branches ?? []} />
}
