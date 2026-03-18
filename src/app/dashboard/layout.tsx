import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { DashboardShell } from '@/components/dashboard/dashboard-shell'
import { hasPermission } from '@/lib/permissions'

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

  const { data: staff, error: staffError } = await supabase
    .from('staff')
    .select('full_name, email, role, role_id')
    .eq('auth_user_id', authUser.id)
    .eq('is_active', true)
    .single()

  if (staffError || !staff) {
    console.error('Staff lookup failed:', { staffError, authUserId: authUser.id })
    redirect('/login')
  }

  // Check dashboard access: owner/admin always have access,
  // or staff with a custom role that has dashboard.access permission
  const isOwnerOrAdmin = ['owner', 'admin'].includes(staff.role)
  let userPermissions: Record<string, boolean> = {}

  if (isOwnerOrAdmin) {
    userPermissions = { 'dashboard.access': true } // We will expand this via helper if needed, but let's just use getEffectivePermissions
  }

  let roleData = null
  let allowedBranchIds: string[] | null = null
  if (staff.role_id) {
    const { data: role } = await supabase
      .from('roles')
      .select('permissions')
      .eq('id', staff.role_id)
      .single()
    roleData = role

    // Fetch branch scope for this role
    if (!isOwnerOrAdmin) {
      const { data: scopeRows } = await supabase
        .from('role_branch_scope')
        .select('branch_id')
        .eq('role_id', staff.role_id)

      if (scopeRows && scopeRows.length > 0) {
        allowedBranchIds = scopeRows.map((s) => s.branch_id)
      }
    }
  }

  // Get effective permissions
  const { getEffectivePermissions } = await import('@/lib/permissions')
  userPermissions = getEffectivePermissions(
    roleData?.permissions as Record<string, boolean> | undefined,
    isOwnerOrAdmin
  )

  if (!userPermissions['dashboard.access']) {
    redirect('/login')
  }


  return (
    <DashboardShell
      user={{ full_name: staff.full_name, email: staff.email, role: staff.role }}
      permissions={userPermissions}
      allowedBranchIds={allowedBranchIds}
    >
      {children}
    </DashboardShell>
  )
}
