'use client'

import { useMemo } from 'react'
import {
  Inbox,
  Sparkles,
  MessageCircle,
  ShieldOff,
  Plus,
  Trash2,
  Info,
} from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

/** Modo de disparo para trigger `message_received`. */
export type MessageReceivedMode = 'every_message' | 'first_text_welcome' | 'first_any_inbound'

export type MessageReceivedTriggerState = {
  mode: MessageReceivedMode
  suppressEnabled: boolean
  /** Reglas: categoría del otro workflow → horas mínimas sin ejecutar este */
  suppressRules: { category: string; hours: number }[]
}

const DEFAULT_SUPPRESS_RULE = (): { category: string; hours: number } => ({
  category: 'review',
  hours: 12,
})

export function parseMessageReceivedTriggerState(
  tc: Record<string, unknown> | null | undefined
): MessageReceivedTriggerState {
  const only = tc?.only_first_inbound === true
  const plain = tc?.only_first_inbound_plain_text !== false
  const raw = tc?.suppress_if_category_within_hours as Record<string, number> | undefined
  const rules: { category: string; hours: number }[] = []
  if (raw && typeof raw === 'object') {
    for (const [category, hours] of Object.entries(raw)) {
      if (typeof hours === 'number' && hours > 0 && category.trim()) {
        rules.push({ category: category.trim().toLowerCase(), hours })
      }
    }
  }
  let mode: MessageReceivedMode = 'every_message'
  if (only) {
    mode = plain ? 'first_text_welcome' : 'first_any_inbound'
  }
  return {
    mode,
    suppressEnabled: rules.length > 0,
    suppressRules: rules.length > 0 ? rules : [DEFAULT_SUPPRESS_RULE()],
  }
}

export function serializeMessageReceivedTriggerState(
  s: MessageReceivedTriggerState
): Record<string, unknown> {
  const cfg: Record<string, unknown> = {}
  if (s.mode === 'first_text_welcome') {
    cfg.only_first_inbound = true
  } else if (s.mode === 'first_any_inbound') {
    cfg.only_first_inbound = true
    cfg.only_first_inbound_plain_text = false
  }
  if (s.suppressEnabled) {
    const map: Record<string, number> = {}
    for (const r of s.suppressRules) {
      const c = r.category.trim().toLowerCase()
      const h = Math.min(168, Math.max(0, Math.floor(Number(r.hours)) || 0))
      if (c && h > 0) map[c] = h
    }
    if (Object.keys(map).length > 0) cfg.suppress_if_category_within_hours = map
  }
  return cfg
}

/** Badges cortos para la lista de workflows */
export function messageReceivedTriggerSummary(tc: Record<string, unknown> | undefined): string[] {
  const s = parseMessageReceivedTriggerState(tc)
  const badges: string[] = []
  if (s.mode === 'every_message') badges.push('Cada mensaje')
  else if (s.mode === 'first_text_welcome') badges.push('Solo 1.er texto')
  else badges.push('Solo 1.er mensaje')
  if (s.suppressEnabled) {
    const raw = serializeMessageReceivedTriggerState(s).suppress_if_category_within_hours as
      | Record<string, number>
      | undefined
    if (raw) {
      for (const [cat, h] of Object.entries(raw)) {
        badges.push(`Silencio ${cat} ${h}h`)
      }
    }
  }
  return badges
}

const MODE_OPTIONS: {
  value: MessageReceivedMode
  title: string
  description: string
  icon: typeof Inbox
}[] = [
  {
    value: 'every_message',
    title: 'Cada mensaje entrante',
    description:
      'Se evalúa en todos los mensajes. Otros triggers más específicos (palabra clave, template) tienen prioridad.',
    icon: Inbox,
  },
  {
    value: 'first_text_welcome',
    title: 'Bienvenida (1.er texto libre)',
    description:
      'Solo la primera vez que el cliente escribe texto. No cuenta botones ni respuestas a plantillas (ej. reseña).',
    icon: Sparkles,
  },
  {
    value: 'first_any_inbound',
    title: 'Solo el primer mensaje (cualquier tipo)',
    description:
      'Incluye el primer sticker, audio o botón. Usalo solo si necesitás ese comportamiento.',
    icon: MessageCircle,
  },
]

