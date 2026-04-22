'use client'

import { useState, useTransition } from 'react'
import { Clock, User, Scissors, XCircle, AlertTriangle, Loader2, UserCheck, Play, Check, HandCoins } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  cancelAppointment,
  markNoShow,
  checkinAppointment,
  startAppointmentService,
  getAppointmentQueueEntry,
} from '@/lib/actions/appointments'
import type { Appointment, QueueEntry } from '@/lib/types/database'
import { CompleteServiceDialog } from '@/components/barber/complete-service-dialog'
import { ConfirmPrepaymentDialog } from '@/components/appointments/confirm-prepayment-dialog'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending_payment: { label: 'Esperando pago', variant: 'outline' },
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
  /** Monto de prepago por defecto (calculado server-side según settings). */
  prepaymentDefaultFn?: (appt: Appointment) => number
}

export function AppointmentList({ appointments, staffId, noShowToleranceMinutes = 15, prepaymentDefaultFn }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [actionId, setActionId] = useState<string | null>(null)
  const [completingEntry, setCompletingEntry] = useState<QueueEntry | null>(null)
  const [prepayAppt, setPrepayAppt] = useState<Appointment | null>(null)

  function handleAction(id: string, action: () => Promise<unknown>) {
    setActionId(id)
    startTransition(async () => {
      await action()
      setActionId(null)
      router.refresh()
    })
  }

  async function handleStart(appt: Appointment) {
    setActionId(appt.id)
    startTransition(async () => {
      const res = await startAppointmentService(appt.id)
      if ('error' in res && res.error) toast.error(res.error)
      else toast.success('Servicio iniciado')
      setActionId(null)
      router.refresh()
    })
  }

  async function handleFinish(appt: Appointment) {
    setActionId(appt.id)
    const entry = await getAppointmentQueueEntry(appt.id)
    setActionId(null)
    if (!entry) {
      toast.error('No se encontró la entrada de fila del turno')
      return
    }
    setCompletingEntry(entry as unknown as QueueEntry)
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
    <>
      <div className="space-y-2">
        {appointments.map(appt => {
          const status = statusConfig[appt.status] ?? { label: appt.status, variant: 'outline' as const }
          const isActive = ['confirmed', 'checked_in', 'in_progress'].includes(appt.status)
          const isPendingPayment = appt.status === 'pending_payment'
          const loading = isPending && actionId === appt.id

          const appointmentTime = new Date(`${appt.appointment_date}T${appt.start_time}`)
          const toleranceEnd = new Date(appointmentTime.getTime() + noShowToleranceMinutes * 60 * 1000)
          const canMarkNoShow = appt.status === 'confirmed' && new Date() >= toleranceEnd

          return (
            <div
              key={appt.id}
              className={`flex items-center justify-between rounded-lg border p-3 ${
                appt.status === 'no_show' ? 'border-red-500/30 bg-red-500/10' :
                appt.status === 'completed' ? 'border-green-500/30 bg-green-500/10' :
                appt.status === 'in_progress' ? 'border-emerald-500/30 bg-emerald-500/10' :
                appt.status === 'checked_in' ? 'border-blue-500/30 bg-blue-500/10' :
                appt.status === 'pending_payment' ? 'border-amber-500/30 bg-amber-500/10' :
                'bg-card'
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
                    {appt.client?.name ?? 'Sin nombre'}
                  </span>
                  {appt.service && (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Scissors className="h-3.5 w-3.5" />
                      {appt.service.name}
                    </span>
                  )}
                  {appt.barber && (
                    <span className="text-muted-foreground">
                      {appt.barber.full_name}
                    </span>
                  )}
                </div>
              </div>

              {isPendingPayment && (
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-amber-500 hover:text-amber-400"
                    disabled={loading}
                    onClick={() => setPrepayAppt(appt)}
                  >
                    <HandCoins className="mr-1 h-4 w-4" />
                    Confirmar pago
                  </Button>
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
                  {appt.status === 'checked_in' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-emerald-400 hover:text-emerald-300"
                      disabled={loading}
                      onClick={() => handleStart(appt)}
                    >
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="mr-1 h-4 w-4" />}
                      Iniciar
                    </Button>
                  )}
                  {appt.status === 'in_progress' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-emerald-400 hover:text-emerald-300"
                      disabled={loading}
                      onClick={() => handleFinish(appt)}
                    >
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}
                      Finalizar
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

      {completingEntry && (
        <CompleteServiceDialog
          entry={completingEntry}
          branchId={completingEntry.branch_id}
          onClose={() => setCompletingEntry(null)}
          onCompleted={() => {
            setCompletingEntry(null)
            toast.success('Servicio finalizado')
            router.refresh()
          }}
        />
      )}

      {prepayAppt && (
        <ConfirmPrepaymentDialog
          open={!!prepayAppt}
          onOpenChange={(o) => { if (!o) setPrepayAppt(null) }}
          appointment={prepayAppt}
          staffId={staffId}
          defaultAmount={prepaymentDefaultFn?.(prepayAppt) ?? Number(prepayAppt.service?.price ?? 0)}
          onDone={() => {
            setPrepayAppt(null)
            router.refresh()
          }}
        />
      )}
    </>
  )
}
