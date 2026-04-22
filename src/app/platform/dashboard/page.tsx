import Link from 'next/link'
import {
  TrendingUp,
  Building2,
  Clock,
  AlertTriangle,
  Sparkles,
  ArrowRight,
  Crown,
} from 'lucide-react'
import {
  getPlatformMetrics,
  listTopDeniedFeatures,
  getTrialsExpiringSoon,
} from '@/lib/actions/platform-billing'
import { listRecentPlatformActions } from '@/lib/actions/platform'
import { PageHeader } from '@/components/platform/page-header'
import { KpiCard } from '@/components/platform/kpi-card'

export const dynamic = 'force-dynamic'

function formatArs(amount: number): string {
  return amount.toLocaleString('es-AR', { maximumFractionDigits: 0 })
}

export default async function PlatformDashboard() {
  const [metrics, denied, trials, recentActions] = await Promise.all([
    getPlatformMetrics(),
    listTopDeniedFeatures(30, 8),
    getTrialsExpiringSoon(7),
    listRecentPlatformActions(8),
  ])

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        description="Vista general del negocio SaaS — orgs, ingresos y señales."
      />

      {/* KPIs principales */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard
          label="MRR"
          value={`AR$ ${formatArs(metrics.mrr_ars)}`}
          accent="emerald"
          icon={TrendingUp}
          hint="Recurrente mensual facturable"
        />
        <KpiCard
          label="ARR proyectado"
          value={`AR$ ${formatArs(metrics.arr_ars)}`}
          accent="emerald"
          icon={TrendingUp}
          hint="MRR × 12"
        />
        <KpiCard
          label="Orgs activas"
          value={metrics.active_orgs.toString()}
          accent="indigo"
          icon={Building2}
          hint={`${metrics.grandfathered_orgs} grandfathered`}
        />
        <KpiCard
          label="En trial"
          value={metrics.trial_orgs.toString()}
          accent="amber"
          icon={Clock}
          hint="Activas sin pago aún"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Distribución por plan */}
        <section className="lg:col-span-5 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Distribución por plan</h2>
            <Link href="/platform/plans" className="text-xs text-indigo-400 hover:text-indigo-300">
              Gestionar planes →
            </Link>
          </div>
          <div className="space-y-3">
            {metrics.plan_distribution
              .filter(p => p.count > 0)
              .sort((a, b) => b.count - a.count)
              .map((p) => {
                const max = Math.max(...metrics.plan_distribution.map(x => x.count), 1)
                const pct = Math.round((p.count / max) * 100)
                return (
                  <div key={p.plan_id}>
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="font-medium capitalize">{p.name}</span>
                      <span className="tabular-nums text-zinc-400">{p.count}</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            {metrics.plan_distribution.filter(p => p.count > 0).length === 0 && (
              <p className="text-xs text-zinc-500">Sin orgs activas todavía.</p>
            )}
          </div>
        </section>

        {/* Requieren atención */}
        <section className="lg:col-span-7 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-400" />
              Requieren atención
            </h2>
          </div>

          <div className="space-y-5">
            {/* Trials vencen pronto */}
            <AttentionBlock
              title={`Trials que vencen en 7 días (${trials.length})`}
              emptyLabel="Ningún trial próximo a vencer"
              items={trials.slice(0, 5).map((t) => ({
                id: t.organization_id,
                label: (t.organizations as { name?: string } | null)?.name ?? t.organization_id,
                rightLabel: t.trial_ends_at
                  ? daysUntil(t.trial_ends_at)
                  : '—',
                href: `/platform/orgs/${t.organization_id}`,
              }))}
            />

            {/* Past due */}
            <AttentionBlock
              title={`Con pago pendiente (${metrics.past_due_list.length})`}
              tone="danger"
              emptyLabel="Sin pagos pendientes"
              items={metrics.past_due_list.slice(0, 5).map((t) => ({
                id: t.organization_id,
                label: (t.organizations as { name?: string } | null)?.name ?? t.organization_id,
                rightLabel: t.current_period_end ? new Date(t.current_period_end).toLocaleDateString('es-AR') : '—',
                href: `/platform/orgs/${t.organization_id}`,
              }))}
            />
          </div>
        </section>

        {/* Top denied features */}
        <section className="lg:col-span-7 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Sparkles className="size-4 text-indigo-400" />
              Features más bloqueadas (30 días)
            </h2>
            <Link href="/platform/usage" className="text-xs text-indigo-400 hover:text-indigo-300">
              Ver analytics →
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-zinc-500">
                  <th className="py-2 font-medium">Feature</th>
                  <th className="py-2 font-medium text-right">Intentos</th>
                  <th className="py-2 font-medium text-right">Orgs distintas</th>
                </tr>
              </thead>
              <tbody>
                {denied.length === 0 && (
                  <tr><td colSpan={3} className="py-4 text-center text-xs text-zinc-500">Sin denials registrados.</td></tr>
                )}
                {denied.map((d) => (
                  <tr key={d.feature_key} className="border-t border-zinc-800">
                    <td className="py-2 font-mono text-xs">{d.feature_key}</td>
                    <td className="py-2 text-right tabular-nums">{d.attempts}</td>
                    <td className="py-2 text-right tabular-nums text-zinc-400">{d.distinct_orgs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Actividad reciente */}
        <section className="lg:col-span-5 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Actividad reciente</h2>
            <Link href="/platform/actions" className="text-xs text-indigo-400 hover:text-indigo-300">
              Ver todo →
            </Link>
          </div>
          <div className="space-y-3">
            {recentActions.length === 0 && (
              <p className="text-xs text-zinc-500">Sin actividad reciente.</p>
            )}
            {recentActions.map((a) => (
              <div key={a.id} className="flex items-start gap-3 text-xs">
                <div className="mt-1 size-1.5 shrink-0 rounded-full bg-indigo-500" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-zinc-300">{a.action}</div>
                  <div className="truncate text-zinc-500">
                    {a.target_org_id ? `org ${a.target_org_id.slice(0, 8)}…` : 'platform'} · {new Date(a.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Grandfathered callout */}
      {metrics.grandfathered_orgs > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <Crown className="mt-0.5 size-5 shrink-0 text-amber-400" />
          <div className="flex-1 text-sm">
            <div className="font-medium text-amber-200">{metrics.grandfathered_orgs} organizaciones con plan grandfathered</div>
            <div className="mt-1 text-xs text-amber-200/70">
              Clientes previos a la comercialización o acuerdos especiales. No figuran en el MRR.
            </div>
          </div>
          <Link
            href="/platform/organizations?filter=grandfathered"
            className="flex items-center gap-1 text-xs font-medium text-amber-300 hover:text-amber-200"
          >
            Ver listado <ArrowRight className="size-3" />
          </Link>
        </div>
      )}
    </div>
  )
}

function daysUntil(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now()
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24))
  if (days < 0) return `hace ${-days}d`
  if (days === 0) return 'hoy'
  if (days === 1) return 'mañana'
  return `en ${days}d`
}

function AttentionBlock({
  title, emptyLabel, items, tone = 'default',
}: {
  title: string
  emptyLabel: string
  items: { id: string; label: string; rightLabel: string; href: string }[]
  tone?: 'default' | 'danger'
}) {
  return (
    <div>
      <div className="mb-2 text-xs font-medium text-zinc-400">{title}</div>
      {items.length === 0 ? (
        <p className="text-xs text-zinc-500">{emptyLabel}</p>
      ) : (
        <div className="space-y-1">
          {items.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-zinc-800/50"
            >
              <span className="truncate">{item.label}</span>
              <span className={`ml-2 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                tone === 'danger'
                  ? 'bg-rose-500/15 text-rose-300'
                  : 'bg-amber-500/15 text-amber-300'
              }`}>
                {item.rightLabel}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
