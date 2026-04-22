'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getCurrentOrgId } from './org'
import { assertBranchAccess } from './branch-access'
import { isValidUUID } from '@/lib/validation'
import type { AppointmentBlock } from '@/lib/types/database'

interface CreateBlockInput {
  branchId: string | null
  barberId?: string | null
  startAt: string // ISO
  endAt: string   // ISO
  reason?: string
  createdByStaffId?: string
}

export async function createAppointmentBlock(input: CreateBlockInput) {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Sin sesión' }

  if (input.barberId && !input.branchId) {
    return { error: 'Un bloque por barbero requiere una sucursal' }
  }

  if (input.branchId) {
    if (!isValidUUID(input.branchId)) return { error: 'Sucursal inválida' }
    const access = await assertBranchAccess(input.branchId)
    if (!access.ok) return { error: 'Sin acceso a esta sucursal' }
  }

  const startMs = new Date(input.startAt).getTime()
  const endMs = new Date(input.endAt).getTime()
  if (!(endMs > startMs)) return { error: 'Rango de fechas inválido' }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('appointment_blocks')
    .insert({
      organization_id: orgId,
      branch_id: input.branchId ?? null,
      barber_id: input.barberId ?? null,
      start_at: input.startAt,
      end_at: input.endAt,
      reason: input.reason ?? null,
      created_by_staff_id: input.createdByStaffId ?? null,
    })
    .select('*')
    .single()

  if (error) return { error: error.message }

  revalidatePath('/dashboard/turnos/agenda')
  return { success: true, block: data as AppointmentBlock }
}

export async function deleteAppointmentBlock(blockId: string) {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Sin sesión' }

  const supabase = createAdminClient()

  const { data: block } = await supabase
    .from('appointment_blocks')
    .select('id, organization_id, branch_id')
    .eq('id', blockId)
    .single()

  if (!block || block.organization_id !== orgId) return { error: 'Bloque no encontrado' }

  if (block.branch_id) {
    const access = await assertBranchAccess(block.branch_id)
    if (!access.ok) return { error: 'Sin acceso a esta sucursal' }
  }

  const { error } = await supabase
    .from('appointment_blocks')
    .delete()
    .eq('id', blockId)

  if (error) return { error: error.message }

  revalidatePath('/dashboard/turnos/agenda')
  return { success: true }
}

/**
 * Lista bloques que pueden solapar con un día en una sucursal (incluye bloques
 * org-wide con branch_id IS NULL).
 */
export async function listAppointmentBlocksForDate(branchId: string, date: string) {
  const access = await assertBranchAccess(branchId)
  if (!access.ok) return []

  const supabase = createAdminClient()

  const dayStart = new Date(`${date}T00:00:00`).toISOString()
  const dayEnd = new Date(`${date}T23:59:59`).toISOString()

  const { data } = await supabase
    .from('appointment_blocks')
    .select('*, barber:barber_id(id, full_name)')
    .eq('organization_id', access.orgId)
    .or(`branch_id.is.null,branch_id.eq.${branchId}`)
    .lt('start_at', dayEnd)
    .gt('end_at', dayStart)
    .order('start_at', { ascending: true })

  return (data ?? []) as AppointmentBlock[]
}

export async function listAppointmentBlocksForRange(
  branchId: string,
  startDate: string,
  endDate: string
) {
  const access = await assertBranchAccess(branchId)
  if (!access.ok) return []

  const supabase = createAdminClient()

  const rangeStart = new Date(`${startDate}T00:00:00`).toISOString()
  const rangeEnd = new Date(`${endDate}T23:59:59`).toISOString()

  const { data } = await supabase
    .from('appointment_blocks')
    .select('*, barber:barber_id(id, full_name)')
    .eq('organization_id', access.orgId)
    .or(`branch_id.is.null,branch_id.eq.${branchId}`)
    .lt('start_at', rangeEnd)
    .gt('end_at', rangeStart)
    .order('start_at', { ascending: true })

  return (data ?? []) as AppointmentBlock[]
}
