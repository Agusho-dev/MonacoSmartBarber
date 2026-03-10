'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function getStaffSchedules(staffId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('staff_schedules')
    .select('*')
    .eq('staff_id', staffId)
    .order('day_of_week')
  return { data: data ?? [], error }
}

export async function upsertSchedule(staffId: string, dayOfWeek: number, startTime: string, endTime: string, isActive: boolean) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('staff_schedules')
    .upsert(
      { staff_id: staffId, day_of_week: dayOfWeek, start_time: startTime, end_time: endTime, is_active: isActive },
      { onConflict: 'staff_id,day_of_week' }
    )
  if (error) return { error: error.message }
  revalidatePath('/dashboard/calendario')
  return { success: true }
}

export async function deleteSchedule(staffId: string, dayOfWeek: number) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('staff_schedules')
    .delete()
    .eq('staff_id', staffId)
    .eq('day_of_week', dayOfWeek)
  if (error) return { error: error.message }
  revalidatePath('/dashboard/calendario')
  return { success: true }
}

export async function getScheduleExceptions(staffId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('staff_schedule_exceptions')
    .select('*')
    .eq('staff_id', staffId)
    .gte('exception_date', new Date().toISOString().slice(0, 10))
    .order('exception_date')
  return { data: data ?? [], error }
}

export async function upsertException(staffId: string, exceptionDate: string, isAbsent: boolean, reason: string | null) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('staff_schedule_exceptions')
    .upsert(
      { staff_id: staffId, exception_date: exceptionDate, is_absent: isAbsent, reason },
      { onConflict: 'staff_id,exception_date' }
    )
  if (error) return { error: error.message }
  revalidatePath('/dashboard/calendario')
  return { success: true }
}

export async function deleteException(staffId: string, exceptionDate: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('staff_schedule_exceptions')
    .delete()
    .eq('staff_id', staffId)
    .eq('exception_date', exceptionDate)
  if (error) return { error: error.message }
  revalidatePath('/dashboard/calendario')
  return { success: true }
}

export async function getAvailableBarbersToday(branchId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_available_barbers_today', { p_branch_id: branchId })
  return { data: data ?? [], error }
}

export async function getAllBarbersWithSchedules(branchId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('staff')
    .select('id, full_name, staff_schedules(*), staff_schedule_exceptions(*)')
    .eq('branch_id', branchId)
    .eq('role', 'barber')
    .eq('is_active', true)
    .order('full_name')
  return { data: data ?? [], error }
}
