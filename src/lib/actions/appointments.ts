'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getCurrentOrgId } from './org'
import { assertBranchAccess, getAllowedBranchIds, filterBranchesByAccess } from './branch-access'
import { RateLimits, rateLimit } from '@/lib/rate-limit'
import { absoluteUrl } from '@/lib/app-url'
import { isValidUUID } from '@/lib/validation'
import { getLocalNow, getLocalDateStr, getTzOffsetISO } from '@/lib/time-utils'
import { intersectarRangos, type Rango } from '@/lib/franjas'
import { componentesDe, variablesDelBody, indiceBotonUrl } from '@/lib/whatsapp-template-shape'
import { currentUserCan } from './permissions-gate'
import type { Appointment, AppointmentSettings, AppointmentStaff, AppointmentStatus, AppointmentPaymentMethod } from '@/lib/types/database'

// ─── Tipos de filas de relaciones inline ──────────────────────────────
// Usadas para evitar `any` cuando Supabase devuelve relaciones embebidas.
interface StaffRel {
  id: string
  full_name: string
  branch_id: string | null
  is_active: boolean
  avatar_url: string | null
}
interface AppointmentStaffWithStaff {
  staff_id: string
  walkin_mode?: string | null
  staff: StaffRel | null
}

// ─── Settings ───────────────────────────────────────────────────────

/**
 * Retorna los settings efectivos para una sucursal: override por branch si
 * existe, sino default de la org. Llamar con branchId=null devuelve el default.
 */
export async function getAppointmentSettings(
  orgId?: string,
  branchId?: string | null
) {
  const resolvedOrgId = orgId || await getCurrentOrgId()
  if (!resolvedOrgId) return null

  const supabase = createAdminClient()

  if (branchId) {
    const { data: override } = await supabase
      .from('appointment_settings')
      .select('*')
      .eq('organization_id', resolvedOrgId)
      .eq('branch_id', branchId)
      .maybeSingle()
    if (override) return override as AppointmentSettings
  }

  const { data } = await supabase
    .from('appointment_settings')
    .select('*')
    .eq('organization_id', resolvedOrgId)
    .is('branch_id', null)
    .maybeSingle()

  return data as AppointmentSettings | null
}

export async function updateAppointmentSettings(
  updates: Partial<AppointmentSettings>,
  branchId?: string | null
) {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Organización no encontrada' }

  // El permiso se chequea también acá, no sólo en la página: una server action
  // es un endpoint público y el gate de la UI no protege nada por sí solo.
  if (!(await currentUserCan('appointments.configure'))) {
    return { error: 'No tenés permiso para configurar turnos' }
  }

  if (branchId) {
    const access = await assertBranchAccess(branchId)
    if (!access.ok) return { error: 'Sin acceso a esta sucursal' }
  }

  const supabase = createAdminClient()

  const existingQuery = supabase
    .from('appointment_settings')
    .select('id')
    .eq('organization_id', orgId)

  const { data: existing } = branchId
    ? await existingQuery.eq('branch_id', branchId).maybeSingle()
    : await existingQuery.is('branch_id', null).maybeSingle()

  const updatesRaw = updates as Record<string, unknown>
  const safeUpdates: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(updatesRaw)) {
    if (k === 'organization_id' || k === 'id' || k === 'created_at' || k === 'updated_at' || k === 'branch_id') continue
    safeUpdates[k] = v
  }

  if (existing) {
    const { error } = await supabase
      .from('appointment_settings')
      .update(safeUpdates)
      .eq('id', existing.id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase
      .from('appointment_settings')
      .insert({ ...safeUpdates, organization_id: orgId, branch_id: branchId ?? null })
    if (error) return { error: error.message }
  }

  revalidatePath('/dashboard/configuracion')
  revalidatePath('/dashboard/turnos/configuracion')
  revalidatePath('/dashboard/turnos/personalizacion')
  return { success: true }
}

// ─── Appointment Staff ──────────────────────────────────────────────

export async function getAppointmentStaff(orgId?: string) {
  const resolvedOrgId = orgId || await getCurrentOrgId()
  if (!resolvedOrgId) return []

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('appointment_staff')
    .select('*, staff:staff_id(id, full_name, branch_id, is_active, avatar_url)')
    .eq('organization_id', resolvedOrgId)
    .eq('is_active', true)

  const rows = (data ?? []) as (AppointmentStaff & { staff: { id: string; full_name: string; branch_id: string; is_active: boolean; avatar_url: string | null } })[]

  // Aplicar scope de sucursal (si el usuario está limitado)
  const allowed = await getAllowedBranchIds()
  if (allowed === null) return rows
  return rows.filter(r => !r.staff?.branch_id || allowed.includes(r.staff.branch_id))
}

export async function toggleAppointmentStaff(staffId: string, isActive: boolean) {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Organización no encontrada' }

  const supabase = createAdminClient()

  // Verificar scope: el staff debe pertenecer a una sucursal accesible
  const { data: staff } = await supabase
    .from('staff')
    .select('branch_id, organization_id')
    .eq('id', staffId)
    .maybeSingle()

  if (!staff || staff.organization_id !== orgId) {
    return { error: 'Staff no encontrado' }
  }

  if (staff.branch_id) {
    const access = await assertBranchAccess(staff.branch_id)
    if (!access.ok) return { error: 'Sin acceso a la sucursal de este staff' }
  }

  const { data: existing } = await supabase
    .from('appointment_staff')
    .select('id')
    .eq('staff_id', staffId)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('appointment_staff')
      .update({ is_active: isActive })
      .eq('id', existing.id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase
      .from('appointment_staff')
      .insert({ organization_id: orgId, staff_id: staffId, is_active: isActive })
    if (error) return { error: error.message }
  }

  revalidatePath('/dashboard/configuracion')
  revalidatePath('/dashboard/turnos/configuracion')
  return { success: true }
}

export async function updateAppointmentStaffWalkinMode(
  staffId: string,
  walkinMode: 'both' | 'appointments_only'
) {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Organización no encontrada' }

  const supabase = createAdminClient()

  const { data: existing } = await supabase
    .from('appointment_staff')
    .select('id, organization_id')
    .eq('staff_id', staffId)
    .maybeSingle()

  if (!existing || existing.organization_id !== orgId) {
    return { error: 'Staff no habilitado para turnos en esta organización' }
  }

  // Verificar scope via branch del staff
  const { data: staff } = await supabase
    .from('staff')
    .select('branch_id')
    .eq('id', staffId)
    .maybeSingle()

  if (staff?.branch_id) {
    const access = await assertBranchAccess(staff.branch_id)
    if (!access.ok) return { error: 'Sin acceso a la sucursal de este staff' }
  }

  const { error } = await supabase
    .from('appointment_staff')
    .update({ walkin_mode: walkinMode })
    .eq('id', existing.id)

  if (error) return { error: error.message }

  revalidatePath('/dashboard/turnos/configuracion')
  return { success: true }
}

// ─── Availability Engine ────────────────────────────────────────────

export interface AvailableSlot {
  time: string
  available: boolean
}

export interface BarberAvailability {
  barberId: string
  barberName: string
  /** Para que el turnero pueda mostrar quién atiende sin pedir otro fetch. */
  barberAvatarUrl: string | null
  slots: AvailableSlot[]
}

/**
 * Motor de disponibilidad.
 *
 * `service` acepta uno o varios servicios: cuando el cliente elige "Corte +
 * Barba" la duración a reservar es la SUMA, no la del primero. `durationOverride`
 * gana sobre los servicios y existe para las superficies que ya calcularon el
 * total (wizard de la agenda).
 *
 * La grilla se dibuja cada `slot_interval_minutes` (el snap configurado), pero
 * la ocupación se chequea contra la duración completa. Espaciar la grilla por
 * la duración del servicio —como hacía antes— dejaba huecos invendibles: un
 * servicio de 40' sólo ofrecía 9:00, 9:40, 10:20 y perdía el 9:15 libre.
 */
