'use client'

import { useState, useTransition, useRef } from 'react'
import { saveScheduleBlocks, deleteSchedule, upsertException, deleteException, copyScheduleToAllInBranch } from '@/lib/actions/calendar'
import type { ScheduleBlock } from '@/lib/actions/calendar'
import type { Branch, StaffSchedule, StaffScheduleException } from '@/lib/types/database'
import { useBranchStore } from '@/stores/branch-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Plus, X, AlertTriangle, Trash2, Copy, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const DAYS_FULL = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

interface BarberWithSchedules {
  id: string
  full_name: string
  branch_id: string | null
  staff_schedules: StaffSchedule[]
  staff_schedule_exceptions: StaffScheduleException[]
}

interface Props {
  branches: Branch[]
  barbers: BarberWithSchedules[]
}

export function CalendarioClient({ branches, barbers }: Props) {
  const { selectedBranchId: storeBranchId } = useBranchStore()
  const effectiveBranchId = storeBranchId ?? branches[0]?.id ?? ''
  const [selectedBarberId, setSelectedBarberId] = useState<string | null>(null)

  // Resetear barbero seleccionado cuando cambia la sucursal (sin useEffect → evita
  // setState-in-effect lint y cascading renders).
  const lastBranchRef = useRef(effectiveBranchId)
  if (lastBranchRef.current !== effectiveBranchId) {
    lastBranchRef.current = effectiveBranchId
    if (selectedBarberId !== null) {
      setSelectedBarberId(null)
    }
  }
  const [exceptionDialog, setExceptionDialog] = useState(false)
  const [exceptionForm, setExceptionForm] = useState({ date: '', is_absent: true, reason: '' })
  const [scheduleDialog, setScheduleDialog] = useState<{ dayOfWeek: number } | null>(null)
  const [scheduleBlocks, setScheduleBlocks] = useState<ScheduleBlock[]>([])
  const [copyDialog, setCopyDialog] = useState(false)
  const [copying, setCopying] = useState(false)
  const [, startTransition] = useTransition()

  const branchBarbers = barbers.filter((b) => b.branch_id === effectiveBranchId)
  const selectedBarber = branchBarbers.find((b) => b.id === selectedBarberId) ?? branchBarbers[0] ?? null

  const today = new Date().toISOString().slice(0, 10)

  function getSchedulesForDay(dayOfWeek: number): StaffSchedule[] {
    return (selectedBarber?.staff_schedules ?? [])
      .filter((s) => s.day_of_week === dayOfWeek && s.is_active)
      .sort((a, b) => (a.block_index ?? 0) - (b.block_index ?? 0))
  }

  function handleDayToggle(dayOfWeek: number, currentlyActive: boolean) {
    if (!selectedBarber) return
    if (currentlyActive) {
      startTransition(async () => {
        const r = await deleteSchedule(selectedBarber.id, dayOfWeek)
        if (r.error) toast.error(r.error)
      })
    } else {
      setScheduleBlocks([{ start_time: '09:00', end_time: '18:00' }])
      setScheduleDialog({ dayOfWeek })
    }
  }

  function openEditDialog(dayOfWeek: number) {
    const existing = getSchedulesForDay(dayOfWeek)
    if (existing.length > 0) {
      setScheduleBlocks(existing.map((s) => ({ start_time: s.start_time, end_time: s.end_time })))
    } else {
      setScheduleBlocks([{ start_time: '09:00', end_time: '18:00' }])
    }
    setScheduleDialog({ dayOfWeek })
  }

  function addBlock() {
    const last = scheduleBlocks[scheduleBlocks.length - 1]
    const [h, m] = last.end_time.split(':').map(Number)
    const newStart = `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    const newEnd = `${String(Math.min(h + 5, 23)).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    setScheduleBlocks([...scheduleBlocks, { start_time: newStart, end_time: newEnd }])
  }

  function removeBlock(index: number) {
    setScheduleBlocks(scheduleBlocks.filter((_, i) => i !== index))
  }

  function updateBlock(index: number, field: 'start_time' | 'end_time', value: string) {
    setScheduleBlocks(scheduleBlocks.map((b, i) => i === index ? { ...b, [field]: value } : b))
  }

  function handleScheduleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedBarber || !scheduleDialog) return

    for (let i = 0; i < scheduleBlocks.length; i++) {
      const block = scheduleBlocks[i]
      if (block.start_time >= block.end_time) {
        toast.error(`Bloque ${i + 1}: la entrada debe ser anterior a la salida`)
        return
      }
      if (i > 0 && scheduleBlocks[i - 1].end_time > block.start_time) {
        toast.error(`Bloque ${i + 1}: se superpone con el bloque anterior`)
        return
      }
    }

    startTransition(async () => {
      const r = await saveScheduleBlocks(
        selectedBarber.id,
        scheduleDialog.dayOfWeek,
        scheduleBlocks
      )
      if (r.error) toast.error(r.error)
      else { toast.success('Horario guardado'); setScheduleDialog(null) }
    })
  }

  function handleAddException(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedBarber) return
    startTransition(async () => {
      const r = await upsertException(
        selectedBarber.id,
        exceptionForm.date,
        exceptionForm.is_absent,
        exceptionForm.reason || null
      )
      if (r.error) toast.error(r.error)
      else { toast.success('Excepción guardada'); setExceptionDialog(false) }
    })
  }

  function handleDeleteException(exceptionDate: string) {
    if (!selectedBarber) return
    startTransition(async () => {
      const r = await deleteException(selectedBarber.id, exceptionDate)
      if (r.error) toast.error(r.error)
      else toast.success('Excepción eliminada')
    })
  }

  async function handleCopyToAll() {
    if (!selectedBarber || copying) return
    setCopying(true)
    const r = await copyScheduleToAllInBranch(selectedBarber.id)
    setCopying(false)
    if (r.error) {
      toast.error(r.error)
    } else {
      toast.success(`Horario aplicado a ${r.count ?? 0} barbero${(r.count ?? 0) === 1 ? '' : 's'}`)
      setCopyDialog(false)
    }
  }

  const otherBarbers = branchBarbers.filter((b) => b.id !== selectedBarber?.id)

  function formatDaySchedule(schedules: StaffSchedule[]): string {
    return schedules.map((s) => `${s.start_time} – ${s.end_time}`).join('  ·  ')
  }

  return (
    <div className="space-y-6 pb-12">
      <div>
        <h1 className="text-2xl font-bold">Calendario laboral</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configurá los horarios de trabajo de cada barbero y agregá excepciones puntuales.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Barber selector — horizontal scroll en mobile, lista en desktop */}
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Barberos</p>
          {branchBarbers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin barberos en esta sucursal.</p>
          ) : (
            <div className="flex lg:flex-col gap-2 overflow-x-auto pb-1 lg:pb-0 scrollbar-hide">
              {branchBarbers.map((b) => (
                <button
                  key={b.id}
                  onClick={() => setSelectedBarberId(b.id)}
                  className={cn(
                    'shrink-0 lg:w-full text-left rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200',
                    (selectedBarber?.id === b.id)
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-muted hover:bg-muted/80'
                  )}
                >
                  {b.full_name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Weekly schedule */}
        {selectedBarber && (
          <div className="lg:col-span-3 space-y-4">
            <div>
              <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Horario semanal — {selectedBarber.full_name}
                </p>
                {otherBarbers.length > 0 && (selectedBarber.staff_schedules?.length ?? 0) > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setCopyDialog(true)}
                  >
                    <Copy className="size-3.5" />
                    Aplicar a todos
                  </Button>
                )}
              </div>
              <div className="divide-y rounded-xl border bg-card">
                {[1, 2, 3, 4, 5, 6, 0].map((day) => {
                  const daySchedules = getSchedulesForDay(day)
                  const isActive = daySchedules.length > 0
                  return (
                    <div key={day} className="flex items-center gap-4 px-4 py-3">
                      <span className="w-8 text-sm font-medium">{DAYS[day]}</span>
                      <Switch
                        checked={isActive}
                        onCheckedChange={() => handleDayToggle(day, isActive)}
                      />
                      {isActive ? (
                        <button
                          className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-2 flex-wrap"
                          onClick={() => openEditDialog(day)}
                        >
                          <span>{formatDaySchedule(daySchedules)}</span>
                          {daySchedules.length > 1 && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                              cortado
                            </Badge>
                          )}
                          <span className="text-xs text-primary">(editar)</span>
                        </button>
                      ) : (
                        <span className="text-sm text-muted-foreground">No trabaja</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Exceptions */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Excepciones próximas
                </p>
                <Button size="sm" variant="outline" onClick={() => {
                  setExceptionForm({ date: today, is_absent: true, reason: '' })
                  setExceptionDialog(true)
                }}>
                  <Plus className="size-4 mr-1.5" />
                  Agregar excepción
                </Button>
              </div>

              {selectedBarber.staff_schedule_exceptions.filter((e) => e.exception_date >= today).length === 0 ? (
                <div className="rounded-xl border bg-card p-5 text-center text-sm text-muted-foreground">
                  No hay excepciones futuras configuradas.
                </div>
              ) : (
                <div className="divide-y rounded-xl border bg-card">
                  {selectedBarber.staff_schedule_exceptions
                    .filter((e) => e.exception_date >= today)
                    .sort((a, b) => a.exception_date.localeCompare(b.exception_date))
                    .map((exc) => (
                      <div key={exc.id} className="flex items-center gap-3 px-4 py-3">
                        <AlertTriangle className="size-4 text-yellow-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">
                            {new Date(exc.exception_date + 'T12:00:00').toLocaleDateString('es-AR', {
                              weekday: 'long', day: 'numeric', month: 'long'
                            })}
                          </p>
                          {exc.reason && <p className="text-xs text-muted-foreground">{exc.reason}</p>}
                        </div>
                        <Badge variant={exc.is_absent ? 'destructive' : 'secondary'} className="text-xs shrink-0">
                          {exc.is_absent ? 'Ausente' : 'Horario especial'}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDeleteException(exc.exception_date)}
                        >
                          <X className="size-4" />
                        </Button>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Schedule blocks dialog */}
      <Dialog open={!!scheduleDialog} onOpenChange={(o) => !o && setScheduleDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Horario del {scheduleDialog ? DAYS_FULL[scheduleDialog.dayOfWeek] : ''}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleScheduleSubmit} className="space-y-4">
            <div className="space-y-3">
              {scheduleBlocks.map((block, idx) => (
                <div key={idx} className="space-y-2">
                  {scheduleBlocks.length > 1 && (
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-muted-foreground">
                        Bloque {idx + 1}
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-6 text-muted-foreground hover:text-destructive"
                        onClick={() => removeBlock(idx)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Entrada</Label>
                      <Input
                        type="time"
                        className="mt-1"
                        value={block.start_time}
                        onChange={(e) => updateBlock(idx, 'start_time', e.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Salida</Label>
                      <Input
                        type="time"
                        className="mt-1"
                        value={block.end_time}
                        onChange={(e) => updateBlock(idx, 'end_time', e.target.value)}
                        required
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={addBlock}
            >
              <Plus className="size-4 mr-1.5" />
              Agregar bloque (horario cortado)
            </Button>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setScheduleDialog(null)}>Cancelar</Button>
              <Button type="submit">Guardar horario</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Copy schedule to all barbers dialog */}
      <Dialog open={copyDialog} onOpenChange={(o) => !copying && setCopyDialog(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Aplicar horario a todos los barberos</DialogTitle>
            <DialogDescription>
              {selectedBarber && (
                <>
                  Vas a copiar el horario semanal de <span className="font-medium text-foreground">{selectedBarber.full_name}</span> a:
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <ul className="my-2 max-h-48 overflow-y-auto rounded-lg border bg-muted/30 divide-y">
            {otherBarbers.map((b) => (
              <li key={b.id} className="px-3 py-2 text-sm">
                {b.full_name}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Esto reemplaza el horario semanal actual de esos barberos. Las excepciones puntuales no se modifican.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={copying} onClick={() => setCopyDialog(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleCopyToAll} disabled={copying}>
              {copying && <Loader2 className="size-4 mr-1.5 animate-spin" />}
              Aplicar a {otherBarbers.length} barbero{otherBarbers.length === 1 ? '' : 's'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Exception dialog */}
      <Dialog open={exceptionDialog} onOpenChange={setExceptionDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agregar excepción</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddException} className="space-y-4">
            <div>
              <Label>Fecha</Label>
              <Input
                type="date"
                className="mt-1.5"
                min={today}
                value={exceptionForm.date}
                onChange={(e) => setExceptionForm((f) => ({ ...f, date: e.target.value }))}
                required
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={exceptionForm.is_absent}
                onCheckedChange={(v) => setExceptionForm((f) => ({ ...f, is_absent: v }))}
              />
              <Label>{exceptionForm.is_absent ? 'Ausente ese día' : 'Trabaja (horario especial)'}</Label>
            </div>
            <div>
              <Label>Motivo <span className="text-muted-foreground">(opcional)</span></Label>
              <Input
                className="mt-1.5"
                placeholder="Ej: Feriado, médico..."
                value={exceptionForm.reason}
                onChange={(e) => setExceptionForm((f) => ({ ...f, reason: e.target.value }))}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setExceptionDialog(false)}>Cancelar</Button>
              <Button type="submit" disabled={!exceptionForm.date}>Guardar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
