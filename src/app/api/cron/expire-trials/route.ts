import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

/**
 * Expira trials vencidos y baja a plan Free.
 *
 * SIN auth con CRON_SECRET: Vercel Hobby no permite muchas crons y el
 * CRON_SECRET rompe los deploys. Este endpoint se dispara desde pg_cron
 * en Supabase (patrón estándar del proyecto — ver migración 087).
 *
 * Idempotencia: solo actúa sobre trials con status='trialing' y trial_ends_at
 * vencido, sin provider_subscription_id. Hacer un hit manual no tiene más
 * efecto que lo que el cron ya haría.
 *
 * Efecto:
 *   - plan_id → 'free', status → 'active', period extendido 30 días
 *   - Sucursales por encima del límite del plan free se marcan is_active=false
 */

export async function GET(req: NextRequest) { return handler(req) }
export async function POST(req: NextRequest) { return handler(req) }

async function handler(_req: NextRequest) {
  const supabase = createAdminClient()
  const now = new Date().toISOString()

  const { data: expired, error: qErr } = await supabase
    .from('organization_subscriptions')
    .select('id, organization_id, plan_id, trial_ends_at')
    .eq('status', 'trialing')
    .is('provider_subscription_id', null)
    .lt('trial_ends_at', now)

  if (qErr) {
    console.error('[expire-trials] query error', qErr)
    return NextResponse.json({ error: qErr.message }, { status: 500 })
  }

  const results: Array<{ org_id: string; downgraded_to: string; branches_deactivated: number }> = []

  for (const sub of expired ?? []) {
    const { error: upErr } = await supabase
      .from('organization_subscriptions')
      .update({
        plan_id: 'free',
        status: 'active',
        current_period_start: now,
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .eq('id', sub.id)

    if (upErr) {
      console.error('[expire-trials] downgrade failed', sub.organization_id, upErr)
      continue
    }

    const { data: freePlan } = await supabase
      .from('plans').select('limits').eq('id', 'free').maybeSingle()
    const maxBranches = Math.max(1, Number((freePlan?.limits as Record<string, unknown>)?.branches ?? 1))

    const { data: branches } = await supabase
      .from('branches')
      .select('id, created_at')
      .eq('organization_id', sub.organization_id)
      .eq('is_active', true)
      .order('created_at', { ascending: true })

    let deactivated = 0
    if (branches && branches.length > maxBranches) {
      const toDeactivate = branches.slice(maxBranches).map((b) => b.id)
      const { error: deactErr } = await supabase
        .from('branches')
        .update({ is_active: false })
        .in('id', toDeactivate)
      if (deactErr) {
        console.error('[expire-trials] deactivate branches failed', sub.organization_id, deactErr)
      } else {
        deactivated = toDeactivate.length
      }
    }

    results.push({ org_id: sub.organization_id, downgraded_to: 'free', branches_deactivated: deactivated })
  }

  return NextResponse.json({ ok: true, processed: results.length, results })
}
