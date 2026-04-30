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

// ============================================================
// MANUAL BILLING — Subscription requests
// ============================================================

export type SubscriptionRequestStatus = 'pending' | 'contacted' | 'paid' | 'cancelled'

export interface SubscriptionRequestRow {
  id: string
  organization_id: string
  org_name: string
  org_slug: string
  requested_plan_id: string
  plan_name: string
  plan_price_ars_monthly: number
  plan_price_ars_yearly: number
  requested_billing_cycle: 'monthly' | 'yearly'
  request_kind: 'plan_change' | 'renewal' | 'module_addon'
  module_id: string | null
  status: SubscriptionRequestStatus
  notes: string | null
  contact_log: Array<{ at: string; by: string | null; channel: string; note: string }>
  requested_by: string | null
  requested_by_email: string | null
  contacted_at: string | null
  resolved_at: string | null
  cancellation_reason: string | null
  current_plan_id: string | null
  current_status: string | null
  billing_email: string | null
  billing_whatsapp: string | null
  created_at: string
  updated_at: string
  days_pending: number
}

export async function listSubscriptionRequests(filters?: {
  status?: SubscriptionRequestStatus | 'all'
  kind?: 'plan_change' | 'renewal' | 'module_addon' | 'all'
}): Promise<SubscriptionRequestRow[]> {
  await requirePlatformAdmin()
  const admin = createAdminClient()

  let q = admin
    .from('subscription_requests')
    .select(`
      id, organization_id, requested_plan_id, requested_billing_cycle,
      request_kind, module_id, status, notes, contact_log,
      requested_by, contacted_at, resolved_at, cancellation_reason,
      created_at, updated_at,
      organizations:organization_id ( name, slug ),
      plans:requested_plan_id ( name, price_ars_monthly, price_ars_yearly )
    `)
    .order('created_at', { ascending: false })

  if (filters?.status && filters.status !== 'all') q = q.eq('status', filters.status)
  if (filters?.kind && filters.kind !== 'all') q = q.eq('request_kind', filters.kind)

  const { data, error } = await q
  if (error) {
    console.error('[listSubscriptionRequests]', error)
    return []
  }

  // Enriquecer con datos de la sub actual y del usuario que pidió
  const orgIds = Array.from(new Set((data ?? []).map((r) => r.organization_id)))
  const userIds = Array.from(new Set(
    (data ?? []).map((r) => r.requested_by).filter((x): x is string => !!x),
  ))

  const [subsRes, usersRes] = await Promise.all([
    orgIds.length
      ? admin.from('organization_subscriptions')
          .select('organization_id, plan_id, status, billing_email, billing_whatsapp')
          .in('organization_id', orgIds)
      : Promise.resolve({ data: [] as Array<{ organization_id: string; plan_id: string; status: string; billing_email: string | null; billing_whatsapp: string | null }> }),
    userIds.length
      ? admin.auth.admin.listUsers({ page: 1, perPage: 200 })
      : Promise.resolve({ data: { users: [] } }),
  ])

  const subMap = new Map<string, { plan_id: string; status: string; billing_email: string | null; billing_whatsapp: string | null }>()
  for (const s of subsRes.data ?? []) {
    subMap.set(s.organization_id, {
      plan_id: s.plan_id,
      status: s.status,
      billing_email: s.billing_email,
      billing_whatsapp: s.billing_whatsapp,
    })
  }

  const userMap = new Map<string, string>()
  const userList = (usersRes.data as { users?: Array<{ id: string; email?: string }> }).users ?? []
  for (const u of userList) {
    if (u.email) userMap.set(u.id, u.email)
  }

  return (data ?? []).map((r) => {
    const org = (r as Record<string, unknown>).organizations as { name?: string; slug?: string } | null
    const plan = (r as Record<string, unknown>).plans as {
      name?: string; price_ars_monthly?: number; price_ars_yearly?: number
    } | null
    const sub = subMap.get(r.organization_id)
    const ageMs = Date.now() - new Date(r.created_at).getTime()
    return {
      id: r.id,
      organization_id: r.organization_id,
      org_name: org?.name ?? '—',
      org_slug: org?.slug ?? '',
      requested_plan_id: r.requested_plan_id,
      plan_name: plan?.name ?? r.requested_plan_id,
      plan_price_ars_monthly: plan?.price_ars_monthly ?? 0,
      plan_price_ars_yearly: plan?.price_ars_yearly ?? 0,
      requested_billing_cycle: r.requested_billing_cycle as 'monthly' | 'yearly',
      request_kind: r.request_kind as 'plan_change' | 'renewal' | 'module_addon',
      module_id: r.module_id,
      status: r.status as SubscriptionRequestStatus,
      notes: r.notes,
      contact_log: (r.contact_log as SubscriptionRequestRow['contact_log']) ?? [],
      requested_by: r.requested_by,
      requested_by_email: r.requested_by ? (userMap.get(r.requested_by) ?? null) : null,
      contacted_at: r.contacted_at,
      resolved_at: r.resolved_at,
      cancellation_reason: r.cancellation_reason,
      current_plan_id: sub?.plan_id ?? null,
      current_status: sub?.status ?? null,
      billing_email: sub?.billing_email ?? null,
      billing_whatsapp: sub?.billing_whatsapp ?? null,
      created_at: r.created_at,
      updated_at: r.updated_at,
      days_pending: Math.floor(ageMs / (24 * 60 * 60 * 1000)),
    }
  })
}

