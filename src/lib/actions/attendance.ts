'use server'

import { createClient } from '@/lib/supabase/server'
import { createDisciplinaryEvent } from './disciplinary'
import { revalidatePath } from 'next/cache'
import { generateCheckoutCommissionReport } from './salary'

export async function registerBarberClockIn(staffId: string, branchId: string, faceVerified: boolean) {
    const supabase = await createClient()

    // 1. Insert the attendance log
    const { error: logError } = await supabase.from('attendance_logs').insert({
        staff_id: staffId,
        branch_id: branchId,
        action_type: 'clock_in',
        face_verified: faceVerified,
    })

    if (logError) {
        return { error: 'Error al registrar entrada: ' + logError.message }
    }

    // 2. Determine current time and day of week in Argentina timezone
    const now = new Date()
    const argTimeOptions = { timeZone: 'America/Argentina/Buenos_Aires', hour12: false } as const

    // Get time string "HH:MM:SS"
    const currentTimeStr = now.toLocaleTimeString('en-US', argTimeOptions)

    // Get day of week (0-6, where 0 is Sunday, matches PostgreSQL EXTRACT(DOW))
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Argentina/Buenos_Aires',
        weekday: 'short'
    }).formatToParts(now)
    const argDayStr = parts.find(p => p.type === 'weekday')?.value || ''
    const dowMap: Record<string, number> = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 }
    const dow = dowMap[argDayStr] ?? now.getDay()

    // Today's date string "YYYY-MM-DD"
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
    const ymdFormat = formatter.format(now)

    // 3. Get ALL schedule blocks for today (handles split shifts)
    const { data: schedules } = await supabase
        .from('staff_schedules')
        .select('start_time, end_time, block_index')
        .eq('staff_id', staffId)
        .eq('day_of_week', dow)
        .eq('is_active', true)
        .order('block_index', { ascending: true })

    if (!schedules || schedules.length === 0) {
        // Sin horario configurado — no se puede detectar tardanza
        revalidatePath('/checkin')
        return { success: true }
    }

    // 4. Parse current time to minutes
    const [h1, m1] = currentTimeStr.split(':').map(Number)
    const currentMins = h1 * 60 + m1

    // 5. Find the relevant schedule block for this clock-in
    //    - If current time falls within a block [start, end] → late for that block
    //    - If current time is between blocks → early for the next one, no tardanza
    //    - If before all blocks → early, no tardanza
    let relevantBlock: { start_time: string; end_time: string } | null = null

    for (const block of schedules) {
        const [sh, sm] = block.start_time.split(':').map(Number)
        const [eh, em] = block.end_time.split(':').map(Number)
        const blockStart = sh * 60 + sm
        const blockEnd = eh * 60 + em

        if (currentMins < blockStart) {
            // Current time is before this block starts — clocking in early, no tardanza
            break
        }

        if (currentMins >= blockStart && currentMins <= blockEnd) {
            // Current time is within this block — should have started at blockStart
            relevantBlock = block
            break
        }

        // Current time is after this block's end — check next block
    }

    if (relevantBlock) {
        const [sh, sm] = relevantBlock.start_time.split(':').map(Number)
        const startMins = sh * 60 + sm

        if (currentMins > startMins) {
            // 6. Verify no tardanza already registered today for this staff
            const { count } = await supabase
                .from('disciplinary_events')
                .select('id', { count: 'exact', head: true })
                .eq('staff_id', staffId)
                .eq('branch_id', branchId)
                .eq('event_type', 'late')
                .eq('event_date', ymdFormat)

            if (!count || count === 0) {
                const notes = `Llegada tarde a las ${currentTimeStr} (Horario: ${relevantBlock.start_time})`

                await createDisciplinaryEvent(
                    staffId,
                    branchId,
                    'late',
                    ymdFormat,
                    notes,
                    null,
                    'system'
                )
            }
        }
    }

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
    // Se ejecuta en background para no bloquear el checkout
    generateCheckoutCommissionReport(staffId, branchId).catch((err) => {
        console.error('Error al generar reporte de comisión en checkout:', err)
    })

    revalidatePath('/checkin')
    return { success: true }
}
