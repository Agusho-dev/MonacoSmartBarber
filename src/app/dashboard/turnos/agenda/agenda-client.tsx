'use client'

import { useEffect, useState, useCallback, useMemo, useRef, useTransition } from 'react'
import Link from 'next/link'
import {
  Building2, Calendar, CalendarClock, CalendarPlus, ChevronLeft, ChevronRight,
  DollarSign, Loader2, Phone, Scissors, Settings, User, X, Layers, AlertCircle,
  PanelRightClose, PanelRightOpen, CalendarOff, UserX,
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
  getAppointmentSettings,
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
  type BookingPrefill,
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
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
import { cn } from '@/lib/utils'
import type {
  Appointment,
  AppointmentBlock,
  AppointmentSettings,
  AppointmentStatus,
  AppointmentWaitlist,
  QueueEntry,
} from '@/lib/types/database'
import { toDateStr, todayDateStr } from '@/lib/time-utils'

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

export function AgendaClient({ settings: orgSettings, branches }: Props) {
  const { selectedBranchId, setSelectedBranchId, allowedBranchIds } = useBranchStore()

  // Configuración EFECTIVA de la sucursal elegida. La página sólo trae el
  // default de la org, pero `appointment_settings` admite override por
  // sucursal y de ahí salen el horario de la grilla y el intervalo de slots:
  // con dos sucursales de horarios distintos, una de las dos se dibujaba mal.
  const [branchSettings, setBranchSettings] = useState<AppointmentSettings | null>(orgSettings)
  const settings = branchSettings ?? orgSettings
  const visibleBranches = useMemo(
    () => allowedBranchIds
      ? branches.filter(b => allowedBranchIds.includes(b.id))
      : branches,
    [branches, allowedBranchIds],
  )
  const resolvedBranchId = selectedBranchId ?? visibleBranches[0]?.id ?? null

  const visibleBranchIds = useMemo(() => visibleBranches.map(b => b.id), [visibleBranches])

  const [date, setDate] = useState(() => todayDateStr())
  const [loading, setLoading] = useState(false)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  /** Todos los barberos habilitados para turnos, con o sin jornada cargada. */
  const [staffTurnos, setStaffTurnos] = useState<GridBarber[]>([])
  const [services, setServices] = useState<BookingServiceOption[]>([])
  const [blocks, setBlocks] = useState<AppointmentBlock[]>([])
  const [waitlist, setWaitlist] = useState<AppointmentWaitlist[]>([])

  const [viewMode, setViewMode] = useState<'single' | 'multi'>('single')
  const [zoom, setZoom] = useState<ZoomLevel>('normal')
  const [panelAbierto, setPanelAbierto] = useState(false)

  // El panel lateral fijo de 320px se comía la grilla: a 1024px de viewport
  // quedaban ~388px para todas las columnas de barberos. Arranca cerrado en
  // pantallas chicas y el dueño lo abre cuando lo necesita. Se resuelve en un
  // efecto (y no en el inicializador del useState) porque el componente se
  // renderiza también en el server, donde no hay `window`.
  useEffect(() => {
    setPanelAbierto(window.innerWidth >= 1280)
  }, [])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showBooking, setShowBooking] = useState(false)
  const [bookingPrefill, setBookingPrefill] = useState<BookingPrefill | undefined>(undefined)
  const [confirmCancel, setConfirmCancel] = useState<Appointment | null>(null)
  const [confirmNoShow, setConfirmNoShow] = useState<Appointment | null>(null)
  const [paymentAppt, setPaymentAppt] = useState<Appointment | null>(null)
  const [prepayAppt, setPrepayAppt] = useState<Appointment | null>(null)
  const [completingEntry, setCompletingEntry] = useState<QueueEntry | null>(null)
  const [isActing, startTransition] = useTransition()

  // Turnos activos sin barbero: sólo llegan por la reserva "con cualquiera
  // disponible" que no resolvió barbero al crearse.
  const unassigned = useMemo(
    () => appointments.filter(
      a => !a.barber_id && !['cancelled', 'no_show', 'completed'].includes(a.status)
    ),
    [appointments],
  )

  /**
   * Identidad de lo que la pantalla está mostrando ahora mismo. Toda carga
   * asíncrona se sella con el scope que tenía al arrancar y se descarta si al
   * volver ya no es el vigente.
   *
   * Sin esto, navegando rápido entre fechas (o cambiando de sucursal) la carga
   * lenta terminaba DESPUÉS de la nueva y le pisaba el resultado: la grilla
   * quedaba con los turnos de un día bajo el encabezado de otro. Y como el drag
   * reprograma con la fecha del estado (`date`), arrastrar una de esas tarjetas
   * mandaba el turno al día equivocado.
   */
  const scopeActual = `${viewMode}:${resolvedBranchId ?? ''}:${date}`
  const scopeRef = useRef(scopeActual)
  // Declarado ANTES de los efectos de carga a propósito: los efectos corren en
  // orden de declaración, así que cuando `load` arranca el ref ya apunta al
  // scope nuevo y no se auto-descarta.
  useEffect(() => { scopeRef.current = scopeActual }, [scopeActual])
  const sigueVigente = useCallback((scope: string) => scopeRef.current === scope, [])

  // Refetch rápido: solo turnos del día (no barberos/bloqueos/espera).
  // Los errores se tragan a propósito (con log): es una relectura, y si falla
  // conviene dejar lo último bueno en pantalla antes que romper el render. Lo
  // que NO puede quedar sin aviso es una escritura fallida — eso lo maneja
  // `ejecutarCambioOptimista`.
  const refreshAppointments = useCallback(async () => {
    const scope = scopeActual
    try {
      if (viewMode === 'multi') {
        const branchIds = visibleBranches.map(b => b.id)
        const apts = await getAppointmentsForDateMultiBranch(branchIds, date)
        if (sigueVigente(scope)) setAppointments(apts)
        return
      }
      if (!resolvedBranchId) return
      const apts = await getAppointmentsForDate(resolvedBranchId, date)
      if (sigueVigente(scope)) setAppointments(apts)
    } catch (e) {
      console.error('[agenda] refreshAppointments', e)
    }
  }, [resolvedBranchId, date, viewMode, visibleBranches, scopeActual, sigueVigente])

  const refreshBlocks = useCallback(async () => {
    if (!resolvedBranchId) return
    const scope = scopeActual
    try {
      const data = await listAppointmentBlocksForDate(resolvedBranchId, date)
      if (sigueVigente(scope)) setBlocks(data)
    } catch (e) {
      console.error('[agenda] refreshBlocks', e)
    }
  }, [resolvedBranchId, date, scopeActual, sigueVigente])

  const refreshWaitlist = useCallback(async () => {
    if (!resolvedBranchId) return
    const scope = scopeActual
    try {
      const data = await listWaitlist(resolvedBranchId)
      if (sigueVigente(scope)) setWaitlist(data)
    } catch (e) {
      console.error('[agenda] refreshWaitlist', e)
    }
  }, [resolvedBranchId, scopeActual, sigueVigente])

  const load = useCallback(async (scope: string) => {
    if (viewMode === 'multi') {
      setLoading(true)
      try {
        const apts = await getAppointmentsForDateMultiBranch(visibleBranchIds, date)
        if (!sigueVigente(scope)) return
        setAppointments(apts)
        setStaffTurnos([])
        setBlocks([])
        setWaitlist([])
      } catch (e) {
        console.error('[agenda] load multi', e)
        if (sigueVigente(scope)) toast.error('No pudimos cargar la agenda. Probá recargar la página.')
      } finally {
        if (sigueVigente(scope)) setLoading(false)
      }
      return
    }

    if (!resolvedBranchId) {
      setAppointments([])
      setStaffTurnos([])
      setBlocks([])
      setWaitlist([])
      // Se apaga explícitamente: si la carga anterior quedó en vuelo, su
      // `finally` se saltea por scope viejo y el spinner se quedaba para
      // siempre al pasar a un estado sin sucursal.
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [apts, staffList, blocksList, waitlistEntries, effectiveSettings] = await Promise.all([
        getAppointmentsForDate(resolvedBranchId, date),
        // `onlyWithSchedule: false` a propósito: la grilla necesita saber también
        // de los que NO tienen jornada cargada, porque si tienen turnos ese día
        // hay que dibujarles la columna igual (con el rayado de "sin horario").
        // Filtrar por día en el server los descartaría justo a ellos.
        getBranchAppointmentStaff(resolvedBranchId, { onlyWithSchedule: false }),
        listAppointmentBlocksForDate(resolvedBranchId, date),
        listWaitlist(resolvedBranchId),
        getAppointmentSettings(undefined, resolvedBranchId),
      ])
      if (!sigueVigente(scope)) return
      setAppointments(apts)
      setStaffTurnos(staffList)
      setBlocks(blocksList)
      setWaitlist(waitlistEntries)
      setBranchSettings(effectiveSettings)
    } catch (e) {
      console.error('[agenda] load', e)
      if (sigueVigente(scope)) toast.error('No pudimos cargar la agenda. Probá recargar la página.')
    } finally {
      if (sigueVigente(scope)) setLoading(false)
    }
  }, [resolvedBranchId, date, viewMode, visibleBranchIds, sigueVigente])

  useEffect(() => {
    void load(scopeActual)
  }, [load, scopeActual])

  // Catálogo de servicios: sin el filtro de sucursal llegaban los de las 7
  // organizaciones (la tabla `services` no tiene `organization_id`; el scope
  // es el `branch_id`), así que el selector del diálogo listaba servicios ajenos.
  useEffect(() => {
    if (!visibleBranchIds.length) {
      setServices([])
      return
    }
    let alive = true
    ;(async () => {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()
      const { data } = await supabase
        .from('services')
        .select('id, name, price, duration_minutes, branch_id, booking_mode')
        .eq('is_active', true)
        .in('branch_id', visibleBranchIds)
        .order('name')
      if (alive) setServices((data ?? []) as BookingServiceOption[])
    })()
    return () => { alive = false }
  }, [visibleBranchIds])

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
        // Filtrado por sucursal como los otros dos canales: sin filtro, un
        // bloqueo de cualquier sucursal de cualquier org despertaba a TODAS las
        // agendas abiertas y su callback recargaba las 5 queries de la pantalla
        // (el fan-out cross-branch que saturó la DB el 30/abr).
        // Contrapartida asumida: un bloqueo org-wide (`branch_id` NULL) no
        // dispara refresh en vivo; aparece al recargar o cambiar de día.
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'appointment_blocks', filter: `branch_id=eq.${resolvedBranchId}` },
          () => { if (alive) refreshBlocks() },
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'appointment_waitlist', filter: `branch_id=eq.${resolvedBranchId}` },
          () => { if (alive) refreshWaitlist() },
        )
        .subscribe()

      cleanup = () => { supabase.removeChannel(channel) }
    })()

    return () => {
      alive = false
      cleanup?.()
    }
  }, [resolvedBranchId, date, viewMode, refreshAppointments, refreshBlocks, refreshWaitlist])

  function shiftDate(days: number) {
    const d = new Date(date + 'T12:00:00')
    d.setDate(d.getDate() + days)
    setDate(toDateStr(d))
  }

  const kpis = useMemo(() => ({
    // `getAppointmentsForDate` excluye los cancelados: este total es de turnos
    // vivos, no de todo lo que se agendó alguna vez para el día.
    total: appointments.length,
    confirmed: appointments.filter(a => a.status === 'confirmed').length,
    inProgress: appointments.filter(a => a.status === 'in_progress' || a.status === 'checked_in').length,
    completed: appointments.filter(a => a.status === 'completed').length,
    noShow: appointments.filter(a => a.status === 'no_show').length,
  }), [appointments])

  const diaSemana = useMemo(() => new Date(date + 'T12:00:00').getDay(), [date])

  /**
   * Columnas del día. Un barbero sin `staff_schedules` para esa fecha es
   * invisible para el motor de disponibilidad: dibujarle una columna limpia era
   * prometer huecos que nunca se iban a poder reservar. Pero si YA tiene turnos
   * cargados hay que mostrarlo igual, rayado, o esos turnos desaparecen.
   *
   * Ojo: `works_from`/`works_to` son el mínimo y el máximo de TODA la semana,
   * no los del día. El rayado de "fuera de horario" es por eso aproximado para
   * quien trabaja en franjas distintas según el día.
   *
   * Tercer caso, el que faltaba: un turno cuyo barbero ya NO está en
   * `staffTurnos` (se lo dio de baja —`staff.is_active = false`—, se lo sacó de
   * `appointment_staff` o se lo pasó a otra sucursal). Esa columna NO se arma
   * acá: la grilla es la que garantiza el invariante "todo turno que existe se
   * ve" y agrega sola la columna `fueraDeAgenda` para cualquier barbero con
   * turnos que no esté en la lista. Acá alcanza con avisarlo (ver
   * `huerfanosPorBarbero`) y con no bloquear el render de la grilla.
   */
  const columnas = useMemo<GridBarber[]>(() => {
    const conTurnos = new Set(
      appointments.map(a => a.barber_id).filter((id): id is string => !!id),
    )
    return staffTurnos
      .filter(s => (s.days ?? []).includes(diaSemana) || conTurnos.has(s.id))
      .map(s => ({ ...s, sinHorario: !(s.days ?? []).includes(diaSemana) }))
  }, [staffTurnos, appointments, diaSemana])

  /**
   * Turnos que quedaron colgando de un barbero que ya no está habilitado. Se
   * avisan aparte de los "sin barbero" porque el problema es otro: acá hay que
   * reasignar o cancelar, y la columna rayada al final de la grilla es fácil de
   * no ver. Mientras tanto siguen ocupando el horario por la EXCLUSION GiST.
   */
  const huerfanosPorBarbero = useMemo(() => {
    if (viewMode === 'multi') return []
    const conocidos = new Set(staffTurnos.map(s => s.id))
    return appointments.filter(
      a => a.barber_id
        && !conocidos.has(a.barber_id)
        && !['cancelled', 'no_show', 'completed'].includes(a.status),
    )
  }, [appointments, staffTurnos, viewMode])

  const diaHabilitado = !settings?.appointment_days
    || settings.appointment_days.includes(diaSemana)

  function abrirNuevoTurno(prefill?: BookingPrefill) {
    setBookingPrefill(prefill)
    setShowBooking(true)
  }

  const selected = useMemo(
    () => appointments.find(a => a.id === selectedId) ?? null,
    [selectedId, appointments],
  )

  const dateLabel = new Date(date + 'T12:00:00').toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  /**
   * Aplica un cambio optimista sobre UN turno, llama al server y revierte si el
   * server dice que no.
   *
   * Por qué existe (y por qué no alcanza con mirar `res.error`): una server
   * action puede fallar de dos maneras distintas. Puede DEVOLVER `{ error }`
   * —lo esperado, y lo único que el código manejaba— o puede RECHAZAR: red
   * caída a mitad del POST, un 500, o un action-id que ya no existe porque se
   * deployó con la pestaña abierta. En ese segundo caso, sin `try/catch`, no
   * corría ni el toast ni el refetch: la agenda quedaba mostrando el turno en
   * un horario/estado que la DB no tiene y el dueño creía que lo había movido.
   *
   * La reversión restaura SÓLO la fila del turno tocado, no un snapshot del
   * array entero: entre el optimismo y el error puede haber entrado un refetch
   * de realtime, y volver al array viejo borraría cambios ajenos.
   */
  const ejecutarCambioOptimista = useCallback(async (opts: {
    /**
     * El turno TAL COMO SE VE AHORA. Se pide entero (y no sólo el id) porque el
     * valor previo hay que capturarlo acá: leerlo adentro del updater de
     * `setAppointments` no sirve — React ejecuta el updater en el render
     * siguiente, así que para cuando hiciera falta revertir seguiría en null.
     */
    turno: Appointment
    /** Cómo se ve el turno mientras el server responde. */
    optimista: (a: Appointment) => Appointment
    accion: () => Promise<{ error?: string } | void>
    exito: string
  }): Promise<{ error?: string } | void> => {
    const previo = opts.turno
    setAppointments(prev => prev.map(a => (a.id === previo.id ? opts.optimista(a) : a)))
    const revertir = () => {
      setAppointments(prev => prev.map(a => (a.id === previo.id ? previo : a)))
    }

    try {
      const res = await opts.accion()
      if (res && res.error) {
        revertir()
        toast.error(res.error)
        void refreshAppointments()
        return { error: res.error }
      }
      toast.success(opts.exito)
      void refreshAppointments()
    } catch (e) {
      console.error('[agenda] cambio optimista', e)
      revertir()
      const error = 'No pudimos guardar el cambio. Revisá la conexión y probá de nuevo.'
      toast.error(error)
      // Igual se pide el estado real: si el server sí llegó a aplicarlo, el
      // refetch corrige la reversión que acabamos de hacer.
      void refreshAppointments()
      return { error }
    }
  }, [refreshAppointments])

  function handleCheckIn(apt: Appointment) {
    startTransition(async () => {
      await ejecutarCambioOptimista({
        turno: apt,
        optimista: a => ({ ...a, status: 'checked_in' as AppointmentStatus }),
        accion: async () => await checkinAppointment(apt.id),
        exito: 'Cliente en recepción',
      })
    })
  }

  function handleStart(apt: Appointment) {
    startTransition(async () => {
      await ejecutarCambioOptimista({
        turno: apt,
        optimista: a => ({ ...a, status: 'in_progress' as AppointmentStatus }),
        accion: async () => await startAppointmentService(apt.id),
        exito: 'Servicio iniciado',
      })
    })
  }

  async function handleFinish(apt: Appointment) {
    // Se llama desde un onClick: si la lectura rechaza y nadie la atrapa queda
    // una unhandled rejection y el botón "Finalizar servicio" no hace nada,
    // sin ningún aviso de por qué.
    try {
      const entry = await getAppointmentQueueEntry(apt.id)
      if (!entry) {
        toast.error('No se encontró la entrada de fila del turno')
        return
      }
      setCompletingEntry(entry as unknown as QueueEntry)
    } catch (e) {
      console.error('[agenda] handleFinish', e)
      toast.error('No pudimos abrir el cobro. Revisá la conexión y probá de nuevo.')
    }
  }

  function handleCancel(apt: Appointment) {
    setSelectedId(null)
    setConfirmCancel(null)
    startTransition(async () => {
      await ejecutarCambioOptimista({
        turno: apt,
        optimista: a => ({ ...a, status: 'cancelled' as AppointmentStatus }),
        accion: async () => await cancelAppointment(apt.id, 'staff'),
        exito: 'Turno cancelado',
      })
    })
  }

  function handleNoShow(apt: Appointment) {
    if (!apt.barber_id) { toast.error('Turno sin barbero asignado'); return }
    setSelectedId(null)
    setConfirmNoShow(null)
    startTransition(async () => {
      await ejecutarCambioOptimista({
        turno: apt,
        optimista: a => ({ ...a, status: 'no_show' as AppointmentStatus }),
        accion: async () => await markNoShow(apt.id, apt.barber_id!),
        exito: 'Marcado como no-show',
      })
    })
  }

  async function handleMove(args: { appointmentId: string; newBarberId: string; newTime: string }) {
    // El turno tiene que estar en el estado actual: si no está (llegó un
    // refetch que lo sacó, o la propuesta quedó vieja) no hay nada que mover
    // ni nada que revertir.
    const turno = appointments.find(a => a.id === args.appointmentId)
    if (!turno) {
      const error = 'El turno ya no está en la agenda de este día'
      toast.error(error)
      void refreshAppointments()
      return { error }
    }

    return ejecutarCambioOptimista({
      turno,
      optimista: a => {
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
      },
      accion: async () => await rescheduleAppointment({
        appointmentId: args.appointmentId,
        // `date` es el día que la grilla está mostrando. Es seguro porque las
        // cargas viejas se descartan por scope (ver `sigueVigente`): sin eso,
        // una respuesta atrasada podía dejar turnos de otro día en pantalla y
        // este reschedule los mandaba a la fecha equivocada.
        newDate: date,
        newStartTime: args.newTime,
        newBarberId: args.newBarberId,
      }),
      exito: 'Turno reprogramado',
    })
  }

  async function handleResize(args: { appointmentId: string; newDurationMinutes: number }) {
    const turno = appointments.find(a => a.id === args.appointmentId)
    if (!turno) {
      const error = 'El turno ya no está en la agenda de este día'
      toast.error(error)
      void refreshAppointments()
      return { error }
    }

    return ejecutarCambioOptimista({
      turno,
      optimista: a => {
        const [h, m] = a.start_time.split(':').map(Number)
        const startMin = h * 60 + m
        const endMin = startMin + args.newDurationMinutes
        const pad = (n: number) => String(n).padStart(2, '0')
        return {
          ...a,
          duration_minutes: args.newDurationMinutes,
          end_time: `${pad(Math.floor(endMin / 60))}:${pad(endMin % 60)}:00`,
        }
      },
      accion: async () => await updateAppointmentDuration(
        args.appointmentId,
        args.newDurationMinutes,
      ),
      exito: 'Duración actualizada',
    })
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
          <Button variant="ghost" size="sm" onClick={() => setDate(todayDateStr())}>Hoy</Button>
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
          {/* Densidad de la grilla: el alto se calcula en píxeles por minuto,
              así que cualquier intervalo de snap cae exacto. */}
          <Select value={zoom} onValueChange={(v) => setZoom(v as ZoomLevel)}>
            <SelectTrigger className="h-9 w-[120px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="compacta">Compacta</SelectItem>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="amplia">Amplia</SelectItem>
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPanelAbierto(v => !v)}
            aria-pressed={panelAbierto}
          >
            {panelAbierto
              ? <PanelRightClose className="mr-1 size-4" />
              : <PanelRightOpen className="mr-1 size-4" />}
            Panel
          </Button>
          <Button onClick={() => abrirNuevoTurno()}>
            <CalendarPlus className="mr-2 size-4" />
            Nuevo turno
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard label="Turnos activos" value={kpis.total} />
        <KpiCard label="Confirmados" value={kpis.confirmed} tone="blue" />
        <KpiCard label="En atención" value={kpis.inProgress} tone="amber" />
        <KpiCard label="Completados" value={kpis.completed} tone="slate" />
        <KpiCard label="Ausentes" value={kpis.noShow} tone="red" />
      </div>

      <div
        className={cn(
          'grid min-h-0 flex-1 grid-cols-1 gap-3',
          panelAbierto && 'lg:grid-cols-[minmax(0,1fr)_320px]',
        )}
      >
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
          ) : columnas.length === 0 && huerfanosPorBarbero.length === 0 ? (
            // El estado vacío sólo se muestra si además NO quedaron turnos
            // colgando de barberos dados de baja: en ese caso hay que dibujar
            // la grilla igual (la grilla les arma la columna) o esos turnos
            // volverían a ser invisibles, que es justo lo que se está evitando.
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                <Calendar className="size-10 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {staffTurnos.length === 0
                    ? 'No hay barberos habilitados para turnos en esta sucursal.'
                    : 'Ningún barbero tiene horario cargado para este día.'}
                </p>
                {staffTurnos.length > 0 && (
                  <Link
                    href="/dashboard/turnos/configuracion"
                    className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                  >
                    <Settings className="size-4" />
                    Cargar horarios
                  </Link>
                )}
              </CardContent>
            </Card>
          ) : (
            <>
              {!diaHabilitado && (
                <div className="mb-3 flex items-center gap-2 rounded-xl border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                  <CalendarOff className="size-4 shrink-0" />
                  La sucursal no toma turnos este día. Podés cargar uno a mano, pero
                  el turnero público no lo va a ofrecer.
                </div>
              )}
              {/* Turnos sin barbero: la grilla dibuja una columna por barbero,
                  así que un turno con barber_id NULL no aparecía en ningún
                  lado — existía, ocupaba el horario y era invisible. */}
              {unassigned.length > 0 && (
                <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                  <p className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <AlertCircle className="size-4 text-amber-500" />
                    {unassigned.length === 1
                      ? '1 turno sin barbero asignado'
                      : `${unassigned.length} turnos sin barbero asignado`}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {unassigned.map(a => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setSelectedId(a.id)}
                        className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:border-amber-500/50"
                      >
                        {a.start_time.slice(0, 5)} · {a.client?.name ?? 'Sin nombre'}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {/* Turnos de barberos que ya no están habilitados para turnos.
                  Su columna existe (rayada, al final de la grilla) pero es
                  fácil no verla: siguen ocupando el horario, así que hay que
                  reasignarlos o cancelarlos a mano. */}
              {huerfanosPorBarbero.length > 0 && (
                <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                  <p className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <UserX className="size-4 text-amber-500" />
                    {huerfanosPorBarbero.length === 1
                      ? '1 turno de un barbero que ya no toma turnos'
                      : `${huerfanosPorBarbero.length} turnos de barberos que ya no toman turnos`}
                  </p>
                  <p className="mb-2 text-xs text-muted-foreground">
                    Siguen ocupando el horario. Reasignalos a otro barbero o cancelalos.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {huerfanosPorBarbero.map(a => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setSelectedId(a.id)}
                        className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:border-amber-500/50"
                      >
                        {a.start_time.slice(0, 5)} · {a.client?.name ?? 'Sin nombre'}
                        <span className="ml-1 text-muted-foreground">
                          ({a.barber?.full_name ?? 'Barbero dado de baja'})
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            <AppointmentsGridView
              date={date}
              barbers={columnas}
              appointments={appointments}
              blocks={blocks}
              slotInterval={settings.slot_interval_minutes}
              hoursOpen={settings.appointment_hours_open}
              hoursClose={settings.appointment_hours_close}
              zoom={zoom}
              onSlotClick={(barberId, time) => abrirNuevoTurno({ date, barberId, time })}
              onAppointmentClick={(a) => setSelectedId(a.id)}
              onAppointmentMove={handleMove}
              onAppointmentResize={handleResize}
              selected={{ appointmentId: selectedId ?? undefined }}
              className="h-[min(72vh,720px)]"
            />
            </>
          )}
        </div>

        {panelAbierto && (
        <aside className="min-h-0">
          <Card className="flex h-full flex-col">
            {viewMode === 'multi' ? (
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
                      barbers={staffTurnos}
                      onChanged={refreshBlocks}
                    />
                  )}
                </TabsContent>
                <TabsContent value="waitlist" className="flex-1 min-h-0 mt-0">
                  {resolvedBranchId && (
                    <AppointmentWaitlistPanel
                      branchId={resolvedBranchId}
                      entries={waitlist}
                      barbers={staffTurnos}
                      services={services}
                      onChanged={refreshWaitlist}
                    />
                  )}
                </TabsContent>
                <TabsContent value="finder" className="flex-1 min-h-0 mt-0">
                  {resolvedBranchId && (
                    <AppointmentTimeFinder
                      branchId={resolvedBranchId}
                      services={services}
                      barbers={staffTurnos}
                      onPickSlot={(slot) => {
                        // El buscador ya resolvió día, hora y barbero: abrir el
                        // diálogo en blanco obligaba a re-elegir las tres cosas.
                        setDate(slot.date)
                        abrirNuevoTurno({
                          date: slot.date,
                          barberId: slot.barberId,
                          time: slot.time,
                        })
                      }}
                    />
                  )}
                </TabsContent>
              </Tabs>
            )}
          </Card>
        </aside>
        )}
      </div>

      {/* Detalle del turno como Sheet (drawer overlay) — no comprime el grid */}
      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-md flex flex-col gap-0 p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Detalle del turno</SheetTitle>
          </SheetHeader>
          {selected && (
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
          )}
        </SheetContent>
      </Sheet>

      <AppointmentBookingDialog
        open={showBooking}
        onOpenChange={setShowBooking}
        branches={visibleBranches}
        services={services}
        defaultBranchId={resolvedBranchId}
        prefill={bookingPrefill}
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
  // `min-w-0` + `truncate`: el main del dashboard tiene `overflow-x-hidden`, así
  // que una etiqueta larga no ensancha la tarjeta, se recorta contra el borde.
  return (
    <Card className="min-w-0 gap-0 py-0">
      <CardContent className="min-w-0 px-3 py-2.5">
        <p className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className={`text-2xl font-bold leading-tight tabular-nums ${toneMap[tone]}`}>{value}</p>
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
