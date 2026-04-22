'use client'

import { useState, useTransition } from 'react'
import { Hourglass, Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
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
import { addToWaitlist, removeFromWaitlist } from '@/lib/actions/waitlist'
import type { AppointmentWaitlist } from '@/lib/types/database'
import type { GridBarber } from './appointments-grid-view'
import type { BookingServiceOption } from './appointment-booking-dialog'
import { toast } from 'sonner'

interface Props {
  branchId: string
  entries: AppointmentWaitlist[]
  barbers: GridBarber[]
  services: BookingServiceOption[]
  onChanged: () => void
}

export function AppointmentWaitlistPanel({ branchId, entries, barbers, services, onChanged }: Props) {
  const [showCreate, setShowCreate] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleRemove(id: string) {
    startTransition(async () => {
      const res = await removeFromWaitlist(id)
      if (res.error) toast.error(res.error)
      else { toast.success('Quitado de lista de espera'); onChanged() }
    })
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Hourglass className="size-4" />
          Lista de espera
        </h3>
        <Button size="sm" variant="outline" onClick={() => setShowCreate(true)}>
          <Plus className="size-3.5 mr-1" /> Agregar
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {entries.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">
            No hay clientes en lista de espera.
          </p>
        ) : (
          <ul className="space-y-2">
            {entries.map((e) => (
              <li key={e.id} className="flex items-start gap-2 rounded-md border bg-card p-2 text-xs">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <p className="font-medium truncate">{e.client?.name ?? 'Cliente'}</p>
                    <Badge
                      variant={e.status === 'notified' ? 'default' : 'secondary'}
                      className="text-[9px] px-1 py-0"
                    >
                      {e.status === 'notified' ? 'Notificado' : 'Esperando'}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">{e.client?.phone ?? ''}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {e.preferred_date_from} → {e.preferred_date_to}
                    {e.service?.name && ` · ${e.service.name}`}
                  </p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 shrink-0"
                  disabled={isPending}
                  onClick={() => handleRemove(e.id)}
                  aria-label="Quitar"
                >
                  <Trash2 className="size-3" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <CreateWaitlistDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        branchId={branchId}
        barbers={barbers}
        services={services}
        onCreated={() => { onChanged(); setShowCreate(false) }}
      />
    </div>
  )
}

function CreateWaitlistDialog({
  open,
  onOpenChange,
  branchId,
  barbers,
  services,
  onCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  branchId: string
  barbers: GridBarber[]
  services: BookingServiceOption[]
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [serviceId, setServiceId] = useState<string>('__any__')
  const [barberId, setBarberId] = useState<string>('__any__')
  const [dateFrom, setDateFrom] = useState(() => new Date().toISOString().split('T')[0])
  const [dateTo, setDateTo] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 7)
    return d.toISOString().split('T')[0]
  })
  const [notes, setNotes] = useState('')
  const [isPending, startTransition] = useTransition()

  const availableServices = services.filter((s) => !s.branch_id || s.branch_id === branchId)

  function handleCreate() {
    if (!name.trim()) { toast.error('Ingresá el nombre'); return }
    if (!phone.trim()) { toast.error('Ingresá el teléfono'); return }
    if (dateTo < dateFrom) { toast.error('Rango de fechas inválido'); return }

    startTransition(async () => {
      const res = await addToWaitlist({
        branchId,
        clientName: name.trim(),
        clientPhone: phone.trim(),
        serviceId: serviceId === '__any__' ? null : serviceId,
        barberId: barberId === '__any__' ? null : barberId,
        preferredDateFrom: dateFrom,
        preferredDateTo: dateTo,
        source: 'manual',
        notes: notes.trim() || undefined,
      })
      if (res.error) toast.error(res.error)
      else { toast.success('Agregado a lista de espera'); onCreated() }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Agregar a lista de espera</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Nombre</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Teléfono</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="549..." />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Servicio (opcional)</Label>
            <Select value={serviceId} onValueChange={setServiceId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__any__">Cualquiera</SelectItem>
                {availableServices.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Barbero preferido (opcional)</Label>
            <Select value={barberId} onValueChange={setBarberId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__any__">Cualquiera</SelectItem>
                {barbers.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Desde</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Hasta</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Notas (opcional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button onClick={handleCreate} disabled={isPending}>
            {isPending ? <><Loader2 className="mr-2 size-4 animate-spin" /> Guardando…</> : 'Agregar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
