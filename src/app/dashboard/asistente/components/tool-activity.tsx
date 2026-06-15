'use client'

import { Check, Loader2 } from 'lucide-react'
import { toolMetaFor } from './types'

export interface ToolActivity {
  id: string
  name: string
  done: boolean
}

/** Rail de chips animados que muestran qué herramientas se están ejecutando. */
export function ToolActivityRail({ tools }: { tools: ToolActivity[] }) {
  if (tools.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5 mb-2">
      {tools.map((t, i) => {
        const meta = toolMetaFor(t.name)
        const Icon = meta.icon
        return (
          <div
            key={t.id}
            className="asst-tool-chip animate-msg-in inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-muted-foreground"
            style={{ animationDelay: `${i * 50}ms` }}
          >
            {t.done ? (
              <Check className="size-3 text-emerald-400" />
            ) : (
              <Loader2 className="size-3 animate-spin text-foreground/70" />
            )}
            <Icon className="size-3 opacity-70" />
            <span className={t.done ? 'opacity-70' : ''}>{t.done ? meta.label : meta.running}</span>
          </div>
        )
      })}
    </div>
  )
}

/** Resumen colapsado: "Usé Finanzas, Reseñas". */
export function ToolSummary({ names }: { names: string[] }) {
  if (names.length === 0) return null
  const labels = Array.from(new Set(names.map((n) => toolMetaFor(n).label)))
  return (
    <div className="mb-1.5 text-[11px] text-muted-foreground/70">
      Usé: {labels.join(' · ')}
    </div>
  )
}
