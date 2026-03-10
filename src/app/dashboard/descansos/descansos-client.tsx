'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import {
  upsertBreakConfig,
  deleteBreakConfig,
  startBreak,
  endBreak,
  unblockBarber,
  checkAndBlockOverdueBreaks,
} from '@/lib/actions/breaks'
import type { Branch, BreakConfig, StaffStatus } from '@/lib/types/database'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
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
import { Coffee, Plus, Pencil, Trash2, Play, RotateCcw, ShieldAlert, Clock } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface BarberWithBreak {
  id: string
  full_name: string
  status: StaffStatus
  break_config_id: string | null
  break_started_at: string | null
  break_ends_at: string | null
  branch_id: string | null
  break_configs?: { name: string; duration_minutes: number; tolerance_minutes: number } | null
}

interface Props {
  breakConfigs: BreakConfig[]
  branches: Branch[]
  barbers: BarberWithBreak[]
}

const EMPTY_FORM = { id: '', branch_id: '', name: '', duration_minutes: '30', tolerance_minutes: '5', scheduled_time: '' }

function useCountdown(endsAt: string | null) {
  const [remaining, setRemaining] = useState<number | null>(null)
  useEffect(() => {
    if (!endsAt) { setRemaining(null); return }
    const tick = () => setRemaining(Math.max(0, new Date(endsAt).getTime() - Date.now()))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [endsAt])
  return remaining
}

function BarberBreakRow({ barber, breakConfigs, branchId, onAction }: {
  barber: BarberWithBreak
  breakConfigs: BreakConfig[]
  branchId: string
  onAction: () => void
}) {
  const [selectedConfig, setSelectedConfig] = useState('')
  const [, startTransition] = useTransition()
  const remaining = useCountdown(barber.break_ends_at)
  const branchConfigs = breakConfigs.filter((bc) => bc.branch_id === branchId && bc.is_active)

  const statusColors: Record<StaffStatus, string> = {
    available: 'bg-green-500/15 text-green-600 border-green-500/30',
    paused: 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30',
    blocked: 'bg-red-500/15 text-red-500 border-red-500/30',
  }

  const statusLabels: Record<StaffStatus, string> = {
    available: 'Disponible',
    paused: 'En descanso',
    blocked: 'BLOQUEADO',
  }

  function formatMs(ms: number) {
    const totalSec = Math.floor(ms / 1000)
    const m = Math.floor(totalSec / 60)
    const s = totalSec % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  function handleStart() {
    if (!selectedConfig) return
    startTransition(async () => {
      const r = await startBreak(barber.id, selectedConfig)
      if (r.error) toast.error(r.error)
      else { toast.success('Descanso iniciado'); onAction() }
    })
  }

  function handleEnd() {
    startTransition(async () => {
      const r = await endBreak(barber.id)
      if (r.error) toast.error(r.error)
      else { toast.success('Descanso finalizado'); onAction() }
    })
  }

  function handleUnblock() {
    startTransition(async () => {
      const r = await unblockBarber(barber.id)
      if (r.error) toast.error(r.error)
      else { toast.success(`${barber.full_name} desbloqueado`); onAction() }
    })
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-5 py-4">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-sm">
          {barber.full_name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="font-medium truncate">{barber.full_name}</p>
          <div className="flex items-center gap-2 flex-wrap mt-0.5">
            <Badge variant="outline" className={cn('text-xs', statusColors[barber.status])}>
              {statusLabels[barber.status]}
            </Badge>
            {barber.status === 'paused' && remaining !== null && (
              <span className={cn('flex items-center gap-1 text-xs font-mono', remaining < 60000 ? 'text-red-500' : 'text-muted-foreground')}>
                <Clock className="size-3" />
                {formatMs(remaining)} restante
              </span>
            )}
            {barber.status === 'paused' && barber.break_configs && (
              <span className="text-xs text-muted-foreground">({barber.break_configs.name})</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {barber.status === 'available' && branchConfigs.length > 0 && (
          <>
            <Select value={selectedConfig} onValueChange={setSelectedConfig}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Tipo..." />
              </SelectTrigger>
              <SelectContent>
                {branchConfigs.map((bc) => (
                  <SelectItem key={bc.id} value={bc.id}>
                    {bc.name} ({bc.duration_minutes}min)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" disabled={!selectedConfig} onClick={handleStart}>
              <Play className="size-4 mr-1.5" />
              Iniciar
            </Button>
          </>
        )}
        {barber.status === 'paused' && (
          <Button size="sm" variant="outline" onClick={handleEnd}>
            <RotateCcw className="size-4 mr-1.5" />
            Volver
          </Button>
        )}
        {barber.status === 'blocked' && (
          <Button size="sm" variant="destructive" onClick={handleUnblock}>
            <ShieldAlert className="size-4 mr-1.5" />
            Desbloquear
          </Button>
        )}
      </div>
    </div>
  )
}

export function DescansosDashboard({ breakConfigs, branches, barbers }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [, startTransition] = useTransition()
  const [selectedBranchId, setSelectedBranchId] = useState(branches[0]?.id ?? '')
  const [localBarbers, setLocalBarbers] = useState(barbers)

  // Poll to check and block overdue breaks
  useEffect(() => {
    const check = () => {
      checkAndBlockOverdueBreaks()
    }
    const id = setInterval(check, 30000)
    return () => clearInterval(id)
  }, [])

  const branchBarbers = localBarbers.filter((b) => b.branch_id === selectedBranchId)
  const branchConfigs = breakConfigs.filter((bc) => bc.branch_id === selectedBranchId)

  function openCreate() {
    setForm({ ...EMPTY_FORM, branch_id: selectedBranchId })
    setDialogOpen(true)
  }

  function openEdit(bc: BreakConfig) {
    setForm({
      id: bc.id,
      branch_id: bc.branch_id,
      name: bc.name,
      duration_minutes: String(bc.duration_minutes),
      tolerance_minutes: String(bc.tolerance_minutes),
      scheduled_time: bc.scheduled_time ?? '',
    })
    setDialogOpen(true)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const fd = new FormData()
    Object.entries(form).forEach(([k, v]) => { if (v) fd.append(k, v) })
    startTransition(async () => {
      const r = await upsertBreakConfig(fd)
      if (r.error) toast.error(r.error)
      else { toast.success(form.id ? 'Descanso actualizado' : 'Descanso creado'); setDialogOpen(false) }
    })
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const r = await deleteBreakConfig(id)
      if (r.error) toast.error(r.error)
      else toast.success('Configuración eliminada')
    })
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Descansos</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configurá tipos de descanso y gestioná el estado de los barberos en tiempo real.
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
          <Button onClick={openCreate}>
            <Plus className="size-4 mr-2" />
            Nuevo tipo
          </Button>
        </div>
      </div>

      {/* Break config types */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Tipos de descanso configurados
        </h2>
        {branchConfigs.length === 0 ? (
          <div className="rounded-xl border bg-card p-8 text-center">
            <Coffee className="size-8 mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No hay tipos de descanso para esta sucursal.</p>
          </div>
        ) : (
          <div className="divide-y rounded-xl border bg-card">
            {branchConfigs.map((bc) => (
              <div key={bc.id} className="flex items-center gap-4 px-5 py-4">
                <Coffee className="size-5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{bc.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {bc.duration_minutes} min + {bc.tolerance_minutes} min tolerancia
                    {bc.scheduled_time && ` · Programado: ${bc.scheduled_time}`}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(bc)}>
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
                        <AlertDialogTitle>¿Eliminar tipo de descanso?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Los barberos actualmente en este descanso no se verán afectados.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => handleDelete(bc.id)}>
                          Eliminar
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Barber status panel */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Estado de barberos
        </h2>
        {branchBarbers.length === 0 ? (
          <div className="rounded-xl border bg-card p-8 text-center">
            <p className="text-sm text-muted-foreground">No hay barberos activos en esta sucursal.</p>
          </div>
        ) : (
          <div className="divide-y rounded-xl border bg-card">
            {branchBarbers.map((b) => (
              <BarberBreakRow
                key={b.id}
                barber={b}
                breakConfigs={breakConfigs}
                branchId={selectedBranchId}
                onAction={() => window.location.reload()}
              />
            ))}
          </div>
        )}
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form.id ? 'Editar descanso' : 'Nuevo tipo de descanso'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label>Sucursal</Label>
              <Select value={form.branch_id} onValueChange={(v) => setForm((f) => ({ ...f, branch_id: v }))}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder="Seleccionar sucursal" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Nombre</Label>
              <Input
                className="mt-1.5"
                placeholder="Ej: Almuerzo, Descanso corto..."
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Duración (minutos)</Label>
                <Input
                  type="number"
                  min="1"
                  className="mt-1.5"
                  value={form.duration_minutes}
                  onChange={(e) => setForm((f) => ({ ...f, duration_minutes: e.target.value }))}
                  required
                />
              </div>
              <div>
                <Label>Tolerancia extra (min)</Label>
                <Input
                  type="number"
                  min="0"
                  className="mt-1.5"
                  value={form.tolerance_minutes}
                  onChange={(e) => setForm((f) => ({ ...f, tolerance_minutes: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <Label>
                Hora programada{' '}
                <span className="text-muted-foreground">(opcional, ej: 13:00)</span>
              </Label>
              <Input
                type="time"
                className="mt-1.5"
                value={form.scheduled_time}
                onChange={(e) => setForm((f) => ({ ...f, scheduled_time: e.target.value }))}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={!form.name || !form.branch_id}>
                {form.id ? 'Guardar' : 'Crear'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
