'use client'

import { useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Clock, User, Scissors, Play, Check, XCircle, Bell, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  markAppointmentInProgress,
  markAppointmentNoShow,
  notifyClientArrival,
} from '@/lib/actions/barber-turnos'
import type { Appointment } from '@/lib/types/database'

interface AppointmentDetailSheetProps {
  appointment: Appointment | null
  staffId: string
  branchId: string
  onClose: () => void
  onOpenCompleteDialog: (appointment: Appointment) => void
  onActionDone: () => void
}

const STATUS_CONFIG: Record<string, { label: string; colorClass: string }> = {
  pending_payment: { label: 'Esperando pago', colorClass: 'bg-amber-500/15 text-amber-600 border-amber-500/30' },
  confirmed: { label: 'Confirmado', colorClass: 'bg-primary/15 text-primary border-primary/30' },
  checked_in: { label: 'En espera', colorClass: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30' },
  in_progress: { label: 'En progreso', colorClass: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30' },
  completed: { label: 'Completado', colorClass: 'bg-muted text-muted-foreground' },
  no_show: { label: 'No se presentó', colorClass: 'bg-destructive/15 text-destructive border-destructive/30' },
  cancelled: { label: 'Cancelado', colorClass: 'bg-destructive/10 text-destructive/60 border-destructive/20' },
}

export function AppointmentDetailSheet({
  appointment,
  staffId,
  branchId,
  onClose,
  onOpenCompleteDialog,
  onActionDone,
}: AppointmentDetailSheetProps) {
  const [loadingAction, setLoadingAction] = useState<string | null>(null)

  if (!appointment) return null

  const statusConf = STATUS_CONFIG[appointment.status] ?? STATUS_CONFIG.confirmed
  const clientName = appointment.client?.name ?? 'Cliente'
  const clientPhone = appointment.client?.phone ?? ''
  const serviceName = appointment.service?.name ?? '—'
  const startLabel = appointment.start_time.substring(0, 5)
  const endLabel = appointment.end_time.substring(0, 5)
  const duration = appointment.duration_minutes

  async function runAction(actionKey: string, fn: () => Promise<{ ok: true } | { error: string }>) {
    setLoadingAction(actionKey)
    const result = await fn()
    setLoadingAction(null)
    if ('error' in result) {
      toast.error(result.error)
    } else {
      onActionDone()
      onClose()
    }
  }

  async function handleInProgress() {
    await runAction('inprogress', () =>
      markAppointmentInProgress(appointment!.id, staffId, branchId)
    )
  }

  async function handleNoShow() {
    await runAction('noshow', () =>
      markAppointmentNoShow(appointment!.id, staffId, branchId)
    )
  }

  async function handleNotify() {
    setLoadingAction('notify')
    const result = await notifyClientArrival(appointment!.id, staffId, branchId)
    setLoadingAction(null)
    if ('error' in result) {
      toast.error(result.error)
    } else {
      toast.success('Notificación enviada al cliente')
    }
  }

  const isLoading = !!loadingAction

  return (
    <Sheet open={!!appointment} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent side="right" className="w-full sm:max-w-sm bg-background border-l flex flex-col gap-0 p-0">
        <SheetHeader className="px-5 pt-5 pb-4 border-b">
          <SheetTitle className="flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10">
              <Scissors className="size-4 text-primary" />
            </div>
            Detalle del turno
          </SheetTitle>
        </SheetHeader>

        <div className="flex flex-1 flex-col overflow-y-auto">
          {/* Estado */}
          <div className="px-5 pt-4 pb-3">
            <Badge variant="outline" className={statusConf.colorClass}>
              {statusConf.label}
            </Badge>
          </div>

          <Separator />

          {/* Info del cliente */}
          <div className="px-5 py-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                <User className="size-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-semibold leading-tight">{clientName}</p>
                {clientPhone && (
                  <p className="text-xs text-muted-foreground">{clientPhone}</p>
                )}
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                <Scissors className="size-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-semibold leading-tight">{serviceName}</p>
                <p className="text-xs text-muted-foreground">{duration} min</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                <Clock className="size-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-semibold leading-tight">{startLabel} – {endLabel}</p>
                <p className="text-xs text-muted-foreground">{appointment.appointment_date}</p>
              </div>
            </div>

            {appointment.notes && (
              <div className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
                <span className="font-medium text-foreground/70">Nota: </span>
                {appointment.notes}
              </div>
            )}
          </div>

          <Separator />

          {/* Acciones */}
          <div className="px-5 py-4 space-y-2.5">
            {/* Avisar al cliente (disponible si está confirmado o en espera) */}
            {['confirmed', 'checked_in'].includes(appointment.status) && (
              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={handleNotify}
                disabled={isLoading}
              >
                <Bell className="size-4" />
                Avisar al cliente que puede pasar
              </Button>
            )}

            {/* Llamar / iniciar servicio (requiere checked_in) */}
            {appointment.status === 'checked_in' && (
              <Button
                className="w-full justify-start gap-2"
                onClick={handleInProgress}
                disabled={isLoading}
              >
                <Play className="size-4" />
                {loadingAction === 'inprogress' ? 'Iniciando...' : 'Iniciar corte'}
              </Button>
            )}

            {/* Completar (requiere in_progress) */}
            {appointment.status === 'in_progress' && (
              <Button
                className="w-full justify-start gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => {
                  onOpenCompleteDialog(appointment)
                  onClose()
                }}
                disabled={isLoading}
              >
                <Check className="size-4" />
                Completar y cobrar
              </Button>
            )}

            {/* No-show (disponible si confirmado o en espera) */}
            {['confirmed', 'checked_in'].includes(appointment.status) && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-start gap-2 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
                    disabled={isLoading}
                  >
                    <XCircle className="size-4" />
                    Marcar como ausente
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>¿{clientName} no se presentó?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Esto marcará el turno como ausente. Esta acción es permanente y el cliente será notificado si hay canal de WhatsApp configurado.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={handleNoShow}
                    >
                      Sí, marcar ausente
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}

            {/* Turno completado — visual informativo */}
            {appointment.status === 'completed' && (
              <div className="flex items-center gap-2 rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">
                <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                Turno completado
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
