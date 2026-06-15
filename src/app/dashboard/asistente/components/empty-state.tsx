'use client'

import { Bot } from 'lucide-react'
import { SUGGESTED_GROUPS } from './types'

export function EmptyState({ firstName, onPick }: { firstName?: string | null; onPick: (p: string) => void }) {
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center px-4 py-10 text-center">
      <div className="animate-scale-in flex size-14 items-center justify-center rounded-2xl border border-border bg-card">
        <Bot className="size-7 text-foreground/80" />
      </div>
      <h1 className="animate-fade-up mt-4 text-xl font-bold tracking-tight lg:text-2xl">
        {firstName ? `¿En qué te ayudo, ${firstName}?` : '¿En qué te ayudo hoy?'}
      </h1>
      <p className="animate-fade-up mt-1 text-sm text-muted-foreground" style={{ animationDelay: '60ms' }}>
        Preguntame sobre tus números, tu equipo o tus clientes.
      </p>

      <div className="mt-7 grid w-full gap-3 sm:grid-cols-2">
        {SUGGESTED_GROUPS.map((g, gi) => {
          const Icon = g.icon
          return (
            <div
              key={g.theme}
              className="animate-fade-up rounded-2xl border border-border bg-card/50 p-3 text-left"
              style={{ animationDelay: `${100 + gi * 60}ms` }}
            >
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <Icon className="size-3.5" /> {g.theme}
              </div>
              <div className="space-y-1.5">
                {g.prompts.map((p) => (
                  <button
                    key={p}
                    onClick={() => onPick(p)}
                    className="block w-full rounded-lg px-2 py-1.5 text-left text-[13px] text-foreground/90 transition-colors hover:bg-accent active:scale-[0.99]"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
