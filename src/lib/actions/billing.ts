'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { isManualBilling } from '@/lib/billing/config'
import type { EntitlementErrorResponse } from '@/lib/billing/types'

// ============================================================
// Tipos de respuesta uniformes
// ============================================================

type RequestResponse =
  | { ok: true; mode: 'manual'; requestId: string; message: string }
  | { ok: true; mode: 'gateway'; checkoutUrl: string }
  | { error: string; message: string }
  | EntitlementErrorResponse

// ============================================================
// Sumarse al waitlist de un módulo coming_soon
// ============================================================

export async function joinModuleWaitlist(
  moduleId: string,
): Promise<{ ok: true } | { error: string; message: string }> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'unauthorized', message: 'Tenés que iniciar sesión' }

  const supabase = createAdminClient()
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
// Activar módulo add-on (modo manual: crea request)
// ============================================================

export async function activateModule(
  moduleId: string,
): Promise<RequestResponse> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'unauthorized', message: 'Tenés que iniciar sesión' }

  const supabase = createAdminClient()
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()

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

  if (isManualBilling()) {
    // Resolver plan actual para registrar la request con un plan_id válido
    const { data: sub } = await supabase
      .from('organization_subscriptions')
      .select('plan_id, billing_cycle')
      .eq('organization_id', orgId)
      .maybeSingle()

    const { data: req, error } = await supabase
      .from('subscription_requests')
      .insert({
        organization_id: orgId,
        requested_plan_id: sub?.plan_id ?? 'pro',
        requested_billing_cycle: sub?.billing_cycle ?? 'monthly',
        request_kind: 'module_addon',
        module_id: moduleId,
        requested_by: user?.id,
        notes: `Activación de add-on: ${moduleId}`,
      })
      .select('id')
      .single()

    if (error) return { error: 'db_error', message: error.message }
    revalidatePath('/dashboard/billing/modulos')
    return {
      ok: true,
      mode: 'manual',
      requestId: req.id,
      message: 'Solicitud registrada. Te contactamos en menos de 24hs para coordinar la activación.',
    }
  }

  // Modo gateway (futuro): aquí se crearía el preapproval extra en MP
  return { error: 'not_implemented', message: 'La pasarela de pagos no está activa todavía' }
}

// ============================================================
// Desactivar add-on (libre: el cliente puede dar de baja sin coordinación)
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
// Cambio/renovación de plan (modo manual: crea request)
// ============================================================

