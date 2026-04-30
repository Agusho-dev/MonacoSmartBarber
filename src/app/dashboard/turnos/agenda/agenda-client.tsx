'use client'

import { useEffect, useState, useCallback, useMemo, useTransition } from 'react'
import Link from 'next/link'
import {
  Building2, Calendar, CalendarClock, CalendarPlus, ChevronLeft, ChevronRight,
  DollarSign, Loader2, Phone, Scissors, Settings, User, X, Layers,
} from 'lucide-react'
import { useBranchStore } from '@/stores/branch-store'
import {
  getAppointmentsForDate,
  getAppointmentsForDateMultiBranch,
  getBranchAppointmentStaff,
  cancelAppointment,
  markNoShow,
  checkinAppointment,
  rescheduleAppointment,
  updateAppointmentDuration,
  startAppointmentService,
  getAppointmentQueueEntry,
} from '@/lib/actions/appointments'
import { CompleteServiceDialog } from '@/components/barber/complete-service-dialog'
import { listAppointmentBlocksForDate } from '@/lib/actions/appointment-blocks'
import { listWaitlist } from '@/lib/actions/waitlist'
import {
  AppointmentsGridView,
  type GridBarber,
  type ZoomLevel,
} from '@/components/appointments/appointments-grid-view'
import {
  AppointmentBookingDialog,
  type BookingServiceOption,
} from '@/components/appointments/appointment-booking-dialog'
import { AppointmentPaymentDialog } from '@/components/appointments/appointment-payment-dialog'
import { ConfirmPrepaymentDialog } from '@/components/appointments/confirm-prepayment-dialog'
import { AppointmentBlocksPanel } from '@/components/appointments/appointment-blocks-panel'
import { AppointmentWaitlistPanel } from '@/components/appointments/appointment-waitlist-panel'
import { AppointmentTimeFinder } from '@/components/appointments/appointment-time-finder'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
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
import type {
  Appointment,
  AppointmentBlock,
  AppointmentSettings,
  AppointmentStatus,
  AppointmentWaitlist,
  QueueEntry,
} from '@/lib/types/database'

interface Branch {
  id: string
  name: string
  operation_mode?: 'walk_in' | 'appointments' | 'hybrid' | null
}

interface Props {
  settings: AppointmentSettings | null
  branches: Branch[]
}

const STATUS_LABELS: Record<AppointmentStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending_payment: { label: 'Esperando pago', variant: 'outline' },
  confirmed: { label: 'Confirmado', variant: 'default' },
  checked_in: { label: 'En recepción', variant: 'secondary' },
  in_progress: { label: 'En atención', variant: 'secondary' },
  completed: { label: 'Completado', variant: 'outline' },
  cancelled: { label: 'Cancelado', variant: 'destructive' },
  no_show: { label: 'No vino', variant: 'destructive' },
}

const PAYMENT_LABELS: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  unpaid: { label: 'Sin pagar', variant: 'outline' },
  paid: { label: 'Pagado', variant: 'default' },
  partial: { label: 'Pago parcial', variant: 'secondary' },
  refunded: { label: 'Reembolsado', variant: 'destructive' },
}

function formatTimeHM(t: string) { return t.slice(0, 5) }

function calcPrepaymentDefault(settings: AppointmentSettings | null, appt: Appointment): number {
  const price = Number(appt.service?.price ?? 0)
  if (!settings || !price) return price
  if (settings.prepayment_type === 'fixed') return price
  const pct = Math.min(100, Math.max(1, Number(settings.prepayment_percentage ?? 50)))
  return Math.round((price * pct) / 100)
}

