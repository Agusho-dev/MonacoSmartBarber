import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { getAppointmentSettings } from '@/lib/actions/appointments'
import { TurnosClient } from './turnos-client'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = createAdminClient()
  const { data: org } = await supabase
    .from('organizations')
    .select('name')
    .eq('slug', slug.toLowerCase())
    .eq('is_active', true)
    .maybeSingle()

  return { title: org ? `Turnos | ${org.name}` : 'Turnos' }
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}

export default async function TurnosPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ branch?: string }>
}) {
  const { slug } = await params
  const { branch: branchParam } = await searchParams
  const supabase = createAdminClient()

  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug, logo_url')
    .eq('slug', slug.toLowerCase())
    .eq('is_active', true)
    .maybeSingle()

  if (!org) notFound()

  const settings = await getAppointmentSettings(org.id)
  if (!settings?.is_enabled) {
    return (
      <div
        className="flex min-h-screen items-center justify-center p-4"
        style={{ backgroundColor: settings?.brand_bg_color ?? '#f3f4f6' }}
      >
        <div className="max-w-md rounded-lg bg-white p-8 text-center shadow-lg">
          <h1 className="mb-2 text-xl font-semibold">{org.name}</h1>
          <p className="text-muted-foreground">El sistema de turnos no está habilitado actualmente.</p>
        </div>
      </div>
    )
  }

  const { data: branches } = await supabase
    .from('branches')
    .select('id, name, address')
    .eq('organization_id', org.id)
    .eq('is_active', true)
    .order('name')

  const branchIds = (branches ?? []).map(b => b.id)

  interface ServiceRow {
    id: string
    name: string
    price: number
    duration_minutes: number | null
    branch_id: string | null
    booking_mode: string
  }

  const services: ServiceRow[] = branchIds.length
    ? ((await supabase
        .from('services')
        .select('id, name, price, duration_minutes, branch_id, booking_mode')
        .eq('is_active', true)
        .in('booking_mode', ['self_service', 'both'])
        .or(`branch_id.is.null,branch_id.in.(${branchIds.join(',')})`)).data ?? []) as ServiceRow[]
    : []

  const initialBranchId =
    branchParam && isUuid(branchParam) && branchIds.includes(branchParam) ? branchParam : null

  return (
    <TurnosClient
      org={org}
      branches={branches ?? []}
      services={services}
      settings={settings}
      initialBranchId={initialBranchId}
    />
  )
}
