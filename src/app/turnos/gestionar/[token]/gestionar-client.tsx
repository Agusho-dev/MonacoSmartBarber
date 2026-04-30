'use client'

import { useState, useTransition } from 'react'
import { Calendar, Clock, Scissors, User, MapPin, XCircle, Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cancelAppointmentByToken } from '@/lib/actions/appointments'
import type { Appointment } from '@/lib/types/database'

const statusLabels: Record<string, { label: string; color: string }> = {
  confirmed: { label: 'Confirmado', color: 'bg-green-100 text-green-700' },
  checked_in: { label: 'En espera', color: 'bg-blue-100 text-blue-700' },
  in_progress: { label: 'En progreso', color: 'bg-yellow-100 text-yellow-700' },
  completed: { label: 'Completado', color: 'bg-gray-100 text-gray-700' },
  cancelled: { label: 'Cancelado', color: 'bg-red-100 text-red-700' },
  no_show: { label: 'Ausente', color: 'bg-red-100 text-red-700' },
}

export function GestionarClient({ appointment, token }: { appointment: Appointment; token: string }) {
  const [isPending, startTransition] = useTransition()
  const [cancelled, setCancelled] = useState(false)
  const [error, setError] = useState('')

  const status = statusLabels[appointment.status] ?? { label: appointment.status, color: 'bg-gray-100' }
  const dateFormatted = new Date(appointment.appointment_date + 'T12:00:00')
    .toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })

  const canCancel = ['confirmed', 'checked_in'].includes(appointment.status)

  function handleCancel() {
    setError('')
    startTransition(async () => {
      const result = await cancelAppointmentByToken(token)
      if (result.error) {
        setError(result.error)
      } else {
        setCancelled(true)
      }
    })
  }

  if (cancelled) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
              <XCircle className="h-8 w-8 text-red-600" />
            </div>
            <h2 className="mb-2 text-lg font-semibold">Turno cancelado</h2>
            <p className="text-sm text-muted-foreground">Tu turno fue cancelado exitosamente.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Tu turno</CardTitle>
          <Badge className={`mx-auto ${status.color}`}>{status.label}</Badge>
        </CardHeader>

        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>
          )}

          <div className="space-y-3 rounded-lg bg-muted p-4 text-sm">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <span>{(appointment.branch as { name?: string } | null)?.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <Scissors className="h-4 w-4 text-muted-foreground" />
              <span>{(appointment.service as { name?: string } | null)?.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <span>{(appointment.barber as { full_name?: string } | null)?.full_name ?? 'Por asignar'}</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span>{dateFormatted}</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span>{appointment.start_time.substring(0, 5)}</span>
            </div>
          </div>

          {canCancel && (
            <Button variant="destructive" onClick={handleCancel} disabled={isPending} className="w-full">
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
              Cancelar turno
            </Button>
          )}

          {!canCancel && appointment.status === 'completed' && (
            <div className="flex items-center justify-center gap-2 text-green-600">
              <Check className="h-5 w-5" />
              <span className="font-medium">Turno completado</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
