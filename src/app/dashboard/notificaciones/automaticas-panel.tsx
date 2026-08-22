'use client'

// Pestaña Automáticas: lo que el sistema manda solo (recordatorios de turno,
// turno cancelado por la barbería, premio nuevo). Edita `push_settings`.

import { useRef, useState, useTransition } from 'react'
import { AlertTriangle, CalendarClock, Gift, Loader2, Plus, Save, X, XCircle, Info } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { savePushSettings, type PushSettingsData } from '@/lib/actions/push-notifications'
import {
  PUSH_BODY_MAX, PUSH_REMINDER_MAX_HOURS, PUSH_REMINDER_MAX_ITEMS, PUSH_TITLE_MAX, PUSH_VARIABLES, renderPlantilla,
} from '@/lib/push/constants'
import { NotificationPreview } from './notification-preview'
import { fmtRelativo } from './helpers'

interface Props {
  initial: PushSettingsData
  error: string | null
  canManage: boolean
  org: { name: string; logoUrl: string | null }
}

type Campo = 'reminder_title' | 'reminder_body_24h' | 'reminder_body_2h' | 'appointment_cancelled_body' | 'reward_body'

const HORAS_RAPIDAS = [48, 24, 12, 2, 1]

function etiquetaHoras(h: number): string {
  if (h % 24 === 0) return h === 24 ? '1 día antes' : `${h / 24} días antes`
  return `${h} h antes`
}

