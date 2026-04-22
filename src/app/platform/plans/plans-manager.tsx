'use client'

import { useState, useTransition } from 'react'
import { Pencil, Trash2, Plus, Save, EyeOff, Loader2, X } from 'lucide-react'
import { upsertPlan, deletePlan, type PlanInput } from '@/lib/actions/platform-billing'

type PlanRow = PlanInput & { created_at?: string; updated_at?: string }

export function PlansManager({ plans }: { plans: PlanRow[] }) {
  const [editing, setEditing] = useState<PlanRow | null>(null)
  const [isNew, setIsNew] = useState(false)

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => { setIsNew(true); setEditing(emptyPlan()) }}
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
        >
          <Plus className="size-4" /> Nuevo plan
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {plans.map(p => (
          <PlanCard key={p.id} plan={p} onEdit={() => { setIsNew(false); setEditing(p) }} />
        ))}
      </div>

      {editing && (
        <PlanEditor
          plan={editing}
          isNew={isNew}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function emptyPlan(): PlanRow {
  return {
    id: '',
    name: '',
    tagline: '',
    price_ars_monthly: 0,
    price_ars_yearly: 0,
    price_usd_monthly: null,
    price_usd_yearly: null,
    trial_days: 14,
    features: {},
    limits: { branches: 1, staff: 1, clients: 100, broadcasts_monthly: 0, ai_messages_monthly: 0 },
    is_public: true,
    sort_order: 100,
  }
}

function PlanCard({ plan, onEdit }: { plan: PlanRow; onEdit: () => void }) {
  const featureCount = Object.values(plan.features ?? {}).filter(Boolean).length
  return (
    <div className="group relative rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 transition-colors hover:border-zinc-700">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold">{plan.name}</h3>
            {!plan.is_public && (
              <span className="inline-flex items-center gap-1 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-400">
                <EyeOff className="size-3" /> oculto
              </span>
            )}
          </div>
          <div className="mt-0.5 font-mono text-xs text-zinc-500">{plan.id}</div>
          {plan.tagline && <p className="mt-1 text-sm text-zinc-400">{plan.tagline}</p>}
        </div>
        <button
          onClick={onEdit}
          className="flex size-8 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-100"
          aria-label="Editar"
        >
          <Pencil className="size-3.5" />
        </button>
      </div>

      <div className="mt-4">
        <div className="text-2xl font-bold">
          {plan.price_ars_monthly === 0 ? 'Gratis' : `AR$ ${(plan.price_ars_monthly / 100).toLocaleString('es-AR')}`}
          {plan.price_ars_monthly > 0 && <span className="text-xs font-normal text-zinc-500">/mes</span>}
        </div>
        {plan.price_ars_yearly > 0 && (
          <div className="text-xs text-zinc-500">
            Anual: AR$ {(plan.price_ars_yearly / 100).toLocaleString('es-AR')}
          </div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <LimitRow label="Sucursales" value={plan.limits.branches} />
        <LimitRow label="Staff" value={plan.limits.staff} />
        <LimitRow label="Clientes" value={plan.limits.clients} />
        <LimitRow label="Broadcasts/mes" value={plan.limits.broadcasts_monthly} />
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-zinc-800 pt-3 text-xs text-zinc-500">
        <span>{featureCount} features</span>
        <span>Trial: {plan.trial_days}d</span>
      </div>
    </div>
  )
}

function LimitRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between rounded bg-zinc-900 px-2 py-1">
      <span className="text-zinc-500">{label}</span>
      <span className="font-medium tabular-nums text-zinc-300">
        {value === -1 ? '∞' : value.toLocaleString('es-AR')}
      </span>
    </div>
  )
}

// ============================================================
// Editor drawer
// ============================================================

function PlanEditor({
  plan,
  isNew,
  onClose,
}: {
  plan: PlanRow
  isNew: boolean
  onClose: () => void
}) {
  const [form, setForm] = useState<PlanInput>(plan)
  const [featuresText, setFeaturesText] = useState(JSON.stringify(plan.features, null, 2))
  const [featuresError, setFeaturesError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const updateLimit = (key: string, value: string) => {
    const n = value === '' ? 0 : parseInt(value, 10)
    setForm(f => ({ ...f, limits: { ...f.limits, [key]: isNaN(n) ? 0 : n } }))
  }

  const handleSave = () => {
    setError(null)
    // Parse features JSON
    let parsedFeatures: Record<string, boolean>
    try {
      parsedFeatures = JSON.parse(featuresText)
      setFeaturesError(null)
    } catch (e) {
      setFeaturesError('JSON inválido: ' + (e instanceof Error ? e.message : 'error'))
      return
    }

    startTransition(async () => {
      const res = await upsertPlan({ ...form, features: parsedFeatures })
      if ('error' in res) { setError(res.error ?? 'Error desconocido'); return }
      onClose()
      window.location.reload()
    })
  }

  const handleDelete = () => {
    if (!confirm(`¿Eliminar el plan ${form.name}? Esto falla si hay orgs usándolo.`)) return
    startTransition(async () => {
      const res = await deletePlan(form.id)
      if ('error' in res) { setError(res.error ?? 'Error desconocido'); return }
      onClose()
      window.location.reload()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative ml-auto flex h-full w-full max-w-2xl flex-col bg-zinc-950 shadow-2xl">
        <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">{isNew ? 'Nuevo plan' : `Editando ${plan.name}`}</h2>
            <p className="text-xs text-zinc-500">Los cambios se aplican inmediatamente en /pricing y en entitlements.</p>
          </div>
          <button onClick={onClose} className="flex size-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100">
            <X className="size-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Básicos */}
          <Section title="Identificación">
            <Field label="ID" help="snake_case, no editable después de crear">
              <input
                disabled={!isNew}
                value={form.id}
                onChange={(e) => setForm(f => ({ ...f, id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') }))}
                placeholder="ej: start"
                className={inputCls}
              />
            </Field>
            <Field label="Nombre público">
              <input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} placeholder="ej: Start" className={inputCls} />
            </Field>
            <Field label="Tagline" help="Una línea corta que aparece debajo del nombre en /pricing">
              <input value={form.tagline ?? ''} onChange={(e) => setForm(f => ({ ...f, tagline: e.target.value }))} className={inputCls} />
            </Field>
          </Section>

          {/* Precios */}
          <Section title="Precios (en centavos)">
            <div className="grid grid-cols-2 gap-3">
              <Field label="ARS / mes" help="AR$ 29.900 = 2990000">
                <input type="number" value={form.price_ars_monthly} onChange={(e) => setForm(f => ({ ...f, price_ars_monthly: Number(e.target.value) }))} className={inputCls} />
              </Field>
              <Field label="ARS / año">
                <input type="number" value={form.price_ars_yearly} onChange={(e) => setForm(f => ({ ...f, price_ars_yearly: Number(e.target.value) }))} className={inputCls} />
              </Field>
              <Field label="USD / mes (opcional)">
                <input type="number" value={form.price_usd_monthly ?? ''} onChange={(e) => setForm(f => ({ ...f, price_usd_monthly: e.target.value === '' ? null : Number(e.target.value) }))} className={inputCls} />
              </Field>
              <Field label="USD / año (opcional)">
                <input type="number" value={form.price_usd_yearly ?? ''} onChange={(e) => setForm(f => ({ ...f, price_usd_yearly: e.target.value === '' ? null : Number(e.target.value) }))} className={inputCls} />
              </Field>
            </div>
          </Section>

          {/* Límites */}
          <Section title="Límites (usar -1 para ilimitado)">
            <div className="grid grid-cols-2 gap-3">
              {(['branches', 'staff', 'clients', 'broadcasts_monthly', 'ai_messages_monthly'] as const).map(key => (
                <Field key={key} label={key}>
                  <input
                    type="number"
                    value={form.limits[key] ?? 0}
                    onChange={(e) => updateLimit(key, e.target.value)}
                    className={inputCls}
                  />
                </Field>
              ))}
            </div>
          </Section>

          {/* Features JSON */}
          <Section title="Features (JSON)">
            <p className="mb-2 text-xs text-zinc-500">
              Objeto con <code className="rounded bg-zinc-800 px-1">{'{"feature.key": true}'}</code>.
              Las claves deben coincidir con <code className="rounded bg-zinc-800 px-1">modules.feature_key</code>.
            </p>
            <textarea
              value={featuresText}
              onChange={(e) => setFeaturesText(e.target.value)}
              rows={12}
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none"
            />
            {featuresError && <p className="mt-1 text-xs text-rose-400">{featuresError}</p>}
          </Section>

          {/* Comportamiento */}
          <Section title="Comportamiento">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Trial (días)">
                <input type="number" value={form.trial_days} onChange={(e) => setForm(f => ({ ...f, trial_days: Number(e.target.value) }))} className={inputCls} />
              </Field>
              <Field label="Orden de aparición">
                <input type="number" value={form.sort_order} onChange={(e) => setForm(f => ({ ...f, sort_order: Number(e.target.value) }))} className={inputCls} />
              </Field>
            </div>
            <label className="mt-3 flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_public}
                onChange={(e) => setForm(f => ({ ...f, is_public: e.target.checked }))}
                className="mt-0.5 size-4 rounded border-zinc-700 bg-zinc-900 text-indigo-500 focus:ring-indigo-500"
              />
              <div className="flex-1">
                <div className="text-sm font-medium text-zinc-200">Visible en /pricing</div>
                <div className="text-xs text-zinc-500">Si está deshabilitado, el plan existe solo para asignación manual (ej: plan interno).</div>
              </div>
            </label>
          </Section>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-zinc-800 px-6 py-4">
          <div className="flex-1">
            {error && <p className="text-xs text-rose-400">{error}</p>}
          </div>
          {!isNew && (
            <button
              onClick={handleDelete}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-1.5 text-sm font-medium text-rose-400 hover:bg-rose-500/10"
            >
              <Trash2 className="size-4" /> Eliminar
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded-md border border-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-300 hover:bg-zinc-900"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={isPending || !form.id || !form.name}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Guardar
          </button>
        </footer>
      </div>
    </div>
  )
}

const inputCls = 'w-full rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{title}</h3>
      {children}
    </section>
  )
}

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-300">{label}</span>
      {children}
      {help && <span className="mt-1 block text-[10px] text-zinc-500">{help}</span>}
    </label>
  )
}
