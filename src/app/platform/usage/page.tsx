import { TrendingDown, Zap } from 'lucide-react'
import Link from 'next/link'
import { listTopDeniedFeatures, listRecentDenials } from '@/lib/actions/platform-billing'
import { PageHeader } from '@/components/platform/page-header'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Uso · Platform' }

type DenialRow = {
  id: string
  feature_key: string
  organization_id: string
  context: Record<string, unknown>
  created_at: string
  organizations: { name?: string; slug?: string } | null
}

export default async function UsagePage() {
  const [topDenied30d, topDenied7d, recent] = await Promise.all([
    listTopDeniedFeatures(30, 20),
    listTopDeniedFeatures(7, 20),
    listRecentDenials(50) as Promise<DenialRow[]>,
  ])

  const maxAttempts = Math.max(...topDenied30d.map(d => d.attempts), 1)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Uso y features bloqueadas"
        description="Features que los usuarios intentaron usar pero su plan no incluye. Cada intento es una oportunidad de upsell."
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Denials últimos 7 días" value={topDenied7d.reduce((a, d) => a + d.attempts, 0)} accent="text-amber-400" icon={Zap} />
        <Stat label="Denials últimos 30 días" value={topDenied30d.reduce((a, d) => a + d.attempts, 0)} accent="text-rose-400" icon={TrendingDown} />
        <Stat label="Features únicos (30d)" value={topDenied30d.length} />
        <Stat label="Orgs afectadas (30d)" value={new Set(recent.map(r => r.organization_id)).size} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Top denied */}
        <section className="lg:col-span-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <h2 className="mb-4 text-sm font-semibold">Top features bloqueadas (últimos 30 días)</h2>
          <div className="space-y-2">
            {topDenied30d.length === 0 && <p className="text-sm text-zinc-500">Sin denials registrados en el período.</p>}
            {topDenied30d.map((d) => {
              const pct = Math.round((d.attempts / maxAttempts) * 100)
              return (
                <div key={d.feature_key} className="group space-y-1">
                  <div className="flex items-baseline justify-between text-sm">
                    <code className="font-mono text-xs text-zinc-300">{d.feature_key}</code>
                    <div className="flex items-baseline gap-3 text-xs">
                      <span className="text-zinc-500">{d.distinct_orgs} org{d.distinct_orgs !== 1 ? 's' : ''}</span>
                      <span className="tabular-nums font-semibold text-zinc-100">{d.attempts}</span>
                    </div>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-amber-500 to-rose-500 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* Recent activity */}
        <section className="lg:col-span-2 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <h2 className="mb-4 text-sm font-semibold">Últimos denials</h2>
          <div className="space-y-2 max-h-[32rem] overflow-y-auto pr-1">
            {recent.length === 0 && <p className="text-sm text-zinc-500">Sin eventos.</p>}
            {recent.map((r) => (
              <div key={r.id} className="flex items-start gap-3 rounded-md border border-zinc-800 bg-zinc-900/50 p-2.5 text-xs">
                <div className="mt-0.5 size-1.5 shrink-0 rounded-full bg-rose-500" />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/platform/orgs/${r.organization_id}`}
                    className="block font-medium text-zinc-200 hover:text-indigo-400"
                  >
                    {r.organizations?.name ?? r.organization_id.slice(0, 8)}
                  </Link>
                  <code className="font-mono text-[10px] text-zinc-500">{r.feature_key}</code>
                  <div className="mt-0.5 text-[10px] text-zinc-500">
                    {new Date(r.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

function Stat({ label, value, accent, icon: Icon }: { label: string; value: number | string; accent?: string; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs text-zinc-500">{label}</div>
          <div className={`mt-1 text-2xl font-semibold ${accent ?? 'text-zinc-100'}`}>{value}</div>
        </div>
        {Icon && <Icon className={`size-4 ${accent ?? 'text-zinc-500'}`} />}
      </div>
    </div>
  )
}
