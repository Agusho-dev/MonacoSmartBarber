'use client'

import { useState, useTransition, useEffect } from 'react'
import { upsertDisciplinaryRule, deleteDisciplinaryRule, createDisciplinaryEvent } from '@/lib/actions/disciplinary'
import { formatCurrency } from '@/lib/format'
import type { Branch, DisciplinaryRule, DisciplinaryEvent, DisciplinaryEventType, ConsequenceType } from '@/lib/types/database'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AlertTriangle, Plus, Trash2, Pencil, Clock, UserX, Coffee } from 'lucide-react'
import { toast } from 'sonner'
import { useBranchStore } from '@/stores/branch-store'

interface BarberBasic {
  id: string
  full_name: string
  branch_id: string | null
}

interface EventWithStaff extends Omit<DisciplinaryEvent, 'staff'> {
  staff?: { id: string; full_name: string; branch_id: string | null } | null
}

interface ActiveBreakEntry {
  id: string
  barber_id: string | null
  branch_id: string | null
  started_at: string | null
  barber?: { id: string; full_name: string; branch_id: string | null } | null
  break_request?: {
    id: string
    branch_id: string
    break_config?: { name: string; duration_minutes: number } | null
  } | null
}

interface BreakOvertimeRecord {
  id: string
  staff_id: string
  branch_id: string
  actual_started_at: string | null
  actual_completed_at: string | null
  overtime_seconds: number | null
  staff?: { id: string; full_name: string; branch_id: string | null } | null
  break_config?: { name: string; duration_minutes: number } | null
}

type OvertimeFilter = 'day' | 'week' | 'month'

interface Props {
  branches: Branch[]
  rules: DisciplinaryRule[]
  barbers: BarberBasic[]
  events: EventWithStaff[]
  fromDate: string
  activeBreakEntries?: ActiveBreakEntry[]
  breakOvertimeHistory?: BreakOvertimeRecord[]
  selectedBranchId?: string
  onBranchChange?: (id: string) => void
}

const EVENT_LABELS: Record<DisciplinaryEventType, string> = {
  absence: 'Falta',
  late: 'Tardanza',
}

const CONSEQUENCE_LABELS: Record<ConsequenceType, string> = {
  none: 'Sin consecuencia',
  presentismo_loss: 'Pérdida de presentismo',
  warning: 'Apercibimiento',
  incentive_loss: 'Pérdida de incentivo',
  salary_deduction: 'Descuento de sueldo',
}

