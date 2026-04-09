import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId, getOrgBranchIds } from '@/lib/actions/org'
import { redirect } from 'next/navigation'
import { fetchFinancialData, getFixedExpenses } from '@/lib/actions/finances'
import { getCommissionSummary } from '@/lib/actions/salary'
import { FinanzasTabsClient } from './finanzas-tabs-client'
import type { Metadata } from 'next'
import type { BarberWithConfig } from '../sueldos/page'

export const metadata: Metadata = {
  title: 'Finanzas | Monaco Smart Barber',
}

export default async function FinanzasPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')
  const branchIds = await getOrgBranchIds()

  const supabase = await createClient()

  // Get user permissions
  const { data: { user: authUser } } = await supabase.auth.getUser()

  let isOwnerOrAdmin = false
  let roleData = null

  if (authUser) {
    const { data: currentStaff } = await supabase
      .from('staff')
      .select('role, role_id')
      .eq('auth_user_id', authUser.id)
      .eq('is_active', true)
      .single()

    isOwnerOrAdmin = ['owner', 'admin'].includes(currentStaff?.role || '')
    if (currentStaff?.role_id) {
      const { data: role } = await supabase
        .from('roles')
        .select('permissions')
        .eq('id', currentStaff.role_id)
        .single()
      roleData = role
    }
  }

  const { getEffectivePermissions } = await import('@/lib/permissions')
  const userPermissions = getEffectivePermissions(
    roleData?.permissions as Record<string, boolean> | undefined,
    isOwnerOrAdmin
  )

  const admin = createAdminClient()

  const [
    financialData,
    fixedExpenses,
    commissionSummary,
    { data: branches },
    { data: accounts },
    { data: barbersRaw },
    { data: salaryConfigsRaw },
    { data: expenseTickets },
  ] = await Promise.all([
    fetchFinancialData(1),
    getFixedExpenses(),
    getCommissionSummary(),
    supabase.from('branches').select('*').eq('organization_id', orgId).eq('is_active', true).order('name'),
    branchIds.length > 0
      ? supabase.from('payment_accounts').select('*, branch:branches(name)').in('branch_id', branchIds).order('name')
      : Promise.resolve({ data: [] }),
    admin
      .from('staff')
      .select('id, full_name, commission_pct, branch_id')
      .eq('organization_id', orgId)
      .eq('role', 'barber')
      .eq('is_active', true)
      .order('full_name'),
    admin.from('salary_configs').select('*, staff!inner(organization_id)').eq('staff.organization_id', orgId),
    branchIds.length > 0
      ? supabase.from('expense_tickets').select('*, created_by_staff:created_by(full_name), payment_account:payment_accounts(name, alias_or_cbu)').in('branch_id', branchIds).order('expense_date', { ascending: false }).limit(100)
      : Promise.resolve({ data: [] }),
  ])

  // Mergear salary_configs con barbers manualmente (evita problemas con el embedded select de PostgREST)
  const configsByStaffId = new Map((salaryConfigsRaw ?? []).map((c) => [c.staff_id, c]))
  const barbers: BarberWithConfig[] = (barbersRaw ?? []).map((b) => {
    const cfg = configsByStaffId.get(b.id)
    return { ...b, salary_configs: cfg ? [cfg] : [] }
  })

  return (
    <FinanzasTabsClient
      initialData={financialData}
      branches={branches ?? []}
      accounts={accounts ?? []}
      barbers={barbers}
      expenseTickets={expenseTickets ?? []}
      fixedExpenses={fixedExpenses}
      commissionSummary={commissionSummary}
      permissions={userPermissions}
    />
  )
}
