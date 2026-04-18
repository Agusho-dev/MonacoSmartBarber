'use client'

import { useEffect, useState, useCallback, useMemo, useTransition } from 'react'
import {
  Calendar, CalendarClock, CalendarPlus, ChevronLeft, ChevronRight,
  Loader2, Phone, Scissors, User, X,
} from 'lucide-react'
import { useBranchStore } from '@/stores/branch-store'
import {
  getAppointmentsForDate,
  getBranchAppointmentStaff,
  cancelAppointment,
  markNoShow,
  checkinAppointment,
} from '@/lib/actions/appointments'
import { AppointmentsGridView, type GridBarber } from '@/components/appointments/appointments-grid-view'
import {
  AppointmentBookingDialog,
  type BookingServiceOption,
} from '@/components/appointments/appointment-booking-dialog'
import { Card, CardContent } from '@/components/ui/card'
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
import type { Appointment, AppointmentSettings, AppointmentStatus } from '@/lib/types/database'

interface Branch { id: string; name: string }

interface Props {
  settings: AppointmentSettings | null
  branches: Branch[]
}

const STATUS_LABELS: Record<AppointmentStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  confirmed: { label: 'Confirmado', variant: 'default' },
  checked_in: { label: 'En recepción', variant: 'secondary' },
  in_progress: { label: 'En atención', variant: 'secondary' },
  completed: { label: 'Completado', variant: 'outline' },
  cancelled: { label: 'Cancelado', variant: 'destructive' },
  no_show: { label: 'No vino', variant: 'destructive' },
}

function formatTimeHM(t: string) { return t.slice(0, 5) }

