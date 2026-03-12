import type { Staff, QueueEntry, Visit, StaffSchedule } from '@/lib/types/database'
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
      ; (groups[v.barber_id] ??= []).push(mins)
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

export type BarberStatus = 'available' | 'occupied' | 'has_queue'

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

  // Paused status was removed

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
}

export function getLoadColor(totalLoad: number): string {
  if (totalLoad === 0) return 'bg-emerald-500'
  if (totalLoad <= 2) return 'bg-amber-500'
  return 'bg-red-500'
}

export type DynamicQueueEntry = QueueEntry & { _is_dynamically_assigned?: boolean }

export function isBarberBlockedByShiftEnd(
  barber: Staff,
  entries: QueueEntry[],
  schedules: StaffSchedule[],
  currentTime: number
): boolean {
  const hasActiveService = entries.some(
    (e) => e.barber_id === barber.id && e.status === 'in_progress'
  )

  if (!hasActiveService) return false

  const today = new Date(currentTime)

  const barberSchedule = schedules.find(s => s.staff_id === barber.id)
  if (!barberSchedule) return false

  const [hours, minutes] = barberSchedule.end_time.split(':').map(Number)
  const shiftEnd = new Date(today)
  shiftEnd.setHours(hours, minutes, 0, 0)

  if (shiftEnd.getTime() < currentTime - 12 * 60 * 60 * 1000) {
    shiftEnd.setDate(shiftEnd.getDate() + 1)
  }

  const msRemaining = shiftEnd.getTime() - currentTime

  return msRemaining <= 35 * 60 * 1000
}

export function assignDynamicBarbers(
  entries: QueueEntry[],
  barbers: Staff[],
  schedules: StaffSchedule[],
  currentTime: number
): DynamicQueueEntry[] {
  const result: DynamicQueueEntry[] = []

  const barberLoad = new Map<string, number>()
  const unassigned: QueueEntry[] = []

  for (const entry of entries) {
    if (entry.status === 'waiting' && !entry.barber_id) {
      unassigned.push(entry)
    } else {
      result.push(entry)
      // Exclude break ghost entries from load so they don't cause dynamic clients to be
      // redirected to other barbers when a break is scheduled for this barber.
      if (entry.barber_id && (entry.status === 'waiting' || entry.status === 'in_progress') && !entry.is_break) {
        barberLoad.set(entry.barber_id, (barberLoad.get(entry.barber_id) || 0) + 1)
      }
    }
  }

  for (const b of barbers) {
    if (!barberLoad.has(b.id)) {
      barberLoad.set(b.id, 0)
    }
  }

  unassigned.sort((a, b) => a.position - b.position)

  for (const u of unassigned) {
    const eligibleBarbers = barbers.filter(b => !isBarberBlockedByShiftEnd(b, result, schedules, currentTime))

    if (eligibleBarbers.length === 0) {
      result.push(u)
      continue
    }

    eligibleBarbers.sort((a, b) => {
      const loadA = barberLoad.get(a.id) || 0
      const loadB = barberLoad.get(b.id) || 0
      if (loadA !== loadB) return loadA - loadB

      const nameCmp = (a.full_name || '').localeCompare(b.full_name || '')
      if (nameCmp !== 0) return nameCmp
      return a.id.localeCompare(b.id)
    })

    const selectedBarber = eligibleBarbers[0]

    result.push({
      ...u,
      barber_id: selectedBarber.id,
      barber: selectedBarber,
      _is_dynamically_assigned: true
    })

    barberLoad.set(selectedBarber.id, (barberLoad.get(selectedBarber.id) || 0) + 1)
  }

  // Sort by position so that a "cualquiera" client with an earlier turn number always
  // appears before a later-arriving assigned client, regardless of assignment order.
  return result.sort((a, b) => a.position - b.position)
}
