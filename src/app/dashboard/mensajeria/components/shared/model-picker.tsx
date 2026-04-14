'use client'

import { useMemo, useRef, useState, useEffect } from 'react'
import { Check, ChevronDown, Search, Sparkles, ExternalLink } from 'lucide-react'

export interface ModelOption {
  id: string
  label: string
  hint?: string
  free?: boolean
}

export interface ModelGroup {
  provider: 'OpenAI' | 'Anthropic' | 'OpenRouter'
  color: string // tailwind text color
  models: ModelOption[]
}

export const MODEL_GROUPS: ModelGroup[] = [
  {
    provider: 'OpenAI',
    color: 'text-emerald-400',
    models: [
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini', hint: 'Rápido · Barato' },
      { id: 'gpt-4o', label: 'GPT-4o', hint: 'Multimodal' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
      { id: 'gpt-4.1', label: 'GPT-4.1' },
    ],
  },
  {
    provider: 'Anthropic',
    color: 'text-orange-400',
    models: [
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', hint: 'Rápido' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', hint: 'Potente' },
    ],
  },
  {
    provider: 'OpenRouter',
    color: 'text-cyan-400',
    models: [
      { id: 'openrouter/auto', label: 'OpenRouter Auto', hint: 'Elige el mejor' },
      { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B', free: true },
      { id: 'meta-llama/llama-4-maverick:free', label: 'Llama 4 Maverick', free: true },
      { id: 'deepseek/deepseek-chat-v3-0324:free', label: 'DeepSeek V3', free: true },
      { id: 'google/gemini-2.5-pro-exp-03-25:free', label: 'Gemini 2.5 Pro', free: true },
      { id: 'mistralai/mistral-small-3.1-24b-instruct:free', label: 'Mistral Small 3.1', free: true },
    ],
  },
]

function getProvider(id: string): ModelGroup['provider'] {
  if (id.startsWith('claude')) return 'Anthropic'
  if (id.startsWith('gpt') || id.startsWith('o1') || id.startsWith('o3')) return 'OpenAI'
  return 'OpenRouter'
}

function findKnown(id: string) {
  for (const g of MODEL_GROUPS) {
    const m = g.models.find(x => x.id === id)
    if (m) return { group: g, model: m }
  }
  return null
}

export function ModelPicker({
  value,
  onChange,
  compact,
}: {
  value: string
  onChange: (id: string) => void
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 20) }, [open])

  const known = findKnown(value)
  const customProvider = known ? known.group.provider : getProvider(value)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return MODEL_GROUPS
    return MODEL_GROUPS
      .map(g => ({ ...g, models: g.models.filter(m => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q)) }))
      .filter(g => g.models.length > 0)
  }, [query])

  const showCustomRow = query.includes('/') && !filtered.some(g => g.models.some(m => m.id === query.trim()))

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center justify-between gap-2 rounded-lg bg-muted border px-3 ${compact ? 'py-2 text-sm' : 'py-2.5 text-sm'} text-foreground hover:bg-accent/60 transition-colors outline-none focus:ring-1 focus:ring-ring`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-[10px] font-semibold uppercase tracking-wider shrink-0 ${known?.group.color ?? 'text-cyan-400'}`}>
            {customProvider}
          </span>
          <span className="truncate font-mono text-[12px]">{known?.model.label ?? value ?? 'Elegí un modelo'}</span>
          {known?.model.free && <span className="text-[9px] font-medium bg-cyan-500/15 text-cyan-300 px-1.5 py-0.5 rounded">FREE</span>}
        </div>
        <ChevronDown className={`size-4 text-muted-foreground shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          className="absolute z-50 left-0 right-0 mt-1.5 rounded-xl border bg-popover shadow-xl overflow-hidden animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-150"
        >
          <div className="flex items-center gap-2 border-b border px-3 py-2">
            <Search className="size-3.5 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Buscar o pegá un model ID (ej: google/gemma-2-9b-it:free)"
              className="flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
              onKeyDown={e => {
                if (e.key === 'Enter' && query.trim()) {
                  onChange(query.trim()); setQuery(''); setOpen(false)
                }
              }}
            />
          </div>

          <div className="max-h-72 overflow-y-auto py-1">
            {filtered.map(group => (
              <div key={group.provider} className="px-1">
                <div className={`flex items-center gap-1.5 px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider ${group.color}`}>
                  <Sparkles className="size-3" /> {group.provider}
                </div>
                {group.models.map(m => {
                  const selected = m.id === value
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => { onChange(m.id); setOpen(false); setQuery('') }}
                      className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${selected ? 'bg-accent' : 'hover:bg-accent/50'}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-foreground truncate">{m.label}</span>
                          {m.free && <span className="text-[9px] bg-cyan-500/15 text-cyan-300 px-1 py-px rounded">FREE</span>}
                          {m.hint && <span className="text-[10px] text-muted-foreground">· {m.hint}</span>}
                        </div>
                        <p className="text-[10px] text-muted-foreground font-mono truncate">{m.id}</p>
                      </div>
                      {selected && <Check className="size-3.5 text-emerald-400 shrink-0" />}
                    </button>
                  )
                })}
              </div>
            ))}

            {showCustomRow && (
              <button
                type="button"
                onClick={() => { onChange(query.trim()); setOpen(false); setQuery('') }}
                className="w-full flex items-center gap-2 rounded-md mx-1 my-1 px-2 py-2 text-left bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 transition-colors"
              >
                <Sparkles className="size-3.5 text-cyan-300 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-cyan-200">Usar como modelo custom de OpenRouter</p>
                  <p className="text-[10px] text-cyan-300/70 font-mono truncate">{query.trim()}</p>
                </div>
              </button>
            )}

            {filtered.length === 0 && !showCustomRow && (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                Sin resultados. Pegá un model ID con <code className="text-cyan-400">/</code> para usar uno custom.
              </div>
            )}
          </div>

          <a
            href="https://openrouter.ai/models"
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-1.5 border-t border px-3 py-2 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Ver catálogo completo de OpenRouter <ExternalLink className="size-2.5" />
          </a>
        </div>
      )}
    </div>
  )
}
