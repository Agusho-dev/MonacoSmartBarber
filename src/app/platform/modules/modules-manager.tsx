'use client'

import { useMemo, useState, useTransition } from 'react'
import { Plus, Pencil, Search, Loader2, Save, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  upsertModule,
  setModuleStatus,
  deleteModule,
  type ModuleInput,
} from '@/lib/actions/platform-billing'

type ModuleStatus = 'active' | 'beta' | 'coming_soon' | 'hidden'

type ModuleRow = ModuleInput & { created_at?: string; updated_at?: string }

const STATUS_STYLES: Record<ModuleStatus, { label: string; cls: string }> = {
  active:      { label: 'Activo',       cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' },
  beta:        { label: 'Beta',         cls: 'bg-blue-500/10 text-blue-300 border-blue-500/30' },
  coming_soon: { label: 'Próximamente', cls: 'bg-amber-500/10 text-amber-300 border-amber-500/30' },
  hidden:      { label: 'Oculto',       cls: 'bg-zinc-800 text-zinc-400 border-zinc-700' },
}

type Filter = 'all' | ModuleStatus

export function ModulesManager({ modules, planIds }: { modules: ModuleRow[]; planIds: string[] }) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [editing, setEditing] = useState<ModuleRow | null>(null)
  const [isNew, setIsNew] = useState(false)

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return modules.filter((m) => {
      if (q && !m.name.toLowerCase().includes(q) && !m.id.toLowerCase().includes(q) && !(m.feature_key ?? '').toLowerCase().includes(q)) return false
      if (filter === 'all') return true
      return m.status === filter
    })
  }, [modules, search, filter])

  const counts = useMemo(() => {
    return modules.reduce((acc, m) => {
      acc[m.status] = (acc[m.status] ?? 0) + 1
      return acc
    }, {} as Record<string, number>)
  }, [modules])

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, id o feature_key…"
            className="w-full rounded-md border border-zinc-800 bg-zinc-900 py-2 pl-9 pr-3 text-sm text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <button
          onClick={() => { setIsNew(true); setEditing(emptyModule()) }}
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
        >
          <Plus className="size-4" /> Nuevo módulo
        </button>
      </div>

      {/* Status tabs */}
      <div className="flex flex-wrap gap-1 rounded-md border border-zinc-800 bg-zinc-900 p-0.5 w-fit">
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')} count={modules.length}>Todos</FilterChip>
        {(Object.keys(STATUS_STYLES) as ModuleStatus[]).map(s => (
          <FilterChip key={s} active={filter === s} onClick={() => setFilter(s)} count={counts[s] ?? 0}>
            {STATUS_STYLES[s].label}
          </FilterChip>
        ))}
      </div>

      {/* Tabla */}
      <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/50">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-800 bg-zinc-900/80 text-left text-xs text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">Módulo</th>
              <th className="px-4 py-3 font-medium">Feature key</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Incluido en</th>
              <th className="px-4 py-3 font-medium text-right">Add-on</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-zinc-500">Sin resultados.</td></tr>
            )}
            {filtered.map((m) => (
              <tr key={m.id} className="border-b border-zinc-800 last:border-0 hover:bg-zinc-900/50">
                <td className="px-4 py-3">
                  <div className="font-medium text-zinc-100">{m.name}</div>
                  <div className="font-mono text-xs text-zinc-500">{m.id}</div>
                  {m.description && <div className="mt-1 text-xs text-zinc-500 line-clamp-1">{m.description}</div>}
                </td>
                <td className="px-4 py-3">
                  <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">{m.feature_key}</code>
                </td>
                <td className="px-4 py-3">
                  <StatusSwitcher current={m.status} moduleId={m.id} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {m.included_in_plans.length === 0 && <span className="text-xs text-zinc-500">—</span>}
                    {m.included_in_plans.map(p => (
                      <span key={p} className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-300">{p}</span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-xs">
                  {m.price_ars_addon && m.price_ars_addon > 0 ? (
                    <span className="tabular-nums">AR$ {(m.price_ars_addon / 100).toLocaleString('es-AR')}</span>
                  ) : (
                    <span className="text-zinc-500">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => { setIsNew(false); setEditing(m) }}
                    className="inline-flex size-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                    aria-label="Editar"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-xs text-zinc-500">Mostrando {filtered.length} de {modules.length}</div>

      {editing && (
        <ModuleEditor
          module={editing}
          isNew={isNew}
          planIds={planIds}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function emptyModule(): ModuleRow {
  return {
    id: '',
    name: '',
    description: '',
    icon: 'Sparkles',
    category: '',
    status: 'active',
    teaser_copy: '',
    estimated_release: null,
    price_ars_addon: null,
    included_in_plans: [],
    feature_key: '',
    sort_order: 100,
  }
}

function FilterChip({ active, onClick, count, children }: { active: boolean; onClick: () => void; count: number; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded px-3 py-1 text-xs font-medium transition-colors',
        active ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200',
      )}
    >
      {children}
      <span className={cn('rounded px-1 tabular-nums text-[10px]', active ? 'bg-zinc-700 text-zinc-100' : 'bg-zinc-800 text-zinc-500')}>{count}</span>
    </button>
  )
}

function StatusSwitcher({ current, moduleId }: { current: ModuleStatus; moduleId: string }) {
  const [status, setStatusState] = useState<ModuleStatus>(current)
  const [isPending, startTransition] = useTransition()
  const handleChange = (next: ModuleStatus) => {
    if (next === status) return
    setStatusState(next)
    startTransition(async () => {
      await setModuleStatus(moduleId, next)
    })
  }
  return (
    <div className="flex items-center gap-2">
      <select
        value={status}
        onChange={(e) => handleChange(e.target.value as ModuleStatus)}
        disabled={isPending}
        className={cn(
          'cursor-pointer rounded-md border px-2 py-0.5 text-xs font-medium outline-none transition-colors',
          STATUS_STYLES[status].cls,
        )}
      >
        {(Object.keys(STATUS_STYLES) as ModuleStatus[]).map(s => (
          <option key={s} value={s} className="bg-zinc-900 text-zinc-100">
            {STATUS_STYLES[s].label}
          </option>
        ))}
      </select>
      {isPending && <Loader2 className="size-3 animate-spin text-zinc-500" />}
    </div>
  )
}

// ============================================================
// Editor
// ============================================================

function ModuleEditor({
  module,
  isNew,
  planIds,
  onClose,
}: {
  module: ModuleRow
  isNew: boolean
  planIds: string[]
  onClose: () => void
}) {
  const [form, setForm] = useState<ModuleInput>({ ...module })
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const togglePlan = (planId: string) => {
    setForm(f => {
      const has = f.included_in_plans.includes(planId)
      return {
        ...f,
        included_in_plans: has ? f.included_in_plans.filter(p => p !== planId) : [...f.included_in_plans, planId],
      }
    })
  }

  const handleSave = () => {
    setError(null)
    startTransition(async () => {
      const res = await upsertModule(form)
      if ('error' in res) { setError(res.error ?? 'Error desconocido'); return }
      onClose()
      window.location.reload()
    })
  }

  const handleDelete = () => {
    if (!confirm(`¿Eliminar el módulo ${form.name}?`)) return
    startTransition(async () => {
      const res = await deleteModule(form.id)
      if ('error' in res) { setError(res.error ?? 'Error desconocido'); return }
      onClose()
      window.location.reload()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative ml-auto flex h-full w-full max-w-xl flex-col bg-zinc-950 shadow-2xl">
        <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">{isNew ? 'Nuevo módulo' : `Editando ${module.name}`}</h2>
            <p className="text-xs text-zinc-500">Los cambios aplican en caliente en el sidebar y /pricing.</p>
          </div>
          <button onClick={onClose} className="flex size-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100">
            <X className="size-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Identificación */}
          <Section title="Identificación">
            <Field label="ID" help="snake_case. No editable después de crear.">
              <input
                disabled={!isNew}
                value={form.id}
                onChange={(e) => setForm(f => ({ ...f, id: e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, '') }))}
                placeholder="ej: messaging_whatsapp"
                className={inputCls}
              />
            </Field>
            <Field label="Nombre">
              <input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} className={inputCls} />
            </Field>
            <Field label="Descripción">
              <textarea rows={2} value={form.description ?? ''} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} className={inputCls} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Icon (Lucide)">
                <input value={form.icon ?? ''} onChange={(e) => setForm(f => ({ ...f, icon: e.target.value }))} placeholder="ej: MessageSquare" className={inputCls} />
              </Field>
              <Field label="Categoría">
                <input value={form.category ?? ''} onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))} placeholder="ej: messaging" className={inputCls} />
              </Field>
            </div>
            <Field label="Feature key" help="Clave que plans.features referencia para desbloquear esta feature.">
              <input
                value={form.feature_key}
                onChange={(e) => setForm(f => ({ ...f, feature_key: e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, '') }))}
                placeholder="ej: messaging.whatsapp"
                className={inputCls}
              />
            </Field>
          </Section>

          {/* Status */}
          <Section title="Visibilidad">
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(STATUS_STYLES) as ModuleStatus[]).map(s => (
                <label
                  key={s}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm transition-colors',
                    form.status === s ? STATUS_STYLES[s].cls : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200',
                  )}
                >
                  <input
                    type="radio"
                    name="status"
                    checked={form.status === s}
                    onChange={() => setForm(f => ({ ...f, status: s }))}
                    className="sr-only"
                  />
                  <span>{STATUS_STYLES[s].label}</span>
                </label>
              ))}
            </div>
            {form.status === 'coming_soon' && (
              <>
                <Field label="Teaser (modal coming_soon)">
                  <textarea rows={2} value={form.teaser_copy ?? ''} onChange={(e) => setForm(f => ({ ...f, teaser_copy: e.target.value }))} className={inputCls} />
                </Field>
                <Field label="Fecha estimada (YYYY-MM-DD)">
                  <input
                    type="date"
                    value={form.estimated_release ?? ''}
                    onChange={(e) => setForm(f => ({ ...f, estimated_release: e.target.value || null }))}
                    className={inputCls}
                  />
                </Field>
              </>
            )}
          </Section>

          {/* Planes */}
          <Section title="Incluido en planes">
            <div className="grid grid-cols-2 gap-2">
              {planIds.map(p => (
                <label key={p} className="flex cursor-pointer items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.included_in_plans.includes(p)}
                    onChange={() => togglePlan(p)}
                    className="size-4 rounded border-zinc-700 bg-zinc-900 text-indigo-500 focus:ring-indigo-500"
                  />
                  <span className="capitalize">{p.replace('_', ' ')}</span>
                </label>
              ))}
            </div>
          </Section>

          {/* Add-on pricing */}
          <Section title="Add-on (opcional)">
            <Field label="Precio mensual ARS (centavos)" help="null/0 = no es vendible como add-on independiente">
              <input
                type="number"
                value={form.price_ars_addon ?? ''}
                onChange={(e) => setForm(f => ({ ...f, price_ars_addon: e.target.value === '' ? null : Number(e.target.value) }))}
                placeholder="ej: 1490000 = AR$ 14.900"
                className={inputCls}
              />
            </Field>
            <Field label="Orden de aparición">
              <input type="number" value={form.sort_order} onChange={(e) => setForm(f => ({ ...f, sort_order: Number(e.target.value) }))} className={inputCls} />
            </Field>
          </Section>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-zinc-800 px-6 py-4">
          <div className="flex-1">{error && <p className="text-xs text-rose-400">{error}</p>}</div>
          {!isNew && (
            <button onClick={handleDelete} disabled={isPending} className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-1.5 text-sm font-medium text-rose-400 hover:bg-rose-500/10">
              <Trash2 className="size-4" /> Eliminar
            </button>
          )}
          <button onClick={onClose} className="rounded-md border border-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-300 hover:bg-zinc-900">Cancelar</button>
          <button
            onClick={handleSave}
            disabled={isPending || !form.id || !form.name || !form.feature_key}
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