export async function getAvailableSlots(
  branchId: string,
  date: string,
  service?: string | string[] | null,
  barberId?: string,
  durationOverride?: number,
  options?: {
    /**
     * Turno a ignorar al calcular la ocupación. Lo necesita el reschedule: al
     * revalidar el destino, el propio turno que se está moviendo figura como
     * ocupando su horario y bloqueaba cualquier movimiento que lo solapara
     * (mover 15 minutos, cambiarle la duración, cambiarle el barbero).
     */
    excludeAppointmentId?: string
    /**
     * `lead_time_minutes` es una regla del turnero PÚBLICO ("no reservar con
     * menos de una hora de anticipación"), no del mostrador. Con los 60 minutos
     * de Monaco, aplicarla al arrastre de la agenda hacía imposible el caso más
     * común: son las 15:20, el barbero viene demorado y la recepcionista quiere
     * correr el turno de las 15:00 a las 15:45.
     */
    ignoreLeadTime?: boolean
    /**
     * Clave de rate-limit alternativa a la IP. La API mobile (`/api/mobile/**`)
     * ya autenticó al cliente por JWT y pasa su `auth.uid`: la app corre detrás
     * del CGNAT de las telcos, así que el gate por IP+sucursal (20/min) se
     * agotaba entre clientes que no tienen nada que ver entre sí. Con clave
     * propia el límite es 60/min por usuario. Nada más cambia.
     */
    rateLimitKey?: string
  }
): Promise<{ slots: BarberAvailability[]; error?: string }> {
  // Rate-limit: endpoint público, sin auth (por IP), o por usuario si el
  // caller ya lo identificó (API mobile).
  const gate = options?.rateLimitKey
    ? await rateLimit('public_booking_list', options.rateLimitKey, { limit: 60, window: 60 })
    : await RateLimits.publicBookingList(branchId)
  if (!gate.allowed) {
    return { slots: [], error: 'Demasiadas consultas, esperá un momento' }
  }

  if (!isValidUUID(branchId)) return { slots: [], error: 'Sucursal inválida' }

  const supabase = createAdminClient()

  const { data: branch } = await supabase
    .from('branches')
    .select('organization_id, timezone')
    .eq('id', branchId)
    .eq('is_active', true)
    .single()

  if (!branch) return { slots: [], error: 'Sucursal no encontrada' }

  const settings = await getAppointmentSettings(branch.organization_id, branchId)
  if (!settings?.is_enabled) return { slots: [], error: 'Turnos no habilitados' }

  const tz = branch.timezone || 'America/Argentina/Buenos_Aires'

  const targetDate = new Date(date + 'T12:00:00')
  const dayOfWeek = targetDate.getDay()

  // Franjas horarias del turnero (mig 172). Permiten dar turnos sólo en las
  // horas flojas y con tramos ("martes de 10 a 13 y de 16 a 19"), que es lo que
  // el par único appointment_hours_open/close no podía expresar.
  //
  // Compatibilidad por sucursal, igual que la agenda por día: sin filas manda el
  // modelo viejo (un rango para toda la semana + appointment_days).
  const { data: franjasFilas, error: franjasError } = await supabase
    .from('appointment_hours')
    .select('day_of_week, start_time, end_time')
    .eq('branch_id', branchId)

  if (franjasError) {
    console.error('[getAvailableSlots] franjas del turnero:', franjasError.message)
    return { slots: [], error: 'No pudimos leer la disponibilidad. Reintentá en un momento.' }
  }

  const usaFranjas = (franjasFilas ?? []).length > 0
  const ventanasDelDia = (franjasFilas ?? [])
    .filter(f => f.day_of_week === dayOfWeek)
    .map(f => ({
      inicio: timeToMinutes(f.start_time.slice(0, 5)),
      fin: timeToMinutes(f.end_time.slice(0, 5)),
    }))
    .sort((a, b) => a.inicio - b.inicio)

  if (usaFranjas) {
    if (!ventanasDelDia.length) {
      return { slots: [], error: 'Día no habilitado para turnos' }
    }
  } else if (!settings.appointment_days.includes(dayOfWeek)) {
    return { slots: [], error: 'Día no habilitado para turnos' }
  }

  const maxDate = new Date()
  maxDate.setDate(maxDate.getDate() + settings.max_advance_days)
  if (targetDate > maxDate) {
    return { slots: [], error: 'Fecha fuera del rango permitido' }
  }

  const serviceIds = (Array.isArray(service) ? service : service ? [service] : [])
    .filter(id => isValidUUID(id))

  let serviceDuration = settings.slot_interval_minutes
  if (durationOverride && durationOverride > 0) {
    serviceDuration = durationOverride
  } else if (serviceIds.length) {
    const { data: rows } = await supabase
      .from('services')
      .select('id, duration_minutes')
      .in('id', serviceIds)

    // Suma de duraciones; un servicio sin duración cargada cuenta como un slot.
    const total = serviceIds.reduce((acc, id) => {
      const row = rows?.find(r => r.id === id)
      return acc + (row?.duration_minutes ?? settings.slot_interval_minutes)
    }, 0)
    if (total > 0) serviceDuration = total
  }

  // Staff habilitado para turnos en esta sucursal
  const { data: appointmentStaff } = await supabase
    .from('appointment_staff')
    .select('staff_id, walkin_mode, staff:staff_id(id, full_name, branch_id, is_active, avatar_url)')
    .eq('organization_id', branch.organization_id)
    .eq('is_active', true)

  if (!appointmentStaff?.length) return { slots: [] }

  const branchStaff = (appointmentStaff as unknown as AppointmentStaffWithStaff[]).filter(
    (as) => as.staff?.branch_id === branchId && as.staff?.is_active
  )

  if (barberId) {
    const found = branchStaff.find((s) => s.staff_id === barberId)
    if (!found) return { slots: [], error: 'Barbero no disponible para turnos' }
  }

  // Agenda de turnos POR DÍA (mig 171). Es un eje distinto de la jornada de
  // trabajo: en Monaco los barberos trabajan casi todos los días atendiendo
  // walk-in, pero los turnos rotan (Fabri martes, Simón miércoles, Nico jueves).
  //
  // Si la sucursal tiene aunque sea una fila, manda esta tabla y un día sin
  // nadie asignado no ofrece NADA — que es el punto de una agenda rotativa. Si
  // no tiene ninguna, se conserva el comportamiento anterior (candidatos = los
  // que tengan jornada ese día), así ninguna sucursal cambia sola.
  const { data: diasDeTurnos, error: diasError } = await supabase
    .from('appointment_staff_days')
    .select('staff_id, day_of_week, start_time, end_time')
    .eq('branch_id', branchId)

  if (diasError) {
    console.error('[getAvailableSlots] agenda por día:', diasError.message)
    return { slots: [], error: 'No pudimos leer la disponibilidad. Reintentá en un momento.' }
  }

  const usaAgendaPorDia = (diasDeTurnos ?? []).length > 0

  /**
   * Franjas del día por barbero. Es una LISTA, no un solo rango (mig 182): un
   * barbero puede tomar turnos "de 10 a 13 y de 16 a 19", que es la forma de
   * empujar los turnos a las horas flojas y dejar las pico para el walk-in.
   *
   * La lista vacía tiene un significado propio y distinto de "no está en el
   * Map": el barbero SÍ toma turnos ese día, pero durante toda su jornada
   * normal (fila con start_time/end_time en NULL).
   */
  const franjasDelDia = new Map<string, Rango[]>()

  if (usaAgendaPorDia) {
    for (const d of diasDeTurnos ?? []) {
      if (d.day_of_week !== dayOfWeek) continue
      const previas = franjasDelDia.get(d.staff_id) ?? []
      if (d.start_time && d.end_time) {
        previas.push({ start: d.start_time.slice(0, 5), end: d.end_time.slice(0, 5) })
      }
      franjasDelDia.set(d.staff_id, previas)
    }
  }

  const habilitadosHoy = usaAgendaPorDia
    ? branchStaff.filter((s) => franjasDelDia.has(s.staff_id))
    : branchStaff

  if (barberId && usaAgendaPorDia && !franjasDelDia.has(barberId)) {
    return { slots: [], error: 'Ese barbero no toma turnos ese día' }
  }

  const staffIds = barberId
    ? [barberId]
    : habilitadosHoy.map((s) => s.staff_id)

  if (!staffIds.length) return { slots: [] }

  // Horarios de trabajo para ese día. `branch_id` NULL = aplica a todas las
  // sucursales del staff; con valor, sólo a esa (si no, un barbero con jornada
  // cargada para otra sucursal aparecía disponible acá).
  const { data: schedules, error: schedulesError } = await supabase
    .from('staff_schedules')
    .select('staff_id, start_time, end_time')
    .in('staff_id', staffIds)
    .eq('day_of_week', dayOfWeek)
    .eq('is_active', true)
    .or(`branch_id.is.null,branch_id.eq.${branchId}`)

  // Excepciones (ausencias)
  const { data: exceptions, error: exceptionsError } = await supabase
    .from('staff_schedule_exceptions')
    .select('staff_id')
    .in('staff_id', staffIds)
    .eq('exception_date', date)
    .eq('is_absent', true)

  const absentStaff = new Set(exceptions?.map(e => e.staff_id) ?? [])

  // Turnos existentes para ese día
  let appointmentsQuery = supabase
    .from('appointments')
    .select('barber_id, start_time, end_time')
    .eq('branch_id', branchId)
    .eq('appointment_date', date)
    .not('status', 'in', '("cancelled","no_show")')

  if (options?.excludeAppointmentId && isValidUUID(options.excludeAppointmentId)) {
    appointmentsQuery = appointmentsQuery.neq('id', options.excludeAppointmentId)
  }

  const { data: existingAppointments, error: appointmentsError } = await appointmentsQuery

  // Bloqueos para ese día, acotados en la TZ de la sucursal (sin el offset
  // dinámico, en un server UTC la ventana se corría 3h y traía bloqueos del
  // día equivocado).
  const tzOffset = getTzOffsetISO(new Date(`${date}T12:00:00Z`), tz)
  const dayStart = `${date}T00:00:00${tzOffset}`
  const dayEnd = `${date}T23:59:59${tzOffset}`
  const { data: blocks, error: blocksError } = await supabase
    .from('appointment_blocks')
    .select('branch_id, barber_id, start_at, end_at')
    .eq('organization_id', branch.organization_id)
    .or(`branch_id.is.null,branch_id.eq.${branchId}`)
    .lt('start_at', dayEnd)
    .gt('end_at', dayStart)

  // Fallar CERRADO. Estas cuatro queries son las que determinan la ocupación:
  // si una falla y se ignora el error, `?? []` la convierte en "nadie ocupado"
  // y el motor ofrece como libre toda la agenda. Un timeout de DB (el fetch de
  // createAdminClient corta a los 8s) terminaría en doble booking real.
  const readError = schedulesError || exceptionsError || appointmentsError || blocksError
  if (readError) {
    console.error('[getAvailableSlots] lectura de disponibilidad:', readError.message)
    return { slots: [], error: 'No pudimos leer la disponibilidad. Reintentá en un momento.' }
  }

  // Ventanas del turnero para ese día. Con franjas cargadas la grilla arranca en
  // la primera y termina en la última; sin ellas, el rango único de siempre.
  const ventanas = usaFranjas
    ? ventanasDelDia
    : [{
        inicio: timeToMinutes(settings.appointment_hours_open),
        fin: timeToMinutes(settings.appointment_hours_close),
      }]

  const openMinutes = ventanas[0].inicio
  const closeMinutes = Math.max(...ventanas.map(v => v.fin))
  const buffer = settings.buffer_minutes ?? 0

  // "Ahora" en timezone de la sucursal. getLocalNow devuelve un Date cuyos
  // campos UTC son la hora de pared del TZ pedido, así que se lee con getUTC*.
  const nowInTz = getLocalNow(tz)
  const todayStr = getLocalDateStr(tz)
  const isToday = date === todayStr
  const nowMinutesInTz = nowInTz.getUTCHours() * 60 + nowInTz.getUTCMinutes()
  const earliestBookableMinute = options?.ignoreLeadTime
    ? nowMinutesInTz
    : nowMinutesInTz + (settings.lead_time_minutes ?? 0)

  const result: BarberAvailability[] = []

  for (const staffId of staffIds) {
    if (absentStaff.has(staffId)) continue

    const propias = franjasDelDia.get(staffId) ?? []

    // Ventanas horarias del barbero para ese día. Por defecto son su jornada de
    // trabajo (`staff_schedules`); si la agenda por día le puso franjas
    // explícitas, esas mandan y no hace falta que tenga jornada cargada — un
    // barbero puede tomar turnos en una franja acotada sin que eso sea su
    // horario de fichaje. Pueden ser VARIAS (mig 182): un día cortado.
    const staffSchedules = propias.length
      ? propias.map(f => ({ staff_id: staffId, start_time: f.start, end_time: f.end }))
      : (schedules?.filter(s => s.staff_id === staffId) ?? [])

    if (!staffSchedules.length) continue

    const staffRecord = branchStaff.find((s) => s.staff_id === staffId)
    const staffName = staffRecord?.staff?.full_name ?? ''
    const staffAppointments = existingAppointments?.filter(a => a.barber_id === staffId) ?? []

    // Bloques aplicables a este barbero: de org (branch=null), de sucursal (branch=X, barber=null), o específicos
    const staffBlocks = (blocks ?? []).filter(b => {
      if (b.branch_id === null) return true
      if (b.branch_id === branchId && b.barber_id === null) return true
      if (b.branch_id === branchId && b.barber_id === staffId) return true
      return false
    })

    const slots: AvailableSlot[] = []

    // La grilla avanza cada slot_interval_minutes (el snap real de inicio);
    // el solapamiento se evalúa contra serviceDuration más abajo.
    const slotStep = settings.slot_interval_minutes > 0
      ? settings.slot_interval_minutes
      : 15
    for (let m = openMinutes; m + serviceDuration <= closeMinutes; m += slotStep) {
      const slotStart = minutesToTime(m)
      const slotEnd = minutesToTime(m + serviceDuration)

      // El turno tiene que entrar ENTERO en una franja del turnero: con un
      // horario entrecortado (10–13 / 16–19) un servicio de 45' que arranque
      // 12:45 se pasaría del corte del mediodía.
      const dentroDeVentana = ventanas.some(v => m >= v.inicio && m + serviceDuration <= v.fin)

      const withinSchedule = dentroDeVentana && staffSchedules.some(sch =>
        slotStart >= sch.start_time.substring(0, 5) && slotEnd <= sch.end_time.substring(0, 5)
      )

      if (!withinSchedule) {
        slots.push({ time: slotStart, available: false })
        continue
      }

      // Overlap extendiendo cada turno existente por buffer_minutes a ambos lados
      const overlaps = staffAppointments.some(appt => {
        const apptStart = timeToMinutes(appt.start_time.substring(0, 5)) - buffer
        const apptEnd = timeToMinutes(appt.end_time.substring(0, 5)) + buffer
        return m < apptEnd && (m + serviceDuration) > apptStart
      })

      // Overlap con bloqueos (vacaciones, descansos, feriados). El slot es hora
      // de pared de la sucursal: sin el offset se comparaba contra un instante
      // distinto al que guarda el bloqueo (timestamptz).
      const slotStartMs = new Date(`${date}T${slotStart}:00${tzOffset}`).getTime()
      const slotEndMs = new Date(`${date}T${slotEnd}:00${tzOffset}`).getTime()
      const isBlocked = staffBlocks.some(b => {
        const bStart = new Date(b.start_at).getTime()
        const bEnd = new Date(b.end_at).getTime()
        return slotStartMs < bEnd && slotEndMs > bStart
      })

      // Lead time: si es hoy, no reservar antes de (ahora + lead_time_minutes)
      const tooSoon = isToday && m < earliestBookableMinute

      slots.push({ time: slotStart, available: !overlaps && !isBlocked && !tooSoon })
    }

    result.push({
      barberId: staffId,
      barberName: staffName,
      barberAvatarUrl: staffRecord?.staff?.avatar_url ?? null,
      slots,
    })
  }

  return { slots: result }
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * Instante real del turno.
 *
 * `appointment_date` + `start_time` son hora de PARED de la sucursal. Parsear
 * `new Date('2026-07-29T18:00:00')` los interpreta en la zona del proceso —
 * UTC en Vercel—, así que un turno de las 18:00 en Argentina se leía como las
 * 15:00 reales: la ventana de cancelación se corría 3 horas y el server
 * rechazaba cancelaciones que la UI mostraba como permitidas.
 *
 * También tolera `start_time` en formato 'HH:MM:SS' (lo que devuelve la DB) y
 * 'HH:MM'; concatenar 'HH:MM:SS' + ':00' daba Invalid Date.
 */
function appointmentInstant(
  date: string,
  startTime: string,
  timezone?: string | null
): Date {
  const tz = timezone || 'America/Argentina/Buenos_Aires'
  const hhmmss = startTime.length === 5 ? `${startTime}:00` : startTime.substring(0, 8)
  const offset = getTzOffsetISO(new Date(`${date}T12:00:00Z`), tz)
  return new Date(`${date}T${hhmmss}${offset}`)
}

/** El embed de PostgREST puede venir como objeto o como array de un elemento. */
function unwrapRel<T>(rel: T | T[] | null | undefined): T | null {
  if (!rel) return null
  return Array.isArray(rel) ? (rel[0] ?? null) : rel
}

// ─── Messaging helpers ──────────────────────────────────────────────

/**
 * Resuelve el channel_id de WhatsApp default de la org (si está configurado).
 * Devuelve null si no hay canal — en ese caso los mensajes se omiten
 * silenciosamente (graceful degradation — los turnos siguen funcionando sin WA).
 */
async function resolveOrgWhatsAppChannelId(orgId: string): Promise<string | null> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('social_channels')
    .select('id')
    .eq('organization_id', orgId)
    .eq('platform', 'whatsapp')
    .is('branch_id', null)
    .eq('is_active', true)
    .maybeSingle()
  return data?.id ?? null
}

