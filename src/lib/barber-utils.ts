import type { Staff, QueueEntry, Visit, StaffSchedule } from '@/lib/types/database'
type VisitAvgInput = Pick<Visit, 'barber_id' | 'started_at' | 'completed_at'> & {
  paused_duration_seconds?: number | null
}

export function buildBarberAvgMinutes(
  visits: VisitAvgInput[],
  fallback: number
): Record<string, number> {
  const groups: Record<string, number[]> = {}

  for (const v of visits) {
    if (!v.started_at || !v.completed_at) continue
    if (!v.barber_id) continue
    // FIX sm-4: descontar el tiempo pausado para que el promedio refleje minutos
    // efectivos de corte (un corte pausado 20min no debe inflar el ETA del barbero).
    const pausedMin = Math.max(0, (v.paused_duration_seconds ?? 0) / 60)
    const mins =
      (new Date(v.completed_at).getTime() - new Date(v.started_at).getTime()) /
      60_000 - pausedMin
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

// Forma mínima de barbero que el contador canónico necesita. TV trae un subset
// (sin role/hidden_from_checkin/is_also_barber); por eso son opcionales y se
// asume el default permisivo cuando faltan (ver countActiveDynamicCapableBarbers).
export interface DynamicCapableBarber {
  id: string
  is_active: boolean
  role?: string
  is_also_barber?: boolean
  hidden_from_checkin?: boolean
}

// ────────────────────────────────────────────────────────────────
// FIX #5: contador CANÓNICO de barberos con capacidad para tomar dinámicos.
// Único divisor de la estimación de espera en TODO el front. Espeja el criterio
// de `get_client_queue_position` (DB). Criterio:
//   is_active && (role==='barber' || is_also_barber) && !hidden_from_checkin
//   && fichado (clock-in) && !on_break (ghost break in_progress)
//   && !blocked_by_shift_end && walkin_mode != 'appointments_only'
//
// Notas de fidelidad:
//  - `role`/`is_also_barber`: si el barbero viene sin `role` (caso TV, que no lo
//    selecciona) se ASUME barbero (la query ya filtró role.eq.barber ||
//    is_also_barber.eq.true). Cuando `role` está presente, exigimos
//    role==='barber' O is_also_barber===true.
//  - `walkin_mode`: HOY no se carga en el front (vive en appointment_staff). El
//    parámetro `appointmentsOnlyIds` permite inyectarlo cuando se cargue; mientras
//    esté vacío, el criterio es no-op. La DB (RPC) sí lo excluye; mobile puede dar
//    un número levemente distinto de TV/kiosk hasta que se cargue acá (aceptado).
// ────────────────────────────────────────────────────────────────
export function countActiveDynamicCapableBarbers(
  barbers: DynamicCapableBarber[],
  entries: QueueEntry[],
  schedules: StaffSchedule[],
  notClockedInIds: Set<string>,
  now: number,
  options?: {
    marginMinutes?: number
    appointmentsOnlyIds?: Set<string>
  }
): number {
  const margin = options?.marginMinutes ?? 35
  const appointmentsOnly = options?.appointmentsOnlyIds ?? new Set<string>()
  const onBreak = getBarbersOnBreakIds(entries)

  return barbers.filter((b) => {
    if (!b.is_active) return false
    // Capacidad de corte: barbero por rol, o staff marcado como también-barbero.
    // Estricto sólo si `role` está presente (TV no lo trae → se asume barbero).
    if (b.role !== undefined && b.role !== 'barber' && b.is_also_barber !== true) return false
    if (b.hidden_from_checkin === true) return false
    if (notClockedInIds.has(b.id)) return false
    if (onBreak.has(b.id)) return false
    if (appointmentsOnly.has(b.id)) return false
    // isBarberBlockedByShiftEnd espera un Staff; sólo usa b.id contra schedules.
    if (isBarberBlockedByShiftEnd(b as unknown as Staff, entries, schedules, now, margin)) return false
    return true
  }).length
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
  // Sólo viene para un cliente que aceptó Menor espera por WhatsApp (mig 218):
  // los barberos con actividad en la última hora. Ver el criterio 0b.
  recentlyActiveIds?: Set<string>
}

// Orden de prioridad (todos ASC):
//   0. Disponible AHORA (idle=0) antes que ocupado (1). Señal objetiva y
//      estable entre tablets. Sin esto, un corte largo hace
//      ETA=max(0,avg-elapsed)=0 y un barbero ocupado hace 29min "empata" a
//      uno libre y le gana por el desempate de cortes — el dinámico figuraba
//      "con" el ocupado habiendo uno realmente libre (bug prod 2026-05-16).
//  0b. SÓLO si viene `recentlyActiveIds` (cliente pasado a Menor espera por
//      WhatsApp): con actividad en la última hora antes que sin ella.
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

  // 0b. Al cliente que aceptó Menor espera por WhatsApp se le prometió "hay un
  // barbero libre", y el tick de la mig 218 sólo cuenta como libre al que tuvo
  // actividad en la última hora. Entre dos igual de libres, el desempate de
  // abajo (MENOS cortes hoy) favorece justo al que se fue a almorzar fichado:
  // el hint caería en una "Mi fila" que nadie mira. Va DESPUÉS del criterio 0
  // para no preferir nunca a uno ocupado sobre uno libre.
  if (ctx.recentlyActiveIds) {
    const sinActividadA = ctx.recentlyActiveIds.has(a.id) ? 0 : 1
    const sinActividadB = ctx.recentlyActiveIds.has(b.id) ? 0 : 1
    if (sinActividadA !== sinActividadB) return sinActividadA - sinActividadB
  }

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

// ────────────────────────────────────────────────────────────────
// Menor espera por WhatsApp (mig 218)
//
// A quien espera a un barbero puntual hace más de N minutos se le ofrece por
// WhatsApp pasarse a Menor espera cuando hay otro barbero libre. Si acepta,
// `menor_espera_responder` hace la transición de siempre (barber_id NULL +
// is_dynamic) SIN tocar `priority_order`, y anota a quién esperaba en
// `menor_espera_barbero_original_id`. La plantilla le promete "conservás tu
// lugar": para el motor ya es literal (su barbero lo sigue pudiendo tomar desde
// el pool, en el mismo lugar del FIFO) y estas funciones lo hacen literal en la
// pantalla.
//
// Las columnas pueden no existir todavía (la 218 se aplica fuera de horario):
// por eso las comparaciones son `=== true` / `!= null` y nunca rompen.
// ────────────────────────────────────────────────────────────────

/** Ventana de "actividad reciente": la misma hora que mira el tick de la 218. */
const VENTANA_ACTIVIDAD_MS = 60 * 60 * 1000

/**
 * La entrada aceptó Menor espera por WhatsApp y SIGUE esperando en el pool.
 *
 * Se mira `is_dynamic` y no `barber_id`: en la salida de `assignDynamicBarbers`
 * el barber_id de un dinámico es el del hint. Si la recepción después la asigna
 * a un barbero, `is_dynamic` vuelve a false (todos los caminos escriben
 * `is_dynamic: !barberId`) y deja de contar. Desde la mig 222 esa asignación
 * además borra `dynamic_via_whatsapp_at` y `menor_espera_barbero_original_id`
 * (trigger trg_queue_entry_menor_espera_marca, ver `aceptacionesWhatsAppNuevas`):
 * si después vuelve al pool, vuelve sin marca y tampoco cuenta. La medición vive
 * en fila_ofertas_menor_espera, no en esta marca.
 */
export function esMovidaPorWhatsApp(entry: QueueEntry): boolean {
  return (
    entry.status === 'waiting' &&
    !entry.is_break &&
    entry.is_dynamic === true &&
    entry.dynamic_via_whatsapp_at != null
  )
}

/** ...y el barbero que esperaba era `staffId`. */
export function esMovidaPorWhatsAppDe(entry: QueueEntry, staffId: string): boolean {
  return esMovidaPorWhatsApp(entry) && entry.menor_espera_barbero_original_id === staffId
}

/** Orden de atención de una fila: `priority_order` (FIFO real) y `position` desempata. */
export function compararOrdenDeFila(a: QueueEntry, b: QueueEntry): number {
  const pa = new Date(a.priority_order).getTime()
  const pb = new Date(b.priority_order).getTime()
  if (pa !== pb) return pa - pb
  return a.position - b.position
}

/**
 * «Mi fila» de un barbero: lo que tiene esperando, en el orden en que lo va a
 * atender. Se arma sobre la salida de `assignDynamicBarbers` y son tres cosas:
 *
 *  1. sus clientes puntuales y sus descansos encolados (barber_id = él);
 *  2. los dinámicos que el hint le sugirió a él;
 *  3. los que lo esperaban a ÉL y aceptaron por WhatsApp pasarse a Menor espera,
 *     aunque el hint los haya puesto en la fila de otro. Van en su lugar por
 *     `priority_order`: "conservás tu lugar" es literal también acá. El primer
 *     "Atender" gana: `claim_next_for_barber` acepta la entrada preferida porque
 *     su barber_id es NULL, y SKIP LOCKED resuelve el empate.
 *
 * Es un filtro sobre una lista que trae cada entrada una sola vez, así que una
 * misma entrada no puede aparecer dos veces en la misma "Mi fila" (el caso 2 y
 * el 3 se pisan cuando el hint cae en el propio barbero original).
 */
export function armarMiFila<T extends QueueEntry>(dynamicEntries: T[], staffId: string): T[] {
  return dynamicEntries
    .filter(
      (e) =>
        e.status === 'waiting' &&
        (e.barber_id === staffId || esMovidaPorWhatsAppDe(e, staffId))
    )
    // Orden cronológico estricto por priority_order. NO se empujan los breaks
    // al final: un break con cuts_before_break=0 tiene priority_order menor que
    // los clientes que llegaron después y debe verse PRIMERO.
    .sort(compararOrdenDeFila)
}

/**
 * Marca de aceptación (`dynamic_via_whatsapp_at`) de cada entrada de una lectura
 * de la fila. Es lo que el panel guarda para comparar con la lectura siguiente.
 */
export function marcasDeAceptacionWhatsApp(entries: QueueEntry[]): Map<string, string | null> {
  const marcas = new Map<string, string | null>()
  for (const e of entries) marcas.set(e.id, e.dynamic_via_whatsapp_at ?? null)
  return marcas
}

/**
 * Clientes que esperaban a `staffId` y aceptaron Menor espera por WhatsApp ENTRE
 * dos lecturas de la fila: el panel se lo avisa a ese barbero sin consultar nada
 * nuevo. Sólo cuenta lo que se vio pasar: una entrada que la lectura anterior no
 * tenía (recién abierto el panel, o un cliente nuevo) no avisa, porque sería
 * ruido sobre algo que ya pasó.
 *
 * Se compara la MARCA (`dynamic_via_whatsapp_at`) y no el estado: lo que se
 * anuncia es una aceptación nueva, no una entrada que reaparece en el pool.
 * Desde la mig 222 la marca no sobrevive a una reasignación: el trigger
 * trg_queue_entry_menor_espera_marca (BEFORE UPDATE OF barber_id) pone en NULL
 * `dynamic_via_whatsapp_at` y `menor_espera_barbero_original_id` cuando a una
 * entrada que sigue `waiting` se le asigna un barbero concreto (cualquiera,
 * también el que esperaba: en el pool su barber_id es NULL). Si después vuelve
 * al pool por otro camino (kiosko, arrastre a Dinámicos, barbero desactivado),
 * vuelve sin marca: ni reaparece en la «Mi fila» del que esperaba ni se vuelve
 * a anunciar; sólo otra oferta aceptada trae una marca nueva y avisa. Atenderla
 * no la borra: claim_next_for_barber la pasa a in_progress y el trigger mira
 * sólo entradas que siguen esperando.
 */
export function aceptacionesWhatsAppNuevas<T extends QueueEntry>(
  previas: Map<string, string | null>,
  entries: T[],
  staffId: string
): T[] {
  return entries.filter(
    (e) =>
      esMovidaPorWhatsAppDe(e, staffId) &&
      previas.has(e.id) &&
      previas.get(e.id) !== (e.dynamic_via_whatsapp_at ?? null)
  )
}

// ────────────────────────────────────────────────────────────────
// Asesoría sin costo (mig 217): aviso de llegada DERIVADO
//
// El cliente que no sabe qué hacerse pide asesoría en la tablet de entrada
// (`pidio_asesoria`). El panel se lo avisa al barbero comparando cada lectura de
// la fila con la anterior, igual que el aviso de Menor espera por WhatsApp: ni
// escrituras ni consultas nuevas (Known Risks #9/#10), porque el panel ya
// re-lee la fila en cada evento de Realtime.
//
// "Nueva" se decide con relojes del SERVIDOR, nunca con el de la tablet: la
// primera lectura EXITOSA siembra lo visto y fija la última llegada
// (`checked_in_at`, que pone la base). Después avisan:
//   · 'llego'      → una entrada que no estaba y llegó después de esa marca;
//   · 'sumada'     → una que esperaba sin asesoría y la pidió desde «Mi turno»;
//   · 'reasignada' → una que pasa a ser MÍA en la base (barber_id real), no por
//                    el hint de Menor espera, que cambia de tablet en tablet.
//
// Lo visto sobrevive al desmontaje (hallazgo asesoria-03): el panel lo guarda en
// sessionStorage, por sucursal y barbero (`serializarVistaAsesoria` /
// `leerVistaAsesoria`). Antes cada montaje volvía a sembrar, y lo que llegaba o
// se sumaba mientras el barbero estaba en Caja, Historial o Metas no se
// anunciaba nunca. Lo que ya se anunció no se repite; una vista vieja (más que
// la vigencia que pide el panel) o ilegible vuelve a sembrar.
// ────────────────────────────────────────────────────────────────

/** Lo que el panel recuerda de cada entrada entre dos lecturas de la fila. */
export interface MarcaAsesoria {
  /** `pidio_asesoria` en esa lectura. */
  pidio: boolean
  /** `barber_id` REAL de la base (no el hint de `assignDynamicBarbers`). */
  barbero: string | null
}

/** Las marcas de una lectura de la fila (las filas crudas de la base, no la salida de `assignDynamicBarbers`). */
export function marcasDeAsesoria(entries: QueueEntry[]): Map<string, MarcaAsesoria> {
  const marcas = new Map<string, MarcaAsesoria>()
  for (const e of entries) {
    marcas.set(e.id, { pidio: e.pidio_asesoria === true, barbero: e.barber_id ?? null })
  }
  return marcas
}

/**
 * La llegada más nueva de una lectura (ms de `checked_in_at`, reloj del
 * SERVIDOR). -Infinity si la fila estaba vacía: entonces todo lo que aparezca
 * después es nuevo.
 */
export function ultimaLlegadaVista(entries: QueueEntry[]): number {
  let ultima = -Infinity
  for (const e of entries) {
    const t = Date.parse(e.checked_in_at)
    if (Number.isFinite(t) && t > ultima) ultima = t
  }
  return ultima
}

/**
 * Lo que el panel recuerda de la fila para los avisos de asesoría: las marcas
 * de la última lectura y la última llegada de la PRIMERA (fija).
 */
export interface VistaAsesoria {
  marcas: Map<string, MarcaAsesoria>
  /** `ultimaLlegadaVista` de la primera lectura. -Infinity si la fila estaba vacía. */
  ultimaLlegada: number
}

/** Versión del formato guardado: otro valor se descarta y se vuelve a sembrar. */
const VERSION_VISTA_ASESORIA = 1
/** Tope de marcas que se aceptan al leer: una fila real no tiene ni cerca de esto. */
const MAX_MARCAS_VISTA_ASESORIA = 500

/**
 * La vista, como texto para sessionStorage. `ahora` es el reloj de ESTA tablet:
 * sólo se compara contra sí mismo (al leer), así que un reloj corrido no importa.
 * `ultimaLlegada` -Infinity viaja como null (JSON no tiene infinitos).
 */
export function serializarVistaAsesoria(vista: VistaAsesoria, ahora: number): string {
  return JSON.stringify({
    v: VERSION_VISTA_ASESORIA,
    en: ahora,
    u: Number.isFinite(vista.ultimaLlegada) ? vista.ultimaLlegada : null,
    m: [...vista.marcas].map(([id, marca]) => [id, marca.pidio ? 1 : 0, marca.barbero]),
  })
}

/**
 * La vista guardada por `serializarVistaAsesoria`, si es legible y tiene menos
 * de `vigenciaMs`. null en cualquier otro caso (no hay, está rota, es de otra
 * versión, es vieja o el reloj volvió para atrás): el panel vuelve a sembrar,
 * que es lo que hacía siempre. Nunca lanza.
 */
export function leerVistaAsesoria(texto: string | null, ahora: number, vigenciaMs: number): VistaAsesoria | null {
  if (!texto) return null
  let crudo: unknown
  try {
    crudo = JSON.parse(texto)
  } catch {
    return null
  }
  if (!crudo || typeof crudo !== 'object') return null
  const { v, en, u, m } = crudo as { v?: unknown; en?: unknown; u?: unknown; m?: unknown }
  if (v !== VERSION_VISTA_ASESORIA) return null
  if (typeof en !== 'number' || !Number.isFinite(en)) return null
  const edad = ahora - en
  if (!(edad >= 0 && edad <= vigenciaMs)) return null
  if (u !== null && (typeof u !== 'number' || !Number.isFinite(u))) return null
  if (!Array.isArray(m) || m.length > MAX_MARCAS_VISTA_ASESORIA) return null

  const marcas = new Map<string, MarcaAsesoria>()
  for (const fila of m) {
    if (!Array.isArray(fila) || fila.length !== 3) return null
    const [id, pidio, barbero] = fila as unknown[]
    if (typeof id !== 'string' || !id) return null
    if (pidio !== 0 && pidio !== 1) return null
    if (barbero !== null && typeof barbero !== 'string') return null
    marcas.set(id, { pidio: pidio === 1, barbero })
  }
  return { marcas, ultimaLlegada: u === null ? -Infinity : u }
}

export type MotivoAvisoAsesoria = 'llego' | 'sumada' | 'reasignada'

/**
 * · `mi_fila`: está en «Mi fila» de este barbero (eligió a este barbero, o es
 *   de Menor espera y el hint se lo sugiere a él): aviso completo, con su lugar.
 * · `menor_espera`: es de Menor espera (barber_id NULL en la base) y el hint de
 *   ESTA tablet lo puso en la fila de otro, pero este barbero está fichado y
 *   visible: aviso liviano, lo atiende el primero que se libere. No depende del
 *   hint a propósito (hallazgo asesoria-03): cada tablet lo calcula con su reloj
 *   y su momento de carga, y con hints que no coinciden el pedido podía no
 *   aparecer en la «Mi fila» de nadie y no avisarle a ningún barbero.
 */
export type AlcanceAvisoAsesoria = 'mi_fila' | 'menor_espera'

export interface AvisoAsesoria<T extends QueueEntry = QueueEntry> {
  entrada: T
  motivo: MotivoAvisoAsesoria
  alcance: AlcanceAvisoAsesoria
  /** Lugar entre los CLIENTES de «Mi fila» (1 = el próximo; los descansos no cuentan). null con `menor_espera`. */
  posicion: number | null
}

export interface ContextoAvisosAsesoria {
  staffId: string
  /** «Mi fila» de este barbero (`armarMiFila` sobre la salida de `assignDynamicBarbers`). */
  miFila: QueueEntry[]
  /**
   * Fichado y visible en la tablet: recibe el aviso liviano de los pedidos del
   * pool que no están en su «Mi fila». Esté libre o cortando: el panel decide
   * el sonido (cortando o en descanso, en silencio).
   */
  recibeMenorEspera: boolean
  /** `ultimaLlegadaVista` de la PRIMERA lectura exitosa del panel. Fija, no se corre. */
  ultimaLlegadaInicial: number
}

/**
 * Pedidos de asesoría que este barbero tiene que enterarse ENTRE dos lecturas
 * de la fila (`previas` = `marcasDeAsesoria` de la anterior; `entries` = las
 * filas crudas de la nueva). Sólo clientes que esperan: a uno en curso ya lo
 * está atendiendo alguien (el pop-up de inicio se ocupa de él).
 *
 * Una entrada que no estaba en la lectura anterior pero llegó ANTES de la
 * primera lectura del panel no avisa: ya estaba en el local cuando se abrió.
 */
export function asesoriasNuevas<T extends QueueEntry>(
  previas: Map<string, MarcaAsesoria>,
  entries: T[],
  ctx: ContextoAvisosAsesoria
): AvisoAsesoria<T>[] {
  const clientesDeMiFila = ctx.miFila.filter((e) => !e.is_break)
  const avisos: AvisoAsesoria<T>[] = []

  for (const e of entries) {
    if (e.status !== 'waiting' || e.is_break || e.pidio_asesoria !== true) continue

    const previa = previas.get(e.id)
    let motivo: MotivoAvisoAsesoria | null = null
    if (!previa) {
      const llegada = Date.parse(e.checked_in_at)
      if (Number.isFinite(llegada) && llegada > ctx.ultimaLlegadaInicial) motivo = 'llego'
    } else if (!previa.pidio) {
      motivo = 'sumada'
    } else if (previa.barbero !== ctx.staffId && e.barber_id === ctx.staffId) {
      motivo = 'reasignada'
    }
    if (!motivo) continue

    const indice = clientesDeMiFila.findIndex((m) => m.id === e.id)
    if (indice >= 0) {
      avisos.push({ entrada: e, motivo, alcance: 'mi_fila', posicion: indice + 1 })
    } else if (!e.barber_id && ctx.recibeMenorEspera) {
      // Pool de Menor espera (barber_id NULL en la base) que el hint de esta
      // tablet le dio a otro: a este barbero también le puede tocar, y si los
      // hints de las tablets no coinciden, éste es el único aviso que sale.
      avisos.push({ entrada: e, motivo, alcance: 'menor_espera', posicion: null })
    }
  }
  return avisos
}

function dentroDeLaUltimaHora(iso: string | undefined, ahora: number): boolean {
  if (!iso) return false
  const t = Date.parse(iso)
  return Number.isFinite(t) && t >= ahora - VENTANA_ACTIVIDAD_MS
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
  barberAvgMinutes: Record<string, number> = {},
  // Último clock_in de hoy por barbero (ISO). Opcional: sólo afina el hint de
  // quien aceptó Menor espera por WhatsApp (criterio 0b). Sin él se usa sólo
  // `lastCompletedAt`.
  lastClockInAt: Record<string, string> = {}
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

  // Barberos "con actividad en la última hora" (mig 218): un corte cerrado, un
  // fichaje o un corte en curso. Sólo lo usa el criterio 0b, y sólo para quien
  // aceptó Menor espera por WhatsApp: para todos los demás el hint no cambia.
  const conActividadReciente = new Set<string>()
  for (const b of barbers) {
    if (
      barbersAttendingNow.has(b.id) ||
      dentroDeLaUltimaHora(lastCompletedAt[b.id], currentTime) ||
      dentroDeLaUltimaHora(lastClockInAt[b.id], currentTime)
    ) {
      conActividadReciente.add(b.id)
    }
  }

  unassigned.sort((a, b) => {
    // FIX #11: ordenar por priority_order (FIFO real); position es inestable
    // (se recicla al vaciarse la cola), sólo desempata.
    const pa = new Date(a.priority_order).getTime()
    const pb = new Date(b.priority_order).getTime()
    if (pa !== pb) return pa - pb
    return a.position - b.position
  })

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
      recentlyActiveIds: esMovidaPorWhatsApp(u) ? conActividadReciente : undefined,
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

  // FIX #11: orden por priority_order (fuente FIFO real) para que un dinámico con
  // turno más temprano aparezca antes; position sólo desempata (se recicla al
  // vaciarse la cola, así que no es un ordinal estable).
  return result.sort((a, b) => {
    const pa = new Date(a.priority_order).getTime()
    const pb = new Date(b.priority_order).getTime()
    if (pa !== pb) return pa - pb
    return a.position - b.position
  })
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
    // FIX #4: el corte que mi barbero atiende AHORA cuenta como +1 adelante (antes
    // daba "Sos el siguiente" con alguien físicamente en la silla). Espeja v_self_busy
    // de get_client_queue_position (DB).
    const myBarberBusy = entries.some(
      e => e.barber_id === myEntry.barber_id && e.status === 'in_progress' && !e.is_break
    ) ? 1 : 0
    effectiveAhead = specificsAhead + myBarberBusy + Math.ceil(dynamicsAhead / barbers)
  }

  if (effectiveAhead === 0) return { ahead: 0, label: 'Sos el siguiente' }
  if (effectiveAhead === 1) return { ahead: 1, label: 'Aprox. 1 persona antes' }
  return { ahead: effectiveAhead, label: `Aprox. ${effectiveAhead} personas antes` }
}