export async function markRequestContacted(
  requestId: string,
  channel: 'whatsapp' | 'email' | 'llamada' | 'otro',
  note: string,
): Promise<{ ok: true } | { error: string }> {
  const pa = await requirePlatformAdmin()
  const admin = createAdminClient()

  const { data: existing, error: getErr } = await admin
    .from('subscription_requests')
    .select('contact_log, status, organization_id')
    .eq('id', requestId)
    .maybeSingle()

  if (getErr || !existing) return { error: getErr?.message ?? 'Request no encontrada' }

  const log = Array.isArray(existing.contact_log) ? existing.contact_log : []
  log.push({
    at: new Date().toISOString(),
    by: pa.user_id,
    channel,
    note,
  })

  const { error } = await admin
    .from('subscription_requests')
    .update({
      contact_log: log,
      status: existing.status === 'pending' ? 'contacted' : existing.status,
      contacted_at: existing.status === 'pending' ? new Date().toISOString() : undefined,
      contacted_by: pa.user_id,
    })
    .eq('id', requestId)

  if (error) return { error: error.message }

  await admin.from('platform_admin_actions').insert({
    admin_user_id: pa.user_id,
    action: 'subscription_request.contacted',
    target_org_id: existing.organization_id,
    payload: { request_id: requestId, channel, note },
  })

  revalidatePath('/platform/billing-requests')
  revalidatePath(`/platform/orgs/${existing.organization_id}`)
  return { ok: true }
}

export async function cancelSubscriptionRequest(
  requestId: string,
  reason: string,
): Promise<{ ok: true } | { error: string }> {
  const pa = await requirePlatformAdmin()
  const admin = createAdminClient()

  const { data: existing } = await admin
    .from('subscription_requests')
    .select('organization_id, status')
    .eq('id', requestId)
    .maybeSingle()

  if (!existing) return { error: 'Request no encontrada' }
  if (existing.status === 'paid') return { error: 'No se puede cancelar una request ya pagada' }

  const { error } = await admin
    .from('subscription_requests')
    .update({
      status: 'cancelled',
      cancellation_reason: reason,
      resolved_at: new Date().toISOString(),
      resolved_by: pa.user_id,
    })
    .eq('id', requestId)

  if (error) return { error: error.message }

  await admin.from('platform_admin_actions').insert({
    admin_user_id: pa.user_id,
    action: 'subscription_request.cancelled',
    target_org_id: existing.organization_id,
    payload: { request_id: requestId, reason },
  })

  revalidatePath('/platform/billing-requests')
  return { ok: true }
}

// ============================================================
// MANUAL BILLING — Registrar pago
// ============================================================

export interface RecordManualPaymentInput {
  organization_id: string
  request_id?: string | null
  plan_id: string
  billing_cycle: 'monthly' | 'yearly'
  amount_ars: number             // en centavos (consistente con plans)
  payment_method: 'transferencia' | 'efectivo' | 'mp_link' | 'usdt' | 'otro'
  reference?: string | null
  receipt_url?: string | null
  period_months: number          // cuántos meses cubre este pago (1, 3, 6, 12...)
  starts_at?: string | null      // ISO; si null, comienza ahora o al final del período actual
  notes?: string | null
}

