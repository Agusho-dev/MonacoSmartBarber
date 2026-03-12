'use server'

import { createClient } from '@/lib/supabase/server'
import { createDisciplinaryEvent } from './disciplinary'
import { revalidatePath } from 'next/cache'

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
    const argTimeOptions = { timeZone: 'America/Argentina/Buenos_Aires', hour12: false }

    // Get time string "HH:MM:SS"
    const currentTimeStr = now.toLocaleTimeString('en-US', argTimeOptions)

    // Get day of week (0-6, where 0 is Sunday, which matches PostgreSQL EXTRACT(DOW))
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Argentina/Buenos_Aires',
        weekday: 'short'
    }).formatToParts(now)
    const argDayStr = parts.find(p => p.type === 'weekday')?.value || ''
    const dowMap: Record<string, number> = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 }
    const dow = dowMap[argDayStr] ?? now.getDay()

    // Today's date string "YYYY-MM-DD"
    const dateStr = [
        now.toLocaleDateString('en-US', { ...argTimeOptions, year: 'numeric' }),
        now.toLocaleDateString('en-US', { ...argTimeOptions, month: '2-digit' }),
        now.toLocaleDateString('en-US', { ...argTimeOptions, day: '2-digit' })
    ].join('-')
    // Note: the above format might be MM-DD-YYYY depending on locale, safer way:
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
    const ymdFormat = formatter.format(now) // YYYY-MM-DD

    // 3. Find the earliest schedule block for today
    const { data: schedule } = await supabase
        .from('staff_schedules')
        .select('start_time')
        .eq('staff_id', staffId)
        .eq('day_of_week', dow)
        .eq('is_active', true)
        .order('block_index', { ascending: true })
        .limit(1)
        .maybeSingle()

    if (schedule && schedule.start_time) {
        // 4. Compare current time with start time
        // Optionally add a grace period (e.g. 5 minutes)
        const [h1, m1, s1] = currentTimeStr.split(':').map(Number)
        const currentMins = h1 * 60 + m1

        const [h2, m2, s2] = schedule.start_time.split(':').map(Number)
        const gracePeriodMins = 0 // Assuming 0 minutes grace period
        const startMins = h2 * 60 + m2 + gracePeriodMins

        if (currentMins > startMins) {
            // Barber is late!
            // 5. Create a disciplinary event
            const lateMins = currentMins - startMins
            const notes = `Llegada tarde a las ${currentTimeStr} (Horario: ${schedule.start_time})`

            await createDisciplinaryEvent(
                staffId,
                branchId,
                'late',
                ymdFormat,
                notes,
                null, // automatically created by system,
                'system'
            )
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

    revalidatePath('/checkin')
    return { success: true }
}
