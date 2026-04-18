import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getAppointmentSettings } from '@/lib/actions/appointments'
import { createAdminClient } from '@/lib/supabase/server'
import { PersonalizacionClient } from './personalizacion-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Personalización de Turnos | Monaco Smart Barber',
}

export default async function PersonalizacionPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')

  const supabase = createAdminClient()

  const [settings, { data: org }] = await Promise.all([
    getAppointmentSettings(orgId),
    supabase.from('organizations').select('name, slug, logo_url').eq('id', orgId).single(),
  ])

  return <PersonalizacionClient settings={settings} org={org ?? { name: '', slug: '', logo_url: null }} />
}
