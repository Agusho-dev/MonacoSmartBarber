import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getScopedBranchIds } from '@/lib/actions/branch-access'
import { getAppointmentSettings } from '@/lib/actions/appointments'
import { buildAppUrl } from '@/lib/app-url'
import { createAdminClient } from '@/lib/supabase/server'
import { LinkPublicoClient } from './link-publico-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Link público de Turnos | Monaco Smart Barber',
}

export default async function LinkPublicoPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')

  const supabase = createAdminClient()
  const branchIds = await getScopedBranchIds()

  const [settings, baseUrl, { data: org }, { data: branches }] = await Promise.all([
    getAppointmentSettings(orgId),
    buildAppUrl(),
    supabase.from('organizations').select('name, slug').eq('id', orgId).single(),
    branchIds.length > 0
      ? supabase
          .from('branches')
          .select('id, name, address')
          .eq('organization_id', orgId)
          .in('id', branchIds)
          .eq('is_active', true)
          .order('name')
      : Promise.resolve({ data: [] }),
  ])

  return (
    <LinkPublicoClient
      isEnabled={!!settings?.is_enabled}
      baseUrl={baseUrl}
      orgSlug={org?.slug ?? ''}
      orgName={org?.name ?? ''}
      branches={branches ?? []}
    />
  )
}
