import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { DashboardShell } from '@/components/dashboard/dashboard-shell'
import { ImpersonationBanner } from '@/components/dashboard/impersonation-banner'
import { DbDownError } from '@/components/dashboard/db-down-error'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getEntitlements } from '@/lib/actions/entitlements'
import type { EntitlementsSnapshot } from '@/components/billing/entitlements-provider'

export const dynamic = 'force-dynamic'

/**
 * Determina si un error capturado es un problema de conectividad/timeout y NO
 * un error de autenticación legítimo. Cuando esto devuelve true, el layout
 * debe mostrar DbDownError en lugar de redirigir al login.
 *
 * Señales de error de red:
 *  - AbortError: el fetchWithTimeout en server.ts canceló la request por timeout
 *  - TypeError con mensajes de fetch/network/ECONNREFUSED
 */
function esErrorDeRed(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  if (err.name === 'AbortError') return true
  const msg = err.message.toLowerCase()
  return (
    msg.includes('fetch') ||
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('aborted')
  )
}

/**
 * Determina si un error de Supabase (objeto con .code / .message) es un
 * error de red en lugar de un error de auth o de datos.
 */
function esErrorDeRedSupabase(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false
  const msg = (error.message ?? '').toLowerCase()
  return (
    msg.includes('fetch') ||
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('aborted') ||
    error.code === 'PGRST301' // PostgREST: upstream timeout
  )
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  let supabase: Awaited<ReturnType<typeof createClient>>
  try {
    supabase = await createClient()
  } catch (err) {
    console.error('[dashboard/layout] Error al crear cliente Supabase:', err)
    return <DbDownError context="createClient()" />
  }

  const cookieStore = await cookies()

  // Auth + orgId resolveado en paralelo. getCurrentOrgId() está cacheado y
  // reusará el mismo auth.getUser() que ejecutamos acá (vía getCachedAuthUser).
  let authResult: Awaited<ReturnType<typeof supabase.auth.getUser>>
  let orgId: string | null

  try {
    ;[authResult, orgId] = await Promise.all([
      supabase.auth.getUser(),
      getCurrentOrgId(),
    ])
  } catch (err) {
    // Promise.all lanza si cualquiera de las dos falla. Si es timeout/red,
    // mostramos la pantalla de error. Si no reconocemos el error, también es
    // más seguro mostrar DbDownError que patear al login.
    console.error('[dashboard/layout] Error en auth/orgId paralelo:', err)
    if (esErrorDeRed(err)) {
      return <DbDownError context="auth.getUser() / getCurrentOrgId()" />
    }
    // Error desconocido — redirigir al login como comportamiento conservador
    redirect('/login')
  }

  const { data: { user: authUser }, error: authError } = authResult

  // Error de red en la respuesta de Supabase (no en el throw, sino en el objeto)
  if (authError && esErrorDeRedSupabase(authError)) {
    console.error('[dashboard/layout] Error de red en auth.getUser():', authError)
    return <DbDownError context="auth.getUser()" />
  }

  // Auth genuinamente inválida → login
  if (authError || !authUser) {
    redirect('/login')
  }

  // orgId null genuino (usuario no asociado a ninguna org) → login
  if (!orgId) {
    redirect('/login')
  }

  const adminClient = createAdminClient()
  const isImpersonating = cookieStore.get('platform_impersonation')?.value === '1'

  // Bloque paralelo principal: todas las queries que dependen sólo de (orgId, authUser.id)
  // se disparan al mismo tiempo. Antes eran ~6 roundtrips secuenciales.
  let orgRow: { settings: unknown; subscription_status: string | null; logo_url: string | null; name: string | null } | null
  let staff: { full_name: string; email: string | null; role: string; role_id: string | null; organization_id: string } | null
  let staffOrgs: unknown[] | null
  let memberOrgs: unknown[] | null
  let fullEntitlements: Awaited<ReturnType<typeof getEntitlements>>

  try {
    const [orgRes, staffRes, staffOrgsRes, memberOrgsRes, entRes] = await Promise.all([
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

    // Detectar error de red dentro de los resultados de Supabase
    if (esErrorDeRedSupabase(orgRes.error) || esErrorDeRedSupabase(staffRes.error)) {
      console.error('[dashboard/layout] Error de red en bloque paralelo principal:', {
        orgError: orgRes.error,
        staffError: staffRes.error,
      })
      return <DbDownError context="organizations / staff queries" />
    }

    orgRow = orgRes.data
    // Normalizar email de undefined → null para consistencia con el tipo local
    staff = staffRes.data
      ? { ...staffRes.data, email: staffRes.data.email ?? null }
      : null
    staffOrgs = staffOrgsRes.data
    memberOrgs = memberOrgsRes.data
    fullEntitlements = entRes
  } catch (err) {
    console.error('[dashboard/layout] Error en bloque paralelo principal:', err)
    if (esErrorDeRed(err)) {
      return <DbDownError context="organizations / staff / entitlements" />
    }
    redirect('/login')
  }

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
    let memberData: { role: string } | null = null
    try {
      const { data: member, error: memberError } = await adminClient
        .from('organization_members')
        .select('role')
        .eq('user_id', authUser.id)
        .eq('organization_id', orgId)
        .maybeSingle()

      if (esErrorDeRedSupabase(memberError)) {
        console.error('[dashboard/layout] Error de red en fallback organization_members:', memberError)
        return <DbDownError context="organization_members fallback" />
      }

      memberData = member
    } catch (err) {
      console.error('[dashboard/layout] Error en fallback organization_members:', err)
      if (esErrorDeRed(err)) {
        return <DbDownError context="organization_members fallback" />
      }
      redirect('/login')
    }

    if (memberData) {
      userProfile = {
        full_name: authUser.user_metadata?.full_name || authUser.email || 'Admin',
        email: authUser.email ?? null,
        role: memberData.role,
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
    try {
      const [roleRes, scopeRes] = await Promise.all([
        supabase
          .from('roles')
          .select('permissions')
          .eq('id', userProfile.role_id)
          .single(),
        isOwnerOrAdmin
          ? Promise.resolve({ data: null as { branch_id: string }[] | null, error: null })
          : supabase
              .from('role_branch_scope')
              .select('branch_id')
              .eq('role_id', userProfile.role_id),
      ])

      if (esErrorDeRedSupabase(roleRes.error)) {
        console.error('[dashboard/layout] Error de red en roles:', roleRes.error)
        return <DbDownError context="roles / role_branch_scope" />
      }

      roleData = roleRes.data
      if (!isOwnerOrAdmin && scopeRes.data && scopeRes.data.length > 0) {
        allowedBranchIds = scopeRes.data.map((s) => s.branch_id)
      }
    } catch (err) {
      console.error('[dashboard/layout] Error en roles/branch scope:', err)
      if (esErrorDeRed(err)) {
        return <DbDownError context="roles / role_branch_scope" />
      }
      redirect('/login')
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
