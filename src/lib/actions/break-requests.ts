'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'

async function getApproverStaffId(supabase: ReturnType<typeof createAdminClient>) {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
        const { data: staff } = await supabase
            .from('staff')
            .select('id')
            .eq('auth_user_id', user.id)
            .single()
        if (staff) return staff.id
    }
    const cookieStore = await cookies()
    const session = cookieStore.get('barber_session')
    if (session) {
        try {
            const parsed = JSON.parse(session.value)
            return parsed.staff_id as string
        } catch { }
    }
    return null
}

/**
 * Barber requests a break. Creates a pending break_request.
 */
export async function requestBreak(staffId: string, branchId: string, breakConfigId: string) {
    const supabase = await createAdminClient()

    // Check for existing pending/approved request
    const { data: existing } = await supabase
        .from('break_requests')
        .select('id')
        .eq('staff_id', staffId)
        .in('status', ['pending', 'approved'])
        .limit(1)

    if (existing && existing.length > 0) {
        return { error: 'Ya tenés una solicitud de descanso activa' }
    }

    const { error } = await supabase.from('break_requests').insert({
        staff_id: staffId,
        branch_id: branchId,
        break_config_id: breakConfigId,
    })

    if (error) return { error: error.message }
    revalidatePath('/dashboard/descansos')
    revalidatePath('/dashboard/equipo')
    revalidatePath('/barbero/cola')
    return { success: true }
}

/**
 * Approve a break request and insert a ghost entry into the queue.
 * cutsBeforeBreak: how many cuts the barber should complete before the break (0 = immediate)
 */
export async function approveBreak(requestId: string, cutsBeforeBreak: number) {
    const supabase = createAdminClient()
    const approverId = await getApproverStaffId(supabase)
    if (!approverId) return { error: 'No autorizado' }

    // Get request details
    const { data: req, error: fetchErr } = await supabase
        .from('break_requests')
        .select('id, staff_id, branch_id, break_config_id, status')
        .eq('id', requestId)
        .eq('status', 'pending')
        .single()

    if (fetchErr || !req) return { error: 'Solicitud no encontrada o ya procesada' }

    // Update request to approved
    const { error: updateErr } = await supabase
        .from('break_requests')
        .update({
            status: 'approved',
            approved_by: approverId,
            approved_at: new Date().toISOString(),
            cuts_before_break: cutsBeforeBreak,
        })
        .eq('id', requestId)

    if (updateErr) return { error: updateErr.message }

    // Calculate ghost position: find the barber's current waiting entries, then insert after N
    const ghostPosition = await calculateGhostPosition(supabase, req.staff_id, req.branch_id, cutsBeforeBreak)

    // Check if barber has an active service
    const { data: currentService } = await supabase
        .from('queue_entries')
        .select('id')
        .eq('barber_id', req.staff_id)
        .eq('status', 'in_progress')
        .eq('is_break', false)
        .maybeSingle()

    const shouldStartImmediately = cutsBeforeBreak === 0 && !currentService

    // Insert the ghost break entry into the queue
    const { error: insertErr } = await supabase.from('queue_entries').insert({
        branch_id: req.branch_id,
        client_id: null,
        barber_id: req.staff_id,
        status: shouldStartImmediately ? 'in_progress' : 'waiting',
        position: ghostPosition,
        is_break: true,
        break_request_id: req.id,
        checked_in_at: new Date().toISOString(),
        started_at: shouldStartImmediately ? new Date().toISOString() : null,
    })

    if (insertErr) return { error: insertErr.message }

    revalidatePath('/dashboard/descansos')
    revalidatePath('/dashboard/equipo')
    revalidatePath('/barbero/cola')
    return { success: true }
}

/**
 * Calculate the correct position for a ghost break entry.
 * It should be placed after the barber's next N waiting clients.
 */
