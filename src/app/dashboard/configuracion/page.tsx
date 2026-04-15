import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { redirect } from 'next/navigation'
import { ConfiguracionClient } from './configuracion-client'

export default async function ConfiguracionPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')

  const supabase = createAdminClient()

  const [{ data: appSettings }, { data: branches }, { data: org }] = await Promise.all([
    supabase.from('app_settings').select('*').eq('organization_id', orgId).single(),
    supabase.from('branches').select('id, name, checkin_bg_color').eq('organization_id', orgId).order('name'),
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
