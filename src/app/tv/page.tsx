import { createAdminClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { TvClient } from './tv-client'

export const dynamic = 'force-dynamic'

export default async function TvPage() {
  const supabase = createAdminClient()
  const cookieStore = await cookies()
  const orgId = cookieStore.get('active_organization')?.value

  // Obtener branches filtradas por org
  let branchQuery = supabase.from('branches').select('id, name, organization_id').eq('is_active', true)
  if (orgId) {
    branchQuery = branchQuery.eq('organization_id', orgId)
  }
  const { data: branches } = await branchQuery

  const branchIds = (branches ?? []).map(b => b.id)

  // Fetch inicial filtrado por branches de la org
  const [entriesRes, barbersRes] = await Promise.all([
    branchIds.length > 0
      ? supabase
          .from('queue_entries')
          .select('*, client:clients(*), barber:staff(*)')
          .in('status', ['waiting', 'in_progress'])
          .in('branch_id', branchIds)
          .order('position')
      : Promise.resolve({ data: [] }),
    branchIds.length > 0
      ? supabase
          .from('staff')
          .select('id, full_name, branch_id, status, is_active, avatar_url')
          .eq('role', 'barber')
          .eq('is_active', true)
          .in('branch_id', branchIds)
          .order('full_name')
      : Promise.resolve({ data: [] }),
  ])

  return (
    <TvClient
      initialEntries={entriesRes.data || []}
      barbers={barbersRes.data || []}
      branches={(branches ?? []).map(b => ({ id: b.id, name: b.name }))}
      orgBranchIds={branchIds}
      orgId={orgId || null}
    />
  )
}