export async function requestPlanChange(
  planId: string,
  billingCycle: 'monthly' | 'yearly' = 'monthly',
  kind: 'plan_change' | 'renewal' = 'plan_change',
): Promise<RequestResponse> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'unauthorized', message: 'Tenés que iniciar sesión' }

  const supabase = createAdminClient()
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()

  // Validar que el plan exista y sea público (free no se "compra")
  const { data: plan } = await supabase
    .from('plans')
    .select('id, is_public, name, price_ars_monthly, price_ars_yearly')
    .eq('id', planId)
    .maybeSingle()

  if (!plan || !plan.is_public) {
    return { error: 'invalid_plan', message: 'Plan inválido' }
  }

  if (isManualBilling()) {
    // Si ya hay una request pending para esta org, la actualizamos en vez de duplicar
    const { data: existing } = await supabase
      .from('subscription_requests')
      .select('id')
      .eq('organization_id', orgId)
      .eq('status', 'pending')
      .eq('request_kind', kind)
      .maybeSingle()

    if (existing) {
      const { error: updErr } = await supabase
        .from('subscription_requests')
        .update({
          requested_plan_id: planId,
          requested_billing_cycle: billingCycle,
          requested_by: user?.id,
        })
        .eq('id', existing.id)

      if (updErr) return { error: 'db_error', message: updErr.message }

      revalidatePath('/dashboard/billing')
      return {
        ok: true,
        mode: 'manual',
        requestId: existing.id,
        message: 'Actualizamos tu solicitud. Te contactamos por WhatsApp/email para coordinar el pago.',
      }
    }

    const { data: req, error: insErr } = await supabase
      .from('subscription_requests')
      .insert({
        organization_id: orgId,
        requested_plan_id: planId,
        requested_billing_cycle: billingCycle,
        request_kind: kind,
        requested_by: user?.id,
        notes: kind === 'renewal'
          ? `Renovación solicitada por el cliente (${plan.name} ${billingCycle})`
          : `Cambio de plan solicitado: ${plan.name} ${billingCycle}`,
      })
      .select('id')
      .single()

    if (insErr) return { error: 'db_error', message: insErr.message }

    // Email de confirmación al cliente + BCC interno (fire-and-forget)
    try {
      const [orgRes, subRes] = await Promise.all([
        supabase.from('organizations').select('name').eq('id', orgId).maybeSingle(),
        supabase.from('organization_subscriptions').select('billing_email').eq('organization_id', orgId).maybeSingle(),
      ])
      const recipientEmail = subRes.data?.billing_email ?? user?.email
      if (recipientEmail) {
        const { sendSubscriptionRequestReceivedEmail } = await import('@/lib/email/send')
        void sendSubscriptionRequestReceivedEmail({
          orgName: orgRes.data?.name ?? 'tu organización',
          ownerEmail: recipientEmail,
          planName: plan.name,
          cycle: billingCycle,
          kind,
        })
      }
    } catch (e) {
      console.error('[requestPlanChange] email skipped:', e)
    }

    revalidatePath('/dashboard/billing')
    return {
      ok: true,
      mode: 'manual',
      requestId: req.id,
      message: 'Solicitud registrada. Te contactamos en menos de 24hs para coordinar el pago.',
    }
  }

  // Modo gateway (futuro): crear preapproval en MP y devolver checkoutUrl
  return { error: 'not_implemented', message: 'La pasarela de pagos no está activa todavía' }
}

// ============================================================
// Cancelar request pendiente (el cliente desistió)
// ============================================================

export async function cancelMyPendingRequest(): Promise<
  { ok: true; cancelled: number } | { error: string; message: string }
> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'unauthorized', message: 'Tenés que iniciar sesión' }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('subscription_requests')
    .update({
      status: 'cancelled',
      cancellation_reason: 'Cancelada por el cliente desde dashboard',
    })
    .eq('organization_id', orgId)
    .in('status', ['pending', 'contacted'])
    .select('id')

  if (error) return { error: 'db_error', message: error.message }
  revalidatePath('/dashboard/billing')
  return { ok: true, cancelled: data?.length ?? 0 }
}

// ============================================================
// Cancelación al final del período
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

// ============================================================
// Actualizar datos de facturación (razón social, CUIT, etc.)
// ============================================================

export interface BillingProfileInput {
  billing_email?: string | null
  billing_legal_name?: string | null
  billing_tax_id?: string | null
  billing_address?: string | null
  billing_whatsapp?: string | null
}

export async function updateBillingProfile(
  input: BillingProfileInput,
): Promise<{ ok: true } | { error: string; message: string }> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'unauthorized', message: 'Tenés que iniciar sesión' }

  const supabase = createAdminClient()
  const patch: Record<string, string | null> = {}
  if ('billing_email' in input) patch.billing_email = input.billing_email ?? null
  if ('billing_legal_name' in input) patch.billing_legal_name = input.billing_legal_name ?? null
  if ('billing_tax_id' in input) patch.billing_tax_id = input.billing_tax_id ?? null
  if ('billing_address' in input) patch.billing_address = input.billing_address ?? null
  if ('billing_whatsapp' in input) patch.billing_whatsapp = input.billing_whatsapp ?? null

  if (Object.keys(patch).length === 0) return { ok: true }

  const { error } = await supabase
    .from('organization_subscriptions')
    .update(patch)
    .eq('organization_id', orgId)

  if (error) return { error: 'db_error', message: error.message }
  revalidatePath('/dashboard/account')
  revalidatePath('/dashboard/billing')
  return { ok: true }
}

// (Types and classes live in @/lib/billing/types — 'use server' files
//  can only export async functions.)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function _typeMarker(): Promise<EntitlementErrorResponse | null> { return null }
