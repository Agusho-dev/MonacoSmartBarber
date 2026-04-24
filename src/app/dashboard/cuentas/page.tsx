import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getScopedBranchIds } from '@/lib/actions/branch-access'
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
  const [{ data: accounts }, { data: branches }] = await Promise.all([
    branchIds.length > 0
      ? supabase.from('payment_accounts').select('*, branch:branches(name)').in('branch_id', branchIds).order('name')
      : Promise.resolve({ data: [] }),
    branchIds.length > 0
      ? supabase.from('branches').select('*').eq('organization_id', orgId).in('id', branchIds).eq('is_active', true).order('name')
      : Promise.resolve({ data: [] }),
  ])
  return <CuentasClient accounts={accounts ?? []} branches={branches ?? []} />
}
