import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { redirect } from 'next/navigation'
import { SucursalesClient } from './sucursales-client'

export default async function SucursalesPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')

  const supabase = createAdminClient()
  const { data: branches } = await supabase.from('branches').select('*').eq('organization_id', orgId).order('name')

  return (
    <SucursalesClient branches={branches ?? []} />
  )
}
