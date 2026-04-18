'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { Calendar, Clock, Scissors, User, MapPin, ChevronLeft, Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
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

type Step = 'branch' | 'service' | 'barber' | 'date' | 'time' | 'client' | 'summary' | 'success'

function normalizeHex(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value) ? value : fallback
}

export function TurnosClient({ org, branches, services, settings, initialBranchId }: Props) {
  const primary = normalizeHex(settings.brand_primary_color, '#0f172a')
  const bg = normalizeHex(settings.brand_bg_color, '#ffffff')
  const textColor = normalizeHex(settings.brand_text_color, '#0f172a')

  const preselectedBranch = initialBranchId ?? (branches.length === 1 ? branches[0].id : '')

  const [step, setStep] = useState<Step>(preselectedBranch ? 'service' : 'branch')
  const [branchId, setBranchId] = useState(preselectedBranch)
  const [serviceId, setServiceId] = useState('')
  const [barberId, setBarberId] = useState<string | null>(null)
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [barberName, setBarberName] = useState('')
  const [clientName, setClientName] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [durationMinutes, setDurationMinutes] = useState(settings.slot_interval_minutes)
  const [availability, setAvailability] = useState<BarberAvailability[]>([])
  const [publicBarbers, setPublicBarbers] = useState<PublicBarber[]>([])
  const [loadingBarbers, setLoadingBarbers] = useState(false)
  const [loading, setLoading] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  const selectedBranch = branches.find(b => b.id === branchId)
  const selectedService = services.find(s => s.id === serviceId)
  const filteredServices = branchId
    ? services.filter(s => !s.branch_id || s.branch_id === branchId)
    : services

  const today = new Date().toISOString().split('T')[0]
  const maxDate = new Date()
  maxDate.setDate(maxDate.getDate() + settings.max_advance_days)
  const maxDateStr = maxDate.toISOString().split('T')[0]

  // Cargar barberos cuando entramos al paso 'barber'
  useEffect(() => {
    if (step !== 'barber' || !branchId) return
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

  async function loadSlots(selectedDate: string) {
    setLoading(true)
    setError('')
    const result = await getAvailableSlots(branchId, selectedDate, serviceId, barberId ?? undefined)
    setAvailability(result.slots)
    if (result.error) setError(result.error)
    setLoading(false)
  }

  function handleSelectBranch(id: string) {
    setBranchId(id)
    setStep('service')
  }

  function handleSelectService(id: string) {
    setServiceId(id)
    const svc = services.find(s => s.id === id)
    if (svc?.duration_minutes) setDurationMinutes(svc.duration_minutes)
    setStep('barber')
  }

  function handleSelectBarber(id: string | null, name: string) {
    setBarberId(id)
    setBarberName(name)
    setStep('date')
  }

  async function handleSelectDate(selectedDate: string) {
    setDate(selectedDate)
    await loadSlots(selectedDate)
    setStep('time')
  }

  function handleSelectTime(selectedTime: string, selectedBarberId: string, selectedBarberName: string) {
    setTime(selectedTime)
    if (!barberId) {
      setBarberId(selectedBarberId)
      setBarberName(selectedBarberName)
    }
    setStep('client')
  }

  function handleClientSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!clientName.trim() || !clientPhone.trim()) return
    setStep('summary')
  }

  function handleConfirm() {
    setError('')
    startTransition(async () => {
      const result = await createAppointment({
        branchId,
        clientPhone: clientPhone.trim(),
        clientName: clientName.trim(),
        barberId,
        serviceId,
        appointmentDate: date,
        startTime: time,
        durationMinutes,
        source: 'public',
      })
      if (result.error) setError(result.error)
      else setStep('success')
    })
  }

  function goBack() {
    const steps: Step[] = ['branch', 'service', 'barber', 'date', 'time', 'client', 'summary']
    const currentIndex = steps.indexOf(step)
    if (currentIndex > 0) {
      const prevStep = steps[currentIndex - 1]
      if (prevStep === 'branch' && preselectedBranch) return
      setStep(prevStep)
    }
  }

  const dateFormatted = date
    ? new Date(date + 'T12:00:00').toLocaleDateString('es-AR', {
        weekday: 'long', day: 'numeric', month: 'long',
      })
    : ''

  // Estilos que dependen de la marca
  const surfaceStyle = useMemo(
    () => ({ backgroundColor: bg, color: textColor }),
    [bg, textColor]
  )
  const primaryBtnStyle = useMemo(
    () => ({ backgroundColor: primary, color: bg }),
    [primary, bg]
  )
  const mutedTextStyle = { color: textColor, opacity: 0.7 }

  return (
    <div
      className="flex min-h-screen items-start justify-center p-4 sm:items-center"
      style={{ backgroundColor: bg }}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border shadow-sm"
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

          {step === 'barber' && (
            <div className="space-y-3">
              <h3 className="flex items-center gap-2 font-medium" style={{ color: textColor }}>
                <User className="h-4 w-4" /> Elegí el profesional
              </h3>
              <button
                onClick={() => handleSelectBarber(null, 'Cualquier disponible')}
                className="w-full rounded-lg border p-4 text-left transition-colors hover:opacity-90"
                style={{ borderColor: 'rgba(0,0,0,0.1)' }}
              >
                <p className="font-medium" style={{ color: textColor }}>Cualquier disponible</p>
                <p className="text-sm" style={mutedTextStyle}>Se asignará automáticamente</p>
              </button>
              {loadingBarbers ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin" style={{ color: textColor, opacity: 0.5 }} />
                </div>
              ) : (
                publicBarbers.map(b => (
                  <button
                    key={b.id}
                    onClick={() => handleSelectBarber(b.id, b.full_name)}
                    className="flex w-full items-center gap-3 rounded-lg border p-4 text-left transition-colors hover:opacity-90"
                    style={{ borderColor: 'rgba(0,0,0,0.1)' }}
                  >
                    {b.avatar_url ? (
                      <img src={b.avatar_url} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
                    ) : (
                      <div
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                        style={{ backgroundColor: primary, opacity: 0.15 }}
                      >
                        <User className="h-5 w-5" style={{ color: primary }} />
                      </div>
                    )}
                    <p className="font-medium" style={{ color: textColor }}>{b.full_name}</p>
                  </button>
                ))
              )}
            </div>
          )}

          {step === 'date' && (
            <div className="space-y-3">
              <h3 className="flex items-center gap-2 font-medium" style={{ color: textColor }}>
                <Calendar className="h-4 w-4" /> Elegí la fecha
              </h3>
              <Input
                type="date"
                min={today}
                max={maxDateStr}
                value={date}
                onChange={e => handleSelectDate(e.target.value)}
                className="text-lg"
              />
            </div>
          )}

          {step === 'time' && (
            <div className="space-y-3">
              <h3 className="flex items-center gap-2 font-medium" style={{ color: textColor }}>
                <Clock className="h-4 w-4" /> Elegí el horario — {dateFormatted}
              </h3>
              {loading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" style={{ color: textColor, opacity: 0.5 }} />
                </div>
              ) : (
                availability.map(barber => {
                  const availableSlots = barber.slots.filter(s => s.available)
                  if (!availableSlots.length) return null
                  return (
                    <div key={barber.barberId} className="space-y-2">
                      {!barberId && (
                        <p className="text-sm font-medium" style={mutedTextStyle}>{barber.barberName}</p>
                      )}
                      <div className="grid grid-cols-4 gap-2">
                        {barber.slots.map(slot => (
                          <button
                            key={slot.time}
                            disabled={!slot.available}
                            onClick={() => handleSelectTime(slot.time, barber.barberId, barber.barberName)}
                            className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                              slot.available
                                ? 'hover:opacity-90'
                                : 'cursor-not-allowed opacity-30'
                            }`}
                            style={slot.available ? { borderColor: primary, color: primary } : { color: textColor }}
                          >
                            {slot.time}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })
              )}
              {!loading && availability.every(b => b.slots.every(s => !s.available)) && (
                <p className="py-4 text-center text-sm" style={mutedTextStyle}>
                  No hay horarios disponibles para esta fecha.
                </p>
              )}
            </div>
          )}

          {step === 'client' && (
            <form onSubmit={handleClientSubmit} className="space-y-4">
              <h3 className="flex items-center gap-2 font-medium" style={{ color: textColor }}>
                <User className="h-4 w-4" /> Tus datos
              </h3>
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
                <p><strong>Profesional:</strong> {barberName}</p>
                <p><strong>Fecha:</strong> {dateFormatted}</p>
                <p><strong>Hora:</strong> {time}</p>
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
                Tu turno para <strong>{selectedService?.name}</strong> el <strong>{dateFormatted}</strong> a las <strong>{time}</strong> fue registrado.
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
