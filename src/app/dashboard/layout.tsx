import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { DashboardShell } from '@/components/dashboard/dashboard-shell'
import { ImpersonationBanner } from '@/components/dashboard/impersonation-banner'
import { hasPermission } from '@/lib/permissions'
import { getCurrentOrgId } from '@/lib/actions/org'

export const dynamic = 'force-dynamic'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  const {
    data: { user: authUser },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !authUser) {
    redirect('/login')
  }

  const orgId = await getCurrentOrgId()
  if (!orgId) {
    redirect('/login')
  }

  const adminClient = createAdminClient()

  // Guard: si la org aún no completó onboarding, forzar al wizard
  const { data: orgRow } = await adminClient
    .from('organizations')
    .select('settings, subscription_status')
    .eq('id', orgId)
    .maybeSingle()

  if (orgRow?.subscription_status === 'suspended' || orgRow?.subscription_status === 'cancelled') {
    redirect('/login?reason=inactive')
  }

  const onboardingCompleted = (orgRow?.settings as { onboarding_completed?: boolean } | null)?.onboarding_completed === true
  if (!onboardingCompleted) {
    redirect('/onboarding')
  }

  // Find staff profile for CURRENT org
  const { data: staff, error: staffError } = await supabase
    .from('staff')
    .select('full_name, email, role, role_id, organization_id')
    .eq('auth_user_id', authUser.id)
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .maybeSingle()

  // If not staff, maybe a global owner member?
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
        organization_id: orgId
      }
    }
  }

  if (!userProfile) {
    console.error('No profile found for this org:', { authUserId: authUser.id, orgId })
    redirect('/login')
  }

  // Obtain all organizations the user has access to
  const [{ data: staffOrgs }, { data: memberOrgs }, { data: currentOrg }] = await Promise.all([
    adminClient.from('staff').select('organization_id, organizations(id, name, slug, logo_url)').eq('auth_user_id', authUser.id).eq('is_active', true),
    adminClient.from('organization_members').select('organization_id, organizations(id, name, slug, logo_url)').eq('user_id', authUser.id),
    adminClient.from('organizations').select('logo_url').eq('id', orgId).single(),
  ])

  const activeOrgsMap = new Map<string, { id: string; name: string; slug: string; logo_url: string | null }>()
  staffOrgs?.forEach((s: any) => {
    if (s.organizations) activeOrgsMap.set(s.organization_id, s.organizations)
  })
  memberOrgs?.forEach((m: any) => {
    if (m.organizations) activeOrgsMap.set(m.organization_id, m.organizations)
  })
  
  const userOrganizations = Array.from(activeOrgsMap.values())

  const isOwnerOrAdmin = ['owner', 'admin'].includes(userProfile.role)
  let userPermissions: Record<string, boolean> = {}

  if (isOwnerOrAdmin) {
    userPermissions = { 'dashboard.access': true } 
  }

  let roleData = null
  let allowedBranchIds: string[] | null = null
  
  if (userProfile.role_id) {
    const { data: role } = await supabase
      .from('roles')
      .select('permissions')
      .eq('id', userProfile.role_id)
      .single()
    roleData = role

    if (!isOwnerOrAdmin) {
      const { data: scopeRows } = await supabase
        .from('role_branch_scope')
        .select('branch_id')
        .eq('role_id', userProfile.role_id)

      if (scopeRows && scopeRows.length > 0) {
        allowedBranchIds = scopeRows.map((s) => s.branch_id)
      }
    }
  }

  const { getEffectivePermissions } = await import('@/lib/permissions')
  userPermissions = getEffectivePermissions(
    roleData?.permissions as Record<string, boolean> | undefined,
    isOwnerOrAdmin
  )

  if (!userPermissions['dashboard.access']) {
    redirect('/login')
  }

  // Banner de impersonation si el user es platform admin impersonando
  const cookieStore = await cookies()
  const isImpersonating = cookieStore.get('platform_impersonation')?.value === '1'
  const { data: activeOrgRow } = isImpersonating
    ? await adminClient.from('organizations').select('name').eq('id', orgId).maybeSingle()
    : { data: null as { name: string } | null }

  return (
    <>
      {isImpersonating && activeOrgRow?.name && (
        <ImpersonationBanner orgName={activeOrgRow.name} />
      )}
      <DashboardShell
        user={{ full_name: userProfile.full_name, email: userProfile.email, role: userProfile.role }}
        permissions={userPermissions}
        allowedBranchIds={allowedBranchIds}
        organizationId={userProfile.organization_id}
        availableOrganizations={userOrganizations}
        orgLogoUrl={currentOrg?.logo_url ?? null}
      >
        {children}
      </DashboardShell>
    </>
  )
}
