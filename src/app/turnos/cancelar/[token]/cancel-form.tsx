'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { XCircle, Check, Loader2, Calendar, Clock, Scissors, User, MapPin } from 'lucide-react'
import { publicCancelByToken } from '@/lib/actions/public-booking'
import type { Appointment } from '@/lib/types/database'

// `Omit` para sobrescribir las relaciones del Appointment base (que tipean
// como `Branch`/`Service`/`Staff` completos) por shapes mínimas que el wizard
// público recibe — solo necesitamos el `name` para mostrar.
interface AppointmentWithRelations extends Omit<Appointment, 'branch' | 'service' | 'barber'> {
  branch?: { name: string } | null
  service?: { name: string } | null
  barber?: { full_name: string } | null
}

interface Props {
  appointment: AppointmentWithRelations
  token: string
  cancellationMinHours: number
}

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  confirmed: { label: 'Confirmado', className: 'bg-green-100 text-green-700' },
  checked_in: { label: 'En espera', className: 'bg-blue-100 text-blue-700' },
  in_progress: { label: 'En progreso', className: 'bg-yellow-100 text-yellow-700' },
  completed: { label: 'Completado', className: 'bg-gray-100 text-gray-600' },
  cancelled: { label: 'Cancelado', className: 'bg-red-100 text-red-600' },
  no_show: { label: 'Ausente', className: 'bg-red-100 text-red-600' },
  pending_payment: { label: 'Pendiente de pago', className: 'bg-amber-100 text-amber-700' },
}

export function CancelForm({ appointment, token, cancellationMinHours }: Props) {
  const [isPending, startTransition] = useTransition()
  const [cancelled, setCancelled] = useState(false)
  const [error, setError] = useState('')

  const statusInfo = STATUS_LABELS[appointment.status] ?? { label: appointment.status, className: 'bg-gray-100 text-gray-600' }

  const dateFormatted = new Date(appointment.appointment_date + 'T12:00:00')
    .toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  // Determinar si el turno puede cancelarse (estado + ventana temporal)
  const canCancel = ['confirmed', 'checked_in'].includes(appointment.status)

  const appointmentDateTime = new Date(
    `${appointment.appointment_date}T${appointment.start_time}`
  )
  // Calculamos la ventana una vez al montar — el componente se re-renderizará
  // solo ante interacción del usuario, por lo que este valor es suficientemente estable.
  const [nowMs] = useState(() => Date.now())
  const hoursUntil = (appointmentDateTime.getTime() - nowMs) / (1000 * 60 * 60)
  const withinCancellationWindow = hoursUntil >= cancellationMinHours

  function handleCancel() {
    setError('')
    startTransition(async () => {
      const result = await publicCancelByToken(token)
      if ('error' in result) {
        const msg = result.error === 'NOT_FOUND_OR_NOT_CANCELLABLE'
          ? 'El turno no se puede cancelar. Es posible que ya fue cancelado o el link expiró.'
          : result.error
        setError(msg)
      } else {
        setCancelled(true)
      }
    })
  }

  // Estado: ya cancelado exitosamente
  if (cancelled) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-md">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
            <XCircle className="h-8 w-8 text-red-500" />
          </div>
          <h2 className="mb-1 text-xl font-bold text-slate-800">Turno cancelado</h2>
          <p className="text-sm text-slate-500">
            Tu turno fue cancelado exitosamente. Si cambiás de opinión, reservá uno nuevo.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md space-y-5">
        {/* Card principal */}
        <div className="rounded-2xl bg-white p-6 shadow-md">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-lg font-bold text-slate-800">Tu turno</h1>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${statusInfo.className}`}
            >
              {statusInfo.label}
            </span>
          </div>

          {/* Detalle del turno */}
          <div className="space-y-3">
            <DetailRow icon={<MapPin className="h-4 w-4" />}>
              {appointment.branch?.name ?? '—'}
            </DetailRow>
            <DetailRow icon={<Scissors className="h-4 w-4" />}>
              {appointment.service?.name ?? '—'}
            </DetailRow>
            <DetailRow icon={<User className="h-4 w-4" />}>
              {appointment.barber?.full_name ?? 'Por asignar'}
            </DetailRow>
            <DetailRow icon={<Calendar className="h-4 w-4" />}>
              <span className="capitalize">{dateFormatted}</span>
            </DetailRow>
            <DetailRow icon={<Clock className="h-4 w-4" />}>
              {appointment.start_time.substring(0, 5)}
            </DetailRow>
          </div>
        </div>

        {/* Mensaje de error */}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
            {error}
          </div>
        )}

        {/* Acciones */}
        {appointment.status === 'completed' && (
          <div className="flex items-center justify-center gap-2 rounded-xl bg-white p-4 shadow-sm">
            <Check className="h-5 w-5 text-green-500" />
            <span className="font-medium text-slate-700">Tu turno ya fue completado</span>
          </div>
        )}

        {appointment.status === 'cancelled' && (
          <div className="rounded-xl bg-white p-4 text-center text-sm text-slate-500 shadow-sm">
            Este turno ya fue cancelado.
          </div>
        )}

        {canCancel && !withinCancellationWindow && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
            Ya no podés cancelar este turno. La cancelación cierra{' '}
            <strong>{cancellationMinHours} {cancellationMinHours === 1 ? 'hora' : 'horas'} antes</strong>{' '}
            del horario reservado.
          </div>
        )}

        {canCancel && withinCancellationWindow && (
          <div className="rounded-2xl bg-white p-5 shadow-md">
            <p className="mb-4 text-sm text-slate-500">
              Podés cancelar hasta{' '}
              <strong className="text-slate-700">
                {cancellationMinHours} {cancellationMinHours === 1 ? 'hora' : 'horas'}
              </strong>{' '}
              antes del turno.
            </p>
            <Button
              variant="destructive"
              onClick={handleCancel}
              disabled={isPending}
              className="h-12 w-full text-base font-semibold"
            >
              {isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cancelando…</>
              ) : (
                <><XCircle className="mr-2 h-4 w-4" /> Cancelar mi turno</>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function DetailRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-sm text-slate-700">
      <span className="shrink-0 text-slate-400">{icon}</span>
      <span>{children}</span>
    </div>
  )
}
