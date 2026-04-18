'use client'

import { useState, useEffect, useCallback, useTransition } from 'react'
import { CalendarPlus, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
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
  createAppointment,
} from '@/lib/actions/appointments'
import { AppointmentsGridView, type GridBarber } from './appointments-grid-view'
import type { Appointment, AppointmentSettings } from '@/lib/types/database'

export interface BookingServiceOption {
  id: string
  name: string
  price: number
  duration_minutes: number | null
  branch_id: string | null
  booking_mode: 'self_service' | 'manual_only' | 'both'
}

interface Branch {
  id: string
  name: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  branches: Branch[]
  services: BookingServiceOption[]
  clientName?: string | null
  clientPhone?: string | null
  defaultBranchId?: string | null
  onBooked?: () => void
  staffId?: string
}

export function AppointmentBookingDialog({
  open,
  onOpenChange,
  branches,
  services,
  clientName,
  clientPhone,
  defaultBranchId,
  onBooked,
  staffId,
}: Props) {
  const [branchId, setBranchId] = useState<string>(
    defaultBranchId ?? (branches.length === 1 ? branches[0].id : '')
  )
  const [name, setName] = useState(clientName ?? '')
  const [phone, setPhone] = useState(clientPhone ?? '')
  const [serviceId, setServiceId] = useState<string>('')
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
  const [selectedSlot, setSelectedSlot] = useState<{ barberId: string; time: string } | null>(null)

  const [settings, setSettings] = useState<AppointmentSettings | null>(null)
  const [barbers, setBarbers] = useState<GridBarber[]>([])
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(clientName ?? '')
    setPhone(clientPhone ?? '')
    setError('')
  }, [open, clientName, clientPhone])

  const availableServices = services.filter(
    s =>
      (s.booking_mode === 'manual_only' || s.booking_mode === 'both') &&
      (!s.branch_id || !branchId || s.branch_id === branchId)
  )

  const load = useCallback(async () => {
    if (!branchId || !date) return
    setLoading(true)
    setSelectedSlot(null)
    const [staffList, apts, cfg] = await Promise.all([
      getBranchAppointmentStaff(branchId),
      getAppointmentsForDate(branchId, date),
      getAppointmentSettings(),
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

  function shiftDate(days: number) {
    const d = new Date(date + 'T12:00:00')
    d.setDate(d.getDate() + days)
    setDate(d.toISOString().split('T')[0])
  }

  function handleBook() {
    setError('')
    if (!branchId) { setError('Seleccioná una sucursal'); return }
    if (!serviceId) { setError('Seleccioná un servicio'); return }
    if (!name.trim()) { setError('Ingresá el nombre del cliente'); return }
    if (!phone.trim()) { setError('Ingresá el teléfono del cliente'); return }
    if (!selectedSlot) { setError('Seleccioná un horario en la grilla'); return }

    const service = services.find(s => s.id === serviceId)

    startTransition(async () => {
      const result = await createAppointment({
        branchId,
        clientPhone: phone.trim(),
        clientName: name.trim(),
        barberId: selectedSlot.barberId,
        serviceId,
        appointmentDate: date,
        startTime: selectedSlot.time,
        durationMinutes: service?.duration_minutes ?? 30,
        source: 'manual',
        createdByStaffId: staffId,
      })

      if (result.error) {
        setError(result.error)
      } else {
        onBooked?.()
        onOpenChange(false)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[min(96vw,1200px)] max-w-[1200px] flex-col p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus className="size-4" />
            Agendar turno
          </DialogTitle>
          <DialogDescription className="text-xs">
            Los datos se cargan desde la conversación. Revisá y seleccioná un horario.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[320px_1fr]">
          <aside className="space-y-3 overflow-y-auto border-b p-4 md:border-b-0 md:border-r">
            <div className="space-y-1">
              <Label className="text-xs">Cliente</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Nombre y apellido" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Teléfono</Label>
              <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="549..." inputMode="tel" />
            </div>
            {branches.length > 1 && (
              <div className="space-y-1">
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
            <div className="space-y-1">
              <Label className="text-xs">Servicio</Label>
              <Select value={serviceId} onValueChange={setServiceId}>
                <SelectTrigger><SelectValue placeholder="Elegir servicio" /></SelectTrigger>
                <SelectContent>
                  {availableServices.length === 0 ? (
                    <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                      No hay servicios disponibles para gestión manual.
                    </div>
                  ) : availableServices.map(s => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} · ${s.price.toLocaleString('es-AR')} · {s.duration_minutes ?? 30}min
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Fecha</Label>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" onClick={() => shiftDate(-1)} type="button" aria-label="Día anterior">
                  <ChevronLeft className="size-4" />
                </Button>
                <Input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  className="flex-1"
                />
                <Button variant="outline" size="icon" onClick={() => shiftDate(1)} type="button" aria-label="Día siguiente">
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>

            <div className="rounded-md border bg-muted/30 p-3 text-xs">
              <p className="font-medium mb-1">Horario seleccionado</p>
              {selectedSlot ? (
                <p className="font-mono">
                  {selectedSlot.time} · {barbers.find(b => b.id === selectedSlot.barberId)?.full_name ?? '—'}
                </p>
              ) : (
                <p className="text-muted-foreground">Tocá un hueco libre en la grilla →</p>
              )}
            </div>

            {error && (
              <div className="rounded-md bg-red-500/10 p-2 text-xs text-red-600">{error}</div>
            )}
          </aside>

          <div className="min-h-0 overflow-hidden p-3">
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
                className="h-[min(62vh,580px)]"
              />
            )}
          </div>
        </div>

        <DialogFooter className="flex-col items-stretch gap-2 border-t px-5 py-3 sm:flex-row sm:items-center sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button onClick={handleBook} disabled={isPending || !selectedSlot}>
            {isPending ? (
              <><Loader2 className="mr-2 size-4 animate-spin" /> Creando…</>
            ) : (
              <><CalendarPlus className="mr-2 size-4" /> Crear turno</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
