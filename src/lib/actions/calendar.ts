'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { validateBranchAccess } from './org'

/**
 * Resuelve el branch_id de un staff y valida que pertenece a la org activa.
 * Retorna el branch_id si es válido, o null si no tiene acceso.
 */
async function validateStaffOrgAccess(staffId: string): Promise<string | null> {
  const supabase = createAdminClient()
  const { data: staff } = await supabase
    .from('staff')
    .select('branch_id')
    .eq('id', staffId)
    .eq('is_active', true)
    .maybeSingle()

  if (!staff?.branch_id) return null
  const orgAccess = await validateBranchAccess(staff.branch_id)
  return orgAccess ? staff.branch_id : null
}

export async function getStaffSchedules(staffId: string) {
  const branchId = await validateStaffOrgAccess(staffId)
  if (!branchId) return { data: [], error: 'No autorizado' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('staff_schedules')
    .select('*')
    .eq('staff_id', staffId)
    .order('day_of_week')
    .order('block_index')
  return { data: data ?? [], error }
}

export interface ScheduleBlock {
  start_time: string
  end_time: string
}

export async function saveScheduleBlocks(
  staffId: string,
  dayOfWeek: number,
  blocks: ScheduleBlock[]
) {
  const branchId = await validateStaffOrgAccess(staffId)
  if (!branchId) return { error: 'No autorizado' }

  const supabase = await createClient()

  const { error: delError } = await supabase
    .from('staff_schedules')
    .delete()
    .eq('staff_id', staffId)
    .eq('day_of_week', dayOfWeek)

  if (delError) return { error: delError.message }

  if (blocks.length > 0) {
    const rows = blocks.map((b, i) => ({
      staff_id: staffId,
      day_of_week: dayOfWeek,
      block_index: i,
      start_time: b.start_time,
      end_time: b.end_time,
      is_active: true,
    }))

    const { error: insError } = await supabase
      .from('staff_schedules')
      .insert(rows)

    if (insError) return { error: insError.message }
  }

  revalidatePath('/dashboard/calendario')
  return { success: true }
}

/** @deprecated Use saveScheduleBlocks instead */
export async function upsertSchedule(staffId: string, dayOfWeek: number, startTime: string, endTime: string, _isActive: boolean) {
  return saveScheduleBlocks(staffId, dayOfWeek, [{ start_time: startTime, end_time: endTime }])
}

export async function deleteSchedule(staffId: string, dayOfWeek: number) {
  const branchId = await validateStaffOrgAccess(staffId)
  if (!branchId) return { error: 'No autorizado' }

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
  const branchId = await validateStaffOrgAccess(staffId)
  if (!branchId) return { data: [], error: 'No autorizado' }

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
  const branchId = await validateStaffOrgAccess(staffId)
  if (!branchId) return { error: 'No autorizado' }

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
  const branchId = await validateStaffOrgAccess(staffId)
  if (!branchId) return { error: 'No autorizado' }

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
  const orgAccess = await validateBranchAccess(branchId)
  if (!orgAccess) return { data: [], error: 'No autorizado' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_available_barbers_today', { p_branch_id: branchId })
  return { data: data ?? [], error }
}

export async function getAllBarbersWithSchedules(branchId: string) {
  const orgAccess = await validateBranchAccess(branchId)
  if (!orgAccess) return { data: [], error: 'No autorizado' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('staff')
    .select('id, full_name, staff_schedules(*), staff_schedule_exceptions(*)')
    .eq('branch_id', branchId)
    .or('role.eq.barber,is_also_barber.eq.true')
    .eq('is_active', true)
    .order('full_name')
  return { data: data ?? [], error }
}

/**
 * Copia el calendario semanal del barbero `sourceStaffId` a todos los demás
 * barberos activos de la misma sucursal. Reemplaza por completo los horarios
 * de cada destino (delete + insert) — las excepciones puntuales NO se tocan.
 */
export async function copyScheduleToAllInBranch(sourceStaffId: string) {
  const branchId = await validateStaffOrgAccess(sourceStaffId)
  if (!branchId) return { error: 'No autorizado' }

  const supabase = createAdminClient()

  const { data: sourceSchedules, error: srcErr } = await supabase
    .from('staff_schedules')
    .select('day_of_week, block_index, start_time, end_time, is_active')
    .eq('staff_id', sourceStaffId)
    .order('day_of_week')
    .order('block_index')

  if (srcErr) return { error: srcErr.message }

  const { data: targets, error: tgtErr } = await supabase
    .from('staff')
    .select('id')
    .eq('branch_id', branchId)
    .or('role.eq.barber,is_also_barber.eq.true')
    .eq('is_active', true)
    .neq('id', sourceStaffId)

  if (tgtErr) return { error: tgtErr.message }
  if (!targets || targets.length === 0) {
    return { error: 'No hay otros barberos en esta sucursal' }
  }

  const targetIds = targets.map((t) => t.id)

  const { error: delErr } = await supabase
    .from('staff_schedules')
    .delete()
    .in('staff_id', targetIds)

  if (delErr) return { error: delErr.message }

  if (sourceSchedules && sourceSchedules.length > 0) {
    const rows = targetIds.flatMap((staffId) =>
      sourceSchedules.map((s) => ({
        staff_id: staffId,
        day_of_week: s.day_of_week,
        block_index: s.block_index,
        start_time: s.start_time,
        end_time: s.end_time,
        is_active: s.is_active,
      }))
    )
    const { error: insErr } = await supabase.from('staff_schedules').insert(rows)
    if (insErr) return { error: insErr.message }
  }

  revalidatePath('/dashboard/calendario')
  revalidatePath('/dashboard/equipo')
  return { success: true, count: targetIds.length }
}
