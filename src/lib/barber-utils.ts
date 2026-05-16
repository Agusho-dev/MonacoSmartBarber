import type { Staff, QueueEntry, Visit, StaffSchedule } from '@/lib/types/database'
export function buildBarberAvgMinutes(
  visits: Pick<Visit, 'barber_id' | 'started_at' | 'completed_at'>[],
  fallback: number
): Record<string, number> {
  const groups: Record<string, number[]> = {}

  for (const v of visits) {
    if (!v.started_at || !v.completed_at) continue
    if (!v.barber_id) continue
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

// ETA en minutos hasta que el barbero pueda atender al próximo cliente nuevo:
//   waiting_count * avg + remaining_current
// donde remaining_current descuenta el tiempo ya transcurrido del servicio in_progress.
export function computeBarberEtaMinutes(
  barber: Staff,
  entries: QueueEntry[],
  avgMap: Record<string, number>,
  now: number
): number {
  const avg = avgMap[barber.id] ?? avgMap.__fallback ?? 25
  let waiting = 0
  let inProgress: QueueEntry | undefined
  for (const e of entries) {
    if (e.barber_id !== barber.id || e.is_break) continue
    if (e.status === 'waiting') waiting++
    else if (e.status === 'in_progress') inProgress = e
  }
  let remaining = 0
  if (inProgress) {
    const startedAt = inProgress.started_at ? new Date(inProgress.started_at).getTime() : null
    const elapsedMin = startedAt ? Math.max(0, (now - startedAt) / 60_000) : 0
    remaining = Math.max(0, avg - elapsedMin)
  }
  return waiting * avg + remaining
}

export function getBarberStats(
  barber: Staff,
  entries: QueueEntry[],
  avgMap: Record<string, number>,
  now: number = Date.now()
): BarberStats {
  const avg = avgMap[barber.id] ?? avgMap.__fallback ?? 25
  const waiting = entries.filter(
    (e) => e.barber_id === barber.id && e.status === 'waiting' && !e.is_break
  ).length
  const attending = entries.some(
    (e) => e.barber_id === barber.id && e.status === 'in_progress' && !e.is_break
  )
  const totalLoad = waiting + (attending ? 1 : 0)
  const eta = Math.round(computeBarberEtaMinutes(barber, entries, avgMap, now))

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

// ────────────────────────────────────────────────────────────────
// Status semantics compartidas con la app mobile (BarberStatusTile).
// El mobile clasifica a cada barbero como:
//   - 'ocupado'    → tiene un cliente en in_progress
//   - 'descanso'   → staff.status en {paused, blocked}
//   - 'disponible' → el resto
// El kiosk usaba antes un esquema de 4 niveles (sillas). Para alinear
// la experiencia, la terminal de check-in ahora muestra la misma
// clasificación + ETA + fila visible.
// ────────────────────────────────────────────────────────────────
export type MobileBarberStatus = 'disponible' | 'ocupado' | 'descanso'

export function getMobileBarberStatus(
  barber: Staff,
  attending: boolean,
): MobileBarberStatus {
  if (attending) return 'ocupado'
  const raw = (barber as unknown as { status?: string }).status
  if (raw === 'paused' || raw === 'blocked') return 'descanso'
  return 'disponible'
}

export const mobileStatusColors: Record<
  MobileBarberStatus,
  { hex: string; badge: string; stripe: string; accentText: string }
> = {
  disponible: {
    hex: '#22C55E',
    badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    stripe: 'bg-emerald-500',
    accentText: 'text-emerald-400',
  },
  ocupado: {
    hex: '#F59E0B',
    badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    stripe: 'bg-amber-500',
    accentText: 'text-amber-400',
  },
  descanso: {
    hex: '#9CA3AF',
    badge: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
    stripe: 'bg-zinc-500',
    accentText: 'text-zinc-400',
  },
}

export const mobileStatusLabels: Record<MobileBarberStatus, string> = {
  disponible: 'Disponible',
  ocupado: 'Ocupado',
  descanso: 'En descanso',
}

export function getLoadColor(totalLoad: number): string {
  if (totalLoad === 0) return 'bg-emerald-500'
  if (totalLoad <= 2) return 'bg-amber-500'
  return 'bg-red-500'
}

export type DynamicQueueEntry = QueueEntry & { _is_dynamically_assigned?: boolean }

/**
 * Devuelve los IDs de barberos con un descanso activo
 * (ghost row con `is_break=true` y `status='in_progress'`).
 *
 * Esta es la única fuente de verdad de "en descanso" en el cliente: el campo
 * `staff.status` no se mantiene actualizado (su enum es de un solo valor
 * `available`). El descanso real vive en `queue_entries`.
 *
 * Importante: un ghost en `waiting` NO cuenta — significa "descanso aprobado
 * pero encolado N cortes adelante", durante el cual el barbero todavía recibe
 * clientes (con `cuts_before_break > 0`).
 */
export function getBarbersOnBreakIds(entries: QueueEntry[]): Set<string> {
  const onBreak = new Set<string>()
  for (const e of entries) {
    if (e.is_break && e.status === 'in_progress' && e.barber_id) {
      onBreak.add(e.barber_id)
    }
  }
  return onBreak
}

/**
 * Barberos que están atendiendo un corte AHORA (in_progress, no-break).
 * No están disponibles para un dinámico aunque su ETA naïve dé 0 (un corte
 * largo satura max(0, avg-elapsed) a 0 y los hacía "empatar" con un barbero
 * realmente libre). Fuente de verdad: queue_entries.
 */
export function getBarbersAttendingIds(entries: QueueEntry[]): Set<string> {
  const attending = new Set<string>()
  for (const e of entries) {
    if (!e.is_break && e.status === 'in_progress' && e.barber_id) {
      attending.add(e.barber_id)
    }
  }
  return attending
}

export function isBarberBlockedByShiftEnd(
  barber: Staff,
  _entries: QueueEntry[],
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

// Contexto necesario para rankear barberos al asignar un cliente dinámico.
// `etaOverrides` permite mantener un ETA mutable cuando se pre-asignan varios
// dinámicos en cadena (cada asignación suma `avg` al barbero elegido).
export interface BarberRankingContext {
  entries: QueueEntry[]
  avgMap: Record<string, number>
  now: number
  dailyServiceCounts: Record<string, number>
  lastCompletedAt: Record<string, string>
  etaOverrides?: Map<string, number>
  // Barberos NO disponibles ahora para un dinámico: atendiendo (in_progress
  // no-break) o ya pre-asignados en esta misma pasada. Un barbero idle SIEMPRE
  // gana a uno ocupado: un corte largo satura el ETA naïve a 0
  // (max(0, avg-elapsed)) y hacía "empatar" un ocupado de 29min con uno libre
  // — bug prod 2026-05-16 (Fabri libre, el dinámico figuraba "con Simón").
  busyBarberIds?: Set<string>
}

// Orden de prioridad (todos ASC):
//   0. Disponible AHORA (idle=0) antes que ocupado (1). Señal objetiva y
//      estable entre tablets. Sin esto, un corte largo hace
//      ETA=max(0,avg-elapsed)=0 y un barbero ocupado hace 29min "empata" a
//      uno libre y le gana por el desempate de cortes — el dinámico figuraba
//      "con" el ocupado habiendo uno realmente libre (bug prod 2026-05-16).
//   1. ETA hasta atender al próximo (libre = 0; ocupado = max(0, avg-elapsed) + waiting*avg)
//   2. Cortes hechos hoy (menos primero)
//   3. Timestamp del último corte ('' < ISO, así quien no atendió hoy gana)
//   4. ID (orden estable)
export function compareBarbersForDynamic(
  a: Staff,
  b: Staff,
  ctx: BarberRankingContext
): number {
  // 0. Disponibilidad real ahora: idle (0) gana a ocupado (1).
  const busyA = ctx.busyBarberIds?.has(a.id) ? 1 : 0
  const busyB = ctx.busyBarberIds?.has(b.id) ? 1 : 0
  if (busyA !== busyB) return busyA - busyB

  const etaA = ctx.etaOverrides?.get(a.id) ?? computeBarberEtaMinutes(a, ctx.entries, ctx.avgMap, ctx.now)
  const etaB = ctx.etaOverrides?.get(b.id) ?? computeBarberEtaMinutes(b, ctx.entries, ctx.avgMap, ctx.now)
  if (etaA !== etaB) return etaA - etaB

  const countA = ctx.dailyServiceCounts[a.id] || 0
  const countB = ctx.dailyServiceCounts[b.id] || 0
  if (countA !== countB) return countA - countB

  const lastA = ctx.lastCompletedAt[a.id] || ''
  const lastB = ctx.lastCompletedAt[b.id] || ''
  if (lastA !== lastB) return lastA.localeCompare(lastB)

  return a.id.localeCompare(b.id)
}

export function pickBestBarber(candidates: Staff[], ctx: BarberRankingContext): Staff | null {
  if (candidates.length === 0) return null
  let best = candidates[0]
  for (let i = 1; i < candidates.length; i++) {
    if (compareBarbersForDynamic(candidates[i], best, ctx) < 0) {
      best = candidates[i]
    }
  }
  return best
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
  barberAvgMinutes: Record<string, number> = {}
): DynamicQueueEntry[] {
  const result: DynamicQueueEntry[] = []

  const barbersOnBreak = new Set<string>()
  // Barberos atendiendo un corte AHORA (in_progress, no-break): no están
  // libres para un dinámico aunque el ETA naïve dé 0 por corte largo.
  const barbersAttendingNow = new Set<string>()
  // Para cada barbero, la priority_order del descanso pendiente más viejo
  // (si tiene ghost waiting). Si el ghost tiene priority menor que un cliente
  // candidato, ese barbero NO debería recibir ese cliente — su ghost va primero.
  const barberPendingBreakPriority = new Map<string, number>()
  // Para cada barbero, la priority_order del cliente asignado más viejo waiting.
  // Sirve para saber si su ghost ya está "vencido" (sin clientes asignados antes).
  const barberOldestAssignedPriority = new Map<string, number>()
  // Cantidad de breaks encolados (waiting) por barbero. Sumamos `avg` por cada uno
  // al ETA del barbero en `etaOverrides`, así un break encolado en N cortes penaliza
  // la carga aparente del barbero igual que un cliente real.
  const barberPendingBreakCount = new Map<string, number>()
  const unassigned: QueueEntry[] = []

  for (const entry of entries) {
    // Modelo pool (mig 134): un dinámico vive con barber_id = NULL. La
    // pre-asignación visual la decide este cliente localmente (más abajo) y
    // es solo un hint informativo — el claim real en el server es pool FIFO
    // no bloqueante, así que no importa si dos tablets muestran hints
    // distintos (SKIP LOCKED resuelve el empate, ver claim_next_for_barber).
    // Excluimos breaks (is_break=true) — esos son ghosts del propio barbero.
    const isDynamicCandidate =
      entry.status === 'waiting' &&
      !entry.is_break &&
      !entry.barber_id

    if (isDynamicCandidate) {
      unassigned.push(entry)
    } else {
      result.push(entry)
      if (entry.barber_id) {
        if (entry.status === 'in_progress' && entry.is_break) {
          barbersOnBreak.add(entry.barber_id)
        }
        if (entry.status === 'in_progress' && !entry.is_break) {
          barbersAttendingNow.add(entry.barber_id)
        }
        if (entry.status === 'waiting') {
          const ts = new Date(entry.priority_order).getTime()
          if (entry.is_break) {
            const prev = barberPendingBreakPriority.get(entry.barber_id)
            if (prev === undefined || ts < prev) {
              barberPendingBreakPriority.set(entry.barber_id, ts)
            }
            barberPendingBreakCount.set(
              entry.barber_id,
              (barberPendingBreakCount.get(entry.barber_id) ?? 0) + 1
            )
          } else {
            const prev = barberOldestAssignedPriority.get(entry.barber_id)
            if (prev === undefined || ts < prev) {
              barberOldestAssignedPriority.set(entry.barber_id, ts)
            }
          }
        }
      }
    }
  }

  // Barberos cuyo descanso pendiente debería arrancar antes de tomar dinámicos:
  // tienen ghost waiting y NO tienen clientes asignados específicamente con
  // priority menor. Si no hay nada que los "tape", el ghost es lo siguiente.
  const barbersWithBreakReady = new Set<string>()
  for (const [barberId, breakTs] of barberPendingBreakPriority) {
    const oldestAssigned = barberOldestAssignedPriority.get(barberId)
    if (oldestAssigned === undefined || oldestAssigned >= breakTs) {
      barbersWithBreakReady.add(barberId)
    }
  }

  // ETA inicial por barbero según las entries reales (sin las pre-asignaciones
  // que vamos a hacer). Cada vez que pre-asignamos un dinámico, sumamos `avg` al ETA
  // del elegido para que el siguiente unassigned vea la carga incrementada.
  // Los breaks encolados (waiting) suman `avg` por cada uno para que un barbero con
  // descanso pendiente no se vea más libre que sus pares.
  const etaOverrides = new Map<string, number>()
  for (const b of barbers) {
    const baseEta = computeBarberEtaMinutes(b, entries, barberAvgMinutes, currentTime)
    const avg = barberAvgMinutes[b.id] ?? barberAvgMinutes.__fallback ?? 25
    const breakPenalty = (barberPendingBreakCount.get(b.id) ?? 0) * avg
    etaOverrides.set(b.id, baseEta + breakPenalty)
  }

  // "Ocupados" mutable: arranca con los que atienden ahora y crece a medida
  // que pre-asignamos dinámicos en esta pasada (así dos dinámicos no caen
  // sobre el mismo barbero libre).
  const busyBarberIds = new Set<string>(barbersAttendingNow)

  unassigned.sort((a, b) => a.position - b.position)

  for (const u of unassigned) {
    const eligibleBarbers = barbers.filter(b =>
      !b.hidden_from_checkin &&
      !isBarberBlockedByShiftEnd(b, result, schedules, currentTime, marginMinutes) &&
      !notClockedInIds.has(b.id) &&
      !barbersOnBreak.has(b.id) &&
      !barbersWithBreakReady.has(b.id)
    )

    // Sin barberos elegibles (sin fichaje, ocultos, bloqueados por fin de turno, etc.),
    // el cliente queda sin pre-asignación. Antes se hacía fallback a *todos*, lo que
    // ignoraba el clock-in y mostraba pre-asignaciones incorrectas.
    if (eligibleBarbers.length === 0) {
      result.push(u)
      continue
    }

    const ctx: BarberRankingContext = {
      entries,
      avgMap: barberAvgMinutes,
      now: currentTime,
      dailyServiceCounts,
      lastCompletedAt,
      etaOverrides,
      busyBarberIds,
    }

    const selectedBarber = pickBestBarber(eligibleBarbers, ctx)
    if (!selectedBarber) {
      result.push(u)
      continue
    }

    result.push({
      ...u,
      barber_id: selectedBarber.id,
      barber: selectedBarber,
      _is_dynamically_assigned: true
    })

    const avg = barberAvgMinutes[selectedBarber.id] ?? barberAvgMinutes.__fallback ?? 25
    etaOverrides.set(selectedBarber.id, (etaOverrides.get(selectedBarber.id) ?? 0) + avg)
    // El barbero recién pre-asignado deja de estar "libre" para el próximo dinámico.
    busyBarberIds.add(selectedBarber.id)
  }

  // Orden por position para que un dinámico con turno más temprano siempre aparezca
  // antes que un asignado de turno posterior, sin importar el orden de pre-asignación.
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
