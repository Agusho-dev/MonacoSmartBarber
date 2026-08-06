'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { isValidUUID } from '@/lib/validation'
import { assertBranchAccess } from './branch-access'
import { currentUserCan } from './permissions-gate'

/**
 * Franjas en las que la sucursal acepta turnos, por día y con tramos.
 *
 * Reemplaza al par único `appointment_hours_open/close` + `appointment_days`,
 * que sólo podía expresar "de X a Y, todos los días habilitados". Lo que hace
 * falta es "doy turnos sólo en las horas flojas": martes de 10 a 13 y de 16 a
 * 19, jueves de 13 a 17, sábado nada.
 *
 * Ver `supabase/migrations/172_appointment_hours_windows.sql`.
 */

export interface Franja {
  start_time: string   // 'HH:MM'
  end_time: string     // 'HH:MM'
}

/** Franjas por día (0=domingo … 6=sábado). */
export type FranjasSemana = Record<number, Franja[]>

export interface HorarioTurnero {
  franjas: FranjasSemana
  /**
   * `false` = la sucursal todavía no definió franjas y sigue con el modelo
   * viejo. El motor sólo cambia de comportamiento cuando hay al menos una.
   */
  usaFranjas: boolean
}

export async function getBranchAppointmentHours(branchId: string): Promise<HorarioTurnero> {
  const vacio: FranjasSemana = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] }
  if (!isValidUUID(branchId)) return { franjas: vacio, usaFranjas: false }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('appointment_hours')
    .select('day_of_week, start_time, end_time')
    .eq('branch_id', branchId)
    .order('day_of_week')
    .order('start_time')

  if (error) {
    console.error('[getBranchAppointmentHours]', error.message)
    return { franjas: vacio, usaFranjas: false }
  }

  const franjas: FranjasSemana = { ...vacio }
  for (const f of data ?? []) {
    franjas[f.day_of_week] = [
      ...(franjas[f.day_of_week] ?? []),
      { start_time: f.start_time.slice(0, 5), end_time: f.end_time.slice(0, 5) },
    ]
  }

  return { franjas, usaFranjas: (data ?? []).length > 0 }
}

/**
 * Reemplaza TODAS las franjas de la sucursal.
 *
 * Delete + insert de la semana entera: el editor visual maneja los 7 días a la
 * vez y diffear tramo por tramo del lado del cliente sólo agregaría formas de
 * quedar a medio guardar.
 */
export async function saveBranchAppointmentHours(
  branchId: string,
  franjas: FranjasSemana
): Promise<{ success: true } | { error: string }> {
  if (!isValidUUID(branchId)) return { error: 'Sucursal inválida' }

  const access = await assertBranchAccess(branchId)
  if (!access.ok) return { error: 'Sin acceso a esta sucursal' }

  if (!(await currentUserCan('appointments.configure'))) {
    return { error: 'No tenés permiso para configurar turnos' }
  }

  const filas: Array<{
    organization_id: string
    branch_id: string
    day_of_week: number
    start_time: string
    end_time: string
  }> = []

  for (let dia = 0; dia <= 6; dia++) {
    const delDia = (franjas[dia] ?? [])
      .map(f => ({ start_time: (f.start_time ?? '').slice(0, 5), end_time: (f.end_time ?? '').slice(0, 5) }))
      .filter(f => /^\d{2}:\d{2}$/.test(f.start_time) && /^\d{2}:\d{2}$/.test(f.end_time))
      .sort((a, b) => a.start_time.localeCompare(b.start_time))

    let anterior: string | null = null
    for (const f of delDia) {
      if (f.end_time <= f.start_time) {
        return { error: 'Cada franja tiene que terminar después de empezar' }
      }
      // Los tramos del mismo día no pueden pisarse: dos ventanas superpuestas
      // generarían el mismo horario dos veces en la grilla del cliente.
      if (anterior !== null && f.start_time < anterior) {
        return { error: 'Hay franjas superpuestas en el mismo día' }
      }
      anterior = f.end_time
      filas.push({
        organization_id: access.orgId,
        branch_id: branchId,
        day_of_week: dia,
        start_time: f.start_time,
        end_time: f.end_time,
      })
    }
  }

  const supabase = createAdminClient()

  const { error: delError } = await supabase
    .from('appointment_hours')
    .delete()
    .eq('branch_id', branchId)

  if (delError) {
    console.error('[saveBranchAppointmentHours] delete:', delError.message)
    return { error: 'No pudimos guardar los horarios' }
  }

  if (filas.length > 0) {
    const { error: insError } = await supabase.from('appointment_hours').insert(filas)
    if (insError) {
      console.error('[saveBranchAppointmentHours] insert:', insError.message)
      return { error: 'No pudimos guardar los horarios' }
    }
  }

  revalidatePath('/dashboard/turnos/configuracion')
  revalidatePath('/dashboard/turnos/agenda')
  return { success: true }
}