export function AutomaticasPanel({ initial, error, canManage, org }: Props) {
  const [form, setForm] = useState<PushSettingsData>(initial)
  const [guardado, setGuardado] = useState<PushSettingsData>(initial)
  const [horaCustom, setHoraCustom] = useState('')
  const [campoActivo, setCampoActivo] = useState<Campo>('reminder_body_24h')
  const refs = useRef<Partial<Record<Campo, HTMLInputElement | HTMLTextAreaElement | null>>>({})
  const [isSaving, startSaving] = useTransition()

  const dirty = JSON.stringify(form) !== JSON.stringify(guardado)
  const set = <K extends keyof PushSettingsData>(k: K, v: PushSettingsData[K]) => setForm(f => ({ ...f, [k]: v }))

  const insertarVariable = (key: string) => {
    const el = refs.current[campoActivo]
    const actual = form[campoActivo] as string
    if (!el) { set(campoActivo, (actual + key) as never); return }
    const start = el.selectionStart ?? actual.length
    const end = el.selectionEnd ?? actual.length
    const next = actual.slice(0, start) + key + actual.slice(end)
    set(campoActivo, next as never)
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + key.length
      el.setSelectionRange(pos, pos)
    })
  }

  const toggleHora = (h: number) => {
    const tiene = form.reminder_hours.includes(h)
    if (tiene) set('reminder_hours', form.reminder_hours.filter(x => x !== h))
    else {
      if (form.reminder_hours.length >= PUSH_REMINDER_MAX_ITEMS) { toast.error(`Máximo ${PUSH_REMINDER_MAX_ITEMS} recordatorios por turno`); return }
      set('reminder_hours', [...form.reminder_hours, h].sort((a, b) => b - a))
    }
  }

  const agregarCustom = () => {
    const n = parseInt(horaCustom, 10)
    if (!Number.isFinite(n) || n < 1 || n > PUSH_REMINDER_MAX_HOURS) {
      toast.error(`Ingresá un número de horas entre 1 y ${PUSH_REMINDER_MAX_HOURS}`)
      return
    }
    if (!form.reminder_hours.includes(n)) toggleHora(n)
    setHoraCustom('')
  }

  const handleSave = () => {
    startSaving(async () => {
      const r = await savePushSettings({
        reminders_enabled: form.reminders_enabled,
        reminder_hours: form.reminder_hours,
        reminder_title: form.reminder_title,
        reminder_body_24h: form.reminder_body_24h,
        reminder_body_2h: form.reminder_body_2h,
        appointment_cancelled_enabled: form.appointment_cancelled_enabled,
        appointment_cancelled_body: form.appointment_cancelled_body,
        rewards_enabled: form.rewards_enabled,
        reward_body: form.reward_body,
      })
      // El éxito trae `error: null`, así que se discrimina por valor, no por presencia de la clave.
      if (r.error !== null) { toast.error(r.error, { duration: 7000 }); return }
      setForm(r.data)
      setGuardado(r.data)
      toast.success('Notificaciones automáticas guardadas')
    })
  }

  const campoTexto = (campo: Campo, label: string, opts?: { rows?: number; max?: number; hint?: string; esTitulo?: boolean }) => {
    const max = opts?.max ?? PUSH_BODY_MAX
    const valor = form[campo] as string
    const Comp = opts?.esTitulo ? Input : Textarea
    return (
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor={`auto-${campo}`}>{label}</Label>
          <span className={`tabular-nums text-[11px] ${valor.length > max ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}>{valor.length}/{max}</span>
        </div>
        <Comp
          id={`auto-${campo}`}
          ref={(el: HTMLInputElement | HTMLTextAreaElement | null) => { refs.current[campo] = el }}
          rows={opts?.rows ?? 3}
          value={valor}
          disabled={!canManage}
          onFocus={() => setCampoActivo(campo)}
          onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(campo, e.target.value as never)}
          aria-invalid={valor.length > max || valor.trim().length === 0}
        />
        {opts?.hint && <p className="text-[11px] text-muted-foreground">{opts.hint}</p>}
        {!opts?.esTitulo && (
          <p className="rounded-md bg-muted/60 px-2.5 py-1.5 text-[12px] text-muted-foreground">
            <span className="mr-1 text-[10px] uppercase tracking-wider">Ejemplo:</span>
            {renderPlantilla(valor) || '—'}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-card p-4">
        <div className="flex gap-3">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="text-sm">
            <p className="font-medium">Estas notificaciones salen solas, por push, a los clientes con la app.</p>
            <p className="mt-0.5 text-muted-foreground">
              Cada cliente puede apagarlas por tipo desde la app. Los recordatorios por WhatsApp se configuran aparte, en Turnos → Configuración.
              {guardado.updated_at && <> · Última edición {fmtRelativo(guardado.updated_at)}.</>}
            </p>
          </div>
        </div>
        {canManage && (
          <Button onClick={handleSave} disabled={!dirty || isSaving}>
            {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {dirty ? 'Guardar cambios' : 'Sin cambios'}
          </Button>
        )}
      </div>

      {/* Variables */}
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Variables</p>
        <p className="mt-1 text-[12px] text-muted-foreground">Tocá una para insertarla en el campo que estés editando. Se reemplazan por el dato real de cada turno o cliente.</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {PUSH_VARIABLES.map(v => (
            <button key={v.key} type="button" disabled={!canManage} onClick={() => insertarVariable(v.key)}
              title={`${v.label} · ej.: ${v.ejemplo}`}
              className="rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-1 font-mono text-[11px] text-violet-700 transition-colors hover:bg-violet-500/20 disabled:opacity-50 dark:text-violet-300">
              {v.key} <span className="text-violet-500/80">= {v.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-5">
          {/* Recordatorios */}
          <section className="rounded-xl border border-border bg-card">
            <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <CalendarClock className="size-4 text-sky-500" />
                <div>
                  <p className="text-sm font-semibold">Recordatorios de turno</p>
                  <p className="text-[11px] text-muted-foreground">Antes de cada turno confirmado</p>
                </div>
              </div>
              <Switch checked={form.reminders_enabled} disabled={!canManage} onCheckedChange={v => set('reminders_enabled', v)} aria-label="Activar recordatorios de turno" />
            </header>
            <div className={`space-y-4 p-4 ${form.reminders_enabled ? '' : 'opacity-60'}`}>
              <div className="grid gap-2">
                <Label>Cuándo avisar</Label>
                <div className="flex flex-wrap items-center gap-2">
                  {Array.from(new Set([...HORAS_RAPIDAS, ...form.reminder_hours])).sort((a, b) => b - a).map(h => {
                    const activa = form.reminder_hours.includes(h)
                    return (
                      <button key={h} type="button" disabled={!canManage} onClick={() => toggleHora(h)} aria-pressed={activa}
                        className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                          activa ? 'border-transparent bg-sky-600 text-white' : 'border-border text-muted-foreground hover:text-foreground'
                        }`}>
                        {etiquetaHoras(h)}
                        {activa && <X className="size-3" />}
                      </button>
                    )
                  })}
                  <div className="flex items-center gap-1">
                    <Input type="number" min={1} max={PUSH_REMINDER_MAX_HOURS} placeholder="Otra (h)" className="h-8 w-24 text-xs"
                      value={horaCustom} disabled={!canManage} onChange={e => setHoraCustom(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); agregarCustom() } }} />
                    <Button type="button" size="icon-sm" variant="outline" disabled={!canManage || !horaCustom} onClick={agregarCustom} aria-label="Agregar anticipación">
                      <Plus className="size-4" />
                    </Button>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {form.reminder_hours.length === 0
                    ? 'Sin anticipaciones elegidas: con los recordatorios activos hay que elegir al menos una.'
                    : `Se manda ${form.reminder_hours.map(etiquetaHoras).join(' y ')}. El texto de 24 h se usa para avisos de un día o más; el de 2 h, para los del mismo día.`}
                </p>
              </div>
              {campoTexto('reminder_title', 'Título', { esTitulo: true, max: PUSH_TITLE_MAX })}
              {campoTexto('reminder_body_24h', 'Texto para el aviso del día anterior (24 h o más)')}
              {campoTexto('reminder_body_2h', 'Texto para el aviso del mismo día (menos de 24 h)')}
            </div>
          </section>

          {/* Cancelación */}
          <section className="rounded-xl border border-border bg-card">
            <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <XCircle className="size-4 text-rose-500" />
                <div>
                  <p className="text-sm font-semibold">Turno cancelado por la barbería</p>
                  <p className="text-[11px] text-muted-foreground">Cuando el equipo o el sistema cancela un turno (no cuando lo cancela el cliente)</p>
                </div>
              </div>
              <Switch checked={form.appointment_cancelled_enabled} disabled={!canManage} onCheckedChange={v => set('appointment_cancelled_enabled', v)} aria-label="Activar aviso de cancelación" />
            </header>
            <div className={`p-4 ${form.appointment_cancelled_enabled ? '' : 'opacity-60'}`}>
              {campoTexto('appointment_cancelled_body', 'Texto')}
            </div>
          </section>

          {/* Premios */}
          <section className="rounded-xl border border-border bg-card">
            <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <Gift className="size-4 text-amber-500" />
                <div>
                  <p className="text-sm font-semibold">Premio nuevo disponible</p>
                  <p className="text-[11px] text-muted-foreground">Cuando el cliente alcanza un premio del programa de puntos</p>
                </div>
              </div>
              <Switch checked={form.rewards_enabled} disabled={!canManage} onCheckedChange={v => set('rewards_enabled', v)} aria-label="Activar aviso de premio nuevo" />
            </header>
            <div className={`p-4 ${form.rewards_enabled ? '' : 'opacity-60'}`}>
              {campoTexto('reward_body', 'Texto')}
            </div>
          </section>
        </div>

        <aside className="space-y-3 lg:sticky lg:top-5 lg:self-start">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Vista previa</p>
          <NotificationPreview
            appName={org.name}
            logoUrl={org.logoUrl}
            title={campoActivo === 'appointment_cancelled_body' ? 'Turno cancelado' : campoActivo === 'reward_body' ? 'Tenés un premio' : renderPlantilla(form.reminder_title)}
            body={renderPlantilla(campoActivo === 'reminder_title' ? form.reminder_body_24h : (form[campoActivo] as string))}
          />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Muestra el campo que estás editando con datos de ejemplo.
          </p>
        </aside>
      </div>
    </div>
  )
}