/**
 * Nombre + idioma REGISTRADO del template en Meta.
 *
 * El idioma no es cosmético: si el template está aprobado como `es` y se envía
 * como `es_AR`, Meta responde 132001 "Template name does not exist in the
 * translation" y el mensaje muere sin reintento. La columna
 * `scheduled_messages.template_language` tiene default `es_AR` y nadie la
 * seteaba, así que TODOS los mensajes de turnos fallaban: los templates
 * `monaco_turno_*` están aprobados como `es`.
 */
interface TemplateInfo {
  name: string
  language: string | null
  /** Mayor índice {{n}} declarado en el BODY. 5 es la forma histórica. */
  bodyVars: number
  /** Índice del botón URL con sufijo dinámico, o null si no tiene. */
  urlButtonIndex: number | null
}

/**
 * Nombre, idioma y FORMA del template registrado en Meta.
 *
 * El idioma no es cosmético: si el template está aprobado como `es` y se envía
 * como `es_AR`, Meta responde 132001 "Template name does not exist in the
 * translation" y el mensaje muere sin reintento. La columna
 * `scheduled_messages.template_language` tiene default `es_AR` y nadie la
 * seteaba, así que TODOS los mensajes de turnos fallaban: los templates
 * `monaco_turno_*` están aprobados como `es`.
 *
 * La FORMA se lee por el mismo motivo, un escalón más arriba: Meta rechaza el
 * envío entero (132000, "number of parameters does not match") si le mandamos
 * una variable de más o de menos. Como los templates los edita el dueño en
 * Business Manager, la cantidad de variables no se puede asumir — se cuenta de
 * los `components` que ya guarda el sync.
 */
async function getTemplateById(templateId: string | null): Promise<TemplateInfo | null> {
  if (!templateId) return null
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('message_templates')
    .select('name, language, components')
    .eq('id', templateId)
    .maybeSingle()
  if (!data?.name) return null

  const components = componentesDe(data.components)

  return {
    name: data.name,
    language: data.language ?? null,
    bodyVars: variablesDelBody(components),
    urlButtonIndex: indiceBotonUrl(components),
  }
}

interface TemplateVars {
  clientName: string
  serviceName: string
  dateFormatted: string
  startTime: string
  branchName: string
  /** URL completa de /turnos/gestionar/<token>. */
  manageUrl: string
  /** Sólo el token: es lo que consume un botón URL con sufijo dinámico. */
  manageToken: string
}

/**
 * Parámetros del template, ajustados a lo que ese template DECLARA.
 *
 * El link para cancelar es obligatorio en la confirmación, pero no se puede
 * meter a la fuerza: un template aprobado con 5 variables rechaza la 6ta con
 * 132000 y el mensaje no llega. Así que se manda por el canal que el template
 * ofrezca, en este orden:
 *
 *   1. Botón URL con sufijo dinámico → viaja el TOKEN (Meta le pega el sufijo
 *      a la URL base del botón). Es la forma linda: el cliente ve un botón.
 *   2. Sexta variable de body → viaja la URL completa. WhatsApp la vuelve
 *      tocable sola.
 *   3. Ninguna de las dos → se manda la forma histórica de 5 variables. El
 *      mensaje llega igual, sin link, y el dashboard avisa que falta.
 *
 * Es la misma familia de trampa que el `language_code`: el template lo edita el
 * dueño en Business Manager, así que su forma es un dato a leer, no a asumir.
 */
function buildAppointmentTemplateParams(vars: TemplateVars, info: TemplateInfo | null) {
  const bodyVars = info?.bodyVars ?? 5

  const todos = [
    vars.clientName,
    vars.serviceName,
    vars.dateFormatted,
    vars.startTime,
    vars.branchName,
    vars.manageUrl,
  ]

  // Si el template declara menos variables de las que tenemos, se recortan (una
  // de más es un envío fallido); si declara más de las que sabemos llenar, se
  // completa con vacío antes que no mandar nada.
  const textos = Array.from({ length: Math.max(0, bodyVars) }, (_, i) => todos[i] ?? '')

  const componentes: Array<Record<string, unknown>> = [
    { type: 'body', parameters: textos.map(text => ({ type: 'text', text })) },
  ]

  if (info?.urlButtonIndex !== null && info?.urlButtonIndex !== undefined) {
    componentes.push({
      type: 'button',
      sub_type: 'url',
      index: info.urlButtonIndex,
      parameters: [{ type: 'text', text: vars.manageToken }],
    })
  }

  return componentes
}

interface ScheduleContext {
  orgId: string
  appointmentId: string
  clientId: string
  phone: string
  clientName: string
  serviceName: string
  branchName: string
  dateFormatted: string
  startTime: string
  appointmentDateTime: Date
  managementUrl: string
  /** Token pelado de `managementUrl`: lo consume un botón URL de Meta. */
  manageToken: string
}

/**
 * Encola mensajes de confirmación + N recordatorios para un turno.
 * Silent no-op si: no hay teléfono, no hay canal WA configurado. Errores se
 * loguean pero no abortan la operación (los turnos no requieren CRM).
 */
async function scheduleAppointmentMessages(
  ctx: ScheduleContext,
  settings: AppointmentSettings,
  kind: 'create' | 'reschedule'
) {
  try {
    if (!ctx.phone) return

    const supabase = createAdminClient()
    const channelId = await resolveOrgWhatsAppChannelId(ctx.orgId)

    // ── Confirmación / Reprogramación ──────────────────────────────
    const confirmationTplId = kind === 'reschedule'
      ? (settings.reschedule_template_id ?? settings.confirmation_template_id)
      : settings.confirmation_template_id

    const confirmationTpl = await getTemplateById(confirmationTplId)
    const confirmationTplName = confirmationTpl?.name
      ?? (kind === 'reschedule' ? null : settings.confirmation_template_name)

    const confirmationRow: Record<string, unknown> = {
      organization_id: ctx.orgId,
      appointment_id: ctx.appointmentId,
      client_id: ctx.clientId,
      channel_id: channelId,
      scheduled_for: new Date().toISOString(),
      phone: ctx.phone,
      status: 'pending',
    }

    const vars: TemplateVars = {
      clientName: ctx.clientName,
      serviceName: ctx.serviceName,
      dateFormatted: ctx.dateFormatted,
      startTime: ctx.startTime,
      branchName: ctx.branchName,
      manageUrl: ctx.managementUrl,
      manageToken: ctx.manageToken,
    }

    if (confirmationTplId && confirmationTplName) {
      confirmationRow.template_id = confirmationTplId
      confirmationRow.template_name = confirmationTplName
      confirmationRow.template_params = buildAppointmentTemplateParams(vars, confirmationTpl)
      if (confirmationTpl?.language) confirmationRow.template_language = confirmationTpl.language
    } else if (confirmationTplName) {
      confirmationRow.template_name = confirmationTplName
      confirmationRow.template_params = buildAppointmentTemplateParams(vars, confirmationTpl)
    } else {
      const prefix = kind === 'reschedule' ? 'Tu turno fue reprogramado: ' : ''
      confirmationRow.content = `${prefix}${ctx.serviceName} el ${ctx.dateFormatted} a las ${ctx.startTime} en ${ctx.branchName}. Gestionalo acá: ${ctx.managementUrl}`
    }

    const { error: confirmationError } = await supabase
      .from('scheduled_messages')
      .insert(confirmationRow)
    if (confirmationError) {
      console.error('[Appointments] insert confirmación:', confirmationError.message)
    }

    // ── Recordatorios (lista configurable) ──────────────────────────
    const reminderHours = Array.isArray(settings.reminder_hours_before_list)
      && settings.reminder_hours_before_list.length > 0
        ? settings.reminder_hours_before_list
        : (settings.reminder_hours_before > 0 ? [settings.reminder_hours_before] : [])

    const reminderTplId = settings.reminder_template_id
    const reminderTpl = await getTemplateById(reminderTplId)
    const reminderTplName = reminderTpl?.name ?? settings.reminder_template_name

    const now = Date.now()
    const reminderRows: Record<string, unknown>[] = []

    for (const hoursBefore of reminderHours) {
      const reminderTime = new Date(ctx.appointmentDateTime.getTime() - hoursBefore * 60 * 60 * 1000)
      if (reminderTime.getTime() <= now) continue

      const row: Record<string, unknown> = {
        organization_id: ctx.orgId,
        appointment_id: ctx.appointmentId,
        client_id: ctx.clientId,
        channel_id: channelId,
        scheduled_for: reminderTime.toISOString(),
        phone: ctx.phone,
        status: 'pending',
      }

      // Los params se arman contra el template DEL RECORDATORIO, no se reusan
      // los de la confirmación: son dos plantillas distintas y pueden declarar
      // distinta cantidad de variables. Mandar las 6 de una confirmación con
      // link a un recordatorio de 5 es un 132000 y el recordatorio no llega.
      if (reminderTplId && reminderTplName) {
        row.template_id = reminderTplId
        row.template_name = reminderTplName
        row.template_params = buildAppointmentTemplateParams(vars, reminderTpl)
        if (reminderTpl?.language) row.template_language = reminderTpl.language
      } else if (reminderTplName) {
        row.template_name = reminderTplName
        row.template_params = buildAppointmentTemplateParams(vars, reminderTpl)
      } else {
        row.content = `Recordatorio: ${ctx.serviceName} el ${ctx.dateFormatted} a las ${ctx.startTime} en ${ctx.branchName}.`
      }

      reminderRows.push(row)
    }

    if (reminderRows.length) {
      const { error: remindersError } = await supabase
        .from('scheduled_messages')
        .insert(reminderRows)
      if (remindersError) {
        console.error('[Appointments] insert recordatorios:', remindersError.message)
      }
    }
  } catch (e) {
    console.error('[Appointments] Error programando mensajes:', e)
  }
}

/**
 * Cancela solo los mensajes pendientes asociados a un turno específico.
 * Usa el nuevo `appointment_id` (migración 105) para no afectar otros
 * mensajes del cliente (ej. promociones, workflows independientes).
 */
async function cancelScheduledMessagesForAppointment(appointmentId: string) {
  try {
    const supabase = createAdminClient()
    await supabase
      .from('scheduled_messages')
      .update({ status: 'cancelled' })
      .eq('appointment_id', appointmentId)
      .eq('status', 'pending')
      .gte('scheduled_for', new Date().toISOString())
  } catch (e) {
    console.error('[Appointments] Error cancelando mensajes:', e)
  }
}

// ─── Create Appointment ─────────────────────────────────────────────

