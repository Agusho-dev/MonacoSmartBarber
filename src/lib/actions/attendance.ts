'use server'

import { createClient } from '@/lib/supabase/server'
import { checkTardiness } from './disciplinary'
import { revalidatePath } from 'next/cache'
import { generateCheckoutCommissionReport } from './salary'

export async function registerBarberClockIn(staffId: string, branchId: string, faceVerified: boolean) {
    const supabase = await createClient()

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
    const supabase = await createClient()

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
