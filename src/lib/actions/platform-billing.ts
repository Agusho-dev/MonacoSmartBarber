'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requirePlatformAdmin } from '@/lib/actions/platform'

// ============================================================
// Plans CRUD
// ============================================================

export type PlanInput = {
  id: string
  name: string
  tagline?: string | null
  price_ars_monthly: number       // centavos
  price_ars_yearly: number
  price_usd_monthly?: number | null
  price_usd_yearly?: number | null
  trial_days: number
  features: Record<string, boolean>
  limits: Record<string, number>
  is_public: boolean
  sort_order: number
}

export async function listPlans() {
  await requirePlatformAdmin()
  const admin = createAdminClient()
  const { data } = await admin
    .from('plans')
    .select('*')
    .order('sort_order', { ascending: true })
  return data ?? []
}

export async function upsertPlan(input: PlanInput) {
  const pa = await requirePlatformAdmin()
  if (pa.role === 'support') return { error: 'Sin permiso' }
  const admin = createAdminClient()
  const { error } = await admin.from('plans').upsert({
    ...input,
    price_usd_monthly: input.price_usd_monthly ?? null,
    price_usd_yearly: input.price_usd_yearly ?? null,
    updated_at: new Date().toISOString(),
  })
  if (error) return { error: error.message }
  revalidatePath('/platform/plans')
  revalidatePath('/pricing')
  return { ok: true }
}

