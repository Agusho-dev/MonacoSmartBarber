'use client'

// =============================================================================
// Notificaciones: una tarjeta por regla (12) con interruptor, título y cuerpo
// editables, chips de variables que se insertan en el campo activo y la vista
// previa tipo iPhone a la derecha, con valores de ejemplo.
// =============================================================================

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Save } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { NotificationPreview } from '@/app/dashboard/notificaciones/notification-preview'
import { saveNotificationRule } from '@/lib/actions/loyalty'
import type { LoyaltyNotificationKind, LoyaltyNotificationRule } from '@/lib/types/loyalty'
import { ejemploPara, renderPlantilla, RULE_META } from './helpers'

interface Props {
  rules: LoyaltyNotificationRule[]
  canManage: boolean
  org: { name: string; logoUrl: string | null }
  /** Ventana de "por vencer" de Puntos: es lo que usa el cron si `days_before` queda vacío en Puntos por vencer. */
  expiringSoonDays: number
  onChange: (rules: LoyaltyNotificationRule[]) => void
}

/** Qué pasa si "Días de anticipación" queda vacío (mig 203: el cron hace COALESCE con estos defaults). */
function hintDias(kind: LoyaltyNotificationKind, expiringSoonDays: number): string {
  if (kind === 'points_expiring') return `Vacío = la ventana de "por vencer" de Puntos (hoy ${expiringSoonDays} días).`
  if (kind === 'tier_grace_reminder') return 'Vacío = 3 días antes de que termine la gracia.'
  return ''
}

type Campo = 'title' | 'body'
interface Activo { kind: LoyaltyNotificationKind; campo: Campo }

const GRUPOS: { id: 'categoria' | 'puntos' | 'referidos'; label: string }[] = [
  { id: 'categoria', label: 'Categoría' },
  { id: 'puntos', label: 'Puntos y premios' },
  { id: 'referidos', label: 'Referidos' },
]