async function calculateGhostPosition(
    supabase: ReturnType<typeof createAdminClient>,
    staffId: string,
    branchId: string,
    cutsBeforeBreak: number
): Promise<number> {
    // Get all waiting/in_progress entries for this branch, ordered by position
    const { data: entries } = await supabase
        .from('queue_entries')
        .select('id, position, barber_id, status, is_break')
        .eq('branch_id', branchId)
        .in('status', ['waiting', 'in_progress'])
        .order('position')

    if (!entries || entries.length === 0) return 1

    // Filter entries assigned to this barber (or unassigned) that are real clients (not breaks)
    const barberWaiting = entries.filter(
        e => e.status === 'waiting' && !e.is_break && (!e.barber_id || e.barber_id === staffId)
    )

    if (cutsBeforeBreak === 0 || barberWaiting.length === 0) {
        // Insert at the next position after any in_progress entry for this barber
        const barberInProgress = entries.find(
            e => e.status === 'in_progress' && e.barber_id === staffId && !e.is_break
        )
        if (barberInProgress) {
            if (cutsBeforeBreak === 0 && barberWaiting.length > 0) {
                return barberWaiting[0].position
            }
            return barberInProgress.position + 1
        }
        // Otherwise at the end
        if (entries.length > 0) {
            return Math.max(...entries.map(e => e.position)) + 1
        }
        return 1
    }

    // Place after the Nth waiting client of this barber
    const targetIdx = Math.min(cutsBeforeBreak, barberWaiting.length)
    const targetEntry = barberWaiting[targetIdx - 1]
    return targetEntry.position + 1
}

/**
 * Reject a break request.
 */
export async function rejectBreak(requestId: string, notes?: string) {
    const supabase = await createClient()
    const approverId = await getApproverStaffId(supabase)
    if (!approverId) return { error: 'No autorizado' }

    const { error } = await supabase
        .from('break_requests')
        .update({
            status: 'rejected',
            approved_by: approverId,
            approved_at: new Date().toISOString(),
            notes: notes || null,
        })
        .eq('id', requestId)
        .eq('status', 'pending')

    if (error) return { error: error.message }
    revalidatePath('/dashboard/descansos')
    revalidatePath('/dashboard/equipo')
    revalidatePath('/barbero/cola')
    return { success: true }
}

/**
 * Cancel a pending break request (by the barber themselves).
 * Also removes the ghost entry if the request was already approved.
 */
export async function cancelBreakRequest(requestId: string) {
    const supabase = await createAdminClient()

    // Get request status
    const { data: req } = await supabase
        .from('break_requests')
        .select('id, status')
        .eq('id', requestId)
        .in('status', ['pending', 'approved'])
        .single()

    if (!req) return { error: 'Solicitud no encontrada' }

    // If approved, remove the ghost queue entry
    if (req.status === 'approved') {
        await supabase
            .from('queue_entries')
            .delete()
            .eq('break_request_id', requestId)
            .eq('is_break', true)
            .in('status', ['waiting', 'in_progress'])
    }

    // Delete the request
    const { error } = await supabase
        .from('break_requests')
        .delete()
        .eq('id', requestId)

    if (error) return { error: error.message }
    revalidatePath('/dashboard/descansos')
    revalidatePath('/dashboard/equipo')
    revalidatePath('/barbero/cola')
    return { success: true }
}

/**
 * Complete a break (the barber finishes their break).
 * Marks the ghost queue entry as completed and the break_request as completed.
 */
export async function completeBreakRequest(queueEntryId: string) {
    const supabase = await createAdminClient()

    // Get the ghost entry
    const { data: entry } = await supabase
        .from('queue_entries')
        .select('id, break_request_id')
        .eq('id', queueEntryId)
        .eq('is_break', true)
        .eq('status', 'in_progress')
        .single()

    if (!entry) return { error: 'Descanso no encontrado o no activo' }

    // Mark ghost entry as completed
    const { error: errorQueue } = await supabase
        .from('queue_entries')
        .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
        })
        .eq('id', queueEntryId)

    if (errorQueue) return { error: errorQueue.message }

    // Mark break_request as completed
    if (entry.break_request_id) {
        const { error: errorBreak } = await supabase
            .from('break_requests')
            .update({ status: 'completed' })
            .eq('id', entry.break_request_id)

        if (errorBreak) return { error: errorBreak.message }
    }

    revalidatePath('/dashboard/descansos')
    revalidatePath('/dashboard/equipo')
    revalidatePath('/barbero/cola')
    return { success: true }
}

/**
 * Get pending/approved break requests for a branch.
 */
export async function getPendingBreakRequests(branchId: string) {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from('break_requests')
        .select('*, staff:staff_id(id, full_name), break_config:break_config_id(name, duration_minutes)')
        .eq('branch_id', branchId)
        .in('status', ['pending', 'approved'])
        .order('requested_at', { ascending: true })

    return { data: data ?? [], error }
}

/**
 * Get the barber's active (pending or approved) break request.
 */
export async function getBarberActiveBreakRequest(staffId: string) {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from('break_requests')
        .select('*, break_config:break_config_id(name, duration_minutes)')
        .eq('staff_id', staffId)
        .in('status', ['pending', 'approved'])
        .order('requested_at', { ascending: false })
        .limit(1)
        .maybeSingle()

    return { data, error }
}
