import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { DashboardShell } from '@/components/dashboard/dashboard-shell'
import { ImpersonationBanner } from '@/components/dashboard/impersonation-banner'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getEntitlements } from '@/lib/actions/entitlements'
import type { EntitlementsSnapshot } from '@/components/billing/entitlements-provider'

export const dynamic = 'force-dynamic'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const cookieStore = await cookies()

  // Auth + orgId resolveado en paralelo. getCurrentOrgId() está cacheado y
  // reusará el mismo auth.getUser() que ejecutamos acá (vía getCachedAuthUser).
  const [authResult, orgId] = await Promise.all([
    supabase.auth.getUser(),
    getCurrentOrgId(),
  ])

  const { data: { user: authUser }, error: authError } = authResult

  if (authError || !authUser) {
    redirect('/login')
  }

  if (!orgId) {
    redirect('/login')
  }

  const adminClient = createAdminClient()
  const isImpersonating = cookieStore.get('platform_impersonation')?.value === '1'

  // Bloque paralelo principal: todas las queries que dependen sólo de (orgId, authUser.id)
  // se disparan al mismo tiempo. Antes eran ~6 roundtrips secuenciales.
  const [
    { data: orgRow },
    { data: staff },
    { data: staffOrgs },
    { data: memberOrgs },
    fullEntitlements,
  ] = await Promise.all([
    adminClient
      .from('organizations')
      .select('settings, subscription_status, logo_url, name')
      .eq('id', orgId)
      .maybeSingle(),
    supabase
      .from('staff')
      .select('full_name, email, role, role_id, organization_id')
      .eq('auth_user_id', authUser.id)
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .maybeSingle(),
    adminClient
      .from('staff')
      .select('organization_id, organizations(id, name, slug, logo_url)')
      .eq('auth_user_id', authUser.id)
      .eq('is_active', true),
    adminClient
      .from('organization_members')
      .select('organization_id, organizations(id, name, slug, logo_url)')
      .eq('user_id', authUser.id),
    getEntitlements(orgId),
  ])

  // Guards de la org (ahora con la data ya en memoria)
  if (orgRow?.subscription_status === 'suspended' || orgRow?.subscription_status === 'cancelled') {
    redirect('/login?reason=inactive')
  }

  const onboardingCompleted = (orgRow?.settings as { onboarding_completed?: boolean } | null)?.onboarding_completed === true
  if (!onboardingCompleted) {
    redirect('/onboarding')
  }

  // Si no es staff de la org actual, intentar fallback a organization_members.
  // Esto SÍ es secuencial porque sólo lo necesitamos cuando staff es null.
  let userProfile = staff
  if (!userProfile) {
    const { data: member } = await adminClient
      .from('organization_members')
      .select('role')
      .eq('user_id', authUser.id)
      .eq('organization_id', orgId)
      .maybeSingle()

    if (member) {
      userProfile = {
        full_name: authUser.user_metadata?.full_name || authUser.email || 'Admin',
        email: authUser.email,
        role: member.role,
        role_id: null,
        organization_id: orgId,
      }
    }
  }

  if (!userProfile) {
    console.error('No profile found for this org:', { authUserId: authUser.id, orgId })
    redirect('/login')
  }

  type OrgJoin = { organization_id: string; organizations: { id: string; name: string; slug: string; logo_url: string | null } | null }
  const activeOrgsMap = new Map<string, { id: string; name: string; slug: string; logo_url: string | null }>()
  ;(staffOrgs as OrgJoin[] | null)?.forEach((s) => {
    if (s.organizations) activeOrgsMap.set(s.organization_id, s.organizations)
  })
  ;(memberOrgs as OrgJoin[] | null)?.forEach((m) => {
    if (m.organizations) activeOrgsMap.set(m.organization_id, m.organizations)
  })

  const userOrganizations = Array.from(activeOrgsMap.values())

  const isOwnerOrAdmin = ['owner', 'admin'].includes(userProfile.role)

  // Roles + branch scope: pueden ir en paralelo si hay role_id, y sólo necesitamos
  // role_branch_scope cuando NO es owner/admin.
  let roleData: { permissions: Record<string, boolean> | null } | null = null
  let allowedBranchIds: string[] | null = null

  if (userProfile.role_id) {
    const [roleRes, scopeRes] = await Promise.all([
      supabase
        .from('roles')
        .select('permissions')
        .eq('id', userProfile.role_id)
        .single(),
      isOwnerOrAdmin
        ? Promise.resolve({ data: null as { branch_id: string }[] | null })
        : supabase
            .from('role_branch_scope')
            .select('branch_id')
            .eq('role_id', userProfile.role_id),
    ])

    roleData = roleRes.data
    if (!isOwnerOrAdmin && scopeRes.data && scopeRes.data.length > 0) {
      allowedBranchIds = scopeRes.data.map((s) => s.branch_id)
    }
  }

  const { getEffectivePermissions } = await import('@/lib/permissions')
  const userPermissions = getEffectivePermissions(
    roleData?.permissions as Record<string, boolean> | undefined,
    isOwnerOrAdmin
  )

  if (!userPermissions['dashboard.access']) {
    redirect('/login')
  }

  // Banner de impersonation: el `name` ya viene del fetch principal de orgRow,
  // así que no hace falta una query extra.
  const activeOrgName = isImpersonating ? (orgRow?.name ?? null) : null

  // fullEntitlements ya vino del bloque paralelo de arriba. Si todavía no hay
  // suscripción (instalación vieja, pre-migración 108 de backfill), entitlements
  // será null y el sidebar trata todo como desbloqueado.
  const entitlements: EntitlementsSnapshot | null = fullEntitlements ? {
    orgId: fullEntitlements.orgId,
    planId: fullEntitlements.plan.id,
    planName: fullEntitlements.plan.name,
    status: fullEntitlements.status,
    trialEndsAt: fullEntitlements.trialEndsAt?.toISOString() ?? null,
    features: fullEntitlements.features,
    limits: fullEntitlements.limits,
    currentUsage: fullEntitlements.currentUsage,
    enabledModuleIds: fullEntitlements.enabledModuleIds,
    isAccessAllowed: fullEntitlements.isAccessAllowed,
    cancelAtPeriodEnd: fullEntitlements.cancelAtPeriodEnd,
    isGrandfathered: fullEntitlements.isGrandfathered,
  } : null

  const visibleModulesMeta = fullEntitlements?.visibleModules.map((m) => ({
    moduleId: m.id,
    name: m.name,
    teaser: m.teaser_copy,
    estimatedRelease: m.estimated_release,
    status: (m.status === 'hidden' ? 'coming_soon' : m.status) as 'active' | 'beta' | 'coming_soon',
  })) ?? []

  return (
    <>
      {isImpersonating && activeOrgName && (
        <ImpersonationBanner orgName={activeOrgName} />
      )}
      <DashboardShell
        user={{ full_name: userProfile.full_name, email: userProfile.email, role: userProfile.role }}
        permissions={userPermissions}
        allowedBranchIds={allowedBranchIds}
        organizationId={userProfile.organization_id}
        availableOrganizations={userOrganizations}
        orgLogoUrl={orgRow?.logo_url ?? null}
        entitlements={entitlements}
        visibleModulesMeta={visibleModulesMeta}
      >
        {children}
      </DashboardShell>
    </>
  )
}
