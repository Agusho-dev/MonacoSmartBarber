'use client'

import { useState, useTransition } from 'react'
import { Clock, User, Scissors, XCircle, AlertTriangle, Loader2, UserCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cancelAppointment, markNoShow, checkinAppointment } from '@/lib/actions/appointments'
import type { Appointment } from '@/lib/types/database'

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  confirmed: { label: 'Confirmado', variant: 'default' },
  checked_in: { label: 'En espera', variant: 'secondary' },
  in_progress: { label: 'En progreso', variant: 'outline' },
  completed: { label: 'Completado', variant: 'secondary' },
  no_show: { label: 'Ausente', variant: 'destructive' },
  cancelled: { label: 'Cancelado', variant: 'destructive' },
}

interface Props {
  appointments: Appointment[]
  staffId?: string
  noShowToleranceMinutes?: number
}

export function AppointmentList({ appointments, staffId, noShowToleranceMinutes = 15 }: Props) {
  const [isPending, startTransition] = useTransition()
  const [actionId, setActionId] = useState<string | null>(null)

  function handleAction(id: string, action: () => Promise<any>) {
    setActionId(id)
    startTransition(async () => {
      await action()
      setActionId(null)
    })
  }

  if (!appointments.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
        <Clock className="mb-2 h-8 w-8" />
        <p>No hay turnos para hoy</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {appointments.map(appt => {
        const status = statusConfig[appt.status] ?? { label: appt.status, variant: 'outline' as const }
        const isActive = ['confirmed', 'checked_in'].includes(appt.status)
        const loading = isPending && actionId === appt.id

        const appointmentTime = new Date(`${appt.appointment_date}T${appt.start_time}`)
        const toleranceEnd = new Date(appointmentTime.getTime() + noShowToleranceMinutes * 60 * 1000)
        const canMarkNoShow = isActive && new Date() >= toleranceEnd

        return (
          <div
            key={appt.id}
            className={`flex items-center justify-between rounded-lg border p-3 ${
              appt.status === 'no_show' ? 'border-red-200 bg-red-50' :
              appt.status === 'completed' ? 'border-green-200 bg-green-50' :
              appt.status === 'checked_in' ? 'border-blue-200 bg-blue-50' :
              ''
            }`}
          >
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-semibold">{appt.start_time.substring(0, 5)}</span>
                <span className="text-sm text-muted-foreground">—</span>
                <span className="font-mono text-sm">{appt.end_time.substring(0, 5)}</span>
                <Badge variant={status.variant}>{status.label}</Badge>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="flex items-center gap-1">
                  <User className="h-3.5 w-3.5" />
                  {(appt.client as any)?.name ?? 'Sin nombre'}
                </span>
                {appt.service && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Scissors className="h-3.5 w-3.5" />
                    {(appt.service as any)?.name}
                  </span>
                )}
                {appt.barber && (
                  <span className="text-muted-foreground">
                    {(appt.barber as any)?.full_name}
                  </span>
                )}
              </div>
            </div>

            {isActive && (
              <div className="flex items-center gap-1">
                {appt.status === 'confirmed' && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={loading}
                    onClick={() => handleAction(appt.id, () => checkinAppointment(appt.id))}
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCheck className="mr-1 h-4 w-4" />}
                    Llegó
                  </Button>
                )}
                {canMarkNoShow && staffId && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-amber-600 hover:text-amber-700"
                    disabled={loading}
                    onClick={() => handleAction(appt.id, () => markNoShow(appt.id, staffId))}
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="mr-1 h-4 w-4" />}
                    Ausente
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-600 hover:text-red-700"
                  disabled={loading}
                  onClick={() => handleAction(appt.id, () => cancelAppointment(appt.id, 'staff'))}
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                </Button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
