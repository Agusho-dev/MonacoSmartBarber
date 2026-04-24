import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getScopedBranchIds } from '@/lib/actions/branch-access'
import { redirect } from 'next/navigation'
import { SucursalesClient } from './sucursales-client'

export default async function SucursalesPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')

  const supabase = createAdminClient()
  const branchIds = await getScopedBranchIds()
  const { data: branches } = branchIds.length > 0
    ? await supabase.from('branches').select('*').eq('organization_id', orgId).in('id', branchIds).order('name')
    : { data: [] }

  return (
    <SucursalesClient branches={branches ?? []} />
  )
}
