'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient } from '@/lib/supabase/server'

/**
 * Plataforma (super-admin) — acciones reservadas al equipo BarberOS.
 * Todos los checks pasan por `requirePlatformAdmin()` antes de cualquier lectura/escritura.
 */

export interface PlatformAdminProfile {
  user_id: string
  full_name: string | null
  role: 'owner' | 'admin' | 'support'
}

export async function requirePlatformAdmin(): Promise<PlatformAdminProfile> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?reason=platform')

  const admin = createAdminClient()
  const { data: paRow } = await admin
    .from('platform_admins')
    .select('user_id, full_name, role')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!paRow) redirect('/login?reason=platform_unauthorized')
  return paRow as PlatformAdminProfile
}

export async function isPlatformAdmin(): Promise<boolean> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false
    const admin = createAdminClient()
    const { data } = await admin.from('platform_admins').select('user_id').eq('user_id', user.id).maybeSingle()
    return !!data
  } catch { return false }
}

async function logAction(
  adminUserId: string,
  action: string,
  targetOrgId: string | null,
  targetUserId: string | null,
  payload: Record<string, unknown>,
) {
  const admin = createAdminClient()
  await admin.from('platform_admin_actions').insert({
    admin_user_id: adminUserId,
    action,
    target_org_id: targetOrgId,
    target_user_id: targetUserId,
    payload,
  })
}

// ---------------------------------------------------------------------------
// Listado de organizaciones con métricas
// ---------------------------------------------------------------------------

export interface OrgPlatformRow {
  id: string
  name: string
  slug: string
  created_at: string
  subscription_status: string
  subscription_plan: string
  max_branches: number
  trial_ends_at: string | null
  country_code: string
  currency: string
  is_active: boolean
  billing_email: string | null
  active_branches: number
  total_staff: number
  total_clients: number
  total_visits: number
  last_visit_at: string | null
}

export async function listOrganizationsForPlatform(): Promise<OrgPlatformRow[]> {
  await requirePlatformAdmin()
  const admin = createAdminClient()

  const { data: orgs } = await admin
    .from('organizations')
    .select('id, name, slug, created_at, subscription_status, subscription_plan, max_branches, trial_ends_at, country_code, currency, is_active, billing_email')
    .order('created_at', { ascending: false })

  if (!orgs) return []

  const orgIds = orgs.map(o => o.id)

  const [{ data: branchCounts }, { data: staffCounts }, { data: clientCounts }, { data: visitAgg }] = await Promise.all([
    admin.from('branches').select('organization_id').in('organization_id', orgIds).eq('is_active', true),
    admin.from('staff').select('organization_id').in('organization_id', orgIds).eq('is_active', true),
    admin.from('clients').select('organization_id').in('organization_id', orgIds),
    admin.from('visits').select('organization_id, completed_at').in('organization_id', orgIds).order('completed_at', { ascending: false }),
  ])

  const branchByOrg = count(branchCounts ?? [], 'organization_id')
  const staffByOrg = count(staffCounts ?? [], 'organization_id')
  const clientByOrg = count(clientCounts ?? [], 'organization_id')
  const visitByOrg = count(visitAgg ?? [], 'organization_id')
  const lastVisitByOrg = new Map<string, string>()
  for (const v of (visitAgg ?? []) as Array<{ organization_id: string; completed_at: string | null }>) {
    if (!v.completed_at) continue
    if (!lastVisitByOrg.has(v.organization_id)) lastVisitByOrg.set(v.organization_id, v.completed_at)
  }

  return orgs.map(o => ({
    ...o,
    active_branches: branchByOrg.get(o.id) ?? 0,
    total_staff:     staffByOrg.get(o.id) ?? 0,
    total_clients:   clientByOrg.get(o.id) ?? 0,
    total_visits:    visitByOrg.get(o.id) ?? 0,
    last_visit_at:   lastVisitByOrg.get(o.id) ?? null,
  }))
}

function count<T extends Record<string, unknown>>(rows: T[], key: keyof T): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of rows) {
    const k = String(r[key])
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return m
}

// ---------------------------------------------------------------------------
// Mutaciones — billing, plan, status, toggle active
// ---------------------------------------------------------------------------

