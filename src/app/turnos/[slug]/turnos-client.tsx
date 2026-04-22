'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { Calendar as CalendarIcon, Clock, Scissors, User, MapPin, ChevronLeft, Check, Loader2, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Calendar } from '@/components/ui/calendar'
import { es } from 'date-fns/locale'
import {
  getAvailableSlots,
  createAppointment,
  getPublicBranchAppointmentStaff,
} from '@/lib/actions/appointments'
import type { AppointmentSettings } from '@/lib/types/database'
import type { BarberAvailability } from '@/lib/actions/appointments'

interface Branch {
  id: string
  name: string
  address: string | null
}

interface ServiceOption {
  id: string
  name: string
  price: number
  duration_minutes: number | null
  branch_id: string | null
  booking_mode: string
}

interface PublicBarber {
  id: string
  full_name: string
  avatar_url: string | null
}

interface Props {
  org: { id: string; name: string; slug: string; logo_url: string | null }
  branches: Branch[]
  services: ServiceOption[]
  settings: AppointmentSettings
  initialBranchId: string | null
}

type Step = 'branch' | 'service' | 'datetime' | 'client' | 'summary' | 'success'

function normalizeHex(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value) ? value : fallback
}

function formatDateISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function TurnosClient({ org, branches, services, settings, initialBranchId }: Props) {
  const primary = normalizeHex(settings.brand_primary_color, '#0f172a')
  const bg = normalizeHex(settings.brand_bg_color, '#ffffff')
  const textColor = normalizeHex(settings.brand_text_color, '#0f172a')

  const preselectedBranch = initialBranchId ?? (branches.length === 1 ? branches[0].id : '')

  const [step, setStep] = useState<Step>(preselectedBranch ? 'service' : 'branch')
  const [branchId, setBranchId] = useState(preselectedBranch)
  const [serviceId, setServiceId] = useState('')
  const [barberFilter, setBarberFilter] = useState<string | null>(null) // null = cualquiera
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined)
  const [selectedTime, setSelectedTime] = useState('')
  const [selectedBarberId, setSelectedBarberId] = useState<string | null>(null)
  const [selectedBarberName, setSelectedBarberName] = useState('')
  const [clientName, setClientName] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [durationMinutes, setDurationMinutes] = useState(settings.slot_interval_minutes)
  const [availability, setAvailability] = useState<BarberAvailability[]>([])
  const [publicBarbers, setPublicBarbers] = useState<PublicBarber[]>([])
  const [loadingBarbers, setLoadingBarbers] = useState(false)
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  const selectedBranch = branches.find(b => b.id === branchId)
  const selectedService = services.find(s => s.id === serviceId)
  const filteredServices = branchId
    ? services.filter(s => !s.branch_id || s.branch_id === branchId)
    : services

  const today = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])
  const maxDate = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + settings.max_advance_days)
    d.setHours(23, 59, 59, 999)
    return d
  }, [settings.max_advance_days])

  // Cargar barberos públicos cuando seleccionamos sucursal+servicio (para poder filtrar)
  useEffect(() => {
    if (step !== 'datetime' || !branchId) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingBarbers(true)
    getPublicBranchAppointmentStaff(branchId).then((list) => {
      if (cancelled) return
      setPublicBarbers(list)
      setLoadingBarbers(false)
    })
    return () => { cancelled = true }
  }, [step, branchId])

  // Cargar slots cuando cambia fecha o filtro de barbero
  useEffect(() => {
    if (step !== 'datetime' || !selectedDate || !branchId || !serviceId) return
    let cancelled = false
    const dateStr = formatDateISO(selectedDate)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingSlots(true)
    setError('')
    getAvailableSlots(branchId, dateStr, serviceId, barberFilter ?? undefined).then((result) => {
      if (cancelled) return
      setAvailability(result.slots)
      if (result.error) setError(result.error)
      setLoadingSlots(false)
    })
    return () => { cancelled = true }
  }, [step, selectedDate, branchId, serviceId, barberFilter])

  function handleSelectBranch(id: string) {
    setBranchId(id)
    setStep('service')
  }

  function handleSelectService(id: string) {
    setServiceId(id)
    const svc = services.find(s => s.id === id)
    if (svc?.duration_minutes) setDurationMinutes(svc.duration_minutes)
    setStep('datetime')
  }

  function handleSelectSlot(time: string, barber: BarberAvailability) {
    setSelectedTime(time)
    setSelectedBarberId(barber.barberId)
    setSelectedBarberName(barber.barberName)
    setStep('client')
  }

  function handleClientSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!clientName.trim() || !clientPhone.trim()) return
    setStep('summary')
  }

  function handleConfirm() {
    setError('')
    if (!selectedDate) { setError('Seleccioná una fecha'); return }
    startTransition(async () => {
      const result = await createAppointment({
        branchId,
        clientPhone: clientPhone.trim(),
        clientName: clientName.trim(),
        barberId: selectedBarberId,
        serviceId,
        appointmentDate: formatDateISO(selectedDate),
        startTime: selectedTime,
        durationMinutes,
        source: 'public',
      })
      if (result.error) setError(result.error)
      else setStep('success')
    })
  }

  function goBack() {
    const steps: Step[] = ['branch', 'service', 'datetime', 'client', 'summary']
    const currentIndex = steps.indexOf(step)
    if (currentIndex > 0) {
      const prevStep = steps[currentIndex - 1]
      if (prevStep === 'branch' && preselectedBranch) return
      setStep(prevStep)
    }
  }

  const dateFormatted = selectedDate
    ? selectedDate.toLocaleDateString('es-AR', {
        weekday: 'long', day: 'numeric', month: 'long',
      })
    : ''

  // Estilos dependientes de la marca
  const surfaceStyle = useMemo(
    () => ({ backgroundColor: bg, color: textColor }),
    [bg, textColor]
  )
  const primaryBtnStyle = useMemo(
    () => ({ backgroundColor: primary, color: bg }),
    [primary, bg]
  )
  const mutedTextStyle = { color: textColor, opacity: 0.7 }

  // Ancho del contenedor: más grande en el paso datetime, más estrecho en el resto
  const containerWidthClass = step === 'datetime'
    ? 'w-full max-w-4xl'
    : 'w-full max-w-lg'

  // Dias deshabilitados en el calendario
  const disabledDays = useMemo(() => [
    { before: today },
    { after: maxDate },
    (date: Date) => !settings.appointment_days.includes(date.getDay()),
  ], [today, maxDate, settings.appointment_days])

  // Barberos que tienen al menos un slot disponible (para resaltar en el listado)
  const availableByBarber = useMemo(() => {
    const map = new Map<string, number>()
    for (const b of availability) {
      const count = b.slots.filter(s => s.available).length
      map.set(b.barberId, count)
    }
    return map
  }, [availability])

  return (
    <div
      className="flex min-h-screen items-start justify-center p-4 sm:items-center"
      style={{ backgroundColor: bg }}
    >
      <div
        className={`${containerWidthClass} overflow-hidden rounded-xl border shadow-sm`}
        style={surfaceStyle}
      >
        <div className="px-6 pt-6 text-center">
          {org.logo_url ? (
            <img src={org.logo_url} alt={org.name} className="mx-auto mb-2 h-12 w-12 rounded-full object-cover" />
          ) : (
            <div
              className="mx-auto mb-2 h-12 w-12 rounded-full"
              style={{ backgroundColor: primary, opacity: 0.15 }}
            />
          )}
          <h1 className="text-xl font-semibold" style={{ color: textColor }}>{org.name}</h1>
          <p className="text-sm" style={mutedTextStyle}>Reservá tu turno</p>
          {settings.welcome_message && step === (preselectedBranch ? 'service' : 'branch') && (
            <p className="mx-auto mt-2 max-w-xs text-sm" style={{ color: textColor, opacity: 0.85 }}>
              {settings.welcome_message}
            </p>
          )}
        </div>

        <div className="p-6">
          {step !== 'branch' && step !== 'success' && (
            <button
              type="button"
              onClick={goBack}
              className="mb-4 inline-flex items-center gap-1 text-sm opacity-70 hover:opacity-100"
              style={{ color: textColor }}
            >
              <ChevronLeft className="h-4 w-4" /> Volver
            </button>
          )}

          {error && (
            <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>
          )}

          {step === 'branch' && (
            <div className="space-y-3">
              <h3 className="flex items-center gap-2 font-medium" style={{ color: textColor }}>
                <MapPin className="h-4 w-4" /> Elegí la sucursal
              </h3>
              {branches.map(b => (
                <button
                  key={b.id}
                  onClick={() => handleSelectBranch(b.id)}
                  className="w-full rounded-lg border p-4 text-left transition-colors hover:opacity-90"
                  style={{ borderColor: 'rgba(0,0,0,0.1)' }}
                >
                  <p className="font-medium" style={{ color: textColor }}>{b.name}</p>
                  {b.address && <p className="text-sm" style={mutedTextStyle}>{b.address}</p>}
                </button>
              ))}
            </div>
          )}

          {step === 'service' && (
            <div className="space-y-3">
              <h3 className="flex items-center gap-2 font-medium" style={{ color: textColor }}>
                <Scissors className="h-4 w-4" /> Elegí el servicio
              </h3>
              {filteredServices.map(s => (
                <button
                  key={s.id}
                  onClick={() => handleSelectService(s.id)}
                  className="w-full rounded-lg border p-4 text-left transition-colors hover:opacity-90"
                  style={{ borderColor: 'rgba(0,0,0,0.1)' }}
                >
                  <div className="flex items-center justify-between">
                    <p className="font-medium" style={{ color: textColor }}>{s.name}</p>
                    <Badge variant="secondary">${s.price.toLocaleString('es-AR')}</Badge>
                  </div>
                  {s.duration_minutes && (
                    <p className="text-sm" style={mutedTextStyle}>{s.duration_minutes} min</p>
                  )}
                </button>
              ))}
              {filteredServices.length === 0 && (
                <p className="py-4 text-center text-sm" style={mutedTextStyle}>
                  No hay servicios disponibles en esta sucursal.
                </p>
              )}
            </div>
          )}

          {step === 'datetime' && (
            <div className="space-y-4">
              <div>
                <h3 className="flex items-center gap-2 font-medium" style={{ color: textColor }}>
                  <CalendarIcon className="h-4 w-4" /> Elegí día y horario
                </h3>
                {selectedService && (
                  <p className="mt-1 text-xs" style={mutedTextStyle}>
                    {selectedService.name} · {durationMinutes} min · ${selectedService.price.toLocaleString('es-AR')}
                  </p>
                )}
              </div>

              {/* Filtro de profesional */}
              {publicBarbers.length > 1 && (
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5 text-xs" style={mutedTextStyle}>
                    <Users className="h-3.5 w-3.5" /> Profesional
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setBarberFilter(null)}
                      className="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
                      style={
                        barberFilter === null
                          ? { backgroundColor: primary, color: bg, borderColor: primary }
                          : { borderColor: 'rgba(0,0,0,0.15)', color: textColor }
                      }
                    >
                      Cualquiera
                    </button>
                    {publicBarbers.map(b => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => setBarberFilter(b.id)}
                        className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
                        style={
                          barberFilter === b.id
                            ? { backgroundColor: primary, color: bg, borderColor: primary }
                            : { borderColor: 'rgba(0,0,0,0.15)', color: textColor }
                        }
                      >
                        {b.avatar_url ? (
                          <img src={b.avatar_url} alt="" className="h-4 w-4 rounded-full object-cover" />
                        ) : (
                          <User className="h-3 w-3" />
                        )}
                        {b.full_name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid gap-5 md:grid-cols-[auto_1fr]">
                {/* Calendario grande — forzamos fondo claro neutral para que no compita con brand colors */}
                <div
                  className="flex justify-center rounded-lg border bg-white p-2 text-slate-900 md:p-3"
                  style={{ borderColor: 'rgba(0,0,0,0.08)' }}
                >
                  <Calendar
                    mode="single"
                    locale={es}
                    selected={selectedDate}
                    onSelect={(d) => {
                      setSelectedDate(d)
                      setAvailability([])
                    }}
                    disabled={disabledDays}
                    defaultMonth={selectedDate ?? today}
                    className="!bg-transparent [--cell-size:--spacing(10)] sm:[--cell-size:--spacing(11)]"
                    classNames={{
                      day: 'group/day relative aspect-square h-full w-full p-0 text-center select-none text-slate-900',
                      weekday: 'flex-1 rounded-md text-[0.8rem] font-normal text-slate-500 select-none',
                      caption_label: 'font-medium select-none text-sm text-slate-900',
                      today: 'rounded-md bg-slate-100 text-slate-900 data-[selected=true]:rounded-none',
                      outside: 'text-slate-400 aria-selected:text-slate-400',
                      disabled: 'text-slate-300 opacity-50',
                    }}
                  />
                </div>

                {/* Panel de slots */}
                <div className="min-h-0">
                  {!selectedDate ? (
                    <div
                      className="flex h-full min-h-[240px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center"
                      style={{ borderColor: 'rgba(0,0,0,0.15)' }}
                    >
                      <CalendarIcon className="h-8 w-8 opacity-40" style={{ color: textColor }} />
                      <p className="text-sm" style={mutedTextStyle}>
                        Elegí una fecha en el calendario para ver los turnos disponibles.
                      </p>
                    </div>
                  ) : loadingSlots || loadingBarbers ? (
                    <div className="flex h-full min-h-[240px] items-center justify-center">
                      <Loader2 className="h-6 w-6 animate-spin" style={{ color: textColor, opacity: 0.5 }} />
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4" style={{ color: textColor, opacity: 0.7 }} />
                        <p className="text-sm font-medium capitalize" style={{ color: textColor }}>
                          {dateFormatted}
                        </p>
                      </div>

                      {availability.length === 0 || availability.every(b => b.slots.every(s => !s.available)) ? (
                        <div
                          className="rounded-lg border border-dashed p-6 text-center"
                          style={{ borderColor: 'rgba(0,0,0,0.15)' }}
                        >
                          <p className="text-sm" style={mutedTextStyle}>
                            No hay horarios disponibles para esta fecha.
                          </p>
                          <p className="mt-1 text-xs" style={mutedTextStyle}>
                            Probá con otro día o profesional.
                          </p>
                        </div>
                      ) : (
                        availability.map(barber => {
                          const availableCount = availableByBarber.get(barber.barberId) ?? 0
                          if (availableCount === 0) return null
                          const pubBarber = publicBarbers.find(b => b.id === barber.barberId)
                          return (
                            <div
                              key={barber.barberId}
                              className="rounded-lg border p-3"
                              style={{ borderColor: 'rgba(0,0,0,0.1)' }}
                            >
                              <div className="mb-2 flex items-center gap-2">
                                {pubBarber?.avatar_url ? (
                                  <img src={pubBarber.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" />
                                ) : (
                                  <div
                                    className="flex h-7 w-7 items-center justify-center rounded-full"
                                    style={{ backgroundColor: primary, opacity: 0.15 }}
                                  >
                                    <User className="h-3.5 w-3.5" style={{ color: primary }} />
                                  </div>
                                )}
                                <p className="text-sm font-medium" style={{ color: textColor }}>
                                  {barber.barberName}
                                </p>
                                <Badge variant="secondary" className="ml-auto text-[10px]">
                                  {availableCount} disp.
                                </Badge>
                              </div>
                              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-5">
                                {barber.slots.filter(s => s.available).map(slot => (
                                  <button
                                    key={slot.time}
                                    type="button"
                                    onClick={() => handleSelectSlot(slot.time, barber)}
                                    className="rounded-md border px-2 py-1.5 text-xs font-medium transition-colors hover:opacity-80"
                                    style={{ borderColor: primary, color: primary }}
                                  >
                                    {slot.time}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )
                        })
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {step === 'client' && (
            <form onSubmit={handleClientSubmit} className="space-y-4">
              <h3 className="flex items-center gap-2 font-medium" style={{ color: textColor }}>
                <User className="h-4 w-4" /> Tus datos
              </h3>
              <div
                className="rounded-md border p-3 text-xs"
                style={{ borderColor: 'rgba(0,0,0,0.1)' }}
              >
                <p style={mutedTextStyle}>
                  <strong style={{ color: textColor }}>{selectedService?.name}</strong> · <span className="capitalize">{dateFormatted}</span> · {selectedTime} · {selectedBarberName}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="name" style={{ color: textColor }}>Nombre</Label>
                <Input
                  id="name"
                  value={clientName}
                  onChange={e => setClientName(e.target.value)}
                  placeholder="Tu nombre"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone" style={{ color: textColor }}>Teléfono</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={clientPhone}
                  onChange={e => setClientPhone(e.target.value)}
                  placeholder="Ej: 3584402511"
                  required
                />
              </div>
              <button
                type="submit"
                className="w-full rounded-md px-4 py-2 text-sm font-medium"
                style={primaryBtnStyle}
              >
                Continuar
              </button>
            </form>
          )}

          {step === 'summary' && (
            <div className="space-y-4">
              <h3 className="flex items-center gap-2 font-medium" style={{ color: textColor }}>
                <Check className="h-4 w-4" /> Confirmá tu turno
              </h3>
              <div
                className="space-y-2 rounded-lg p-4 text-sm"
                style={{ backgroundColor: primary, color: bg, opacity: 0.95 }}
              >
                <p><strong>Sucursal:</strong> {selectedBranch?.name}</p>
                <p><strong>Servicio:</strong> {selectedService?.name}</p>
                <p><strong>Profesional:</strong> {selectedBarberName}</p>
                <p><strong>Fecha:</strong> <span className="capitalize">{dateFormatted}</span></p>
                <p><strong>Hora:</strong> {selectedTime}</p>
                <p><strong>Duración:</strong> {durationMinutes} min</p>
                <p><strong>Nombre:</strong> {clientName}</p>
                <p><strong>Teléfono:</strong> {clientPhone}</p>
              </div>
              <Button
                onClick={handleConfirm}
                disabled={isPending}
                className="w-full"
                style={primaryBtnStyle}
              >
                {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Confirmar turno
              </Button>
            </div>
          )}

          {step === 'success' && (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                <Check className="h-8 w-8 text-green-600" />
              </div>
              <h3 className="text-lg font-semibold" style={{ color: textColor }}>¡Turno confirmado!</h3>
              <p className="text-sm" style={mutedTextStyle}>
                Tu turno para <strong>{selectedService?.name}</strong> el <strong className="capitalize">{dateFormatted}</strong> a las <strong>{selectedTime}</strong> fue registrado.
              </p>
              <p className="text-sm" style={mutedTextStyle}>
                Recibirás un mensaje de confirmación y un recordatorio antes de tu turno.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
