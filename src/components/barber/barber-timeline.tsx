'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Calendar, Clock, CheckCircle2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { TimelineTimeAxis, PX_PER_MINUTE } from './timeline-time-axis'
import { TimelineBlock } from './timeline-block'
import { AppointmentDetailSheet } from './appointment-detail-sheet'
import { CompleteServiceDialog } from './complete-service-dialog'
import { getTodayAppointmentsForStaff } from '@/lib/actions/barber-turnos'
import { getAppointmentQueueEntry } from '@/lib/actions/appointments'
import type { Appointment, QueueEntry } from '@/lib/types/database'

interface BarberSession {
  staff_id: string
  full_name: string
  branch_id: string
  role: string
}

interface BarberTimelineProps {
  session: BarberSession
  initialAppointments: Appointment[]
}

// Hora de inicio/fin del día timeline (eje fijo)
const TIMELINE_START_HOUR = 8
const TIMELINE_END_HOUR = 22

export function BarberTimeline({ session, initialAppointments }: BarberTimelineProps) {
  const [appointments, setAppointments] = useState<Appointment[]>(initialAppointments)
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null)
  const [completingEntry, setCompletingEntry] = useState<QueueEntry | null>(null)
  const [completingAppointmentId, setCompletingAppointmentId] = useState<string | null>(null)

  const scrollRootRef = useRef<HTMLDivElement>(null)
  const yaCentroRef = useRef(false)

  const supabase = useMemo(() => createClient(), [])

  const refetchAppointments = useCallback(async () => {
    const data = await getTodayAppointmentsForStaff(session.staff_id, session.branch_id)
    setAppointments(data)
  }, [session.staff_id, session.branch_id])

  // Realtime: suscripción a appointments filtrada por branch_id
  useEffect(() => {
    const channel = supabase
      .channel(`barber-appointments-${session.branch_id}-${session.staff_id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'appointments',
          filter: `branch_id=eq.${session.branch_id}`,
        },
        () => {
          // Filtrado adicional client-side por barber_id
          refetchAppointments()
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          refetchAppointments()
        }
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, session.branch_id, session.staff_id, refetchAppointments])

  // El eje arranca a las 08:00 y mide 1680px: abierto a las 18:00, el barbero
  // veía media mañana vacía y tenía que scrollear para encontrarse. Centramos
  // la hora actual una sola vez por montaje (después manda el dedo).
  useEffect(() => {
    if (yaCentroRef.current || appointments.length === 0) return
    // El timeline suele montarse dentro de un Sheet que entra animado: sin
    // esperar un tick el viewport todavía mide 0 y el scroll no aplica.
    const t = setTimeout(() => {
      const viewport = scrollRootRef.current?.querySelector<HTMLElement>(
        '[data-slot="scroll-area-viewport"]'
      )
      if (!viewport || viewport.clientHeight === 0) return
      const ahora = new Date()
      const minutosDesdeInicio =
        (ahora.getHours() - TIMELINE_START_HOUR) * 60 + ahora.getMinutes()
      viewport.scrollTop = Math.max(
        0,
        minutosDesdeInicio * PX_PER_MINUTE - viewport.clientHeight / 3
      )
      yaCentroRef.current = true
    }, 80)
    return () => clearTimeout(t)
  }, [appointments.length])

  // Abrir el diálogo de completar servicio: necesitamos la queue_entry
  async function handleOpenCompleteDialog(appt: Appointment) {
    if (!appt.queue_entry_id) {
      toast.error('Este turno todavía no tiene entrada en la fila. Iniciá el servicio primero.')
      return
    }
    setCompletingAppointmentId(appt.id)
    const entry = await getAppointmentQueueEntry(appt.id)
    if (!entry) {
      toast.error('No se pudo cargar la entrada de fila para completar el servicio')
      setCompletingAppointmentId(null)
      return
    }
    setCompletingEntry(entry as QueueEntry)
    setCompletingAppointmentId(null)
  }

  // Métricas del día derivadas de los appointments
  const dayMetrics = useMemo(() => {
    const completed = appointments.filter((a) => a.status === 'completed').length
    const noShows = appointments.filter((a) => a.status === 'no_show').length

    const now = new Date()
    const nowMinutes = now.getHours() * 60 + now.getMinutes()

    const nextAppointment = appointments
      .filter((a) => ['confirmed', 'checked_in'].includes(a.status))
      .sort((a, b) => a.start_time.localeCompare(b.start_time))
      .find((a) => {
        const [h, m] = a.start_time.split(':').map(Number)
        return h * 60 + m >= nowMinutes
      }) ?? null

    return { completed, noShows, nextAppointment }
  }, [appointments])

  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        {/* Resumen del día */}
        <div className="shrink-0 border-b bg-card/60 px-4 py-2.5">
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            {/* Con 0 turnos el contador no informa nada ("0 turnos" ocupa lugar
                para decir que no hay nada): se dice en una línea y listo. */}
            <span className="flex items-center gap-1">
              <Calendar className="size-3" />
              {appointments.length === 0 ? (
                'Sin turnos agendados para hoy'
              ) : (
                <>
                  <span className="font-medium text-foreground">{appointments.length}</span> turno{appointments.length !== 1 ? 's' : ''}
                </>
              )}
            </span>
            {dayMetrics.completed > 0 && (
              <span className="flex items-center gap-1 text-emerald-600">
                <CheckCircle2 className="size-3" />
                {dayMetrics.completed} completado{dayMetrics.completed !== 1 ? 's' : ''}
              </span>
            )}
            {dayMetrics.noShows > 0 && (
              <span className="flex items-center gap-1 text-destructive">
                <XCircle className="size-3" />
                {dayMetrics.noShows} ausente{dayMetrics.noShows !== 1 ? 's' : ''}
              </span>
            )}
            {dayMetrics.nextAppointment && (
              <span className="flex items-center gap-1 text-primary ml-auto font-medium">
                <Clock className="size-3" />
                Próximo: {dayMetrics.nextAppointment.start_time.substring(0, 5)}
                {dayMetrics.nextAppointment.client?.name
                  ? ` · ${dayMetrics.nextAppointment.client.name}`
                  : ''}
              </span>
            )}
          </div>
        </div>

        {/* Timeline. El eje sólo se dibuja si hay algo que ubicar en él: antes
            el `minHeight` de 1720px se aplicaba igual con la agenda vacía y
            dejaba un cartel diminuto flotando en una pantalla de scroll. */}
        {appointments.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 py-8 text-center">
            <div className="mb-3 flex size-14 items-center justify-center rounded-2xl bg-muted">
              <Calendar className="size-7 text-muted-foreground/50" />
            </div>
            <p className="text-sm font-semibold">Sin turnos hoy</p>
            <p className="mt-1 max-w-[220px] text-xs text-muted-foreground">
              Cuando se agenden turnos para vos, aparecerán acá.
            </p>
          </div>
        ) : (
          <div ref={scrollRootRef} className="min-h-0 flex-1">
            <ScrollArea className="h-full">
              {/* El padding va en el envoltorio, NO en el contenedor `relative`.
                  Un absolute se posiciona contra el PADDING box, así que con
                  `p-3` acá adentro los bloques quedaban 12px (6 minutos) por
                  encima de su propia línea de hora. */}
              <div className="px-3 pt-3 pb-10">
                <div
                  className="relative"
                  style={{ minHeight: (TIMELINE_END_HOUR - TIMELINE_START_HOUR) * 60 * PX_PER_MINUTE }}
                >
                  <TimelineTimeAxis
                    startHour={TIMELINE_START_HOUR}
                    endHour={TIMELINE_END_HOUR}
                    className="w-full"
                  />

                  {/* Bloques de turnos superpuestos sobre el eje */}
                  {appointments.map((appt) => (
                    <TimelineBlock
                      key={appt.id}
                      appointment={appt}
                      startHour={TIMELINE_START_HOUR}
                      onClick={setSelectedAppointment}
                    />
                  ))}
                </div>
              </div>
            </ScrollArea>
          </div>
        )}
      </div>

      {/* Sheet de detalle */}
      <AppointmentDetailSheet
        appointment={selectedAppointment}
        staffId={session.staff_id}
        branchId={session.branch_id}
        onClose={() => setSelectedAppointment(null)}
        onOpenCompleteDialog={handleOpenCompleteDialog}
        onActionDone={refetchAppointments}
      />

      {/* Diálogo de completar servicio (reutiliza el flujo walk-in) */}
      {completingEntry && (
        <CompleteServiceDialog
          entry={completingEntry}
          branchId={session.branch_id}
          onClose={() => setCompletingEntry(null)}
          onCompleted={() => {
            setCompletingEntry(null)
            refetchAppointments()
          }}
        />
      )}

      {/* Loading overlay mientras se carga la queue entry */}
      {completingAppointmentId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Cargando...
          </div>
        </div>
      )}
    </>
  )
}