interface CreateAppointmentInput {
  branchId: string
  clientPhone: string
  clientName: string
  barberId?: string | null
  serviceId: string
  /**
   * Servicios adicionales cuando el cliente reserva más de uno (ej. corte +
   * barba). `serviceId` sigue siendo el principal —es la FK de la fila— y acá
   * va el detalle completo que se persiste en `appointment_services`.
   */
  serviceIds?: string[]
  appointmentDate: string
  startTime: string
  durationMinutes: number
  source: 'public' | 'manual'
  notes?: string
  createdByStaffId?: string
  /**
   * Reserva hecha desde la tablet del local. Se persiste como `public` (la
   * hace el cliente), pero salteando el rate-limit por IP: todos los clientes
   * del local comparten la IP de la tablet y a partir del tercero del día el
   * kiosko empezaría a rechazar reservas legítimas. El límite por teléfono y
   * el de `kioskCheckin` por sucursal siguen aplicando.
   */
  viaKiosk?: boolean
  /**
   * Reserva hecha desde la app mobile (`/api/mobile/turnos/[slug]/book`). Se
   * persiste como `public`, pero saltea el gate por IP: la app mobile ya pasó
   * por rate-limit por usuario (`RateLimits.mobileBook`) y el teléfono viene
   * del JWT, no del body. El límite por teléfono (3/h) y todo lo demás sigue.
   */
  viaApp?: boolean
}

export async function createAppointment(input: CreateAppointmentInput) {
  // Rate-limit por IP antes de tocar DB (solo para creación vía turnero público).
  if (input.source === 'public' && !input.viaKiosk && !input.viaApp) {
    const ipGate = await RateLimits.publicBookingCreateByIp()
    if (!ipGate.allowed) {
      return { error: 'Demasiadas reservas desde esta dirección, esperá un minuto' }
    }
  }

  if (!isValidUUID(input.branchId)) return { error: 'Sucursal inválida' }

  const supabase = createAdminClient()

  const { data: branch } = await supabase
    .from('branches')
    .select('id, organization_id, name, timezone')
    .eq('id', input.branchId)
    .eq('is_active', true)
    .single()

  if (!branch) return { error: 'Sucursal no encontrada' }
  const orgId = branch.organization_id

  // Para origen 'manual' (dashboard), enforcear scope y permiso server-side
  if (input.source === 'manual') {
    const access = await assertBranchAccess(input.branchId)
    if (!access.ok) return { error: 'Sin acceso a esta sucursal' }
    if (!(await currentUserCan('appointments.manage'))) {
      return { error: 'No tenés permiso para crear turnos' }
    }
  }

  const settings = await getAppointmentSettings(orgId, input.branchId)
  if (!settings?.is_enabled) return { error: 'Turnos no habilitados' }

  // Rate-limit por teléfono+org (anti-spam orientado al turnero público)
  if (input.source === 'public') {
    const phoneGate = await RateLimits.publicBookingCreateByPhone(input.clientPhone, orgId)
    if (!phoneGate.allowed) {
      return { error: 'Ya creaste varios turnos recientemente. Contactanos si necesitás más.' }
    }
  }

  // Buscar o crear cliente (tenant-scoped por phone+org).
  //
  // El match va por `find_client_id_by_phone`, que compara los ÚLTIMOS 10
  // DÍGITOS (migs 149/150). La igualdad exacta que había acá duplicaba al
  // cliente guardado como "+54 9 351 212-5249" cuando tipeaba "3512125249", y
  // el turno quedaba colgado del duplicado: sin historial, sin puntos, y en la
  // tablet lo recibía como si fuera su primera vez.
  let clientId: string

  const { data: existingClientId } = await supabase.rpc('find_client_id_by_phone', {
    p_org: orgId,
    p_phone: input.clientPhone,
  })

  const clienteYaExistia = !!existingClientId

  if (existingClientId) {
    clientId = existingClientId as string
    await supabase.from('clients').update({ name: input.clientName }).eq('id', clientId)
  } else {
    const { data: newClient, error } = await supabase
      .from('clients')
      .insert({ name: input.clientName, phone: input.clientPhone, organization_id: orgId })
      .select('id')
      .single()
    if (error || !newClient) return { error: 'Error al registrar cliente' }
    clientId = newClient.id
  }

  // ¿Puede entrar por la cámara de la tablet? Sólo si ya tiene una cara
  // enrolada: es el dato que decide qué instrucción se le da en la pantalla de
  // confirmación ("mirá la cámara" vs "marcá que no estás registrado").
  let clientHasFace = false
  if (clienteYaExistia) {
    const { count } = await supabase
      .from('client_face_descriptors')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
    clientHasFace = (count ?? 0) > 0
  }

  // Anti-doble-booking: un cliente no puede tener otro turno activo el mismo día en esta org
  const { data: clientAppointmentsToday } = await supabase
    .from('appointments')
    .select('id')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .eq('appointment_date', input.appointmentDate)
    .in('status', ['pending_payment', 'confirmed', 'checked_in', 'in_progress'])
    .limit(1)

  if (clientAppointmentsToday?.length) {
    return { error: 'Ya tenés un turno activo para esa fecha' }
  }

  // Calcular end_time, clampeando al cierre del horario de turnos
  const startMinutes = timeToMinutes(input.startTime)
  const closeMinutes = timeToMinutes(settings.appointment_hours_close)
  const rawEndMinutes = startMinutes + input.durationMinutes

  if (rawEndMinutes > closeMinutes) {
    return { error: 'El servicio no termina dentro del horario de atención' }
  }

  const endTime = minutesToTime(rawEndMinutes)

  // Disponibilidad server-side. Se calcula SIEMPRE, también cuando el cliente
  // eligió barbero: el turnero público manda branch/staff/fecha/hora desde el
  // navegador y antes esa rama salteaba toda la validación (día habilitado,
  // lead time, agenda del barbero, bloqueos, fecha pasada). Sólo quedaba la
  // exclusión de la DB, que no cubre nada de eso.
  const { slots, error: availabilityError } = await getAvailableSlots(
    input.branchId,
    input.appointmentDate,
    undefined,
    input.barberId || undefined,
    input.durationMinutes
  )

  if (availabilityError) return { error: availabilityError }

  const available = slots.filter(b =>
    b.slots.some(s => s.time === input.startTime && s.available)
  )

  if (!available.length) {
    if (!input.barberId) return { error: 'No hay barberos disponibles en ese horario' }
    // Distinguir "el hueco se ocupó" de "ese barbero no trabaja ese día":
    // sin esto el dashboard mostraba "elegí otro horario" cuando el problema
    // real era que al barbero no le cargaron el horario semanal.
    const tieneAgenda = slots.some(b => b.barberId === input.barberId && b.slots.length > 0)
    return {
      error: tieneAgenda
        ? 'Ese horario ya no está disponible, elegí otro'
        : 'Ese barbero no tiene horario cargado para ese día',
    }
  }

  // Auto-asignar barbero si no se especificó
  let barberId = input.barberId || null
  if (!barberId) {
    // Elegir el que tiene menos turnos ese día
    const { data: counts } = await supabase
      .from('appointments')
      .select('barber_id')
      .eq('branch_id', input.branchId)
      .eq('appointment_date', input.appointmentDate)
      .not('status', 'in', '("cancelled","no_show")')
      .in('barber_id', available.map(a => a.barberId))

    const countMap: Record<string, number> = {}
    for (const a of available) countMap[a.barberId] = 0
    for (const c of counts ?? []) {
      if (c.barber_id) countMap[c.barber_id] = (countMap[c.barber_id] || 0) + 1
    }

    barberId = Object.entries(countMap).sort((a, b) => a[1] - b[1])[0][0]
  }

  // Generar token de cancelación + expiración (turno + 24h, mitiga replay)
  const cancellationToken = crypto.randomUUID().replace(/-/g, '').substring(0, 24)
  const tokenExpiresAt = new Date(
    appointmentInstant(input.appointmentDate, input.startTime, branch.timezone).getTime()
      + 24 * 60 * 60 * 1000
  )

  // Obtener nombre y precio del servicio (precio necesario para prepago)
  let serviceName = ''
  let servicePrice = 0
  if (input.serviceId) {
    const { data: service } = await supabase
      .from('services')
      .select('name, price')
      .eq('id', input.serviceId)
      .single()
    serviceName = service?.name ?? ''
    servicePrice = Number(service?.price ?? 0)
  }

  // Si la org está en prepago, el turno nace como pending_payment y no
  // reserva comunicación hasta que el staff confirme el cobro.
  const isPrepago = settings.payment_mode === 'prepago'
  const initialStatus: AppointmentStatus = isPrepago ? 'pending_payment' : 'confirmed'

  const { data: appointment, error: insertError } = await supabase
    .from('appointments')
    .insert({
      organization_id: orgId,
      branch_id: input.branchId,
      client_id: clientId,
      barber_id: barberId,
      service_id: input.serviceId,
      appointment_date: input.appointmentDate,
      start_time: input.startTime,
      end_time: endTime,
      duration_minutes: input.durationMinutes,
      status: initialStatus,
      source: input.source,
      cancellation_token: cancellationToken,
      token_expires_at: tokenExpiresAt.toISOString(),
      payment_flag: settings.payment_mode,
      payment_status: 'unpaid',
      created_by_staff_id: input.createdByStaffId || null,
      notes: input.notes || null,
    })
    .select('*')
    .single()

  if (insertError) {
    // 23P01 = exclusion_violation: lo tira `appointments_no_overlap_excl`, que
    // es el guardián real del overbooking. Sin este caso el cliente veía el
    // mensaje crudo de Postgres.
    if (insertError.code === '23505' || insertError.code === '23P01') {
      return { error: 'Ya existe un turno en ese horario para ese barbero' }
    }
    return { error: 'Error al crear turno: ' + insertError.message }
  }

  // Detalle multi-servicio. La fila de `appointments` sólo guarda el servicio
  // principal, así que sin esto un "corte + barba" se registraba como corte.
  const detalleIds = (input.serviceIds?.length ? input.serviceIds : [input.serviceId])
    .filter(id => isValidUUID(id))

  if (detalleIds.length > 1) {
    const { data: serviceRows } = await supabase
      .from('services')
      .select('id, price, duration_minutes')
      .in('id', detalleIds)

    const rows = detalleIds.map((id, idx) => {
      const svc = serviceRows?.find(s => s.id === id)
      return {
        appointment_id: appointment.id,
        organization_id: orgId,
        service_id: id,
        sort_order: idx,
        duration_snapshot: svc?.duration_minutes ?? settings.slot_interval_minutes,
        price_snapshot: Number(svc?.price ?? 0),
      }
    })

    const { error: detalleError } = await supabase.from('appointment_services').insert(rows)
    if (detalleError) {
      console.error('[createAppointment] appointment_services:', detalleError.message)
    }
  }

  // Programar mensajes (graceful — si no hay WA configurado, no falla)
  const dateFormatted = new Date(input.appointmentDate + 'T12:00:00')
    .toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
  const managementUrl = await absoluteUrl(`/turnos/gestionar/${cancellationToken}`)

  if (isPrepago) {
    // Solicitud de pago (la confirmación + recordatorios se encolan recién al
    // confirmarse el pago; ver confirmAppointmentPrepayment).
    const prepaymentAmount = calculatePrepaymentAmount(settings, servicePrice)
    await schedulePaymentRequestMessage({
      orgId,
      appointmentId: appointment.id,
      clientId,
      phone: input.clientPhone,
      clientName: input.clientName,
      serviceName,
      branchName: branch.name,
      dateFormatted,
      startTime: input.startTime,
      managementUrl,
      amount: prepaymentAmount,
      instructions: settings.payment_instructions ?? null,
      templateId: settings.payment_request_template_id ?? null,
    })
  } else {
    await scheduleAppointmentMessages(
      {
        orgId,
        appointmentId: appointment.id,
        clientId,
        phone: input.clientPhone,
        clientName: input.clientName,
        serviceName,
        branchName: branch.name,
        dateFormatted,
        startTime: input.startTime,
        appointmentDateTime: appointmentInstant(input.appointmentDate, input.startTime, branch.timezone),
        managementUrl,
        manageToken: cancellationToken,
      },
      settings,
      'create'
    )
  }

  revalidatePath('/dashboard/fila')
  revalidatePath('/dashboard/turnos/agenda')
  revalidatePath('/barbero/fila')
  return { success: true, appointment, clientHasFace, clientIsNew: !clienteYaExistia }
}

/**
 * Calcula el monto a prepagar según la configuración:
 *   - fixed: 100% del precio del servicio
 *   - percentage: servicePrice * prepayment_percentage / 100
 */
