'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { getCurrentOrgId, validateBranchAccess } from './org'

// ─── Configuración de descansos (CRUD) ──────────────────────────────────────

export async function getBreakConfigs(branchId: string) {
  const orgAccess = await validateBranchAccess(branchId)
  if (!orgAccess) return { data: [], error: 'No autorizado' }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('break_configs')
    .select('*')
    .eq('branch_id', branchId)
    .order('name')
  return { data: data ?? [], error }
}

export async function upsertBreakConfig(formData: FormData) {
  const id = formData.get('id') as string | null
  const branchId = formData.get('branch_id') as string
  const name = (formData.get('name') as string).trim()
  const durationMinutes = parseInt(formData.get('duration_minutes') as string, 10)
  const scheduledTimeRaw = formData.get('scheduled_time') as string | null
  const scheduledTime = scheduledTimeRaw?.trim() || null

  if (!branchId || !name || isNaN(durationMinutes)) {
    return { error: 'Datos incompletos' }
  }

  const orgAccess = await validateBranchAccess(branchId)
  if (!orgAccess) return { error: 'No autorizado' }

  const supabase = createAdminClient()

  if (id) {
    const { error } = await supabase
      .from('break_configs')
      .update({ name, duration_minutes: durationMinutes, scheduled_time: scheduledTime })
      .eq('id', id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase
      .from('break_configs')
      .insert({ branch_id: branchId, name, duration_minutes: durationMinutes, scheduled_time: scheduledTime })
    if (error) return { error: error.message }
  }

  revalidatePath('/dashboard/descansos')
  revalidatePath('/dashboard/equipo')
  return { success: true }
}

export async function deleteBreakConfig(id: string) {
  const supabase = createAdminClient()
  const { data: config } = await supabase.from('break_configs').select('branch_id').eq('id', id).single()
  if (!config) return { error: 'Config no encontrada' }
  const orgAccess = await validateBranchAccess(config.branch_id)
  if (!orgAccess) return { error: 'No autorizado' }

  const { error } = await supabase.from('break_configs').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/dashboard/descansos')
  revalidatePath('/dashboard/equipo')
  return { success: true }
}

// ─── Helpers internos ───────────────────────────────────────────────────────

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
 * Calcula la posición correcta para una entrada ghost de descanso en la cola.
 */
async function calculateGhostPosition(
    supabase: ReturnType<typeof createAdminClient>,
    staffId: string,
    branchId: string,
    cutsBeforeBreak: number
): Promise<number> {
    const { data: entries } = await supabase
        .from('queue_entries')
        .select('id, position, barber_id, status, is_break')
        .eq('branch_id', branchId)
        .in('status', ['waiting', 'in_progress'])
        .order('position')

    if (!entries || entries.length === 0) return 1

    const barberWaiting = entries.filter(
        e => e.status === 'waiting' && !e.is_break && (!e.barber_id || e.barber_id === staffId)
    )

    if (cutsBeforeBreak === 0 || barberWaiting.length === 0) {
        const barberInProgress = entries.find(
            e => e.status === 'in_progress' && e.barber_id === staffId && !e.is_break
        )
        if (barberInProgress) {
            if (cutsBeforeBreak === 0 && barberWaiting.length > 0) {
                return barberWaiting[0].position
            }
            return barberInProgress.position + 1
        }
        if (entries.length > 0) {
            return Math.max(...entries.map(e => e.position)) + 1
        }
        return 1
    }

    const targetIdx = Math.min(cutsBeforeBreak, barberWaiting.length)
    const targetEntry = barberWaiting[targetIdx - 1]
    return targetEntry.position + 1
}

// ─── Solicitudes de descanso ────────────────────────────────────────────────

export async function requestBreak(staffId: string, branchId: string, breakConfigId: string) {
    const orgAccess = await validateBranchAccess(branchId)
    if (!orgAccess) return { error: 'No autorizado para esta sucursal' }

    const supabase = createAdminClient()

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
    revalidatePath('/barbero/fila')
    return { success: true }
}

export async function approveBreak(requestId: string, cutsBeforeBreak: number) {
    const supabase = createAdminClient()
    const approverId = await getApproverStaffId(supabase)
    if (!approverId) return { error: 'No autorizado' }

    const { data: req, error: fetchErr } = await supabase
        .from('break_requests')
        .select('id, staff_id, branch_id, break_config_id, status')
        .eq('id', requestId)
        .eq('status', 'pending')
        .single()

    if (fetchErr || !req) return { error: 'Solicitud no encontrada o ya procesada' }

    const orgAccess = await validateBranchAccess(req.branch_id)
    if (!orgAccess) return { error: 'No autorizado para aprobar descansos en esta sucursal' }

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

    const ghostPosition = await calculateGhostPosition(supabase, req.staff_id, req.branch_id, cutsBeforeBreak)

    const { data: currentService } = await supabase
        .from('queue_entries')
        .select('id')
        .eq('barber_id', req.staff_id)
        .eq('status', 'in_progress')
        .eq('is_break', false)
        .maybeSingle()

    const shouldStartImmediately = cutsBeforeBreak === 0 && !currentService

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
    revalidatePath('/barbero/fila')
    return { success: true }
}

export async function rejectBreak(requestId: string, notes?: string) {
    const supabase = createAdminClient()
    const approverId = await getApproverStaffId(supabase)
    if (!approverId) return { error: 'No autorizado' }

    // Validar que la solicitud pertenece a la org del usuario
    const { data: req } = await supabase
        .from('break_requests')
        .select('branch_id')
        .eq('id', requestId)
        .eq('status', 'pending')
        .single()

    if (!req) return { error: 'Solicitud no encontrada o ya procesada' }

    const orgAccess = await validateBranchAccess(req.branch_id)
    if (!orgAccess) return { error: 'No autorizado para esta sucursal' }

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
    revalidatePath('/barbero/fila')
    return { success: true }
}

export async function cancelBreakRequest(requestId: string) {
    const supabase = createAdminClient()

    const { data: req } = await supabase
        .from('break_requests')
        .select('id, status, branch_id')
        .eq('id', requestId)
        .in('status', ['pending', 'approved'])
        .single()

    if (!req) return { error: 'Solicitud no encontrada' }

    const orgAccess = await validateBranchAccess(req.branch_id)
    if (!orgAccess) return { error: 'No autorizado para esta sucursal' }

    if (req.status === 'approved') {
        await supabase
            .from('queue_entries')
            .delete()
            .eq('break_request_id', requestId)
            .eq('is_break', true)
            .in('status', ['waiting', 'in_progress'])
    }

    const { error } = await supabase
        .from('break_requests')
        .delete()
        .eq('id', requestId)

    if (error) return { error: error.message }
    revalidatePath('/dashboard/descansos')
    revalidatePath('/dashboard/equipo')
    revalidatePath('/barbero/fila')
    return { success: true }
}

export async function completeBreakRequest(queueEntryId: string) {
    const supabase = createAdminClient()

    const { data: entry } = await supabase
        .from('queue_entries')
        .select('id, break_request_id, started_at, branch_id')
        .eq('id', queueEntryId)
        .eq('is_break', true)
        .eq('status', 'in_progress')
        .single()

    if (!entry) return { error: 'Descanso no encontrado o no activo' }

    const orgAccess = await validateBranchAccess(entry.branch_id)
    if (!orgAccess) return { error: 'No autorizado para esta sucursal' }

    const completedAt = new Date()
    let overtimeSeconds = 0

    if (entry.started_at && entry.break_request_id) {
        const { data: breakReq } = await supabase
            .from('break_requests')
            .select('break_config:break_config_id(duration_minutes)')
            .eq('id', entry.break_request_id)
            .single()

        const durationMinutes = (breakReq?.break_config as { duration_minutes?: number } | null)?.duration_minutes
        if (durationMinutes != null) {
            const elapsedSeconds = Math.round(
                (completedAt.getTime() - new Date(entry.started_at).getTime()) / 1000
            )
            overtimeSeconds = Math.max(0, elapsedSeconds - durationMinutes * 60)
        }
    }

    const { error: errorQueue } = await supabase
        .from('queue_entries')
        .delete()
        .eq('id', queueEntryId)

    if (errorQueue) return { error: errorQueue.message }

    if (entry.break_request_id) {
        const { error: errorBreak } = await supabase
            .from('break_requests')
            .update({
                status: 'completed',
                actual_started_at: entry.started_at,
                actual_completed_at: completedAt.toISOString(),
                overtime_seconds: overtimeSeconds,
            })
            .eq('id', entry.break_request_id)

        if (errorBreak) return { error: errorBreak.message }
    }

    revalidatePath('/dashboard/descansos')
    revalidatePath('/dashboard/equipo')
    revalidatePath('/barbero/fila')
    return { success: true }
}

export async function getPendingBreakRequests(branchId: string) {
    const orgAccess = await validateBranchAccess(branchId)
    if (!orgAccess) return { data: [], error: 'No autorizado' }

    const supabase = createAdminClient()
    const { data, error } = await supabase
        .from('break_requests')
        .select('*, staff:staff_id(id, full_name), break_config:break_config_id(name, duration_minutes)')
        .eq('branch_id', branchId)
        .in('status', ['pending', 'approved'])
        .order('requested_at', { ascending: true })

    return { data: data ?? [], error }
}

export async function getBarberActiveBreakRequest(staffId: string) {
    const supabase = createAdminClient()

    // Verificar que el staff pertenece a la org del usuario
    const orgId = await getCurrentOrgId()
    if (!orgId) return { data: null, error: 'No autorizado' }

    const { data: staff } = await supabase
        .from('staff')
        .select('id')
        .eq('id', staffId)
        .eq('organization_id', orgId)
        .maybeSingle()

    if (!staff) return { data: null, error: 'Staff no encontrado en esta organización' }

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

// ─── Descansos programados ──────────────────────────────────────────────────

export async function createScheduledBreakRequests(branchId: string, breakConfigId: string) {
  const orgAccess = await validateBranchAccess(branchId)
  if (!orgAccess) return { error: 'No autorizado para esta sucursal' }

  const supabase = createAdminClient()

  const { data: barbers } = await supabase
    .from('staff')
    .select('id')
    .eq('branch_id', branchId)
    .eq('role', 'barber')
    .eq('is_active', true)

  if (!barbers || barbers.length === 0) {
    return { created: 0 }
  }

  const { data: existing } = await supabase
    .from('break_requests')
    .select('staff_id')
    .eq('branch_id', branchId)
    .in('status', ['pending', 'approved'])

  const existingStaffIds = new Set((existing ?? []).map(e => e.staff_id))
  const barbersToCreate = barbers.filter(b => !existingStaffIds.has(b.id))

  if (barbersToCreate.length === 0) {
    return { created: 0 }
  }

  const { error } = await supabase.from('break_requests').insert(
    barbersToCreate.map(b => ({
      staff_id: b.id,
      branch_id: branchId,
      break_config_id: breakConfigId,
    }))
  )

  if (error) return { error: error.message, created: 0 }

  revalidatePath('/dashboard/descansos')
  revalidatePath('/dashboard/equipo')
  revalidatePath('/barbero/fila')
  return { created: barbersToCreate.length }
}