export function AgendaClient({ settings, branches }: Props) {
  const { selectedBranchId } = useBranchStore()
  const resolvedBranchId = selectedBranchId ?? branches[0]?.id ?? null

  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
  const [loading, setLoading] = useState(false)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [barbers, setBarbers] = useState<GridBarber[]>([])
  const [services, setServices] = useState<BookingServiceOption[]>([])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showBooking, setShowBooking] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState<Appointment | null>(null)
  const [confirmNoShow, setConfirmNoShow] = useState<Appointment | null>(null)
  const [isActing, startTransition] = useTransition()

  const load = useCallback(async () => {
    if (!resolvedBranchId) { setAppointments([]); setBarbers([]); return }
    setLoading(true)
    const [apts, staffList] = await Promise.all([
      getAppointmentsForDate(resolvedBranchId, date),
      getBranchAppointmentStaff(resolvedBranchId),
    ])
    setAppointments(apts)
    setBarbers(staffList)
    setLoading(false)
  }, [resolvedBranchId, date])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()
      const { data } = await supabase
        .from('services')
        .select('id, name, price, duration_minutes, branch_id, booking_mode')
        .eq('is_active', true)
      if (alive) setServices((data ?? []) as BookingServiceOption[])
    })()
    return () => { alive = false }
  }, [])

  function shiftDate(days: number) {
    const d = new Date(date + 'T12:00:00')
    d.setDate(d.getDate() + days)
    setDate(d.toISOString().split('T')[0])
  }

  const kpis = useMemo(() => {
    const total = appointments.length
    const confirmed = appointments.filter(a => a.status === 'confirmed').length
    const inProgress = appointments.filter(a => a.status === 'in_progress' || a.status === 'checked_in').length
    const completed = appointments.filter(a => a.status === 'completed').length
    const noShow = appointments.filter(a => a.status === 'no_show').length
    const manual = appointments.filter(a => a.source === 'manual').length
    const online = total - manual
    return { total, confirmed, inProgress, completed, noShow, manual, online }
  }, [appointments])

  const selected = useMemo(
    () => appointments.find(a => a.id === selectedId) ?? null,
    [selectedId, appointments]
  )

  const dateLabel = new Date(date + 'T12:00:00').toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  function handleCheckIn(apt: Appointment) {
    startTransition(async () => {
      const res = await checkinAppointment(apt.id)
      if (res.error) toast.error(res.error)
      else { toast.success('Cliente en recepción'); load() }
    })
  }

  function handleCancel(apt: Appointment) {
    startTransition(async () => {
      const res = await cancelAppointment(apt.id, 'staff')
      if (res.error) toast.error(res.error)
      else { toast.success('Turno cancelado'); setSelectedId(null); load() }
      setConfirmCancel(null)
    })
  }

  function handleNoShow(apt: Appointment) {
    if (!apt.barber_id) { toast.error('Turno sin barbero asignado'); return }
    startTransition(async () => {
      const res = await markNoShow(apt.id, apt.barber_id!)
      if (res.error) toast.error(res.error)
      else { toast.success('Marcado como no-show'); setSelectedId(null); load() }
      setConfirmNoShow(null)
    })
  }

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
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => shiftDate(-1)} aria-label="Día anterior">
            <ChevronLeft className="size-4" />
          </Button>
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-auto" />
          <Button variant="outline" size="icon" onClick={() => shiftDate(1)} aria-label="Día siguiente">
            <ChevronRight className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setDate(new Date().toISOString().split('T')[0])}>Hoy</Button>
          <span className="ml-2 hidden text-sm capitalize text-muted-foreground sm:inline">{dateLabel}</span>
        </div>
        <Button onClick={() => setShowBooking(true)}>
          <CalendarPlus className="mr-2 size-4" />
          Nuevo turno
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <KpiCard label="Total" value={kpis.total} />
        <KpiCard label="Confirmados" value={kpis.confirmed} tone="blue" />
        <KpiCard label="En atención" value={kpis.inProgress} tone="amber" />
        <KpiCard label="Completados" value={kpis.completed} tone="slate" />
        <KpiCard label="No-show" value={kpis.noShow} tone="red" />
        <KpiCard label="Online" value={kpis.online} tone="emerald" />
        <KpiCard label="Manuales" value={kpis.manual} tone="muted" />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[1fr_320px]">
        <div className="min-h-0">
          {loading ? (
            <Card className="h-full">
              <CardContent className="flex h-full items-center justify-center py-16">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </CardContent>
            </Card>
          ) : barbers.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                <Calendar className="size-10 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  No hay barberos habilitados para turnos en esta sucursal.
                </p>
              </CardContent>
            </Card>
          ) : (
            <AppointmentsGridView
              date={date}
              barbers={barbers}
              appointments={appointments}
              slotInterval={settings.slot_interval_minutes}
              hoursOpen={settings.appointment_hours_open}
              hoursClose={settings.appointment_hours_close}
              onAppointmentClick={(a) => setSelectedId(a.id)}
              selected={{ appointmentId: selectedId ?? undefined }}
              className="h-[min(72vh,720px)]"
            />
          )}
        </div>

        <aside className="min-h-0">
          {selected ? (
            <Card className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <h3 className="text-sm font-semibold">Detalle del turno</h3>
                <Button variant="ghost" size="icon" className="size-7" onClick={() => setSelectedId(null)}>
                  <X className="size-4" />
                </Button>
              </div>
              <CardContent className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant={STATUS_LABELS[selected.status].variant}>
                    {STATUS_LABELS[selected.status].label}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {selected.source === 'public' ? 'Online' : 'Manual'}
                  </Badge>
                </div>
                <div className="space-y-1.5">
                  <Row icon={<User className="size-3.5" />} label={selected.client?.name ?? '—'} />
                  {selected.client?.phone && (
                    <Row icon={<Phone className="size-3.5" />} label={selected.client.phone} />
                  )}
                  {selected.service?.name && (
                    <Row icon={<Scissors className="size-3.5" />} label={selected.service.name} />
                  )}
                </div>
                <div className="rounded-md border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Horario</p>
                  <p className="font-mono text-base font-semibold">
                    {formatTimeHM(selected.start_time)} → {formatTimeHM(selected.end_time)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Barbero: {selected.barber?.full_name ?? 'Sin asignar'}
                  </p>
                </div>
                {selected.notes && (
                  <div className="rounded-md border p-3 text-xs">
                    <p className="mb-1 font-medium text-muted-foreground">Notas</p>
                    <p className="whitespace-pre-wrap">{selected.notes}</p>
                  </div>
                )}
              </CardContent>
              <div className="flex flex-wrap gap-2 border-t p-3">
                {selected.status === 'confirmed' && (
                  <Button size="sm" onClick={() => handleCheckIn(selected)} disabled={isActing}>
                    Check-in
                  </Button>
                )}
                {(selected.status === 'confirmed' || selected.status === 'checked_in') && (
                  <Button variant="outline" size="sm" onClick={() => setConfirmNoShow(selected)} disabled={isActing}>
                    No vino
                  </Button>
                )}
                {!['cancelled', 'completed', 'no_show'].includes(selected.status) && (
                  <Button variant="outline" size="sm" onClick={() => setConfirmCancel(selected)} disabled={isActing}>
                    Cancelar
                  </Button>
                )}
              </div>
            </Card>
          ) : (
            <Card className="h-full">
              <CardContent className="flex h-full flex-col items-center justify-center gap-2 py-10 text-center text-sm text-muted-foreground">
                <Calendar className="size-8 opacity-40" />
                <p>Seleccioná un turno en la grilla para ver el detalle.</p>
              </CardContent>
            </Card>
          )}
        </aside>
      </div>

      <AppointmentBookingDialog
        open={showBooking}
        onOpenChange={setShowBooking}
        branches={branches}
        services={services}
        defaultBranchId={resolvedBranchId}
        onBooked={() => { toast.success('Turno creado'); load() }}
      />

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
            <AlertDialogAction onClick={() => confirmCancel && handleCancel(confirmCancel)}>
              Cancelar turno
            </AlertDialogAction>
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
            <AlertDialogAction onClick={() => confirmNoShow && handleNoShow(confirmNoShow)}>
              Confirmar no-show
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function KpiCard({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: number
  tone?: 'default' | 'blue' | 'amber' | 'slate' | 'red' | 'emerald' | 'muted'
}) {
  const toneMap: Record<string, string> = {
    default: 'text-foreground',
    blue: 'text-blue-500',
    amber: 'text-amber-500',
    slate: 'text-slate-500',
    red: 'text-red-500',
    emerald: 'text-emerald-500',
    muted: 'text-muted-foreground',
  }
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`text-xl font-bold leading-tight ${toneMap[tone]}`}>{value}</p>
      </CardContent>
    </Card>
  )
}

function Row({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground">{icon}</span>
      <span>{label}</span>
    </div>
  )
}
