'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Crown, Loader2, Gift, X, AlertCircle, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  setOrgPlan,
  setOrgSubscriptionStatus,
  setOrgExtraSeats,
  grantModuleToOrg,
  revokeModuleFromOrg,
} from '@/lib/actions/platform-billing'

type Subscription = {
  plan_id: string
  status: string
  grandfathered: boolean
  trial_ends_at: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  extra_branch_seats: number
  extra_staff_seats: number
  provider: string | null
  notes: string | null
} | null

type Plan = {
  id: string
  name: string
  price_ars_monthly: number
  is_public: boolean
}

type ModuleRow = {
  id: string
  name: string
  status: string
  included_in_plans: string[]
  feature_key: string
}

type Grant = {
  module_id: string
  enabled: boolean
  source: string
  expires_at: string | null
  modules: { name?: string; status?: string; feature_key?: string } | null
}

type Billing = {
  subscription: Subscription
  grants: Grant[]
  usage: { branches: number; staff: number; clients: number }
}

export function SubscriptionManager({
  orgId,
  orgName,
  billing,
  plans,
  modules,
}: {
  orgId: string
  orgName: string
  billing: Billing
  plans: Plan[]
  modules: ModuleRow[]
}) {
  const sub = billing.subscription

  if (!sub) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 p-5">
        <AlertCircle className="mt-0.5 size-5 shrink-0 text-rose-400" />
        <div className="flex-1">
          <h3 className="font-medium text-rose-200">Sin suscripción</h3>
          <p className="mt-1 text-sm text-rose-200/70">
            Esta organización no tiene un registro en <code className="rounded bg-rose-500/10 px-1">organization_subscriptions</code>.
            Asigná un plan para desbloquear el sistema.
          </p>
          <div className="mt-3">
            <CreateSubscriptionButton orgId={orgId} plans={plans} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Subscription card */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Suscripción</h2>
              {sub.grandfathered && (
                <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-300">
                  <Crown className="size-3" /> Grandfathered
                </span>
              )}
            </div>
            <div className="mt-2 flex items-center gap-3">
              <span className="text-2xl font-semibold">{planNameById(plans, sub.plan_id)}</span>
              <StatusBadge status={sub.status} />
            </div>
          </div>
          <div className="text-right text-xs text-zinc-500">
            {sub.provider ? <div>Provider: <span className="text-zinc-300">{sub.provider}</span></div> : <div>Sin provider externo</div>}
            {sub.current_period_end && <div>Período hasta: <span className="text-zinc-300">{new Date(sub.current_period_end).toLocaleDateString('es-AR')}</span></div>}
            {sub.trial_ends_at && <div>Trial hasta: <span className="text-amber-300">{new Date(sub.trial_ends_at).toLocaleDateString('es-AR')}</span></div>}
          </div>
        </div>

        {/* Actions row */}
        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          <PlanSwitcher orgId={orgId} currentPlanId={sub.plan_id} plans={plans} />
          <StatusSwitcher orgId={orgId} currentStatus={sub.status} />
          <SeatsEditor orgId={orgId} extraBranches={sub.extra_branch_seats} extraStaff={sub.extra_staff_seats} />
        </div>

        {sub.notes && (
          <div className="mt-4 rounded-md bg-zinc-900 p-3 text-xs text-zinc-400">
            <span className="font-medium text-zinc-300">Nota: </span>{sub.notes}
          </div>
        )}
      </div>

      {/* Grants de módulos */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Módulos grant</h2>
            <p className="mt-1 text-xs text-zinc-500">Regalo manual de features adicionales a {orgName} sin afectar al plan.</p>
          </div>
          <ModuleGrantButton orgId={orgId} modules={modules} existing={billing.grants} />
        </div>

        {billing.grants.length === 0 ? (
          <p className="text-sm text-zinc-500">Sin módulos grant. La org solo tiene los features de su plan.</p>
        ) : (
          <div className="space-y-1">
            {billing.grants.map(g => (
              <div key={g.module_id} className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm">
                <div className="flex items-center gap-3">
                  <Gift className={cn('size-4', g.source === 'grant' ? 'text-amber-400' : 'text-indigo-400')} />
                  <div>
                    <div className="font-medium text-zinc-100">{g.modules?.name ?? g.module_id}</div>
                    <div className="font-mono text-[11px] text-zinc-500">{g.modules?.feature_key}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={cn(
                    'rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider',
                    g.source === 'grant' && 'bg-amber-500/10 text-amber-300',
                    g.source === 'addon' && 'bg-indigo-500/10 text-indigo-300',
                    g.source === 'trial' && 'bg-blue-500/10 text-blue-300',
                  )}>{g.source}</span>
                  <RevokeButton orgId={orgId} moduleId={g.module_id} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick links */}
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/platform/usage?org=${orgId}`}
          className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
        >
          Ver denials de esta org
        </Link>
        <Link
          href={`/platform/billing-events?org=${orgId}`}
          className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
        >
          Ver eventos de pago
        </Link>
      </div>
    </div>
  )
}

function planNameById(plans: Plan[], id: string): string {
  return plans.find(p => p.id === id)?.name ?? id
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-emerald-500/10 text-emerald-300',
    trialing: 'bg-amber-500/10 text-amber-300',
    past_due: 'bg-orange-500/10 text-orange-300',
    cancelled: 'bg-rose-500/10 text-rose-300',
    paused: 'bg-zinc-700 text-zinc-300',
    incomplete: 'bg-zinc-700 text-zinc-300',
  }
  return (
    <span className={cn('inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium', colors[status] ?? 'bg-zinc-800 text-zinc-400')}>
      <span className="size-1.5 rounded-full bg-current" />
      {status}
    </span>
  )
}

// ============================================================
// Sub-components
// ============================================================

function PlanSwitcher({ orgId, currentPlanId, plans }: { orgId: string; currentPlanId: string; plans: Plan[] }) {
  const [value, setValue] = useState(currentPlanId)
  const [grandfathered, setGrandfathered] = useState(false)
  const [isPending, startTransition] = useTransition()

  const handleApply = () => {
    if (value === currentPlanId && !grandfathered) return
    if (!confirm(`Cambiar a plan "${value}"?`)) return
    startTransition(async () => {
      await setOrgPlan(orgId, value, grandfathered)
      window.location.reload()
    })
  }

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900 p-3 space-y-2">
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Cambiar de plan</label>
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100"
      >
        {plans.map(p => (
          <option key={p.id} value={p.id}>{p.name} {!p.is_public && '(interno)'}</option>
        ))}
      </select>
      <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
        <input
          type="checkbox"
          checked={grandfathered}
          onChange={(e) => setGrandfathered(e.target.checked)}
          className="size-3.5 rounded border-zinc-700 bg-zinc-900 text-indigo-500"
        />
        Marcar como grandfathered (no facturar)
      </label>
      <button
        onClick={handleApply}
        disabled={isPending || (value === currentPlanId && !grandfathered)}
        className="w-full rounded bg-indigo-600 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
      >
        {isPending ? 'Aplicando…' : 'Aplicar cambio'}
      </button>
    </div>
  )
}

function StatusSwitcher({ orgId, currentStatus }: { orgId: string; currentStatus: string }) {
  const [value, setValue] = useState(currentStatus)
  const [isPending, startTransition] = useTransition()

  const apply = (next: string) => {
    if (next === currentStatus) return
    if (!confirm(`Cambiar status a "${next}"?`)) return
    setValue(next)
    startTransition(async () => {
      await setOrgSubscriptionStatus(orgId, next as 'active' | 'trialing' | 'past_due' | 'cancelled' | 'paused' | 'incomplete')
      window.location.reload()
    })
  }

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900 p-3 space-y-2">
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Forzar status</label>
      <select
        value={value}
        onChange={(e) => apply(e.target.value)}
        disabled={isPending}
        className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100"
      >
        {['trialing', 'active', 'past_due', 'cancelled', 'paused', 'incomplete'].map(s => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <p className="text-[10px] text-zinc-500">Se aplica inmediatamente. Usá con cuidado si la org tiene pago externo.</p>
    </div>
  )
}

function SeatsEditor({ orgId, extraBranches, extraStaff }: { orgId: string; extraBranches: number; extraStaff: number }) {
  const [b, setB] = useState(extraBranches)
  const [s, setS] = useState(extraStaff)
  const [isPending, startTransition] = useTransition()

  const apply = () => {
    startTransition(async () => {
      await setOrgExtraSeats(orgId, b, s)
      window.location.reload()
    })
  }
  const dirty = b !== extraBranches || s !== extraStaff

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900 p-3 space-y-2">
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Seats extra</label>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-[10px] text-zinc-500 mb-0.5">Sucursales</div>
          <input type="number" min={0} value={b} onChange={(e) => setB(Math.max(0, Number(e.target.value)))} className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm tabular-nums" />
        </div>
        <div>
          <div className="text-[10px] text-zinc-500 mb-0.5">Staff</div>
          <input type="number" min={0} value={s} onChange={(e) => setS(Math.max(0, Number(e.target.value)))} className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm tabular-nums" />
        </div>
      </div>
      <button
        onClick={apply}
        disabled={isPending || !dirty}
        className="w-full rounded bg-indigo-600 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
      >
        {isPending ? 'Aplicando…' : 'Actualizar seats'}
      </button>
    </div>
  )
}

function CreateSubscriptionButton({ orgId, plans }: { orgId: string; plans: Plan[] }) {
  const [planId, setPlanId] = useState(plans[0]?.id ?? '')
  const [isPending, startTransition] = useTransition()

  const apply = () => {
    if (!planId) return
    startTransition(async () => {
      await setOrgPlan(orgId, planId, false)
      window.location.reload()
    })
  }

  return (
    <div className="flex items-center gap-2">
      <select value={planId} onChange={(e) => setPlanId(e.target.value)} className="rounded border border-rose-500/30 bg-rose-500/5 px-2 py-1 text-sm text-rose-200">
        {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <button onClick={apply} disabled={isPending} className="rounded bg-rose-500/20 px-3 py-1 text-xs font-medium text-rose-200 hover:bg-rose-500/30">
        {isPending ? 'Creando…' : 'Crear suscripción'}
      </button>
    </div>
  )
}

function RevokeButton({ orgId, moduleId }: { orgId: string; moduleId: string }) {
  const [isPending, startTransition] = useTransition()
  return (
    <button
      onClick={() => {
        if (!confirm('¿Revocar acceso a este módulo?')) return
        startTransition(async () => {
          await revokeModuleFromOrg(orgId, moduleId)
          window.location.reload()
        })
      }}
      disabled={isPending}
      className="flex size-6 items-center justify-center rounded text-zinc-400 hover:bg-rose-500/10 hover:text-rose-400"
      aria-label="Revocar"
    >
      {isPending ? <Loader2 className="size-3 animate-spin" /> : <X className="size-3.5" />}
    </button>
  )
}

function ModuleGrantButton({ orgId, modules, existing }: { orgId: string; modules: ModuleRow[]; existing: Grant[] }) {
  const [open, setOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string>('')
  const [notes, setNotes] = useState('')
  const [isPending, startTransition] = useTransition()

  const existingIds = new Set(existing.map(e => e.module_id))
  const available = modules.filter(m => !existingIds.has(m.id) && m.status !== 'hidden')

  const apply = () => {
    if (!selectedId) return
    startTransition(async () => {
      await grantModuleToOrg(orgId, selectedId, notes || undefined)
      setOpen(false)
      window.location.reload()
    })
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={available.length === 0}
        className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/30 disabled:opacity-40"
      >
        <Gift className="size-3" /> Regalar módulo
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Regalar módulo</h3>
              <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-zinc-100">
                <X className="size-4" />
              </button>
            </div>
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs text-zinc-400">Módulo</span>
                <select
                  value={selectedId}
                  onChange={(e) => setSelectedId(e.target.value)}
                  className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-2 text-sm text-zinc-100"
                >
                  <option value="">— Elegir —</option>
                  {available.map(m => (
                    <option key={m.id} value={m.id}>{m.name} ({m.status})</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-zinc-400">Notas (opcional)</span>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="ej: cortesía beta tester"
                  className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-2 text-sm text-zinc-100"
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-900">
                Cancelar
              </button>
              <button
                onClick={apply}
                disabled={isPending || !selectedId}
                className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-40"
              >
                {isPending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                Regalar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
