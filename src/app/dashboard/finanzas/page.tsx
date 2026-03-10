import { createClient } from '@/lib/supabase/server'
import { fetchFinancialData, getFixedExpenses } from '@/lib/actions/finances'
import { FinanzasTabsClient } from './finanzas-tabs-client'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Finanzas | Monaco Smart Barber',
}

export default async function FinanzasPage() {
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

  const financialData = await fetchFinancialData(6)
  const expenses = await getFixedExpenses()

  const [{ data: branches }, { data: accounts }, { data: barbersRaw }, { data: payments }, { data: expenseTickets }] =
    await Promise.all([
      supabase.from('branches').select('*').eq('is_active', true).order('name'),
      supabase
        .from('payment_accounts')
        .select('*, branch:branches(name)')
        .order('name'),
      supabase
        .from('staff')
        .select('id, full_name, commission_pct, branch_id, salary_configs(*)')
        .eq('role', 'barber')
        .eq('is_active', true)
        .order('full_name'),
      supabase
        .from('salary_payments')
        .select('*, staff:staff(id, full_name, branch_id)')
        .order('period_start', { ascending: false })
        .limit(100),
      supabase
        .from('expense_tickets')
        .select('*, created_by_staff:created_by(full_name)')
        .order('expense_date', { ascending: false })
        .limit(100),
    ])

  return (
    <FinanzasTabsClient
      initialData={financialData}
      initialExpenses={expenses}
      branches={branches ?? []}
      accounts={accounts ?? []}
      barbers={barbersRaw ?? []}
      payments={payments ?? []}
      expenseTickets={expenseTickets ?? []}
      permissions={userPermissions}
    />
  )
}
