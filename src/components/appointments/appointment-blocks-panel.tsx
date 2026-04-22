'use client'

import { useState, useTransition } from 'react'
import { Ban, Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { createAppointmentBlock, deleteAppointmentBlock } from '@/lib/actions/appointment-blocks'
import type { AppointmentBlock } from '@/lib/types/database'
import type { GridBarber } from './appointments-grid-view'
import { toast } from 'sonner'

interface Props {
  branchId: string
  date: string
  blocks: AppointmentBlock[]
  barbers: GridBarber[]
  onChanged: () => void
}

export function AppointmentBlocksPanel({ branchId, date, blocks, barbers, onChanged }: Props) {
  const [showCreate, setShowCreate] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleDelete(blockId: string) {
    startTransition(async () => {
      const res = await deleteAppointmentBlock(blockId)
      if (res.error) toast.error(res.error)
      else { toast.success('Bloqueo eliminado'); onChanged() }
    })
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Ban className="size-4" />
          Bloqueos
        </h3>
        <Button size="sm" variant="outline" onClick={() => setShowCreate(true)}>
          <Plus className="size-3.5 mr-1" /> Nuevo
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {blocks.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">
            No hay bloqueos para este día.
          </p>
        ) : (
          <ul className="space-y-2">
            {blocks.map((b) => {
              const start = new Date(b.start_at)
              const end = new Date(b.end_at)
              const barberName = b.barber_id
                ? barbers.find((x) => x.id === b.barber_id)?.full_name ?? 'Barbero'
                : b.branch_id ? 'Toda la sucursal' : 'Toda la organización'
              return (
                <li key={b.id} className="flex items-start gap-2 rounded-md border bg-card p-2 text-xs">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{barberName}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {start.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} → {end.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    {b.reason && (
                      <p className="mt-0.5 truncate text-muted-foreground">{b.reason}</p>
                    )}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 shrink-0"
                    disabled={isPending}
                    onClick={() => handleDelete(b.id)}
                    aria-label="Eliminar bloqueo"
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <CreateBlockDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        branchId={branchId}
        date={date}
        barbers={barbers}
        onCreated={() => { onChanged(); setShowCreate(false) }}
      />
    </div>
  )
}

function CreateBlockDialog({
  open,
  onOpenChange,
  branchId,
  date,
  barbers,
  onCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  branchId: string
  date: string
  barbers: GridBarber[]
  onCreated: () => void
}) {
  const [barberId, setBarberId] = useState<string>('__branch__')
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('10:00')
  const [reason, setReason] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleCreate() {
    if (endTime <= startTime) {
      toast.error('El horario final debe ser posterior al inicial')
      return
    }

    startTransition(async () => {
      const res = await createAppointmentBlock({
        branchId,
        barberId: barberId === '__branch__' ? null : barberId,
        startAt: new Date(`${date}T${startTime}:00`).toISOString(),
        endAt: new Date(`${date}T${endTime}:00`).toISOString(),
        reason: reason.trim() || undefined,
      })
      if (res.error) toast.error(res.error)
      else { toast.success('Bloqueo creado'); onCreated() }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Crear bloqueo</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Barbero (opcional)</Label>
            <Select value={barberId} onValueChange={setBarberId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__branch__">Toda la sucursal</SelectItem>
                {barbers.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Desde</Label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Hasta</Label>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Motivo (opcional)</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Vacaciones, reunión…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button onClick={handleCreate} disabled={isPending}>
            {isPending ? <><Loader2 className="mr-2 size-4 animate-spin" /> Creando…</> : 'Crear bloqueo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
