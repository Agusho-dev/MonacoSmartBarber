import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getScopedBranchIds } from '@/lib/actions/branch-access'
import { getPaymentAccountsMonthIncome } from '@/lib/actions/paymentAccounts'
import { redirect } from 'next/navigation'
import { CuentasClient } from './cuentas-client'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Cuentas de cobro | BarberOS',
}

export default async function CuentasPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')
  const branchIds = await getScopedBranchIds()

  const supabase = createAdminClient()
  const [{ data: accounts }, { data: branches }, monthIncome] = await Promise.all([
    branchIds.length > 0
      ? supabase.from('payment_accounts').select('*, branch:branches(name)').in('branch_id', branchIds).order('sort_order').order('name')
      : Promise.resolve({ data: [] }),
    branchIds.length > 0
      ? supabase.from('branches').select('*').eq('organization_id', orgId).in('id', branchIds).eq('is_active', true).order('name')
      : Promise.resolve({ data: [] }),
    // Acumulado real del mes por cuenta (transfer_logs: cobros + propinas). El contador
    // que vivía en payment_accounts nunca se escribió — ver mig 160.
    getPaymentAccountsMonthIncome(),
  ])
  return <CuentasClient accounts={accounts ?? []} branches={branches ?? []} monthIncome={monthIncome} />
}
