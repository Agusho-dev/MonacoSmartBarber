'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { DisciplinaryEventType, ConsequenceType } from '@/lib/types/database'

export async function getDisciplinaryRules(branchId: string) {
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
  const { error } = await supabase.from('disciplinary_rules').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/dashboard/disciplina')
  return { success: true }
}

export async function getDisciplinaryEvents(branchId: string, fromDate?: string) {
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
