import { fetchStats } from '@/lib/actions/stats'
import { EstadisticasClient } from './estadisticas-client'

export default async function EstadisticasPage() {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), 1)
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)

  const data = await fetchStats(from.toISOString(), to.toISOString())

  return <EstadisticasClient initialData={data} />
}