function calculatePrepaymentAmount(settings: AppointmentSettings, servicePrice: number): number {
  if (!servicePrice || servicePrice <= 0) return 0
  if (settings.prepayment_type === 'fixed') return servicePrice
  const pct = Math.min(100, Math.max(1, Number(settings.prepayment_percentage ?? 50)))
  return Math.round((servicePrice * pct) / 100)
}

interface PaymentRequestContext {
  orgId: string
  appointmentId: string
  clientId: string
  phone: string
  clientName: string
  serviceName: string
  branchName: string
  dateFormatted: string
  startTime: string
  managementUrl: string
  amount: number
  instructions: string | null
  templateId: string | null
}

/**
 * Encola UN mensaje con el pedido de pago previo al servicio. Graceful no-op
 * si no hay canal WA o teléfono. El cliente recibe:
 *   - Template payment_request si está configurado
 *   - Sino texto libre armado con los datos del turno + instructions
 */
async function schedulePaymentRequestMessage(ctx: PaymentRequestContext) {
  try {
    if (!ctx.phone) return
    const supabase = createAdminClient()
    const channelId = await resolveOrgWhatsAppChannelId(ctx.orgId)

    const tpl = await getTemplateById(ctx.templateId)
    const templateName = tpl?.name ?? null

    const row: Record<string, unknown> = {
      organization_id: ctx.orgId,
      appointment_id: ctx.appointmentId,
      client_id: ctx.clientId,
      channel_id: channelId,
      scheduled_for: new Date().toISOString(),
      phone: ctx.phone,
      status: 'pending',
    }

    if (ctx.templateId && templateName) {
      row.template_id = ctx.templateId
      row.template_name = templateName
      if (tpl?.language) row.template_language = tpl.language
      row.template_params = [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: ctx.clientName },
            { type: 'text', text: ctx.serviceName },
            { type: 'text', text: ctx.dateFormatted },
            { type: 'text', text: ctx.startTime },
            { type: 'text', text: ctx.branchName },
            { type: 'text', text: formatARS(ctx.amount) },
            { type: 'text', text: ctx.instructions ?? '' },
          ],
        },
      ]
    } else {
      const amountLabel = ctx.amount > 0 ? ` (${formatARS(ctx.amount)})` : ''
      const instructionsBlock = ctx.instructions ? `\n${ctx.instructions}` : ''
      row.content = `Hola ${ctx.clientName}, tu turno para ${ctx.serviceName} el ${ctx.dateFormatted} a las ${ctx.startTime} en ${ctx.branchName} queda pendiente hasta recibir el pago${amountLabel}.${instructionsBlock}\nCuando lo confirmemos te avisamos. Gestioná tu turno acá: ${ctx.managementUrl}`
    }

    await supabase.from('scheduled_messages').insert(row)
  } catch (e) {
    console.error('[Appointments] Error enviando solicitud de pago:', e)
  }
}

function formatARS(amount: number): string {
  try {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `$${amount}`
  }
}

// ─── Reschedule Appointment ────────────────────────────────────────

interface RescheduleAppointmentInput {
  appointmentId: string
  newDate: string
  newStartTime: string
  newBarberId?: string | null
  newDurationMinutes?: number
  /**
   * `false` para movimientos internos de la agenda que no cambian nada de lo
   * que el cliente ya sabe. Si el horario cambia, se avisa igual.
   */
  notifyClient?: boolean
}

export async function rescheduleAppointment(input: RescheduleAppointmentInput) {
  const supabase = createAdminClient()

  const { data: existing } = await supabase
    .from('appointments')
    .select('*, branch:branch_id(organization_id, name, timezone)')
    .eq('id', input.appointmentId)
    .single()

  if (!existing) return { error: 'Turno no encontrado' }
  if (['cancelled', 'completed', 'no_show'].includes(existing.status)) {
    return { error: 'No se puede reprogramar un turno en este estado' }
  }

  const access = await assertBranchAccess(existing.branch_id)
  if (!access.ok) return { error: 'Sin acceso a esta sucursal' }

  if (!(await currentUserCan('appointments.manage'))) {
    return { error: 'No tenés permiso para mover turnos' }
  }

  const orgId = existing.organization_id
  const settings = await getAppointmentSettings(orgId, existing.branch_id)
  if (!settings) return { error: 'Settings no encontrados' }

  const duration = input.newDurationMinutes ?? existing.duration_minutes
  const startMinutes = timeToMinutes(input.newStartTime)
  const closeMinutes = timeToMinutes(settings.appointment_hours_close)
  if (startMinutes + duration > closeMinutes) {
    return { error: 'El servicio no termina dentro del horario de atención' }
  }
  const endTime = minutesToTime(startMinutes + duration)

  const barberId = input.newBarberId !== undefined ? input.newBarberId : existing.barber_id

  // Revalidar contra el motor de disponibilidad, igual que createAppointment.
  // Antes el único guardián era la EXCLUSION GiST, que sólo detecta choques
  // entre turnos: se podía arrastrar un turno al día libre del barbero, a un
  // bloqueo (que la propia grilla dibuja rayado), a un día no habilitado o
  // fuera de su jornada, y se guardaba sin chistar.
  if (barberId) {
    const { slots, error: slotsError } = await getAvailableSlots(
      existing.branch_id,
      input.newDate,
      null,
      barberId,
      duration,
      { excludeAppointmentId: input.appointmentId, ignoreLeadTime: true }
    )

    if (slotsError) return { error: slotsError }

    const grupo = slots.find(s => s.barberId === barberId)
    if (!grupo) {
      return { error: 'Ese barbero no trabaja ese día' }
    }

    // El destino puede no coincidir con la grilla de inicios (el snap es
    // slot_interval_minutes): lo que importa es que el rango quede libre, así
    // que se valida contra el slot que lo contiene.
    const libre = grupo.slots.some(s => s.time === input.newStartTime && s.available)
    if (!libre) {
      const dentroDeAlguno = grupo.slots.some(s => {
        const ini = timeToMinutes(s.time)
        return s.available && startMinutes >= ini && startMinutes + duration <= ini + duration
      })
      if (!dentroDeAlguno) {
        return { error: 'Ese horario no está disponible para ese barbero' }
      }
    }
  }

  // Regenerar token (invalida el anterior).
  // La expiración se calcula en la TZ de la SUCURSAL: `new Date('YYYY-MM-DDTHH:MM')`
  // se parsea con el reloj del proceso (UTC en Vercel) y el token de gestión
  // vencía 3 horas antes de lo previsto.
  const cancellationToken = crypto.randomUUID().replace(/-/g, '').substring(0, 24)
  const tokenExpiresAt = new Date(
    appointmentInstant(
      input.newDate,
      input.newStartTime,
      (existing.branch as { timezone?: string } | null)?.timezone
    ).getTime() + 24 * 60 * 60 * 1000
  )

  const { error: updateError } = await supabase
    .from('appointments')
    .update({
      appointment_date: input.newDate,
      start_time: input.newStartTime,
      end_time: endTime,
      duration_minutes: duration,
      barber_id: barberId,
      cancellation_token: cancellationToken,
      token_expires_at: tokenExpiresAt.toISOString(),
    })
    .eq('id', input.appointmentId)

  if (updateError) {
    // 23P01 = exclusion_violation (appointments_no_overlap_excl), el guardián
    // real del overbooking. Sin este caso, arrastrar un turno a un hueco
    // ocupado devolvía el texto crudo de Postgres en inglés.
    if (updateError.code === '23505' || updateError.code === '23P01') {
      return { error: 'Ya existe un turno en ese horario para ese barbero' }
    }
    console.error('[rescheduleAppointment]', updateError.message)
    return { error: 'No pudimos reprogramar el turno' }
  }

  // Sólo se le escribe al cliente si cambió algo que él sabe: la fecha o la
  // hora. Acomodar la agenda arrastrando cuatro turnos disparaba cuatro
  // "monaco_turno_reprogramado", y mover el mismo turno tres veces, tres.
  const horarioCambio =
    existing.appointment_date !== input.newDate ||
    existing.start_time.slice(0, 5) !== input.newStartTime
  const debeAvisar = input.notifyClient ?? horarioCambio

  if (!debeAvisar) {
    revalidatePath('/dashboard/turnos/agenda')
    revalidatePath('/dashboard/fila')
    return { success: true }
  }

  // Cancelar mensajes pendientes del turno anterior
  await cancelScheduledMessagesForAppointment(input.appointmentId)

  // Reprogramar mensajes con los nuevos datos
  const { data: client } = await supabase
    .from('clients')
    .select('name, phone')
    .eq('id', existing.client_id)
    .single()

  let serviceName = ''
  if (existing.service_id) {
    const { data: service } = await supabase
      .from('services')
      .select('name')
      .eq('id', existing.service_id)
      .single()
    serviceName = service?.name ?? ''
  }

  const dateFormatted = new Date(input.newDate + 'T12:00:00')
    .toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
  const managementUrl = await absoluteUrl(`/turnos/gestionar/${cancellationToken}`)

  if (client?.phone) {
    await scheduleAppointmentMessages(
      {
        orgId,
        appointmentId: input.appointmentId,
        clientId: existing.client_id,
        phone: client.phone,
        clientName: client.name ?? '',
        serviceName,
        branchName: (existing.branch as { name?: string } | null)?.name ?? '',
        dateFormatted,
        startTime: input.newStartTime,
        appointmentDateTime: appointmentInstant(
          input.newDate,
          input.newStartTime,
          (existing.branch as { timezone?: string } | null)?.timezone
        ),
        managementUrl,
        manageToken: cancellationToken,
      },
      settings,
      'reschedule'
    )
  }

  revalidatePath('/dashboard/turnos/agenda')
  revalidatePath('/dashboard/fila')
  return { success: true }
}

export async function updateAppointmentDuration(appointmentId: string, newDurationMinutes: number) {
  if (newDurationMinutes <= 0 || newDurationMinutes > 480) {
    return { error: 'Duración inválida' }
  }

  const supabase = createAdminClient()

  const { data: existing } = await supabase
    .from('appointments')
    .select('id, branch_id, appointment_date, start_time')
    .eq('id', appointmentId)
    .single()

  if (!existing) return { error: 'Turno no encontrado' }

  const access = await assertBranchAccess(existing.branch_id)
  if (!access.ok) return { error: 'Sin acceso a esta sucursal' }

  if (!(await currentUserCan('appointments.manage'))) {
    return { error: 'No tenés permiso para editar turnos' }
  }

  const startMinutes = timeToMinutes(existing.start_time.substring(0, 5))
  const endTime = minutesToTime(startMinutes + newDurationMinutes)

  const { error } = await supabase
    .from('appointments')
    .update({
      duration_minutes: newDurationMinutes,
      end_time: endTime,
    })
    .eq('id', appointmentId)

  if (error) {
    if (error.code === '23505' || error.code === '23P01') {
      return { error: 'La nueva duración solapa con otro turno' }
    }
    console.error('[updateAppointmentDuration]', error.message)
    return { error: 'No pudimos actualizar la duración' }
  }

  revalidatePath('/dashboard/turnos/agenda')
  return { success: true }
}

// ─── Cancel Appointment ─────────────────────────────────────────────

