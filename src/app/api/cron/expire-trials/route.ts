import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import {
  sendTrialEndedEmail,
  sendPastDueWarningEmail,
  sendDowngradeNoticeEmail,
} from '@/lib/email/send'

/**
 * Ciclo de vida de suscripciones — modo manual
 *
 * Este cron se dispara desde pg_cron una vez por día. Es idempotente:
 * los efectos sólo aplican a suscripciones que cumplen condiciones
 * concretas y un re-hit no hace daño.
 *
 * Procesa 3 transiciones:
 *
 *   1) trial vencido → past_due con 5 días de gracia
 *      - status='trialing' AND trial_ends_at < now()
 *      - Se mueve a past_due, no se baja inmediatamente: el equipo
 *        BarberOS tiene 5 días para coordinar el pago manual antes de
 *        degradar a free.
 *
 *   2) suscripción manual vencida (sin renovación) → past_due 5 días
 *      - status='active' AND provider='manual' AND current_period_end < now()
 *        AND grandfathered=false
 *
 *   3) past_due con gracia agotada → downgrade a free
 *      - status='past_due' AND grace_period_ends_at < now()
 *      - Sucursales por encima del límite de free se desactivan.
 *
 * Sin auth — pg_cron lo invoca sin headers especiales (ver migración 087).
 * NUNCA toca orgs con grandfathered=true.
 */

const GRACE_DAYS = 5

export async function GET(req: NextRequest) { return handler(req) }
export async function POST(req: NextRequest) { return handler(req) }

