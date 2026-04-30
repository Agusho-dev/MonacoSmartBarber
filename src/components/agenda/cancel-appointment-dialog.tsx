'use client'

import { useTransition, useState } from 'react'
import { Loader2, TriangleAlert } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import { cancelAppointmentById } from '@/lib/actions/turnos'
import type { Appointment } from '@/lib/types/database'

interface Props {
  appointment: Appointment | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onCancelled?: () => void
}

function formatTimeHM(t: string) {
  return t.slice(0, 5)
}

export function CancelAppointmentDialog({
  appointment,
  open,
  onOpenChange,
  onCancelled,
}: Props) {
  const [isPending, startTransition] = useTransition()
  // Capturamos el timestamp al montar — la fn lazy se ejecuta una sola vez
  const [nowMs] = useState<number>(() => Date.now())

  function handleConfirm() {
    if (!appointment) return
    startTransition(async () => {
      const res = await cancelAppointmentById(appointment.id)
      if ('error' in res) {
        toast.error(res.error)
        return
      }
      toast.success('Turno cancelado')
      onOpenChange(false)
      onCancelled?.()
    })
  }

  const isWithin2h = appointment
    ? (new Date(`${appointment.appointment_date}T${appointment.start_time}`).getTime() - nowMs) / (1000 * 60 * 60) < 2
    : false

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <TriangleAlert className="size-5 text-destructive" />
            Cancelar turno
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">
              {appointment && (
                <p>
                  ¿Cancelar el turno de{' '}
                  <strong>{appointment.client?.name ?? 'cliente'}</strong> a las{' '}
                  <strong>{formatTimeHM(appointment.start_time)}</strong>?
                </p>
              )}
              {isWithin2h && (
                <div className="flex items-start gap-2 rounded-md border border-amber-400/30 bg-amber-500/5 p-2.5 text-amber-700 dark:text-amber-400">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                  <p className="text-xs">
                    El turno es en menos de 2 horas. El cliente puede no recibir aviso a tiempo.
                  </p>
                </div>
              )}
              <p className="text-muted-foreground">
                Esta acción no se puede deshacer. Los recordatorios programados se cancelarán automáticamente.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>
            Volver
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isPending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : null}
            Sí, cancelar turno
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
