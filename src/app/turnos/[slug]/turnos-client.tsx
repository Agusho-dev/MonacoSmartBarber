'use client'

import { useState, useTransition } from 'react'
import { Calendar, Clock, Scissors, User, MapPin, ChevronLeft, Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { getAvailableSlots, createAppointment } from '@/lib/actions/appointments'
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

interface Props {
  org: { id: string; name: string; slug: string; logo_url: string | null }
  branches: Branch[]
  services: ServiceOption[]
  settings: AppointmentSettings
}

type Step = 'branch' | 'service' | 'barber' | 'date' | 'time' | 'client' | 'summary' | 'success'

export function TurnosClient({ org, branches, services, settings }: Props) {
  const [step, setStep] = useState<Step>(branches.length === 1 ? 'service' : 'branch')
  const [branchId, setBranchId] = useState(branches.length === 1 ? branches[0].id : '')
  const [serviceId, setServiceId] = useState('')
  const [barberId, setBarberId] = useState<string | null>(null)
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [barberName, setBarberName] = useState('')
  const [clientName, setClientName] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [durationMinutes, setDurationMinutes] = useState(settings.slot_interval_minutes)
  const [availability, setAvailability] = useState<BarberAvailability[]>([])
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
      if (result.error) {
        setError(result.error)
      } else {
        setStep('success')
      }
    })
  }

  function goBack() {
    const steps: Step[] = ['branch', 'service', 'barber', 'date', 'time', 'client', 'summary']
    const currentIndex = steps.indexOf(step)
    if (currentIndex > 0) {
      let prevStep = steps[currentIndex - 1]
      if (prevStep === 'branch' && branches.length === 1) return
      setStep(prevStep)
    }
  }

  const dateFormatted = date
    ? new Date(date + 'T12:00:00').toLocaleDateString('es-AR', {
        weekday: 'long', day: 'numeric', month: 'long',
      })
    : ''

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          {org.logo_url && (
            <img src={org.logo_url} alt={org.name} className="mx-auto mb-2 h-12 w-12 rounded-full object-cover" />
          )}
          <CardTitle className="text-xl">{org.name}</CardTitle>
          <p className="text-sm text-muted-foreground">Reservá tu turno</p>
        </CardHeader>

        <CardContent>
          {step !== 'branch' && step !== 'success' && (
            <Button variant="ghost" size="sm" onClick={goBack} className="mb-4">
              <ChevronLeft className="mr-1 h-4 w-4" /> Volver
            </Button>
          )}

          {error && (
            <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>
          )}

          {step === 'branch' && (
            <div className="space-y-3">
              <h3 className="flex items-center gap-2 font-medium"><MapPin className="h-4 w-4" /> Elegí la sucursal</h3>
              {branches.map(b => (
                <button
                  key={b.id}
                  onClick={() => handleSelectBranch(b.id)}
                  className="w-full rounded-lg border p-4 text-left transition-colors hover:bg-accent"
                >
                  <p className="font-medium">{b.name}</p>
                  {b.address && <p className="text-sm text-muted-foreground">{b.address}</p>}
                </button>
              ))}
            </div>
          )}

          {step === 'service' && (
            <div className="space-y-3">
              <h3 className="flex items-center gap-2 font-medium"><Scissors className="h-4 w-4" /> Elegí el servicio</h3>
              {filteredServices.map(s => (
                <button
                  key={s.id}
                  onClick={() => handleSelectService(s.id)}
                  className="w-full rounded-lg border p-4 text-left transition-colors hover:bg-accent"
                >
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{s.name}</p>
                    <Badge variant="secondary">${s.price.toLocaleString('es-AR')}</Badge>
                  </div>
                  {s.duration_minutes && (
                    <p className="text-sm text-muted-foreground">{s.duration_minutes} min</p>
                  )}
                </button>
              ))}
            </div>
          )}

          {step === 'barber' && (
            <div className="space-y-3">
              <h3 className="flex items-center gap-2 font-medium"><User className="h-4 w-4" /> Elegí el profesional</h3>
              <button
                onClick={() => handleSelectBarber(null, 'Cualquier disponible')}
                className="w-full rounded-lg border p-4 text-left transition-colors hover:bg-accent"
              >
                <p className="font-medium">Cualquier disponible</p>
                <p className="text-sm text-muted-foreground">Se asignará automáticamente</p>
              </button>
              {/* Los barberos se cargarán al seleccionar fecha ya que dependen de la disponibilidad */}
            </div>
          )}

          {step === 'date' && (
            <div className="space-y-3">
              <h3 className="flex items-center gap-2 font-medium"><Calendar className="h-4 w-4" /> Elegí la fecha</h3>
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
              <h3 className="flex items-center gap-2 font-medium">
                <Clock className="h-4 w-4" /> Elegí el horario — {dateFormatted}
              </h3>
              {loading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                availability.map(barber => {
                  const availableSlots = barber.slots.filter(s => s.available)
                  if (!availableSlots.length) return null
                  return (
                    <div key={barber.barberId} className="space-y-2">
                      {!barberId && (
                        <p className="text-sm font-medium text-muted-foreground">{barber.barberName}</p>
                      )}
                      <div className="grid grid-cols-4 gap-2">
                        {barber.slots.map(slot => (
                          <button
                            key={slot.time}
                            disabled={!slot.available}
                            onClick={() => handleSelectTime(slot.time, barber.barberId, barber.barberName)}
                            className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                              slot.available
                                ? 'hover:bg-primary hover:text-primary-foreground'
                                : 'cursor-not-allowed bg-muted text-muted-foreground opacity-50'
                            }`}
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
                <p className="py-4 text-center text-sm text-muted-foreground">No hay horarios disponibles para esta fecha.</p>
              )}
            </div>
          )}

          {step === 'client' && (
            <form onSubmit={handleClientSubmit} className="space-y-4">
              <h3 className="flex items-center gap-2 font-medium"><User className="h-4 w-4" /> Tus datos</h3>
              <div className="space-y-2">
                <Label htmlFor="name">Nombre</Label>
                <Input
                  id="name"
                  value={clientName}
                  onChange={e => setClientName(e.target.value)}
                  placeholder="Tu nombre"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Teléfono</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={clientPhone}
                  onChange={e => setClientPhone(e.target.value)}
                  placeholder="Ej: 3584402511"
                  required
                />
              </div>
              <Button type="submit" className="w-full">Continuar</Button>
            </form>
          )}

          {step === 'summary' && (
            <div className="space-y-4">
              <h3 className="flex items-center gap-2 font-medium"><Check className="h-4 w-4" /> Confirmá tu turno</h3>
              <div className="space-y-2 rounded-lg bg-muted p-4 text-sm">
                <p><strong>Sucursal:</strong> {selectedBranch?.name}</p>
                <p><strong>Servicio:</strong> {selectedService?.name}</p>
                <p><strong>Profesional:</strong> {barberName}</p>
                <p><strong>Fecha:</strong> {dateFormatted}</p>
                <p><strong>Hora:</strong> {time}</p>
                <p><strong>Duración:</strong> {durationMinutes} min</p>
                <p><strong>Nombre:</strong> {clientName}</p>
                <p><strong>Teléfono:</strong> {clientPhone}</p>
              </div>
              <Button onClick={handleConfirm} disabled={isPending} className="w-full">
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
              <h3 className="text-lg font-semibold">¡Turno confirmado!</h3>
              <p className="text-sm text-muted-foreground">
                Tu turno para <strong>{selectedService?.name}</strong> el <strong>{dateFormatted}</strong> a las <strong>{time}</strong> fue registrado.
              </p>
              <p className="text-sm text-muted-foreground">
                Recibirás un mensaje de confirmación y un recordatorio antes de tu turno.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
