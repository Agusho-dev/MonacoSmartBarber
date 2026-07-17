import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getScopedBranchIds } from '@/lib/actions/branch-access'
import { redirect } from 'next/navigation'
import { fetchFinancialData } from '@/lib/actions/finances'
import { getCommissionSummary } from '@/lib/actions/salary'
import { getOrgTipsSummary, getTipsMonthlyTrend, getTipsCoverageRange } from '@/lib/actions/tips'
import {
  getFixedExpensesCatalog,
  getFixedExpensePeriods,
  getFixedExpensePeriodsSummary,
} from '@/lib/actions/fixed-expenses'
import { getPaymentAccountsMonthIncome } from '@/lib/actions/paymentAccounts'
import { getLocalDateStr, getLocalNow } from '@/lib/time-utils'
import { getActiveTimezone } from '@/lib/i18n'
import { FinanzasTabsClient } from './finanzas-tabs-client'
import type { Metadata } from 'next'
import type { StaffWithConfig } from '../sueldos/page'

export const metadata: Metadata = {
  title: 'Finanzas | BarberOS',
}

export default async function FinanzasPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')
  const branchIds = await getScopedBranchIds()

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

  // Resolver mes actual local y "hoy" en la TZ de la org
  const tz = await getActiveTimezone()
  const localNow = getLocalNow(tz)
  const currentYear = localNow.getUTCFullYear()
  const currentMonth = localNow.getUTCMonth() + 1
  const todayLocal = getLocalDateStr(tz)

  const [
    financialData,
    fixedExpensesCatalog,
    fixedExpensePeriods,
    fixedExpenseSummary,
    commissionSummary,
    tipsSummary,
    tipsTrend,
    tipsRange,
    { data: branches },
    { data: accounts },
    { data: staffRaw },
    { data: salaryConfigsRaw },
    { data: expenseTickets },
    { data: orgRow },
    accountsMonthIncome,
  ] = await Promise.all([
    fetchFinancialData(1),
    getFixedExpensesCatalog(),
    getFixedExpensePeriods({ year: currentYear, month: currentMonth, status: 'all' }),
    getFixedExpensePeriodsSummary(currentYear, currentMonth),
    getCommissionSummary(),
    getOrgTipsSummary(),
    getTipsMonthlyTrend(),
    getTipsCoverageRange(),
    branchIds.length > 0
      ? supabase.from('branches').select('*').eq('organization_id', orgId).in('id', branchIds).eq('is_active', true).order('name')
      : Promise.resolve({ data: [] }),
    branchIds.length > 0
      ? supabase.from('payment_accounts').select('*, branch:branches(name)').in('branch_id', branchIds).order('name')
      : Promise.resolve({ data: [] }),
    // Sueldos aplica a todo el personal activo (barberos, encargados, recepción, etc.),
    // no sólo a quienes toman cortes. Antes filtrábamos por role=barber y eso dejaba
    // afuera a recepción/encargados que también cobran.
    branchIds.length > 0
      ? admin
          .from('staff')
          .select('id, full_name, commission_pct, branch_id')
          .eq('organization_id', orgId)
          .in('branch_id', branchIds)
          .eq('is_active', true)
          .order('full_name')
      : Promise.resolve({ data: [] }),
    admin.from('salary_configs').select('*, staff!inner(organization_id, branch_id)').eq('staff.organization_id', orgId),
    branchIds.length > 0
      // admin (service role): la RLS de expense_tickets sólo deja ver filas a usuarios
      // presentes en `staff` del branch. Un dueño/encargado resuelto vía organization_members
      // veía la tabla vacía. El scope real ya lo da `.in('branch_id', branchIds)` (branches visibles).
      ? admin.from('expense_tickets').select('*, created_by_staff:created_by(full_name), payment_account:payment_accounts(name, alias_or_cbu)').in('branch_id', branchIds).order('expense_date', { ascending: false }).limit(100)
      : Promise.resolve({ data: [] }),
    admin.from('organizations').select('slug, name').eq('id', orgId).maybeSingle(),
    // Acumulado real del mes por cuenta de cobro (transfer_logs: cobros + propinas).
    getPaymentAccountsMonthIncome(),
  ])

  // Mergear salary_configs con staff manualmente (evita problemas con el embedded select de PostgREST)
  const configsByStaffId = new Map((salaryConfigsRaw ?? []).map((c) => [c.staff_id, c]))
  const staffMembers: StaffWithConfig[] = (staffRaw ?? []).map((s) => {
    const cfg = configsByStaffId.get(s.id)
    return { ...s, salary_configs: cfg ? [cfg] : [] }
  })

  // Cuentas simplificadas para SueldosClient (incluye is_salary_account)
  const paymentAccountsForSalary = (accounts ?? [])
    .filter(a => a.is_active)
    .map(a => ({
      id: a.id,
      name: a.name,
      branch_id: a.branch_id,
      is_salary_account: a.is_salary_account ?? false,
      alias_or_cbu: a.alias_or_cbu ?? null,
    }))

  // Cuentas simplificadas para el hub de gastos fijos (permite pagar desde cualquier cuenta activa)
  const fixedExpensesAccounts = (accounts ?? [])
    .filter(a => a.is_active)
    .map(a => ({ id: a.id, name: a.name, branch_id: a.branch_id }))

  return (
    <FinanzasTabsClient
      initialData={financialData}
      branches={branches ?? []}
      accounts={accounts ?? []}
      accountsMonthIncome={accountsMonthIncome}
      staffMembers={staffMembers}
      paymentAccounts={paymentAccountsForSalary}
      expenseTickets={expenseTickets ?? []}
      fixedExpenses={fixedExpensesCatalog}
      fixedExpensePeriods={fixedExpensePeriods}
      fixedExpenseSummary={fixedExpenseSummary}
      fixedExpenseAccounts={fixedExpensesAccounts}
      fixedExpenseYear={currentYear}
      fixedExpenseMonth={currentMonth}
      todayLocal={todayLocal}
      commissionSummary={commissionSummary}
      permissions={userPermissions}
      orgSlug={orgRow?.slug ?? 'barberos'}
      tipsSummary={tipsSummary}
      tipsTrend={tipsTrend}
      tipsRange={tipsRange}
      orgName={orgRow?.name ?? 'BarberOS'}
    />
  )
}