async function handler(_req: NextRequest) {
  const supabase = createAdminClient()
  const nowIso = new Date().toISOString()
  const graceEndsIso = new Date(Date.now() + GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const results = {
    trials_to_past_due: [] as string[],
    manual_to_past_due: [] as string[],
    downgraded_to_free: [] as { org_id: string; branches_deactivated: number }[],
    errors: [] as string[],
  }

  // -------------------------------------------------------------------
  // 1) Trials vencidos → past_due
  // -------------------------------------------------------------------
  const { data: expiredTrials, error: trialsErr } = await supabase
    .from('organization_subscriptions')
    .select('id, organization_id, trial_ends_at, billing_email, organizations:organization_id(name)')
    .eq('status', 'trialing')
    .eq('grandfathered', false)
    .lt('trial_ends_at', nowIso)

  if (trialsErr) {
    console.error('[expire-trials] query trials error', trialsErr)
    results.errors.push(`trials: ${trialsErr.message}`)
  }

  for (const sub of expiredTrials ?? []) {
    const { error } = await supabase
      .from('organization_subscriptions')
      .update({
        status: 'past_due',
        grace_period_ends_at: graceEndsIso,
      })
      .eq('id', sub.id)

    if (error) {
      console.error('[expire-trials] trial→past_due failed', sub.organization_id, error)
      results.errors.push(`trial→past_due ${sub.organization_id}: ${error.message}`)
      continue
    }
    results.trials_to_past_due.push(sub.organization_id)

    // Email: trial finalizado + advertencia past_due
    if (sub.billing_email) {
      const orgName = (sub.organizations as { name?: string } | null)?.name ?? 'tu organización'
      void sendTrialEndedEmail({ orgName, ownerEmail: sub.billing_email })
      void sendPastDueWarningEmail({
        orgName,
        ownerEmail: sub.billing_email,
        graceDays: GRACE_DAYS,
        graceEndsAt: graceEndsIso,
      })
    }
  }

  // -------------------------------------------------------------------
  // 2) Suscripciones manuales activas vencidas → past_due
  // -------------------------------------------------------------------
  const { data: expiredManual, error: manualErr } = await supabase
    .from('organization_subscriptions')
    .select('id, organization_id, current_period_end, billing_email, organizations:organization_id(name)')
    .eq('status', 'active')
    .eq('grandfathered', false)
    .eq('provider', 'manual')
    .lt('current_period_end', nowIso)

  if (manualErr) {
    console.error('[expire-trials] query manual error', manualErr)
    results.errors.push(`manual: ${manualErr.message}`)
  }

  for (const sub of expiredManual ?? []) {
    const { error } = await supabase
      .from('organization_subscriptions')
      .update({
        status: 'past_due',
        grace_period_ends_at: graceEndsIso,
      })
      .eq('id', sub.id)

    if (error) {
      console.error('[expire-trials] manual→past_due failed', sub.organization_id, error)
      results.errors.push(`manual→past_due ${sub.organization_id}: ${error.message}`)
      continue
    }
    results.manual_to_past_due.push(sub.organization_id)

    // Email: advertencia past_due
    if (sub.billing_email) {
      const orgName = (sub.organizations as { name?: string } | null)?.name ?? 'tu organización'
      void sendPastDueWarningEmail({
        orgName,
        ownerEmail: sub.billing_email,
        graceDays: GRACE_DAYS,
        graceEndsAt: graceEndsIso,
      })
    }
  }

  // -------------------------------------------------------------------
  // 3) past_due con gracia agotada → free + apagar sucursales excedentes
  // -------------------------------------------------------------------
  const { data: graceDone, error: graceErr } = await supabase
    .from('organization_subscriptions')
    .select('id, organization_id, billing_email, organizations:organization_id(name)')
    .eq('status', 'past_due')
    .eq('grandfathered', false)
    .not('grace_period_ends_at', 'is', null)
    .lt('grace_period_ends_at', nowIso)

  if (graceErr) {
    console.error('[expire-trials] query grace error', graceErr)
    results.errors.push(`grace: ${graceErr.message}`)
  }

  // Cargo el límite de free una vez (no cambia entre orgs)
  const { data: freePlan } = await supabase
    .from('plans').select('limits').eq('id', 'free').maybeSingle()
  const maxBranchesFree = Math.max(
    1,
    Number((freePlan?.limits as Record<string, unknown>)?.branches ?? 1),
  )

  for (const sub of graceDone ?? []) {
    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    const { error: dgErr } = await supabase
      .from('organization_subscriptions')
      .update({
        plan_id: 'free',
        status: 'active',
        current_period_start: nowIso,
        current_period_end: periodEnd,
        grace_period_ends_at: null,
        next_renewal_reminder_at: null,
      })
      .eq('id', sub.id)

    if (dgErr) {
      console.error('[expire-trials] downgrade failed', sub.organization_id, dgErr)
      results.errors.push(`downgrade ${sub.organization_id}: ${dgErr.message}`)
      continue
    }

    // Apagar sucursales excedentes
    const { data: branches } = await supabase
      .from('branches')
      .select('id, created_at')
      .eq('organization_id', sub.organization_id)
      .eq('is_active', true)
      .order('created_at', { ascending: true })

    let deactivated = 0
    if (branches && branches.length > maxBranchesFree) {
      const toDeactivate = branches.slice(maxBranchesFree).map((b) => b.id)
      const { error: deactErr } = await supabase
        .from('branches')
        .update({ is_active: false })
        .in('id', toDeactivate)
      if (deactErr) {
        console.error('[expire-trials] deactivate branches failed', sub.organization_id, deactErr)
        results.errors.push(`deactivate ${sub.organization_id}: ${deactErr.message}`)
      } else {
        deactivated = toDeactivate.length
      }
    }

    results.downgraded_to_free.push({ org_id: sub.organization_id, branches_deactivated: deactivated })

    // Email: downgrade
    if (sub.billing_email) {
      const orgName = (sub.organizations as { name?: string } | null)?.name ?? 'tu organización'
      void sendDowngradeNoticeEmail({ orgName, ownerEmail: sub.billing_email })
    }
  }

  return NextResponse.json({
    ok: true,
    summary: {
      trials_to_past_due: results.trials_to_past_due.length,
      manual_to_past_due: results.manual_to_past_due.length,
      downgraded_to_free: results.downgraded_to_free.length,
      errors: results.errors.length,
    },
    details: results,
  })
}
