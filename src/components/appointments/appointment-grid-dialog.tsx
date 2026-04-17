'use client'

import { useState, useTransition } from 'react'
import { Calendar, Clock, Loader2, Scissors, Send, CalendarPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
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
import { getAvailableSlots, createAppointment } from '@/lib/actions/appointments'
import type { BarberAvailability } from '@/lib/actions/appointments'

function generateAvailabilityText(date: string, slots: BarberAvailability[]): string {
  const dateFormatted = new Date(date + 'T12:00:00')
    .toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })

  const availableTimes: string[] = []
  for (const barber of slots) {
    for (const slot of barber.slots) {
      if (slot.available && !availableTimes.includes(slot.time)) {
        availableTimes.push(slot.time)
      }
    }
  }
  availableTimes.sort()

  if (!availableTimes.length) return `No tengo turnos disponibles para el ${dateFormatted}.`
  const timeList = availableTimes.slice(0, 6).join(', ')
  return `Tengo disponible el ${dateFormatted} a las ${timeList}. ¿Cuál te queda mejor?`
}

interface Branch {
  id: string
  name: string
}

interface ServiceOption {
  id: string
  name: string
  price: number
  duration_minutes: number | null
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  branches: Branch[]
  services: ServiceOption[]
  clientId?: string | null
  clientName?: string | null
  clientPhone?: string | null
  onInsertText?: (text: string) => void
  onBooked?: () => void
  staffId?: string
}

export function AppointmentGridDialog({
  open,
  onOpenChange,
  branches,
  services,
  clientId,
  clientName,
  clientPhone,
  onInsertText,
  onBooked,
  staffId,
}: Props) {
  const [branchId, setBranchId] = useState(branches.length === 1 ? branches[0].id : '')
  const [serviceId, setServiceId] = useState('')
  const [date, setDate] = useState('')
  const [availability, setAvailability] = useState<BarberAvailability[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState<{ time: string; barberId: string; barberName: string } | null>(null)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'suggest' | 'book'>('suggest')

  const today = new Date().toISOString().split('T')[0]

  async function handleLoadSlots() {
    if (!branchId || !date) return
    setLoading(true)
    setError('')
    const result = await getAvailableSlots(branchId, date, serviceId || undefined)
    setAvailability(result.slots)
    if (result.error) setError(result.error)
    setLoading(false)
  }

  function handleSuggest() {
    if (!onInsertText) return
    const text = generateAvailabilityText(date, availability)
    onInsertText(text)
    onOpenChange(false)
    resetState()
  }

  function handleBook() {
    if (!selectedSlot || !serviceId) return
    setError('')

    const service = services.find(s => s.id === serviceId)

    startTransition(async () => {
      const result = await createAppointment({
        branchId,
        clientPhone: clientPhone ?? '',
        clientName: clientName ?? '',
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
        resetState()
      }
    })
  }

  function resetState() {
    setDate('')
    setAvailability([])
    setSelectedSlot(null)
    setError('')
    setMode('suggest')
  }

  const dateFormatted = date
    ? new Date(date + 'T12:00:00').toLocaleDateString('es-AR', {
        weekday: 'long', day: 'numeric', month: 'long',
      })
    : ''

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) resetState(); onOpenChange(v) }}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus className="h-5 w-5" />
            Turnos disponibles
          </DialogTitle>
        </DialogHeader>

        {error && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>
        )}

        <div className="space-y-4">
          {branches.length > 1 && (
            <div className="space-y-1.5">
              <Label>Sucursal</Label>
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

          <div className="space-y-1.5">
            <Label>Servicio</Label>
            <Select value={serviceId} onValueChange={setServiceId}>
              <SelectTrigger><SelectValue placeholder="Elegir servicio" /></SelectTrigger>
              <SelectContent>
                {services.map(s => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} — ${s.price.toLocaleString('es-AR')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <Label>Fecha</Label>
              <Input type="date" min={today} value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <Button onClick={handleLoadSlots} disabled={!branchId || !date || loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Buscar'}
            </Button>
          </div>

          {availability.length > 0 && (
            <>
              <p className="text-sm font-medium text-muted-foreground">{dateFormatted}</p>
              {availability.map(barber => {
                const availableSlots = barber.slots.filter(s => s.available)
                if (!availableSlots.length) return null
                return (
                  <div key={barber.barberId} className="space-y-1.5">
                    <p className="text-sm font-medium">{barber.barberName}</p>
                    <div className="grid grid-cols-5 gap-1.5">
                      {barber.slots.map(slot => (
                        <button
                          key={slot.time}
                          disabled={!slot.available}
                          onClick={() => setSelectedSlot({
                            time: slot.time,
                            barberId: barber.barberId,
                            barberName: barber.barberName,
                          })}
                          className={`rounded border px-2 py-1.5 text-xs font-medium transition-colors ${
                            selectedSlot?.time === slot.time && selectedSlot?.barberId === barber.barberId
                              ? 'border-primary bg-primary text-primary-foreground'
                              : slot.available
                                ? 'hover:border-primary hover:bg-primary/5'
                                : 'cursor-not-allowed bg-muted text-muted-foreground opacity-40'
                          }`}
                        >
                          {slot.time}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}

              <div className="flex gap-2 border-t pt-3">
                {onInsertText && (
                  <Button variant="outline" className="flex-1" onClick={handleSuggest}>
                    <Send className="mr-2 h-4 w-4" />
                    Sugerir horarios
                  </Button>
                )}
                {clientPhone && serviceId && selectedSlot && (
                  <Button className="flex-1" onClick={handleBook} disabled={isPending}>
                    {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarPlus className="mr-2 h-4 w-4" />}
                    Crear turno
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
