'use server'

import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { isValidUUID } from '@/lib/validation'
import {
  EntitlementError,
  type Entitlements,
  type Limits,
  type CurrentUsage,
  type ModuleMeta,
  type ModuleVisibility,
  type SubscriptionStatus,
  type LimitMetric,
  type MonthlyCapMetric,
  type UsageMetric,
  type EntitlementErrorResponse,
} from '@/lib/billing/types'

// ============================================================
// Traducción de errores SQL → EntitlementError
// ============================================================

function safeParseDetail(detail?: string | null): { limit?: number; current?: number } {
  if (!detail) return {}
  try {
    const json = JSON.parse(detail)
    return { limit: Number(json.limit), current: Number(json.current) }
  } catch { return {} }
}

export async function translateSupabaseErrorToEntitlement(err: {
  message?: string | null
  details?: string | null
} | null | undefined): Promise<EntitlementErrorResponse | null> {
  if (!err?.message) return null
  if (err.message.includes('branch_limit_exceeded')) {
    const meta = safeParseDetail(err.details)
    return new EntitlementError(
      'limit_exceeded',
      'Alcanzaste el límite de sucursales de tu plan',
      { feature: 'branches', limit: meta.limit, current: meta.current },
    ).toResponse()
  }
  if (err.message.includes('staff_limit_exceeded')) {
    const meta = safeParseDetail(err.details)
    return new EntitlementError(
      'limit_exceeded',
      'Alcanzaste el límite de empleados de tu plan',
      { feature: 'staff', limit: meta.limit, current: meta.current },
    ).toResponse()
  }
  if (err.message.includes('subscription_inactive')) {
    return new EntitlementError(
      'subscription_inactive',
      'Tu suscripción está pausada o cancelada',
    ).toResponse()
  }
  return null
}

// ============================================================
// Core: getEntitlements(orgId)
// ============================================================

function normalizeLimits(raw: unknown): Limits {
  const obj = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {}
  const asNum = (k: string): number => {
    const v = obj[k]
    if (typeof v === 'number') return v
    if (typeof v === 'string' && v.trim()) return Number(v) || 0
    return 0
  }
  return {
    branches: asNum('branches'),
    staff: asNum('staff'),
    clients: asNum('clients'),
    broadcasts_monthly: asNum('broadcasts_monthly'),
    ai_messages_monthly: asNum('ai_messages_monthly'),
  }
}

function isInGracePeriod(status: SubscriptionStatus, periodEnd: string | null): boolean {
  if (status !== 'past_due') return false
  if (!periodEnd) return false
  const GRACE_DAYS = 7
  const graceUntil = new Date(periodEnd).getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000
  return Date.now() < graceUntil
}

/**
 * Resuelve entitlements completos para una org. Cacheado por request con react.cache.
 */