export async function deletePlan(id: string) {
  const pa = await requirePlatformAdmin()
  if (pa.role !== 'owner') return { error: 'Solo owner puede eliminar' }
  const admin = createAdminClient()
  // No eliminar si tiene subscriptions activas
  const { count } = await admin
    .from('organization_subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('plan_id', id)
  if ((count ?? 0) > 0) {
    return { error: `No se puede eliminar: ${count} orgs usan este plan` }
  }
  const { error } = await admin.from('plans').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/platform/plans')
  return { ok: true }
}

// ============================================================
// Modules CRUD
// ============================================================

export type ModuleInput = {
  id: string
  name: string
  description?: string | null
  icon?: string | null
  category?: string | null
  status: 'active' | 'beta' | 'coming_soon' | 'hidden'
  teaser_copy?: string | null
  estimated_release?: string | null
  price_ars_addon?: number | null
  included_in_plans: string[]
  feature_key: string
  sort_order: number
}

export async function listModules() {
  await requirePlatformAdmin()
  const admin = createAdminClient()
  const { data } = await admin
    .from('modules')
    .select('*')
    .order('sort_order', { ascending: true })
  return data ?? []
}

export async function upsertModule(input: ModuleInput) {
  const pa = await requirePlatformAdmin()
  if (pa.role === 'support') return { error: 'Sin permiso' }
  const admin = createAdminClient()
  const { error } = await admin.from('modules').upsert({
    ...input,
    updated_at: new Date().toISOString(),
  })
  if (error) return { error: error.message }
  revalidatePath('/platform/modules')
  revalidatePath('/dashboard', 'layout')
  return { ok: true }
}

export async function setModuleStatus(id: string, status: ModuleInput['status']) {
  const pa = await requirePlatformAdmin()
  if (pa.role === 'support') return { error: 'Sin permiso' }
  const admin = createAdminClient()
  const { error } = await admin.from('modules').update({ status }).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/platform/modules')
  revalidatePath('/dashboard', 'layout')
  return { ok: true }
}

export async function deleteModule(id: string) {
  const pa = await requirePlatformAdmin()
  if (pa.role !== 'owner') return { error: 'Solo owner puede eliminar' }
  const admin = createAdminClient()
  const { error } = await admin.from('modules').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/platform/modules')
  return { ok: true }
}

// ============================================================
// Subscriptions por org (cambio de plan manual, grants, seats)
// ============================================================

export async function getOrgBilling(orgId: string) {
  await requirePlatformAdmin()
  const admin = createAdminClient()

  const [sub, grants] = await Promise.all([
    admin.from('organization_subscriptions').select('*').eq('organization_id', orgId).maybeSingle(),
    admin.from('organization_modules')
      .select('*, modules:module_id(name, status, feature_key)')
      .eq('organization_id', orgId),
  ])

  const [{ data: branches }, { data: staff }, { data: clients }] = await Promise.all([
    admin.from('branches').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('is_active', true),
    admin.from('staff').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('is_active', true),
    admin.from('clients').select('id', { count: 'exact', head: true }).eq('organization_id', orgId),
  ])

  return {
    subscription: sub.data,
    grants: grants.data ?? [],
    usage: {
      branches: (branches as unknown as { count?: number })?.count ?? 0,
      staff: (staff as unknown as { count?: number })?.count ?? 0,
      clients: (clients as unknown as { count?: number })?.count ?? 0,
    },
  }
}

export async function setOrgPlan(orgId: string, planId: string, grandfathered = false) {
  const pa = await requirePlatformAdmin()
  if (pa.role === 'support') return { error: 'Sin permiso' }
  const admin = createAdminClient()

  const { error } = await admin
    .from('organization_subscriptions')
    .upsert(
      {
        organization_id: orgId,
        plan_id: planId,
        status: 'active',
        grandfathered,
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        cancel_at_period_end: false,
        cancelled_at: null,
      },
      { onConflict: 'organization_id' },
    )

  if (error) return { error: error.message }
  revalidatePath(`/platform/orgs/${orgId}`)
  revalidatePath(`/platform/organizations`)
  return { ok: true }
}

export async function setOrgSubscriptionStatus(
  orgId: string,
  status: 'active' | 'trialing' | 'past_due' | 'cancelled' | 'paused' | 'incomplete',
) {
  const pa = await requirePlatformAdmin()
  if (pa.role === 'support') return { error: 'Sin permiso' }
  const admin = createAdminClient()
  const { error } = await admin
    .from('organization_subscriptions')
    .update({ status })
    .eq('organization_id', orgId)
  if (error) return { error: error.message }
  revalidatePath(`/platform/orgs/${orgId}`)
  return { ok: true }
}

export async function setOrgExtraSeats(
  orgId: string,
  extraBranches: number,
  extraStaff: number,
) {
  const pa = await requirePlatformAdmin()
  if (pa.role === 'support') return { error: 'Sin permiso' }
  const admin = createAdminClient()
  const { error } = await admin
    .from('organization_subscriptions')
    .update({
      extra_branch_seats: Math.max(0, extraBranches),
      extra_staff_seats: Math.max(0, extraStaff),
    })
    .eq('organization_id', orgId)
  if (error) return { error: error.message }
  revalidatePath(`/platform/orgs/${orgId}`)
  return { ok: true }
}

export async function grantModuleToOrg(orgId: string, moduleId: string, notes?: string) {
  const pa = await requirePlatformAdmin()
  if (pa.role === 'support') return { error: 'Sin permiso' }
  const admin = createAdminClient()
  const { error } = await admin
    .from('organization_modules')
    .upsert(
      { organization_id: orgId, module_id: moduleId, enabled: true, source: 'grant', notes: notes ?? null, expires_at: null },
      { onConflict: 'organization_id,module_id' },
    )
  if (error) return { error: error.message }
  revalidatePath(`/platform/orgs/${orgId}`)
  return { ok: true }
}

export async function revokeModuleFromOrg(orgId: string, moduleId: string) {
  const pa = await requirePlatformAdmin()
  if (pa.role === 'support') return { error: 'Sin permiso' }
  const admin = createAdminClient()
  const { error } = await admin
    .from('organization_modules')
    .delete()
    .eq('organization_id', orgId)
    .eq('module_id', moduleId)
  if (error) return { error: error.message }
  revalidatePath(`/platform/orgs/${orgId}`)
  return { ok: true }
}

// ============================================================
// Waitlist
// ============================================================

export async function listWaitlistGrouped() {
  await requirePlatformAdmin()
  const admin = createAdminClient()
  const { data } = await admin
    .from('module_waitlist')
    .select('*, modules:module_id(name, status), organizations:organization_id(name, slug)')
    .order('created_at', { ascending: false })
  return data ?? []
}

export async function notifyWaitlistForModule(moduleId: string) {
  const pa = await requirePlatformAdmin()
  if (pa.role === 'support') return { error: 'Sin permiso' }
  const admin = createAdminClient()
  const { error } = await admin
    .from('module_waitlist')
    .update({ notified_at: new Date().toISOString() })
    .eq('module_id', moduleId)
    .is('notified_at', null)
  if (error) return { error: error.message }
  revalidatePath('/platform/waitlist')
  return { ok: true }
}

// ----- Landing leads (public prospects from studiOS.com.ar landing) -----

export type LandingLeadStatus = 'pending' | 'contacted' | 'converted' | 'discarded'

export type LandingLead = {
  id: string
  full_name: string
  email: string
  phone: string | null
  barbershop_name: string | null
  city: string | null
  country: string
  team_size: string
  branches_count: string
  current_software: string | null
  interests: string[]
  start_timeline: string
  notes: string | null
  status: LandingLeadStatus
  source: string
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  referrer: string | null
  contacted_at: string | null
  notified_at: string | null
  created_at: string
  updated_at: string
}

export async function listLandingLeads() {
  await requirePlatformAdmin()
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('landing_waitlist')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) {
    console.error('[listLandingLeads]', error)
    return [] as LandingLead[]
  }
  return (data ?? []) as LandingLead[]
}

