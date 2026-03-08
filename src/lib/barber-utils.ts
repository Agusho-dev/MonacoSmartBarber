import type { Staff, QueueEntry, Visit } from '@/lib/types/database'

export function buildBarberAvgMinutes(
  visits: Pick<Visit, 'barber_id' | 'started_at' | 'completed_at'>[],
  fallback: number
): Record<string, number> {
  const groups: Record<string, number[]> = {}

  for (const v of visits) {
    if (!v.started_at || !v.completed_at) continue
    const mins =
      (new Date(v.completed_at).getTime() - new Date(v.started_at).getTime()) /
      60_000
    if (mins < 5 || mins > 120) continue
    ;(groups[v.barber_id] ??= []).push(mins)
  }

  const result: Record<string, number> = {}
  for (const [barberId, durations] of Object.entries(groups)) {
    result[barberId] = Math.round(
      durations.reduce((a, b) => a + b, 0) / durations.length
    )
  }
  result.__fallback = fallback
  return result
}

export type BarberStatus = 'available' | 'occupied' | 'has_queue' | 'paused'

export interface BarberStats {
  waiting: number
  attending: boolean
  totalLoad: number
  eta: number
  avg: number
  status: BarberStatus
}

export function getBarberStats(
  barber: Staff,
  entries: QueueEntry[],
  avgMap: Record<string, number>
): BarberStats {
  const avg = avgMap[barber.id] ?? avgMap.__fallback ?? 25
  const waiting = entries.filter(
    (e) => e.barber_id === barber.id && e.status === 'waiting'
  ).length
  const attending = entries.some(
    (e) => e.barber_id === barber.id && e.status === 'in_progress'
  )
  const totalLoad = waiting + (attending ? 1 : 0)
  const eta = Math.round(totalLoad * avg)

  if (barber.status === 'paused') {
    return { waiting, attending, totalLoad, eta, avg, status: 'paused' }
  }

  let status: BarberStatus
  if (attending) {
    status = waiting > 0 ? 'has_queue' : 'occupied'
  } else {
    status = waiting > 0 ? 'has_queue' : 'available'
  }

  return { waiting, attending, totalLoad, eta, avg, status }
}

export function formatWaitTime(minutes: number | null): string {
  if (minutes === null || minutes === 0) return 'Sin espera'
  if (minutes < 60) return `~${minutes} min`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return mins > 0 ? `~${hours}h ${mins}min` : `~${hours}h`
}

export const statusConfig: Record<
  BarberStatus,
  { label: string; className: string }
> = {
  available: {
    label: 'Libre',
    className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  },
  occupied: {
    label: 'Atendiendo',
    className: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  },
  has_queue: {
    label: 'Con cola',
    className: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  },
  paused: {
    label: 'En pausa',
    className: 'bg-white/8 text-white/40 border-white/10',
  },
}

export function getLoadColor(totalLoad: number): string {
  if (totalLoad === 0) return 'bg-emerald-500'
  if (totalLoad <= 2) return 'bg-amber-500'
  return 'bg-red-500'
}
