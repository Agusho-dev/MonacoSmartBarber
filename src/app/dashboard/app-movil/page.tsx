import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getScopedBranchIds } from '@/lib/actions/branch-access'
import { redirect } from 'next/navigation'
import { AppMovilClient } from './app-movil-client'

export default async function AppMovilPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')
  const branchIds = await getScopedBranchIds()

  const supabase = createAdminClient()

  const [
    { data: branches },
    { data: configs },
    { data: catalog },
    { data: billboard },
  ] = await Promise.all([
    branchIds.length > 0
      ? supabase.from('branches').select('id, name').eq('organization_id', orgId).in('id', branchIds).eq('is_active', true).order('name')
      : Promise.resolve({ data: [] }),
    branchIds.length > 0
      ? supabase.from('rewards_config').select('*').in('branch_id', branchIds)
      : Promise.resolve({ data: [] }),
    supabase.from('reward_catalog').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }),
    branchIds.length > 0
      ? supabase.from('billboard_items').select('*, branch:branches(name)').in('branch_id', branchIds).order('sort_order')
      : Promise.resolve({ data: [] }),
  ])

  return (
    <AppMovilClient
      branches={branches || []}
      initialConfigs={configs || []}
      initialCatalog={catalog || []}
      initialBillboard={(billboard as Parameters<typeof AppMovilClient>[0]['initialBillboard']) || []}
    />
  )
}
