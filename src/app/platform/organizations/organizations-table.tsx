'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Search, ExternalLink } from 'lucide-react'
import type { OrgPlatformRow } from '@/lib/actions/platform'
import { cn } from '@/lib/utils'

type StatusKey = 'all' | 'active' | 'trial' | 'past_due' | 'cancelled' | 'suspended'

const STATUS_LABEL: Record<StatusKey, string> = {
  all: 'Todas',
  active: 'Activas',
  trial: 'Trial',
  past_due: 'Pago pendiente',
  cancelled: 'Canceladas',
  suspended: 'Suspendidas',
}

export function OrganizationsTable({ orgs }: { orgs: OrgPlatformRow[] }) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusKey>('all')

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return orgs.filter((o) => {
      if (q && !o.name.toLowerCase().includes(q) && !o.slug.toLowerCase().includes(q)) return false
      if (status === 'all') return true
      return o.subscription_status === status
    })
  }, [orgs, search, status])

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o slug…"
            className="w-full rounded-md border border-zinc-800 bg-zinc-900 py-2 pl-9 pr-3 text-sm text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div className="flex flex-wrap gap-1 rounded-md border border-zinc-800 bg-zinc-900 p-0.5">
          {(Object.keys(STATUS_LABEL) as StatusKey[]).map((key) => (
            <button
              key={key}
              onClick={() => setStatus(key)}
              className={cn(
                'rounded px-3 py-1 text-xs font-medium transition-colors',
                status === key ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200',
              )}
            >
              {STATUS_LABEL[key]}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/50">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-800 bg-zinc-900/80 text-left text-xs text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">Organización</th>
              <th className="px-4 py-3 font-medium">Plan</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Sucursales</th>
              <th className="px-4 py-3 font-medium text-right">Staff</th>
              <th className="px-4 py-3 font-medium text-right">Clientes</th>
              <th className="px-4 py-3 font-medium text-right">Visitas</th>
              <th className="px-4 py-3 font-medium">Última</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-sm text-zinc-500">
                  No hay organizaciones que coincidan con los filtros.
                </td>
              </tr>
            )}
            {filtered.map((o) => (
              <tr key={o.id} className="border-b border-zinc-800 last:border-0 hover:bg-zinc-900/50">
                <td className="px-4 py-3">
                  <Link href={`/platform/orgs/${o.id}`} className="block">
                    <div className="font-medium text-zinc-100">{o.name}</div>
                    <div className="text-xs text-zinc-500">/{o.slug}</div>
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <PlanBadge plan={o.subscription_plan} />
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={o.subscription_status} isActive={o.is_active} />
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {o.active_branches}<span className="text-zinc-500">/{o.max_branches ?? '—'}</span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-zinc-300">{o.total_staff}</td>
                <td className="px-4 py-3 text-right tabular-nums text-zinc-300">{o.total_clients.toLocaleString('es-AR')}</td>
                <td className="px-4 py-3 text-right tabular-nums text-zinc-300">{o.total_visits.toLocaleString('es-AR')}</td>
                <td className="px-4 py-3 text-xs text-zinc-500">
                  {o.last_visit_at ? new Date(o.last_visit_at).toLocaleDateString('es-AR') : '—'}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/platform/orgs/${o.id}`}
                    className="inline-flex items-center gap-1 text-xs font-medium text-indigo-400 hover:text-indigo-300"
                  >
                    Abrir <ExternalLink className="size-3" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-xs text-zinc-500">
        Mostrando {filtered.length} de {orgs.length}
      </div>
    </div>
  )
}

function PlanBadge({ plan }: { plan: string | null | undefined }) {
  const colors: Record<string, string> = {
    free: 'bg-zinc-800 text-zinc-300',
    start: 'bg-blue-500/10 text-blue-300',
    pro: 'bg-indigo-500/10 text-indigo-300',
    enterprise: 'bg-purple-500/10 text-purple-300',
    monaco_internal: 'bg-gradient-to-r from-amber-500/15 to-rose-500/15 text-amber-200',
  }
  return (
    <span className={cn('inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium capitalize', colors[plan ?? ''] ?? 'bg-zinc-800 text-zinc-300')}>
      {plan?.replace('_', ' ') ?? '—'}
    </span>
  )
}

function StatusBadge({ status, isActive }: { status: string; isActive: boolean }) {
  if (!isActive) return <span className="inline-flex rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-400">inactive</span>
  const colors: Record<string, string> = {
    active: 'bg-emerald-500/10 text-emerald-300',
    trialing: 'bg-amber-500/10 text-amber-300',
    trial: 'bg-amber-500/10 text-amber-300',
    past_due: 'bg-orange-500/10 text-orange-300',
    cancelled: 'bg-rose-500/10 text-rose-300',
    suspended: 'bg-rose-500/10 text-rose-300',
    paused: 'bg-zinc-700 text-zinc-300',
  }
  return (
    <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium', colors[status] ?? 'bg-zinc-800 text-zinc-400')}>
      <span className="size-1.5 rounded-full bg-current" />
      {status}
    </span>
  )
}
