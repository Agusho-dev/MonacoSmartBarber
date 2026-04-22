'use client'

import { useState, useEffect, useCallback } from 'react'
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Loader2, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  getAppointmentsForDate,
  getBranchAppointmentStaff,
  getAppointmentSettings,
} from '@/lib/actions/appointments'
import { AppointmentsGridView, type GridBarber } from './appointments-grid-view'
import type { Appointment, AppointmentSettings } from '@/lib/types/database'

interface Branch {
  id: string
  name: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  branches: Branch[]
  onInsertText: (text: string) => void
  defaultBranchId?: string | null
}

function formatSuggestionText(date: string, time: string): string {
  const dateFormatted = new Date(date + 'T12:00:00').toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  return `Tengo disponible un turno el día ${dateFormatted} en el horario ${time}. ¿Te viene bien?`
}

export function AppointmentAvailabilityDialog({
  open,
  onOpenChange,
  branches,
  onInsertText,
  defaultBranchId,
}: Props) {
  const [branchId, setBranchId] = useState<string>(
    defaultBranchId ?? (branches.length === 1 ? branches[0].id : '')
  )
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
  const [settings, setSettings] = useState<AppointmentSettings | null>(null)
  const [barbers, setBarbers] = useState<GridBarber[]>([])
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState<{ barberId: string; time: string } | null>(null)

  const load = useCallback(async () => {
    if (!branchId || !date) return
    setLoading(true)
    setSelectedSlot(null)
    const [staffList, apts, cfg] = await Promise.all([
      getBranchAppointmentStaff(branchId),
      getAppointmentsForDate(branchId, date),
      getAppointmentSettings(undefined, branchId),
    ])
    setBarbers(staffList)
    setAppointments(apts)
    setSettings(cfg)
    setLoading(false)
  }, [branchId, date])

  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [open, load])

  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedSlot(null)
    }
  }, [open])

  function shiftDate(days: number) {
    const d = new Date(date + 'T12:00:00')
    d.setDate(d.getDate() + days)
    setDate(d.toISOString().split('T')[0])
  }

  function handleInsert() {
    if (!selectedSlot) return
    onInsertText(formatSuggestionText(date, selectedSlot.time))
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[min(96vw,1100px)] !max-w-[1100px] flex-col p-0 sm:!max-w-[1100px]">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            <CalendarIcon className="size-4" />
            Ver agenda
          </DialogTitle>
          <DialogDescription className="text-xs">
            Explorá los turnos del día. Tocá un hueco libre para proponerlo al cliente.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 border-b px-5 py-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-1 flex-wrap items-end gap-3">
            {branches.length > 1 && (
              <div className="min-w-[180px] space-y-1">
                <Label className="text-xs">Sucursal</Label>
                <Select value={branchId} onValueChange={setBranchId}>
                  <SelectTrigger><SelectValue placeholder="Elegir sucursal" /></SelectTrigger>
                  <SelectContent>
                    {branches.map(b => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex items-end gap-1">
              <Button variant="outline" size="icon" onClick={() => shiftDate(-1)} aria-label="Día anterior" type="button">
                <ChevronLeft className="size-4" />
              </Button>
              <div className="space-y-1">
                <Label className="text-xs">Fecha</Label>
                <Input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  className="w-[160px]"
                />
              </div>
              <Button variant="outline" size="icon" onClick={() => shiftDate(1)} aria-label="Día siguiente" type="button">
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden p-3">
          {loading ? (
            <div className="flex h-full items-center justify-center py-16">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : !branchId ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              Elegí una sucursal para ver la agenda.
            </div>
          ) : !settings?.is_enabled ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              El sistema de turnos no está habilitado.
            </div>
          ) : barbers.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              No hay barberos habilitados para turnos en esta sucursal.
            </div>
          ) : (
            <AppointmentsGridView
              date={date}
              barbers={barbers}
              appointments={appointments}
              slotInterval={settings.slot_interval_minutes}
              hoursOpen={settings.appointment_hours_open}
              hoursClose={settings.appointment_hours_close}
              onSlotClick={(barberId, time) => setSelectedSlot({ barberId, time })}
              selected={{ slot: selectedSlot ?? undefined }}
              className="h-[min(60vh,560px)]"
            />
          )}
        </div>

        <DialogFooter className="flex-col items-stretch gap-2 border-t px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-muted-foreground">
            {selectedSlot
              ? <>Seleccionado <span className="font-mono">{selectedSlot.time}</span> con {barbers.find(b => b.id === selectedSlot.barberId)?.full_name ?? '—'}</>
              : 'Tocá un hueco libre para generar la sugerencia.'}
          </div>
          <Button disabled={!selectedSlot} onClick={handleInsert}>
            <Send className="mr-2 size-4" />
            Insertar sugerencia
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
