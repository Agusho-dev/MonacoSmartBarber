import { listLandingLeads, listWaitlistGrouped } from '@/lib/actions/platform-billing'
import { PageHeader } from '@/components/platform/page-header'
import { WaitlistGrouped } from './waitlist-grouped'
import { LandingLeads } from './landing-leads'
import { WaitlistTabs, type WaitlistTab } from './waitlist-tabs'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Waitlist · Platform' }

type WaitlistRow = {
  id: string
  module_id: string
  organization_id: string | null
  user_id: string | null
  email: string | null
  notified_at: string | null
  created_at: string
  modules: { name?: string; status?: string } | null
  organizations: { name?: string; slug?: string } | null
}

export default async function WaitlistPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const [raw, leads] = await Promise.all([
    listWaitlistGrouped() as Promise<WaitlistRow[]>,
    listLandingLeads(),
  ])

  // Group module waitlist by module
  const grouped = new Map<string, { moduleName: string; status: string; items: WaitlistRow[] }>()
  for (const row of raw) {
    const key = row.module_id
    const moduleName = row.modules?.name ?? row.module_id
    const status = row.modules?.status ?? 'unknown'
    const entry = grouped.get(key) ?? { moduleName, status, items: [] }
    entry.items.push(row)
    grouped.set(key, entry)
  }

  const groups = Array.from(grouped.entries())
    .map(([moduleId, g]) => ({
      moduleId,
      moduleName: g.moduleName,
      status: g.status,
      items: g.items,
      totalPending: g.items.filter(i => !i.notified_at).length,
      totalNotified: g.items.filter(i => i.notified_at).length,
    }))
    .sort((a, b) => b.totalPending - a.totalPending)

  const landingPending = leads.filter(l => l.status === 'pending').length
  const landingConverted = leads.filter(l => l.status === 'converted').length
  const modulesPending = raw.filter(r => !r.notified_at).length
  const modulesNotified = raw.filter(r => r.notified_at).length

  const params = await searchParams
  const requested = params.tab
  const tab: WaitlistTab =
    requested === 'modules'
      ? 'modules'
      : requested === 'landing'
        ? 'landing'
        : landingPending > 0
          ? 'landing'
          : 'modules'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Waitlist"
        description="Dos flujos: leads del landing público y usuarios in-app anotándose en módulos 'coming_soon'."
      />

      <WaitlistTabs
        initial={tab}
        landingCount={leads.length}
        modulesCount={raw.length}
      >
        <div data-tab="landing">
          <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Leads pendientes" value={landingPending} accent="text-amber-400" />
            <Stat label="Convertidos" value={landingConverted} accent="text-emerald-400" />
            <Stat label="Total leads" value={leads.length} />
            <Stat
              label="Última carga"
              value={
                leads[0]?.created_at
                  ? new Date(leads[0].created_at).toLocaleDateString('es-AR', {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : '—'
              }
            />
          </div>
          <LandingLeads leads={leads} />
        </div>

        <div data-tab="modules">
          <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Total pendientes" value={modulesPending} accent="text-amber-400" />
            <Stat label="Notificados" value={modulesNotified} accent="text-emerald-400" />
            <Stat label="Módulos con interés" value={groups.length} />
            <Stat label="Total registros" value={raw.length} />
          </div>
          <WaitlistGrouped groups={groups} />
        </div>
      </WaitlistTabs>
    </div>
  )
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string
  value: number | string
  accent?: string
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`text-2xl font-semibold ${accent ?? 'text-zinc-100'}`}>{value}</div>
    </div>
  )
}
