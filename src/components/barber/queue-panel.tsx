'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useVisibilityRefresh } from '@/hooks/use-visibility-refresh'
import { attendNextClient, cancelQueueEntry } from '@/lib/actions/queue'
import { fetchBarberDayStats, fetchBranchAssignmentData } from '@/lib/actions/barber'
import { logoutBarber } from '@/lib/actions/auth'
import {
  requestBreak,
  getBarberActiveBreakRequest,
  cancelBreakRequest,
  completeBreakRequest,
  approveBreak as approveBreakAction,
  rejectBreak as rejectBreakAction,
  getPendingBreakRequests,
  startPendingBreakIfReady,
} from '@/lib/actions/breaks'
import { getTodayAppointmentsForStaff, markAppointmentInProgress } from '@/lib/actions/barber-turnos'
import { getAppointmentQueueEntry } from '@/lib/actions/appointments'
import { marcarAsesoriaVista } from '@/lib/actions/asesoria'
import type { Appointment, QueueEntry, Staff, Client, BreakConfig, StaffSchedule } from '@/lib/types/database'
import {
  aceptacionesWhatsAppNuevas,
  armarMiFila,
  asesoriasNuevas,
  assignDynamicBarbers,
  esMovidaPorWhatsApp,
  esMovidaPorWhatsAppDe,
  leerVistaAsesoria,
  marcasDeAceptacionWhatsApp,
  marcasDeAsesoria,
  serializarVistaAsesoria,
  ultimaLlegadaVista,
  type VistaAsesoria,
} from '@/lib/barber-utils'
import { avisarYRecargarPorVersion, esErrorDeVersion, TEXTO_RECARGA_MANUAL } from '@/lib/recarga-version'
import { leerLoyaltyEmbed } from '@/lib/loyalty-embed'
import { cn } from '@/lib/utils'
import {
  appointmentInstantMs,
  findNextAppointment,
  formatHourMinute,
  protectionWindowMinutes,
} from '@/lib/queue-appointments'
import { BarberTimeline } from '@/components/barber/barber-timeline'
import { AppointmentStrip } from '@/components/barber/appointment-strip'
import { AppointmentDetailSheet } from '@/components/barber/appointment-detail-sheet'
import { UpcomingAppointmentBanner } from '@/components/barber/upcoming-appointment-banner'
import { NextAppointmentNotice } from '@/components/barber/next-appointment-notice'
import { TurnoBadge } from '@/components/appointments/turno-badge'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CampoContadorTablet } from '@/components/barber/campo-tablet'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import {
  Clock,
  User,
  Scissors,
  LogOut,
  X,
  Coffee,
  CalendarClock,
  CheckCircle2,
  XCircle,
  Power,
  EyeOff,
  Eye,
  MoreHorizontal,
  CalendarDays,
  PackageCheck,
  ShoppingBag,
  MessageCircle,
  Zap,
  ChevronRight,
} from 'lucide-react'
import { toast } from 'sonner'
import { CompleteServiceDialog } from './complete-service-dialog'
import { CouponScanDialog } from './coupon-scan-dialog'
import { LoyaltyTierChip } from './loyalty-tier-chip'
import { findLoyaltyTier, type LoyaltyTierLite } from '@/lib/loyalty-checkout'
import { DirectSaleDialog } from './direct-sale-dialog'
import { ClientProfileSheet } from './client-profile-sheet'
import { ActiveClientCard, ActiveBreakCard } from './active-client-card'
import { NextClientAlert } from './next-client-alert'
import { BarberStatsBar } from './barber-stats-bar'
import { AsesoriaBadge } from './asesoria-badge'
import { AsesoriaInicioDialog, type ModoAsesoriaDialog } from './asesoria-inicio-dialog'
import { mostrarAvisosAsesoria } from './asesoria-aviso'
import { playAsesoriaChime, playBeep, primeAudioContext, vibrate } from '@/lib/barber-feedback'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

interface BarberSession {
  staff_id: string
  full_name: string
  branch_id: string
  /** Org de la sesión (getBarberSession la trae): filtra `loyalty_tiers`. */
  organization_id?: string
  role: string
  role_id?: string | null
  permissions?: Record<string, boolean>
}

interface QueuePanelProps {
  session: BarberSession
  branchName: string
  breakConfigs?: BreakConfig[]
  appointments?: Appointment[]
  noShowToleranceMinutes?: number
  /** Modo de operación de la sucursal: afecta el layout del panel */
  operationMode?: 'walk_in' | 'appointments' | 'hybrid'
  /** TZ de la sucursal: las horas de turno son hora de pared, no del dispositivo. */
  timezone?: string | null
  /** `appointment_settings.buffer_minutes`: define la ventana de protección. */
  bufferMinutes?: number | null
  /**
   * `loyalty_settings.is_enabled` de la org (lo lee el server: la tabla es sólo
   * service role). Apagado → sin chips de categoría en la fila ni en el cobro,
   * igual que la app y el dashboard; `tier_code` queda cargado en el estado.
   */
  loyaltyEnabled?: boolean
}

interface BreakRequestRow {
  id: string
  staff_id: string
  branch_id: string
  break_config_id: string
  status: string
  cuts_before_break: number
  requested_at: string
  staff?: { id: string; full_name: string } | null
  break_config?: { name: string; duration_minutes: number } | null
}

/**
 * La tarjeta de quien acaba de pedir asesoría lleva un anillo fucsia este
 * tiempo (12 s): lo que el aviso anunció se encuentra de un vistazo en la fila.
 */
const ANILLO_ASESORIA_MS = 12_000

/**
 * Cuánto vale lo visto de la fila para los avisos de asesoría (sessionStorage):
 * volver de Caja, Historial o Metas anuncia lo que llegó en el medio. Una vista
 * más vieja vuelve a sembrar.
 */
const VIGENCIA_VISTA_ASESORIA_MS = 2 * 60 * 60_000

/** Clave de sessionStorage de lo visto: por sucursal y barbero (en la misma pestaña puede entrar otro). */
function claveVistaAsesoria(branchId: string, staffId: string): string {
  return `msb.asesoria-vista.v1:${branchId}:${staffId}`
}

/** Lo visto guardado, o null (no hay, no sirve o no hay sessionStorage). Nunca lanza. */
function leerVistaGuardada(clave: string): VistaAsesoria | null {
  try {
    return leerVistaAsesoria(window.sessionStorage.getItem(clave), Date.now(), VIGENCIA_VISTA_ASESORIA_MS)
  } catch {
    return null
  }
}

/** Guarda lo visto. Sin sessionStorage (navegación privada, sitio bloqueado) no pasa nada: se vuelve a sembrar. */
function guardarVista(clave: string, vista: VistaAsesoria) {
  try {
    window.sessionStorage.setItem(clave, serializarVistaAsesoria(vista, Date.now()))
  } catch {
    // sin sessionStorage: al volver a la fila se siembra de nuevo, como antes
  }
}

/** Una acción del panel que no devolvió nada (falló o el panel se recarga). */
const SIN_RESPUESTA = Symbol('sin-respuesta')

/**
 * Corre la server action de un botón del panel. Si el panel quedó con el
 * bundle de un deploy anterior (seguridad-y-despliegue-01), avisa y recarga
 * (src/lib/recarga-version.ts) en vez de un error genérico: reintentar no
 * sirve, la acción ya no existe en el servidor. Ante otra falla (la red),
 * muestra `textoError`. Nunca lanza: devuelve SIN_RESPUESTA, y el que llama
 * apaga su spinner igual (antes «Atender» quedaba girando para siempre).
 */
async function correrAccion<T>(accion: () => Promise<T>, textoError: string): Promise<T | typeof SIN_RESPUESTA> {
  try {
    return await accion()
  } catch (e) {
    console.error('[queue-panel]', textoError, e)
    if (esErrorDeVersion(e)) {
      if (!avisarYRecargarPorVersion()) toast.error(TEXTO_RECARGA_MANUAL, { id: 'recarga-manual' })
    } else {
      toast.error(textoError)
    }
    return SIN_RESPUESTA
  }
}

/**
 * El staff que lee el panel con la anon key: sin teléfono ni comisión, que
 * anon ya no puede leer (mig 224, Known Risk #34). Es `Staff` con esas dos
 * columnas opcionales; el panel nunca las usó.
 */
type StaffDelPanel = Omit<Staff, 'phone' | 'commission_pct'> & Partial<Pick<Staff, 'phone' | 'commission_pct'>>

