'use server'

import { createAdminClient, createClient } from '@/lib/supabase/server'
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

  if (!branchId || !name || isNaN(durationMinutes)) {
    return { error: 'Datos incompletos' }
  }

  const orgAccess = await validateBranchAccess(branchId)
  if (!orgAccess) return { error: 'No autorizado' }

  const supabase = createAdminClient()

  if (id) {
    const { error } = await supabase
      .from('break_configs')
      .update({ name, duration_minutes: durationMinutes })
      .eq('id', id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase
      .from('break_configs')
      .insert({ branch_id: branchId, name, duration_minutes: durationMinutes })
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

async function getApproverStaffId(adminSupabase: ReturnType<typeof createAdminClient>) {
    // Usar el server client (con cookies) para obtener la sesión del usuario autenticado
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
        const { data: staff } = await adminSupabase
            .from('staff')
            .select('id')
            .eq('auth_user_id', user.id)
            .single()
        if (staff) return staff.id
    }
    // Fallback para panel de barbero (usa cookie de sesión)
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
 * Calcula la posición y priority_order correctos para una entrada ghost de descanso.
 * Usa priority_order como fuente de verdad para el FIFO global unificado.
 */
async function calculateGhostPosition(
    supabase: ReturnType<typeof createAdminClient>,
    staffId: string,
    branchId: string,
    cutsBeforeBreak: number
): Promise<{ position: number; priorityOrder: string }> {
    const { data: entries } = await supabase
        .from('queue_entries')
        .select('id, position, priority_order, barber_id, status, is_break')
        .eq('branch_id', branchId)
        .in('status', ['waiting', 'in_progress'])
        .order('priority_order')

    const now = new Date().toISOString()
    if (!entries || entries.length === 0) return { position: 1, priorityOrder: now }

    // Clientes reales esperando que este barbero atendería (asignados a él o dinámicos)
    const barberWaiting = entries.filter(
        e => e.status === 'waiting' && !e.is_break && (!e.barber_id || e.barber_id === staffId)
    )

    if (cutsBeforeBreak === 0 || barberWaiting.length === 0) {
        const barberInProgress = entries.find(
            e => e.status === 'in_progress' && e.barber_id === staffId && !e.is_break
        )
        if (barberInProgress) {
            if (cutsBeforeBreak === 0 && barberWaiting.length > 0) {
                return {
                    position: barberWaiting[0].position,
                    priorityOrder: barberWaiting[0].priority_order,
                }
            }
            return {
                position: barberInProgress.position + 1,
                priorityOrder: barberInProgress.priority_order,
            }
        }
        if (entries.length > 0) {
            return {
                position: Math.max(...entries.map(e => e.position)) + 1,
                priorityOrder: now,
            }
        }
        return { position: 1, priorityOrder: now }
    }

    const targetIdx = Math.min(cutsBeforeBreak, barberWaiting.length)
    const targetEntry = barberWaiting[targetIdx - 1]
    // priority_order 1ms después del target para insertar el break justo después
    const targetTime = new Date(targetEntry.priority_order).getTime()
    return {
        position: targetEntry.position + 1,
        priorityOrder: new Date(targetTime + 1).toISOString(),
    }
}

// ─── Solicitudes de descanso ────────────────────────────────────────────────

export async function requestBreak(staffId: string, branchId: string, breakConfigId: string) {
    const orgAccess = await validateBranchAccess(branchId)
    if (!orgAccess) return { error: 'No autorizado para esta sucursal' }

    const supabase = createAdminClient()

    // Validar que el staff pertenece al branch y la org
    const { data: staffRow } = await supabase
        .from('staff')
        .select('branch_id')
        .eq('id', staffId)
        .eq('branch_id', branchId)
        .maybeSingle()
    if (!staffRow) return { error: 'El barbero no pertenece a esta sucursal' }

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

    const ghost = await calculateGhostPosition(supabase, req.staff_id, req.branch_id, cutsBeforeBreak)

    // ── Decidir si arrancar el ghost INMEDIATAMENTE ──────────────────────────
    // El ghost arranca si: no hay corte activo del barbero Y no hay clientes
    // ESPECÍFICAMENTE asignados a él con priority_order menor que el ghost.
    // Esto cubre todos los casos de "barbero libre y nada lo tapa", incluyendo
    // cuts_before_break > 0 sin clientes asignados (antes quedaba en limbo).
    // Los clientes dinámicos (barber_id IS NULL) NO bloquean: van al pool.
    const [{ data: currentService }, { data: blockingAssigned }] = await Promise.all([
        supabase
            .from('queue_entries')
            .select('id')
            .eq('barber_id', req.staff_id)
            .eq('status', 'in_progress')
            .eq('is_break', false)
            .maybeSingle(),
        supabase
            .from('queue_entries')
            .select('id')
            .eq('barber_id', req.staff_id)
            .eq('branch_id', req.branch_id)
            .eq('status', 'waiting')
            .eq('is_break', false)
            .lt('priority_order', ghost.priorityOrder)
            .limit(1),
    ])

    const hasBlockingAssigned = (blockingAssigned?.length ?? 0) > 0
    const shouldStartImmediately = !currentService && !hasBlockingAssigned
    const nowTs = new Date().toISOString()

    const { error: insertErr } = await supabase.from('queue_entries').insert({
        branch_id: req.branch_id,
        client_id: null,
        barber_id: req.staff_id,
        status: shouldStartImmediately ? 'in_progress' : 'waiting',
        position: ghost.position,
        priority_order: ghost.priorityOrder,
        is_break: true,
        break_request_id: req.id,
        checked_in_at: nowTs,
        started_at: shouldStartImmediately ? nowTs : null,
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

/**
 * Detecta y arranca un ghost de descanso `waiting` que está listo para iniciar
 * (sin corte activo del barbero y sin clientes asignados con priority menor).
 *
 * Cubre el caso "ghost en limbo": el descanso se aprobó después de que el
 * barbero terminara su último corte (o con cuts_before_break > 0 sin clientes
 * asignados), por lo que `completeService` paso 6 nunca se disparó. La UI lo
 * llama desde un useEffect que se activa cuando detecta la condición.
 *
 * Idempotente y atómica: si dos clientes lo llaman a la vez, solo uno gana
 * por la WHERE clause `status='waiting'`. El partial UNIQUE de mig 127
 * garantiza que no haya doble in_progress aunque haya race con otro path.
 */
export async function startPendingBreakIfReady(staffId: string, branchId: string) {
    const supabase = createAdminClient()

    const orgAccess = await validateBranchAccess(branchId)
    if (!orgAccess) return { error: 'No autorizado para esta sucursal' }

    // Buscar el ghost waiting más viejo del barbero
    const { data: ghost } = await supabase
        .from('queue_entries')
        .select('id, priority_order')
        .eq('barber_id', staffId)
        .eq('branch_id', branchId)
        .eq('is_break', true)
        .eq('status', 'waiting')
        .order('priority_order', { ascending: true })
        .limit(1)
        .maybeSingle()

    if (!ghost) return { success: true, started: false, reason: 'no_pending_break' }

    // Verificar que no esté tapado por: corte activo o cliente asignado con priority menor
    const [{ data: activeService }, { data: blockingAssigned }] = await Promise.all([
        supabase
            .from('queue_entries')
            .select('id')
            .eq('barber_id', staffId)
            .eq('branch_id', branchId)
            .eq('status', 'in_progress')
            .eq('is_break', false)
            .maybeSingle(),
        supabase
            .from('queue_entries')
            .select('id')
            .eq('barber_id', staffId)
            .eq('branch_id', branchId)
            .eq('status', 'waiting')
            .eq('is_break', false)
            .lt('priority_order', ghost.priority_order)
            .limit(1),
    ])

    if (activeService) return { success: true, started: false, reason: 'active_service' }
    if (blockingAssigned && blockingAssigned.length > 0) {
        return { success: true, started: false, reason: 'blocked_by_assigned' }
    }

    const { error: startErr, data: updated } = await supabase
        .from('queue_entries')
        .update({
            status: 'in_progress',
            started_at: new Date().toISOString(),
        })
        .eq('id', ghost.id)
        .eq('status', 'waiting')
        .select('id')
        .maybeSingle()

    if (startErr) {
        // Si fue 23505 (partial UNIQUE de mig 127), significa que otro path ya
        // arrancó algo — devolvemos started=false sin error. Cualquier otro
        // error sí lo propagamos.
        const code = (startErr as { code?: string }).code
        if (code === '23505') return { success: true, started: false, reason: 'race_lost' }
        return { error: startErr.message }
    }

    if (!updated) return { success: true, started: false, reason: 'race_lost' }

    revalidatePath('/barbero/fila')
    revalidatePath('/dashboard/fila')
    return { success: true, started: true }
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
    .or('role.eq.barber,is_also_barber.eq.true')
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
