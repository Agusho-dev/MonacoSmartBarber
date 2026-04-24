import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getScopedBranchIds } from '@/lib/actions/branch-access'
import { redirect } from 'next/navigation'
import { getLocalDateStr } from '@/lib/time-utils'
import { fetchCajaTickets, fetchCajaSummary } from '@/lib/actions/caja'
import { CajaClient } from './caja-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Caja | BarberOS',
}

export default async function CajaPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')
  const branchIds = await getScopedBranchIds()

  const supabase = createAdminClient()
  const today = getLocalDateStr()

  const [
    { data: tickets },
    { data: summary },
    { data: branches },
    { data: barbers },
    { data: accounts },
  ] = await Promise.all([
    fetchCajaTickets({ branchId: null, date: today }),
    fetchCajaSummary({ branchId: null, date: today }),
    branchIds.length > 0
      ? supabase
          .from('branches')
          .select('id, name')
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
      initialDate={today}
      branches={branches ?? []}
      barbers={barbers ?? []}
      accounts={accounts ?? []}
    />
  )
}
