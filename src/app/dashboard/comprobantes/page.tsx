import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getScopedBranchIds } from '@/lib/actions/branch-access'
import { getEffectivePermissions } from '@/lib/permissions'
import { getReconciliation, getReceiptSettingsForOrg } from '@/lib/actions/receipts'
import { ComprobantesClient } from './comprobantes-client'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Comprobantes | BarberOS' }

export default async function ComprobantesPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')

  // Guard: comprobantes.view (owner/admin siempre).
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  let isOwnerOrAdmin = false
  let rolePerms: Record<string, boolean> | null = null
  if (user) {
    const { data: staff } = await authClient
      .from('staff').select('role, role_id')
      .eq('auth_user_id', user.id).eq('is_active', true).single()
    isOwnerOrAdmin = ['owner', 'admin'].includes(staff?.role || '')
    if (staff?.role_id) {
      const { data: role } = await authClient.from('roles').select('permissions').eq('id', staff.role_id).single()
      rolePerms = (role?.permissions as Record<string, boolean> | null) ?? null
    }
  }
  const perms = getEffectivePermissions(rolePerms ?? undefined, isOwnerOrAdmin)
  if (!perms['comprobantes.view']) redirect('/dashboard')

  const branchIds = await getScopedBranchIds()
  const supabase = createAdminClient()

  const now = new Date()
  const to = now.toISOString()
  const from = new Date(now.getTime() - 7 * 86400000).toISOString()

  const [settings, recon, branchesRes, accountsRes] = await Promise.all([
    getReceiptSettingsForOrg(),
    getReconciliation({ from, to }),
    branchIds.length
      ? supabase.from('branches').select('id, name').eq('organization_id', orgId).in('id', branchIds).eq('is_active', true).order('name')
      : Promise.resolve({ data: [] }),
    branchIds.length
      ? supabase.from('payment_accounts').select('id, name, branch_id').in('branch_id', branchIds).eq('is_active', true).order('sort_order')
      : Promise.resolve({ data: [] }),
  ])

  return (
    <ComprobantesClient
      initialRecon={recon}
      initialRange={{ from, to }}
      settings={settings}
      branches={(branchesRes.data as { id: string; name: string }[]) ?? []}
      accounts={(accountsRes.data as { id: string; name: string; branch_id: string }[]) ?? []}
      canManage={perms['comprobantes.manage'] === true}
    />
  )
}