export async function updateOrgBilling(input: {
  orgId: string
  max_branches?: number
  subscription_status?: string
  subscription_plan?: string
  trial_ends_at?: string | null
  billing_email?: string | null
  billing_notes?: string | null
}) {
  const pa = await requirePlatformAdmin()
  const admin = createAdminClient()

  const patch: Record<string, unknown> = {}
  if (input.max_branches !== undefined) {
    if (input.max_branches < 1) return { error: 'max_branches >= 1' }
    patch.max_branches = input.max_branches
  }
  if (input.subscription_status !== undefined) {
    if (!['trial','active','past_due','cancelled','suspended'].includes(input.subscription_status)) {
      return { error: 'subscription_status inválido' }
    }
    patch.subscription_status = input.subscription_status
  }
  if (input.subscription_plan !== undefined) patch.subscription_plan = input.subscription_plan
  if (input.trial_ends_at !== undefined) patch.trial_ends_at = input.trial_ends_at
  if (input.billing_email !== undefined) patch.billing_email = input.billing_email
  if (input.billing_notes !== undefined) patch.billing_notes = input.billing_notes

  if (Object.keys(patch).length === 0) return { error: 'Nada para actualizar' }

  const { error } = await admin.from('organizations').update(patch).eq('id', input.orgId)
  if (error) return { error: error.message }

  await logAction(pa.user_id, 'update_billing', input.orgId, null, patch)
  revalidatePath('/platform')
  revalidatePath(`/platform/orgs/${input.orgId}`)
  return { success: true }
}

export async function toggleOrgActive(orgId: string, isActive: boolean) {
  const pa = await requirePlatformAdmin()
  const admin = createAdminClient()
  const { error } = await admin.from('organizations').update({ is_active: isActive }).eq('id', orgId)
  if (error) return { error: error.message }
  await logAction(pa.user_id, isActive ? 'activate_org' : 'deactivate_org', orgId, null, {})
  revalidatePath('/platform')
  return { success: true }
}

export async function impersonateOrg(orgId: string) {
  const pa = await requirePlatformAdmin()
  const admin = createAdminClient()
  // Solo owner/admin de plataforma pueden impersonar
  if (pa.role === 'support') return { error: 'Tu rol no permite impersonation' }

  const { data: org } = await admin.from('organizations').select('id, is_active').eq('id', orgId).maybeSingle()
  if (!org || !org.is_active) return { error: 'Org no encontrada o inactiva' }

  const ssr = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return { error: 'No auth' }

  // Actualizar app_metadata con active_organization_id
  const { error } = await admin.auth.admin.updateUserById(user.id, {
    app_metadata: { ...user.app_metadata, active_organization_id: orgId, is_platform_impersonating: true },
  })
  if (error) return { error: error.message }

  // Setear cookies
  const { cookies } = await import('next/headers')
  const cookieStore = await cookies()
  cookieStore.set('active_organization', orgId, { maxAge: 60 * 60 * 24, path: '/' })
  cookieStore.set('platform_impersonation', '1', { maxAge: 60 * 60 * 24, path: '/' })

  await logAction(pa.user_id, 'impersonate', orgId, null, {})
  return { success: true }
}

export async function stopImpersonation() {
  const pa = await requirePlatformAdmin()
  const ssr = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return { error: 'No auth' }

  const admin = createAdminClient()
  const metadata = { ...user.app_metadata }
  delete metadata.active_organization_id
  delete metadata.is_platform_impersonating
  await admin.auth.admin.updateUserById(user.id, { app_metadata: metadata })

  const { cookies } = await import('next/headers')
  const cookieStore = await cookies()
  cookieStore.delete('active_organization')
  cookieStore.delete('platform_impersonation')

  await logAction(pa.user_id, 'stop_impersonation', null, null, {})
  return { success: true }
}

export async function listRecentPlatformActions(limit = 100) {
  await requirePlatformAdmin()
  const admin = createAdminClient()
  const { data } = await admin
    .from('platform_admin_actions')
    .select('id, admin_user_id, action, target_org_id, target_user_id, payload, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  return data ?? []
}
