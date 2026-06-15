'use client'

import { Plus, MessageSquare, Trash2, Settings } from 'lucide-react'
import Link from 'next/link'
import type { AssistantThread } from '@/lib/actions/asistente'

export function ThreadSidebar({
  threads,
  activeId,
  onSelect,
  onNew,
  onDelete,
}: {
  threads: AssistantThread[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="p-2">
        <button
          onClick={onNew}
          className="flex w-full items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
        >
          <Plus className="size-4" /> Nueva conversación
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {threads.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">Todavía no hay conversaciones.</p>
        ) : (
          <ul className="space-y-0.5">
            {threads.map((t) => (
              <li key={t.id}>
                <div
                  className={`group flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                    activeId === t.id ? 'bg-accent' : 'hover:bg-accent/50'
                  }`}
                >
                  <button onClick={() => onSelect(t.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{t.title || 'Conversación'}</span>
                  </button>
                  <button
                    onClick={() => onDelete(t.id)}
                    className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                    title="Eliminar"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-border p-2">
        <Link
          href="/dashboard/asistente/configuracion"
          className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Settings className="size-4" /> Configurar copiloto
        </Link>
      </div>
    </div>
  )
}
