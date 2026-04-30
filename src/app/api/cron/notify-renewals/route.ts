import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { sendRenewalDueSoonEmail, sendTrialEndingSoonEmail } from '@/lib/email/send'

/**
 * Notifica recordatorios de renovación y de trial-ending.
 *
 * Disparado por pg_cron diariamente. Sin auth (idempotente — usa
 * `next_renewal_reminder_at` para evitar enviar más de una vez).
 *
 * Lógica:
 *
 *   1) Suscripciones manuales activas con period_end ~7 días:
 *      - Si next_renewal_reminder_at <= now() → mandar email + nullear
 *        next_renewal_reminder_at (no re-enviar).
 *
 *   2) Trials con trial_ends_at en 1 día:
 *      - Mandar trial-ending-soon (idempotente vía la columna
 *        next_renewal_reminder_at; si ya se envió queda en NULL).
 *
 * Nunca toca grandfathered=true.
 */

export async function GET(req: NextRequest) { return handler(req) }
export async function POST(req: NextRequest) { return handler(req) }

async function handler(_req: NextRequest) {
  const supabase = createAdminClient()
  const now = new Date()
  const nowIso = now.toISOString()

  const sent = {
    renewals: [] as string[],
    trials: [] as string[],
    errors: [] as string[],
  }

  // -------------------------------------------------------------------
  // 1) Renovaciones (~7 días antes del period_end)
  // -------------------------------------------------------------------
  const { data: renewals, error: renewErr } = await supabase
    .from('organization_subscriptions')
    .select('id, organization_id, plan_id, current_period_end, billing_email, organizations:organization_id(name), plans:plan_id(name)')
    .eq('status', 'active')
    .eq('provider', 'manual')
    .eq('grandfathered', false)
    .not('billing_email', 'is', null)
    .not('next_renewal_reminder_at', 'is', null)
    .lte('next_renewal_reminder_at', nowIso)

  if (renewErr) {
    console.error('[notify-renewals] renewals query error', renewErr)
    sent.errors.push(`renewals: ${renewErr.message}`)
  }

  for (const sub of renewals ?? []) {
    const orgName = (sub.organizations as { name?: string } | null)?.name ?? 'tu organización'
    const planName = (sub.plans as { name?: string } | null)?.name ?? sub.plan_id
    const periodEndIso = sub.current_period_end ?? nowIso
    const daysLeft = Math.max(0, Math.ceil(
      (new Date(periodEndIso).getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    ))

    const result = await sendRenewalDueSoonEmail({
      orgName,
      ownerEmail: sub.billing_email!,
      planName,
      periodEnd: periodEndIso,
      daysLeft,
    })

    // Marcar como enviado (idempotencia): nullear el campo
    const { error: updErr } = await supabase
      .from('organization_subscriptions')
      .update({ next_renewal_reminder_at: null })
      .eq('id', sub.id)

    if (updErr) {
      console.error('[notify-renewals] failed to clear flag', sub.organization_id, updErr)
      sent.errors.push(`clear ${sub.organization_id}: ${updErr.message}`)
    }

    if (result) sent.renewals.push(sub.organization_id)
  }

  // -------------------------------------------------------------------
  // 2) Trials próximos a vencer (1 día)
  // -------------------------------------------------------------------
  const oneDayFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()

  const { data: trials, error: trialsErr } = await supabase
    .from('organization_subscriptions')
    .select('id, organization_id, trial_ends_at, billing_email, organizations:organization_id(name)')
    .eq('status', 'trialing')
    .eq('grandfathered', false)
    .not('billing_email', 'is', null)
    .not('next_renewal_reminder_at', 'is', null)   // reusa el mismo flag
    .lte('next_renewal_reminder_at', nowIso)
    .lte('trial_ends_at', oneDayFromNow)
    .gt('trial_ends_at', nowIso)

  if (trialsErr) {
    console.error('[notify-renewals] trials query error', trialsErr)
    sent.errors.push(`trials: ${trialsErr.message}`)
  }

  for (const sub of trials ?? []) {
    const orgName = (sub.organizations as { name?: string } | null)?.name ?? 'tu organización'
    const trialEnd = sub.trial_ends_at ?? nowIso
    const daysLeft = Math.max(0, Math.ceil(
      (new Date(trialEnd).getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    ))

    const result = await sendTrialEndingSoonEmail({
      orgName,
      ownerEmail: sub.billing_email!,
      daysLeft,
      trialEndsAt: trialEnd,
    })

    await supabase
      .from('organization_subscriptions')
      .update({ next_renewal_reminder_at: null })
      .eq('id', sub.id)

    if (result) sent.trials.push(sub.organization_id)
  }

  return NextResponse.json({
    ok: true,
    summary: {
      renewals_sent: sent.renewals.length,
      trial_warnings_sent: sent.trials.length,
      errors: sent.errors.length,
    },
    details: sent,
  })
}
