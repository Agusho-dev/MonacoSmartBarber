'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateOrgBilling, toggleOrgActive, impersonateOrg } from '@/lib/actions/platform'

interface Branch {
  id: string
  name: string
  is_active: boolean
  created_at: string
}

interface Org {
  id: string
  name: string
  slug: string
  is_active: boolean
  subscription_status: string
  subscription_plan: string
  max_branches: number
  trial_ends_at: string | null
  billing_email: string | null
  billing_notes: string | null
  country_code: string
  currency: string
  locale: string
  timezone: string
}

export function OrgPlatformDetailClient({ org, branches, lastVisitAt }: { org: Org; branches: Branch[]; lastVisitAt: string | null }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)

  const [plan, setPlan] = useState(org.subscription_plan)
  const [status, setStatus] = useState(org.subscription_status)
  const [maxBranches, setMaxBranches] = useState(org.max_branches)
  const [billingEmail, setBillingEmail] = useState(org.billing_email ?? '')
  const [billingNotes, setBillingNotes] = useState(org.billing_notes ?? '')

  function save() {
    setMsg(null)
    startTransition(async () => {
      const res = await updateOrgBilling({
        orgId: org.id,
        subscription_plan: plan,
        subscription_status: status,
        max_branches: maxBranches,
        billing_email: billingEmail || null,
        billing_notes: billingNotes || null,
      })
      if ('error' in res && res.error) setMsg('Error: ' + res.error)
      else setMsg('Cambios guardados ✓')
      router.refresh()
    })
  }

  function toggleActive() {
    startTransition(async () => {
      await toggleOrgActive(org.id, !org.is_active)
      router.refresh()
    })
  }

  function impersonate() {
    startTransition(async () => {
      const res = await impersonateOrg(org.id)
      if ('error' in res && res.error) { setMsg('Error: ' + res.error); return }
      window.location.href = '/dashboard'
    })
  }

  const activeBranchCount = branches.filter(b => b.is_active).length

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Billing & plan */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="mb-4 text-lg font-semibold">Facturación y plan</h2>
        <div className="space-y-4">
          <Field label="Plan">
            <select value={plan} onChange={e => setPlan(e.target.value)} className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2">
              <option value="starter">Starter</option>
              <option value="pro">Pro</option>
              <option value="enterprise">Enterprise</option>
              <option value="custom">Custom</option>
            </select>
          </Field>
          <Field label="Status">
            <select value={status} onChange={e => setStatus(e.target.value)} className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2">
              <option value="trial">Trial</option>
              <option value="active">Active</option>
              <option value="past_due">Past due</option>
              <option value="cancelled">Cancelled</option>
              <option value="suspended">Suspended</option>
            </select>
          </Field>
          <Field label={`Sucursales permitidas (actualmente ${activeBranchCount} activas)`}>
            <input
              type="number" min={1}
              value={maxBranches}
              onChange={e => setMaxBranches(parseInt(e.target.value) || 1)}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2"
            />
          </Field>
          <Field label="Email de facturación">
            <input
              type="email"
              value={billingEmail}
              onChange={e => setBillingEmail(e.target.value)}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2"
            />
          </Field>
          <Field label="Notas de contrato (interno)">
            <textarea
              value={billingNotes}
              onChange={e => setBillingNotes(e.target.value)}
              rows={3}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2"
            />
          </Field>
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-60"
          >
            {pending ? 'Guardando…' : 'Guardar cambios'}
          </button>
          {msg && <div className="text-sm text-zinc-400">{msg}</div>}
        </div>
      </section>

      {/* Info + acciones peligrosas */}
      <section className="space-y-6">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="mb-4 text-lg font-semibold">Información de la org</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <dt className="text-zinc-500">País</dt><dd>{org.country_code}</dd>
            <dt className="text-zinc-500">Moneda</dt><dd>{org.currency}</dd>
            <dt className="text-zinc-500">Locale</dt><dd>{org.locale}</dd>
            <dt className="text-zinc-500">Timezone</dt><dd>{org.timezone}</dd>
            <dt className="text-zinc-500">Trial fin</dt><dd>{org.trial_ends_at ? new Date(org.trial_ends_at).toLocaleDateString('es-AR') : '—'}</dd>
            <dt className="text-zinc-500">Última visita</dt><dd>{lastVisitAt ? new Date(lastVisitAt).toLocaleDateString('es-AR') : '—'}</dd>
          </dl>
        </div>

        <div className="rounded-lg border border-rose-900/40 bg-rose-950/20 p-6">
          <h2 className="mb-4 text-lg font-semibold text-rose-300">Acciones críticas</h2>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={toggleActive}
              disabled={pending}
              className="rounded bg-rose-600/20 px-4 py-2 text-sm font-medium text-rose-300 hover:bg-rose-600/30 disabled:opacity-60"
            >
              {org.is_active ? 'Desactivar organización' : 'Reactivar organización'}
            </button>
            <button
              type="button"
              onClick={impersonate}
              disabled={pending}
              className="rounded bg-amber-600/20 px-4 py-2 text-sm font-medium text-amber-300 hover:bg-amber-600/30 disabled:opacity-60"
            >
              Entrar como admin de esta org
            </button>
          </div>
          <p className="mt-3 text-xs text-zinc-500">
            Desactivar bloquea el acceso al dashboard. Entrar como admin queda registrado en el audit log.
          </p>
        </div>
      </section>

      {/* Sucursales */}
      <section className="lg:col-span-2 rounded-lg border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="mb-4 text-lg font-semibold">Sucursales ({activeBranchCount} activas)</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-zinc-500">
            <tr><th className="py-2 font-medium">Nombre</th><th className="py-2 font-medium">Estado</th><th className="py-2 font-medium">Creada</th></tr>
          </thead>
          <tbody>
            {branches.length === 0 && <tr><td colSpan={3} className="py-4 text-zinc-500">Sin sucursales</td></tr>}
            {branches.map(b => (
              <tr key={b.id} className="border-t border-zinc-800">
                <td className="py-2">{b.name}</td>
                <td className="py-2">{b.is_active ? '✅ activa' : '⏸️ inactiva'}</td>
                <td className="py-2 text-xs text-zinc-500">{new Date(b.created_at).toLocaleDateString('es-AR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-zinc-400">{label}</span>
      {children}
    </label>
  )
}
