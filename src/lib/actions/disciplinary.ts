'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { DisciplinaryEvent, DisciplinaryEventType, ConsequenceType } from '@/lib/types/database'
import { getCurrentOrgId, validateBranchAccess } from './org'
import { getScopedBranchIds } from './branch-access'
import { currentUserCan } from './permissions-gate'
import { getActiveTimezone } from '@/lib/i18n'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { esMes, limitesDelMes, SELECT_EVENTO_DISCIPLINA } from '@/lib/disciplina-mes'

export interface DisciplinaDelMes {
  events: (Omit<DisciplinaryEvent, 'staff'> & {
    staff?: { id: string; full_name: string; branch_id: string | null } | null
  })[]
  attendanceLogs: {
    id: string
    staff_id: string
    branch_id: string
    action_type: 'clock_in' | 'clock_out'
    recorded_at: string
    face_verified: boolean
  }[]
  /** Quién aparece en ese mes, aunque hoy ya no esté activo: si no, salía como "Personal". */
  personal: { id: string; full_name: string; branch_id: string | null; role?: string }[]
}

/**
 * Eventos y fichadas de un mes completo, para mirar meses pasados. El mes en curso
 * sigue llegando por props desde la página.
 *
 * Se pagina y en modo estricto: un mes entero de todas las sucursales supera las
 * 1.000 filas de PostgREST y, ordenado del más nuevo al más viejo, lo que se corta
 * son los primeros días. Acá se mira si alguien cumplió: un mes a medias presentado
 * como completo es peor que un "no se pudo cargar".
 */
export async function getDisciplinaDelMes(
  mes: string,
): Promise<DisciplinaDelMes | { error: string }> {
  if (!esMes(mes)) return { error: 'Mes inválido' }
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'No autorizado' }
  if (!(await currentUserCan('discipline.view'))) {
    return { error: 'No tenés permiso para ver la disciplina del equipo.' }
  }
  const branchIds = await getScopedBranchIds()
  if (branchIds.length === 0) return { events: [], attendanceLogs: [], personal: [] }

  const { desdeFecha, hastaFecha, desdeIso, hastaIso } = limitesDelMes(mes, await getActiveTimezone())
  const supabase = createAdminClient()

  try {
    const [events, attendanceLogs] = await Promise.all([
      fetchAll<DisciplinaDelMes['events'][number]>(
        (from, to) =>
          supabase
            .from('disciplinary_events')
            .select(SELECT_EVENTO_DISCIPLINA)
            .in('branch_id', branchIds)
            .gte('event_date', desdeFecha)
            .lt('event_date', hastaFecha)
            .order('event_date', { ascending: false })
            .order('id')
            .range(from, to),
        { estricto: true, contexto: 'disciplina: eventos del mes' },
      ),
      fetchAll<DisciplinaDelMes['attendanceLogs'][number]>(
        (from, to) =>
          supabase
            .from('attendance_logs')
            .select('id, staff_id, branch_id, action_type, recorded_at, face_verified')
            .in('branch_id', branchIds)
            .gte('recorded_at', desdeIso)
            .lt('recorded_at', hastaIso)
            .order('recorded_at', { ascending: false })
            .order('id')
            .range(from, to),
        { estricto: true, contexto: 'disciplina: fichadas del mes' },
      ),
    ])

    const ids = [...new Set([...events.map((e) => e.staff_id), ...attendanceLogs.map((l) => l.staff_id)])]
    let personal: DisciplinaDelMes['personal'] = []
    if (ids.length > 0) {
      const { data, error } = await supabase
        .from('staff')
        .select('id, full_name, branch_id, role')
        .eq('organization_id', orgId)
        .in('id', ids)
      if (error) throw new Error(error.message)
      personal = data ?? []
    }
    return { events, attendanceLogs, personal }
  } catch (err) {
    console.error('[getDisciplinaDelMes]', mes, (err as Error).message)
    return { error: 'No se pudo cargar ese mes. Probá de nuevo.' }
  }
}

export async function getDisciplinaryRules(branchId: string) {
  const orgId = await validateBranchAccess(branchId)
  if (!orgId) return { data: [], error: 'No autorizado' }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('disciplinary_rules')
    .select('*')
    .eq('branch_id', branchId)
    .order('event_type')
    .order('occurrence_number')
  return { data: data ?? [], error }
}

export async function upsertDisciplinaryRule(
  branchId: string,
  eventType: DisciplinaryEventType,
  occurrenceNumber: number,
  consequence: ConsequenceType,
  deductionAmount: number | null,
  description: string | null
) {
  const orgId = await validateBranchAccess(branchId)
  if (!orgId) return { error: 'No autorizado' }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('disciplinary_rules')
    .upsert(
      { branch_id: branchId, event_type: eventType, occurrence_number: occurrenceNumber, consequence, deduction_amount: deductionAmount, description },
      { onConflict: 'branch_id,event_type,occurrence_number' }
    )
  if (error) return { error: error.message }
  revalidatePath('/dashboard/disciplina')
  return { success: true }
}