export const getEntitlements = cache(
  async (orgId: string): Promise<Entitlements | null> => {
    if (!isValidUUID(orgId)) return null
    const supabase = createAdminClient()

    const { data: sub } = await supabase
      .from('organization_subscriptions')
      .select(`
        plan_id, status, trial_ends_at, current_period_end, cancel_at_period_end,
        extra_branch_seats, extra_staff_seats, grandfathered,
        plans:plan_id (id, name, tagline, price_ars_monthly, features, limits)
      `)
      .eq('organization_id', orgId)
      .maybeSingle()

    if (!sub) return null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plan: any = sub.plans
    if (!plan) return null

    const { data: addons } = await supabase
      .from('organization_modules')
      .select('module_id, enabled, expires_at, modules:module_id (feature_key)')
      .eq('organization_id', orgId)
      .eq('enabled', true)

    const now = Date.now()
    const enabledModuleIds: string[] = []
    const addonFeatures: Record<string, boolean> = {}
    for (const row of addons ?? []) {
      if (row.expires_at && new Date(row.expires_at).getTime() < now) continue
      enabledModuleIds.push(row.module_id)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fk = (row.modules as any)?.feature_key
      if (fk) addonFeatures[fk] = true
    }

    const planFeatures = (plan.features ?? {}) as Record<string, boolean>
    const features: Record<string, boolean> = { ...planFeatures, ...addonFeatures }

    const baseLimits = normalizeLimits(plan.limits)
    const limits: Limits = {
      ...baseLimits,
      branches: baseLimits.branches === -1 ? -1 : baseLimits.branches + (sub.extra_branch_seats ?? 0),
      staff: baseLimits.staff === -1 ? -1 : baseLimits.staff + (sub.extra_staff_seats ?? 0),
    }

    const periodStart = new Date()
    periodStart.setUTCDate(1)
    periodStart.setUTCHours(0, 0, 0, 0)

    const [branchesRes, staffRes, clientsRes, usageRes] = await Promise.all([
      supabase.from('branches').select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId).eq('is_active', true),
      supabase.from('staff').select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId).eq('is_active', true),
      supabase.from('clients').select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId),
      supabase.from('organization_usage').select('metric, count')
        .eq('organization_id', orgId).gte('period_start', periodStart.toISOString().slice(0, 10)),
    ])

    const usageMap: Record<string, number> = {}
    for (const row of usageRes.data ?? []) usageMap[row.metric] = row.count

    const currentUsage: CurrentUsage = {
      branches: branchesRes.count ?? 0,
      staff: staffRes.count ?? 0,
      clients: clientsRes.count ?? 0,
      broadcasts_this_month: usageMap['broadcasts_sent'] ?? 0,
      ai_messages_this_month: usageMap['ai_messages'] ?? 0,
    }

    const { data: allModules } = await supabase
      .from('modules')
      .select('*')
      .neq('status', 'hidden')
      .order('sort_order', { ascending: true })

    const enabledSet = new Set(enabledModuleIds)
    const visibleModules: ModuleMeta[] = (allModules ?? []).map((m) => {
      const includedInPlans = (m.included_in_plans as string[] | null) ?? []
      const unlocked =
        enabledSet.has(m.id) ||
        includedInPlans.includes(plan.id) ||
        planFeatures[m.feature_key] === true
      return {
        id: m.id,
        name: m.name,
        description: m.description,
        icon: m.icon,
        category: m.category,
        status: m.status as ModuleVisibility,
        teaser_copy: m.teaser_copy,
        estimated_release: m.estimated_release,
        price_ars_addon: m.price_ars_addon,
        included_in_plans: includedInPlans,
        feature_key: m.feature_key,
        sort_order: m.sort_order ?? 0,
        unlocked: Boolean(unlocked),
      }
    })

    const status = sub.status as SubscriptionStatus
    const inGracePeriod = isInGracePeriod(status, sub.current_period_end)
    const isAccessAllowed =
      status === 'active' ||
      status === 'trialing' ||
      (status === 'past_due' && inGracePeriod) ||
      (status === 'cancelled' && sub.cancel_at_period_end === true &&
        sub.current_period_end != null && new Date(sub.current_period_end).getTime() > now)

    return {
      orgId,
      plan: {
        id: plan.id,
        name: plan.name,
        tagline: plan.tagline ?? null,
        price_ars_monthly: plan.price_ars_monthly ?? 0,
      },
      status,
      trialEndsAt: sub.trial_ends_at ? new Date(sub.trial_ends_at) : null,
      currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end) : null,
      cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
      features,
      limits,
      currentUsage,
      enabledModuleIds,
      visibleModules,
      isGrandfathered: Boolean(sub.grandfathered),
      inGracePeriod,
      isAccessAllowed,
    }
  },
)

export async function getCurrentEntitlements(): Promise<Entitlements | null> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return null
  return getEntitlements(orgId)
}

// ============================================================
// Guards: hasFeature / requireFeature / requireLimit / requireMonthlyCap
// ============================================================

export async function hasFeature(featureKey: string, orgId?: string): Promise<boolean> {
  const ent = orgId ? await getEntitlements(orgId) : await getCurrentEntitlements()
  if (!ent) return false
  return ent.features[featureKey] === true
}