export async function recordManualPayment(
  input: RecordManualPaymentInput,
): Promise<{ ok: true; payment_id: string; period_end: string } | { error: string }> {
  const pa = await requirePlatformAdmin()
  if (pa.role === 'support') return { error: 'Sin permiso (rol support)' }
  const admin = createAdminClient()

  if (input.period_months <= 0) return { error: 'period_months debe ser mayor a 0' }
  if (input.amount_ars < 0) return { error: 'amount_ars no puede ser negativo' }

  // Resolver period_start: por defecto, max(now, current_period_end del sub)
  const { data: sub } = await admin
    .from('organization_subscriptions')
    .select('current_period_end, status')
    .eq('organization_id', input.organization_id)
    .maybeSingle()

  const now = new Date()
  const baseStart = input.starts_at
    ? new Date(input.starts_at)
    : (sub?.current_period_end && new Date(sub.current_period_end) > now
        ? new Date(sub.current_period_end)
        : now)

  const periodEnd = new Date(baseStart)
  periodEnd.setMonth(periodEnd.getMonth() + input.period_months)

  const { data: payment, error } = await admin
    .from('manual_payments')
    .insert({
      organization_id: input.organization_id,
      request_id: input.request_id ?? null,
      plan_id: input.plan_id,
      billing_cycle: input.billing_cycle,
      amount_ars: input.amount_ars,
      currency: 'ARS',
      payment_method: input.payment_method,
      reference: input.reference ?? null,
      receipt_url: input.receipt_url ?? null,
      period_start: baseStart.toISOString(),
      period_end: periodEnd.toISOString(),
      recorded_by: pa.user_id,
      notes: input.notes ?? null,
    })
    .select('id, period_end')
    .single()

  if (error || !payment) return { error: error?.message ?? 'Falló el INSERT' }

  await admin.from('platform_admin_actions').insert({
    admin_user_id: pa.user_id,
    action: 'manual_payment.recorded',
    target_org_id: input.organization_id,
    payload: {
      payment_id: payment.id,
      plan_id: input.plan_id,
      amount_ars: input.amount_ars,
      method: input.payment_method,
      period_months: input.period_months,
    },
  })

  // Email de confirmación al cliente (fire-and-forget)
  try {
    const [orgRes, subRes, planRes] = await Promise.all([
      admin.from('organizations').select('name').eq('id', input.organization_id).maybeSingle(),
      admin.from('organization_subscriptions').select('billing_email').eq('organization_id', input.organization_id).maybeSingle(),
      admin.from('plans').select('name').eq('id', input.plan_id).maybeSingle(),
    ])
    const billingEmail = subRes.data?.billing_email
    if (billingEmail) {
      const { sendPaymentRecordedEmail } = await import('@/lib/email/send')
      void sendPaymentRecordedEmail({
        orgName: orgRes.data?.name ?? 'tu organización',
        ownerEmail: billingEmail,
        planName: planRes.data?.name ?? input.plan_id,
        amountArs: input.amount_ars,
        periodStart: baseStart.toISOString(),
        periodEnd: payment.period_end,
        method: input.payment_method,
        reference: input.reference ?? null,
      })
    }
  } catch (e) {
    console.error('[recordManualPayment] email skipped:', e)
  }

  revalidatePath('/platform/billing-requests')
  revalidatePath('/platform/dashboard')
  revalidatePath(`/platform/orgs/${input.organization_id}`)
  return { ok: true, payment_id: payment.id, period_end: payment.period_end }
}