const CATEGORY_PRESETS = [
  { value: 'review', label: 'Reseñas / post-servicio' },
  { value: 'promo', label: 'Campañas' },
  { value: 'support', label: 'Soporte' },
]

type Props = {
  value: MessageReceivedTriggerState
  onChange: (next: MessageReceivedTriggerState) => void
  /** Variante compacta para el panel lateral del lienzo */
  variant?: 'dialog' | 'panel'
}

export function MessageReceivedTriggerConfig({ value, onChange, variant = 'dialog' }: Props) {
  const summary = useMemo(() => buildHumanSummary(value), [value])

  const setMode = (mode: MessageReceivedMode) => {
    onChange({ ...value, mode })
  }

  const setSuppressEnabled = (enabled: boolean) => {
    let rules = value.suppressRules
    if (enabled && rules.length === 0) rules = [DEFAULT_SUPPRESS_RULE()]
    onChange({ ...value, suppressEnabled: enabled, suppressRules: rules })
  }

  const updateRule = (index: number, patch: Partial<{ category: string; hours: number }>) => {
    const rules = value.suppressRules.map((r, i) => (i === index ? { ...r, ...patch } : r))
    onChange({ ...value, suppressRules: rules })
  }

  const addRule = () => {
    onChange({
      ...value,
      suppressEnabled: true,
      suppressRules: [...value.suppressRules, { category: 'review', hours: 12 }],
    })
  }

  const removeRule = (index: number) => {
    const rules = value.suppressRules.filter((_, i) => i !== index)
    if (rules.length === 0) {
      onChange({ ...value, suppressEnabled: false, suppressRules: [DEFAULT_SUPPRESS_RULE()] })
    } else {
      onChange({ ...value, suppressRules: rules })
    }
  }

  return (
    <div
      className={cn(
        'rounded-xl border bg-gradient-to-b from-muted/40 to-muted/10 overflow-hidden',
        variant === 'dialog' ? 'border-amber-500/20 shadow-sm' : 'border-border'
      )}
    >
      <div className={cn('space-y-4', variant === 'dialog' ? 'p-4' : 'p-3')}>
        <div className="flex items-start gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 border border-amber-500/25">
            <Inbox className="size-4 text-amber-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Cuándo se ejecuta</p>
            <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
              Definí si es un mensaje genérico, una bienvenida al primer texto, o el primer evento de cualquier tipo.
            </p>
          </div>
        </div>

        <div className="grid gap-2">
          {MODE_OPTIONS.map(opt => {
            const Icon = opt.icon
            const selected = value.mode === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setMode(opt.value)}
                className={cn(
                  'flex gap-3 rounded-lg border p-3 text-left transition-all',
                  selected
                    ? 'border-amber-500/50 bg-amber-500/[0.07] ring-1 ring-amber-500/30'
                    : 'border-border/80 bg-background/50 hover:border-foreground/15 hover:bg-muted/30'
                )}
              >
                <Icon
                  className={cn('size-5 shrink-0 mt-0.5', selected ? 'text-amber-400' : 'text-muted-foreground')}
                />
                <div className="min-w-0">
                  <p className={cn('text-sm font-medium', selected ? 'text-foreground' : 'text-foreground/90')}>
                    {opt.title}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{opt.description}</p>
                </div>
              </button>
            )
          })}
        </div>

        <Separator className="bg-border/60" />

        <div className="space-y-3">
          <div className="flex items-start gap-2">
            <ShieldOff className="size-4 text-sky-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-sm font-medium text-foreground">Silencio tras otros flujos</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    No ejecutar este workflow si en la misma conversación ya corrió otro con la categoría indicada,
                    dentro del plazo.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Label htmlFor="suppress-switch" className="text-xs text-muted-foreground cursor-pointer">
                    {value.suppressEnabled ? 'Activado' : 'Desactivado'}
                  </Label>
                  <Switch
                    id="suppress-switch"
                    checked={value.suppressEnabled}
                    onCheckedChange={setSuppressEnabled}
                  />
                </div>
              </div>

              {value.suppressEnabled && (
                <div className="mt-3 space-y-2">
                  {value.suppressRules.map((rule, index) => (
                    <div
                      key={`rule-${index}`}
                      className="flex flex-wrap items-end gap-2 rounded-lg border border-border/80 bg-muted/20 p-2.5"
                    >
                      <div className="flex-1 min-w-[140px] space-y-1.5">
                        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                          Categoría del otro workflow
                        </Label>
                        <div className="flex flex-wrap gap-1">
                          {CATEGORY_PRESETS.map(p => (
                            <button
                              key={p.value}
                              type="button"
                              onClick={() => updateRule(index, { category: p.value })}
                              className={cn(
                                'text-[10px] px-2 py-1 rounded-full border transition-colors',
                                rule.category === p.value
                                  ? 'bg-amber-500/20 border-amber-500/40 text-amber-200'
                                  : 'bg-muted/50 border-border/60 text-muted-foreground hover:border-foreground/20'
                              )}
                            >
                              {p.value}
                            </button>
                          ))}
                        </div>
                        <Input
                          className="h-8 text-xs bg-background border"
                          placeholder="Escribí la categoría exacta (minúsculas)"
                          value={rule.category}
                          onChange={e => updateRule(index, { category: e.target.value })}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={1}
                          max={168}
                          className="w-16 h-8 text-xs tabular-nums"
                          value={rule.hours}
                          onChange={e =>
                            updateRule(index, { hours: Math.min(168, Math.max(1, parseInt(e.target.value, 10) || 1)) })
                          }
                        />
                        <span className="text-[11px] text-muted-foreground whitespace-nowrap">horas</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground hover:text-red-400"
                          onClick={() => removeRule(index)}
                          title="Quitar regla"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  <Button type="button" variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={addRule}>
                    <Plus className="size-3.5" />
                    Añadir otra categoría
                  </Button>
                  <div className="flex gap-2 rounded-md bg-sky-500/10 border border-sky-500/20 px-3 py-2 text-[11px] text-sky-200/90 leading-relaxed">
                    <Info className="size-3.5 shrink-0 mt-0.5 text-sky-400" />
                    <span>
                      Asigná la misma categoría en el otro workflow (sección <strong className="text-foreground/90">Convivencia</strong> →
                      categoría). Ej.: flujos de reseña con <code className="text-amber-300/90">review</code>.
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-lg bg-foreground/[0.04] border border-border/60 px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Resumen</p>
          <p className="text-xs text-foreground/90 leading-relaxed">{summary}</p>
        </div>
      </div>
    </div>
  )
}

function buildHumanSummary(s: MessageReceivedTriggerState): string {
  let when: string
  if (s.mode === 'every_message') {
    when = 'Se evalúa en cada mensaje entrante (los triggers más específicos van primero).'
  } else if (s.mode === 'first_text_welcome') {
    when =
      'Solo cuando es el primer mensaje de texto libre del cliente en la conversación (no botones ni plantillas interactivas).'
  } else {
    when = 'Solo en el primer mensaje entrante de cualquier tipo (texto, media o botón).'
  }
  if (!s.suppressEnabled) return when + ' No hay ventana de silencio por otros flujos.'
  const map = serializeMessageReceivedTriggerState(s).suppress_if_category_within_hours as Record<string, number> | undefined
  if (!map || Object.keys(map).length === 0) {
    return when + ' Silencio activado: agregá al menos una categoría con horas válidas.'
  }
  const parts = Object.entries(map).map(([c, h]) => `«${c}» en las últimas ${h} h`)
  return `${when} No se ejecuta si hubo un workflow con categoría ${parts.join(' o ')} en esta conversación.`
}