export function AgendaClient({ settings, branches }: Props) {
  const { selectedBranchId, setSelectedBranchId, allowedBranchIds } = useBranchStore()
  const visibleBranches = useMemo(
    () => allowedBranchIds
      ? branches.filter(b => allowedBranchIds.includes(b.id))
      : branches,
    [branches, allowedBranchIds],
  )
  const resolvedBranchId = selectedBranchId ?? visibleBranches[0]?.id ?? null

  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
  const [loading, setLoading] = useState(false)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [barbers, setBarbers] = useState<GridBarber[]>([])
  const [services, setServices] = useState<BookingServiceOption[]>([])
  const [blocks, setBlocks] = useState<AppointmentBlock[]>([])
  const [waitlist, setWaitlist] = useState<AppointmentWaitlist[]>([])

  const [viewMode, setViewMode] = useState<'single' | 'multi'>('single')
  const [zoom, setZoom] = useState<ZoomLevel>(() => {
    const interval = settings?.slot_interval_minutes
    return (interval === 15 || interval === 30 || interval === 60) ? interval as ZoomLevel : 30
  })

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showBooking, setShowBooking] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState<Appointment | null>(null)
  const [confirmNoShow, setConfirmNoShow] = useState<Appointment | null>(null)
  const [paymentAppt, setPaymentAppt] = useState<Appointment | null>(null)
  const [prepayAppt, setPrepayAppt] = useState<Appointment | null>(null)
  const [completingEntry, setCompletingEntry] = useState<QueueEntry | null>(null)
  const [isActing, startTransition] = useTransition()

  // Refetch rápido: solo turnos del día (no barberos/bloqueos/espera)
  const refreshAppointments = useCallback(async () => {
    if (viewMode === 'multi') {
      const branchIds = visibleBranches.map(b => b.id)
      const apts = await getAppointmentsForDateMultiBranch(branchIds, date)
      setAppointments(apts)
      return
    }
    if (!resolvedBranchId) return
    const apts = await getAppointmentsForDate(resolvedBranchId, date)
    setAppointments(apts)
  }, [resolvedBranchId, date, viewMode, visibleBranches])

  const load = useCallback(async () => {
    if (viewMode === 'multi') {
      setLoading(true)
      const branchIds = visibleBranches.map(b => b.id)
      const apts = await getAppointmentsForDateMultiBranch(branchIds, date)
      setAppointments(apts)
      setBarbers([])
      setBlocks([])
      setWaitlist([])
      setLoading(false)
      return
    }

    if (!resolvedBranchId) {
      setAppointments([])
      setBarbers([])
      setBlocks([])
      setWaitlist([])
      return
    }
    setLoading(true)
    const [apts, staffList, blocksList, waitlistEntries] = await Promise.all([
      getAppointmentsForDate(resolvedBranchId, date),
      getBranchAppointmentStaff(resolvedBranchId),
      listAppointmentBlocksForDate(resolvedBranchId, date),
      listWaitlist(resolvedBranchId),
    ])
    setAppointments(apts)
    setBarbers(staffList)
    setBlocks(blocksList)
    setWaitlist(waitlistEntries)
    setLoading(false)
  }, [resolvedBranchId, date, viewMode, visibleBranches])

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

  // Realtime subscription — refetch en cambios sobre appointments/blocks/waitlist
  useEffect(() => {
    if (viewMode === 'multi' || !resolvedBranchId) return

    let alive = true
    let cleanup: (() => void) | null = null

    ;(async () => {
      const { createClient } = await import('@/lib/supabase/client')
      if (!alive) return
      const supabase = createClient()

      const channel = supabase
        .channel(`agenda:${resolvedBranchId}:${date}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'appointments', filter: `branch_id=eq.${resolvedBranchId}` },
          () => { if (alive) refreshAppointments() },
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'appointment_blocks' },
          () => { if (alive) load() },
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'appointment_waitlist', filter: `branch_id=eq.${resolvedBranchId}` },
          () => { if (alive) load() },
        )
        .subscribe()

      cleanup = () => { supabase.removeChannel(channel) }
    })()

    return () => {
      alive = false
      cleanup?.()
    }
  }, [resolvedBranchId, date, viewMode, load, refreshAppointments])

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
    [selectedId, appointments],
  )

  const dateLabel = new Date(date + 'T12:00:00').toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  function handleCheckIn(apt: Appointment) {
    // Optimista: marcar en recepción al instante
    setAppointments(prev => prev.map(a =>
      a.id === apt.id ? { ...a, status: 'checked_in' as AppointmentStatus } : a
    ))
    startTransition(async () => {
      const res = await checkinAppointment(apt.id)
      if (res.error) {
        toast.error(res.error)
        refreshAppointments()
      } else {
        toast.success('Cliente en recepción')
        refreshAppointments()
      }
    })
  }

  function handleStart(apt: Appointment) {
    setAppointments(prev => prev.map(a =>
      a.id === apt.id ? { ...a, status: 'in_progress' as AppointmentStatus } : a
    ))
    startTransition(async () => {
      const res = await startAppointmentService(apt.id)
      if ('error' in res && res.error) {
        toast.error(res.error)
        refreshAppointments()
      } else {
        toast.success('Servicio iniciado')
        refreshAppointments()
      }
    })
  }

  async function handleFinish(apt: Appointment) {
    const entry = await getAppointmentQueueEntry(apt.id)
    if (!entry) {
      toast.error('No se encontró la entrada de fila del turno')
      return
    }
    setCompletingEntry(entry as unknown as QueueEntry)
  }

  function handleCancel(apt: Appointment) {
    setAppointments(prev => prev.map(a =>
      a.id === apt.id ? { ...a, status: 'cancelled' as AppointmentStatus } : a
    ))
    setSelectedId(null)
    setConfirmCancel(null)
    startTransition(async () => {
      const res = await cancelAppointment(apt.id, 'staff')
      if (res.error) {
        toast.error(res.error)
        refreshAppointments()
      } else {
        toast.success('Turno cancelado')
        refreshAppointments()
      }
    })
  }

  function handleNoShow(apt: Appointment) {
    if (!apt.barber_id) { toast.error('Turno sin barbero asignado'); return }
    setAppointments(prev => prev.map(a =>
      a.id === apt.id ? { ...a, status: 'no_show' as AppointmentStatus } : a
    ))
    setSelectedId(null)
    setConfirmNoShow(null)
    startTransition(async () => {
      const res = await markNoShow(apt.id, apt.barber_id!)
      if (res.error) {
        toast.error(res.error)
        refreshAppointments()
      } else {
        toast.success('Marcado como no-show')
        refreshAppointments()
      }
    })
  }

  async function handleMove(args: { appointmentId: string; newBarberId: string; newTime: string }) {
    // Optimista: mover el turno inmediatamente en el grid
    setAppointments(prev => prev.map(a => {
      if (a.id !== args.appointmentId) return a
      const [h, m] = args.newTime.split(':').map(Number)
      const startMin = h * 60 + m
      const duration = a.duration_minutes ?? 30
      const endMin = startMin + duration
      const pad = (n: number) => String(n).padStart(2, '0')
      return {
        ...a,
        barber_id: args.newBarberId,
        start_time: `${pad(h)}:${pad(m)}:00`,
        end_time: `${pad(Math.floor(endMin / 60))}:${pad(endMin % 60)}:00`,
      }
    }))

    const res = await rescheduleAppointment({
      appointmentId: args.appointmentId,
      newDate: date,
      newStartTime: args.newTime,
      newBarberId: args.newBarberId,
    })
    if (res?.error) {
      toast.error(res.error)
      refreshAppointments()
      return { error: res.error }
    }
    toast.success('Turno reprogramado')
    refreshAppointments()
  }

  async function handleResize(args: { appointmentId: string; newDurationMinutes: number }) {
    // Optimista: actualizar end_time inmediatamente
    setAppointments(prev => prev.map(a => {
      if (a.id !== args.appointmentId) return a
      const [h, m] = a.start_time.split(':').map(Number)
      const startMin = h * 60 + m
      const endMin = startMin + args.newDurationMinutes
      const pad = (n: number) => String(n).padStart(2, '0')
      return {
        ...a,
        duration_minutes: args.newDurationMinutes,
        end_time: `${pad(Math.floor(endMin / 60))}:${pad(endMin % 60)}:00`,
      }
    }))

    const res = await updateAppointmentDuration(args.appointmentId, args.newDurationMinutes)
    if (res?.error) {
      toast.error(res.error)
      refreshAppointments()
      return { error: res.error }
    }
    toast.success('Duración actualizada')
    refreshAppointments()
  }

  // Sucursal seleccionada en modo walk_in — mostrar CTA para cambiar de modo
  const selectedBranchData = visibleBranches.find(b => b.id === resolvedBranchId)
  const isWalkInBranch = selectedBranchData?.operation_mode === 'walk_in'
  if (isWalkInBranch) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-14 text-center">
          <CalendarClock className="size-12 text-muted-foreground" />
          <div className="space-y-1">
            <p className="text-base font-semibold">Esta sucursal trabaja sin turno</p>
            <p className="text-sm text-muted-foreground">
              El modo actual es <strong>walk-in</strong>. Para habilitar la agenda tenés que
              cambiar el modo de operación de la sucursal.
            </p>
          </div>
          <Link
            href="/dashboard/turnos/configuracion"
            className="inline-flex items-center gap-2 rounded-md border border-primary px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
          >
            <Settings className="size-4" />
            Cambiar a modo turnos →
          </Link>
        </CardContent>
      </Card>
    )
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

  if (viewMode === 'single' && !resolvedBranchId) {
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
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => shiftDate(-1)} aria-label="Día anterior">
            <ChevronLeft className="size-4" />
          </Button>
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-auto" />
          <Button variant="outline" size="icon" onClick={() => shiftDate(1)} aria-label="Día siguiente">
            <ChevronRight className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setDate(new Date().toISOString().split('T')[0])}>Hoy</Button>
          <span className="ml-1 hidden text-sm capitalize text-muted-foreground sm:inline">{dateLabel}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {visibleBranches.length > 1 && viewMode === 'single' && (
            <Select
              value={resolvedBranchId ?? ''}
              onValueChange={(v) => setSelectedBranchId(v || null)}
            >
              <SelectTrigger className="h-9 min-w-[180px] gap-2">
                <Building2 className="size-4 text-muted-foreground" />
                <SelectValue placeholder="Elegir sucursal" />
              </SelectTrigger>
              <SelectContent>
                {visibleBranches.map(b => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={String(zoom)} onValueChange={(v) => setZoom(Number(v) as ZoomLevel)}>
            <SelectTrigger className="h-9 w-[100px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="15">15 min</SelectItem>
              <SelectItem value="30">30 min</SelectItem>
              <SelectItem value="60">60 min</SelectItem>
            </SelectContent>
          </Select>
          {visibleBranches.length > 1 && (
            <Button
              variant={viewMode === 'multi' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode(viewMode === 'multi' ? 'single' : 'multi')}
            >
              <Layers className="mr-1 size-4" />
              {viewMode === 'multi' ? 'Vista consolidada' : 'Por sucursal'}
            </Button>
          )}
          <Button onClick={() => setShowBooking(true)}>
            <CalendarPlus className="mr-2 size-4" />
            Nuevo turno
          </Button>
        </div>
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

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[1fr_340px]">
        <div className="min-h-0">
          {loading ? (
            <Card className="h-full">
              <CardContent className="flex h-full items-center justify-center py-16">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </CardContent>
            </Card>
          ) : viewMode === 'multi' ? (
            <MultiBranchGrid
              branches={visibleBranches}
              appointments={appointments}
              date={date}
              onAppointmentClick={(a) => setSelectedId(a.id)}
              selectedId={selectedId}
            />
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
              blocks={blocks}
              slotInterval={settings.slot_interval_minutes}
              hoursOpen={settings.appointment_hours_open}
              hoursClose={settings.appointment_hours_close}
              zoom={zoom}
              onAppointmentClick={(a) => setSelectedId(a.id)}
              onAppointmentMove={handleMove}
              onAppointmentResize={handleResize}
              selected={{ appointmentId: selectedId ?? undefined }}
              className="h-[min(72vh,720px)]"
            />
          )}
        </div>

        <aside className="min-h-0">
          <Card className="flex h-full flex-col">
            {selected ? (
              <AppointmentDetail
                appointment={selected}
                onClose={() => setSelectedId(null)}
                onCheckIn={handleCheckIn}
                onStart={handleStart}
                onFinish={handleFinish}
                onCancel={setConfirmCancel}
                onNoShow={setConfirmNoShow}
                onRegisterPayment={setPaymentAppt}
                onConfirmPrepayment={setPrepayAppt}
                isActing={isActing}
              />
            ) : viewMode === 'multi' ? (
              <CardContent className="flex h-full flex-col items-center justify-center gap-2 py-10 text-center text-sm text-muted-foreground">
                <Calendar className="size-8 opacity-40" />
                <p>Seleccioná un turno para ver el detalle.</p>
              </CardContent>
            ) : (
              <Tabs defaultValue="blocks" className="flex h-full flex-col">
                <TabsList className="m-2 grid grid-cols-3">
                  <TabsTrigger value="blocks">Bloqueos</TabsTrigger>
                  <TabsTrigger value="waitlist">Espera</TabsTrigger>
                  <TabsTrigger value="finder">Buscador</TabsTrigger>
                </TabsList>
                <TabsContent value="blocks" className="flex-1 min-h-0 mt-0">
                  {resolvedBranchId && (
                    <AppointmentBlocksPanel
                      branchId={resolvedBranchId}
                      date={date}
                      blocks={blocks}
                      barbers={barbers}
                      onChanged={load}
                    />
                  )}
                </TabsContent>
                <TabsContent value="waitlist" className="flex-1 min-h-0 mt-0">
                  {resolvedBranchId && (
                    <AppointmentWaitlistPanel
                      branchId={resolvedBranchId}
                      entries={waitlist}
                      barbers={barbers}
                      services={services}
                      onChanged={load}
                    />
                  )}
                </TabsContent>
                <TabsContent value="finder" className="flex-1 min-h-0 mt-0">
                  {resolvedBranchId && (
                    <AppointmentTimeFinder
                      branchId={resolvedBranchId}
                      services={services}
                      barbers={barbers}
                      onPickSlot={(slot) => {
                        setDate(slot.date)
                        setShowBooking(true)
                      }}
                    />
                  )}
                </TabsContent>
              </Tabs>
            )}
          </Card>
        </aside>
      </div>

      <AppointmentBookingDialog
        open={showBooking}
        onOpenChange={setShowBooking}
        branches={visibleBranches}
        services={services}
        defaultBranchId={resolvedBranchId}
        onBooked={() => { toast.success('Turno creado'); refreshAppointments() }}
      />

      {paymentAppt && (
        <AppointmentPaymentDialog
          open={!!paymentAppt}
          onOpenChange={(o) => !o && setPaymentAppt(null)}
          appointment={paymentAppt}
          onDone={() => { setPaymentAppt(null); refreshAppointments() }}
        />
      )}

      {prepayAppt && (
        <ConfirmPrepaymentDialog
          open={!!prepayAppt}
          onOpenChange={(o) => !o && setPrepayAppt(null)}
          appointment={prepayAppt}
          defaultAmount={calcPrepaymentDefault(settings, prepayAppt)}
          onDone={() => { setPrepayAppt(null); refreshAppointments() }}
        />
      )}

      {completingEntry && (
        <CompleteServiceDialog
          entry={completingEntry}
          branchId={completingEntry.branch_id}
          onClose={() => setCompletingEntry(null)}
          onCompleted={() => {
            setCompletingEntry(null)
            toast.success('Servicio finalizado')
            refreshAppointments()
          }}
        />
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

function AppointmentDetail({
  appointment,
  onClose,
  onCheckIn,
  onStart,
  onFinish,
  onCancel,
  onNoShow,
  onRegisterPayment,
  onConfirmPrepayment,
  isActing,
}: {
  appointment: Appointment
  onClose: () => void
  onCheckIn: (a: Appointment) => void
  onStart: (a: Appointment) => void
  onFinish: (a: Appointment) => void
  onCancel: (a: Appointment) => void
  onNoShow: (a: Appointment) => void
  onRegisterPayment: (a: Appointment) => void
  onConfirmPrepayment: (a: Appointment) => void
  isActing: boolean
}) {
  const payStatus = PAYMENT_LABELS[appointment.payment_status] ?? PAYMENT_LABELS.unpaid
  return (
    <>
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-sm font-semibold">Detalle del turno</h3>
        <Button variant="ghost" size="icon" className="size-7" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>
      <CardContent className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={STATUS_LABELS[appointment.status].variant}>
            {STATUS_LABELS[appointment.status].label}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {appointment.source === 'public' ? 'Online' : 'Manual'}
          </Badge>
          <Badge variant={payStatus.variant} className="text-[10px]">
            {payStatus.label}
          </Badge>
        </div>
        <div className="space-y-1.5">
          <Row icon={<User className="size-3.5" />} label={appointment.client?.name ?? '—'} />
          {appointment.client?.phone && (
            <Row icon={<Phone className="size-3.5" />} label={appointment.client.phone} />
          )}
          {appointment.service?.name && (
            <Row icon={<Scissors className="size-3.5" />} label={appointment.service.name} />
          )}
        </div>
        <div className="rounded-md border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">Horario</p>
          <p className="font-mono text-base font-semibold">
            {formatTimeHM(appointment.start_time)} → {formatTimeHM(appointment.end_time)}
          </p>
          <p className="text-xs text-muted-foreground">
            Barbero: {appointment.barber?.full_name ?? 'Sin asignar'}
          </p>
        </div>
        {appointment.payment_status !== 'unpaid' && appointment.payment_amount !== null && (
          <div className="rounded-md border bg-emerald-500/5 p-3 text-xs">
            <p className="font-medium">Pago registrado</p>
            <p className="font-mono">
              ${Number(appointment.payment_amount).toLocaleString('es-AR')}
              {appointment.payment_method && ` · ${appointment.payment_method}`}
            </p>
          </div>
        )}
        {appointment.notes && (
          <div className="rounded-md border p-3 text-xs">
            <p className="mb-1 font-medium text-muted-foreground">Notas</p>
            <p className="whitespace-pre-wrap">{appointment.notes}</p>
          </div>
        )}
      </CardContent>
      <div className="flex flex-wrap gap-2 border-t p-3">
        {appointment.status === 'pending_payment' && (
          <Button size="sm" onClick={() => onConfirmPrepayment(appointment)} disabled={isActing}>
            <DollarSign className="mr-1 size-3.5" />
            Confirmar pago
          </Button>
        )}
        {appointment.status === 'confirmed' && (
          <Button size="sm" onClick={() => onCheckIn(appointment)} disabled={isActing}>
            Check-in
          </Button>
        )}
        {appointment.status === 'checked_in' && (
          <Button size="sm" onClick={() => onStart(appointment)} disabled={isActing}>
            Iniciar servicio
          </Button>
        )}
        {appointment.status === 'in_progress' && (
          <Button size="sm" onClick={() => onFinish(appointment)} disabled={isActing}>
            Finalizar servicio
          </Button>
        )}
        {(appointment.status === 'confirmed' || appointment.status === 'checked_in') && (
          <Button variant="outline" size="sm" onClick={() => onNoShow(appointment)} disabled={isActing}>
            No vino
          </Button>
        )}
        {appointment.status !== 'completed' && appointment.status !== 'pending_payment' && appointment.payment_status !== 'paid' && appointment.payment_status !== 'refunded' && (
          <Button variant="outline" size="sm" onClick={() => onRegisterPayment(appointment)} disabled={isActing}>
            <DollarSign className="mr-1 size-3.5" />
            Registrar pago
          </Button>
        )}
        {!['cancelled', 'completed', 'no_show'].includes(appointment.status) && (
          <Button variant="outline" size="sm" onClick={() => onCancel(appointment)} disabled={isActing}>
            Cancelar
          </Button>
        )}
      </div>
    </>
  )
}

function MultiBranchGrid({
  branches,
  appointments,
  date,
  onAppointmentClick,
  selectedId,
}: {
  branches: Branch[]
  appointments: Appointment[]
  date: string
  onAppointmentClick: (a: Appointment) => void
  selectedId: string | null
}) {
  const byBranch = useMemo(() => {
    const map = new Map<string, Appointment[]>()
    for (const a of appointments) {
      const key = a.branch_id
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(a)
    }
    return map
  }, [appointments])

  return (
    <Card className="h-full">
      <CardContent className="h-full p-0">
        <div className="h-full overflow-auto p-3 space-y-3">
          <div className="text-xs text-muted-foreground">
            Vista consolidada · {date}
          </div>
          {branches.map((b) => {
            const list = (byBranch.get(b.id) ?? []).sort((a, b) => a.start_time.localeCompare(b.start_time))
            return (
              <div key={b.id} className="rounded-md border">
                <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2">
                  <h4 className="text-sm font-semibold">{b.name}</h4>
                  <Badge variant="outline" className="text-[10px]">{list.length} turnos</Badge>
                </div>
                {list.length === 0 ? (
                  <p className="px-3 py-4 text-xs text-muted-foreground">Sin turnos.</p>
                ) : (
                  <ul className="divide-y">
                    {list.map((a) => {
                      const status = STATUS_LABELS[a.status]
                      return (
                        <li key={a.id}>
                          <button
                            onClick={() => onAppointmentClick(a)}
                            className={`w-full flex items-center gap-3 px-3 py-2 text-left text-xs hover:bg-accent ${selectedId === a.id ? 'bg-accent' : ''}`}
                          >
                            <span className="font-mono font-semibold w-14">
                              {formatTimeHM(a.start_time)}
                            </span>
                            <span className="flex-1 truncate">
                              {a.client?.name ?? 'Cliente'}
                              {a.service?.name && <span className="text-muted-foreground"> · {a.service.name}</span>}
                            </span>
                            <span className="text-muted-foreground truncate w-24 text-right">
                              {a.barber?.full_name ?? 'Sin asignar'}
                            </span>
                            <Badge variant={status.variant} className="text-[10px]">
                              {status.label}
                            </Badge>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
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
