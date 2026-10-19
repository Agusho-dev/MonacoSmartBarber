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
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CampoContadorTablet } from '@/components/barber/campo-tablet'
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
import { DisposicionFila, ColumnasFila } from './fila/disposicion-fila'
import { Ranura, SillaCargando, SillaDescansoProximo, SillaSinLeer, SillaVacia } from './fila/silla'
import { CabeceraFila } from './fila/cabecera-fila'
import { CortandoAhora, SeccionFila, TramoVacio } from './fila/secciones'
import {
  FichaDescansoEnFila,
  TarjetaEspera,
  type AccionEntrada,
  type TarjetaEsperaProps,
} from './fila/tarjeta-espera'
import { Sello } from './fila/sello'
import {
  Coffee,
  CheckCircle2,
  XCircle,
  Power,
  CalendarDays,
  MessageCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { CompleteServiceDialog } from './complete-service-dialog'
import { CouponScanDialog } from './coupon-scan-dialog'
import { findLoyaltyTier, type LoyaltyTierLite } from '@/lib/loyalty-checkout'
import { DirectSaleDialog } from './direct-sale-dialog'
import { ClientProfileSheet } from './client-profile-sheet'
import { ActiveClientCard, ActiveBreakCard } from './active-client-card'
import { NextClientAlert } from './next-client-alert'
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

/**
 * HH:MM con la hora del DISPOSITIVO, como el visor de arriba (las llegadas de la
 * fila tienen que coincidir con él). Uno solo para todo el panel: el panel se
 * vuelve a dibujar cada 5 s y crear un formateador por ficha en cada vuelta es
 * trabajo tirado.
 */
const FORMATO_HORA_DISPOSITIVO = new Intl.DateTimeFormat('es-AR', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

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
  // "¿No se presentó?" de una ficha. El diálogo es UNO y vive acá, no en la
  // ficha: la misma entrada se dibuja en la silla, en "Tu fila" o en "En el
  // local", y al pasar de un tramo al otro la ficha se vuelve a montar —un
  // diálogo adentro se cerraba solo bajo el dedo—.
  const [noVinoId, setNoVinoId] = useState<string | null>(null)
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
  // La entrada del "no vino", mientras siga esperando: si otra tablet la tomó o
  // la sacó, el diálogo se cierra solo (como cuando vivía en la ficha y la
  // ficha desaparecía) y nunca se confirma sobre alguien que ya no espera.
  const noVinoDe = noVinoId ? (allWaitingEntries.find((e) => e.id === noVinoId && !e.is_break) ?? null) : null

  const hayOtroModalAbierto =
    !!noVinoDe ||
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

  // La tira de turnos reemplaza al timeline dentro del panel (hybrid, y walk_in
  // con algún turno cargado: antes ése sólo se veía en una pestaña del celular).
  // Sin turnos hoy no ocupa un solo píxel: la cola walk-in es la pantalla.
  const showAppointmentStrip = operationMode !== 'appointments' && todayAppointments.length > 0

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

  // ── Fichas del tarjetero ──
  // Qué se puede hacer con cada ficha. Son las MISMAS reglas que tenía el botón
  // de cada tarjeta (sólo se movieron acá para que la silla y el tarjetero no
  // puedan decir cosas distintas):
  //  · cortando o en descanso, ninguna ficha tiene botón;
  //  · un TURNO no se toma con "Atender": ese botón llama al claim con
  //    `preferredEntryId` y ese camino del RPC filtra `is_appointment = false`,
  //    así que devolvía vacío siempre ("El cliente ya no está disponible"). Va
  //    por "Iniciar turno", que arranca ESE turno y nada más. Un descanso
  //    pendiente con prioridad anterior va primero (misma regla que el RPC:
  //    `q.priority_order < v_pending_break_priority` en los caminos [A]/[B]). Se
  //    ofrece sobre el primero de mi fila o sobre uno cuya hora ya llegó (ahí el
  //    motor le da precedencia absoluta sobre los walk-ins); antes de su hora,
  //    como secundario: adelantarlo es una decisión del barbero;
  //  · con el descanso listo, cualquier "Atender" arrancaría el descanso (ver
  //    `descansoListo`): mejor no ofrecer un botón que hace otra cosa;
  //  · en el resto del local, cualquier barbero libre puede tomar un dinámico o
  //    un cliente sin barbero (rescate de limbos del hint divergente, mig 134 +
  //    commit 1cb1a41; el claim es pool no bloqueante con FOR UPDATE SKIP
  //    LOCKED). Si el hint apunta a OTRO barbero el botón es "Reclamar",
  //    secundario, para evitar la duda del 2026-05-26 (dos barberos libres +
  //    mismo cliente → ¿quién lo toma?). Tampoco es "robar" tomar al que aceptó
  //    Menor espera por WhatsApp si me esperaba a mí: conservó su lugar en MI
  //    fila.
  function accionDe(entry: QueueEntry, esDelLocal: boolean): AccionEntrada | null {
    if (myActiveEntry || myActiveBreak) return null
    const isMyMainTap = entry.id === myWaitingEntries[0]?.id

    if (entry.is_appointment) {
      if (entry.barber_id !== session.staff_id) return null
      if (
        myPendingGhost &&
        new Date(myPendingGhost.priority_order).getTime() <= new Date(entry.priority_order).getTime()
      ) {
        return null
      }
      const isDue = appointmentStartMsOf(entry) <= now
      if (!isMyMainTap && !isDue) return null
      return { tipo: 'turno', aTiempo: isDue }
    }

    if (descansoListo) return null

    const generalClaimAllowed = esDelLocal && (entry.is_dynamic || !entry.barber_id)
    if (!isMyMainTap && !generalClaimAllowed) return null
    const isRescueOfOtherHint =
      esDelLocal &&
      entry.barber_id != null &&
      entry.barber_id !== session.staff_id &&
      !esMovidaPorWhatsAppDe(entry, session.staff_id)
    return isRescueOfOtherHint ? { tipo: 'reclamar' } : { tipo: 'atender' }
  }

  function propsDeFicha(
    entry: QueueEntry,
    variante: TarjetaEsperaProps['variante'],
    { orden, delLocal = variante === 'local' }: { orden?: number; delLocal?: boolean } = {},
  ): TarjetaEsperaProps {
    // Del resto del local (no de mi fila): rige la regla de rescate de `accionDe`.
    const esDelLocal = delLocal
    const accion = accionDe(entry, esDelLocal)
    // Mig 218: aceptó Menor espera por WhatsApp y sigue esperando en el pool. Si
    // me esperaba a MÍ, está en mi fila aunque el hint lo haya sugerido a otro
    // (`armarMiFila`): sigue siendo mi cliente y lo atiende el primero que llegue.
    const meEsperabaAMi = esMovidaPorWhatsAppDe(entry, session.staff_id)
    const barberoQueEsperaba =
      esMovidaPorWhatsApp(entry) && !meEsperabaAMi && entry.menor_espera_barbero_original_id
        ? (allBarbers.find((b) => b.id === entry.menor_espera_barbero_original_id)?.full_name ?? null)
        : null
    // `client_loyalty_state` llega como OBJETO (relación 1:1). Ver `leerLoyaltyEmbed`.
    const loyalty = leerLoyaltyEmbed(entry.client?.loyalty)
    const cliente = entry.client
    return {
      entrada: entry,
      variante,
      orden,
      minutosEsperando: (now - new Date(entry.checked_in_at).getTime()) / 60_000,
      // Hora del dispositivo, como el visor de arriba: las dos tienen que coincidir.
      llegada: FORMATO_HORA_DISPOSITIVO.format(new Date(entry.checked_in_at)),
      // Sin categoría (programa apagado / cliente no enrolado) no hay chip.
      tier: findLoyaltyTier(loyaltyTiers, loyalty?.tier_code),
      // Hora RESERVADA, tomada de la agenda: en una entrada adoptada de un
      // walk-in `priority_order` es la hora en que el cliente entró al local.
      horaTurno: entry.is_appointment ? formatHourMinute(appointmentStartMsOf(entry), timezone) : null,
      asesoriaReciente: asesoriasRecientes.has(entry.id),
      notaWhatsApp: meEsperabaAMi
        ? { tipo: 'me-esperaba' }
        : barberoQueEsperaba
          ? { tipo: 'esperaba-a', barbero: barberoQueEsperaba }
          : null,
      atiendeCon: esDelLocal ? (entry.barber?.full_name ?? null) : null,
      delLocal: variante === 'silla' && esDelLocal,
      accion,
      motivoSinAccion: !accion && myPendingGhost ? 'Primero va tu descanso: arranca solo.' : null,
      ocupada: actionLoading === entry.id,
      onAccion: accion
        ? () => {
            if (accion.tipo === 'turno') void handleStartAppointment(entry)
            else void handleStartService(entry.id)
          }
        : undefined,
      onNoVino: () => setNoVinoId(entry.id),
      // El nombre abre la ficha (observaciones, Instagram y cortes con fotos,
      // por server action: la fila no trae esas columnas).
      onVerFicha: cliente ? () => setProfileClient(cliente) : undefined,
    }
  }

  // Mi descanso pendiente en la fila: cuántos clientes míos van antes. Se cuenta
  // con `priority_order` (FIFO real del backend), no con `position`.
  function cortesAntesDelDescanso(ghost: QueueEntry): number {
    const ghostPriorityTs = new Date(ghost.priority_order).getTime()
    return entries.filter(
      (e) =>
        e.status === 'waiting' &&
        !e.is_break &&
        e.barber_id === session.staff_id &&
        new Date(e.priority_order).getTime() < ghostPriorityTs,
    ).length
  }

  // ── La silla ──
  // Libre, lo primero de "Mi fila" sube a la silla: si es un cliente, con su
  // "Atender" en grande; si es mi descanso, el aviso de que arranca solo. Lo que
  // sube no se repite abajo, en el tarjetero.
  const sillaLibre = !myActiveEntry && !myActiveBreak
  const primeroDeMiFila = myWaitingEntries[0] ?? null
  const subeALaSilla = sillaLibre && primeroDeMiFila ? primeroDeMiFila : null
  const restoDeMiFila = subeALaSilla ? myWaitingEntries.slice(1) : myWaitingEntries
  const idsDeMiFila = new Set(myWaitingEntries.map((e) => e.id))
  // El resto del local: lo que espera y no está en mi fila (los descansos de
  // los demás no se muestran). Va a la vista, debajo de lo propio, y no en una
  // pestaña: la pestaña "General" era un cajón silencioso —la abierta por
  // defecto era "Mi fila"— y un cliente del pool cuyo hint no cayó en la "Mi
  // fila" de nadie sólo existía ahí. Lo que hay que mirar (sin barbero, o
  // esperando hace 40 min o más) se marca en el título del tramo.
  const esperandoEnElLocal = allWaitingEntries.filter((e) => !e.is_break && !idsDeMiFila.has(e.id))
  // Mi fila vacía y alguien del local que puedo ATENDER (sin barbero: el que el
  // hint no le dio a nadie; no los que están sugeridos a otro, que son
  // "Reclamar"): sube a mi silla con su Atender, en vez de dejarlo en un renglón
  // del tercer tramo mientras yo estoy libre. Es el limbo que la pestaña
  // "General" escondía. El claim es atómico: si otro barbero lo toma antes, el
  // segundo toque recibe el aviso de siempre.
  const delLocalALaSilla =
    sillaLibre && !primeroDeMiFila
      ? (esperandoEnElLocal.find((e) => accionDe(e, true)?.tipo === 'atender') ?? null)
      : null
  const restoDelLocal = delLocalALaSilla
    ? esperandoEnElLocal.filter((e) => e.id !== delLocalALaSilla.id)
    : esperandoEnElLocal
  const sinBarberoEnElLocal = restoDelLocal.filter((e) => !e.barber_id).length
  const demoradosEnElLocal = restoDelLocal.filter(
    (e) => now - new Date(e.checked_in_at).getTime() >= 40 * 60 * 1000,
  ).length

  const silla = loading ? (
    <SillaCargando />
  ) : !filaLeida ? (
    <SillaSinLeer onReintentar={() => void fetchQueue()} />
  ) : myActiveBreak ? (
    <ActiveBreakCard
      key={myActiveBreak.id}
      startedAt={myActiveBreak.started_at}
      durationMinutes={breakDurationMinutes}
      onComplete={handleCompleteBreak}
      actionLoading={actionLoading === myActiveBreak.id}
    />
  ) : myActiveEntry ? (
    <ActiveClientCard
      key={myActiveEntry.id}
      entry={myActiveEntry}
      onComplete={() => setCompletingEntry(myActiveEntry)}
      actionLoading={actionLoading === myActiveEntry.id}
      onVerAsesoria={() => setConsultaAsesoriaDe(myActiveEntry.id)}
    />
  ) : subeALaSilla?.is_break ? (
    <SillaDescansoProximo key={subeALaSilla.id} />
  ) : subeALaSilla ? (
    <TarjetaEspera key={subeALaSilla.id} {...propsDeFicha(subeALaSilla, 'silla')} />
  ) : delLocalALaSilla ? (
    <TarjetaEspera key={delLocalALaSilla.id} {...propsDeFicha(delLocalALaSilla, 'silla', { delLocal: true })} />
  ) : (
    <SillaVacia esperandoEnElLocal={restoDelLocal.length} />
  )

  const filas = (
    <>
      {/* Con la silla vacía la silla ya dice que no hay nadie: el tramo sobra. */}
      {(loading || !sillaLibre || subeALaSilla) && (
        <SeccionFila id="fila-tuya" titulo="Tu fila" cantidad={loading ? undefined : myRealWaitingEntries.length}>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-28 w-full rounded-[1.25rem] bg-card" />
              ))}
            </div>
          ) : restoDeMiFila.length === 0 ? (
            <TramoVacio>{subeALaSilla ? 'Nadie más en tu fila.' : 'Nadie esperando en tu fila.'}</TramoVacio>
          ) : (
            <div className="space-y-3">
              {restoDeMiFila.map((e) => {
                const orden = myWaitingEntries.indexOf(e) + 1
                return e.is_break ? (
                  <FichaDescansoEnFila key={e.id} cortesAntes={cortesAntesDelDescanso(e)} />
                ) : (
                  <TarjetaEspera key={e.id} {...propsDeFicha(e, 'propia', { orden })} />
                )
              })}
            </div>
          )}
        </SeccionFila>
      )}

      {!loading && restoDelLocal.length > 0 && (
        <SeccionFila
          id="fila-local"
          titulo="En el local"
          cantidad={restoDelLocal.length}
          aviso={
            (sinBarberoEnElLocal > 0 || demoradosEnElLocal > 0) && (
              <span className="flex flex-wrap gap-1.5">
                {sinBarberoEnElLocal > 0 && (
                  <Sello tono="azul">
                    {sinBarberoEnElLocal} sin barbero
                  </Sello>
                )}
                {demoradosEnElLocal > 0 && (
                  <Sello tono="ambar">
                    {demoradosEnElLocal} {demoradosEnElLocal === 1 ? 'demorado' : 'demorados'}
                  </Sello>
                )}
              </span>
            )
          }
        >
          <div className="space-y-2">
            {restoDelLocal.map((e) => (
              <TarjetaEspera key={e.id} {...propsDeFicha(e, 'local')} />
            ))}
          </div>
        </SeccionFila>
      )}

    </>
  )

  // Qué está en la silla: al cambiar, la ficha entra de nuevo por la ranura.
  const claveSilla = loading
    ? 'cargando'
    : !filaLeida
      ? 'sin-leer'
      : (myActiveBreak?.id ?? myActiveEntry?.id ?? subeALaSilla?.id ?? delLocalALaSilla?.id ?? 'vacia')

  // Quién está cortando en el local. Contexto: en vertical va al final del
  // tarjetero; apaisada, debajo de la silla (que si no deja un hueco vacío).
  const cortandoAhora = (lugar: 'silla' | 'filas') => (loading ? null : (
    <CortandoAhora
      id={`fila-cortando-${lugar}`}
      cortes={otherInProgress.map((e) => ({
        id: e.id,
        barbero: e.barber?.full_name ?? 'Otro barbero',
        cliente: e.client?.name ?? 'Cliente',
        minutos: e.started_at ? (now - new Date(e.started_at).getTime()) / 60_000 : null,
        tier: findLoyaltyTier(loyaltyTiers, leerLoyaltyEmbed(e.client?.loyalty)?.tier_code),
        pidioAsesoria: e.pidio_asesoria === true,
      }))}
    />
  ))

  const yo = allBarbers.find((b) => b.id === session.staff_id)

  const cabecera = (
    <CabeceraFila
      nombre={session.full_name}
      sucursal={branchName}
      avatarUrl={yo?.avatar_url ?? null}
      cortesHoy={dayStats.servicesCount}
      oculto={hiddenFromCheckin}
      descanso={
        myActiveBreak
          ? { estado: 'en-curso' }
          : breakRequestStatus === 'pending'
            ? { estado: 'solicitado', cargando: breakRequestLoading, onCancelar: () => void handleCancelBreakRequest() }
            : breakRequestStatus === 'approved'
              ? { estado: 'aprobado' }
              : breakConfigs.length > 0 && !breakRequestStatus
                ? { estado: 'libre', onPedir: () => setBreakDialogOpen(true) }
                : { estado: 'sin-configurar' }
      }
      gestionDescansos={
        canManageBreaks
          ? {
              pendientes: pendingBreakRequests.length,
              onAbrir: () => {
                fetchPendingBreakRequests()
                setBreakRequestsDialogOpen(true)
              },
            }
          : null
      }
      onVender={() => setDirectSaleOpen(true)}
      onEntregarPremio={loyaltyEnabled ? () => setDeliverRewardOpen(true) : null}
      visibilidad={canHideSelf ? { cargando: hiddenLoading, onAlternar: () => void handleToggleVisibility() } : null}
      onGestionarBarberos={canDeactivateStaff && otherBarbers.length > 0 ? () => setDeactivateDialogOpen(true) : null}
      accionSalir={logoutBarber}
    />
  )

  const avisos = (
    <>
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

      {/* Los turnos del día son una franja, no medio panel. Sin turnos hoy no
          ocupa un solo píxel: la fila es la pantalla. */}
      {showAppointmentStrip && (
        <AppointmentStrip
          appointments={todayAppointments}
          nowMs={now}
          timeZone={timezone}
          onSelectAppointment={setStripAppointment}
          onOpenAgenda={() => setAgendaSheetOpen(true)}
        />
      )}
    </>
  )

  return (
    <>
      <DisposicionFila cabecera={cabecera} avisos={avisos} onPointerDown={primeAudioContext}>
        {operationMode === 'appointments' ? (
          // Modo turnos: la agenda ES el panel, sin fila.
          <div className="h-full overflow-hidden">
            <BarberTimeline session={session} initialAppointments={appointments} />
          </div>
        ) : (
          <ColumnasFila silla={<Ranura clave={claveSilla}>{silla}</Ranura>} filas={filas} bajoLaSilla={cortandoAhora} />
        )}
      </DisposicionFila>

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
          if (showAppointmentStrip || operationMode !== 'walk_in') refreshAppointments()
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

      {/* ¿No se presentó? (ver `noVinoId`) */}
      <AlertDialog
        open={!!noVinoDe}
        onOpenChange={(abierto) => {
          if (!abierto) setNoVinoId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿{noVinoDe?.client?.name?.trim() || 'El cliente'} no se presentó?</AlertDialogTitle>
            <AlertDialogDescription>
              Lo marca como ausente y lo saca de la fila. No se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                const id = noVinoDe?.id
                setNoVinoId(null)
                if (id) void handleCancel(id)
              }}
            >
              Sí, no vino
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
    </>
  )
}