export async function requireFeature(featureKey: string): Promise<void> {
  const ent = await getCurrentEntitlements()
  if (!ent) {
    throw new EntitlementError('subscription_inactive', 'No hay suscripción activa')
  }
  if (!ent.isAccessAllowed) {
    throw new EntitlementError('subscription_inactive', 'Tu suscripción no está activa')
  }
  if (ent.features[featureKey] !== true) {
    await logDenialFireAndForget(featureKey, { plan: ent.plan.id })
    throw new EntitlementError(
      'feature_locked',
      `Tu plan ${ent.plan.name} no incluye esta funcionalidad`,
      { feature: featureKey },
    )
  }
}

function metricErrorMessage(metric: LimitMetric, limit: number): string {
  const label =
    metric === 'branches' ? 'sucursales' :
    metric === 'staff' ? 'empleados' :
    'clientes'
  return `Tu plan permite hasta ${limit} ${label}. Actualizá tu plan o sumá un add-on para crecer.`
}

export async function requireLimit(metric: LimitMetric, delta = 1): Promise<void> {
  const ent = await getCurrentEntitlements()
  if (!ent) throw new EntitlementError('subscription_inactive', 'No hay suscripción activa')
  if (!ent.isAccessAllowed) {
    throw new EntitlementError('subscription_inactive', 'Tu suscripción no está activa')
  }
  const limit = ent.limits[metric]
  if (limit === -1) return
  const current = ent.currentUsage[metric]
  if (current + delta > limit) {
    await logDenialFireAndForget(`limit.${metric}`, { plan: ent.plan.id, limit, current })
    throw new EntitlementError(
      'limit_exceeded',
      metricErrorMessage(metric, limit),
      { feature: metric, limit, current },
    )
  }
}

export async function requireMonthlyCap(metric: MonthlyCapMetric, delta = 1): Promise<void> {
  const ent = await getCurrentEntitlements()
  if (!ent) throw new EntitlementError('subscription_inactive', 'No hay suscripción activa')
  const limit = ent.limits[metric]
  if (limit === -1) return
  const currentKey =
    metric === 'broadcasts_monthly' ? 'broadcasts_this_month' : 'ai_messages_this_month'
  const current = ent.currentUsage[currentKey]
  if (current + delta > limit) {
    await logDenialFireAndForget(`cap.${metric}`, { plan: ent.plan.id, limit, current })
    throw new EntitlementError(
      'limit_exceeded',
      `Alcanzaste el cap mensual (${limit}) de tu plan para esta operación.`,
      { feature: metric, limit, current },
    )
  }
}

// ============================================================
// Usage tracking + denial logging
// ============================================================

export async function incrementUsage(
  metric: UsageMetric,
  amount = 1,
  orgId?: string,
): Promise<void> {
  const resolvedOrgId = orgId ?? (await getCurrentOrgId())
  if (!resolvedOrgId) return
  const supabase = createAdminClient()
  await supabase.rpc('increment_org_usage', {
    p_org_id: resolvedOrgId,
    p_metric: metric,
    p_amount: amount,
  })
}

export async function logDenial(
  featureKey: string,
  context: Record<string, unknown> = {},
): Promise<void> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return
  const supabase = createAdminClient()
  await supabase.from('entitlement_denials').insert({
    organization_id: orgId,
    feature_key: featureKey,
    context,
  })
}

async function logDenialFireAndForget(feature: string, context: Record<string, unknown>) {
  try { await logDenial(feature, context) } catch { /* no bloquear */ }
}

// ============================================================
// withEntitlements: wrapper para server actions
// ============================================================

export async function withEntitlements<T>(
  run: () => Promise<T>,
): Promise<T | EntitlementErrorResponse> {
  try {
    return await run()
  } catch (e) {
    if (e instanceof EntitlementError) return e.toResponse()
    const translated = await translateSupabaseErrorToEntitlement(
      e as { message?: string; details?: string } | null,
    )
    if (translated) return translated
    throw e
  }
}