export async function cancelAppointment(
  appointmentId: string,
  cancelledBy: 'client' | 'staff' | 'system'
) {
  const supabase = createAdminClient()

  const { data: appointment } = await supabase
    .from('appointments')
    .select('*, branch:branch_id(organization_id, timezone)')
    .eq('id', appointmentId)
    .single()

  if (!appointment) return { error: 'Turno no encontrado' }
  if (appointment.status === 'cancelled' || appointment.status === 'completed') {
    return { error: 'El turno ya fue cancelado o completado' }
  }

  // Scope check para staff — clientes cancelan vía cancelAppointmentByToken (público)
  if (cancelledBy === 'staff') {
    const access = await assertBranchAccess(appointment.branch_id)
    if (!access.ok) return { error: 'Sin acceso a esta sucursal' }
    if (!(await currentUserCan('appointments.manage'))) {
      return { error: 'No tenés permiso para cancelar turnos' }
    }
  }

  if (cancelledBy === 'client') {
    const settings = await getAppointmentSettings(appointment.organization_id, appointment.branch_id)
    if (settings?.cancellation_min_hours) {
      const branchRel = unwrapRel(appointment.branch as { timezone?: string } | { timezone?: string }[] | null)
      const appointmentDateTime = appointmentInstant(
        appointment.appointment_date,
        appointment.start_time,
        branchRel?.timezone
      )
      const hoursUntil = (appointmentDateTime.getTime() - Date.now()) / (1000 * 60 * 60)
      if (hoursUntil < settings.cancellation_min_hours) {
        return { error: `No se puede cancelar con menos de ${settings.cancellation_min_hours} horas de antelación` }
      }
    }
  }

  const { error } = await supabase
    .from('appointments')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancelled_by: cancelledBy,
    })
    .eq('id', appointmentId)

  if (error) return { error: error.message }

  // Cancelar queue entry si existe.
  // `.eq('status','waiting')` no es cosmético: si el corte YA arrancó, cancelar
  // la entrada impide que dispare `on_queue_completed`, así que no se crea la
  // visita y la plata no entra a caja. La fila protege exactamente este caso en
  // `cancelQueueEntry` (queue.ts) y el lado de turnos lo esquivaba.
  if (appointment.queue_entry_id) {
    await supabase
      .from('queue_entries')
      .update({ status: 'cancelled' })
      .eq('id', appointment.queue_entry_id)
      .eq('status', 'waiting')
  }

  // Cancelar solo los mensajes programados de este turno (por appointment_id,
  // no por client_id — evita cancelar promos/workflows del cliente).
  await cancelScheduledMessagesForAppointment(appointmentId)

  // Programar mensaje de cancelación informativo (si hay template configurado)
  try {
    const settings = await getAppointmentSettings(appointment.organization_id, appointment.branch_id)
    if (settings?.cancellation_template_id) {
      const cancelTpl = await getTemplateById(settings.cancellation_template_id)
      const tplName = cancelTpl?.name ?? null
      if (tplName) {
        const { data: client } = await supabase
          .from('clients')
          .select('name, phone')
          .eq('id', appointment.client_id)
          .single()

        if (client?.phone) {
          const channelId = await resolveOrgWhatsAppChannelId(appointment.organization_id)
          const dateFormatted = new Date(appointment.appointment_date + 'T12:00:00')
            .toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })

          await supabase.from('scheduled_messages').insert({
            organization_id: appointment.organization_id,
            appointment_id: appointmentId,
            client_id: appointment.client_id,
            channel_id: channelId,
            template_id: settings.cancellation_template_id,
            template_name: tplName,
            ...(cancelTpl?.language ? { template_language: cancelTpl.language } : {}),
            // `monaco_turno_cancelado` declara 4 variables, no 5: hasta que el
            // builder pasó a leer la forma real del template, este mensaje se
            // iba con una de más y Meta lo rechazaba entero (132000).
            template_params: buildAppointmentTemplateParams(
              {
                clientName: client.name ?? '',
                serviceName: '',
                dateFormatted,
                startTime: appointment.start_time.substring(0, 5),
                branchName: '',
                manageUrl: '',
                manageToken: '',
              },
              cancelTpl
            ),
            scheduled_for: new Date().toISOString(),
            phone: client.phone,
            status: 'pending',
          })
        }
      }
    }
  } catch (e) {
    console.error('[Appointments] Error programando mensaje de cancelación:', e)
  }

  // Trigger waitlist notification (best-effort)
  try {
    const { notifyNextWaitlistCandidate } = await import('./waitlist')
    await notifyNextWaitlistCandidate({
      orgId: appointment.organization_id,
      branchId: appointment.branch_id,
      serviceId: appointment.service_id,
      barberId: appointment.barber_id,
      date: appointment.appointment_date,
    })
  } catch { /* waitlist module no requerido */ }

  revalidatePath('/dashboard/fila')
  revalidatePath('/dashboard/turnos/agenda')
  revalidatePath('/barbero/fila')
  return { success: true }
}

export async function cancelAppointmentByToken(token: string) {
  const gate = await RateLimits.publicBookingCancel(token)
  if (!gate.allowed) {
    return { error: 'Demasiados intentos, esperá un momento' }
  }

  const supabase = createAdminClient()

  const { data: appointment } = await supabase
    .from('appointments')
    .select('id, token_expires_at')
    .eq('cancellation_token', token)
    .maybeSingle()

  if (!appointment) return { error: 'Turno no encontrado' }

  // Validar expiración del token
  if (appointment.token_expires_at && new Date(appointment.token_expires_at) < new Date()) {
    return { error: 'El link expiró' }
  }

  return cancelAppointment(appointment.id, 'client')
}

// ─── Mark No-Show ───────────────────────────────────────────────────

export async function markNoShow(appointmentId: string, staffId: string) {
  const supabase = createAdminClient()

  const { data: appointment } = await supabase
    .from('appointments')
    .select('*, branch:branch_id(organization_id)')
    .eq('id', appointmentId)
    .single()

  if (!appointment) return { error: 'Turno no encontrado' }

  const access = await assertBranchAccess(appointment.branch_id)
  if (!access.ok) return { error: 'Sin acceso a esta sucursal' }

  if (!(await currentUserCan('appointments.manage'))) {
    return { error: 'No tenés permiso para marcar ausentes' }
  }

  if (!['confirmed', 'checked_in'].includes(appointment.status)) {
    return { error: 'El turno no está en un estado válido para marcar ausente' }
  }

  const settings = await getAppointmentSettings(appointment.organization_id, appointment.branch_id)
  if (settings) {
    const appointmentDateTime = new Date(`${appointment.appointment_date}T${appointment.start_time}`)
    const toleranceEnd = new Date(appointmentDateTime.getTime() + settings.no_show_tolerance_minutes * 60 * 1000)
    if (new Date() < toleranceEnd) {
      return { error: `Debe esperar ${settings.no_show_tolerance_minutes} minutos de tolerancia` }
    }
  }

  const { error } = await supabase
    .from('appointments')
    .update({
      status: 'no_show',
      no_show_marked_at: new Date().toISOString(),
      no_show_marked_by: staffId,
    })
    .eq('id', appointmentId)

  if (error) return { error: error.message }

  // Cancelar mensajes pendientes (no tiene sentido enviar recordatorios si ya faltó)
  await cancelScheduledMessagesForAppointment(appointmentId)

  // Cancelar queue entry si existe.
  // `.eq('status','waiting')` no es cosmético: si el corte YA arrancó, cancelar
  // la entrada impide que dispare `on_queue_completed`, así que no se crea la
  // visita y la plata no entra a caja. La fila protege exactamente este caso en
  // `cancelQueueEntry` (queue.ts) y el lado de turnos lo esquivaba.
  if (appointment.queue_entry_id) {
    await supabase
      .from('queue_entries')
      .update({ status: 'cancelled' })
      .eq('id', appointment.queue_entry_id)
      .eq('status', 'waiting')
  }

  // Aplicar tag "Ausente" a la conversación del cliente
  try {
    const { data: tag } = await supabase
      .from('conversation_tags')
      .select('id')
      .eq('organization_id', appointment.organization_id)
      .eq('name', 'Ausente')
      .maybeSingle()

    if (tag) {
      const { data: conversations } = await supabase
        .from('conversations')
        .select('id')
        .eq('client_id', appointment.client_id)
        .limit(1)

      if (conversations?.length) {
        await supabase.from('conversation_tag_assignments').upsert({
          conversation_id: conversations[0].id,
          tag_id: tag.id,
        }, { onConflict: 'conversation_id,tag_id', ignoreDuplicates: true })
      }
    }
  } catch (e) {
    console.error('[Appointments] Error aplicando tag Ausente:', e)
  }

  revalidatePath('/dashboard/fila')
  revalidatePath('/dashboard/turnos/agenda')
  revalidatePath('/barbero/fila')
  return { success: true }
}

// ─── Check-in Appointment (create queue entry) ─────────────────────

/**
 * Registra la llegada de un turno: lo mete en la fila.
 *
 * Delega en la RPC `check_in_appointment`, que es la ÚNICA puerta. Antes había
 * dos implementaciones —ésta en TS y la RPC que usan kiosko y panel— con
 * semánticas distintas de `priority_order`: la de acá ponía la hora de LLEGADA
 * y la RPC la hora del TURNO. Como priority_order es la clave de orden real de
 * la fila, el mismo turno terminaba en un lugar distinto según por qué puerta
 * hubiera entrado. Además ésta no validaba tolerancia, no era idempotente y no
 * manejaba el caso del cliente que ya estaba en la fila.
 *
 * `allowEarly` existe porque el staff sí puede registrar una llegada muy
 * anticipada desde el dashboard; el cliente solo, desde la tablet, no.
 */
export async function checkinAppointment(
  appointmentId: string,
  options?: { staffIdAssign?: string | null; allowEarly?: boolean }
) {
  if (!isValidUUID(appointmentId)) return { error: 'ID inválido' }

  const supabase = createAdminClient()

  const { data: appointment } = await supabase
    .from('appointments')
    .select('branch_id')
    .eq('id', appointmentId)
    .single()

  if (!appointment) return { error: 'Turno no encontrado' }

  const access = await assertBranchAccess(appointment.branch_id)
  if (!access.ok) return { error: 'Sin acceso a esta sucursal' }

  if (!(await currentUserCan('appointments.manage'))) {
    return { error: 'No tenés permiso para registrar llegadas' }
  }

  const { data, error } = await supabase.rpc('check_in_appointment', {
    p_appointment_id: appointmentId,
    p_staff_id_assign: options?.staffIdAssign ?? null,
    p_allow_early: options?.allowEarly ?? true,
  })

  if (error) {
    console.error('[checkinAppointment] rpc:', error.message)
    return { error: 'Error al agregar a la fila de turnos' }
  }

  const result = data as {
    success: boolean
    error?: string
    queue_entry_id?: string
    adopted_existing_entry?: boolean
  } | null

  if (!result?.success) {
    return { error: mapCheckInError(result?.error) }
  }

  revalidatePath('/dashboard/fila')
  revalidatePath('/dashboard/turnos/agenda')
  revalidatePath('/barbero/fila')
  return {
    success: true as const,
    queueEntryId: result.queue_entry_id!,
    adoptedExistingEntry: !!result.adopted_existing_entry,
  }
}

// No se exporta: en un módulo 'use server' todo lo exportado tiene que ser una
// función async (si no, el build de Next falla).
/** Traduce los códigos de `check_in_appointment` a algo que se pueda mostrar. */
function mapCheckInError(code?: string): string {
  switch (code) {
    case 'NOT_FOUND': return 'No encontramos el turno'
    case 'INVALID_STATUS': return 'El turno ya no está activo'
    case 'STAFF_REQUIRED': return 'Falta asignar un barbero al turno'
    case 'TOO_EARLY': return 'Todavía es muy temprano para registrar la llegada'
    case 'TOO_LATE': return 'Pasó la tolerancia de espera del turno'
    case 'QUEUE_CONFLICT': return 'El cliente ya está en la fila con otra entrada'
    default: return 'No pudimos registrar la llegada'
  }
}

/**
 * Inicia el servicio de un turno ya checked-in. Marca la queue_entry asociada
 * como in_progress y sincroniza el status del appointment. Asume que el turno
 * ya pasó por checkinAppointment (tiene queue_entry_id y barber_id).
 */
export async function startAppointmentService(appointmentId: string) {
  if (!isValidUUID(appointmentId)) return { error: 'ID inválido' }

  const supabase = createAdminClient()

  const { data: appointment } = await supabase
    .from('appointments')
    .select('id, branch_id, barber_id, queue_entry_id, status')
    .eq('id', appointmentId)
    .single()

  if (!appointment) return { error: 'Turno no encontrado' }
  if (!appointment.queue_entry_id) return { error: 'El turno no fue checkeado todavía' }
  if (!appointment.barber_id) return { error: 'El turno no tiene barbero asignado' }
  if (appointment.status !== 'checked_in') return { error: 'El turno no está en espera' }

  const access = await assertBranchAccess(appointment.branch_id)
  if (!access.ok) return { error: 'Sin acceso a esta sucursal' }

  if (!(await currentUserCan('appointments.manage'))) {
    return { error: 'No tenés permiso para iniciar servicios' }
  }

  const { error: updateError } = await supabase
    .from('queue_entries')
    .update({
      status: 'in_progress',
      started_at: new Date().toISOString(),
    })
    .eq('id', appointment.queue_entry_id)
    .eq('status', 'waiting')

  if (updateError) return { error: 'Error al iniciar el servicio' }

  await supabase
    .from('appointments')
    .update({ status: 'in_progress' })
    .eq('id', appointmentId)

  revalidatePath('/dashboard/fila')
  revalidatePath('/dashboard/turnos/agenda')
  revalidatePath('/barbero/fila')
  return { success: true }
}

