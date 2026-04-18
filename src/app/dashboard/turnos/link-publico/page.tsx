import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCurrentOrgId } from '@/lib/actions/org'
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

  const [settings, baseUrl, { data: org }, { data: branches }] = await Promise.all([
    getAppointmentSettings(orgId),
    buildAppUrl(),
    supabase.from('organizations').select('name, slug').eq('id', orgId).single(),
    supabase
      .from('branches')
      .select('id, name, address')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .order('name'),
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
