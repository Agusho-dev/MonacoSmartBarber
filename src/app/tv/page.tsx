import { createAdminClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { TvClient } from './tv-client'

export const dynamic = 'force-dynamic'

export default async function TvPage({
  searchParams,
}: {
  searchParams: Promise<{ slug?: string }>
}) {
  const supabase = createAdminClient()
  const cookieStore = await cookies()
  // TV es ruta pública — prioriza public_organization (kiosk/TV) sobre active_organization (dashboard)
  const orgId = cookieStore.get('public_organization')?.value
    ?? cookieStore.get('active_organization')?.value

  // Si no hay cookie de organización, redirigir según haya o no slug en la URL.
  // El route handler /api/tv/setup setea la cookie y vuelve acá.
  if (!orgId) {
    const { slug } = await searchParams
    if (slug) {
      redirect(`/api/tv/setup?slug=${encodeURIComponent(slug)}`)
    }
    redirect('/')
  }

  // Obtener branches filtradas por org
  const { data: branches } = await supabase
    .from('branches')
    .select('id, name, organization_id')
    .eq('is_active', true)
    .eq('organization_id', orgId)

  const branchIds = (branches ?? []).map(b => b.id)

  // Obtener organización activa (para logo y nombre en el header del TV)
  let orgInfo: { name: string; logo_url: string | null } | null = null
  const { data: orgData } = await supabase
    .from('organizations')
    .select('name, logo_url')
    .eq('id', orgId)
    .eq('is_active', true)
    .maybeSingle()
  if (orgData) orgInfo = orgData as { name: string; logo_url: string | null }

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
          .or('role.eq.barber,is_also_barber.eq.true')
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
      orgId={orgId}
      orgName={orgInfo?.name ?? 'BarberOS'}
      orgLogoUrl={orgInfo?.logo_url ?? '/logo-barberos.png'}
    />
  )
}
