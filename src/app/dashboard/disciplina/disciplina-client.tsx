'use client'

import { useState, useTransition } from 'react'
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
import { AlertTriangle, Plus, Trash2, Pencil, Clock, UserX } from 'lucide-react'
import { toast } from 'sonner'

interface BarberBasic {
  id: string
  full_name: string
  branch_id: string | null
}

interface EventWithStaff extends Omit<DisciplinaryEvent, 'staff'> {
  staff?: { id: string; full_name: string; branch_id: string | null } | null
}

interface Props {
  branches: Branch[]
  rules: DisciplinaryRule[]
  barbers: BarberBasic[]
  events: EventWithStaff[]
  fromDate: string
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

export function DisciplinaClient({ branches, rules, barbers, events, fromDate }: Props) {
  const [selectedBranchId, setSelectedBranchId] = useState(branches[0]?.id ?? '')
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

  const branchRules = rules.filter((r) => r.branch_id === selectedBranchId)
  const branchBarbers = barbers.filter((b) => b.branch_id === selectedBranchId)
  const branchEvents = events.filter((e) => {
    const staff = e.staff as { branch_id: string | null } | null
    return staff?.branch_id === selectedBranchId
  })

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

      <Tabs defaultValue="eventos">
        <TabsList>
          <TabsTrigger value="eventos">Eventos del mes</TabsTrigger>
          <TabsTrigger value="resumen">Resumen por barbero</TabsTrigger>
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