/**
 * Devuelve la queue_entry asociada a un turno (para abrir el diálogo de
 * finalización reutilizando el flujo walk-in de completeService).
 */
export async function getAppointmentQueueEntry(appointmentId: string) {
  if (!isValidUUID(appointmentId)) return null
  const supabase = createAdminClient()

  const { data: appointment } = await supabase
    .from('appointments')
    .select('queue_entry_id, branch_id')
    .eq('id', appointmentId)
    .single()

  if (!appointment?.queue_entry_id) return null

  const access = await assertBranchAccess(appointment.branch_id)
  if (!access.ok) return null

  const { data: entry } = await supabase
    .from('queue_entries')
    .select('*, client:clients(*), barber:staff(*)')
    .eq('id', appointment.queue_entry_id)
    .single()

  return entry
}

// ─── Payment ───────────────────────────────────────────────────────

interface MarkPaymentInput {
  appointmentId: string
  amount: number
  method: 'efectivo' | 'transferencia' | 'mercadopago' | 'tarjeta_debito' | 'tarjeta_credito' | 'otro'
  status: 'paid' | 'partial'
  staffId?: string | null
  notes?: string
}

export async function markAppointmentPayment(input: MarkPaymentInput) {
  const supabase = createAdminClient()

  const { data: existing } = await supabase
    .from('appointments')
    .select('id, branch_id, payment_status')
    .eq('id', input.appointmentId)
    .single()

  if (!existing) return { error: 'Turno no encontrado' }

  const access = await assertBranchAccess(existing.branch_id)
  if (!access.ok) return { error: 'Sin acceso a esta sucursal' }

  if (!(await currentUserCan('appointments.manage'))) {
    return { error: 'No tenés permiso para registrar pagos' }
  }

  if (existing.payment_status === 'refunded') {
    return { error: 'El turno ya fue reembolsado' }
  }

  if (input.amount <= 0) return { error: 'Monto inválido' }

  const { error } = await supabase
    .from('appointments')
    .update({
      payment_status: input.status,
      payment_amount: input.amount,
      payment_method: input.method,
      paid_at: new Date().toISOString(),
      paid_by_staff_id: input.staffId ?? null,
      payment_notes: input.notes ?? null,
    })
    .eq('id', input.appointmentId)

  if (error) return { error: error.message }

  revalidatePath('/dashboard/turnos/agenda')
  revalidatePath('/dashboard/fila')
  return { success: true }
}

// ─── Prepayment confirmation ───────────────────────────────────────

interface ConfirmPrepaymentInput {
  appointmentId: string
  method: AppointmentPaymentMethod
  /** Opcional: override del monto calculado por settings. */
  amount?: number
  paymentAccountId?: string | null
  staffId?: string | null
  notes?: string
}

/**
 * Confirma manualmente el prepago de un turno en 'pending_payment'. Efecto:
 *  1) Crea una visita (impacta caja/finanzas al momento de la confirmación).
 *  2) Marca el turno como 'confirmed' + payment_status ('paid' o 'partial').
 *  3) Dispara el encolado de confirmación + recordatorios (que no se mandaron
 *     al crear el turno porque estaba esperando pago).
 *
 * El monto por defecto lo dicta appointment_settings:
 *  - prepayment_type='fixed'      → precio del servicio
 *  - prepayment_type='percentage' → precio * prepayment_percentage / 100
 */
export async function confirmAppointmentPrepayment(input: ConfirmPrepaymentInput) {
  if (!isValidUUID(input.appointmentId)) return { error: 'ID inválido' }

  const supabase = createAdminClient()

  const { data: appointment } = await supabase
    .from('appointments')
    .select('*, service:service_id(id, name, price), client:client_id(id, name, phone)')
    .eq('id', input.appointmentId)
    .single()

  if (!appointment) return { error: 'Turno no encontrado' }
  if (appointment.status !== 'pending_payment') {
    return { error: 'El turno no está esperando pago' }
  }
  if (!appointment.barber_id) return { error: 'Asigná un barbero antes de confirmar el pago' }

  const access = await assertBranchAccess(appointment.branch_id)
  if (!access.ok) return { error: 'Sin acceso a esta sucursal' }

  const settings = await getAppointmentSettings(appointment.organization_id, appointment.branch_id)
  if (!settings) return { error: 'Settings no encontrados' }

  const servicePrice = Number(appointment.service?.price ?? 0)
  const defaultAmount = calculatePrepaymentAmount(settings, servicePrice)
  const amount = input.amount && input.amount > 0 ? input.amount : defaultAmount

  if (amount <= 0) return { error: 'Monto inválido — definí un precio en el servicio o pasá amount' }

  const { data: branch } = await supabase
    .from('branches')
    .select('id, organization_id, name, timezone')
    .eq('id', appointment.branch_id)
    .single()

  if (!branch) return { error: 'Sucursal no encontrada' }

  const visitPaymentMethod = mapAppointmentPaymentMethodToVisit(input.method)
  const now = new Date().toISOString()

  // Crea la visita (impacta caja/finanzas YA; queue_entry_id=NULL porque aún
  // no hubo servicio). El trigger on_queue_completed, cuando el servicio
  // eventualmente se complete, reutilizará esta visita via appointment_id.
  const { error: visitError } = await supabase
    .from('visits')
    .insert({
      organization_id: branch.organization_id,
      branch_id: appointment.branch_id,
      client_id: appointment.client_id,
      barber_id: appointment.barber_id,
      service_id: appointment.service_id,
      appointment_id: appointment.id,
      queue_entry_id: null,
      payment_method: visitPaymentMethod,
      payment_account_id: input.paymentAccountId ?? null,
      amount,
      commission_pct: 0,
      commission_amount: 0,
      started_at: now,
      completed_at: now,
      notes: input.notes?.trim() ? `[Prepago] ${input.notes.trim()}` : '[Prepago]',
    })

  if (visitError) return { error: 'Error al registrar pago: ' + visitError.message }

  // Decidir payment_status según si el amount cubre el total del servicio.
  const isFullPayment = servicePrice > 0 ? amount >= servicePrice : true
  const paymentStatus: 'paid' | 'partial' = isFullPayment ? 'paid' : 'partial'

  const { error: updateError } = await supabase
    .from('appointments')
    .update({
      status: 'confirmed',
      payment_status: paymentStatus,
      payment_amount: amount,
      payment_method: input.method,
      paid_at: now,
      paid_by_staff_id: input.staffId ?? null,
      payment_notes: input.notes?.trim() || null,
    })
    .eq('id', appointment.id)

  if (updateError) return { error: 'Error al actualizar turno: ' + updateError.message }

  // Encolar confirmación + recordatorios (no se mandaron al crear el turno).
  const dateFormatted = new Date(appointment.appointment_date + 'T12:00:00')
    .toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
  const managementUrl = await absoluteUrl(`/turnos/gestionar/${appointment.cancellation_token}`)

  await scheduleAppointmentMessages(
    {
      orgId: branch.organization_id,
      appointmentId: appointment.id,
      clientId: appointment.client_id,
      phone: appointment.client?.phone ?? '',
      clientName: appointment.client?.name ?? '',
      serviceName: appointment.service?.name ?? '',
      branchName: branch.name,
      dateFormatted,
      startTime: appointment.start_time,
      // start_time viene 'HH:MM:SS' de la DB: concatenarle ':00' daba Invalid
      // Date y ningún recordatorio se encolaba.
      appointmentDateTime: appointmentInstant(
        appointment.appointment_date,
        appointment.start_time,
        branch.timezone
      ),
      managementUrl,
      manageToken: appointment.cancellation_token,
    },
    settings,
    'create'
  )

  revalidatePath('/dashboard/turnos/agenda')
  revalidatePath('/dashboard/fila')
  revalidatePath('/dashboard/finanzas')
  revalidatePath('/dashboard/caja')
  return { success: true, amount, paymentStatus }
}

/**
 * Mapea el método de pago del turno al enum `payment_method` de visits
 * (cash/card/transfer). MercadoPago y transferencia se cuentan como transfer;
 * tarjetas como card; efectivo como cash; 'otro' como transfer (fallback).
 */
function mapAppointmentPaymentMethodToVisit(method: AppointmentPaymentMethod): 'cash' | 'card' | 'transfer' {
  switch (method) {
    case 'efectivo': return 'cash'
    case 'tarjeta_debito':
    case 'tarjeta_credito': return 'card'
    case 'transferencia':
    case 'mercadopago':
    case 'otro': return 'transfer'
  }
}

// ─── Queries ────────────────────────────────────────────────────────

/**
 * Listado público (rate-limited) de barberos habilitados para turnos en una
 * sucursal. Devuelve sólo nombre + avatar — seguro para exponer en el turnero.
 */