export function DisciplinaClient({
  branches,
  rules,
  barbers,
  events,
  fromDate,
  activeBreakEntries = [],
  breakOvertimeHistory = [],
  selectedBranchId: selectedBranchIdProp,
  onBranchChange,
}: Props) {
  const { selectedBranchId: storeBranchId, setSelectedBranchId: setStoreBranchId } = useBranchStore()
  const selectedBranchId = selectedBranchIdProp ?? storeBranchId ?? (branches[0]?.id ?? '')
  const setSelectedBranchId = onBranchChange ?? setStoreBranchId
  const [overtimeFilter, setOvertimeFilter] = useState<OvertimeFilter>('week')
  const [now, setNow] = useState(Date.now())
  const [ruleDialog, setRuleDialog] = useState(false)
  const [ruleForm, setRuleForm] = useState({
    id: '', event_type: 'absence' as DisciplinaryEventType,
    occurrence_number: '1', consequence: 'none' as ConsequenceType,
    deduction_amount: '', description: '',
  })
  const [eventDialog, setEventDialog] = useState(false)
  const [eventForm, setEventForm] = useState({
    staff_id: '', event_type: 'absence' as DisciplinaryEventType,
    event_date: new Date().toISOString().slice(0, 10), notes: '',
  })
  const [, startTransition] = useTransition()

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  const branchRules = rules.filter((r) => r.branch_id === selectedBranchId)
  const branchBarbers = barbers.filter((b) => b.branch_id === selectedBranchId)
  const branchEvents = events.filter((e) => {
    const staff = e.staff as { branch_id: string | null } | null
    return staff?.branch_id === selectedBranchId
  })

  // Compute currently overdue breaks for the selected branch
  const overdueBreaks = activeBreakEntries
    .filter((entry) => {
      const entryBranchId = entry.branch_id ?? entry.break_request?.branch_id ?? entry.barber?.branch_id
      return entryBranchId === selectedBranchId && entry.started_at
    })
    .map((entry) => {
      const durationMs = (entry.break_request?.break_config?.duration_minutes ?? 0) * 60_000
      const elapsedMs = now - new Date(entry.started_at!).getTime()
      const overdueMs = elapsedMs - durationMs
      return { entry, overdueMs }
    })
    .filter(({ overdueMs }) => overdueMs > 0)

  function formatOverdue(ms: number) {
    const totalSeconds = Math.floor(ms / 1000)
    const m = Math.floor(totalSeconds / 60)
    const s = totalSeconds % 60
    return `${m}m ${s}s`
  }

  function formatOvertimeSeconds(seconds: number) {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return m > 0 ? `${m}m ${s}s` : `${s}s`
  }

  // Filter overtime history by branch and time period
  const overtimeCutoff = (() => {
    const d = new Date()
    if (overtimeFilter === 'day') { d.setHours(0, 0, 0, 0); return d }
    if (overtimeFilter === 'week') { d.setDate(d.getDate() - 7); return d }
    d.setDate(d.getDate() - 30)
    return d
  })()

  const filteredOvertimeHistory = breakOvertimeHistory.filter((r) => {
    const staffBranchId = (r.staff as { branch_id?: string | null } | null)?.branch_id ?? r.branch_id
    if (staffBranchId !== selectedBranchId) return false
    if (!r.actual_completed_at) return false
    return new Date(r.actual_completed_at) >= overtimeCutoff
  })

  // Per-barber summary for overtime
  const overtimeSummary = (() => {
    const map = new Map<string, { barber: BreakOvertimeRecord['staff']; count: number; totalSeconds: number }>()
    for (const r of filteredOvertimeHistory) {
      const key = r.staff_id
      const existing = map.get(key)
      if (existing) {
        existing.count += 1
        existing.totalSeconds += r.overtime_seconds ?? 0
      } else {
        map.set(key, { barber: r.staff, count: 1, totalSeconds: r.overtime_seconds ?? 0 })
      }
    }
    return Array.from(map.values()).sort((a, b) => b.totalSeconds - a.totalSeconds)
  })()

  const barberSummary = branchBarbers.map((b) => {
    const barberEvents = branchEvents.filter((e) => e.staff_id === b.id)
    return {
      ...b,
      absences: barberEvents.filter((e) => e.event_type === 'absence').length,
      lates: barberEvents.filter((e) => e.event_type === 'late').length,
    }
  })

  function openCreateRule() {
    setRuleForm({ id: '', event_type: 'absence', occurrence_number: '1', consequence: 'none', deduction_amount: '', description: '' })
    setRuleDialog(true)
  }

  function openEditRule(rule: DisciplinaryRule) {
    setRuleForm({
      id: rule.id,
      event_type: rule.event_type,
      occurrence_number: String(rule.occurrence_number),
      consequence: rule.consequence,
      deduction_amount: String(rule.deduction_amount ?? ''),
      description: rule.description ?? '',
    })
    setRuleDialog(true)
  }

  function handleRuleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const r = await upsertDisciplinaryRule(
        selectedBranchId,
        ruleForm.event_type,
        parseInt(ruleForm.occurrence_number),
        ruleForm.consequence,
        ruleForm.deduction_amount ? parseFloat(ruleForm.deduction_amount) : null,
        ruleForm.description || null
      )
      if (r.error) toast.error(r.error)
      else { toast.success('Regla guardada'); setRuleDialog(false) }
    })
  }

  function handleDeleteRule(id: string) {
    startTransition(async () => {
      const r = await deleteDisciplinaryRule(id)
      if (r.error) toast.error(r.error)
      else toast.success('Regla eliminada')
    })
  }

  function handleEventSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const r = await createDisciplinaryEvent(
        eventForm.staff_id,
        selectedBranchId,
        eventForm.event_type,
        eventForm.event_date,
        eventForm.notes || null,
        null
      )
      if (r.error) toast.error(r.error)
      else {
        const msg = r.consequence && r.consequence !== 'none'
          ? `Registrado (ocurrencia ${r.occurrenceNumber}) — Consecuencia: ${CONSEQUENCE_LABELS[r.consequence as ConsequenceType]}`
          : `Registrado (ocurrencia ${r.occurrenceNumber})`
        toast.success(msg)
        setEventDialog(false)
      }
    })
  }

  const absenceRules = branchRules.filter((r) => r.event_type === 'absence')
  const lateRules = branchRules.filter((r) => r.event_type === 'late')

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Faltas y Tardanzas</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configurá las reglas disciplinarias y registrá eventos por barbero.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Sucursal" />
            </SelectTrigger>
            <SelectContent>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => { setEventForm({ staff_id: '', event_type: 'absence', event_date: new Date().toISOString().slice(0, 10), notes: '' }); setEventDialog(true) }}>
            <Plus className="size-4 mr-2" />
            Registrar evento
          </Button>
        </div>
      </div>

      {/* Overdue breaks section — only shown when there are active overruns */}
      {overdueBreaks.length > 0 && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Coffee className="size-5 text-red-500 shrink-0" />
            <h2 className="font-semibold text-red-500">Tiempos de descanso excedidos</h2>
            <Badge variant="outline" className="ml-auto border-red-500/30 text-red-500 text-xs">
              {overdueBreaks.length} {overdueBreaks.length === 1 ? 'barbero' : 'barberos'}
            </Badge>
          </div>
          <div className="divide-y divide-red-500/10 rounded-lg border border-red-500/20 bg-background">
            {overdueBreaks.map(({ entry, overdueMs }) => (
              <div key={entry.id} className="flex items-center gap-4 px-4 py-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-500 font-semibold text-sm">
                  {(entry.barber?.full_name ?? 'B').charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{entry.barber?.full_name ?? 'Barbero'}</p>
                  <p className="text-xs text-muted-foreground">
                    {entry.break_request?.break_config?.name ?? 'Descanso'}
                    {entry.break_request?.break_config?.duration_minutes
                      ? ` · ${entry.break_request.break_config.duration_minutes} min estipulados`
                      : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Clock className="size-4 text-red-500" />
                  <span className="text-sm font-bold tabular-nums text-red-500">
                    +{formatOverdue(overdueMs)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Tabs defaultValue="eventos">
        <TabsList>
          <TabsTrigger value="eventos">Eventos del mes</TabsTrigger>
          <TabsTrigger value="resumen">Resumen por barbero</TabsTrigger>
          <TabsTrigger value="descansos" className="flex items-center gap-1.5">
            <Coffee className="size-3.5" />
            Descansos excedidos
            {filteredOvertimeHistory.length > 0 && (
              <Badge variant="secondary" className="ml-1 px-1.5 text-xs bg-red-500/15 text-red-500">
                {filteredOvertimeHistory.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="reglas">Reglas disciplinarias</TabsTrigger>
        </TabsList>

        {/* Eventos del mes */}
        <TabsContent value="eventos" className="mt-4">
          <p className="text-xs text-muted-foreground mb-3">
            Desde {new Date(fromDate + 'T12:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
          {branchEvents.length === 0 ? (
            <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
              No hay eventos registrados este mes.
            </div>
          ) : (
            <div className="divide-y rounded-xl border bg-card">
              {branchEvents.map((evt) => (
                <div key={evt.id} className="flex items-center gap-4 px-5 py-4">
                  {evt.event_type === 'absence'
                    ? <UserX className="size-5 text-red-500 shrink-0" />
                    : <Clock className="size-5 text-yellow-500 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{(evt.staff as { full_name: string } | null)?.full_name ?? 'Barbero'}</p>
                    <p className="text-sm text-muted-foreground">
                      {EVENT_LABELS[evt.event_type]} · Ocurrencia #{evt.occurrence_number} ·{' '}
                      {new Date(evt.event_date + 'T12:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}
                    </p>
                    {evt.notes && <p className="text-xs text-muted-foreground">{evt.notes}</p>}
                  </div>
                  {evt.consequence_applied && evt.consequence_applied !== 'none' && (
                    <Badge
                      variant="outline"
                      className={evt.consequence_applied === 'salary_deduction'
                        ? 'text-xs border-red-500/30 text-red-500'
                        : 'text-xs border-yellow-500/30 text-yellow-500'}
                    >
                      {CONSEQUENCE_LABELS[evt.consequence_applied]}
                      {evt.deduction_amount ? ` (${formatCurrency(evt.deduction_amount)})` : ''}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Resumen por barbero */}
        <TabsContent value="resumen" className="mt-4">
          {barberSummary.length === 0 ? (
            <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground">Sin barberos.</div>
          ) : (
            <div className="divide-y rounded-xl border bg-card">
              {barberSummary.map((b) => (
                <div key={b.id} className="flex items-center gap-4 px-5 py-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-sm">
                    {b.full_name.charAt(0)}
                  </div>
                  <div className="flex-1 font-medium">{b.full_name}</div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="flex items-center gap-1.5 text-sm">
                      <UserX className="size-4 text-red-500" />
                      <span className={b.absences > 0 ? 'text-red-500 font-semibold' : 'text-muted-foreground'}>
                        {b.absences} {b.absences === 1 ? 'falta' : 'faltas'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-sm">
                      <Clock className="size-4 text-yellow-500" />
                      <span className={b.lates > 0 ? 'text-yellow-500 font-semibold' : 'text-muted-foreground'}>
                        {b.lates} tardanza{b.lates !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Descansos excedidos */}
        <TabsContent value="descansos" className="mt-4 space-y-4">
          {/* Period filter */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Ver:</span>
            <div className="flex rounded-lg border bg-muted/50 p-0.5 gap-0.5">
              {(['day', 'week', 'month'] as OvertimeFilter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setOvertimeFilter(f)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${overtimeFilter === f ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {f === 'day' ? 'Hoy' : f === 'week' ? 'Última semana' : 'Último mes'}
                </button>
              ))}
            </div>
          </div>

          {filteredOvertimeHistory.length === 0 ? (
            <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
              <Coffee className="size-8 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Sin tiempos de descanso excedidos en este período.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Per-barber summary */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Resumen por barbero
                </p>
                <div className="divide-y rounded-xl border bg-card">
                  {overtimeSummary.map(({ barber, count, totalSeconds }) => (
                    <div key={(barber as { id?: string } | null)?.id ?? 'unknown'} className="flex items-center gap-4 px-5 py-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-500 font-semibold text-sm">
                        {((barber as { full_name?: string } | null)?.full_name ?? 'B').charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium">{(barber as { full_name?: string } | null)?.full_name ?? 'Barbero'}</p>
                        <p className="text-xs text-muted-foreground">
                          {count} {count === 1 ? 'vez excedido' : 'veces excedido'}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 text-sm font-bold text-red-500 shrink-0">
                        <Clock className="size-4" />
                        +{formatOvertimeSeconds(totalSeconds)} total
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Detailed history */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Detalle de registros
                </p>
                <div className="divide-y rounded-xl border bg-card">
                  {filteredOvertimeHistory.map((r) => (
                    <div key={r.id} className="flex items-center gap-4 px-5 py-4">
                      <Coffee className="size-4 text-red-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium">
                          {(r.staff as { full_name?: string } | null)?.full_name ?? 'Barbero'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {(r.break_config as { name?: string } | null)?.name ?? 'Descanso'}
                          {(r.break_config as { duration_minutes?: number } | null)?.duration_minutes
                            ? ` · ${(r.break_config as { duration_minutes: number }).duration_minutes} min estipulados`
                            : ''}
                          {r.actual_completed_at
                            ? ` · ${new Date(r.actual_completed_at).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })} ${new Date(r.actual_completed_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`
                            : ''}
                        </p>
                      </div>
                      <Badge variant="outline" className="border-red-500/30 text-red-500 font-bold tabular-nums shrink-0">
                        +{formatOvertimeSeconds(r.overtime_seconds ?? 0)}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </TabsContent>

        {/* Reglas */}
        <TabsContent value="reglas" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button onClick={openCreateRule} variant="outline">
              <Plus className="size-4 mr-2" />
              Nueva regla
            </Button>
          </div>

          {(['absence', 'late'] as DisciplinaryEventType[]).map((type) => {
            const typeRules = type === 'absence' ? absenceRules : lateRules
            return (
              <div key={type}>
                <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  {type === 'absence' ? 'Faltas' : 'Tardanzas'}
                </p>
                {typeRules.length === 0 ? (
                  <div className="rounded-xl border bg-card p-5 text-center text-sm text-muted-foreground">
                    Sin reglas configuradas para {EVENT_LABELS[type].toLowerCase()}s.
                  </div>
                ) : (
                  <div className="divide-y rounded-xl border bg-card">
                    {typeRules.map((rule) => (
                      <div key={rule.id} className="flex items-center gap-4 px-5 py-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm">
                            Ocurrencia #{rule.occurrence_number}
                            {' → '}
                            <span className="font-medium">{CONSEQUENCE_LABELS[rule.consequence]}</span>
                            {rule.deduction_amount && ` (${formatCurrency(rule.deduction_amount)})`}
                          </p>
                          {rule.description && <p className="text-xs text-muted-foreground">{rule.description}</p>}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button variant="ghost" size="icon" onClick={() => openEditRule(rule)}>
                            <Pencil className="size-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                                <Trash2 className="size-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>¿Eliminar regla?</AlertDialogTitle>
                                <AlertDialogDescription>Los eventos ya registrados no se verán afectados.</AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={() => handleDeleteRule(rule.id)}>Eliminar</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </TabsContent>
      </Tabs>

      {/* Rule dialog */}
      <Dialog open={ruleDialog} onOpenChange={setRuleDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{ruleForm.id ? 'Editar regla' : 'Nueva regla disciplinaria'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRuleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Tipo de evento</Label>
                <Select value={ruleForm.event_type} onValueChange={(v) => setRuleForm((f) => ({ ...f, event_type: v as DisciplinaryEventType }))}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="absence">Falta</SelectItem>
                    <SelectItem value="late">Tardanza</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Número de ocurrencia</Label>
                <Input type="number" min="1" className="mt-1.5" value={ruleForm.occurrence_number} onChange={(e) => setRuleForm((f) => ({ ...f, occurrence_number: e.target.value }))} required />
              </div>
            </div>
            <div>
              <Label>Consecuencia</Label>
              <Select value={ruleForm.consequence} onValueChange={(v) => setRuleForm((f) => ({ ...f, consequence: v as ConsequenceType }))}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(CONSEQUENCE_LABELS) as ConsequenceType[]).map((c) => (
                    <SelectItem key={c} value={c}>{CONSEQUENCE_LABELS[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {ruleForm.consequence === 'salary_deduction' && (
              <div>
                <Label>Monto a descontar</Label>
                <Input type="number" min="0" className="mt-1.5" value={ruleForm.deduction_amount} onChange={(e) => setRuleForm((f) => ({ ...f, deduction_amount: e.target.value }))} />
              </div>
            )}
            <div>
              <Label>Descripción <span className="text-muted-foreground">(opcional)</span></Label>
              <Textarea className="mt-1.5 resize-none" rows={2} value={ruleForm.description} onChange={(e) => setRuleForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRuleDialog(false)}>Cancelar</Button>
              <Button type="submit">Guardar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Event dialog */}
      <Dialog open={eventDialog} onOpenChange={setEventDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar evento disciplinario</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEventSubmit} className="space-y-4">
            <div>
              <Label>Barbero</Label>
              <Select value={eventForm.staff_id} onValueChange={(v) => setEventForm((f) => ({ ...f, staff_id: v }))}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder="Seleccionar barbero" /></SelectTrigger>
                <SelectContent>
                  {branchBarbers.map((b) => <SelectItem key={b.id} value={b.id}>{b.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Tipo</Label>
                <Select value={eventForm.event_type} onValueChange={(v) => setEventForm((f) => ({ ...f, event_type: v as DisciplinaryEventType }))}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="absence">Falta</SelectItem>
                    <SelectItem value="late">Tardanza</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Fecha</Label>
                <Input type="date" className="mt-1.5" value={eventForm.event_date} onChange={(e) => setEventForm((f) => ({ ...f, event_date: e.target.value }))} required />
              </div>
            </div>
            <div>
              <Label>Notas <span className="text-muted-foreground">(opcional)</span></Label>
              <Textarea className="mt-1.5 resize-none" rows={2} value={eventForm.notes} onChange={(e) => setEventForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEventDialog(false)}>Cancelar</Button>
              <Button type="submit" disabled={!eventForm.staff_id || !eventForm.event_date}>Registrar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