export function NotificacionesTab({ rules, canManage, org, expiringSoonDays, onChange }: Props) {
  const router = useRouter()
  const [forms, setForms] = useState<Record<string, { title: string; body: string; days_before: string }>>(() =>
    Object.fromEntries(rules.map(r => [r.kind, { title: r.title, body: r.body, days_before: r.days_before != null ? String(r.days_before) : '' }])),
  )
  const [activo, setActivo] = useState<Activo>({ kind: rules[0]?.kind ?? 'tier_up', campo: 'body' })
  const [guardando, setGuardando] = useState<string | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const refs = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement | null>>({})

  const ordenadas = [...rules].sort((a, b) => a.sort_order - b.sort_order)
  const regla = rules.find(r => r.kind === activo.kind) ?? rules[0]
  const formActivo = regla ? forms[regla.kind] : undefined

  function esDirty(r: LoyaltyNotificationRule): boolean {
    const f = forms[r.kind]
    if (!f) return false
    return f.title !== r.title || f.body !== r.body || f.days_before !== (r.days_before != null ? String(r.days_before) : '')
  }

  function setCampo(kind: string, campo: 'title' | 'body' | 'days_before', v: string) {
    setForms(fs => ({ ...fs, [kind]: { ...fs[kind], [campo]: v } }))
  }

  function insertarVariable(v: string) {
    const key = `${activo.kind}:${activo.campo}`
    const el = refs.current[key]
    const token = `{{${v}}}`
    const actual = forms[activo.kind]?.[activo.campo] ?? ''
    if (!el) { setCampo(activo.kind, activo.campo, actual + token); return }
    const start = el.selectionStart ?? actual.length
    const end = el.selectionEnd ?? actual.length
    const nuevo = actual.slice(0, start) + token + actual.slice(end)
    setCampo(activo.kind, activo.campo, nuevo)
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + token.length
      el.setSelectionRange(pos, pos)
    })
  }

  async function alternar(r: LoyaltyNotificationRule, v: boolean) {
    setToggling(r.kind)
    onChange(rules.map(x => (x.kind === r.kind ? { ...x, is_enabled: v } : x)))
    const res = await saveNotificationRule(r.kind, { is_enabled: v })
    setToggling(null)
    if ('error' in res) {
      onChange(rules.map(x => (x.kind === r.kind ? { ...x, is_enabled: !v } : x)))
      toast.error(res.error)
      return
    }
    toast.success(v ? `${RULE_META[r.kind].label}: activada` : `${RULE_META[r.kind].label}: apagada`)
  }

  function guardar(r: LoyaltyNotificationRule) {
    const f = forms[r.kind]
    if (!f) return
    setGuardando(r.kind)
    startTransition(async () => {
      const res = await saveNotificationRule(r.kind, {
        title: f.title, body: f.body,
        days_before: RULE_META[r.kind].usaDias ? (f.days_before === '' ? null : Math.max(0, parseInt(f.days_before, 10) || 0)) : undefined,
      })
      setGuardando(null)
      if ('error' in res) { toast.error(res.error); return }
      onChange(rules.map(x => (x.kind === r.kind ? res.data : x)))
      toast.success(`${RULE_META[r.kind].label} guardada`)
      router.refresh()
    })
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        <div>
          <h3 className="text-base font-semibold tracking-tight">Qué le decimos al cliente y cuándo</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Llegan como push y quedan en la bandeja de la app. Tocá un campo y usá las variables para armar el texto; la vista previa muestra el que estás editando.
          </p>
        </div>

        {GRUPOS.map(g => {
          const del = ordenadas.filter(r => RULE_META[r.kind]?.grupo === g.id)
          if (!del.length) return null
          return (
            <section key={g.id} className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{g.label}</h4>
              {del.map(r => {
                const meta = RULE_META[r.kind]
                const f = forms[r.kind]
                const dirty = esDirty(r)
                const esActiva = activo.kind === r.kind
                return (
                  <article
                    key={r.kind}
                    className={cn('rounded-2xl border bg-zinc-900/40 transition-colors', esActiva ? 'border-white/[0.16]' : 'border-white/[0.06]', !r.is_enabled && 'opacity-70')}
                    onFocusCapture={() => setActivo(a => (a.kind === r.kind ? a : { kind: r.kind, campo: 'body' }))}
                  >
                    <header className="flex items-start justify-between gap-3 border-b border-white/[0.05] px-4 py-3">
                      <div>
                        <p className="text-sm font-semibold">{meta.label}</p>
                        <p className="text-[11px] text-muted-foreground">{meta.descripcion}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {toggling === r.kind && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
                        <Switch checked={r.is_enabled} disabled={!canManage || toggling === r.kind} onCheckedChange={v => alternar(r, v)} aria-label={`Activar ${meta.label}`} />
                      </div>
                    </header>
                    <div className="space-y-3 p-4">
                      <div className="space-y-1">
                        <div className="flex items-baseline justify-between">
                          <Label htmlFor={`t-${r.kind}`} className="text-xs">Título</Label>
                          <span className="text-[10px] text-muted-foreground tabular-nums">{f.title.length}/65</span>
                        </div>
                        <Input
                          id={`t-${r.kind}`}
                          ref={el => { refs.current[`${r.kind}:title`] = el }}
                          value={f.title}
                          maxLength={65}
                          disabled={!canManage}
                          onFocus={() => setActivo({ kind: r.kind, campo: 'title' })}
                          onChange={e => setCampo(r.kind, 'title', e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-baseline justify-between">
                          <Label htmlFor={`b-${r.kind}`} className="text-xs">Texto</Label>
                          <span className="text-[10px] text-muted-foreground tabular-nums">{f.body.length}/240</span>
                        </div>
                        <Textarea
                          id={`b-${r.kind}`}
                          ref={el => { refs.current[`${r.kind}:body`] = el }}
                          rows={2}
                          value={f.body}
                          maxLength={240}
                          disabled={!canManage}
                          onFocus={() => setActivo({ kind: r.kind, campo: 'body' })}
                          onChange={e => setCampo(r.kind, 'body', e.target.value)}
                          className="min-h-[60px] text-sm"
                        />
                      </div>
                      {esActiva && canManage && (
                        <div className="flex flex-wrap gap-1">
                          {meta.variables.map(v => (
                            <button
                              key={v}
                              type="button"
                              onMouseDown={e => e.preventDefault()}
                              onClick={() => insertarVariable(v)}
                              className="rounded-full border border-white/10 px-2 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-white/30 hover:text-foreground"
                            >
                              {`{{${v}}}`}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="flex flex-wrap items-end justify-between gap-3">
                        {meta.usaDias ? (
                          <div className="w-64 space-y-1">
                            <Label htmlFor={`d-${r.kind}`} className="text-xs">Días de anticipación</Label>
                            <Input id={`d-${r.kind}`} type="number" min={0} max={90} value={f.days_before} disabled={!canManage} onChange={e => setCampo(r.kind, 'days_before', e.target.value)} className="h-8 w-40 tabular-nums" />
                            <p className="text-[10px] leading-snug text-muted-foreground">{hintDias(r.kind, expiringSoonDays)}</p>
                          </div>
                        ) : <span />}
                        {canManage && (
                          <Button size="sm" variant={dirty ? 'default' : 'outline'} disabled={!dirty || guardando === r.kind} onClick={() => guardar(r)}>
                            {guardando === r.kind ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                            Guardar
                          </Button>
                        )}
                      </div>
                    </div>
                  </article>
                )
              })}
            </section>
          )
        })}
      </div>

      <aside className="space-y-3 lg:sticky lg:top-16 lg:self-start">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Vista previa</p>
        <NotificationPreview
          appName={org.name}
          logoUrl={org.logoUrl}
          title={renderPlantilla(formActivo?.title ?? '', regla ? ejemploPara(regla.kind) : {})}
          body={renderPlantilla(formActivo?.body ?? '', regla ? ejemploPara(regla.kind) : {})}
        />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {regla ? RULE_META[regla.kind].label : ''} con datos de ejemplo. Los chips muestran sólo las variables que esta regla recibe: cualquier otra se ve vacía acá, igual que en el envío.
        </p>
      </aside>
    </div>
  )
}
