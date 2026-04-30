'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type BranchOperationMode = 'walk_in' | 'appointments' | 'hybrid'

const ModeSchema = z.enum(['walk_in', 'appointments', 'hybrid'])
const BranchIdSchema = z.string().uuid()

export type OperationStatus = {
  branchId: string
  branchName: string
  currentMode: BranchOperationMode
  futureAppointments: number
  activeQueueEntries: number
  servicesWithoutDuration: number
}

// ─── setBranchOperationMode (onboarding) ──────────────────────────────────────

/**
 * Setea el modo de operación de una sucursal durante el onboarding.
 * Sin guardrails (es la primera vez). También sincroniza
 * `organizations.default_operation_mode` si todavía no fue seteado.
 */
export async function setBranchOperationMode(
  branchId: string,
  mode: BranchOperationMode
): Promise<{ ok: true } | { error: string }> {
  const branchParsed = BranchIdSchema.safeParse(branchId)
  if (!branchParsed.success) return { error: 'BRANCH_ID_INVALID' }

  const modeParsed = ModeSchema.safeParse(mode)
  if (!modeParsed.success) return { error: 'MODE_INVALID' }

  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'UNAUTHORIZED' }

  const supabase = createAdminClient()

  // Verificar que el branch pertenece a la org
  const { data: branch } = await supabase
    .from('branches')
    .select('id, organization_id')
    .eq('id', branchId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!branch) return { error: 'BRANCH_NOT_FOUND' }

  const { error: updateError } = await supabase
    .from('branches')
    .update({ operation_mode: mode })
    .eq('id', branchId)

  if (updateError) {
    console.error('[setBranchOperationMode] update error:', updateError)
    return { error: 'UPDATE_FAILED' }
  }

  // Si es la primera sucursal con modo seteado, propagamos el default a la org
  // sólo si la org sigue en walk_in (default factory). Esto evita pisar elecciones explícitas.
  const { data: org } = await supabase
    .from('organizations')
    .select('default_operation_mode')
    .eq('id', orgId)
    .maybeSingle()

  if (org?.default_operation_mode === 'walk_in' && mode !== 'walk_in') {
    await supabase
      .from('organizations')
      .update({ default_operation_mode: mode })
      .eq('id', orgId)
  }

  revalidatePath('/onboarding')
  revalidatePath('/dashboard/turnos/configuracion')
  revalidatePath('/dashboard/sucursales')
  return { ok: true }
}

// ─── changeBranchOperationMode (settings, con guardrails) ─────────────────────

export type ChangeOperationModeError =
  | 'BRANCH_NOT_FOUND'
  | 'FORBIDDEN'
  | 'HAS_FUTURE_APPOINTMENTS'
  | 'HAS_ACTIVE_QUEUE'
  | 'BRANCH_ID_INVALID'
  | 'MODE_INVALID'
  | 'UNAUTHORIZED'
  | 'RPC_FAILED'

/**
 * Cambia el modo de operación de una sucursal con guardrails.
 * Llama el RPC `change_branch_operation_mode` que valida turnos futuros y queue activa.
 */
export async function changeBranchOperationMode(
  branchId: string,
  newMode: BranchOperationMode
): Promise<
  | { ok: true; previousMode: BranchOperationMode; newMode: BranchOperationMode }
  | { error: ChangeOperationModeError; count?: number }
> {
  const branchParsed = BranchIdSchema.safeParse(branchId)
  if (!branchParsed.success) return { error: 'BRANCH_ID_INVALID' }

  const modeParsed = ModeSchema.safeParse(newMode)
  if (!modeParsed.success) return { error: 'MODE_INVALID' }

  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'UNAUTHORIZED' }

  const supabase = createAdminClient()

  // Pre-check de pertenencia
  const { data: branch } = await supabase
    .from('branches')
    .select('id, organization_id, operation_mode')
    .eq('id', branchId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!branch) return { error: 'BRANCH_NOT_FOUND' }

  const { data, error } = await supabase.rpc('change_branch_operation_mode', {
    p_branch_id: branchId,
    p_new_mode: newMode,
  })

  if (error) {
    console.error('[changeBranchOperationMode] rpc error:', error)
    return { error: 'RPC_FAILED' }
  }

  const result = data as {
    success: boolean
    error?: string
    count?: number
    previous_mode?: BranchOperationMode
    new_mode?: BranchOperationMode
  } | null

  if (!result || !result.success) {
    const code = (result?.error ?? 'RPC_FAILED') as ChangeOperationModeError
    return { error: code, count: result?.count }
  }

  revalidatePath('/dashboard/turnos/configuracion')
  revalidatePath('/dashboard/sucursales')
  revalidatePath('/dashboard/turnos/agenda')

  return {
    ok: true,
    previousMode: (result.previous_mode ?? branch.operation_mode) as BranchOperationMode,
    newMode: (result.new_mode ?? newMode) as BranchOperationMode,
  }
}

// ─── getBranchOperationStatus (lee el estado para mostrar guardrails preventivos) ──

/**
 * Devuelve el estado de la sucursal con info útil para el dialog de cambio de modo:
 * - turnos futuros activos
 * - queue activa
 * - servicios sin duration_minutes (relevante si se quiere pasar a appointments)
 */
export async function getBranchOperationStatus(
  branchId: string
): Promise<{ ok: true; status: OperationStatus } | { error: string }> {
  const parsed = BranchIdSchema.safeParse(branchId)
  if (!parsed.success) return { error: 'BRANCH_ID_INVALID' }

  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'UNAUTHORIZED' }

  const supabase = createAdminClient()

  const { data: branch } = await supabase
    .from('branches')
    .select('id, name, operation_mode, organization_id')
    .eq('id', branchId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!branch) return { error: 'BRANCH_NOT_FOUND' }

  const today = new Date().toISOString().slice(0, 10)

  const [futureRes, queueRes, servicesRes] = await Promise.all([
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('branch_id', branchId)
      .in('status', ['scheduled', 'confirmed', 'checked_in', 'in_progress'])
      .gte('appointment_date', today),
    supabase
      .from('queue_entries')
      .select('id', { count: 'exact', head: true })
      .eq('branch_id', branchId)
      .in('status', ['waiting', 'in_progress']),
    supabase
      .from('services')
      .select('id', { count: 'exact', head: true })
      .eq('branch_id', branchId)
      .eq('is_active', true)
      .is('duration_minutes', null),
  ])

  return {
    ok: true,
    status: {
      branchId: branch.id,
      branchName: branch.name,
      currentMode: (branch.operation_mode as BranchOperationMode) ?? 'walk_in',
      futureAppointments: futureRes.count ?? 0,
      activeQueueEntries: queueRes.count ?? 0,
      servicesWithoutDuration: servicesRes.count ?? 0,
    },
  }
}
