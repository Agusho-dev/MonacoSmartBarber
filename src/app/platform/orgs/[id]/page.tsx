import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePlatformAdmin } from '@/lib/actions/platform'
import { createAdminClient } from '@/lib/supabase/server'
import { OrgPlatformDetailClient } from './detail-client'

export const dynamic = 'force-dynamic'

export default async function PlatformOrgDetail({ params }: { params: Promise<{ id: string }> }) {
  await requirePlatformAdmin()
  const { id } = await params
  const admin = createAdminClient()

  const { data: org } = await admin
    .from('organizations')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (!org) return notFound()

  const [{ data: branches }, { data: staff }, { data: clientsCount }, { data: visitsCount }, { data: lastVisit }] = await Promise.all([
    admin.from('branches').select('id, name, is_active, created_at').eq('organization_id', id).order('created_at'),
    admin.from('staff').select('id, full_name, role, is_active').eq('organization_id', id).eq('is_active', true),
    admin.from('clients').select('id', { count: 'exact', head: true }).eq('organization_id', id),
    admin.from('visits').select('id', { count: 'exact', head: true }).eq('organization_id', id),
    admin.from('visits').select('completed_at').eq('organization_id', id).order('completed_at', { ascending: false }).limit(1).maybeSingle(),
  ])

  return (
    <div className="space-y-6">
      <div>
        <Link href="/platform" className="text-sm text-zinc-500 hover:text-zinc-300">← Volver</Link>
        <h1 className="mt-2 text-2xl font-semibold">{org.name}</h1>
        <p className="text-zinc-500">/{org.slug} · Creada {new Date(org.created_at).toLocaleDateString('es-AR')}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi label="Sucursales" value={`${branches?.filter(b => b.is_active).length ?? 0} / ${org.max_branches}`} />
        <Kpi label="Staff activo" value={staff?.length ?? 0} />
        <Kpi label="Clientes" value={(clientsCount as unknown as { count?: number })?.count ?? 0} />
        <Kpi label="Visitas" value={(visitsCount as unknown as { count?: number })?.count ?? 0} />
      </div>

      <OrgPlatformDetailClient org={org} branches={branches ?? []} lastVisitAt={lastVisit?.completed_at ?? null} />
    </div>
  )
}

function Kpi({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  )
}
