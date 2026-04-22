'use client'

import { useState, useTransition } from 'react'
import { Bell, ChevronDown, Check, Loader2, Mail } from 'lucide-react'
import { cn } from '@/lib/utils'
import { notifyWaitlistForModule } from '@/lib/actions/platform-billing'

type WaitlistItem = {
  id: string
  email: string | null
  notified_at: string | null
  created_at: string
  organizations: { name?: string; slug?: string } | null
}

type Group = {
  moduleId: string
  moduleName: string
  status: string
  items: WaitlistItem[]
  totalPending: number
  totalNotified: number
}

export function WaitlistGrouped({ groups }: { groups: Group[] }) {
  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 p-10 text-center">
        <Bell className="mx-auto mb-3 size-8 text-zinc-600" />
        <p className="text-sm text-zinc-400">Sin registros en waitlist todavía.</p>
        <p className="mt-1 text-xs text-zinc-500">
          Cuando un usuario se anote en un módulo <code className="rounded bg-zinc-800 px-1">coming_soon</code>, aparecerá acá.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {groups.map(g => <WaitlistGroupCard key={g.moduleId} group={g} />)}
    </div>
  )
}

function WaitlistGroupCard({ group }: { group: Group }) {
  const [expanded, setExpanded] = useState(group.totalPending > 0)
  const [isPending, startTransition] = useTransition()
  const [notified, setNotified] = useState(false)

  const handleNotify = () => {
    if (!confirm(`Marcar los ${group.totalPending} pendientes de "${group.moduleName}" como notificados?`)) return
    startTransition(async () => {
      const res = await notifyWaitlistForModule(group.moduleId)
      if ('ok' in res) {
        setNotified(true)
        setTimeout(() => window.location.reload(), 600)
      }
    })
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50">
      <button
        onClick={() => setExpanded(x => !x)}
        className="flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-zinc-900/80"
      >
        <ChevronDown className={cn('size-4 shrink-0 transition-transform text-zinc-500', expanded && 'rotate-180')} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{group.moduleName}</span>
            <StatusPill status={group.status} />
          </div>
          <div className="font-mono text-xs text-zinc-500">{group.moduleId}</div>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <div>
            <div className="tabular-nums font-semibold text-amber-300">{group.totalPending}</div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">pendientes</div>
          </div>
          <div>
            <div className="tabular-nums font-semibold text-emerald-300">{group.totalNotified}</div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">notificados</div>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-zinc-800">
          <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/80 px-5 py-2">
            <div className="text-xs text-zinc-400">
              {group.items.length} registro{group.items.length !== 1 ? 's' : ''}
            </div>
            {group.totalPending > 0 && !notified && (
              <button
                onClick={handleNotify}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600/20 px-3 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-600/30 disabled:opacity-50"
              >
                {isPending ? <Loader2 className="size-3 animate-spin" /> : <Bell className="size-3" />}
                Marcar todos notificados
              </button>
            )}
            {notified && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                <Check className="size-3" /> Marcados
              </span>
            )}
          </div>
          <ul className="divide-y divide-zinc-800">
            {group.items.map(item => (
              <li key={item.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                <Mail className="size-4 shrink-0 text-zinc-500" />
                <div className="min-w-0 flex-1">
                  <div className="truncate">
                    {item.organizations?.name ?? 'Org eliminada'}
                    {item.email && <span className="ml-2 text-zinc-500">· {item.email}</span>}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {new Date(item.created_at).toLocaleDateString('es-AR', { year: 'numeric', month: 'short', day: 'numeric' })}
                  </div>
                </div>
                {item.notified_at ? (
                  <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                    <Check className="size-3" /> notificado
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                    pendiente
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-emerald-500/10 text-emerald-300',
    beta: 'bg-blue-500/10 text-blue-300',
    coming_soon: 'bg-amber-500/10 text-amber-300',
    hidden: 'bg-zinc-800 text-zinc-400',
  }
  return (
    <span className={cn('inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider', colors[status] ?? 'bg-zinc-800 text-zinc-400')}>
      {status.replace('_', ' ')}
    </span>
  )
}
