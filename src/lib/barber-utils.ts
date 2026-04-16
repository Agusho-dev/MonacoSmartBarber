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
    label: 'Con fila',
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
  currentTime: number,
  marginMinutes = 35
): boolean {
  const barberSchedules = schedules
    .filter(s => s.staff_id === barber.id)
    .sort((a, b) => a.start_time.localeCompare(b.start_time))

  if (barberSchedules.length === 0) return false

  const today = new Date(currentTime)

  function timeToMs(timeStr: string): number {
    const [h, m] = timeStr.split(':').map(Number)
    const d = new Date(today)
    d.setHours(h, m, 0, 0)
    return d.getTime()
  }

  const lastBlock = barberSchedules[barberSchedules.length - 1]
  const lastEndMs = timeToMs(lastBlock.end_time)

  if (currentTime >= lastEndMs) return true

  for (let i = 0; i < barberSchedules.length; i++) {
    const blockEndMs = timeToMs(barberSchedules[i].end_time)
    const msToBlockEnd = blockEndMs - currentTime

    if (msToBlockEnd <= 0) continue

    if (msToBlockEnd <= marginMinutes * 60 * 1000) {
      const nextBlock = barberSchedules[i + 1]
      if (!nextBlock) return true

      const nextStartMs = timeToMs(nextBlock.start_time)
      const gapMinutes = (nextStartMs - blockEndMs) / 60_000
      if (gapMinutes > marginMinutes) return true
    }

    return false
  }

  return true
}

export function assignDynamicBarbers(
  entries: QueueEntry[],
  barbers: Staff[],
  schedules: StaffSchedule[],
  currentTime: number,
  marginMinutes = 35,
  dailyServiceCounts: Record<string, number> = {},
  lastCompletedAt: Record<string, string> = {},
  notClockedInIds: Set<string> = new Set(),
  cooldownMs = 120_000
): DynamicQueueEntry[] {
  const result: DynamicQueueEntry[] = []

  const barberLoad = new Map<string, number>()
  const barberAttending = new Set<string>()
  const unassigned: QueueEntry[] = []

  for (const entry of entries) {
    if (entry.status === 'waiting' && !entry.barber_id) {
      unassigned.push(entry)
    } else {
      result.push(entry)
      if (entry.barber_id && !entry.is_break) {
        if (entry.status === 'waiting' || entry.status === 'in_progress') {
          barberLoad.set(entry.barber_id, (barberLoad.get(entry.barber_id) || 0) + 1)
        }
        if (entry.status === 'in_progress') {
          barberAttending.add(entry.barber_id)
        }
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
    const eligibleBarbers = barbers.filter(b =>
      !b.hidden_from_checkin &&
      !isBarberBlockedByShiftEnd(b, result, schedules, currentTime, marginMinutes) &&
      !notClockedInIds.has(b.id)
    )

    const sortByLoad = (list: Staff[]) => {
      list.sort((a, b) => {
        const loadA = barberLoad.get(a.id) || 0
        const loadB = barberLoad.get(b.id) || 0
        if (loadA !== loadB) return loadA - loadB

        // At same load, prefer free barbers (can serve immediately) over busy ones.
        // This ensures the first FIFO client goes to the barber who just became available
        // rather than being queued behind a busy barber's current client.
        const busyA = barberAttending.has(a.id) ? 1 : 0
        const busyB = barberAttending.has(b.id) ? 1 : 0
        if (busyA !== busyB) return busyA - busyB

        const lastA = lastCompletedAt[a.id] || ''
        const lastB = lastCompletedAt[b.id] || ''
        if (lastA !== lastB) return lastA.localeCompare(lastB)

        const countA = dailyServiceCounts[a.id] || 0
        const countB = dailyServiceCounts[b.id] || 0
        if (countA !== countB) return countA - countB

        return a.id.localeCompare(b.id)
      })
      return list
    }

    // Si no hay ningún barbero elegible (sin fichaje, ocultos, bloqueados por fin de turno, etc.),
    // el cliente queda sin asignación dinámica. Antes se hacía fallback a *todos* los barberos,
    // lo que ignoraba el clock-in y mostraba pre-asignaciones incorrectas.
    if (eligibleBarbers.length === 0) {
      result.push(u)
      continue
    }

    const candidates = sortByLoad(eligibleBarbers)

    const selectedBarber = candidates[0]

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

/**
 * Calcula la cantidad optimista de personas "efectivamente" antes de un cliente,
 * considerando el paralelismo de barberos activos.
 *
 * - Dinámico (barber_id=null): ceil(todos_adelante / barberos_activos)
 * - Específico (barber_id=X): específicos_X_adelante + ceil(dinámicos_adelante / barberos_activos)
 *
 * Retorna el número y un label descriptivo.
 */
export function calculateEffectiveAhead(
  entries: QueueEntry[],
  entryId: string,
  activeBarbers: number
): { ahead: number; label: string } {
  const myEntry = entries.find(e => e.id === entryId)
  if (!myEntry) return { ahead: 0, label: '' }

  const waiting = entries.filter(
    e => e.status === 'waiting' && !e.is_break && e.id !== entryId
  )

  const ahead = waiting.filter(
    e => new Date(e.priority_order).getTime() < new Date(myEntry.priority_order).getTime()
  )

  const barbers = Math.max(activeBarbers, 1)

  let effectiveAhead: number

  if (!myEntry.barber_id) {
    // Dinámico: todos los que están adelante se distribuyen entre todos los barberos
    effectiveAhead = Math.ceil(ahead.length / barbers)
  } else {
    // Específico: los dinámicos adelante se reparten, los específicos de mi barbero no
    const specificsAhead = ahead.filter(e => e.barber_id === myEntry.barber_id).length
    const dynamicsAhead = ahead.filter(e => !e.barber_id).length
    effectiveAhead = specificsAhead + Math.ceil(dynamicsAhead / barbers)
  }

  if (effectiveAhead === 0) return { ahead: 0, label: 'Sos el siguiente' }
  if (effectiveAhead === 1) return { ahead: 1, label: 'Aprox. 1 persona antes' }
  return { ahead: effectiveAhead, label: `Aprox. ${effectiveAhead} personas antes` }
}
