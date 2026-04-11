import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId, getOrgBranchIds } from '@/lib/actions/org'
import { redirect } from 'next/navigation'
import { FidelizacionClient } from './fidelizacion-client'

export default async function FidelizacionPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')
  const branchIds = await getOrgBranchIds()

  const supabase = createAdminClient()

  // Fetch branches for config filtering
  const { data: branches } = await supabase
    .from('branches')
    .select('id, name')
    .eq('organization_id', orgId)
    .order('name')

  // Fetch reward configs
  const { data: configs } = branchIds.length > 0
    ? await supabase.from('rewards_config').select('*').in('branch_id', branchIds)
    : { data: [] }

  // Fetch top points balances with clients
  const { data: topClients } = branchIds.length > 0
    ? await supabase
        .from('client_points')
        .select('points_balance, total_earned, total_redeemed, clients(name, phone, email), branches(name)')
        .in('branch_id', branchIds)
        .order('points_balance', { ascending: false })
        .limit(50)
    : { data: [] }

  return (
    <FidelizacionClient
      branches={branches || []}
      initialConfigs={configs || []}
      topClients={(topClients as any) || []}
    />
  )
}
