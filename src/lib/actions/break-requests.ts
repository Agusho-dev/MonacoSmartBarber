'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'

async function getApproverStaffId(supabase: any) {
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

export async function requestBreak(staffId: string, branchId: string, breakConfigId: string) {
    const supabase = await createClient()

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
    revalidatePath('/barbero/cola')
    return { success: true }
}

export async function approveBreak(requestId: string) {
    const supabase = await createClient()
    const approverId = await getApproverStaffId(supabase)
    if (!approverId) return { error: 'No autorizado' }

    const { error } = await supabase
        .from('break_requests')
        .update({
            status: 'approved',
            approved_by: approverId,
            approved_at: new Date().toISOString(),
        })
        .eq('id', requestId)
        .eq('status', 'pending')

    if (error) return { error: error.message }
    revalidatePath('/dashboard/descansos')
    revalidatePath('/barbero/cola')
    return { success: true }
}

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
    revalidatePath('/barbero/cola')
    return { success: true }
}

export async function startApprovedBreak(requestId: string) {
    const supabase = await createClient()

    // Get the request details
    const { data: req, error: fetchErr } = await supabase
        .from('break_requests')
        .select('staff_id, break_config_id')
        .eq('id', requestId)
        .eq('status', 'approved')
        .single()

    if (fetchErr || !req) return { error: 'Solicitud no encontrada o no aprobada' }

    // Start the break via existing RPC
    const { error: rpcErr } = await supabase.rpc('start_barber_break', {
        p_staff_id: req.staff_id,
        p_break_config_id: req.break_config_id,
    })
    if (rpcErr) return { error: rpcErr.message }

    // Mark started
    await supabase
        .from('break_requests')
        .update({ started_at: new Date().toISOString() })
        .eq('id', requestId)

    revalidatePath('/dashboard/descansos')
    revalidatePath('/barbero/cola')
    return { success: true }
}

export async function completeBreakRequest(requestId: string, staffId: string) {
    const supabase = await createClient()

    // End the break via existing RPC
    const { error: rpcErr } = await supabase.rpc('end_barber_break', { p_staff_id: staffId })
    if (rpcErr) return { error: rpcErr.message }

    // Mark completed
    await supabase
        .from('break_requests')
        .update({
            status: 'completed',
            ended_at: new Date().toISOString(),
        })
        .eq('id', requestId)

    revalidatePath('/dashboard/descansos')
    revalidatePath('/barbero/cola')
    return { success: true }
}

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
