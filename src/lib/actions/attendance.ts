'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { checkTardiness } from './disciplinary'
import { revalidatePath } from 'next/cache'
import { generateCheckoutCommissionReport } from './salary'

/**
 * Valida que el staffId pertenece al branchId indicado, que ambos existen,
 * y que pertenecen a la misma organización.
 * El panel barbero usa PIN auth (sin sesión Supabase), por lo que no se puede
 * usar el cliente SSR para estas operaciones.
 */
async function validateStaffBelongsToBranch(staffId: string, branchId: string): Promise<boolean> {
  const supabase = createAdminClient()
  const [{ data: staff }, { data: branch }] = await Promise.all([
    supabase
      .from('staff')
      .select('id, organization_id')
      .eq('id', staffId)
      .eq('branch_id', branchId)
      .eq('is_active', true)
      .maybeSingle(),
    supabase
      .from('branches')
      .select('organization_id')
      .eq('id', branchId)
      .eq('is_active', true)
      .maybeSingle(),
  ])
  if (!staff?.organization_id || !branch?.organization_id) return false
  return staff.organization_id === branch.organization_id
}

export async function registerBarberClockIn(staffId: string, branchId: string, faceVerified: boolean) {
    // Validar que el barbero pertenece a la sucursal antes de registrar asistencia
    const isValid = await validateStaffBelongsToBranch(staffId, branchId)
    if (!isValid) {
        return { error: 'Barbero no encontrado en esta sucursal' }
    }

    const supabase = createAdminClient()

    const { error: logError } = await supabase.from('attendance_logs').insert({
        staff_id: staffId,
        branch_id: branchId,
        action_type: 'clock_in',
        face_verified: faceVerified,
    })

    if (logError) {
        return { error: 'Error al registrar entrada: ' + logError.message }
    }

    // Verificar tardanza en background (toda la lógica vive en disciplinary.ts)
    checkTardiness(staffId, branchId).catch((err) => {
        console.error('Error al verificar tardanza:', err)
    })

    revalidatePath('/checkin')
    return { success: true }
}

export async function registerBarberClockOut(staffId: string, branchId: string, faceVerified: boolean) {
    // Validar que el barbero pertenece a la sucursal antes de registrar asistencia
    const isValid = await validateStaffBelongsToBranch(staffId, branchId)
    if (!isValid) {
        return { error: 'Barbero no encontrado en esta sucursal' }
    }

    const supabase = createAdminClient()

    const { error: logError } = await supabase.from('attendance_logs').insert({
        staff_id: staffId,
        branch_id: branchId,
        action_type: 'clock_out',
        face_verified: faceVerified,
    })

    if (logError) {
        return { error: 'Error al registrar salida: ' + logError.message }
    }

    // Generar reporte de comisión automático para el turno
    generateCheckoutCommissionReport(staffId, branchId).catch((err) => {
        console.error('Error al generar reporte de comisión en checkout:', err)
    })

    revalidatePath('/checkin')
    return { success: true }
}
