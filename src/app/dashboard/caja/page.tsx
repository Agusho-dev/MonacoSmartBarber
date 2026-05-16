import type { Metadata } from 'next'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getScopedBranchIds } from '@/lib/actions/branch-access'
import { getEffectivePermissions } from '@/lib/permissions'
import { redirect } from 'next/navigation'
import { getLocalDateStr } from '@/lib/time-utils'
import { fetchCajaTickets, fetchCajaSummary } from '@/lib/actions/caja'
import { fetchShiftClosesForCaja } from '@/lib/actions/shift'
import { CajaClient } from './caja-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Caja | BarberOS',
}

export default async function CajaPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')

  // Guard de permiso: requiere caja.view (owner/admin lo tienen siempre).
  const authClient = await createClient()
  const { data: { user: authUser } } = await authClient.auth.getUser()
  let isOwnerOrAdmin = false
  let rolePerms: Record<string, boolean> | null = null
  if (authUser) {
    const { data: currentStaff } = await authClient
      .from('staff')
      .select('role, role_id')
      .eq('auth_user_id', authUser.id)
      .eq('is_active', true)
      .single()
    isOwnerOrAdmin = ['owner', 'admin'].includes(currentStaff?.role || '')
    if (currentStaff?.role_id) {
      const { data: role } = await authClient
        .from('roles')
        .select('permissions')
        .eq('id', currentStaff.role_id)
        .single()
      rolePerms = (role?.permissions as Record<string, boolean> | null) ?? null
    }
  }
  const userPermissions = getEffectivePermissions(rolePerms ?? undefined, isOwnerOrAdmin)
  if (!userPermissions['caja.view']) redirect('/dashboard')

  const branchIds = await getScopedBranchIds()

  const supabase = createAdminClient()
  const today = getLocalDateStr()

  const [
    { data: tickets },
    { data: summary },
    { data: shiftCloses },
    { data: branches },
    { data: barbers },
    { data: accounts },
  ] = await Promise.all([
    fetchCajaTickets({ branchId: null, date: today }),
    fetchCajaSummary({ branchId: null, date: today }),
    fetchShiftClosesForCaja({ branchId: null, date: today }),
    branchIds.length > 0
      ? supabase
          .from('branches')
          .select('id, name, default_opening_cash')
          .eq('organization_id', orgId)
          .in('id', branchIds)
          .eq('is_active', true)
          .order('name')
      : Promise.resolve({ data: [] }),
    branchIds.length > 0
      ? supabase
          .from('staff')
          .select('id, full_name, branch_id')
          .eq('organization_id', orgId)
          .in('branch_id', branchIds)
          .or('role.eq.barber,is_also_barber.eq.true')
          .eq('is_active', true)
          .order('full_name')
      : Promise.resolve({ data: [] }),
    branchIds.length > 0
      ? supabase
          .from('payment_accounts')
          .select('id, name, branch_id, is_salary_account')
          .in('branch_id', branchIds)
          .eq('is_active', true)
          .order('sort_order')
      : Promise.resolve({ data: [] }),
  ])

  return (
    <CajaClient
      initialTickets={tickets}
      initialSummary={summary}
      initialShiftCloses={shiftCloses}
      initialDate={today}
      branches={branches ?? []}
      barbers={barbers ?? []}
      accounts={accounts ?? []}
      canExport={userPermissions['caja.export'] === true}
    />
  )
}