export function QueuePanel({
  session,
  branchName,
  breakConfigs = [],
  appointments = [],
  noShowToleranceMinutes: _noShowToleranceMinutes = 15,
  operationMode = 'walk_in',
  timezone,
  bufferMinutes,
  loyaltyEnabled = true,
}: QueuePanelProps) {
  const [entries, setEntries] = useState<QueueEntry[]>([])
  // true desde la primera lectura EXITOSA de la fila. `loading` no sirve para
  // esto: se apaga aunque la lectura falle, y el aviso de asesoría tiene que
  // sembrar lo visto con datos reales (si sembrara con la fila vacía de un
  // error, la lectura siguiente anunciaría como nuevos a todos los que ya
  // estaban esperando).
  const [filaLeida, setFilaLeida] = useState(false)
  // Turnos del día de este barbero. Arranca con el snapshot del server y se
  // refresca al volver al tab / cada 60s: sin eso, un turno cargado después de
  // abrir el panel no aparecía nunca. 60s (y no el ciclo de 30s de la cola)
  // porque es dato de agenda, no de tiempo real — Known Risk #9.
  const [todayAppointments, setTodayAppointments] = useState<Appointment[]>(appointments)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [completingEntry, setCompletingEntry] = useState<QueueEntry | null>(null)
  const [now, setNow] = useState(Date.now())
  const [dailyServiceCounts, setDailyServiceCounts] = useState<Record<string, number>>({})
  const [lastCompletedAt, setLastCompletedAt] = useState<Record<string, string>>({})
  const [lastClockInAt, setLastClockInAt] = useState<Record<string, string>>({})
  // (mig 131) `fairBarberId` removido: el filter que ocultaba dinámicas dejó
  // un limbo cuando el ranking local difería del server. Ahora la atomicidad
  // se garantiza con FOR UPDATE SKIP LOCKED en `claim_next_for_barber`.
  const [dayStats, setDayStats] = useState({ servicesCount: 0, revenue: 0 })
  const [otherBarbers, setOtherBarbers] = useState<StaffDelPanel[]>([])
  const [allBarbers, setAllBarbers] = useState<StaffDelPanel[]>([])
  // true desde la primera lectura de los barberos (con su fichaje y los datos
  // del hint). Los avisos de asesoría la esperan: sin ella no se sabe si este
  // barbero fichó ni quién tiene a quién en su «Mi fila».
  const [barberosLeidos, setBarberosLeidos] = useState(false)
  const [notClockedInBarbers, setNotClockedInBarbers] = useState<Set<string>>(new Set())
  const [schedules, setSchedules] = useState<StaffSchedule[]>([])
  const [profileClient, setProfileClient] = useState<Client | null>(null)
  // Break request state
  const [breakDialogOpen, setBreakDialogOpen] = useState(false)
  const [selectedBreakConfig, setSelectedBreakConfig] = useState('')
  const [breakRequestStatus, setBreakRequestStatus] = useState<string | null>(null)
  const [breakRequestId, setBreakRequestId] = useState<string | null>(null)
  const [breakRequestLoading, setBreakRequestLoading] = useState(false)
  const [breakDurationMinutes, setBreakDurationMinutes] = useState<number | null>(null)
  // Self-approve cuts
  const [selfApproveCuts, setSelfApproveCuts] = useState('0')
  // Break requests management (for barbers with breaks.grant)
  const [breakRequestsDialogOpen, setBreakRequestsDialogOpen] = useState(false)
  const [pendingBreakRequests, setPendingBreakRequests] = useState<BreakRequestRow[]>([])
  const [approveLoading, setApproveLoading] = useState<string | null>(null)
  const [approveCutsInputs, setApproveCutsInputs] = useState<Record<string, string>>({})
  const [shiftEndMargin, setShiftEndMargin] = useState(35)

  const [deactivateDialogOpen, setDeactivateDialogOpen] = useState(false)
  const [deactivateLoading, setDeactivateLoading] = useState<string | null>(null)

  const [hiddenFromCheckin, setHiddenFromCheckin] = useState(false)
  const [hiddenLoading, setHiddenLoading] = useState(false)

  const [directSaleOpen, setDirectSaleOpen] = useState(false)
  // Entrega de un premio merch/especial SIN cobro (el cliente pasa a retirar la
  // gorra): escáner en modo entrega → `deliverRewardByQr`.
  const [deliverRewardOpen, setDeliverRewardOpen] = useState(false)
  // (mobilePanelTab eliminado: no se usaba en el render)

  // ── Turnos: tira compacta + agenda completa a demanda ──
  // Turno abierto desde un chip de la tira (detalle + acciones).
  const [stripAppointment, setStripAppointment] = useState<Appointment | null>(null)
  // Agenda completa (el timeline) en una hoja a pantalla completa.
  const [agendaSheetOpen, setAgendaSheetOpen] = useState(false)
  // Turno cuyo `queue_entry` estamos cargando para poder cobrarlo.
  const [loadingApptEntryId, setLoadingApptEntryId] = useState<string | null>(null)

  // Next client alert state
  const [nextClientAlertMinutes, setNextClientAlertMinutes] = useState(5)
  const [idleSince, setIdleSince] = useState<number | null>(null)
  const [showWaitWarning, setShowWaitWarning] = useState(false)
  const [warningStarting, setWarningStarting] = useState(false)
  const audioContextRef = useRef<AudioContext | null>(null)
  const beepIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const prevBreakRequestCountRef = useRef<number>(0)

  const supabase = useMemo(() => createClient(), [])

  // Categorías del programa de fidelización (mig 196): nombre y colores que definió
  // el dueño, cargadas UNA vez por sesión. Policy pública `loyalty_tiers_public_read`
  // (la tablet va con anon + PIN); se filtra por org para no mezclar categorías de
  // otra organización. Sin filas (programa sin configurar) → ningún chip.
  // Con el programa APAGADO no se consultan (quedan []): `tier_code` sigue cargado
  // en client_loyalty_state y sin esto la tablet mostraba "ORO" mientras la app
  // y el dashboard decían que no hay categoría.
  const [loyaltyTiers, setLoyaltyTiers] = useState<LoyaltyTierLite[]>([])
  useEffect(() => {
    if (!loyaltyEnabled) return
    let cancelled = false
    let q = supabase
      .from('loyalty_tiers')
      .select('code, name, color_primary, color_secondary, text_color')
      .eq('is_active', true)
      .order('sort_order')
    if (session.organization_id) q = q.eq('organization_id', session.organization_id)
    q.then(({ data, error }) => {
      if (error) {
        console.error('[queue-panel] loyalty_tiers:', error.message)
        return
      }
      if (!cancelled && data) setLoyaltyTiers(data as LoyaltyTierLite[])
    })
    return () => { cancelled = true }
  }, [supabase, session.organization_id, loyaltyEnabled])

  const canManageBreaks = session.role === 'admin' || session.role === 'owner' || session.permissions?.['breaks.grant'] === true
  const canDeactivateStaff = session.role === 'admin' || session.role === 'owner' || session.permissions?.['staff.deactivate'] === true
  const canHideSelf = session.role === 'admin' || session.role === 'owner' || session.permissions?.['queue.hide_self'] === true

  const fetchQueue = useCallback(async () => {
    // Query liviano: eliminamos visits(count) — era un correlated subquery por cliente
    // que generaba 177k calls/día según pg_stat_statements. El conteo ya vive en
    // clients.total_visits y en la vista client_loyalty_state.total_visits.
    // tier_code / visits_in_window (mig 196) salen de la MISMA fila: cero queries extra.
    const { data, error } = await supabase
      .from('queue_entries')
      .select('*, client:clients(id, name, phone, loyalty:client_loyalty_state(total_visits, tier_code, visits_in_window)), barber:staff(id, full_name, avatar_url), service:services(id, name, duration_minutes, price)')
      .eq('branch_id', session.branch_id)
      .in('status', ['waiting', 'in_progress'])
      .order('position')

    // Con error se conserva la última fila buena (Realtime vuelve a leer en el
    // próximo evento), pero que quede rastro (Known Risk #5/#13).
    if (error) console.error('[queue-panel] fila:', error.message)
    if (data) {
      setEntries(data as QueueEntry[])
      setFilaLeida(true)
    }
    setLoading(false)
  }, [supabase, session.branch_id])

  const refreshStats = useCallback(async () => {
    const stats = await fetchBarberDayStats(session.staff_id, session.branch_id)
    setDayStats(stats)
  }, [session.staff_id, session.branch_id])

  const refreshAppointments = useCallback(async () => {
    const rows = await getTodayAppointmentsForStaff(session.staff_id, session.branch_id)
    setTodayAppointments(rows)
  }, [session.staff_id, session.branch_id])

  // Ref espejo de allBarbers para que fetchAssignmentData pueda leerlo sin
  // recrearse cuando cambia la lista de barberos (mantiene useCallback estable
  // y evita re-suscripciones del canal Realtime).
  const allBarbersRef = useRef<StaffDelPanel[]>([])

  // Refresca los inputs del sort dinámico (dailyServiceCounts, lastCompletedAt)
  // Y el estado de fichaje (notClockedInBarbers). Llamado en cada evento Realtime
  // de queue_entries para que los paneles converjan al mismo "barbero más justo"
  // tras completar un servicio en otro tablet, y para que un barbero que recién
  // fichó deje de estar marcado como "no fichado" cuando llega un cliente nuevo.
  //
  // attendance viene acá porque la tabla salió del realtime publication (mig 124)
  // y antes el panel quedaba con notClockedInBarbers stale toda la jornada —
  // incidente prod 2026-05-28: un dinámico se pre-asignó al único barbero que el
  // panel "veía" fichado (su propio dueño), aunque otros estuvieran libres.
  const fetchAssignmentData = useCallback(async () => {
    const data = await fetchBranchAssignmentData(session.branch_id)
    setDailyServiceCounts(data.dailyServiceCounts ?? {})
    setLastCompletedAt(data.lastCompletedAt ?? {})
    // Hora del fichaje de entrada vigente (criterio 0b del hint de Menor espera
    // por WhatsApp). Sale de esta action —y no de la consulta de fichajes de
    // `fetchBarbersAndSchedules`— a propósito: esa corre al abrir el panel y cada
    // tablet la tiene de un momento distinto; ésta la refrescan TODAS en cada
    // evento de la fila, así que todas calculan el mismo hint.
    setLastClockInAt(data.latestClockInAt ?? {})

    const latestAttendance = data.latestAttendance ?? {}
    const notClocked = new Set<string>()
    for (const b of allBarbersRef.current) {
      if (latestAttendance[b.id] !== 'clock_in') {
        notClocked.add(b.id)
      }
    }
    setNotClockedInBarbers(notClocked)
  }, [session.branch_id])

  const fetchBarbersAndSchedules = useCallback(async () => {
    const [barbersRes, schedRes, settingsRes, attendanceRes, assignmentData] = await Promise.all([
      supabase
        .from('staff')
        // Columnas explícitas: el panel corre con la anon key (se autentica por PIN,
        // no por Supabase Auth), así que `select('*')` le entregaba el `pin` de todos
        // sus compañeros a cualquiera con las devtools abiertas. Ver mig 212. Sin
        // `phone` ni `commission_pct` desde la mig 224: anon ya no las lee y pedirlas
        // haría fallar la consulta entera con 42501 (Known Risk #34).
        .select('id, full_name, branch_id, role, role_id, status, avatar_url, hidden_from_checkin, hidden_from_mobile, is_active, is_also_barber, organization_id, created_at, updated_at, deleted_at')
        .eq('branch_id', session.branch_id)
        .or('role.eq.barber,is_also_barber.eq.true')
        .eq('is_active', true)
        .order('full_name'),
      supabase
        .from('staff_schedules')
        .select('*')
        .eq('day_of_week', new Date().getDay())
        .eq('is_active', true),
      // Por organización: `app_settings` es legible por anon ENTERA (policy
      // `settings_anon_read`), una fila por org. Sin el filtro `.maybeSingle()`
      // recibía 14 filas, devolvía error (PGRST116) y el panel caía en silencio a
      // los defaults: margen de fin de turno 35 donde Monaco configuró 15. Mismo
      // desempate que el tick de la mig 218 si alguna vez hubiera dos filas.
      session.organization_id
        ? supabase
            .from('app_settings')
            .select('shift_end_margin_minutes, next_client_alert_minutes')
            .eq('organization_id', session.organization_id)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase
        .from('attendance_logs')
        .select('staff_id, action_type')
        .eq('branch_id', session.branch_id)
        .gte('recorded_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
        .order('recorded_at', { ascending: false }),
      // Server action: si falla (la red, un deploy nuevo) no se lleva puesta al
      // resto de la carga — sin barberos no hay hint ni avisos de asesoría.
      fetchBranchAssignmentData(session.branch_id).catch((e: unknown) => {
        console.error('[queue-panel] datos de asignación:', e)
        return null
      }),
    ])

    if (barbersRes.error) console.error('[queue-panel] barberos:', barbersRes.error.message)
    if (barbersRes.data) {
      const barberos = barbersRes.data as StaffDelPanel[]
      setAllBarbers(barberos)
      setOtherBarbers(barberos.filter(b => b.id !== session.staff_id))

      const latestAttendance: Record<string, string> = {}
      if (attendanceRes.data) {
        attendanceRes.data.forEach((log: { staff_id: string; action_type: string }) => {
          if (!latestAttendance[log.staff_id]) {
            latestAttendance[log.staff_id] = log.action_type
          }
        })
      }
      const notClocked = new Set<string>()
      for (const b of barberos) {
        if (latestAttendance[b.id] !== 'clock_in') {
          notClocked.add(b.id)
        }
      }
      setNotClockedInBarbers(notClocked)
    }

    if (schedRes.data) {
      setSchedules(schedRes.data as StaffSchedule[])
    }

    // Con error se conservan los valores que ya había (o los defaults), pero que
    // quede rastro: este error estuvo escondido meses (Known Risk #13).
    if (settingsRes.error) {
      console.error('[queue-panel] app_settings:', settingsRes.error.message)
    }
    if (settingsRes.data) {
      const settingsData = settingsRes.data as { shift_end_margin_minutes?: number; next_client_alert_minutes?: number }
      const margin = settingsData.shift_end_margin_minutes
      if (typeof margin === 'number' && margin >= 0) {
        setShiftEndMargin(margin)
      }
      const alertMin = settingsData.next_client_alert_minutes
      if (typeof alertMin === 'number' && alertMin > 0) {
        setNextClientAlertMinutes(alertMin)
      }
    }

    if (assignmentData) {
      setDailyServiceCounts(assignmentData.dailyServiceCounts ?? {})
      setLastCompletedAt(assignmentData.lastCompletedAt ?? {})
      setLastClockInAt(assignmentData.latestClockInAt ?? {})
    }
    if (barbersRes.data) setBarberosLeidos(true)
  }, [supabase, session.branch_id, session.staff_id, session.organization_id])

  const fetchBreakRequestStatus = useCallback(async () => {
    const { data } = await getBarberActiveBreakRequest(session.staff_id)
    if (data) {
      setBreakRequestStatus(data.status)
      setBreakRequestId(data.id)
      setBreakDurationMinutes((data.break_config as { duration_minutes?: number } | null)?.duration_minutes ?? null)
    } else {
      setBreakRequestStatus(null)
      setBreakRequestId(null)
      setBreakDurationMinutes(null)
    }
  }, [session.staff_id])

  const fetchPendingBreakRequests = useCallback(async () => {
    if (!canManageBreaks) return
    const { data } = await getPendingBreakRequests(session.branch_id)
    if (data) {
      // Filter out the current barber's own requests
      setPendingBreakRequests(
        (data as BreakRequestRow[]).filter(r => r.staff_id !== session.staff_id)
      )
    }
  }, [canManageBreaks, session.branch_id, session.staff_id])

  const fetchHiddenStatus = useCallback(async () => {
    const { data } = await supabase
      .from('staff')
      .select('hidden_from_checkin')
      .eq('id', session.staff_id)
      .single()
    if (data) setHiddenFromCheckin(data.hidden_from_checkin ?? false)
  }, [supabase, session.staff_id])

  useEffect(() => {
    fetchQueue()
    refreshStats()
    fetchBarbersAndSchedules()
    fetchBreakRequestStatus()
    fetchPendingBreakRequests()
    fetchHiddenStatus()

    const channel = supabase
      .channel(`barber-queue-${session.branch_id}-${session.staff_id}`)
      // queue_entries → solo refresca cola + stats, NO barbers/schedules (son datos estables)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'queue_entries',
          filter: `branch_id=eq.${session.branch_id}`,
        },
        () => {
          fetchQueue()
          refreshStats()
          // Re-fetch counts/last_completed para que el sort dinámico converja entre tablets
          // (un completed en otro panel cambia los inputs del ranking).
          fetchAssignmentData()
        }
      )
      // staff → solo refresca barberos + estado de visibilidad propio
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'staff',
          filter: `branch_id=eq.${session.branch_id}`,
        },
        () => {
          fetchBarbersAndSchedules()
          fetchHiddenStatus()
        }
      )
      // break_requests filtrado por branch_id para evitar stampede multi-sucursal
      // (attendance_logs fue removido de supabase_realtime publication — listener eliminado)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'break_requests',
          filter: `branch_id=eq.${session.branch_id}`,
        },
        () => {
          fetchBreakRequestStatus()
          fetchPendingBreakRequests()
        }
      )
      .subscribe((status) => {
        // Re-fetch todo al reconectar el WebSocket
        if (status === 'SUBSCRIBED') {
          fetchQueue()
          refreshStats()
          fetchBarbersAndSchedules()
          fetchBreakRequestStatus()
          fetchPendingBreakRequests()
          fetchHiddenStatus()
        }
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, session.branch_id, session.staff_id, fetchQueue, refreshStats, fetchAssignmentData, fetchBarbersAndSchedules, fetchBreakRequestStatus, fetchPendingBreakRequests, fetchHiddenStatus])

  // Mantener el ref sincronizado con allBarbers. fetchAssignmentData lo usa para
  // derivar notClockedInBarbers sin depender de allBarbers en su closure (mantiene
  // estable el useCallback y evita re-suscripciones del canal Realtime).
  useEffect(() => {
    allBarbersRef.current = allBarbers
  }, [allBarbers])

  // Al volver al tab o en el polling fallback, refrescamos cola, stats y datos
  // de asignación. fetchAssignmentData entra acá tras el incidente 2026-05-28:
  // attendance_logs no está en realtime publication (mig 124), así que un
  // barbero que ficha mientras este panel ya está abierto solo se hace visible
  // cuando entra un cliente (que dispara fetchAssignmentData en queue_entries
  // event) o cuando vuelve el foco al tab. Sin esta tercera vía, un panel sin
  // clientes nuevos pero con otros fichajes posteriores quedaba con
  // notClockedInBarbers stale hasta reconectar el WS.
  useVisibilityRefresh(
    useCallback(() => {
      fetchQueue()
      refreshStats()
      fetchAssignmentData()
      // Si la primera lectura de los barberos falló, se reintenta acá: sin ella
      // no salen los avisos de asesoría (ver `barberosLeidos`).
      if (!barberosLeidos) fetchBarbersAndSchedules()
    }, [fetchQueue, refreshStats, fetchAssignmentData, barberosLeidos, fetchBarbersAndSchedules]),
    30_000
  )

  // La agenda va por su propio carril y más lento: un turno nuevo no necesita
  // llegar en tiempo real, y sumarlo al refresco de 30s de la cola duplicaba
  // queries en cada tablet sin ganar nada.
  useVisibilityRefresh(refreshAppointments, 60_000)

  useEffect(() => {
    // 5s en lugar de 1s: los textos "elapsed" no necesitan resolución de segundo,
    // y bajar la frecuencia ahorra 30-60% de CPU en tablets de gama baja.
    const interval = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(interval)
  }, [])

  // Timestamp estable para la asignación dinámica: solo cambia cuando los datos subyacentes
  // cambian (entries, barbers, etc.), NO cada segundo. Esto garantiza que todos los
  // dispositivos que reciben el mismo evento Realtime calculen la misma asignación,
  // evitando que clientes aparezcan en la fila de barberos distintos por diferencias de reloj.
  const assignmentTimeRef = useRef<number>(Date.now())
  useEffect(() => {
    assignmentTimeRef.current = Date.now()
  }, [entries, allBarbers, dailyServiceCounts, lastCompletedAt, lastClockInAt, notClockedInBarbers])
  const assignmentTime = assignmentTimeRef.current

  const dynamicEntries = useMemo(() => {
    // `as Staff[]`: el hint sólo lee id, visibilidad y horario, y del barbero
    // elegido el panel muestra el nombre. El teléfono y la comisión no llegan
    // (ver StaffDelPanel) y nadie los lee.
    return assignDynamicBarbers(entries, allBarbers as Staff[], schedules, assignmentTime, shiftEndMargin, dailyServiceCounts, lastCompletedAt, notClockedInBarbers, {}, lastClockInAt)
  }, [entries, allBarbers, schedules, assignmentTime, shiftEndMargin, dailyServiceCounts, lastCompletedAt, notClockedInBarbers, lastClockInAt])

  // My active break (ghost entry that is in_progress)
  const myActiveBreak = dynamicEntries.find(
    (e) => e.barber_id === session.staff_id && e.status === 'in_progress' && e.is_break
  )

  const myActiveEntry = dynamicEntries.find(
    (e) => e.barber_id === session.staff_id && e.status === 'in_progress' && !e.is_break
  )

  // "Mi fila" (`armarMiFila`, barber-utils): lo de este barbero en el orden en
  // que lo va a atender —sus clientes y descansos, los dinámicos que el hint le
  // sugirió y (mig 218) los que lo esperaban a él y aceptaron Menor espera por
  // WhatsApp—. Todo lo que cuelga de acá sale de esta lista: el "Atender" de la
  // primera tarjeta, el contador de la pestaña, la alerta de "tu cliente te está
  // esperando" y los walk-ins que frena la ventana de un turno.
  //
  // Un mismo cliente sí puede estar en dos "Mi fila" a la vez: el dinámico cuyo
  // hint difiere entre tablets, y a propósito el que aceptó por WhatsApp (en la
  // del barbero que esperaba Y en la del libre que le sugiere el hint). La
  // atomicidad la garantiza FOR UPDATE SKIP LOCKED en `claim_next_for_barber`: el
  // primer tap gana y el segundo recibe un toast y el siguiente de su fila.
  // (mig 131: el fairness gate que ocultaba dinámicos dejaba limbos donde el
  // cliente no estaba en NINGUNA "Mi fila"; no volver a filtrar por ranking.)
  const myWaitingEntries = armarMiFila(dynamicEntries, session.staff_id)

  // "Fila general": ALL waiting clients
  const allWaitingEntries = dynamicEntries.filter((e) => e.status === 'waiting')

  // Real waiting clients for this barber (non-break)
  const myRealWaitingEntries = myWaitingEntries.filter(e => !e.is_break)

  /**
   * Gente que está esperando y NO es de nadie, o que lleva demasiado. Es lo que hace
   * falta para que la pestaña "General" deje de ser un cajón silencioso: un cliente
   * del pool cuyo hint no cayó en ninguna "Mi fila" sólo existe ahí, y la pestaña por
   * defecto es "Mi fila". Con el contador en gris nadie la abría.
   */
  const alertasEnGeneral = allWaitingEntries.filter(e => {
    if (e.is_break) return false
    const sinDueño = !e.barber_id
    const demorado = now - new Date(e.checked_in_at).getTime() >= 40 * 60 * 1000
    return sinDueño || demorado
  }).length

  // Un turno cuyo cliente YA está en la fila no deja al barbero frenado: la
  // ventana de protección bloquea walk-ins, pero `claim_next_for_barber` sí le
  // entrega al del turno. Por eso se cuentan aparte de los walk-ins.
  const myWaitingAppointment = myRealWaitingEntries.find((e) => e.is_appointment)
  const myWaitingWalkInsCount = myRealWaitingEntries.filter((e) => !e.is_appointment).length

  // Hora RESERVADA de cada turno del día, indexada por id de turno.
  //
  // `priority_order` NO sirve para saber si a un turno "ya le llegó la hora":
  // cuando la entrada fue ADOPTADA de un walk-in que ya estaba anotado,
  // `check_in_appointment` guarda `LEAST(hora de llegada, hora del turno)`, así
  // que puede ser mucho más temprana que la reservada. Por eso la mig 170
  // reescribió los caminos [A]/[B] de `claim_next_for_barber` para que lean
  // `lower(appointments.time_range)`; el panel tiene que mirar exactamente lo
  // mismo o promete un botón que el motor no respalda.
  const appointmentStartMsById = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of todayAppointments) {
      map.set(a.id, appointmentInstantMs(a.appointment_date, a.start_time, timezone))
    }
    return map
  }, [todayAppointments, timezone])

  /** Hora reservada (ms) de una entrada de fila que entró por un turno. */
  function appointmentStartMsOf(entry: QueueEntry): number {
    const fromAgenda = entry.appointment_id ? appointmentStartMsById.get(entry.appointment_id) : undefined
    // Fallback: si el turno todavía no está en la agenda cargada (lo registró
    // el mostrador hace segundos), `priority_order` es la mejor aproximación.
    return fromAgenda ?? new Date(entry.priority_order).getTime()
  }

  // ── Auto-start de ghost de descanso "listo" (rescate de limbos) ──
  // Si el barbero tiene un ghost waiting y no hay nada que lo tape (ni corte
  // activo, ni clientes asignados con priority menor), arrancarlo automátic.
  // Cubre el caso "supervisor aprobó descanso DESPUÉS de que el barbero
  // terminara su último corte": antes el ghost quedaba waiting forever porque
  // completeService paso 6 ya había pasado. La server action es idempotente y
  // segura ante races (partial UNIQUE de mig 127 garantiza un solo ganador).
  const myPendingGhost = useMemo(
    () => entries.find(
      (e) => e.barber_id === session.staff_id && e.status === 'waiting' && e.is_break
    ),
    [entries, session.staff_id]
  )
  const ghostBlockedByAssigned = useMemo(() => {
    if (!myPendingGhost) return false
    const ghostTs = new Date(myPendingGhost.priority_order).getTime()
    return entries.some(
      (e) =>
        e.barber_id === session.staff_id &&
        e.status === 'waiting' &&
        !e.is_break &&
        new Date(e.priority_order).getTime() < ghostTs
    )
  }, [entries, myPendingGhost, session.staff_id])
  // Descanso "listo": con esto `claim_next_for_barber` arranca el DESCANSO
  // aunque se toque "Atender" sobre un cliente (guard 0b del RPC). Sólo lo tapan
  // los clientes propios (barber_id = yo) que llegaron antes; los del pool no.
  // Hasta la mig 218 eso no se veía, porque con el descanso listo lo primero de
  // "Mi fila" era siempre el descanso; ahora un cliente que me esperaba y aceptó
  // Menor espera puede ir antes, y su "Atender" mandaría al barbero a descansar.
  const descansoListo = !!myPendingGhost && !ghostBlockedByAssigned
  const autoStartingGhostRef = useRef<string | null>(null)
  useEffect(() => {
    if (!myPendingGhost) return
    if (myActiveBreak) return
    if (myActiveEntry) return
    if (ghostBlockedByAssigned) return
    if (autoStartingGhostRef.current === myPendingGhost.id) return
    autoStartingGhostRef.current = myPendingGhost.id
    startPendingBreakIfReady(session.staff_id, session.branch_id)
      .then((res) => {
        if ('error' in res && res.error) {
          console.error('[auto-start break]', res.error)
        }
        // Liberar el ref independientemente del resultado para permitir
        // reintentos en próximos ciclos si algo salió mal.
        autoStartingGhostRef.current = null
        fetchQueue()
      })
      .catch((err) => {
        console.error('[auto-start break] excepción', err)
        autoStartingGhostRef.current = null
      })
  }, [myPendingGhost, myActiveBreak, myActiveEntry, ghostBlockedByAssigned, session.staff_id, session.branch_id, fetchQueue])

  // ── Aviso: un cliente que me esperaba aceptó Menor espera por WhatsApp ──
  // Se DERIVA comparando la fila nueva con la que este panel ya había visto
  // (`aceptacionesWhatsAppNuevas`): ni escrituras ni consultas nuevas, porque el
  // panel ya re-lee la fila en cada evento de Realtime (Known Risks #9/#10). La
  // primera lectura sólo siembra: lo que ya había pasado antes de abrir el panel
  // no se anuncia.
  const marcasVistasRef = useRef<Map<string, string | null> | null>(null)
  useEffect(() => {
    const previas = marcasVistasRef.current
    marcasVistasRef.current = marcasDeAceptacionWhatsApp(entries)
    if (!previas) return
    const nuevas = aceptacionesWhatsAppNuevas(previas, entries, session.staff_id)
    if (nuevas.length === 0) return

    // Regla de active-client-card: durante un corte nada de sonido, para no
    // interrumpir al cliente que está en la silla (un descanso tampoco suena).
    const ocupado = entries.some(
      (e) => e.barber_id === session.staff_id && e.status === 'in_progress'
    )
    for (const e of nuevas) {
      const nombre = e.client?.name?.trim() || 'Tu cliente'
      toast(`${nombre} aceptó Menor espera por WhatsApp`, {
        id: `menor-espera-${e.id}`,
        description: 'Sigue en tu fila; si otro barbero se libera antes, lo atiende él.',
        icon: <MessageCircle className="size-4 text-blue-500" aria-hidden />,
        duration: 12_000,
      })
      vibrate([15, 60, 15])
      if (!ocupado) playBeep({ frequency: 660, duration: 0.18, volume: 0.08 })
    }
  }, [entries, session.staff_id])

  // ── Aviso: un cliente pidió asesoría (mig 217) ──
  // Derivado igual que el de arriba, sin escrituras ni consultas nuevas (Known
  // Risk #10): `asesoriasNuevas` compara esta lectura de la fila con la
  // anterior. Diferencias con el de WhatsApp, a propósito:
  //  · siembra con la primera lectura EXITOSA (`filaLeida`), no con el [] del
  //    arranque, y lo nuevo se decide con `checked_in_at` (reloj del SERVIDOR):
  //    recargar el panel no repite avisos de quien ya estaba esperando;
  //  · lo visto se guarda en sessionStorage (por sucursal y barbero): volver de
  //    Caja, Historial o Metas anuncia lo que llegó o se sumó en el medio
  //    (hallazgo asesoria-03). Antes cada montaje volvía a sembrar y eso no se
  //    anunciaba nunca;
  //  · avisa también al que no lo tiene en su fila, si es de Menor espera y
  //    este barbero está fichado, libre o cortando (aviso liviano, cortando sin
  //    sonido: lo toma el primero). No depende del hint de cada tablet, que con
  //    relojes distintos podía no ponerlo en la «Mi fila» de nadie.
  const asesoriaVistaRef = useRef<VistaAsesoria | null>(null)
  const claveVista = claveVistaAsesoria(session.branch_id, session.staff_id)
  // Tarjetas con el anillo de "recién llegada" (12 s, ver ANILLO_ASESORIA_MS).
  const [asesoriasRecientes, setAsesoriasRecientes] = useState<ReadonlySet<string>>(() => new Set())
  const anillosRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const marcarAsesoriasRecientes = useCallback((ids: string[]) => {
    setAsesoriasRecientes((prev) => {
      const next = new Set(prev)
      for (const id of ids) next.add(id)
      return next
    })
    for (const id of ids) {
      const anterior = anillosRef.current.get(id)
      if (anterior) clearTimeout(anterior)
      anillosRef.current.set(
        id,
        setTimeout(() => {
          anillosRef.current.delete(id)
          setAsesoriasRecientes((prev) => {
            if (!prev.has(id)) return prev
            const next = new Set(prev)
            next.delete(id)
            return next
          })
        }, ANILLO_ASESORIA_MS),
      )
    }
  }, [])
  useEffect(() => {
    const anillos = anillosRef.current
    return () => {
      for (const t of anillos.values()) clearTimeout(t)
      anillos.clear()
    }
  }, [])

  useEffect(() => {
    // Espera la fila Y los barberos: sin ellos no se sabe si este barbero fichó
    // ni quién tiene a quién en su «Mi fila», y comparar antes dejaría lo que
    // llegó en ausencia marcado como visto sin haberlo anunciado.
    if (!filaLeida || !barberosLeidos) return
    // Lo visto: el de este montaje o, recién montado, el que dejó guardado el
    // anterior. Sin ninguno (primera vez, vista vieja o sin sessionStorage) se
    // siembra: lo que ya estaba al abrir el panel no se anuncia.
    const previa = asesoriaVistaRef.current ?? leerVistaGuardada(claveVista)
    const vista: VistaAsesoria = {
      marcas: marcasDeAsesoria(entries),
      ultimaLlegada: previa ? previa.ultimaLlegada : ultimaLlegadaVista(entries),
    }
    asesoriaVistaRef.current = vista
    guardarVista(claveVista, vista)
    if (!previa) return

    const yo = session.staff_id
    // Cortando o en descanso: sin sonido (regla de active-client-card: no se
    // interrumpe al cliente que está en la silla).
    const ocupado = entries.some((e) => e.barber_id === yo && e.status === 'in_progress')
    const fichado = allBarbers.some((b) => b.id === yo) && !notClockedInBarbers.has(yo)
    const avisos = asesoriasNuevas(previa.marcas, entries, {
      staffId: yo,
      miFila: armarMiFila(dynamicEntries, yo),
      recibeMenorEspera: fichado && !hiddenFromCheckin,
      ultimaLlegadaInicial: previa.ultimaLlegada,
    })
    if (avisos.length === 0) return

    mostrarAvisosAsesoria(avisos, ocupado)
    // Una sola campanita aunque lleguen dos a la vez.
    if (ocupado) {
      vibrate(15)
    } else {
      playAsesoriaChime()
      vibrate([20, 60, 20])
    }
    const ids = avisos.map((a) => a.entrada.id)
    // Diferido: el estado del anillo no se toca en el cuerpo del efecto.
    queueMicrotask(() => marcarAsesoriasRecientes(ids))
  }, [
    filaLeida,
    barberosLeidos,
    claveVista,
    entries,
    dynamicEntries,
    allBarbers,
    notClockedInBarbers,
    hiddenFromCheckin,
    session.staff_id,
    marcarAsesoriasRecientes,
  ])

  // ── Pop-up de asesoría al atender ──
  // `inicio` sale del ESTADO de la entrada en curso (pidió asesoría y nadie la
  // confirmó), no del botón que la arrancó: cubre Atender, Reclamar, la alerta
  // de inactividad y el inicio desde el dashboard. Cualquier cierre la confirma
  // (`marcarAsesoriaVista`, optimista) y el id queda acá para no reabrirla.
  // `consulta` la reabre el sello de la tarjeta del cliente actual.
  const [asesoriasConfirmadas, setAsesoriasConfirmadas] = useState<ReadonlySet<string>>(() => new Set())
  const [consultaAsesoriaDe, setConsultaAsesoriaDe] = useState<string | null>(null)
  // No se abre encima de otro modal del panel: con dos diálogos hermanos
  // apilados, al cerrar el de arriba Radix devuelve el foco a SU disparador, y
  // este pop-up no tiene (lo abre el estado): el foco cae al <body> mientras el
  // de abajo sigue atrapándolo. Espera a que el otro se cierre y aparece
  // enseguida. El cobro sobre todo: si ya están cobrando, el pop-up llega tarde.
  const hayOtroModalAbierto =
    !!completingEntry ||
    breakDialogOpen ||
    breakRequestsDialogOpen ||
    deactivateDialogOpen ||
    directSaleOpen ||
    deliverRewardOpen ||
    !!stripAppointment ||
    agendaSheetOpen ||
    !!profileClient
  const asesoriaSinConfirmar =
    !!myActiveEntry &&
    myActiveEntry.pidio_asesoria === true &&
    !myActiveEntry.asesoria_vista_at &&
    !asesoriasConfirmadas.has(myActiveEntry.id)
  const modoAsesoria: ModoAsesoriaDialog | null =
    asesoriaSinConfirmar && !hayOtroModalAbierto
      ? 'inicio'
      : myActiveEntry?.pidio_asesoria === true && consultaAsesoriaDe === myActiveEntry.id
        ? 'consulta'
        : null

  function avisarAsesoriaSinRegistrar(detalle: string | null) {
    toast.error('No pudimos registrar la asesoría. Si recargás, te la vuelve a mostrar.', {
      id: 'asesoria-sin-registrar',
      // El motivo sólo si dice algo más (p. ej. que venció la sesión del PIN).
      description: detalle && detalle !== 'No pudimos registrar la asesoría.' ? detalle : undefined,
      duration: 10_000,
    })
  }

  function confirmarAsesoria(entryId: string) {
    setAsesoriasConfirmadas((prev) => (prev.has(entryId) ? prev : new Set(prev).add(entryId)))
    marcarAsesoriaVista(entryId)
      .then((r) => {
        if (!r.ok) avisarAsesoriaSinRegistrar(r.error)
      })
      .catch((e: unknown) => {
        console.error('[queue-panel] marcarAsesoriaVista:', e)
        // Con el bundle de un deploy anterior: se recarga y, como no quedó
        // registrada, el pop-up vuelve a salir para confirmarla.
        if (esErrorDeVersion(e)) {
          if (!avisarYRecargarPorVersion()) toast.error(TEXTO_RECARGA_MANUAL, { id: 'recarga-manual' })
          return
        }
        avisarAsesoriaSinRegistrar(null)
      })
  }

  function cerrarAsesoria() {
    if (modoAsesoria === 'inicio' && myActiveEntry) confirmarAsesoria(myActiveEntry.id)
    setConsultaAsesoriaDe(null)
  }

  // ── Next client alert logic ──
  // Track when barber becomes idle with clients waiting
  useEffect(() => {
    const isIdle = !myActiveEntry && !myActiveBreak
    const hasWaiting = myRealWaitingEntries.length > 0

    if (isIdle && hasWaiting) {
      // Start tracking idle time if not already
      setIdleSince(prev => prev ?? Date.now())
    } else {
      // Reset when barber is busy, on break, or no clients waiting
      setIdleSince(null)
      setShowWaitWarning(false)
    }
  }, [myActiveEntry, myActiveBreak, myRealWaitingEntries.length])

  // Check if countdown has expired
  useEffect(() => {
    if (!idleSince || showWaitWarning) return

    const thresholdMs = nextClientAlertMinutes * 60_000
    const elapsed = now - idleSince

    if (elapsed >= thresholdMs) {
      setShowWaitWarning(true)
      // Vibrate if supported
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([200, 100, 200, 100, 200])
      }
    }
  }, [now, idleSince, nextClientAlertMinutes, showWaitWarning])

  // Play beep sound when warning is active
  useEffect(() => {
    if (!showWaitWarning) {
      // Stop beep
      if (beepIntervalRef.current) {
        clearInterval(beepIntervalRef.current)
        beepIntervalRef.current = null
      }
      return
    }

    const playBeep = () => {
      try {
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
        }
        const ctx = audioContextRef.current
        if (ctx.state === 'suspended') ctx.resume()

        const oscillator = ctx.createOscillator()
        const gainNode = ctx.createGain()
        oscillator.connect(gainNode)
        gainNode.connect(ctx.destination)

        oscillator.frequency.value = 880
        oscillator.type = 'sine'
        gainNode.gain.setValueAtTime(0.15, ctx.currentTime)
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4)

        oscillator.start(ctx.currentTime)
        oscillator.stop(ctx.currentTime + 0.4)
      } catch {
        // Audio not available
      }
    }

    // Play immediately + every 3 seconds
    playBeep()
    beepIntervalRef.current = setInterval(playBeep, 3000)

    return () => {
      if (beepIntervalRef.current) {
        clearInterval(beepIntervalRef.current)
        beepIntervalRef.current = null
      }
    }
  }, [showWaitWarning])

  // Cleanup audio context on unmount
  useEffect(() => {
    return () => {
      if (beepIntervalRef.current) clearInterval(beepIntervalRef.current)
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {})
      }
    }
  }, [])

  // Bell sound when a new break request arrives (for managers)
  useEffect(() => {
    const currentCount = pendingBreakRequests.length
    if (canManageBreaks && currentCount > prevBreakRequestCountRef.current && prevBreakRequestCountRef.current >= 0) {
      // Only play if we had a previous count (not initial load when ref is 0 and count > 0 on first real change)
      if (prevBreakRequestCountRef.current > 0 || currentCount > 0) {
        try {
          if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
          }
          const ctx = audioContextRef.current
          if (ctx.state === 'suspended') ctx.resume()

          // Bell-like tone: two harmonics for a richer "ding"
          const playTone = (freq: number, delay: number) => {
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.connect(gain)
            gain.connect(ctx.destination)
            osc.frequency.value = freq
            osc.type = 'sine'
            gain.gain.setValueAtTime(0.2, ctx.currentTime + delay)
            gain.gain.exponentialRampToValueAtTime(0.005, ctx.currentTime + delay + 0.6)
            osc.start(ctx.currentTime + delay)
            osc.stop(ctx.currentTime + delay + 0.6)
          }
          playTone(523, 0)     // C5
          playTone(659, 0)     // E5 - harmony
          playTone(784, 0.15)  // G5 - second ding
        } catch {
          // Audio not available
        }
      }
    }
    prevBreakRequestCountRef.current = currentCount
  }, [pendingBreakRequests.length, canManageBreaks])

  async function handleWarningStartService() {
    const firstEntry = myRealWaitingEntries[0]
    if (!firstEntry || warningStarting) return
    setWarningStarting(true)
    try {
      // El primero de la fila puede ser un TURNO, y los turnos no se reclaman por
      // el camino del preferido (ver handleStartAppointment).
      if (firstEntry.is_appointment) {
        await handleStartAppointment(firstEntry)
      } else {
        await handleStartService(firstEntry.id)
      }
    } finally {
      setShowWaitWarning(false)
      setIdleSince(null)
      setWarningStarting(false)
    }
  }

  const otherInProgress = dynamicEntries.filter(
    (e) => e.status === 'in_progress' && e.barber_id !== session.staff_id && !e.is_break
  )

  // Turno próximo para el banner de alerta (modo hybrid): dentro de los próximos
  // 15 min y sin registrar la llegada todavía.
  //
  // Va por `findNextAppointment` y no por `getHours()` del dispositivo: la hora
  // del turno es hora de PARED de la sucursal. Y depende de `now` (el reloj de
  // 5s del panel) porque antes sólo se recalculaba cuando cambiaba la lista de
  // turnos — o sea cada 60s: el banner llegaba tarde a su propia alerta.
  const upcomingAppointmentForBanner = useMemo(() => {
    if (operationMode !== 'hybrid') return null
    const next = findNextAppointment(todayAppointments, now, timezone)
    if (!next || next.appointment.status !== 'confirmed') return null
    return next.minutesUntil <= 15 ? next.appointment : null
  }, [todayAppointments, operationMode, now, timezone])

  // La tira de turnos reemplaza al timeline dentro del panel en modo hybrid.
  // Sin turnos hoy no ocupa un solo píxel: la cola walk-in es la pantalla.
  const showAppointmentStrip = operationMode === 'hybrid' && todayAppointments.length > 0

  /**
   * Arranca un TURNO. NO pasa por `attendNextClient`.
   *
   * El camino `p_preferred_entry_id` de `claim_next_for_barber` filtra
   * `is_appointment = false` (igual que el FIFO walk-in): pedirle un turno "como
   * preferido" devolvía vacío SIEMPRE y la tarjeta contestaba "El cliente ya no
   * está disponible" con la persona sentada enfrente. Los turnos tienen sus
   * caminos propios [A]/[B] en el RPC, que deciden por la hora real y no aceptan
   * un preferido.
   *
   * `markAppointmentInProgress` es el camino explícito del barbero: arranca
   * EXACTAMENTE este turno (sin ruleta de "a quién me toca"), chequea que no
   * tenga otro corte/descanso en curso y sincroniza `appointments`.
   */
  async function handleStartAppointment(entry: QueueEntry) {
    if (!entry.appointment_id) {
      toast.error('Este turno no está vinculado a la agenda. Avisá al mostrador.')
      return
    }
    const appointmentId = entry.appointment_id
    setActionLoading(entry.id)
    try {
      const result = await correrAccion(
        () => markAppointmentInProgress(appointmentId, session.staff_id, session.branch_id),
        'No pudimos iniciar el turno. Revisá la conexión y probá de nuevo.',
      )
      if (result !== SIN_RESPUESTA && 'error' in result) toast.error(result.error)
      await fetchQueue()
      // La agenda también cambia (el turno pasa a "en curso"): sin esto el
      // timeline de los modos appointments/hybrid quedaba hasta 60s atrasado.
      refreshAppointments()
    } finally {
      setActionLoading(null)
    }
  }

  /**
   * Cobrar un turno desde la hoja de detalle: el cobro es el MISMO flujo que el
   * walk-in (`CompleteServiceDialog`), así que sólo hay que resolver la entrada
   * de fila que `check_in_appointment` creó para ese turno.
   */
  async function handleCompleteAppointment(appointment: Appointment) {
    if (!appointment.queue_entry_id) {
      toast.error('Este turno todavía no entró a la fila. Registrá la llegada primero.')
      return
    }
    setLoadingApptEntryId(appointment.id)
    // Con un error que no se atrapaba, el «Cargando…» a pantalla completa
    // quedaba para siempre y tapaba el panel entero.
    let entry: Awaited<ReturnType<typeof getAppointmentQueueEntry>> | typeof SIN_RESPUESTA = SIN_RESPUESTA
    try {
      entry = await correrAccion(
        () => getAppointmentQueueEntry(appointment.id),
        'No se pudo cargar la entrada de fila de este turno. Probá de nuevo.',
      )
    } finally {
      setLoadingApptEntryId(null)
    }
    if (entry === SIN_RESPUESTA) return
    if (!entry) {
      toast.error('No se pudo cargar la entrada de fila de este turno')
      return
    }
    setCompletingEntry(entry as QueueEntry)
  }

  async function handleStartService(entryId: string) {
    setActionLoading(entryId)
    try {
      await atenderCliente(entryId)
    } finally {
      // Pase lo que pase, «Atender» no queda girando (antes, un error de red o
      // de un deploy nuevo lo dejaba así hasta recargar).
      setActionLoading(null)
    }
  }

  async function atenderCliente(entryId: string) {
    const result = await correrAccion(
      () => attendNextClient(session.staff_id, session.branch_id, entryId),
      'No pudimos tomar al cliente. Revisá la conexión y probá de nuevo.',
    )
    if (result === SIN_RESPUESTA) {
      // No se sabe si llegó al servidor: la fila dice qué pasó.
      await fetchQueue()
      return
    }
    if ('error' in result) {
      toast.error(result.error)
    } else if (!result.entryId) {
      // El claim devuelve NULL por varias causas (cliente ya tomado por otra
      // tablet, turno inminente, pool vacío, o —desde mig 139— el barbero ya
      // tiene un corte/descanso in_progress). Diferenciamos con el estado local
      // para no mentir: si ya estás ocupado, el motivo es ese (guard #13), no
      // "el cliente". Evita el toast técnico 23505 que aparecía antes.
      if (myActiveEntry || myActiveBreak) {
        toast.info('Terminá tu corte actual antes de tomar otro')
      } else {
        // La otra causa habitual del vacío es la ventana de protección: cuando
        // falta menos que `45 + buffer` para un turno, el motor deja de entregar
        // walk-ins. Decirlo con nombre y hora evita el "está colgado" — es el
        // mismo motivo que explica el cartel de NextAppointmentNotice.
        const next = findNextAppointment(todayAppointments, Date.now(), timezone)
        if (next && next.minutesUntil <= protectionWindowMinutes(bufferMinutes)) {
          toast.info(`No entra otro corte antes de tu turno de las ${next.timeLabel}`)
        } else {
          toast.info('El cliente ya no está disponible')
        }
      }
    } else if (result.entryId !== entryId) {
      const claimed = entries.find((e) => e.id === result.entryId)
      if (claimed?.is_appointment) {
        // El motor entrega el TURNO en cuanto su hora llegó, aunque el barbero
        // haya tocado Atender sobre un walk-in que lo precede en la lista. El
        // mensaje viejo ("lo tomó otro barbero") era falso justo en ese caso.
        toast.info(
          `Arrancó el turno de las ${formatHourMinute(appointmentStartMsOf(claimed), timezone)} · ${claimed.client?.name ?? 'Cliente'}`
        )
      } else {
        toast.info('El cliente fue tomado por otro barbero. Se asignó el siguiente.')
      }
    }
    await fetchQueue()
    if (!('error' in result) && !result.entryId) {
      fetchAssignmentData()
    }
  }

  async function handleCancel(entryId: string) {
    setActionLoading(entryId)
    try {
      const result = await correrAccion(
        () => cancelQueueEntry(entryId),
        'No pudimos sacarlo de la fila. Revisá la conexión y probá de nuevo.',
      )
      if (result !== SIN_RESPUESTA && 'error' in result) toast.error(result.error)
      await fetchQueue()
    } finally {
      setActionLoading(null)
    }
  }

  async function handleCancelBreakRequest() {
    const requestId = breakRequestId
    if (!requestId) return
    setBreakRequestLoading(true)
    try {
      const result = await correrAccion(
        () => cancelBreakRequest(requestId),
        'No pudimos cancelar la solicitud de descanso. Probá de nuevo.',
      )
      if (result === SIN_RESPUESTA) return
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Solicitud de descanso cancelada')
        setBreakRequestStatus(null)
        setBreakRequestId(null)
      }
    } finally {
      setBreakRequestLoading(false)
      fetchQueue()
    }
  }

  async function handleCompleteBreak() {
    if (!myActiveBreak) return
    const breakId = myActiveBreak.id
    setActionLoading(breakId)
    try {
      const result = await correrAccion(
        () => completeBreakRequest(breakId),
        'No pudimos terminar el descanso. Probá de nuevo.',
      )
      if (result !== SIN_RESPUESTA) {
        if (result.error) {
          toast.error(result.error)
        } else {
          toast.success('Descanso finalizado')
          setBreakRequestStatus(null)
          setBreakRequestId(null)
        }
      }
      await fetchQueue()
    } finally {
      setActionLoading(null)
    }
  }

  async function handleApproveOtherBreak(requestId: string) {
    const cuts = parseInt(approveCutsInputs[requestId] || '0', 10)
    if (isNaN(cuts) || cuts < 0) { toast.error('Número de cortes inválido'); return }
    setApproveLoading(requestId)
    try {
      const result = await correrAccion(
        () => approveBreakAction(requestId, cuts),
        'No pudimos aprobar el descanso. Probá de nuevo.',
      )
      if (result === SIN_RESPUESTA) return
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Descanso aprobado')
        fetchPendingBreakRequests()
        fetchQueue()
      }
    } finally {
      setApproveLoading(null)
    }
  }

  async function handleRejectOtherBreak(requestId: string) {
    setApproveLoading(requestId)
    try {
      const result = await correrAccion(
        () => rejectBreakAction(requestId),
        'No pudimos rechazar la solicitud. Probá de nuevo.',
      )
      if (result === SIN_RESPUESTA) return
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Solicitud rechazada')
        fetchPendingBreakRequests()
      }
    } finally {
      setApproveLoading(null)
    }
  }

  async function handleDeactivateBarber(barberId: string) {
    setDeactivateLoading(barberId)
    try {
      const result = await correrAccion(async () => {
        const { deactivateBarber } = await import('@/lib/actions/barber')
        return deactivateBarber(barberId)
      }, 'No pudimos desactivar al barbero. Probá de nuevo.')
      if (result === SIN_RESPUESTA) return
      if (result.error) {
        toast.error(result.error)
      } else {
        const msg = result.reassignedCount && result.reassignedCount > 0
          ? `Barbero desactivado. ${result.reassignedCount} cliente(s) reasignados.`
          : 'Barbero desactivado'
        toast.success(msg)
        fetchBarbersAndSchedules()
        fetchQueue()
      }
    } finally {
      setDeactivateLoading(null)
    }
  }

  async function handleToggleVisibility() {
    setHiddenLoading(true)
    try {
      const result = await correrAccion(async () => {
        const { toggleBarberVisibility } = await import('@/lib/actions/barber')
        return toggleBarberVisibility(session.staff_id)
      }, 'No pudimos cambiar tu visibilidad en el check-in. Probá de nuevo.')
      if (result === SIN_RESPUESTA) return
      if (result.error) {
        toast.error(result.error)
      } else {
        setHiddenFromCheckin(result.hidden ?? false)
        toast.success(result.hidden ? 'Te ocultaste del check-in' : 'Volviste a ser visible en el check-in')
      }
    } finally {
      setHiddenLoading(false)
    }
  }

  /**
   * «Tomar descanso» (con breaks.grant: se pide y se aprueba solo) o «Solicitar
   * descanso». El diálogo se cierra igual si algo falla, como siempre; el error
   * se dice y nada queda girando.
   */
  async function handleRequestBreak() {
    if (!selectedBreakConfig) return
    const configId = selectedBreakConfig
    setBreakRequestLoading(true)
    try {
      if (canManageBreaks) {
        const cuts = parseInt(selfApproveCuts, 10) || 0
        // Request + auto-approve
        const reqResult = await correrAccion(
          () => requestBreak(session.staff_id, session.branch_id, configId),
          'No pudimos pedir el descanso. Probá de nuevo.',
        )
        if (reqResult === SIN_RESPUESTA) return
        if (reqResult.error) {
          toast.error(reqResult.error)
          return
        }
        // Get the request ID and approve it
        const activa = await correrAccion(
          () => getBarberActiveBreakRequest(session.staff_id),
          'No pudimos confirmar el descanso. Mirá su estado arriba y probá de nuevo.',
        )
        if (activa === SIN_RESPUESTA || !activa.data) return
        const req = activa.data
        const approveResult = await correrAccion(
          () => approveBreakAction(req.id, cuts),
          'No pudimos aprobar el descanso. Probá de nuevo.',
        )
        if (approveResult === SIN_RESPUESTA) return
        if (approveResult.error) {
          toast.error(approveResult.error)
        } else {
          toast.success(cuts === 0 ? 'Descanso iniciado' : `Descanso programado en ${cuts} corte${cuts > 1 ? 's' : ''}`)
          setBreakRequestStatus('approved')
          setBreakRequestId(req.id)
          fetchQueue()
        }
      } else {
        const result = await correrAccion(
          () => requestBreak(session.staff_id, session.branch_id, configId),
          'No pudimos enviar la solicitud de descanso. Probá de nuevo.',
        )
        if (result === SIN_RESPUESTA) return
        if (result.error) {
          toast.error(result.error)
        } else {
          toast.success('Solicitud de descanso enviada')
          setBreakRequestStatus('pending')
          fetchBreakRequestStatus()
        }
      }
    } finally {
      setBreakDialogOpen(false)
      setSelectedBreakConfig('')
      setSelfApproveCuts('0')
      setBreakRequestLoading(false)
    }
  }

  function formatElapsed(timestamp: string) {
    const elapsed = now - new Date(timestamp).getTime()
    if (isNaN(elapsed) || elapsed < 0) return '0m 0s'
    const totalSeconds = Math.floor(elapsed / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    if (hours > 0) return `${hours}h ${minutes}m`
    return `${minutes}m ${seconds}s`
  }

  function renderGhostBreakEntry(entry: QueueEntry) {
    // Count real waiting clients ahead of this ghost for this barber.
    // Usamos `priority_order` (FIFO real del backend), no `position` (UI-mutable
    // por drag&drop) — sino el contador queda desincronizado tras un reorder.
    const ghostPriorityTs = new Date(entry.priority_order).getTime()
    const myRealWaiting = entries.filter(
      e => e.status === 'waiting' && !e.is_break && e.barber_id === session.staff_id
        && new Date(e.priority_order).getTime() < ghostPriorityTs,
    ).length

    return (
      <Card key={entry.id} className="gap-0 py-0 border-amber-500/30 bg-amber-500/5">
        <CardContent className="flex items-center gap-4 p-5 md:p-6">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600">
            <Coffee className="size-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold text-amber-600">Tu descanso</p>
            <p className="text-sm text-muted-foreground">
              {myRealWaiting === 0
                ? 'Siguiente en atenderse'
                : `En ${myRealWaiting} corte${myRealWaiting > 1 ? 's' : ''}`}
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  function renderQueueEntry(entry: QueueEntry, isGeneralQueue: boolean = false) {
    // Render ghost break entries differently
    if (entry.is_break) {
      if (entry.barber_id === session.staff_id) {
        return renderGhostBreakEntry(entry)
      }
      return null // Don't show other barbers' ghost breaks
    }

    // (isMyEntry / isReassigning eliminados — no se usan en el render actual)

    // `client_loyalty_state` llega como OBJETO (relación 1:1): leído con `[0]`
    // daba siempre undefined, "Primer Corte" salía para todos y la categoría
    // nunca. Ver `leerLoyaltyEmbed`.
    const loyalty = leerLoyaltyEmbed(entry.client?.loyalty)
    // Mig 218: aceptó Menor espera por WhatsApp y sigue esperando en el pool.
    // Si me esperaba a MÍ, está acá aunque el hint lo haya sugerido a otro
    // (`armarMiFila`): sigue siendo mi cliente y lo atiende el primero que llegue.
    const viaWhatsApp = esMovidaPorWhatsApp(entry)
    const meEsperabaAMi = esMovidaPorWhatsAppDe(entry, session.staff_id)
    const barberoQueEsperaba =
      viaWhatsApp && !meEsperabaAMi && entry.menor_espera_barbero_original_id
        ? (allBarbers.find((b) => b.id === entry.menor_espera_barbero_original_id)?.full_name ?? null)
        : null
    // Mig 217: no sabe qué hacerse y pidió que lo asesoren (fucsia en todo el panel).
    const pidioAsesoria = entry.pidio_asesoria === true
    const nombre = entry.client?.name ?? 'Cliente'
    const cliente = entry.client

    return (
      <div key={entry.id} className="space-y-2">
        <Card
          className={cn(
            'gap-0 py-0',
            pidioAsesoria && 'relative overflow-hidden',
            asesoriasRecientes.has(entry.id) && 'asesoria-recien',
          )}
        >
          {pidioAsesoria && (
            <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-fuchsia-500" />
          )}
          <CardContent className="flex items-center gap-2.5 sm:gap-4 p-3 sm:p-5 md:p-6">
            <div className="flex size-10 sm:size-14 shrink-0 items-center justify-center rounded-lg sm:rounded-xl bg-secondary text-sm sm:text-xl font-bold">
              #{entry.position}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                {/* El nombre abre la ficha (observaciones, Instagram y cortes con
                    fotos, por server action: la fila no trae esas columnas).
                    El área táctil crece hacia arriba y abajo con un
                    pseudo-elemento, lejos de Atender y de la X. */}
                {cliente ? (
                  <button
                    type="button"
                    onClick={() => setProfileClient(cliente)}
                    aria-label={`Ver la ficha de ${nombre}`}
                    className="group/nombre relative -mx-1 flex min-w-0 max-w-full touch-manipulation items-center gap-0.5 rounded-md px-1 text-left outline-none before:absolute before:inset-x-0 before:-inset-y-2.5 before:content-[''] focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <span className="truncate text-base font-semibold decoration-foreground/30 underline-offset-4 group-hover/nombre:underline sm:text-lg">
                      {nombre}
                    </span>
                    <ChevronRight
                      className="size-4 shrink-0 text-muted-foreground/70 motion-safe:transition-transform group-hover/nombre:translate-x-0.5"
                      aria-hidden
                    />
                  </button>
                ) : (
                  <p className="truncate text-base sm:text-lg font-semibold">{nombre}</p>
                )}
                {/* Categoría del programa de fidelización (colores del dueño). Sin
                    categoría (programa apagado / cliente no enrolado) no hay chip. */}
                {(() => {
                  const tier = findLoyaltyTier(loyaltyTiers, loyalty?.tier_code)
                  return tier ? <LoyaltyTierChip tier={tier} /> : null
                })()}
                {/* Hora RESERVADA, tomada de la agenda. No se lee de
                    `priority_order`: en una entrada adoptada de un walk-in ése
                    es `LEAST(llegada, hora del turno)` y el badge mostraba la
                    hora en que el cliente entró al local, no la que reservó. */}
                {entry.is_appointment && (
                  <TurnoBadge
                    time={formatHourMinute(appointmentStartMsOf(entry), timezone)}
                    className="h-5"
                  />
                )}
                {(() => {
                  const phone = entry.client?.phone ?? ''
                  const isKid = phone.startsWith('00') && phone.length === 10
                  if (isKid) {
                    return (
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px] uppercase tracking-wider bg-amber-500/15 text-amber-500 border-amber-500/30">
                        Especial
                      </Badge>
                    )
                  }
                  // total_visits viene de la tabla client_loyalty_state (mantenida por
                  // trigger). Reemplaza a visits(count) que era un correlated subquery
                  // por cliente y representaba ~33% del tiempo de DB (mig 124).
                  // Sin fila de estado = nunca tuvo una visita (verificado en prod:
                  // los 372 clientes de Monaco sin fila tienen 0 visitas).
                  const totalVisits = loyalty?.total_visits ?? 0
                  if (totalVisits === 0) {
                    return (
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px] uppercase tracking-wider bg-emerald-500/15 text-emerald-500 border-emerald-500/30">
                        Primer Corte
                      </Badge>
                    )
                  }
                  return null
                })()}
                {entry.is_dynamic && (
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px] uppercase tracking-wider bg-blue-500/15 text-blue-500 border-blue-500/30">
                    <Zap className="fill-current" aria-hidden />
                    Menor espera
                  </Badge>
                )}
                {/* Califica al de al lado: se pasó a Menor espera desde el aviso de
                    WhatsApp. Mismo azul y sin relleno, para leerse como "Menor
                    espera, por WhatsApp" y no como una tercera etiqueta. Entra con
                    una animación corta: es lo que cambió en la tarjeta. */}
                {viaWhatsApp && (
                  <Badge
                    variant="outline"
                    title="Aceptó pasarse a Menor espera desde el aviso de WhatsApp"
                    className="h-5 px-1.5 text-[10px] uppercase tracking-wider text-blue-500 border-blue-500/30 motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-300"
                  >
                    <MessageCircle aria-hidden />
                    Por WhatsApp
                  </Badge>
                )}
                {/* Entra con la misma animación corta: puede aparecer con la
                    tarjeta ya en pantalla (la pidió desde «Mi turno»). */}
                {pidioAsesoria && (
                  <AsesoriaBadge
                    tono="claro"
                    className="h-5 motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-300"
                  />
                )}
              </div>
              <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                <span className="shrink-0">{entry.client?.phone}</span>
                {(entry.service || pidioAsesoria) && (
                  <>
                    <span className="text-muted-foreground/40">·</span>
                    {entry.service ? (
                      <span className="truncate font-medium text-foreground/70">
                        {entry.service.name}
                        {pidioAsesoria && (
                          <span className="font-semibold text-fuchsia-700"> · pidió asesoría</span>
                        )}
                      </span>
                    ) : (
                      // Eligió la asesoría EN VEZ de un servicio: lo elige el barbero al cobrar.
                      <span className="truncate font-semibold text-fuchsia-700">Quiere asesoría</span>
                    )}
                  </>
                )}
              </div>
              {/* La espera deja de ser un dato gris cuando se vuelve un problema.
                  Medido sobre 90 días de producción: la mediana de espera real es de
                  5 a 12 min y el p90 no pasa de 51; los clientes que terminaron
                  anotados-y-nunca-atendidos habían estado esperando 1 a 4 HORAS
                  mientras la sucursal atendía a 9-12 personas que llegaron después.
                  O sea: la señal existía en la pantalla y no se veía. A los 40 min la
                  tarjeta se pone ámbar y a los 70 roja, para que "a éste lo estamos
                  dejando pasar" sea imposible de no ver de reojo. */}
              {(() => {
                const minutos = Math.floor((now - new Date(entry.checked_in_at).getTime()) / 60000)
                const nivel = minutos >= 70 ? 'critico' : minutos >= 40 ? 'demorado' : 'normal'
                return (
                  <div
                    className={`mt-1 flex items-center gap-1 text-xs ${
                      nivel === 'critico'
                        ? 'font-semibold text-destructive'
                        : nivel === 'demorado'
                          ? 'font-medium text-amber-500'
                          : 'text-muted-foreground'
                    }`}
                  >
                    <Clock className="size-3" />
                    <span>{formatElapsed(entry.checked_in_at)} esperando</span>
                    {nivel !== 'normal' && (
                      <span className="ml-0.5">
                        · {nivel === 'critico' ? 'lleva demasiado' : 'se está demorando'}
                      </span>
                    )}
                  </div>
                )
              })()}
              {/* Quien aceptó Menor espera por WhatsApp: al barbero que esperaba
                  se le explica por qué puede desaparecerle de la fila; a los demás,
                  a quién esperaba (si ese barbero se libera primero, lo atiende él). */}
              {(meEsperabaAMi || barberoQueEsperaba) && (
                <div className="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
                  <MessageCircle className="mt-0.5 size-3 shrink-0 text-blue-500" aria-hidden />
                  {meEsperabaAMi ? (
                    <span>Sigue en tu fila · si otro barbero se libera antes, lo atiende él</span>
                  ) : (
                    <span>
                      Esperaba a <span className="font-medium text-foreground/70">{barberoQueEsperaba}</span>
                    </span>
                  )}
                </div>
              )}
              {isGeneralQueue && entry.barber && (
                <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <User className="size-3" />
                  <span>Se atiende con <span className="font-medium text-foreground/70">{entry.barber.full_name}</span></span>
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              {(() => {
                if (myActiveEntry || myActiveBreak) return null
                const isMyMainTap = entry.id === myWaitingEntries[0]?.id

                // ── TURNOS ──
                // Un turno NO se toma con "Atender": ese botón llama al claim con
                // `preferredEntryId` y ese camino del RPC filtra `is_appointment =
                // false`, así que devolvía vacío siempre y la tarjeta quedaba
                // muerta ("El cliente ya no está disponible"). Va por su propio
                // botón, que arranca ESE turno y nada más.
                if (entry.is_appointment) {
                  if (entry.barber_id !== session.staff_id) return null
                  // Un descanso pendiente con prioridad anterior va primero:
                  // misma regla que el RPC (`q.priority_order <
                  // v_pending_break_priority` en los caminos [A]/[B]).
                  if (
                    myPendingGhost &&
                    new Date(myPendingGhost.priority_order).getTime() <=
                      new Date(entry.priority_order).getTime()
                  ) {
                    return null
                  }
                  const isDue = appointmentStartMsOf(entry) <= now
                  // También se muestra cuando el turno NO es la primera tarjeta
                  // pero su hora ya llegó: en ese momento el motor le da
                  // precedencia absoluta sobre los walk-ins, así que la acción
                  // tiene que estar sobre el turno y no sobre el walk-in que lo
                  // precede en la lista. Antes de su hora el botón queda
                  // secundario: adelantarlo es una decisión del barbero (el
                  // cliente está ahí), no lo que haría la fila sola.
                  if (!isMyMainTap && !isDue) return null
                  return (
                    <Button
                      size="sm"
                      variant={isDue ? 'default' : 'outline'}
                      className="h-10 px-3 sm:h-14 sm:px-6 text-sm sm:text-lg"
                      onClick={() => handleStartAppointment(entry)}
                      disabled={actionLoading === entry.id}
                      title={isDue ? undefined : 'Todavía no es la hora del turno'}
                    >
                      <CalendarClock className="size-4 sm:size-5 mr-1.5 sm:mr-2" />
                      <span>Iniciar turno</span>
                    </Button>
                  )
                }

                // Con el descanso listo, cualquier "Atender" arranca el descanso
                // (ver `descansoListo`): mejor no ofrecer un botón que hace otra
                // cosa. El auto-arranque de más arriba lo inicia solo.
                if (descansoListo) return null

                // Rescate de limbos del hint divergente (mig 134 + commit 1cb1a41):
                // en General, cualquier barbero libre puede reclamar un dinámico.
                // El claim server es pool no bloqueante (FOR UPDATE SKIP LOCKED),
                // así que el "rescate" es seguro a nivel datos. Sin esto, hints
                // contradictorios entre tablets dejaban al cliente fuera de
                // "Mi fila" de TODOS y nadie podía tocar Atender.
                const generalClaimAllowed =
                  isGeneralQueue && (entry.is_dynamic || !entry.barber_id)
                if (!isMyMainTap && !generalClaimAllowed) return null
                // Rescate visual: en General, si el hint apunta a OTRO barbero,
                // el botón pasa a secundario ("Reclamar") para evitar la duda
                // del 2026-05-26 (dos barberos libres + mismo cliente → ¿quién
                // lo toma?). El sugerido sigue viendo "Atender" primario en
                // Mi fila; el otro ve "Reclamar" outline en General. Si nadie
                // está sugerido (pool puro, barber_id NULL) el botón sigue
                // primario porque no hay a quien "robarle". Tampoco es "robar"
                // tomar al que aceptó Menor espera por WhatsApp si me esperaba
                // a mí: conservó su lugar en MI fila.
                const isRescueOfOtherHint =
                  isGeneralQueue &&
                  entry.barber_id != null &&
                  entry.barber_id !== session.staff_id &&
                  !meEsperabaAMi
                return (
                  <Button
                    size="sm"
                    variant={isRescueOfOtherHint ? 'outline' : 'default'}
                    className="h-10 px-3 sm:h-14 sm:px-6 text-sm sm:text-lg"
                    onClick={() => handleStartService(entry.id)}
                    disabled={actionLoading === entry.id}
                  >
                    <Scissors className="size-4 sm:size-5 mr-1.5 sm:mr-2" />
                    <span>
                      {isRescueOfOtherHint ? 'Reclamar' : 'Atender'}
                    </span>
                  </Button>
                )
              })()}

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={actionLoading === entry.id}
                    className="size-10 sm:size-14 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    title="No se presentó / Ausente"
                  >
                    <X className="size-4 sm:size-6" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>¿El cliente no se presentó?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Esto marcará a <strong>{entry.client?.name ?? 'Cliente'}</strong> como Ausente y lo quitará de la fila de espera de forma permanente.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Volver</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => handleCancel(entry.id)}
                    >
                      Sí, cancelar turno
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardContent>
        </Card>


      </div>
    )
  }

  function renderInProgressOthers() {
    if (otherInProgress.length === 0) return null
    return (
      <>
        <div className="flex items-center gap-3 pt-4">
          <Separator className="flex-1" />
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            En atención por otros barberos
          </span>
          <Separator className="flex-1" />
        </div>
        {otherInProgress.map((entry) => (
          <Card
            key={entry.id}
            className="gap-0 border-dashed py-0 opacity-60"
          >
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-secondary">
                <Scissors className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="truncate font-medium">
                    {entry.client?.name ?? 'Cliente'}
                  </p>
                  {(() => {
                    const tier = findLoyaltyTier(loyaltyTiers, leerLoyaltyEmbed(entry.client?.loyalty)?.tier_code)
                    return tier ? <LoyaltyTierChip tier={tier} /> : null
                  })()}
                  {entry.pidio_asesoria === true && <AsesoriaBadge tono="claro" className="h-5" />}
                </div>
                <p className="text-xs text-muted-foreground">
                  Atendido por {entry.barber?.full_name ?? 'otro barbero'}
                </p>
                {entry.started_at && (
                  <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="size-3" />
                    <span>{formatElapsed(entry.started_at)}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </>
    )
  }

  /**
   * Vacío de "Mi fila" ≠ vacío del local. Con `barber_id` propio no hay nadie pero en
   * la fila general sí, esta pantalla decía "Esperando clientes · cuando llegue
   * alguien aparecerá acá" — con gente sentada en el local. Y pasa de verdad: un
   * cliente del pool ("Menor espera") queda sin pre-asignar cuando ningún barbero es
   * elegible (nadie fichado, todos ocultos del check-in o bloqueados por fin de
   * turno), y entonces no está en la "Mi fila" de NADIE: sólo en la pestaña General,
   * que no es la que se abre por default.
   */
  function renderEmptyQueue() {
    const hayGenteEnElLocal = allWaitingEntries.filter(e => !e.is_break).length
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center" role="status">
        <div className="mb-4 flex size-16 items-center justify-center rounded-3xl bg-muted animate-float">
          <Scissors className="size-8 text-muted-foreground/60" />
        </div>
        {hayGenteEnElLocal > 0 ? (
          <>
            <p className="text-base font-bold">No tenés clientes asignados</p>
            <p className="mt-1 max-w-[240px] text-xs text-muted-foreground">
              Pero hay {hayGenteEnElLocal} {hayGenteEnElLocal === 1 ? 'persona esperando' : 'personas esperando'} en
              el local. Mirá <span className="font-semibold text-foreground">General</span> para tomar al próximo.
            </p>
          </>
        ) : (
          <>
            <p className="text-base font-bold">Esperando clientes</p>
            <p className="mt-1 max-w-[220px] text-xs text-muted-foreground">
              Cuando llegue alguien aparecerá acá.
            </p>
          </>
        )}
        {dayStats.servicesCount > 0 && (
          <p className="mt-3 text-[11px] font-semibold text-muted-foreground">
            Hoy: {dayStats.servicesCount} corte{dayStats.servicesCount === 1 ? '' : 's'}
          </p>
        )}
      </div>
    )
  }
  return (
    // 5rem = el `pb-20` de `/barbero/layout.tsx`, que reserva el lugar de la nav
    // fija. Con 4rem el documento medía 1rem más que la ventana: la página
    // scrolleaba sola y el contenido se metía debajo del header sticky (así se
    // veía cortado el resumen de turnos contra el borde de arriba).
    <div
      className="flex h-[calc(100dvh-5rem)] flex-col bg-background"
      onPointerDown={primeAudioContext}
    >
      {/* Top bar */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-background/95 backdrop-blur px-3 py-2.5 md:px-5">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Scissors className="size-3.5 sm:size-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <p className="font-semibold leading-none text-sm sm:text-base">{session.full_name}</p>
              {hiddenFromCheckin && (
                <Badge variant="outline" className="h-4 px-1 text-[9px] uppercase tracking-wider bg-amber-500/15 text-amber-500 border-amber-500/30">
                  <EyeOff className="size-2.5 mr-0.5" />
                  Oculto
                </Badge>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{branchName}</p>
          </div>
        </div>

        {/* Stats del día — visible entre el nombre y los controles */}
        <div className="hidden md:block mx-4 flex-1">
          <BarberStatsBar servicesCount={dayStats.servicesCount} />
        </div>

        {/* Desktop: all buttons inline */}
        <div className="hidden sm:flex items-center gap-2">
          {!breakRequestStatus && !myActiveBreak && breakConfigs.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setBreakDialogOpen(true)}>
              <Coffee className="size-4" />
              Descanso
            </Button>
          )}
          {breakRequestStatus === 'pending' && (
            <Button variant="ghost" size="sm" className="text-yellow-500" onClick={handleCancelBreakRequest} disabled={breakRequestLoading}>
              <Coffee className="size-4 mr-1" />
              Solicitado
              <X className="size-3 ml-1" />
            </Button>
          )}
          {breakRequestStatus === 'approved' && !myActiveBreak && (
            <Badge variant="outline" className="bg-green-500/15 text-green-600 border-green-500/30">
              <Coffee className="size-3 mr-1" />
              Aprobado
            </Badge>
          )}
          {canManageBreaks && (
            <Button variant="ghost" size="sm" onClick={() => { fetchPendingBreakRequests(); setBreakRequestsDialogOpen(true) }} className="relative">
              <Coffee className="size-4" />
              Gestionar
              {pendingBreakRequests.length > 0 && (
                <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white">
                  {pendingBreakRequests.length}
                </span>
              )}
            </Button>
          )}
          {/* Bolsa y no regalo: el regalo se confundía con "Entregar premio",
              que está al lado y hace otra cosa. */}
          <Button variant="ghost" size="sm" onClick={() => setDirectSaleOpen(true)}>
            <ShoppingBag className="size-4" />
            Vender
          </Button>
          {loyaltyEnabled && (
            <Button variant="ghost" size="sm" onClick={() => setDeliverRewardOpen(true)}>
              <PackageCheck className="size-4" />
              Entregar premio
            </Button>
          )}
          {canHideSelf && (
            <Button variant="ghost" size="sm" onClick={handleToggleVisibility} disabled={hiddenLoading} className={hiddenFromCheckin ? 'text-amber-500' : ''}>
              {hiddenFromCheckin ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              {hiddenFromCheckin ? 'Oculto' : 'Visible'}
            </Button>
          )}
          {canDeactivateStaff && otherBarbers.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setDeactivateDialogOpen(true)}>
              <Power className="size-4" />
              Barberos
            </Button>
          )}
          <form action={logoutBarber}>
            <Button variant="ghost" size="sm" type="submit">
              <LogOut className="size-4" />
              Salir
            </Button>
          </form>
        </div>

        {/* Mobile: break status + overflow menu */}
        <div className="flex sm:hidden items-center gap-1.5">
          {/* Break status — always visible on mobile */}
          {!breakRequestStatus && !myActiveBreak && breakConfigs.length > 0 && (
            <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => setBreakDialogOpen(true)}>
              <Coffee className="size-4" />
            </Button>
          )}
          {breakRequestStatus === 'pending' && (
            <Button variant="ghost" size="sm" className="h-8 px-2 text-yellow-500" onClick={handleCancelBreakRequest} disabled={breakRequestLoading}>
              <Coffee className="size-4" />
              <X className="size-3 ml-0.5" />
            </Button>
          )}
          {breakRequestStatus === 'approved' && !myActiveBreak && (
            <Badge variant="outline" className="h-6 px-1.5 bg-green-500/15 text-green-600 border-green-500/30 text-[10px]">
              <Coffee className="size-3 mr-0.5" />
              OK
            </Badge>
          )}
          {canManageBreaks && pendingBreakRequests.length > 0 && (
            <button
              onClick={() => { fetchPendingBreakRequests(); setBreakRequestsDialogOpen(true) }}
              className="relative flex size-8 items-center justify-center rounded-md hover:bg-muted/50"
            >
              <Coffee className="size-4" />
              <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white">
                {pendingBreakRequests.length}
              </span>
            </button>
          )}

          {/* Overflow dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 px-0">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {canManageBreaks && (
                <DropdownMenuItem onClick={() => { fetchPendingBreakRequests(); setBreakRequestsDialogOpen(true) }}>
                  <Coffee className="size-4 mr-2" />
                  Gestionar descansos
                  {pendingBreakRequests.length > 0 && (
                    <Badge className="ml-auto h-4 px-1 text-[10px] bg-amber-500">{pendingBreakRequests.length}</Badge>
                  )}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => setDirectSaleOpen(true)}>
                <ShoppingBag className="size-4 mr-2" />
                Venta de productos
              </DropdownMenuItem>
              {loyaltyEnabled && (
                <DropdownMenuItem onClick={() => setDeliverRewardOpen(true)}>
                  <PackageCheck className="size-4 mr-2" />
                  Entregar premio
                </DropdownMenuItem>
              )}
              {canHideSelf && (
                <DropdownMenuItem onClick={handleToggleVisibility} disabled={hiddenLoading}>
                  {hiddenFromCheckin ? <EyeOff className="size-4 mr-2 text-amber-500" /> : <Eye className="size-4 mr-2" />}
                  {hiddenFromCheckin ? 'Volver a ser visible' : 'Ocultarme del check-in'}
                </DropdownMenuItem>
              )}
              {canDeactivateStaff && otherBarbers.length > 0 && (
                <DropdownMenuItem onClick={() => setDeactivateDialogOpen(true)}>
                  <Power className="size-4 mr-2" />
                  Gestionar barberos
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <form action={logoutBarber}>
                <DropdownMenuItem asChild>
                  <button type="submit" className="w-full flex items-center text-destructive focus:text-destructive">
                    <LogOut className="size-4 mr-2" />
                    Cerrar sesión
                  </button>
                </DropdownMenuItem>
              </form>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Banner de turno próximo — solo modo hybrid */}
      {operationMode === 'hybrid' && upcomingAppointmentForBanner && (
        <UpcomingAppointmentBanner
          appointment={upcomingAppointmentForBanner}
          staffId={session.staff_id}
          branchId={session.branch_id}
        />
      )}

      {/* Próximo turno + por qué la fila no entrega walk-ins.
          No se muestra en modo `appointments` (ahí el timeline ES el panel, no
          hay cola que explicar) ni cuando el banner de 15 min ya está gritando
          lo mismo en hybrid. */}
      {operationMode !== 'appointments' && !upcomingAppointmentForBanner && (
        <NextAppointmentNotice
          appointments={todayAppointments}
          nowMs={now}
          timeZone={timezone}
          bufferMinutes={bufferMinutes}
          isIdle={!myActiveEntry && !myActiveBreak}
          appointmentWaitingInQueue={!!myWaitingAppointment}
          waitingWalkIns={myWaitingWalkInsCount}
          // Con la tira a la vista, el próximo turno ya está anunciado: acá sólo
          // queda el aviso que la tira no puede dar (la fila dejó de entregar).
          onlyWhenBlocking={showAppointmentStrip}
        />
      )}

      {/* ── MODO HYBRID: los turnos son una franja de 72px, no medio panel ──
          Va afuera del <main> a propósito: en `sm:` el main pasa a `flex-row`
          (fila + cliente actual, lado a lado) y la tira tiene que cruzar el
          ancho completo por encima de los dos. */}
      {showAppointmentStrip && (
        <AppointmentStrip
          appointments={todayAppointments}
          nowMs={now}
          timeZone={timezone}
          onSelectAppointment={setStripAppointment}
          onOpenAgenda={() => setAgendaSheetOpen(true)}
        />
      )}

      <main className="flex flex-1 flex-col overflow-hidden sm:flex-row">

        {/* ── MODO APPOINTMENTS: solo timeline, sin tab de cola ── */}
        {operationMode === 'appointments' && (
          <div className="flex flex-1 flex-col overflow-hidden">
            <BarberTimeline
              session={session}
              initialAppointments={appointments}
            />
          </div>
        )}

        {/* ── MODO WALK_IN e HYBRID: la cola ES la pantalla ──
            Hybrid usa exactamente el mismo layout que walk_in (el que las tres
            sucursales productivas usan todo el día) y suma los turnos arriba en
            la tira. El split 60/40 anterior le daba al timeline dos tercios del
            alto de una tablet vertical incluso con la agenda vacía. */}
        {operationMode !== 'appointments' && (
          <>
        {/* ── MOBILE: unified layout ── */}
        <div className="flex flex-1 flex-col overflow-hidden sm:hidden bg-background">
          {/* Stats compactos mobile */}
          {dayStats.servicesCount > 0 && (
            <div className="border-b bg-card/80 px-3 py-2">
              <BarberStatsBar
                servicesCount={dayStats.servicesCount}
                className="justify-center"
              />
            </div>
          )}
          <Tabs defaultValue="my-queue" className="flex flex-1 flex-col overflow-hidden h-full">
            <div className="px-3 pt-3 pb-2 bg-card border-b">
              <TabsList className="w-full h-11 bg-muted/80 p-1">
                <TabsTrigger value="my-queue" className="flex-1 text-sm h-9">
                  Mi fila
                  <Badge variant="secondary" className="ml-2 px-1.5 py-0 min-w-5 h-5 flex items-center justify-center text-[11px] font-bold shadow-sm bg-background">
                    {myWaitingEntries.filter((e) => !e.is_break).length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="general-queue" className="flex-1 text-sm h-9">
                  General
                  <Badge
                    variant="secondary"
                    className={`ml-2 px-1.5 py-0 min-w-5 h-5 flex items-center justify-center text-[11px] font-bold shadow-sm ${
                      alertasEnGeneral > 0
                        ? 'bg-amber-500 text-black animate-pulse'
                        : 'bg-background'
                    }`}
                  >
                    {allWaitingEntries.filter((e) => !e.is_break).length}
                  </Badge>
                </TabsTrigger>
                {/* En hybrid los turnos viven en la tira de arriba: una pestaña
                    más diciendo lo mismo sólo roba ancho a "Mi fila". */}
                {operationMode === 'walk_in' && appointments.length > 0 && (
                  <TabsTrigger value="appointments" className="flex-1 text-sm h-9">
                    Turnos
                    <Badge variant="secondary" className="ml-2 px-1.5 py-0 min-w-5 h-5 flex items-center justify-center text-[11px] font-bold shadow-sm bg-background">
                      {appointments.filter((a) => ['confirmed', 'checked_in'].includes(a.status)).length}
                    </Badge>
                  </TabsTrigger>
                )}
              </TabsList>
            </div>

            <TabsContent value="my-queue" className="mt-0 flex-1 overflow-hidden bg-muted/10">
              <ScrollArea className="h-full">
                <div className="space-y-3 p-3 pb-8">
                  {loading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-[72px] w-full rounded-xl" />
                    ))
                  ) : myWaitingEntries.length === 0 ? (
                    renderEmptyQueue()
                  ) : (
                    myWaitingEntries.map((e) => renderQueueEntry(e, false))
                  )}
                  {!loading && renderInProgressOthers()}
                </div>
              </ScrollArea>
            </TabsContent>
            <TabsContent value="general-queue" className="mt-0 flex-1 overflow-hidden bg-muted/10">
              <ScrollArea className="h-full">
                <div className="space-y-3 p-3 pb-8">
                  {loading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-[72px] w-full rounded-xl" />
                    ))
                  ) : allWaitingEntries.length === 0 ? (
                    renderEmptyQueue()
                  ) : (
                    allWaitingEntries.map((e) => renderQueueEntry(e, true))
                  )}
                  {!loading && renderInProgressOthers()}
                </div>
              </ScrollArea>
            </TabsContent>
            {operationMode === 'walk_in' && appointments.length > 0 && (
              <TabsContent value="appointments" className="mt-0 flex-1 overflow-hidden bg-muted/10">
                <div className="h-full overflow-hidden">
                  <BarberTimeline
                    session={session}
                    initialAppointments={appointments}
                  />
                </div>
              </TabsContent>
            )}
          </Tabs>

          {/* TIMER ABAJO (Sticky Footer para cliente/break activo) */}
          {(myActiveEntry || myActiveBreak) && (
            <div className="shrink-0 max-h-[60vh] overflow-y-auto border-t border-border/50 bg-background/80 backdrop-blur z-10 pb-safe">
              <div className="p-3 sm:p-4">
                {myActiveBreak ? (
                  <ActiveBreakCard
                    startedAt={myActiveBreak.started_at}
                    durationMinutes={breakDurationMinutes}
                    onComplete={handleCompleteBreak}
                    actionLoading={actionLoading === myActiveBreak.id}
                  />
                ) : myActiveEntry ? (
                  <ActiveClientCard
                    entry={myActiveEntry}
                    variant="mobile"
                    onComplete={() => setCompletingEntry(myActiveEntry)}
                    actionLoading={actionLoading === myActiveEntry.id}
                    onVerAsesoria={() => setConsultaAsesoriaDe(myActiveEntry.id)}
                  />
                ) : null}
              </div>
            </div>
          )}
        </div>

        {/* ── DESKTOP: side-by-side layout ── */}
        {/* Queue list */}
        <section className="hidden sm:flex min-h-0 flex-1 flex-col overflow-hidden border-r">
          <Tabs defaultValue="my-queue" className="flex flex-1 flex-col overflow-hidden">
            <div className="px-3 py-2 md:px-5">
              <TabsList className="w-full">
                <TabsTrigger value="my-queue" className="flex-1 py-2 md:py-3 text-base md:text-lg">
                  Mi fila
                  <Badge variant="secondary" className="ml-2 px-2 text-base">
                    {myWaitingEntries.filter(e => !e.is_break).length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="general-queue" className="flex-1 py-2 md:py-3 text-base md:text-lg">
                  Fila general
                  <Badge
                    variant="secondary"
                    className={`ml-2 px-2 text-base ${
                      alertasEnGeneral > 0 ? 'bg-amber-500 text-black animate-pulse' : ''
                    }`}
                  >
                    {allWaitingEntries.filter(e => !e.is_break).length}
                  </Badge>
                </TabsTrigger>
              </TabsList>
            </div>
            <Separator />

            <TabsContent
              value="my-queue"
              className="mt-0 flex-1 overflow-hidden"
            >
              <ScrollArea className="h-full">
                <div className="space-y-2 p-4 md:p-6">
                  {loading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-[88px] w-full rounded-xl" />
                    ))
                  ) : myWaitingEntries.length === 0 ? (
                    renderEmptyQueue()
                  ) : (
                    myWaitingEntries.map((e) => renderQueueEntry(e, false))
                  )}
                  {!loading && renderInProgressOthers()}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent
              value="general-queue"
              className="mt-0 flex-1 overflow-hidden"
            >
              <ScrollArea className="h-full">
                <div className="space-y-2 p-4 md:p-6">
                  {loading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-[88px] w-full rounded-xl" />
                    ))
                  ) : allWaitingEntries.length === 0 ? (
                    renderEmptyQueue()
                  ) : (
                    allWaitingEntries.map((e) => renderQueueEntry(e, true))
                  )}
                  {!loading && renderInProgressOthers()}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </section>

        {/* Current client / Active break — desktop only */}
        <section className="hidden sm:flex shrink-0 flex-col sm:w-[340px] md:w-[400px] lg:w-[460px]">
          <div className="px-5 py-4 md:px-6 md:py-5">
            <h2 className="text-xl md:text-2xl font-black tracking-tight">
              {myActiveBreak ? 'En descanso' : myActiveEntry ? 'Cliente actual' : 'Sin cliente'}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {myActiveBreak
                ? 'Tomate el tiempo que necesites'
                : myActiveEntry
                  ? 'El color de abajo indica tu ritmo'
                  : 'Seleccioná un cliente de la fila'}
            </p>
          </div>
          <Separator />
          <div className="flex flex-1 flex-col p-4 md:p-5">
            {myActiveBreak ? (
              <ActiveBreakCard
                startedAt={myActiveBreak.started_at}
                durationMinutes={breakDurationMinutes}
                onComplete={handleCompleteBreak}
                actionLoading={actionLoading === myActiveBreak.id}
              />
            ) : myActiveEntry ? (
              <ActiveClientCard
                entry={myActiveEntry}
                variant="desktop"
                onComplete={() => setCompletingEntry(myActiveEntry)}
                actionLoading={actionLoading === myActiveEntry.id}
                onVerAsesoria={() => setConsultaAsesoriaDe(myActiveEntry.id)}
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center text-center">
                <div className="flex size-20 items-center justify-center rounded-3xl bg-muted animate-float">
                  <Scissors className="size-10 text-muted-foreground/50" />
                </div>
                <p className="mt-4 text-lg font-bold">Listo para atender</p>
                <p className="mt-1 max-w-[260px] text-sm text-muted-foreground">
                  Cuando un cliente entre a tu fila, apretá <span className="font-semibold text-foreground">Atender</span> para empezar.
                </p>
              </div>
            )}
          </div>
        </section>
          </>
        )}
        {/* ── FIN MODO WALK_IN / HYBRID ── */}
      </main>

      {/* Next client waiting warning overlay */}
      {showWaitWarning && (
        <NextClientAlert
          clientName={myRealWaitingEntries[0]?.client?.name ?? null}
          pidioAsesoria={myRealWaitingEntries[0]?.pidio_asesoria === true}
          onStart={handleWarningStartService}
          starting={warningStarting}
        />
      )}

      {/* Pop-up de asesoría: se abre solo al empezar a atender a quien la pidió
          (ver `modoAsesoria`) y se reabre en consulta desde el sello. */}
      <AsesoriaInicioDialog
        entry={myActiveEntry ?? null}
        modo={modoAsesoria}
        onCerrar={cerrarAsesoria}
      />

      <CompleteServiceDialog
        entry={completingEntry}
        branchId={session.branch_id}
        tiers={loyaltyTiers}
        staffIdDelPanel={session.staff_id}
        onClose={() => setCompletingEntry(null)}
        onCompleted={async () => {
          // Refresh estándar tras finalizar. El siguiente cliente queda en
          // "Mi fila" como waiting (sin fairness gate gracias a mig 131) y
          // arranca cuando el barbero toca "Atender" — NO se autoarranca el
          // cronómetro porque eso requiere que el cliente esté físicamente
          // en la silla (incidente Fabrizio/Santino vela, 2026-05-09).
          await fetchQueue()
          await refreshStats()
          // El cobro puede haber cerrado un TURNO: sin esto la tira seguía
          // mostrándolo "En curso" hasta el refresco de 60s. En walk_in no hay
          // agenda que refrescar, así que no gastamos la query.
          if (operationMode !== 'walk_in') refreshAppointments()
        }}
      />

      {/* Detalle del turno tocado en la tira: registrar llegada, iniciar,
          avisar, marcar ausente y cobrar. Es la MISMA hoja que usa el timeline. */}
      <AppointmentDetailSheet
        appointment={stripAppointment}
        staffId={session.staff_id}
        branchId={session.branch_id}
        onClose={() => setStripAppointment(null)}
        onOpenCompleteDialog={handleCompleteAppointment}
        onActionDone={() => {
          refreshAppointments()
          // "Registrar llegada" crea la entrada de fila: la cola tiene que
          // reflejarlo sin esperar al evento de Realtime.
          fetchQueue()
        }}
      />

      {/* Agenda completa a demanda. El timeline no se borró: se dejó de tener
          medio panel reservado para él y se abre cuando el barbero lo pide. */}
      <Sheet open={agendaSheetOpen} onOpenChange={setAgendaSheetOpen}>
        <SheetContent side="bottom" className="h-[92dvh] gap-0 p-0">
          <SheetHeader className="shrink-0 border-b px-4 py-3">
            <SheetTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="size-4 text-muted-foreground" />
              Agenda de hoy
            </SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-hidden">
            <BarberTimeline session={session} initialAppointments={todayAppointments} />
          </div>
        </SheetContent>
      </Sheet>

      {/* Carga de la entrada de fila del turno antes de abrir el cobro */}
      {loadingApptEntryId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Cargando...
          </div>
        </div>
      )}

      <DirectSaleDialog
        open={directSaleOpen}
        branchId={session.branch_id}
        barberId={session.staff_id}
        onClose={() => setDirectSaleOpen(false)}
        onCompleted={() => {
          refreshStats()
        }}
      />

      {/* Entrega de un premio (merch/especial) sin cobro: el mismo escáner del
          cobro en modo entrega. Un descuento o una invitación se rechazan acá y
          se aplican desde "Cobrar" (`needs_checkout`). */}
      <CouponScanDialog
        mode="delivery"
        open={deliverRewardOpen}
        branchId={session.branch_id}
        clientId={null}
        onClose={() => setDeliverRewardOpen(false)}
        onDelivered={(rewardName) => {
          setDeliverRewardOpen(false)
          toast.success(`Entregado: ${rewardName}`)
        }}
      />

      <ClientProfileSheet
        client={profileClient}
        isOpen={!!profileClient}
        onClose={() => setProfileClient(null)}
      />

      {/* Break request dialog */}
      <Dialog open={breakDialogOpen} onOpenChange={setBreakDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{canManageBreaks ? 'Tomar descanso' : 'Solicitar descanso'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <p className="text-sm text-muted-foreground mb-2">Seleccioná el tipo de descanso:</p>
              <Select value={selectedBreakConfig} onValueChange={setSelectedBreakConfig}>
                <SelectTrigger>
                  <SelectValue placeholder="Tipo de descanso..." />
                </SelectTrigger>
                <SelectContent>
                  {breakConfigs.filter(bc => bc.is_active && bc.branch_id === session.branch_id).map((bc) => (
                    <SelectItem key={bc.id} value={bc.id}>
                      {bc.name} ({bc.duration_minutes} min)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {canManageBreaks && (
              <div>
                <Label className="text-sm">¿Luego de cuántos cortes?</Label>
                <div className="flex items-center gap-2 mt-1.5">
                  {/* Con el panel girado 180° el teclado de Android sale al revés: −/+ */}
                  <CampoContadorTablet
                    valor={selfApproveCuts}
                    onCambiar={setSelfApproveCuts}
                    etiqueta="Luego de cuántos cortes"
                  >
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      className="w-24"
                      value={selfApproveCuts}
                      onChange={(e) => setSelfApproveCuts(e.target.value)}
                    />
                  </CampoContadorTablet>
                  <span className="text-sm text-muted-foreground">cortes (0 = ahora)</span>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBreakDialogOpen(false)}>Cancelar</Button>
            <Button
              disabled={!selectedBreakConfig || breakRequestLoading}
              onClick={() => void handleRequestBreak()}
            >
              <Coffee className="size-4 mr-2" />
              {canManageBreaks ? 'Iniciar' : 'Solicitar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage break requests dialog (for barbers with breaks.grant) */}
      <Dialog open={breakRequestsDialogOpen} onOpenChange={setBreakRequestsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Solicitudes de descanso</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 max-h-[60vh] overflow-y-auto">
            {pendingBreakRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No hay solicitudes pendientes de otros barberos.
              </p>
            ) : (
              pendingBreakRequests.map((req) => {
                const staffName = req.staff?.full_name ?? 'Barbero'
                const breakName = req.break_config?.name ?? 'Descanso'
                const duration = req.break_config?.duration_minutes ?? 0
                const isPending = req.status === 'pending'

                return (
                  <div key={req.id} className="rounded-lg border p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 font-semibold text-sm">
                        {staffName.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{staffName}</p>
                        <p className="text-xs text-muted-foreground">
                          {breakName} ({duration}min) · {isPending ? 'Pendiente' : `Aprobado — en ${req.cuts_before_break} cortes`}
                        </p>
                      </div>
                    </div>
                    {isPending && (
                      // flex-wrap: con el panel girado el contador −/+ mide ~140 px
                      // (el input, 80) y la fila no entraba en el diálogo: «Rechazar»
                      // quedaba cortado por el borde (hallazgo giro-180-04). Así los
                      // botones bajan a una segunda línea, juntos y a la derecha.
                      <div className="flex flex-wrap items-center gap-2">
                        <Label className="text-xs whitespace-nowrap">Luego de</Label>
                        {/* Con el panel girado 180° el teclado de Android sale al revés: −/+ */}
                        <CampoContadorTablet
                          valor={approveCutsInputs[req.id] ?? '0'}
                          onCambiar={(v) => setApproveCutsInputs(prev => ({ ...prev, [req.id]: v }))}
                          etiqueta={`Cortes antes del descanso de ${staffName}`}
                        >
                          <Input
                            type="number"
                            min="0"
                            step="1"
                            className="w-20 h-8 text-sm"
                            value={approveCutsInputs[req.id] ?? '0'}
                            onChange={(e) => setApproveCutsInputs(prev => ({ ...prev, [req.id]: e.target.value }))}
                          />
                        </CampoContadorTablet>
                        <span className="text-xs text-muted-foreground">cortes</span>
                        <div className="ml-auto flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-green-600 border-green-500/30 hover:bg-green-500/10"
                            onClick={() => handleApproveOtherBreak(req.id)}
                            disabled={approveLoading === req.id}
                          >
                            <CheckCircle2 className="size-3.5 mr-1" />
                            Aprobar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-red-500 border-red-500/30 hover:bg-red-500/10"
                            onClick={() => handleRejectOtherBreak(req.id)}
                            disabled={approveLoading === req.id}
                          >
                            <XCircle className="size-3.5 mr-1" />
                            Rechazar
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Deactivate barbers dialog (for barbers with staff.deactivate) */}
      <Dialog open={deactivateDialogOpen} onOpenChange={setDeactivateDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Gestionar barberos</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 max-h-[60vh] overflow-y-auto">
            {otherBarbers.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No hay otros barberos activos.
              </p>
            ) : (
              otherBarbers.map((barber) => {
                const barberWaiting = dynamicEntries.filter(
                  (e) => e.barber_id === barber.id && e.status === 'waiting' && !e.is_break
                ).length
                return (
                  <div key={barber.id} className="rounded-lg border p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary font-semibold text-sm">
                        {barber.full_name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{barber.full_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {barberWaiting > 0
                            ? `${barberWaiting} cliente(s) en espera — serán reasignados`
                            : 'Sin clientes en espera'}
                        </p>
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-red-500 border-red-500/30 hover:bg-red-500/10"
                            disabled={deactivateLoading === barber.id}
                          >
                            <Power className="size-3.5 mr-1" />
                            Desactivar
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>¿Desactivar a {barber.full_name}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              {barberWaiting > 0
                                ? `Este barbero tiene ${barberWaiting} cliente(s) en espera. Serán reasignados automáticamente al barbero con menor carga.`
                                : 'Este barbero no aparecerá como opción para nuevos clientes hasta que sea reactivado.'}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              onClick={() => handleDeactivateBarber(barber.id)}
                            >
                              Sí, desactivar
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