export async function listManualPayments(orgId: string, limit = 50) {
  await requirePlatformAdmin()
  const admin = createAdminClient()
  const { data } = await admin
    .from('manual_payments')
    .select('id, plan_id, billing_cycle, amount_ars, currency, payment_method, reference, receipt_url, period_start, period_end, recorded_by, notes, created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit)
  return data ?? []
}

export async function listManualPaymentsForOrg(orgId: string) {
  // Variante para uso del cliente final (RLS already filters)
  const admin = createAdminClient()
  const { data } = await admin
    .from('manual_payments')
    .select('id, plan_id, billing_cycle, amount_ars, currency, payment_method, reference, receipt_url, period_start, period_end, notes, created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
  return data ?? []
}

export async function extendSubscriptionPeriod(
  orgId: string,
  days: number,
  reason: string,
): Promise<{ ok: true } | { error: string }> {
  const pa = await requirePlatformAdmin()
  if (pa.role === 'support') return { error: 'Sin permiso (rol support)' }
  const admin = createAdminClient()

  if (days <= 0 || days > 365) return { error: 'Días fuera de rango (1-365)' }

  const { data: sub } = await admin
    .from('organization_subscriptions')
    .select('id, current_period_end')
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!sub) return { error: 'No existe suscripción' }

  const base = sub.current_period_end ? new Date(sub.current_period_end) : new Date()
  const newEnd = new Date(base.getTime() + days * 24 * 60 * 60 * 1000)

  const { error } = await admin
    .from('organization_subscriptions')
    .update({
      current_period_end: newEnd.toISOString(),
      next_renewal_reminder_at: new Date(newEnd.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'active',
      grace_period_ends_at: null,
    })
    .eq('id', sub.id)

  if (error) return { error: error.message }

  await admin.from('platform_admin_actions').insert({
    admin_user_id: pa.user_id,
    action: 'subscription.extended',
    target_org_id: orgId,
    payload: { days, reason, new_period_end: newEnd.toISOString() },
  })

  revalidatePath(`/platform/orgs/${orgId}`)
  revalidatePath('/platform/dashboard')
  return { ok: true }
}

export async function setSubscriptionPastDue(
  orgId: string,
  graceDays = 5,
): Promise<{ ok: true } | { error: string }> {
  const pa = await requirePlatformAdmin()
  const admin = createAdminClient()
  const graceEnd = new Date(Date.now() + graceDays * 24 * 60 * 60 * 1000).toISOString()

  const { error } = await admin
    .from('organization_subscriptions')
    .update({
      status: 'past_due',
      grace_period_ends_at: graceEnd,
    })
    .eq('organization_id', orgId)

  if (error) return { error: error.message }

  await admin.from('platform_admin_actions').insert({
    admin_user_id: pa.user_id,
    action: 'subscription.set_past_due',
    target_org_id: orgId,
    payload: { grace_period_ends_at: graceEnd },
  })

  revalidatePath(`/platform/orgs/${orgId}`)
  return { ok: true }
}

// ============================================================
// MANUAL BILLING — KPIs
// ============================================================

export async function getManualBillingMetrics() {
  await requirePlatformAdmin()
  const admin = createAdminClient()

  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)

  const startOfLastMonth = new Date(startOfMonth)
  startOfLastMonth.setMonth(startOfLastMonth.getMonth() - 1)

  const [thisMonthRes, lastMonthRes, pendingRes, in14Res, pastDueRes] = await Promise.all([
    admin.from('manual_payments')
      .select('amount_ars')
      .gte('created_at', startOfMonth.toISOString()),
    admin.from('manual_payments')
      .select('amount_ars')
      .gte('created_at', startOfLastMonth.toISOString())
      .lt('created_at', startOfMonth.toISOString()),
    admin.from('subscription_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
    admin.from('v_subscription_renewals_due')
      .select('subscription_id, organization_id, org_name, slug, plan_id, current_period_end, days_until_renewal, billing_email, billing_whatsapp')
      .lte('days_until_renewal', 14)
      .eq('status', 'active')
      .order('days_until_renewal', { ascending: true })
      .limit(50),
    admin.from('v_subscription_renewals_due')
      .select('subscription_id, organization_id, org_name, slug, plan_id, grace_period_ends_at, days_grace_left, billing_email, billing_whatsapp')
      .eq('status', 'past_due')
      .order('days_grace_left', { ascending: true })
      .limit(50),
  ])

  const sum = (rows: Array<{ amount_ars: number }> | null) =>
    (rows ?? []).reduce((acc, r) => acc + (r.amount_ars ?? 0), 0)

  return {
    revenue_this_month_ars_cents: sum(thisMonthRes.data),
    revenue_last_month_ars_cents: sum(lastMonthRes.data),
    pending_requests_count: pendingRes.count ?? 0,
    upcoming_renewals: in14Res.data ?? [],
    past_due_list: pastDueRes.data ?? [],
  }
}
