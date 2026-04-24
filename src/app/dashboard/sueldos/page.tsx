import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getScopedBranchIds } from '@/lib/actions/branch-access'
import { redirect } from 'next/navigation'
import { SueldosClient } from './sueldos-client'
import type { Metadata } from 'next'
import type { SalaryConfig } from '@/lib/types/database'

export const metadata: Metadata = {
  title: 'Sueldos | BarberOS',
}

export interface BarberWithConfig {
  id: string
  full_name: string
  commission_pct: number
  branch_id: string | null
  salary_configs: SalaryConfig[]
}

export default async function SueldosPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')

  const supabase = createAdminClient()
  const scopedBranchIds = await getScopedBranchIds()

  const [{ data: branches }, { data: barbersRaw }, { data: salaryConfigsRaw }, { data: paymentAccounts }] = await Promise.all([
    scopedBranchIds.length > 0
      ? supabase.from('branches').select('*').eq('organization_id', orgId).in('id', scopedBranchIds).eq('is_active', true).order('name')
      : Promise.resolve({ data: [] }),
    scopedBranchIds.length > 0
      ? supabase
          .from('staff')
          .select('id, full_name, commission_pct, branch_id')
          .eq('organization_id', orgId)
          .in('branch_id', scopedBranchIds)
          .or('role.eq.barber,is_also_barber.eq.true')
          .eq('is_active', true)
          .order('full_name')
      : Promise.resolve({ data: [] }),
    scopedBranchIds.length > 0
      ? supabase.from('salary_configs').select('*, staff!inner(organization_id, branch_id)').eq('staff.organization_id', orgId).in('staff.branch_id', scopedBranchIds)
      : Promise.resolve({ data: [] }),
    scopedBranchIds.length > 0
      ? supabase
          .from('payment_accounts')
          .select('id, name, branch_id, is_salary_account, alias_or_cbu')
          .in('branch_id', scopedBranchIds)
          .eq('is_active', true)
          .order('sort_order')
      : Promise.resolve({ data: [] }),
  ])

  const configsByStaffId = new Map((salaryConfigsRaw ?? []).map((c) => [c.staff_id, c]))
  const barbers: BarberWithConfig[] = (barbersRaw ?? []).map((b) => {
    const cfg = configsByStaffId.get(b.id)
    return { ...b, salary_configs: cfg ? [cfg] : [] }
  })

  // Filtrar cuentas a la org (solo las que pertenecen a branches de esta org)
  const branchIds = new Set((branches ?? []).map(b => b.id))
  const orgPaymentAccounts = (paymentAccounts ?? []).filter(a => branchIds.has(a.branch_id))

  return (
    <SueldosClient
      branches={branches ?? []}
      barbers={barbers}
      paymentAccounts={orgPaymentAccounts}
    />
  )
}