export async function updateLandingLeadStatus(
  id: string,
  status: LandingLeadStatus
) {
  const pa = await requirePlatformAdmin()
  if (pa.role === 'support') return { error: 'Sin permiso' }
  const admin = createAdminClient()
  const patch: Record<string, unknown> = { status }
  if (status === 'contacted') patch.contacted_at = new Date().toISOString()
  const { error } = await admin
    .from('landing_waitlist')
    .update(patch)
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/platform/waitlist')
  return { ok: true }
}

// ============================================================
// Denials (analytics de upsell)
// ============================================================

export async function listTopDeniedFeatures(days = 30, limit = 20) {
  await requirePlatformAdmin()
  const admin = createAdminClient()
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const { data } = await admin
    .from('entitlement_denials')
    .select('feature_key, organization_id, created_at')
    .gte('created_at', since)

  const byFeature = new Map<string, { count: number; orgs: Set<string> }>()
  for (const row of data ?? []) {
    const e = byFeature.get(row.feature_key) ?? { count: 0, orgs: new Set() }
    e.count += 1
    e.orgs.add(row.organization_id)
    byFeature.set(row.feature_key, e)
  }

  return Array.from(byFeature.entries())
    .map(([feature_key, v]) => ({ feature_key, attempts: v.count, distinct_orgs: v.orgs.size }))
    .sort((a, b) => b.attempts - a.attempts)
    .slice(0, limit)
}

export async function listRecentDenials(limit = 100) {
  await requirePlatformAdmin()
  const admin = createAdminClient()
  const { data } = await admin
    .from('entitlement_denials')
    .select('id, feature_key, organization_id, context, created_at, organizations:organization_id(name, slug)')
    .order('created_at', { ascending: false })
    .limit(limit)
  return data ?? []
}

// ============================================================
// Billing events (webhooks)
// ============================================================

export async function listBillingEvents(limit = 100) {
  await requirePlatformAdmin()
  const admin = createAdminClient()
  const { data } = await admin
    .from('billing_events')
    .select('id, organization_id, provider, provider_event_id, event_type, processed_at, processing_error, created_at, organizations:organization_id(name, slug)')
    .order('created_at', { ascending: false })
    .limit(limit)
  return data ?? []
}

// ============================================================
// KPIs para el dashboard
// ============================================================

export async function getPlatformMetrics() {
  await requirePlatformAdmin()
  const admin = createAdminClient()

  const [subsRes, plansRes, trialsRes, pastDueRes] = await Promise.all([
    admin.from('organization_subscriptions').select('plan_id, status, grandfathered'),
    admin.from('plans').select('id, name, price_ars_monthly'),
    admin.from('organization_subscriptions').select('organization_id, trial_ends_at, organizations:organization_id(name)').eq('status', 'trialing').order('trial_ends_at', { ascending: true }),
    admin.from('organization_subscriptions').select('organization_id, current_period_end, organizations:organization_id(name)').eq('status', 'past_due'),
  ])

  const subs = subsRes.data ?? []
  const plans = plansRes.data ?? []
  const planPriceById = new Map(plans.map(p => [p.id, p.price_ars_monthly]))

  const billableSubs = subs.filter(s => s.status === 'active' && !s.grandfathered)
  const mrrCentavos = billableSubs.reduce((acc, s) => acc + (planPriceById.get(s.plan_id) ?? 0), 0)

  const distByPlan = new Map<string, number>()
  for (const s of subs) {
    if (s.status === 'active' || s.status === 'trialing') {
      distByPlan.set(s.plan_id, (distByPlan.get(s.plan_id) ?? 0) + 1)
    }
  }

  const planDistribution = plans.map(p => ({
    plan_id: p.id,
    name: p.name,
    count: distByPlan.get(p.id) ?? 0,
  }))

  return {
    mrr_ars: mrrCentavos / 100,
    arr_ars: (mrrCentavos * 12) / 100,
    total_orgs: subs.length,
    active_orgs: subs.filter(s => s.status === 'active').length,
    trial_orgs: subs.filter(s => s.status === 'trialing').length,
    past_due_orgs: subs.filter(s => s.status === 'past_due').length,
    cancelled_orgs: subs.filter(s => s.status === 'cancelled').length,
    grandfathered_orgs: subs.filter(s => s.grandfathered).length,
    plan_distribution: planDistribution,
    trials_ending_soon: (trialsRes.data ?? []).slice(0, 10),
    past_due_list: pastDueRes.data ?? [],
  }
}

export async function getTrialsExpiringSoon(days = 7) {
  await requirePlatformAdmin()
  const admin = createAdminClient()
  const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
  const { data } = await admin
    .from('organization_subscriptions')
    .select('organization_id, trial_ends_at, plan_id, organizations:organization_id(name, slug)')
    .eq('status', 'trialing')
    .lte('trial_ends_at', until)
    .order('trial_ends_at', { ascending: true })
  return data ?? []
}
