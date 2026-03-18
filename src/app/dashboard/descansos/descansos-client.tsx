'use client'

import { useState, useTransition, useEffect } from 'react'
import {
  upsertBreakConfig,
  deleteBreakConfig,
} from '@/lib/actions/breaks'
import {
  approveBreak,
  rejectBreak,
} from '@/lib/actions/break-requests'
import type { Branch, BreakConfig } from '@/lib/types/database'
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
import { Coffee, Plus, Pencil, Trash2, CheckCircle2, XCircle, HandMetal } from 'lucide-react'
import { toast } from 'sonner'
import { useBranchStore } from '@/stores/branch-store'

interface BreakRequestRow {
  id: string
  staff_id: string
  branch_id: string
  break_config_id: string
  status: string
  cuts_before_break: number
  requested_at: string
  staff?: { id: string; full_name: string } | null
  break_config?: { name: string; duration_minutes: number } | null
}

interface Props {
  breakConfigs: BreakConfig[]
  breakRequests: BreakRequestRow[]
}

const EMPTY_FORM = { id: '', branch_id: '', name: '', duration_minutes: '30' }

function BreakRequestCard({ request }: { request: BreakRequestRow }) {
  const [, startTransition] = useTransition()
  const [cutsInput, setCutsInput] = useState('0')
  const staffName = request.staff?.full_name ?? 'Barbero'
  const breakName = request.break_config?.name ?? 'Descanso'
  const duration = request.break_config?.duration_minutes ?? 0
  const isPending = request.status === 'pending'
  const isApproved = request.status === 'approved'

  const timeSince = (() => {
    const diff = Date.now() - new Date(request.requested_at).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'hace un momento'
    if (mins < 60) return `hace ${mins} min`
    return `hace ${Math.floor(mins / 60)}h ${mins % 60}min`
  })()

  function handleApprove() {
    const cuts = parseInt(cutsInput, 10)
    if (isNaN(cuts) || cuts < 0) { toast.error('Número de cortes inválido'); return }
    startTransition(async () => {
      const r = await approveBreak(request.id, cuts)
      if (r.error) { toast.error(r.error) } else {
        toast.success(`Descanso aprobado para ${staffName}${cuts > 0 ? ` en ${cuts} corte${cuts > 1 ? 's' : ''}` : ' (inmediato)'}`)
        window.location.reload()
      }
    })
  }

  function handleReject() {
    startTransition(async () => {
      const r = await rejectBreak(request.id)
      if (r.error) { toast.error(r.error) } else { toast.success('Solicitud rechazada'); window.location.reload() }
    })
  }

  return (
    <div className="flex flex-col gap-3 px-5 py-4">
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 font-semibold text-sm">
          {staffName.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium truncate">{staffName}</p>
          <div className="flex items-center gap-2 flex-wrap mt-0.5">
            <Badge variant="outline" className={`text-xs ${isPending ? 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30' : 'bg-green-500/15 text-green-600 border-green-500/30'}`}>
              {isPending ? 'Pendiente' : 'Aprobado'}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {breakName} ({duration}min) · {timeSince}
            </span>
            {isApproved && (
              <Badge variant="outline" className="text-xs bg-blue-500/15 text-blue-500 border-blue-500/30">
                {request.cuts_before_break === 0 ? 'Inmediato' : `En ${request.cuts_before_break} corte${request.cuts_before_break > 1 ? 's' : ''}`}
              </Badge>
            )}
          </div>
        </div>
      </div>
      {isPending && (
        <div className="flex items-center gap-2 ml-12">
          <div className="flex items-center gap-2 flex-1">
            <Label className="text-xs text-muted-foreground whitespace-nowrap">Luego de</Label>
            <Input
              type="number"
              min="0"
              step="1"
              className="w-20 h-8 text-sm"
              value={cutsInput}
              onChange={(e) => setCutsInput(e.target.value)}
            />
            <span className="text-xs text-muted-foreground">cortes</span>
          </div>
          <Button size="sm" variant="outline" className="text-green-600 border-green-500/30 hover:bg-green-500/10" onClick={handleApprove}>
            <CheckCircle2 className="size-4 mr-1.5" />
            Aprobar
          </Button>
          <Button size="sm" variant="outline" className="text-red-500 border-red-500/30 hover:bg-red-500/10" onClick={handleReject}>
            <XCircle className="size-4 mr-1.5" />
            Rechazar
          </Button>
        </div>
      )}
    </div>
  )
}

export function DescansosDashboard({ breakConfigs, breakRequests }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [, startTransition] = useTransition()
  const { selectedBranchId } = useBranchStore()

  const branchConfigs = breakConfigs.filter((bc) => bc.branch_id === selectedBranchId)

  function openCreate() {
    setForm({ ...EMPTY_FORM, branch_id: selectedBranchId || '' })
    setDialogOpen(true)
  }

  function openEdit(bc: BreakConfig) {
    setForm({
      id: bc.id,
      branch_id: bc.branch_id,
      name: bc.name,
      duration_minutes: String(bc.duration_minutes),
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
            Configurá tipos de descanso y gestioná solicitudes de los barberos.
          </p>
        </div>
        <div className="flex items-center gap-3">
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
                    {bc.duration_minutes} min
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
                          Esta acción no se puede deshacer.
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

      {/* Break requests */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <HandMetal className="size-4 inline mr-1.5 -mt-0.5" />
          Solicitudes de descanso
        </h2>
        {(() => {
          const branchRequests = breakRequests.filter((r) => r.branch_id === selectedBranchId)
          if (branchRequests.length === 0) {
            return (
              <div className="rounded-xl border bg-card p-8 text-center">
                <p className="text-sm text-muted-foreground">No hay solicitudes de descanso pendientes.</p>
              </div>
            )
          }
          return (
            <div className="divide-y rounded-xl border bg-card">
              {branchRequests.map((req) => (
                <BreakRequestCard key={req.id} request={req} />
              ))}
            </div>
          )
        })()}
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form.id ? 'Editar descanso' : 'Nuevo tipo de descanso'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
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
            <div>
              <Label>Duración (minutos)</Label>
              <Input
                type="number"
                min="1"
                step="1"
                className="mt-1.5"
                value={form.duration_minutes}
                onChange={(e) => setForm((f) => ({ ...f, duration_minutes: e.target.value }))}
                required
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