export async function deleteDisciplinaryRule(id: string) {
  const supabase = createAdminClient()
  // Obtener la regla para verificar ownership antes de borrar
  const { data: rule } = await supabase
    .from('disciplinary_rules')
    .select('branch_id')
    .eq('id', id)
    .single()
  if (!rule) return { error: 'Regla no encontrada' }
  const orgId = await validateBranchAccess(rule.branch_id)
  if (!orgId) return { error: 'No autorizado' }

  const { error } = await supabase.from('disciplinary_rules').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/dashboard/disciplina')
  return { success: true }
}

export async function getDisciplinaryEvents(branchId: string, fromDate?: string) {
  const orgId = await validateBranchAccess(branchId)
  if (!orgId) return { data: [], error: 'No autorizado' }

  const supabase = createAdminClient()
  let query = supabase
    .from('disciplinary_events')
    .select(SELECT_EVENTO_DISCIPLINA)
    .eq('branch_id', branchId)
    .order('event_date', { ascending: false })

  if (fromDate) query = query.gte('event_date', fromDate)

  const { data, error } = await query
  return { data: data ?? [], error }
}

export async function createDisciplinaryEvent(
  staffId: string,
  branchId: string,
  eventType: DisciplinaryEventType,
  eventDate: string,
  notes: string | null,
  createdBy: string | null,
  source: string = 'manual'
) {
  // Autorización SIEMPRE. Antes esto estaba envuelto en `if (source !== 'system')`, y como
  // `source` lo controla el caller, un POST directo con source='system' salteaba TODO el gate
  // y podía fabricar eventos disciplinarios (con descuento) en cualquier org/sucursal. Los
  // eventos automáticos de tardanza los inserta ahora checkTardiness() inline (server-side
  // interno), no por acá, así que este path exige sesión sin excepción.
  const orgId = await validateBranchAccess(branchId)
  if (!orgId) return { error: 'No autorizado' }

  // Escrituras de disciplina: service role + autorización en app (validateBranchAccess arriba).
  const supabase = createAdminClient()

  // Validar que el staff pertenece al branch indicado
  const { data: staffRow } = await supabase
    .from('staff')
    .select('branch_id')
    .eq('id', staffId)
    .maybeSingle()
  if (!staffRow || staffRow.branch_id !== branchId) {
    return { error: 'El barbero no pertenece a esta sucursal' }
  }

  // Count previous occurrences this month
  const startOfMonth = eventDate.slice(0, 7) + '-01'
  const { data: countData } = await supabase.rpc('get_occurrence_count', {
    p_staff_id: staffId,
    p_event_type: eventType,
    p_from_date: startOfMonth,
  })
  const occurrenceNumber = (countData ?? 0) + 1

  // Find applicable rule
  const { data: rule } = await supabase
    .from('disciplinary_rules')
    .select('consequence, deduction_amount')
    .eq('branch_id', branchId)
    .eq('event_type', eventType)
    .eq('occurrence_number', occurrenceNumber)
    .single()

  const { error } = await supabase.from('disciplinary_events').insert({
    staff_id: staffId,
    branch_id: branchId,
    event_type: eventType,
    event_date: eventDate,
    occurrence_number: occurrenceNumber,
    consequence_applied: rule?.consequence ?? null,
    deduction_amount: rule?.deduction_amount ?? null,
    notes,
    created_by: createdBy,
    source,
  })

  if (error) return { error: error.message }
  revalidatePath('/dashboard/disciplina')
  return { success: true, occurrenceNumber, consequence: rule?.consequence ?? null }
}

export async function getBarberDisciplinarySummary(branchId: string) {
  const orgId = await validateBranchAccess(branchId)
  if (!orgId) return { summary: [], fromDate: '' }

  const supabase = createAdminClient()
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  const fromDate = startOfMonth.toISOString().slice(0, 10)

  const { data: barbers } = await supabase
    .from('staff')
    .select('id, full_name')
    .eq('branch_id', branchId)
    .or('role.eq.barber,is_also_barber.eq.true')
    .eq('is_active', true)
    .order('full_name')

  const { data: events } = await supabase
    .from('disciplinary_events')
    .select('staff_id, event_type, consequence_applied, event_date')
    .eq('branch_id', branchId)
    .gte('event_date', fromDate)

  const summary = (barbers ?? []).map((b) => {
    const barberEvents = (events ?? []).filter((e) => e.staff_id === b.id)
    const absences = barberEvents.filter((e) => e.event_type === 'absence').length
    const lates = barberEvents.filter((e) => e.event_type === 'late').length
    return { ...b, absences, lates }
  })

  return { summary, fromDate }
}

