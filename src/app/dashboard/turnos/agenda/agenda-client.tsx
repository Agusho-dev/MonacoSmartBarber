'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { Calendar, ChevronLeft, ChevronRight, Loader2, User, Phone, Scissors, CalendarClock } from 'lucide-react'
import { useBranchStore } from '@/stores/branch-store'
import { getAppointmentsForDate, cancelAppointment, markNoShow } from '@/lib/actions/appointments'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
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
import type { Appointment, AppointmentSettings } from '@/lib/types/database'

interface Branch { id: string; name: string }

interface Props {
  settings: AppointmentSettings | null
  branches: Branch[]
}

const STATUS_LABELS: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
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

export function AgendaClient({ settings, branches }: Props) {
  const { selectedBranchId } = useBranchStore()
  const resolvedBranchId = selectedBranchId ?? branches[0]?.id ?? null

  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
  const [loading, setLoading] = useState(false)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [confirmCancel, setConfirmCancel] = useState<Appointment | null>(null)
  const [confirmNoShow, setConfirmNoShow] = useState<Appointment | null>(null)

  const load = useCallback(async () => {
    if (!resolvedBranchId) { setAppointments([]); return }
    setLoading(true)
    const data = await getAppointmentsForDate(resolvedBranchId, date)
    setAppointments(data)
    setLoading(false)
  }, [resolvedBranchId, date])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  function shiftDate(days: number) {
    const d = new Date(date + 'T12:00:00')
    d.setDate(d.getDate() + days)
    setDate(d.toISOString().split('T')[0])
  }

  async function handleCancel(apt: Appointment) {
    const res = await cancelAppointment(apt.id, 'staff')
    if (res.error) toast.error(res.error)
    else { toast.success('Turno cancelado'); load() }
    setConfirmCancel(null)
  }

  async function handleNoShow(apt: Appointment) {
    if (!apt.barber_id) { toast.error('Turno sin barbero asignado'); return }
    const res = await markNoShow(apt.id, apt.barber_id)
    if (res.error) toast.error(res.error)
    else { toast.success('Marcado como no-show'); load() }
    setConfirmNoShow(null)
  }

  const grouped = useMemo(() => {
    const map = new Map<string, Appointment[]>()
    appointments.forEach((a) => {
      const key = a.barber?.full_name ?? 'Sin asignar'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(a)
    })
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [appointments])

  const dateLabel = new Date(date + 'T12:00:00').toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  if (!settings?.is_enabled) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <CalendarClock className="size-10 text-muted-foreground" />
          <div>
            <p className="font-medium">El sistema de turnos no está habilitado.</p>
            <p className="text-sm text-muted-foreground">Activalo desde la pestaña de Configuración.</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!resolvedBranchId) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Seleccioná una sucursal para ver la agenda.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => shiftDate(-1)} aria-label="Día anterior">
            <ChevronLeft className="size-4" />
          </Button>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-auto"
          />
          <Button variant="outline" size="icon" onClick={() => shiftDate(1)} aria-label="Día siguiente">
            <ChevronRight className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setDate(new Date().toISOString().split('T')[0])}>
            Hoy
          </Button>
        </div>
        <p className="text-sm capitalize text-muted-foreground">{dateLabel}</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
      ) : appointments.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <Calendar className="size-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No hay turnos para este día.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {grouped.map(([barberName, list]) => (
            <Card key={barberName}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{barberName} <span className="text-muted-foreground font-normal">· {list.length}</span></CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {list.map((a) => {
                  const st = STATUS_LABELS[a.status] ?? { label: a.status, variant: 'outline' as const }
                  const canCancel = !['cancelled', 'completed', 'no_show'].includes(a.status)
                  const canNoShow = a.status === 'confirmed' || a.status === 'checked_in'
                  return (
                    <div key={a.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex flex-1 flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-semibold">{formatTimeHM(a.start_time)}</span>
                          <span className="text-xs text-muted-foreground">→ {formatTimeHM(a.end_time)}</span>
                          <Badge variant={st.variant} className="text-[10px]">{st.label}</Badge>
                          <Badge variant="outline" className="text-[10px]">{a.source === 'public' ? 'Online' : 'Manual'}</Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                          <span className="flex items-center gap-1"><User className="size-3.5 text-muted-foreground" />{a.client?.name ?? '—'}</span>
                          {a.client?.phone && <span className="flex items-center gap-1 text-muted-foreground"><Phone className="size-3.5" />{a.client.phone}</span>}
                          {a.service?.name && <span className="flex items-center gap-1 text-muted-foreground"><Scissors className="size-3.5" />{a.service.name}</span>}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {canNoShow && (
                          <Button variant="outline" size="sm" onClick={() => setConfirmNoShow(a)}>No vino</Button>
                        )}
                        {canCancel && (
                          <Button variant="outline" size="sm" onClick={() => setConfirmCancel(a)}>Cancelar</Button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog open={!!confirmCancel} onOpenChange={(open) => !open && setConfirmCancel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar turno</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Cancelar el turno de {confirmCancel?.client?.name} a las {confirmCancel && formatTimeHM(confirmCancel.start_time)}?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmCancel && handleCancel(confirmCancel)}>Cancelar turno</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmNoShow} onOpenChange={(open) => !open && setConfirmNoShow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Marcar como no vino</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Confirmar que {confirmNoShow?.client?.name} no se presentó a su turno?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmNoShow && handleNoShow(confirmNoShow)}>Confirmar no-show</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