export async function getPublicBranchAppointmentStaff(
  branchId: string,
  opts?: {
    /**
     * Clave de rate-limit alternativa a la IP (API mobile: `auth.uid` del
     * cliente). Mismo motivo que en `getAvailableSlots`: detrás del CGNAT el
     * gate por IP+sucursal se comparte entre clientes distintos.
     */
    rateLimitKey?: string
  }
) {
  const gate = opts?.rateLimitKey
    ? await rateLimit('public_booking_list', opts.rateLimitKey, { limit: 60, window: 60 })
    : await RateLimits.publicBookingList(branchId)
  if (!gate.allowed) return []

  if (!isValidUUID(branchId)) return []

  const supabase = createAdminClient()
  const { data: branch } = await supabase
    .from('branches')
    .select('organization_id')
    .eq('id', branchId)
    .eq('is_active', true)
    .maybeSingle()

  if (!branch) return []

  const { data } = await supabase
    .from('appointment_staff')
    .select('staff_id, staff:staff_id(id, full_name, branch_id, is_active, avatar_url)')
    .eq('organization_id', branch.organization_id)
    .eq('is_active', true)

  const candidatos = (data as unknown as AppointmentStaffWithStaff[] ?? [])
    .filter((as) => as.staff?.branch_id === branchId && as.staff?.is_active)

  if (!candidatos.length) return []

  // Un barbero sin horario semanal cargado nunca va a tener slots: el motor de
  // disponibilidad lo descarta en silencio. Ofrecerlo en el wizard llevaba al
  // cliente a elegirlo y encontrarse "no hay turnos disponibles" cualquier día
  // que probara, sin ninguna explicación.
  //
  // Además devolvemos QUÉ DÍAS trabaja cada uno. En Monaco la agenda es de un
  // barbero por día (Fabri los martes, Simón los miércoles…): con eso el
  // turnero puede resolver el barbero solo, sin pedirle al cliente que elija
  // entre gente que ese día no atiende.
  const staffIds = candidatos.map(as => as.staff_id)

  // La agenda de turnos por día (mig 171) manda sobre la jornada de trabajo si
  // la sucursal la usa: en Monaco los tres barberos trabajan casi toda la
  // semana, pero los turnos rotan y el cliente sólo puede reservar el día que
  // cada uno tiene asignado.
  const [{ data: horarios }, { data: diasTurnos }, { data: franjasSucursal }] = await Promise.all([
    supabase
      .from('staff_schedules')
      .select('staff_id, day_of_week, branch_id, start_time, end_time')
      .in('staff_id', staffIds)
      .eq('is_active', true),
    supabase
      .from('appointment_staff_days')
      .select('staff_id, day_of_week, start_time, end_time')
      .eq('branch_id', branchId),
    supabase
      .from('appointment_hours')
      .select('day_of_week, start_time, end_time')
      .eq('branch_id', branchId),
  ])

  const diasPorStaff = new Map<string, Set<number>>()

  if ((diasTurnos ?? []).length > 0) {
    // Una fila SIN franja explícita significa "ese día toma turnos durante toda
    // su jornada normal", y esa jornada se sigue leyendo de `staff_schedules`:
    // si no tiene jornada cargada ese día no hay ninguna ventana y el motor lo
    // saltea en silencio (`!staffSchedules.length → continue`). Ofrecerlo igual
    // manda al cliente a "no hay turnos disponibles" — exactamente lo que este
    // filtro existe para evitar. Con franja explícita se banca solo: el motor la
    // usa como horario aunque no tenga jornada.
    const conJornada = new Set<string>()
    for (const h of horarios ?? []) {
      if (h.branch_id && h.branch_id !== branchId) continue
      conJornada.add(`${h.staff_id}|${h.day_of_week}`)
    }

    for (const d of diasTurnos ?? []) {
      const tieneFranja = !!d.start_time && !!d.end_time
      if (!tieneFranja && !conJornada.has(`${d.staff_id}|${d.day_of_week}`)) continue
      if (!diasPorStaff.has(d.staff_id)) diasPorStaff.set(d.staff_id, new Set())
      diasPorStaff.get(d.staff_id)!.add(d.day_of_week)
    }
  } else {
    // `staff_schedules` no tiene UNIQUE(staff_id, day_of_week): hay barberos con
    // la misma jornada cargada dos veces. El Set deduplica.
    for (const h of horarios ?? []) {
      if (h.branch_id && h.branch_id !== branchId) continue
      if (!diasPorStaff.has(h.staff_id)) diasPorStaff.set(h.staff_id, new Set())
      diasPorStaff.get(h.staff_id)!.add(h.day_of_week)
    }
  }

  // ─── Franjas efectivas por día ──────────────────────────────────
  //
  // "¿A qué hora atiende Fabri los martes?" no se responde con una sola tabla:
  // la ventana real es la INTERSECCIÓN de lo que la sucursal abre para turnos
  // (`appointment_hours`, o el rango único de settings si no las usa) con la
  // ventana del barbero (la franja de `appointment_staff_days` si la tiene, y
  // si no su jornada de `staff_schedules`). Es exactamente lo que hace el motor
  // slot por slot; acá se resuelve una sola vez para poder MOSTRARLO.
  //
  // Que salga del mismo criterio no es cosmético: si la pantalla dijera "de 9 a
  // 20" porque leyó sólo la jornada, el cliente elegiría al barbero y después
  // no encontraría ningún horario ofrecido en la mitad de esa franja.
  const settings = await getAppointmentSettings(branch.organization_id, branchId)

  const usaFranjasSucursal = (franjasSucursal ?? []).length > 0
  const ventanasSucursal = new Map<number, Rango[]>()
  if (usaFranjasSucursal) {
    for (const f of franjasSucursal ?? []) {
      const lista = ventanasSucursal.get(f.day_of_week) ?? []
      lista.push({ start: f.start_time.slice(0, 5), end: f.end_time.slice(0, 5) })
      ventanasSucursal.set(f.day_of_week, lista)
    }
  }

  const rangoUnico: Rango | null = settings
    ? {
        start: settings.appointment_hours_open.slice(0, 5),
        end: settings.appointment_hours_close.slice(0, 5),
      }
    : null

  function ventanaDeLaSucursal(dia: number): Rango[] {
    if (usaFranjasSucursal) return ventanasSucursal.get(dia) ?? []
    return rangoUnico ? [rangoUnico] : []
  }

  /**
   * Ventanas propias del barbero ese día, antes de cruzarlas con la sucursal.
   *
   * Son varias desde la mig 182 (día cortado). Si no tiene ninguna franja
   * explícita, la ventana es su jornada de trabajo.
   */
  function ventanaDelBarbero(staffId: string, dia: number): Rango[] {
    const conFranja = (diasTurnos ?? [])
      .filter(d => d.staff_id === staffId && d.day_of_week === dia && d.start_time && d.end_time)
      .map(d => ({ start: d.start_time!.slice(0, 5), end: d.end_time!.slice(0, 5) }))

    if (conFranja.length) return conFranja

    return (horarios ?? [])
      .filter(h => h.staff_id === staffId && h.day_of_week === dia)
      .filter(h => !h.branch_id || h.branch_id === branchId)
      .map(h => ({ start: h.start_time.slice(0, 5), end: h.end_time.slice(0, 5) }))
  }

  return candidatos
    .filter((as) => (diasPorStaff.get(as.staff_id)?.size ?? 0) > 0)
    .map((as) => {
      const dias = [...diasPorStaff.get(as.staff_id)!].sort((a, b) => a - b)
      const windows: Record<number, Rango[]> = {}
      for (const dia of dias) {
        const cruce = intersectarRangos(
          ventanaDelBarbero(as.staff_id, dia),
          ventanaDeLaSucursal(dia)
        )
        if (cruce.length) windows[dia] = cruce
      }
      return {
        id: as.staff!.id,
        full_name: as.staff!.full_name,
        avatar_url: as.staff!.avatar_url,
        days: dias,
        windows,
      }
    })
}

/**
 * Listado interno (sin rate-limit) de barberos habilitados para turnos en una
 * sucursal. Uso: dashboard/agenda, dialogs de mensajería.
 *
 * `onlyWithSchedule` (default true) descarta a los que no tienen jornada
 * cargada: el motor de disponibilidad los saltea en silencio, así que dibujar
 * su columna en la agenda es prometer huecos que nunca se van a poder reservar.
 * Rondeau tenía 6 barberos habilitados y 4 con horario; Parana, 1 y 0.
 */
export async function getBranchAppointmentStaff(
  branchId: string,
  options?: { onlyWithSchedule?: boolean; forDayOfWeek?: number }
) {
  const access = await assertBranchAccess(branchId)
  if (!access.ok) return []

  const onlyWithSchedule = options?.onlyWithSchedule ?? true

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('appointment_staff')
    .select('staff_id, staff:staff_id(id, full_name, branch_id, is_active, avatar_url)')
    .eq('organization_id', access.orgId)
    .eq('is_active', true)

  const candidatos = (data as unknown as AppointmentStaffWithStaff[] ?? [])
    .filter((as) => as.staff?.branch_id === branchId && as.staff?.is_active)

  if (!candidatos.length) return []

  const [{ data: horarios }, { data: diasTurnos }] = await Promise.all([
    supabase
      .from('staff_schedules')
      .select('staff_id, day_of_week, start_time, end_time, branch_id')
      .in('staff_id', candidatos.map(as => as.staff_id))
      .eq('is_active', true),
    supabase
      .from('appointment_staff_days')
      .select('staff_id, day_of_week, start_time, end_time')
      .eq('branch_id', branchId),
  ])

  const porStaff = new Map<string, { days: Set<number>; open: string; close: string }>()
  // Jornada del DÍA puntual, además del agregado semanal: la agenda por día
  // necesita saber la franja de ese día para poder acotarla (el agregado de toda
  // la semana sólo sirve para ensancharla).
  const jornadaPorDia = new Map<string, { open: string; close: string }>()

  for (const h of horarios ?? []) {
    if (h.branch_id && h.branch_id !== branchId) continue
    const prev = porStaff.get(h.staff_id) ?? { days: new Set<number>(), open: '23:59', close: '00:00' }
    prev.days.add(h.day_of_week)
    if (h.start_time < prev.open) prev.open = h.start_time
    if (h.end_time > prev.close) prev.close = h.end_time
    porStaff.set(h.staff_id, prev)

    const clave = `${h.staff_id}|${h.day_of_week}`
    const dia = jornadaPorDia.get(clave) ?? { open: h.start_time, close: h.end_time }
    if (h.start_time < dia.open) dia.open = h.start_time
    if (h.end_time > dia.close) dia.close = h.end_time
    jornadaPorDia.set(clave, dia)
  }

  // Si la sucursal usa agenda de turnos por día (mig 171), los días que importan
  // para la AGENDA son ésos y no la jornada de trabajo: si el martes sólo toma
  // turnos Fabri, la columna de los demás ese día es una promesa que el motor no
  // va a cumplir.
  //
  // La ventana de cada día es la franja explícita si la hay, y si no la jornada
  // de ESE día. Sembrar el acumulado con el agregado semanal (mín/máx de toda la
  // semana) hacía que una franja acotada nunca acotara nada: con jornada
  // 09:00–21:00 y agenda martes 14:00–18:00, ni `14:00 < 09:00` ni `18:00 > 21:00`
  // se cumplen y la columna quedaba abierta de 09 a 21 mientras el motor sólo
  // vendía de 14 a 18.
  if ((diasTurnos ?? []).length > 0) {
    const porDia = new Map<string, { days: Set<number>; open: string; close: string }>()
    for (const d of diasTurnos ?? []) {
      const jornada = jornadaPorDia.get(`${d.staff_id}|${d.day_of_week}`)
      const desde = d.start_time || jornada?.open
      const hasta = d.end_time || jornada?.close
      // Sin franja explícita y sin jornada ese día no hay ninguna ventana: el
      // motor saltea a ese barbero, así que dibujarle la columna limpia sería
      // prometer huecos que nunca se van a poder reservar.
      if (!desde || !hasta) continue

      const prev = porDia.get(d.staff_id) ?? { days: new Set<number>(), open: desde, close: hasta }
      prev.days.add(d.day_of_week)
      if (desde < prev.open) prev.open = desde
      if (hasta > prev.close) prev.close = hasta
      porDia.set(d.staff_id, prev)
    }
    porStaff.clear()
    for (const [k, v] of porDia) porStaff.set(k, v)
  }

  return candidatos
    .filter((as) => {
      const info = porStaff.get(as.staff_id)
      if (onlyWithSchedule && !info?.days.size) return false
      if (options?.forDayOfWeek !== undefined && info && !info.days.has(options.forDayOfWeek)) return false
      return true
    })
    .map((as) => {
      const info = porStaff.get(as.staff_id)
      return {
        id: as.staff!.id,
        full_name: as.staff!.full_name,
        avatar_url: as.staff!.avatar_url,
        days: info ? [...info.days].sort((a, b) => a - b) : [],
        works_from: info && info.open !== '23:59' ? info.open.slice(0, 5) : null,
        works_to: info && info.close !== '00:00' ? info.close.slice(0, 5) : null,
      }
    })
}

export async function getAppointmentsForDate(branchId: string, date: string) {
  const access = await assertBranchAccess(branchId)
  if (!access.ok) return []

  const supabase = createAdminClient()

  const { data } = await supabase
    .from('appointments')
    .select('*, client:client_id(id, name, phone), barber:barber_id(id, full_name), service:service_id(id, name, price, duration_minutes)')
    .eq('branch_id', branchId)
    .eq('appointment_date', date)
    .not('status', 'in', '("cancelled")')
    .order('start_time')

  return (data ?? []) as Appointment[]
}

/**
 * Vista consolidada multi-sucursal (para owner/admin). Respeta el scope.
 */
export async function getAppointmentsForDateMultiBranch(branchIds: string[], date: string) {
  const filtered = await filterBranchesByAccess(branchIds)
  if (!filtered.length) return []

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('appointments')
    .select('*, client:client_id(id, name, phone), barber:barber_id(id, full_name), branch:branch_id(id, name), service:service_id(id, name, price, duration_minutes)')
    .in('branch_id', filtered)
    .eq('appointment_date', date)
    .not('status', 'in', '("cancelled")')
    .order('start_time')

  return (data ?? []) as Appointment[]
}

export async function getAppointmentsForBarber(barberId: string, date: string) {
  const supabase = createAdminClient()

  const { data } = await supabase
    .from('appointments')
    .select('*, client:client_id(id, name, phone), service:service_id(id, name, price, duration_minutes)')
    .eq('barber_id', barberId)
    .eq('appointment_date', date)
    .not('status', 'in', '("cancelled")')
    .order('start_time')

  return (data ?? []) as Appointment[]
}

export async function getAppointmentsForClient(clientId: string) {
  const supabase = createAdminClient()

  const { data } = await supabase
    .from('appointments')
    .select('*, branch:branch_id(id, name), barber:barber_id(id, full_name), service:service_id(id, name)')
    .eq('client_id', clientId)
    .order('appointment_date', { ascending: false })
    .order('start_time', { ascending: false })
    .limit(20)

  return (data ?? []) as Appointment[]
}

export async function getAppointmentByToken(token: string) {
  const gate = await RateLimits.publicBookingManage(token)
  if (!gate.allowed) return null

  const supabase = createAdminClient()

  const { data } = await supabase
    .from('appointments')
    .select('*, branch:branch_id(id, name, address, phone), barber:barber_id(id, full_name), service:service_id(id, name, price)')
    .eq('cancellation_token', token)
    .maybeSingle()

  if (!data) return null

  // Rechazar si el token expiró
  if (data.token_expires_at && new Date(data.token_expires_at) < new Date()) {
    return null
  }

  return data as Appointment
}
