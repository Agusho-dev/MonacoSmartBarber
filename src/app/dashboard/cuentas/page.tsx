import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId, getOrgBranchIds } from '@/lib/actions/org'
import { redirect } from 'next/navigation'
import { CuentasClient } from './cuentas-client'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Cuentas de cobro | BarberOS',
}

export default async function CuentasPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')
  const branchIds = await getOrgBranchIds()

  const supabase = createAdminClient()
  const [{ data: accounts }, { data: branches }] = await Promise.all([
    branchIds.length > 0
      ? supabase.from('payment_accounts').select('*, branch:branches(name)').in('branch_id', branchIds).order('name')
      : Promise.resolve({ data: [] }),
    supabase.from('branches').select('*').eq('organization_id', orgId).eq('is_active', true).order('name'),
  ])
  return <CuentasClient accounts={accounts ?? []} branches={branches ?? []} />
}
