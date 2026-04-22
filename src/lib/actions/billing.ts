'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import type { EntitlementErrorResponse } from '@/lib/billing/types'

// ============================================================
// Sumarse al waitlist de un módulo coming_soon
// ============================================================

export async function joinModuleWaitlist(
  moduleId: string,
): Promise<{ ok: true } | { error: string; message: string }> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'unauthorized', message: 'Tenés que iniciar sesión' }

  const supabase = createAdminClient()
  const { createClient } = await import('@/lib/supabase/server')
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()

  const { error } = await supabase
    .from('module_waitlist')
    .upsert(
      {
        organization_id: orgId,
        module_id: moduleId,
        user_id: user?.id ?? null,
        email: user?.email ?? null,
      },
      { onConflict: 'organization_id,module_id' },
    )

  if (error) return { error: 'db_error', message: error.message }
  return { ok: true }
}

// ============================================================
// Activar un módulo add-on (placeholder — Fase 5 integra con MP)
// ============================================================

export async function activateModule(
  moduleId: string,
): Promise<{ ok: true } | EntitlementErrorResponse | { error: string; message: string }> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'unauthorized', message: 'Tenés que iniciar sesión' }

  const supabase = createAdminClient()

  // Verifico que el módulo existe y es activable como add-on
  const { data: mod } = await supabase
    .from('modules')
    .select('id, status, price_ars_addon')
    .eq('id', moduleId)
    .maybeSingle()

  if (!mod) return { error: 'not_found', message: 'Módulo inexistente' }
  if (mod.status !== 'active' && mod.status !== 'beta') {
    return { error: 'not_available', message: 'Este módulo no está disponible para activar' }
  }
  if (mod.price_ars_addon == null) {
    return { error: 'not_addon', message: 'Este módulo no se vende como add-on independiente' }
  }

  // TODO Fase 5: aquí se crearía el preapproval extra en MercadoPago.
  // Por ahora insertamos el override local (dev/testing).
  const { error } = await supabase
    .from('organization_modules')
    .upsert(
      { organization_id: orgId, module_id: moduleId, enabled: true, source: 'addon' },
      { onConflict: 'organization_id,module_id' },
    )

  if (error) return { error: 'db_error', message: error.message }
  revalidatePath('/dashboard/billing/modulos')
  revalidatePath('/dashboard', 'layout')
  return { ok: true }
}

// ============================================================
// Desactivar un módulo add-on
// ============================================================

export async function deactivateModule(
  moduleId: string,
): Promise<{ ok: true } | { error: string; message: string }> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'unauthorized', message: 'Tenés que iniciar sesión' }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('organization_modules')
    .update({ enabled: false })
    .eq('organization_id', orgId)
    .eq('module_id', moduleId)

  if (error) return { error: 'db_error', message: error.message }
  revalidatePath('/dashboard/billing/modulos')
  revalidatePath('/dashboard', 'layout')
  return { ok: true }
}

// ============================================================
// Cambio de plan (stub — Fase 5 integra con MercadoPago)
// ============================================================

export async function requestPlanChange(
  planId: string,
  billingCycle: 'monthly' | 'yearly' = 'monthly',
): Promise<{ ok: true; checkoutUrl?: string } | { error: string; message: string }> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'unauthorized', message: 'Tenés que iniciar sesión' }

  const supabase = createAdminClient()

  // Valida el plan target
  const { data: plan } = await supabase
    .from('plans')
    .select('id, is_public, price_ars_monthly, price_ars_yearly')
    .eq('id', planId)
    .maybeSingle()

  if (!plan || !plan.is_public) {
    return { error: 'invalid_plan', message: 'Plan inválido' }
  }

  // En desarrollo: aplica el cambio directo (sin cobrar)
  const { error: updErr } = await supabase
    .from('organization_subscriptions')
    .update({ plan_id: planId, billing_cycle: billingCycle, status: 'active' })
    .eq('organization_id', orgId)

  if (updErr) return { error: 'db_error', message: updErr.message }

  revalidatePath('/dashboard/billing')
  revalidatePath('/dashboard', 'layout')

  // TODO Fase 5: devolver checkoutUrl real de MercadoPago.
  return { ok: true }
}

// ============================================================
// Cancelación de suscripción (soft — al final del período)
// ============================================================

export async function cancelSubscriptionAtPeriodEnd(): Promise<
  { ok: true } | { error: string; message: string }
> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'unauthorized', message: 'Tenés que iniciar sesión' }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('organization_subscriptions')
    .update({ cancel_at_period_end: true, cancelled_at: new Date().toISOString() })
    .eq('organization_id', orgId)

  if (error) return { error: 'db_error', message: error.message }
  revalidatePath('/dashboard/billing')
  return { ok: true }
}

export async function reactivateSubscription(): Promise<
  { ok: true } | { error: string; message: string }
> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'unauthorized', message: 'Tenés que iniciar sesión' }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('organization_subscriptions')
    .update({ cancel_at_period_end: false, cancelled_at: null, status: 'active' })
    .eq('organization_id', orgId)

  if (error) return { error: 'db_error', message: error.message }
  revalidatePath('/dashboard/billing')
  return { ok: true }
}

// (Types and classes live in @/lib/billing/types — 'use server' files
//  can only export async functions.)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function _typeMarker(): Promise<EntitlementErrorResponse | null> { return null }
