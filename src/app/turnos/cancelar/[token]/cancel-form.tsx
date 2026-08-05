'use client'

import { useState, useTransition } from 'react'
import { XCircle, Check, Loader2, Calendar, Clock, Scissors, User, MapPin } from 'lucide-react'
import { publicCancelByToken } from '@/lib/actions/public-booking'
import { themeVars, type TurneroTheme } from '../../[slug]/theme'
import { fechaLargaDeStr } from '../../[slug]/fechas'
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
  theme: TurneroTheme
}

const ESTADOS: Record<string, string> = {
  confirmed: 'Confirmado',
  checked_in: 'Ya llegaste',
  in_progress: 'En progreso',
  completed: 'Completado',
  cancelled: 'Cancelado',
  no_show: 'Ausente',
  pending_payment: 'Pendiente de pago',
}

export function CancelForm({ appointment, token, cancellationMinHours, theme }: Props) {
  const [isPending, startTransition] = useTransition()
  const [cancelado, setCancelado] = useState(false)
  const [error, setError] = useState('')

  const estado = ESTADOS[appointment.status] ?? appointment.status

  const fecha = fechaLargaDeStr(appointment.appointment_date)

  const cancelable = ['confirmed', 'checked_in'].includes(appointment.status)

  // Calculamos la ventana una vez al montar — el componente se re-renderizará
  // solo ante interacción del usuario, por lo que este valor es suficientemente estable.
  const [ahora] = useState(() => Date.now())
  const horasRestantes =
    (new Date(`${appointment.appointment_date}T${appointment.start_time}`).getTime() - ahora) /
    3_600_000
  const enVentana = horasRestantes >= cancellationMinHours

  function handleCancel() {
    setError('')
    startTransition(async () => {
      const result = await publicCancelByToken(token)
      if ('error' in result) {
        setError(
          result.error === 'NOT_FOUND_OR_NOT_CANCELLABLE'
            ? 'El turno no se puede cancelar. Es posible que ya haya sido cancelado o que el link haya expirado.'
            : result.error
        )
      } else {
        setCancelado(true)
      }
    })
  }

  if (cancelado) {
    return (
      <Marco theme={theme}>
        <div
          className="rounded-3xl border p-8 text-center"
          style={{ backgroundColor: 'var(--t-surface)', borderColor: 'var(--t-border)' }}
        >
          <span
            className="mx-auto flex h-16 w-16 items-center justify-center rounded-full"
            style={{ backgroundColor: 'var(--t-danger-bg)', color: 'var(--t-danger-text)' }}
          >
            <XCircle className="h-8 w-8" />
          </span>
          <h1 className="mt-4 text-xl font-bold text-[var(--t-text)]">Turno cancelado</h1>
          <p className="mt-1.5 text-sm text-[var(--t-text-muted)]">
            Tu turno fue cancelado. Si cambiás de opinión, reservá uno nuevo cuando quieras.
          </p>
        </div>
      </Marco>
    )
  }

  return (
    <Marco theme={theme}>
      <div
        className="rounded-3xl border p-6"
        style={{ backgroundColor: 'var(--t-surface)', borderColor: 'var(--t-border)' }}
      >
        <div className="mb-5 flex items-center justify-between gap-3">
          <h1 className="text-lg font-bold text-[var(--t-text)]">Tu turno</h1>
          <span
            className="shrink-0 rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wide"
            style={{
              backgroundColor: 'var(--t-surface-alt)',
              borderColor: 'var(--t-border)',
              color: 'var(--t-text)',
            }}
          >
            {estado}
          </span>
        </div>

        <div className="space-y-3">
          <Fila icon={<MapPin className="h-4 w-4" />}>{appointment.branch?.name ?? '—'}</Fila>
          <Fila icon={<Scissors className="h-4 w-4" />}>{appointment.service?.name ?? '—'}</Fila>
          <Fila icon={<User className="h-4 w-4" />}>
            {appointment.barber?.full_name ?? 'Por asignar'}
          </Fila>
          <Fila icon={<Calendar className="h-4 w-4" />}>
            {fecha}
          </Fila>
          <Fila icon={<Clock className="h-4 w-4" />}>{appointment.start_time.substring(0, 5)}</Fila>
        </div>
      </div>

      {error && (
        <div
          className="rounded-2xl p-3.5 text-sm font-medium"
          style={{ backgroundColor: 'var(--t-danger-bg)', color: 'var(--t-danger-text)' }}
          role="alert"
        >
          {error}
        </div>
      )}

      {appointment.status === 'completed' && (
        <div
          className="flex items-center justify-center gap-2 rounded-2xl border p-4 text-sm font-semibold text-[var(--t-text)]"
          style={{ backgroundColor: 'var(--t-surface)', borderColor: 'var(--t-border)' }}
        >
          <Check className="h-5 w-5 text-[var(--t-accent)]" />
          Tu turno ya fue completado
        </div>
      )}

      {appointment.status === 'cancelled' && (
        <div
          className="rounded-2xl border p-4 text-center text-sm text-[var(--t-text-muted)]"
          style={{ backgroundColor: 'var(--t-surface)', borderColor: 'var(--t-border)' }}
        >
          Este turno ya fue cancelado.
        </div>
      )}

      {cancelable && !enVentana && (
        <div
          className="rounded-2xl border p-4 text-sm text-[var(--t-text-muted)]"
          style={{ backgroundColor: 'var(--t-surface)', borderColor: 'var(--t-border)' }}
        >
          Ya no podés cancelar este turno. La cancelación cierra{' '}
          <strong className="font-semibold text-[var(--t-text)]">
            {cancellationMinHours} {cancellationMinHours === 1 ? 'hora' : 'horas'} antes
          </strong>{' '}
          del horario reservado.
        </div>
      )}

      {cancelable && enVentana && (
        <div
          className="rounded-2xl border p-5"
          style={{ backgroundColor: 'var(--t-surface)', borderColor: 'var(--t-border)' }}
        >
          <p className="text-sm text-[var(--t-text-muted)]">
            Podés cancelar hasta{' '}
            <strong className="font-semibold text-[var(--t-text)]">
              {cancellationMinHours} {cancellationMinHours === 1 ? 'hora' : 'horas'}
            </strong>{' '}
            antes del turno.
          </p>
          <button
            type="button"
            onClick={handleCancel}
            disabled={isPending}
            className="mt-4 flex h-13 w-full items-center justify-center gap-2 rounded-xl text-base font-bold text-white disabled:opacity-60"
            style={{ backgroundColor: 'var(--t-danger)' }}
          >
            {isPending ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Cancelando…</>
            ) : (
              <><XCircle className="h-4 w-4" /> Cancelar mi turno</>
            )}
          </button>
        </div>
      )}
    </Marco>
  )
}

function Marco({ theme, children }: { theme: TurneroTheme; children: React.ReactNode }) {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-[var(--t-bg)] p-4 text-[var(--t-text)]"
      style={themeVars(theme)}
    >
      <div className="w-full max-w-md space-y-4">{children}</div>
    </div>
  )
}

function Fila({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-sm text-[var(--t-text)]">
      <span className="shrink-0 text-[var(--t-text-muted)]">{icon}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  )
}
