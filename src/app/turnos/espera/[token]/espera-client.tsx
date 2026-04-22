'use client'

import { useState, useEffect, useTransition } from 'react'
import { Hourglass, Loader2, Check, MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getAvailableSlots, createAppointment } from '@/lib/actions/appointments'
import { markWaitlistBooked } from '@/lib/actions/waitlist'
import type { AppointmentWaitlist } from '@/lib/types/database'

interface AvailableOption {
  date: string
  time: string
  barberId: string
  barberName: string
}

export function EsperaClient({ entry }: { entry: AppointmentWaitlist }) {
  const [loading, setLoading] = useState(true)
  const [options, setOptions] = useState<AvailableOption[]>([])
  const [picked, setPicked] = useState<string>('')
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    let alive = true
    ;(async () => {
      const from = new Date(entry.preferred_date_from + 'T12:00:00')
      const to = new Date(entry.preferred_date_to + 'T12:00:00')
      const dates: string[] = []
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        dates.push(d.toISOString().split('T')[0])
      }

      const found: AvailableOption[] = []
      for (const dateStr of dates) {
        const { slots } = await getAvailableSlots(
          entry.branch_id,
          dateStr,
          entry.service_id ?? undefined,
          entry.barber_id ?? undefined,
        )
        for (const barber of slots) {
          for (const slot of barber.slots) {
            if (slot.available) {
              found.push({
                date: dateStr,
                time: slot.time,
                barberId: barber.barberId,
                barberName: barber.barberName,
              })
              if (found.length >= 30) break
            }
          }
          if (found.length >= 30) break
        }
        if (found.length >= 30) break
      }

      if (alive) {
        setOptions(found)
        setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [entry])

  function handleConfirm() {
    setError('')
    const option = options.find((o) => `${o.date}|${o.time}|${o.barberId}` === picked)
    if (!option) { setError('Elegí un horario'); return }
    if (!entry.client) { setError('Cliente no encontrado'); return }

    startTransition(async () => {
      const result = await createAppointment({
        branchId: entry.branch_id,
        clientPhone: entry.client!.phone,
        clientName: entry.client!.name,
        barberId: option.barberId,
        serviceId: entry.service_id ?? '',
        appointmentDate: option.date,
        startTime: option.time,
        durationMinutes: entry.service?.duration_minutes ?? 30,
        source: 'public',
      })

      if (result.error || !result.appointment) {
        setError(result.error ?? 'Error al crear turno')
        return
      }

      await markWaitlistBooked(entry.id, result.appointment.id)
      setConfirmed(true)
    })
  }

  if (confirmed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
              <Check className="h-8 w-8 text-green-600" />
            </div>
            <h2 className="mb-2 text-lg font-semibold">¡Turno confirmado!</h2>
            <p className="text-sm text-muted-foreground">Te esperamos en {entry.branch?.name ?? 'el local'}.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Hourglass className="size-4" />
            Horarios disponibles
          </CardTitle>
          {entry.branch?.name && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="size-3" />
              {entry.branch.name}
              {entry.branch.address && ` · ${entry.branch.address}`}
            </div>
          )}
          <Badge variant="secondary" className="w-fit text-[10px]">
            Válido hasta {entry.notification_expires_at
              ? new Date(entry.notification_expires_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
              : '—'}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : options.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Lo sentimos, ya no hay horarios disponibles en tu rango preferido. Escribinos para coordinar.
            </p>
          ) : (
            <>
              <Select value={picked} onValueChange={setPicked}>
                <SelectTrigger><SelectValue placeholder="Elegí un horario" /></SelectTrigger>
                <SelectContent>
                  {options.map((o) => (
                    <SelectItem
                      key={`${o.date}|${o.time}|${o.barberId}`}
                      value={`${o.date}|${o.time}|${o.barberId}`}
                    >
                      {o.date} · {o.time} · {o.barberName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {error && <p className="text-xs text-red-500">{error}</p>}
              <Button className="w-full" onClick={handleConfirm} disabled={isPending || !picked}>
                {isPending ? <><Loader2 className="mr-2 size-4 animate-spin" /> Confirmando…</> : 'Confirmar turno'}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
