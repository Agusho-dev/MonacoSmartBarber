'use client'

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  User, Phone, Scissors, Clock, DollarSign, FileText, Calendar,
} from 'lucide-react'
import { formatCurrency } from '@/lib/format'
import type { Appointment, AppointmentStatus } from '@/lib/types/database'

interface Props {
  appointment: Appointment | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onCancel?: (appt: Appointment) => void
  onReschedule?: (appt: Appointment) => void
  onCheckIn?: (appt: Appointment) => void
  onStart?: (appt: Appointment) => void
  onFinish?: (appt: Appointment) => void
  isActing?: boolean
}

const STATUS_CONFIG: Record<AppointmentStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending_payment: { label: 'Pago pendiente', variant: 'outline' },
  confirmed: { label: 'Confirmado', variant: 'default' },
  checked_in: { label: 'En recepción', variant: 'secondary' },
  in_progress: { label: 'En atención', variant: 'secondary' },
  completed: { label: 'Completado', variant: 'outline' },
  cancelled: { label: 'Cancelado', variant: 'destructive' },
  no_show: { label: 'No vino', variant: 'destructive' },
}

function formatTimeHM(t: string) {
  return t.slice(0, 5)
}

interface RowProps {
  icon: React.ReactNode
  label: string
  value: string
}

function DetailRow({ icon, label, value }: RowProps) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-sm font-medium">{value}</p>
      </div>
    </div>
  )
}

export function AppointmentDetailSheet({
  appointment,
  open,
  onOpenChange,
  onCancel,
  onReschedule,
  onCheckIn,
  onStart,
  onFinish,
  isActing,
}: Props) {
  const statusConfig = appointment ? (STATUS_CONFIG[appointment.status] ?? STATUS_CONFIG.confirmed) : null

  const dateLabel = appointment
    ? new Date(appointment.appointment_date + 'T12:00:00').toLocaleDateString('es-AR', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      })
    : ''

  const isTerminal = appointment
    ? ['cancelled', 'completed', 'no_show'].includes(appointment.status)
    : true

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 p-0 sm:max-w-sm">
        {appointment ? (
          <>
            <SheetHeader className="border-b px-5 pb-4 pt-5">
              <SheetTitle className="text-base">Detalle del turno</SheetTitle>
              <SheetDescription className="sr-only">
                Información completa del turno seleccionado.
              </SheetDescription>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {statusConfig && (
                  <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
                )}
                <Badge variant="outline" className="text-[10px]">
                  {appointment.source === 'public' ? 'Online' : 'Manual'}
                </Badge>
                {appointment.payment_status !== 'unpaid' && (
                  <Badge variant="secondary" className="text-[10px]">
                    {appointment.payment_status === 'paid' ? 'Pagado' : 'Pago parcial'}
                  </Badge>
                )}
              </div>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="space-y-4">
                {/* Cliente */}
                <section aria-label="Datos del cliente">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Cliente
                  </p>
                  <div className="space-y-2.5">
                    <DetailRow
                      icon={<User className="size-4" />}
                      label="Nombre"
                      value={appointment.client?.name ?? '—'}
                    />
                    {appointment.client?.phone && (
                      <DetailRow
                        icon={<Phone className="size-4" />}
                        label="Teléfono"
                        value={appointment.client.phone}
                      />
                    )}
                  </div>
                </section>

                {/* Turno */}
                <section aria-label="Datos del turno">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Turno
                  </p>
                  <div className="space-y-2.5">
                    <DetailRow
                      icon={<Calendar className="size-4" />}
                      label="Fecha"
                      value={dateLabel}
                    />
                    <DetailRow
                      icon={<Clock className="size-4" />}
                      label="Horario"
                      value={`${formatTimeHM(appointment.start_time)} → ${formatTimeHM(appointment.end_time)} (${appointment.duration_minutes} min)`}
                    />
                    {appointment.service?.name && (
                      <DetailRow
                        icon={<Scissors className="size-4" />}
                        label="Servicio"
                        value={appointment.service.name}
                      />
                    )}
                    {appointment.service?.price != null && (
                      <DetailRow
                        icon={<DollarSign className="size-4" />}
                        label="Precio"
                        value={formatCurrency(Number(appointment.service.price))}
                      />
                    )}
                    <DetailRow
                      icon={<User className="size-4" />}
                      label="Barbero"
                      value={appointment.barber?.full_name ?? 'Sin asignar'}
                    />
                  </div>
                </section>

                {/* Pago */}
                {appointment.payment_amount != null && (
                  <section aria-label="Datos del pago">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Pago
                    </p>
                    <div className="rounded-md border bg-muted/30 p-3 text-sm">
                      <p className="font-mono font-semibold">
                        {formatCurrency(Number(appointment.payment_amount))}
                      </p>
                      {appointment.payment_method && (
                        <p className="text-xs text-muted-foreground capitalize">
                          {appointment.payment_method.replace(/_/g, ' ')}
                        </p>
                      )}
                    </div>
                  </section>
                )}

                {/* Notas */}
                {appointment.notes && (
                  <section aria-label="Notas">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Notas
                    </p>
                    <div className="flex gap-2 rounded-md border bg-muted/20 p-3 text-sm">
                      <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <p className="whitespace-pre-wrap text-sm">{appointment.notes}</p>
                    </div>
                  </section>
                )}
              </div>
            </div>

            {/* Acciones */}
            {!isTerminal && (
              <div className="flex flex-wrap gap-2 border-t px-5 py-4">
                {appointment.status === 'confirmed' && (
                  <Button size="sm" onClick={() => onCheckIn?.(appointment)} disabled={isActing}>
                    Check-in
                  </Button>
                )}
                {appointment.status === 'checked_in' && (
                  <Button size="sm" onClick={() => onStart?.(appointment)} disabled={isActing}>
                    Iniciar servicio
                  </Button>
                )}
                {appointment.status === 'in_progress' && (
                  <Button size="sm" onClick={() => onFinish?.(appointment)} disabled={isActing}>
                    Finalizar
                  </Button>
                )}
                {(appointment.status === 'confirmed' || appointment.status === 'checked_in') && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onReschedule?.(appointment)}
                    disabled={isActing}
                  >
                    Reprogramar
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onCancel?.(appointment)}
                  disabled={isActing}
                  className="text-destructive hover:text-destructive"
                >
                  Cancelar turno
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Seleccioná un turno para ver el detalle.
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
