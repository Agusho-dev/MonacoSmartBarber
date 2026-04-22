'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import {
  requireLimit,
  translateSupabaseErrorToEntitlement,
} from '@/lib/actions/entitlements'
import { EntitlementError } from '@/lib/billing/types'
import type { EntitlementErrorResponse } from '@/lib/billing/types'

type BranchInput = {
  name: string
  address?: string | null
  phone?: string | null
  latitude?: number | null
  longitude?: number | null
  business_hours_open?: string
  business_hours_close?: string
  business_days?: number[]
}

export type CreateBranchResult =
  | { ok: true; branchId: string }
  | EntitlementErrorResponse
  | { error: string; message: string }

/**
 * Crea una sucursal respetando el límite del plan. Devuelve errores estructurados
 * para que el cliente muestre el UpgradePrompt sin tener que re-lanzar.
 */
export async function createBranch(input: BranchInput): Promise<CreateBranchResult> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'unauthorized', message: 'No autenticado' }

  try {
    // Gate app-side: da UX inmediata + mensaje claro con el límite del plan.
    await requireLimit('branches', 1)
  } catch (e) {
    if (e instanceof EntitlementError) return e.toResponse()
    throw e
  }

  const supabase = createAdminClient()
  // Heredar timezone desde organizations para consistencia con onboarding.
  const { data: orgRow } = await supabase
    .from('organizations')
    .select('timezone')
    .eq('id', orgId)
    .maybeSingle()
  const tz = orgRow?.timezone ?? 'America/Argentina/Buenos_Aires'

  const payload = {
    organization_id: orgId,
    name: input.name,
    address: input.address ?? null,
    phone: input.phone ?? null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    business_hours_open: input.business_hours_open ?? '09:00',
    business_hours_close: input.business_hours_close ?? '21:00',
    business_days: input.business_days ?? [1, 2, 3, 4, 5, 6],
    is_active: true,
    timezone: tz,
  }

  const { data, error } = await supabase
    .from('branches')
    .insert(payload)
    .select('id')
    .single()

  if (error) {
    // El trigger SQL enforce_branch_limit lanza branch_limit_exceeded si
    // alguien bypasa el gate de app. Lo traducimos a EntitlementErrorResponse.
    const translated = await translateSupabaseErrorToEntitlement(error)
    if (translated) return translated
    return { error: 'db_error', message: error.message }
  }

  revalidatePath('/dashboard/sucursales')
  revalidatePath('/dashboard', 'layout')
  return { ok: true, branchId: data.id }
}

export async function updateBranch(
  branchId: string,
  input: Partial<BranchInput> & { is_active?: boolean },
): Promise<{ ok: true } | { error: string; message: string }> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'unauthorized', message: 'No autenticado' }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('branches')
    .update({
      ...input,
      updated_at: new Date().toISOString(),
    })
    .eq('id', branchId)
    .eq('organization_id', orgId)

  if (error) return { error: 'db_error', message: error.message }
  revalidatePath('/dashboard/sucursales')
  return { ok: true }
}
