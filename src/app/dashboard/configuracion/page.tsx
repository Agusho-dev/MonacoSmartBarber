import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getScopedBranchIds } from '@/lib/actions/branch-access'
import { redirect } from 'next/navigation'
import { ConfiguracionClient } from './configuracion-client'

export default async function ConfiguracionPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')

  const supabase = createAdminClient()
  const scopedIds = await getScopedBranchIds()

  const [{ data: appSettings }, { data: branches }, { data: org }] = await Promise.all([
    supabase.from('app_settings').select('*').eq('organization_id', orgId).single(),
    scopedIds.length > 0
      ? supabase.from('branches').select('id, name, checkin_bg_color').eq('organization_id', orgId).in('id', scopedIds).order('name')
      : Promise.resolve({ data: [] }),
    supabase.from('organizations').select('id, name, logo_url').eq('id', orgId).single(),
  ])

  return (
    <ConfiguracionClient
      appSettings={appSettings}
      branches={branches ?? []}
      org={org ? { name: org.name, logo_url: org.logo_url } : null}
    />
  )
}
