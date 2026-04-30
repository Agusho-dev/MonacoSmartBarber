'use client'

import { useState, useTransition } from 'react'
import { CalendarClock, Loader2, User } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { rescheduleAppointmentViaRpc } from '@/lib/actions/turnos'
import type { Appointment } from '@/lib/types/database'

interface Staff {
  id: string
  full_name: string
}

interface Props {
  appointment: Appointment | null
  staff: Staff[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onRescheduled?: () => void
}

export function RescheduleDialog({
  appointment,
  staff,
  open,
  onOpenChange,
  onRescheduled,
}: Props) {
  // Inicializar desde props. El padre monta con key={appointment.id} para
  // reiniciar el estado al cambiar de turno.
  const [newDate, setNewDate] = useState(appointment?.appointment_date ?? '')
  const [newTime, setNewTime] = useState(appointment?.start_time.slice(0, 5) ?? '')
  const [newStaffId, setNewStaffId] = useState<string>(appointment?.barber_id ?? '')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleSubmit() {
    if (!appointment) return
    if (!newDate || !newTime) {
      setError('La fecha y el horario son obligatorios')
      return
    }

    setError('')
    startTransition(async () => {
      const res = await rescheduleAppointmentViaRpc({
        appointmentId: appointment.id,
        newDate,
        newStartTime: newTime,
        newStaffId: newStaffId || null,
        // Lock optimista: pasamos updated_at para detectar edición concurrente
        expectedUpdatedAt: appointment.updated_at ?? null,
      })

      if ('error' in res) {
        setError(res.error)
        toast.error(res.error)
        return
      }

      toast.success('Turno reprogramado')
      onOpenChange(false)
      onRescheduled?.()
    })
  }

  const currentDateLabel = appointment
    ? new Date(appointment.appointment_date + 'T12:00:00').toLocaleDateString('es-AR', {
        weekday: 'long', day: 'numeric', month: 'long',
      })
    : ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="size-5" />
            Reprogramar turno
          </DialogTitle>
          <DialogDescription className="text-sm">
            {appointment && (
              <>
                Turno actual de{' '}
                <strong>{appointment.client?.name ?? 'cliente'}</strong>:{' '}
                {currentDateLabel} a las {appointment.start_time.slice(0, 5)}
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="reschedule-date">Nueva fecha</Label>
            <Input
              id="reschedule-date"
              type="date"
              value={newDate}
              min={new Date().toISOString().split('T')[0]}
              onChange={(e) => setNewDate(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reschedule-time">Nuevo horario</Label>
            <Input
              id="reschedule-time"
              type="time"
              value={newTime}
              step={900} // 15 minutos
              onChange={(e) => setNewTime(e.target.value)}
            />
          </div>

          {staff.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="reschedule-staff">Barbero</Label>
              <Select
                value={newStaffId || '__sin_cambio__'}
                onValueChange={(v) => setNewStaffId(v === '__sin_cambio__' ? '' : v)}
              >
                <SelectTrigger id="reschedule-staff" className="gap-2">
                  <User className="size-4 text-muted-foreground" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__sin_cambio__">Sin cambio</SelectItem>
                  {staff.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || !newDate || !newTime}>
            {isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Reprogramar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
