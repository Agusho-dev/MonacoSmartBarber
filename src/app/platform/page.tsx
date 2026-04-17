import Link from 'next/link'
import { listOrganizationsForPlatform } from '@/lib/actions/platform'

export const dynamic = 'force-dynamic'

export default async function PlatformHome() {
  const orgs = await listOrganizationsForPlatform()

  const stats = {
    total: orgs.length,
    active: orgs.filter(o => o.is_active && o.subscription_status === 'active').length,
    trial:  orgs.filter(o => o.subscription_status === 'trial').length,
    suspended: orgs.filter(o => o.subscription_status === 'suspended' || o.subscription_status === 'cancelled').length,
    totalVisits: orgs.reduce((a, o) => a + o.total_visits, 0),
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Organizaciones</h1>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Kpi label="Total" value={stats.total} />
        <Kpi label="Activas (pagas)" value={stats.active} accent="text-emerald-400" />
        <Kpi label="Trial" value={stats.trial} accent="text-amber-400" />
        <Kpi label="Suspendidas" value={stats.suspended} accent="text-rose-400" />
        <Kpi label="Visitas totales" value={stats.totalVisits.toLocaleString('es-AR')} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900">
        <table className="w-full text-sm">
          <thead className="bg-zinc-800/50 text-left text-zinc-400">
            <tr>
              <th className="px-4 py-2 font-medium">Org</th>
              <th className="px-4 py-2 font-medium">Plan</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Sucursales</th>
              <th className="px-4 py-2 font-medium">Staff</th>
              <th className="px-4 py-2 font-medium">Clientes</th>
              <th className="px-4 py-2 font-medium">Visitas</th>
              <th className="px-4 py-2 font-medium">País</th>
              <th className="px-4 py-2 font-medium">Última visita</th>
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {orgs.map(o => (
              <tr key={o.id} className="border-t border-zinc-800">
                <td className="px-4 py-3">
                  <div className="font-medium">{o.name}</div>
                  <div className="text-xs text-zinc-500">/{o.slug}</div>
                </td>
                <td className="px-4 py-3 capitalize">{o.subscription_plan}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={o.subscription_status} isActive={o.is_active} />
                </td>
                <td className="px-4 py-3">
                  {o.active_branches}/{o.max_branches}
                </td>
                <td className="px-4 py-3">{o.total_staff}</td>
                <td className="px-4 py-3">{o.total_clients.toLocaleString('es-AR')}</td>
                <td className="px-4 py-3">{o.total_visits.toLocaleString('es-AR')}</td>
                <td className="px-4 py-3">{o.country_code}</td>
                <td className="px-4 py-3 text-xs text-zinc-500">
                  {o.last_visit_at ? new Date(o.last_visit_at).toLocaleDateString('es-AR') : '—'}
                </td>
                <td className="px-4 py-3">
                  <Link href={`/platform/orgs/${o.id}`} className="text-indigo-400 hover:underline">Detalle →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Kpi({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`text-2xl font-semibold ${accent ?? ''}`}>{value}</div>
    </div>
  )
}

function StatusBadge({ status, isActive }: { status: string; isActive: boolean }) {
  if (!isActive) return <span className="inline-flex rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">inactive</span>
  const colors: Record<string, string> = {
    active:    'bg-emerald-900/30 text-emerald-300',
    trial:     'bg-amber-900/30 text-amber-300',
    past_due:  'bg-orange-900/30 text-orange-300',
    cancelled: 'bg-rose-900/30 text-rose-300',
    suspended: 'bg-rose-900/30 text-rose-300',
  }
  return <span className={`inline-flex rounded px-2 py-0.5 text-xs ${colors[status] ?? 'bg-zinc-800 text-zinc-400'}`}>{status}</span>
}
