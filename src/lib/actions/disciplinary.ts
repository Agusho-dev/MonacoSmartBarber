'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { DisciplinaryEventType, ConsequenceType } from '@/lib/types/database'
import { validateBranchAccess } from './org'

export async function getDisciplinaryRules(branchId: string) {
  const orgId = await validateBranchAccess(branchId)
  if (!orgId) return { data: [], error: 'No autorizado' }

  const supabase = await createClient()
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

  const supabase = await createClient()
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
  const supabase = await createClient()
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

  const supabase = await createClient()
  let query = supabase
    .from('disciplinary_events')
    .select('*, staff:staff(id, full_name)')
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
  // Las llamadas con source='system' provienen de checkTardiness (interno), sin contexto de usuario
  if (source !== 'system') {
    const orgId = await validateBranchAccess(branchId)
    if (!orgId) return { error: 'No autorizado' }
  }

  const supabase = source === 'system' ? createAdminClient() : await createClient()

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

  const supabase = await createClient()
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  const fromDate = startOfMonth.toISOString().slice(0, 10)

  const { data: barbers } = await supabase
    .from('staff')
    .select('id, full_name')
    .eq('branch_id', branchId)
    .eq('role', 'barber')
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

  const now = new Date()
  const argTimeOptions = { timeZone: 'America/Argentina/Buenos_Aires', hour12: false } as const

  // Hora actual "HH:MM:SS"
  const currentTimeStr = now.toLocaleTimeString('en-US', argTimeOptions)

  // Día de la semana (0-6, donde 0 = domingo)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires',
    weekday: 'short'
  }).formatToParts(now)
  const argDayStr = parts.find(p => p.type === 'weekday')?.value || ''
  const dowMap: Record<string, number> = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 }
  const dow = dowMap[argDayStr] ?? now.getDay()

  // Fecha "YYYY-MM-DD"
  const ymdFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(now)

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

  const notes = `Llegada tarde a las ${currentTimeStr} (Horario: ${relevantBlock.start_time})`
  await createDisciplinaryEvent(staffId, branchId, 'late', ymdFormat, notes, null, 'system')
}
