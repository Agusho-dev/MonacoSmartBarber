'use client'

import { useState, useEffect, useCallback, useMemo, useTransition } from 'react'
import { CalendarPlus, ChevronLeft, ChevronRight, Clock, Loader2, User } from 'lucide-react'
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
  getAvailableSlots,
  createAppointment,
} from '@/lib/actions/appointments'
import type { GridBarber } from './appointments-grid-view'
import type { BarberAvailability } from '@/lib/actions/appointments'
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

function formatTimeHM(t: string) { return t.slice(0, 5) }

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
  const [barberId, setBarberId] = useState<string>('')
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
  const [selectedTime, setSelectedTime] = useState<string | null>(null)

  const [settings, setSettings] = useState<AppointmentSettings | null>(null)
  const [barbers, setBarbers] = useState<GridBarber[]>([])
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [availability, setAvailability] = useState<BarberAvailability[]>([])
  const [loadingInit, setLoadingInit] = useState(false)
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(clientName ?? '')
    setPhone(clientPhone ?? '')
    setError('')
  }, [open, clientName, clientPhone])

  // Servicios disponibles para gestión manual (self_service y both también se pueden cargar manual)
  const availableServices = useMemo(
    () => services.filter(s => !s.branch_id || !branchId || s.branch_id === branchId),
    [services, branchId],
  )

  const selectedService = useMemo(
    () => services.find(s => s.id === serviceId) ?? null,
    [services, serviceId],
  )

  const selectedBarber = useMemo(
    () => barbers.find(b => b.id === barberId) ?? null,
    [barbers, barberId],
  )

  // Carga inicial (branch + date): barberos, turnos del día, settings
  const loadInit = useCallback(async () => {
    if (!branchId || !date) return
    setLoadingInit(true)
    setSelectedTime(null)
    const [staffList, apts, cfg] = await Promise.all([
      getBranchAppointmentStaff(branchId),
      getAppointmentsForDate(branchId, date),
      getAppointmentSettings(undefined, branchId),
    ])
    setBarbers(staffList)
    setAppointments(apts)
    setSettings(cfg)
    // Si el barbero seleccionado ya no está en la lista, limpiar
    setBarberId(prev => staffList.some(s => s.id === prev) ? prev : '')
    setLoadingInit(false)
  }, [branchId, date])

  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadInit()
  }, [open, loadInit])

  // Carga de slots disponibles cuando hay barbero + servicio + fecha
  useEffect(() => {
    if (!open || !branchId || !serviceId || !barberId || !date) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAvailability([])
      return
    }
    let cancelled = false
    setLoadingSlots(true)
    setSelectedTime(null)
    getAvailableSlots(branchId, date, serviceId, barberId).then(res => {
      if (cancelled) return
      setAvailability(res.slots)
      if (res.error) setError(res.error)
      setLoadingSlots(false)
    })
    return () => { cancelled = true }
  }, [open, branchId, serviceId, barberId, date])

  function shiftDate(days: number) {
    const d = new Date(date + 'T12:00:00')
    d.setDate(d.getDate() + days)
    setDate(d.toISOString().split('T')[0])
  }

  function handleBook() {
    setError('')
    if (!branchId) { setError('Seleccioná una sucursal'); return }
    if (!serviceId) { setError('Seleccioná un servicio'); return }
    if (!barberId) { setError('Seleccioná un profesional'); return }
    if (!name.trim()) { setError('Ingresá el nombre del cliente'); return }
    if (!phone.trim()) { setError('Ingresá el teléfono del cliente'); return }
    if (!selectedTime) { setError('Seleccioná un horario'); return }

    startTransition(async () => {
      const result = await createAppointment({
        branchId,
        clientPhone: phone.trim(),
        clientName: name.trim(),
        barberId,
        serviceId,
        appointmentDate: date,
        startTime: selectedTime,
        durationMinutes: selectedService?.duration_minutes ?? 30,
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

  // Turnos existentes del barbero seleccionado para mostrar contexto
  const barberAppointments = useMemo(() => {
    if (!barberId) return []
    return appointments
      .filter(a => a.barber_id === barberId && a.status !== 'cancelled' && a.status !== 'no_show')
      .sort((a, b) => a.start_time.localeCompare(b.start_time))
  }, [appointments, barberId])

  // Slots disponibles del barbero seleccionado
  const barberSlots = useMemo(() => {
    const found = availability.find(a => a.barberId === barberId)
    return found?.slots.filter(s => s.available) ?? []
  }, [availability, barberId])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(92vh,820px)] max-h-[92vh] w-[min(96vw,1100px)] !max-w-[1100px] flex-col p-0 sm:!max-w-[1100px]">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus className="size-4" />
            Agendar turno
          </DialogTitle>
          <DialogDescription className="text-xs">
            Completá los datos y seleccioná un horario disponible.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[340px_1fr]">
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
                      No hay servicios disponibles.
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
              <Label className="text-xs">Profesional</Label>
              <Select value={barberId} onValueChange={setBarberId} disabled={barbers.length === 0}>
                <SelectTrigger>
                  <SelectValue placeholder={barbers.length === 0 ? 'Sin profesionales' : 'Elegir profesional'} />
                </SelectTrigger>
                <SelectContent>
                  {barbers.map(b => (
                    <SelectItem key={b.id} value={b.id}>{b.full_name}</SelectItem>
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
              <p className="mb-1 font-medium">Horario seleccionado</p>
              {selectedTime ? (
                <p className="font-mono">
                  {selectedTime} · {selectedBarber?.full_name ?? '—'}
                </p>
              ) : (
                <p className="text-muted-foreground">Elegí un horario disponible →</p>
              )}
            </div>

            {error && (
              <div className="rounded-md bg-red-500/10 p-2 text-xs text-red-600">{error}</div>
            )}
          </aside>

          <div className="flex min-h-0 min-w-0 flex-col overflow-y-auto p-4">
            {loadingInit ? (
              <div className="flex flex-1 items-center justify-center py-16">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : !branchId ? (
              <div className="flex flex-1 items-center justify-center text-center text-sm text-muted-foreground">
                Elegí una sucursal para continuar.
              </div>
            ) : !settings?.is_enabled ? (
              <div className="flex flex-1 items-center justify-center text-center text-sm text-muted-foreground">
                El sistema de turnos no está habilitado.
              </div>
            ) : barbers.length === 0 ? (
              <div className="flex flex-1 items-center justify-center text-center text-sm text-muted-foreground">
                No hay profesionales habilitados para turnos en esta sucursal.
              </div>
            ) : !serviceId ? (
              <div className="flex flex-1 items-center justify-center text-center text-sm text-muted-foreground">
                Elegí un servicio para ver los horarios disponibles.
              </div>
            ) : !barberId ? (
              <div className="flex flex-1 items-center justify-center text-center text-sm text-muted-foreground">
                Elegí un profesional para ver sus horarios disponibles.
              </div>
            ) : (
              <div className="space-y-5">
                {/* Slots disponibles */}
                <section>
                  <div className="mb-2 flex items-center gap-2">
                    <Clock className="size-4 text-muted-foreground" />
                    <h4 className="text-sm font-semibold">
                      Horarios disponibles
                    </h4>
                    <Badge variant="outline" className="text-[10px]">
                      {barberSlots.length} libres
                    </Badge>
                  </div>
                  {loadingSlots ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="size-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : barberSlots.length === 0 ? (
                    <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                      No hay horarios disponibles para el profesional en esta fecha.
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
                      {barberSlots.map(slot => {
                        const isSelected = selectedTime === slot.time
                        return (
                          <button
                            key={slot.time}
                            type="button"
                            onClick={() => setSelectedTime(slot.time)}
                            className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                              isSelected
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-border hover:border-primary/50 hover:bg-primary/5'
                            }`}
                          >
                            {slot.time}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </section>

                {/* Turnos ya existentes del barbero en ese día */}
                <section>
                  <div className="mb-2 flex items-center gap-2">
                    <User className="size-4 text-muted-foreground" />
                    <h4 className="text-sm font-semibold">
                      Agenda del día — {selectedBarber?.full_name}
                    </h4>
                    <Badge variant="outline" className="text-[10px]">
                      {barberAppointments.length} turnos
                    </Badge>
                  </div>
                  {barberAppointments.length === 0 ? (
                    <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                      Sin turnos cargados.
                    </p>
                  ) : (
                    <ul className="divide-y rounded-md border">
                      {barberAppointments.map(a => (
                        <li key={a.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                          <span className="font-mono font-semibold w-20">
                            {formatTimeHM(a.start_time)}–{formatTimeHM(a.end_time)}
                          </span>
                          <span className="flex-1 truncate">
                            {a.client?.name ?? 'Cliente'}
                            {a.service?.name && (
                              <span className="text-muted-foreground"> · {a.service.name}</span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex-col items-stretch gap-2 border-t px-5 py-3 sm:flex-row sm:items-center sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button onClick={handleBook} disabled={isPending || !selectedTime}>
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
