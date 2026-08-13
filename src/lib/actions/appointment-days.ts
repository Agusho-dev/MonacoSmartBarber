'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { isValidUUID } from '@/lib/validation'
import { assertBranchAccess } from './branch-access'
import { currentUserCan } from './permissions-gate'

/**
 * Agenda de turnos por día: quién toma TURNOS cada día en cada sucursal.
 *
 * Es un eje distinto de `staff_schedules`, que es la jornada de trabajo (la que
 * usan el fichaje, las tardanzas y el calendario). En Monaco los barberos
 * trabajan casi todos los días atendiendo walk-in, pero la agenda de turnos es
 * rotativa: Fabri los martes, Simón los miércoles, Nico los jueves. Con una
 * sola tabla, decir "Fabri sólo los martes" lo sacaba del walk-in y de la
 * asistencia el resto de la semana.
 *
 * Ver `supabase/migrations/171_appointment_staff_days.sql`.
 */

export interface DiaDeTurnos {
  staff_id: string
  day_of_week: number
  /** NULL = toma turnos durante toda su jornada normal de ese día. */
  start_time: string | null
  end_time: string | null
}

/**
 * Días de turnos cargados para la sucursal.
 *
 * `usaAgendaPorDia` es la señal que decide el comportamiento del motor: mientras
 * sea `false` la sucursal sigue con el modelo viejo (candidatos = quienes tengan
 * jornada ese día). Apenas hay una fila, la sucursal pasa al modelo por día y un
 * día sin nadie asignado deja de ofrecer horarios — que es exactamente lo que se
 * quiere de una agenda rotativa.
 */
export async function getBranchAppointmentDays(
  branchId: string
): Promise<{ dias: DiaDeTurnos[]; usaAgendaPorDia: boolean }> {
  if (!isValidUUID(branchId)) return { dias: [], usaAgendaPorDia: false }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('appointment_staff_days')
    .select('staff_id, day_of_week, start_time, end_time')
    .eq('branch_id', branchId)

  if (error) {
    console.error('[getBranchAppointmentDays]', error.message)
    return { dias: [], usaAgendaPorDia: false }
  }

  const dias = (data ?? []).map(d => ({
    staff_id: d.staff_id,
    day_of_week: d.day_of_week,
    start_time: d.start_time ? d.start_time.slice(0, 5) : null,
    end_time: d.end_time ? d.end_time.slice(0, 5) : null,
  }))

  return { dias, usaAgendaPorDia: dias.length > 0 }
}

/**
 * Reemplaza los días de turnos de UN barbero en una sucursal.
 *
 * Delete + insert acotado a (branch, staff): así el guardado es idempotente y no
 * hay que diffear del lado del cliente. Pasar `[]` lo saca de la agenda de
 * turnos sin tocarle la jornada de trabajo.
 */
export async function saveBarberAppointmentDays(
  branchId: string,
  staffId: string,
  dias: Array<{ day_of_week: number; start_time?: string | null; end_time?: string | null }>
): Promise<{ success: true } | { error: string }> {
  if (!isValidUUID(branchId)) return { error: 'Sucursal inválida' }
  if (!isValidUUID(staffId)) return { error: 'Barbero inválido' }

  const access = await assertBranchAccess(branchId)
  if (!access.ok) return { error: 'Sin acceso a esta sucursal' }

  if (!(await currentUserCan('appointments.configure'))) {
    return { error: 'No tenés permiso para configurar turnos' }
  }

  const supabase = createAdminClient()

  // El barbero tiene que pertenecer a esta sucursal: sin este chequeo se podría
  // agendar a alguien de otra sucursal (o de otra org) mandando su UUID.
  const { data: staff } = await supabase
    .from('staff')
    .select('id, branch_id, organization_id')
    .eq('id', staffId)
    .eq('organization_id', access.orgId)
    .maybeSingle()

  if (!staff || staff.branch_id !== branchId) {
    return { error: 'Ese barbero no pertenece a esta sucursal' }
  }

  // Varias filas por día desde la mig 182 (día cortado: "10 a 13 y 16 a 19").
  // El solape se valida acá y no con un constraint porque esta función
  // reescribe TODOS los días del barbero de una sola vez, así que es el único
  // lugar que ve el conjunto completo y ordenado — mismo criterio que
  // `saveBranchAppointmentHours` con `appointment_hours`.
  const porDia = new Map<number, Array<{ start_time: string | null; end_time: string | null }>>()

  for (const d of dias) {
    const dow = Number(d.day_of_week)
    if (!Number.isInteger(dow) || dow < 0 || dow > 6) {
      return { error: 'Día inválido' }
    }
    const desde = d.start_time ? d.start_time.slice(0, 5) : null
    const hasta = d.end_time ? d.end_time.slice(0, 5) : null
    if ((desde === null) !== (hasta === null)) {
      return { error: 'Cargá las dos horas o ninguna' }
    }
    if (desde && hasta && hasta <= desde) {
      return { error: 'La hora de fin tiene que ser posterior a la de inicio' }
    }
    porDia.set(dow, [...(porDia.get(dow) ?? []), { start_time: desde, end_time: hasta }])
  }

  const limpios: Array<{ day_of_week: number; start_time: string | null; end_time: string | null }> = []

  for (const [dow, franjas] of porDia) {
    const conHorario = franjas.filter(f => f.start_time && f.end_time)

    // "Toda su jornada" es una afirmación sobre el día entero: no convive con
    // franjas acotadas ni consigo misma. Si vienen las dos cosas mandan las
    // acotadas, que son las explícitas.
    if (!conHorario.length) {
      limpios.push({ day_of_week: dow, start_time: null, end_time: null })
      continue
    }

    const ordenadas = [...conHorario].sort((a, b) => a.start_time!.localeCompare(b.start_time!))
    let anterior: string | null = null
    for (const f of ordenadas) {
      if (anterior !== null && f.start_time! < anterior) {
        return { error: 'Ese barbero tiene dos franjas superpuestas en el mismo día' }
      }
      anterior = f.end_time!
      limpios.push({ day_of_week: dow, start_time: f.start_time, end_time: f.end_time })
    }
  }

  const { error: delError } = await supabase
    .from('appointment_staff_days')
    .delete()
    .eq('branch_id', branchId)
    .eq('staff_id', staffId)

  if (delError) {
    console.error('[saveBarberAppointmentDays] delete:', delError.message)
    return { error: 'No pudimos guardar los días' }
  }

  if (limpios.length > 0) {
    const filas = limpios.map(f => ({
      organization_id: access.orgId,
      branch_id: branchId,
      staff_id: staffId,
      day_of_week: f.day_of_week,
      start_time: f.start_time,
      end_time: f.end_time,
    }))

    const { error: insError } = await supabase
      .from('appointment_staff_days')
      .insert(filas)

    if (insError) {
      console.error('[saveBarberAppointmentDays] insert:', insError.message)
      return { error: 'No pudimos guardar los días' }
    }
  }

  revalidatePath('/dashboard/turnos/configuracion')
  revalidatePath('/dashboard/turnos/agenda')
  return { success: true }
}