/**
 * Verifica si un barbero llegó tarde comparando la hora actual contra su horario.
 * Si detecta tardanza, crea automáticamente un evento disciplinario.
 * Extraída de attendance.ts para mantener toda la lógica disciplinaria en un solo lugar.
 */
export async function checkTardiness(staffId: string, branchId: string) {
  const supabase = createAdminClient()

  // Guard: el evento sólo aplica si el staff realmente pertenece (y está activo en) esa
  // sucursal. checkTardiness es una server action exportada; sin este chequeo, un POST directo
  // podría fabricar tardanzas (con descuento) para staff/sucursal arbitrarios. Su único caller
  // legítimo (registerBarberClockIn) ya valida este mismo pairing antes de invocarla.
  const { data: staffRow } = await supabase
    .from('staff')
    .select('branch_id, is_active')
    .eq('id', staffId)
    .maybeSingle()
  if (!staffRow || !staffRow.is_active || staffRow.branch_id !== branchId) return

  const tz = await getActiveTimezone()
  const now = new Date()
  const argTimeOptions = { timeZone: tz, hour12: false } as const

  // Hora actual "HH:MM:SS"
  const currentTimeStr = now.toLocaleTimeString('en-US', argTimeOptions)

  // Día de la semana (0-6, donde 0 = domingo)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short'
  }).formatToParts(now)
  const argDayStr = parts.find(p => p.type === 'weekday')?.value || ''
  const dowMap: Record<string, number> = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 }
  const dow = dowMap[argDayStr] ?? now.getDay()

  // Fecha "YYYY-MM-DD"
  const ymdFormat = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now)

  // Obtener bloques de horario del día
  const { data: schedules } = await supabase
    .from('staff_schedules')
    .select('start_time, end_time, block_index')
    .eq('staff_id', staffId)
    .eq('day_of_week', dow)
    .eq('is_active', true)
    .order('block_index', { ascending: true })

  if (!schedules || schedules.length === 0) return

  // Parsear hora actual a minutos
  const [h1, m1] = currentTimeStr.split(':').map(Number)
  const currentMins = h1 * 60 + m1

  // Encontrar el bloque relevante
  let relevantBlock: { start_time: string; end_time: string } | null = null
  for (const block of schedules) {
    const [sh, sm] = block.start_time.split(':').map(Number)
    const [eh, em] = block.end_time.split(':').map(Number)
    const blockStart = sh * 60 + sm
    const blockEnd = eh * 60 + em

    if (currentMins < blockStart) break
    if (currentMins >= blockStart && currentMins <= blockEnd) {
      relevantBlock = block
      break
    }
  }

  if (!relevantBlock) return

  const [sh, sm] = relevantBlock.start_time.split(':').map(Number)
  const startMins = sh * 60 + sm

  if (currentMins <= startMins) return

  // Verificar que no haya tardanza ya registrada hoy
  const { count } = await supabase
    .from('disciplinary_events')
    .select('id', { count: 'exact', head: true })
    .eq('staff_id', staffId)
    .eq('branch_id', branchId)
    .eq('event_type', 'late')
    .eq('event_date', ymdFormat)

  if (count && count > 0) return

  // Insertamos el evento inline (NO via createDisciplinaryEvent): ese action ahora exige
  // sesión y acá corremos fire-and-forget desde el clock-in, sin contexto de cookies. El
  // staff-pertenece-a-sucursal ya está validado en el guard de arriba.
  const startOfMonth = ymdFormat.slice(0, 7) + '-01'
  const { data: countData } = await supabase.rpc('get_occurrence_count', {
    p_staff_id: staffId,
    p_event_type: 'late',
    p_from_date: startOfMonth,
  })
  const occurrenceNumber = (countData ?? 0) + 1

  const { data: rule } = await supabase
    .from('disciplinary_rules')
    .select('consequence, deduction_amount')
    .eq('branch_id', branchId)
    .eq('event_type', 'late')
    .eq('occurrence_number', occurrenceNumber)
    .single()

  const notes = `Llegada tarde a las ${currentTimeStr} (Horario: ${relevantBlock.start_time})`
  const { error } = await supabase.from('disciplinary_events').insert({
    staff_id: staffId,
    branch_id: branchId,
    event_type: 'late',
    event_date: ymdFormat,
    occurrence_number: occurrenceNumber,
    consequence_applied: rule?.consequence ?? null,
    deduction_amount: rule?.deduction_amount ?? null,
    notes,
    created_by: null,
    source: 'system',
  })
  if (error) {
    console.error('[checkTardiness] insert disciplinary_event', error.message)
    return
  }
  revalidatePath('/dashboard/disciplina')
}
