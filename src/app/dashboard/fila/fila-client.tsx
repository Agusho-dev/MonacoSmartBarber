'use client'

/*
 * Tablero de /dashboard/fila — "la fila única" (rediseño oct/2026).
 *
 * THESIS: la fila es UNA, en orden de llegada, y fluye hacia las sillas. A la
 *   izquierda quién espera, con su espera dibujada; a la derecha cada silla con
 *   quién está cortando y hace cuánto. Reemplaza el tablero de carriles por
 *   barbero, que llenaba la pantalla de celdas "Vacío" y escondía quién llevaba
 *   más tiempo esperando.
 * OWN-WORLD: el oscuro del dashboard (fondo, superficies `card`, hairlines), una
 *   sola familia (Geist) y mono sólo para medir (minutos, conteos, orden). El
 *   color sólo dice algo: verde cortando, blanco libre, ámbar descanso y demora,
 *   rojo crítico, celeste Menor espera, violeta turno, fucsia asesoría.
 * STORY: quien está en el mostrador ve de un vistazo quién espera hace más y qué
 *   silla está libre, y reparte arrastrando: agarra la tarjeta de un cliente y la
 *   suelta en la silla de un barbero (la gracia de la pantalla, dicho por el
 *   dueño). La silla se pone blanca ("Soltá acá"), la tarjeta en la mano dice a
 *   dónde va y qué lugar le toca, y el aviso trae "Deshacer". En la silla libre,
 *   "Atender a X" con lo que haría el motor. Anota a los que llegan desde arriba.
 * FIRST VIEWPORT: escritorio, dos paneles: la fila (tarjetas, con filtro por
 *   barbero) y la columna de sillas. Celular: las sillas en una tira deslizable y
 *   la fila debajo; al levantar una tarjeta (mantenerla apretada) los barberos
 *   suben en un dock abajo, al alcance del pulgar.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the
 *   finish review, the verdict, and DESIGN.md.
 */

import Link from 'next/link'
import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useVisibilityRefresh } from '@/hooks/use-visibility-refresh'
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  pointerWithin,
  closestCenter,
  useDroppable,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DropAnimation,
  type Modifier,
  defaultDropAnimationSideEffects,
} from '@dnd-kit/core'
import { CSS, getEventCoordinates } from '@dnd-kit/utilities'
import { SortableContext, verticalListSortingStrategy, arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { createClient } from '@/lib/supabase/client'
import { cancelQueueEntry, updateQueueOrder, createBreakEntry, startService, cerrarSoloAsesoria } from '@/lib/actions/queue'
import { CompleteServiceDialog, hayQueAnunciarCobro } from '@/components/barber/complete-service-dialog'
import { AsesoriaBadge } from '@/components/barber/asesoria-badge'
import { RecargaPorVersion } from '@/components/recarga-por-version'
import { avisarYRecargarPorVersion, esErrorDeVersion, TEXTO_RECARGA_MANUAL } from '@/lib/recarga-version'
import { descartarFotosDelCobro } from '@/stores/fotos-corte-store'
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
import { Button } from '@/components/ui/button'
import { useBranchStore } from '@/stores/branch-store'
import type { Appointment, QueueEntry, StaffSchedule, Staff, BreakConfig, Service } from '@/lib/types/database'
import { esMovidaPorWhatsApp, isBarberBlockedByShiftEnd } from '@/lib/barber-utils'
import {
  appointmentInstantMs,
  findNextAppointment,
  formatHourMinute,
  protectionWindowMinutes,
  type NextAppointmentInfo,
} from '@/lib/queue-appointments'
import { getLocalDateStr } from '@/lib/time-utils'
import { nivelEspera } from '@/components/barber/fila/espera'
import { GripVertical, MessageCircleQuestionMark, Settings2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  POOL,
  TEXTO_NIVEL,
  esDelPool,
  fechaLocal,
  lugarAlPasar,
  minutosDesde,
  nombreDePila,
  porOrdenDeLlegada,
  type BarberRow,
  type BranchRow,
} from './_tablero/derivados'
import { candidatoFifo, decidirSilla, type DecisionSilla } from './_tablero/motor'
import { RenglonFila, RenglonFantasma, type DestinoEnLaMano, type DestinoFila } from './_tablero/renglon-fila'
import {
  FichaDescanso,
  Silla,
  SinFichar,
  minutosEnLaSilla,
  type AvisoSilla,
  type EstadoSilla,
  type SillaProps,
  type SoltarEnSilla,
} from './_tablero/silla'
import { RielDeSillas } from './_tablero/riel-sillas'
import { DockSoltar, type DestinoDock } from './_tablero/dock-soltar'
import { FotoBarbero } from './_tablero/foto-barbero'
import { TextoEspera } from './_tablero/texto-espera'

interface FilaClientProps {
  initialEntries: QueueEntry[]
  barbers: BarberRow[]
  branches: BranchRow[]
  breakConfigs: BreakConfig[]
  timezone: string
  orgId: string
  /**
   * Ventana de protección de cada sucursal en minutos (45 + `buffer_minutes`,
   * los mismos números que `claim_next_for_barber`): cuánto antes de un turno
   * el motor deja de darle walk-ins al barbero.
   */
  ventanaPorSucursal: Record<string, number>
  /** Barberos con `walkin_mode = 'appointments_only'`: sólo atienden turnos. */
  soloTurnos: string[]
}

type Conexion = 'conectando' | 'en_vivo' | 'reconectando'

/** Las tres zonas del tablero donde importa dónde está el puntero al soltar. */
interface ZonasDelTablero {
  /** El contenedor que scrollea la lista de la fila. */
  lista: HTMLElement | null
  /** La columna de sillas del escritorio. */
  sillas: HTMLElement | null
  /** El dock de barberos del celular (sólo existe mientras se arrastra). */
  dock: HTMLElement | null
}

type Punto = { x: number; y: number }
type Caja = { top: number; bottom: number; left: number; right: number }

/** La parte de un elemento que se ve en la pantalla (null si no se ve). */
function cajaVisible(el: HTMLElement | null): Caja | null {
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width === 0 || r.height === 0) return null
  const top = Math.max(r.top, 0)
  const bottom = Math.min(r.bottom, window.innerHeight)
  return bottom > top ? { top, bottom, left: r.left, right: r.right } : null
}

const estaEn = (c: Caja | null, p: Punto) => !!c && p.x >= c.left && p.x <= c.right && p.y >= c.top && p.y <= c.bottom

/**
 * Una acción del tablero falló porque esta pestaña quedó con el bundle de un
 * deploy anterior (la PC del mostrador queda abierta todo el día): reintentar
 * no sirve, la acción ya no existe en el servidor. Avisa y recarga
 * (src/lib/recarga-version.ts) y devuelve true; false = no era eso.
 */
function recargarSiEsVersion(e: unknown): boolean {
  if (!esErrorDeVersion(e)) return false
  if (!avisarYRecargarPorVersion()) toast.error(TEXTO_RECARGA_MANUAL, { id: 'recarga-manual' })
  return true
}

/** Una acción que no volvió (la red o un deploy nuevo): se dice, nunca en silencio. */
function avisarAccionFallida(e: unknown, texto: string) {
  console.error('[fila]', texto, e)
  if (!recargarSiEsVersion(e)) toast.error(texto)
}

/**
 * Dónde cae lo que se arrastra. Soltar mal NUNCA puede cambiarle el lugar o el
 * barbero a nadie, así que todo lo que no sea un blanco claro devuelve vacío:
 *  1. adentro del dock del celular sólo cuentan sus barberos (el dock tapa la
 *     lista, y soltar en su fondo reordenaba la tarjeta de abajo);
 *  2. una silla o Menor espera, sólo con el puntero ADENTRO (y una silla, en la
 *     parte visible de la columna: las scrolleadas siguen teniendo rectángulo);
 *  3. entre tarjetas, sólo con el puntero sobre la parte VISIBLE de la lista y
 *     contra las tarjetas que se ven. Soltar en el título, en un costado o al
 *     lado de una silla no hace nada.
 * Con el teclado no hay puntero: la tarjeta más cercana (para pasarla a un
 * barbero está «Pasar a» en su menú).
 */
function detectarEnElTablero(args: Parameters<CollisionDetection>[0], zonas: ZonasDelTablero) {
  const { droppableContainers, droppableRects, pointerCoordinates: p } = args
  const datos = (id: string | number) => droppableContainers.find((c) => c.id === id)?.data.current
  const esDestino = (id: string | number) => datos(id)?.type === 'Column'
  const conArea = (id: string | number) => {
    const r = droppableRects.get(id)
    return !!r && r.width > 0 && r.height > 0
  }
  const tarjetas = droppableContainers.filter((c) => !esDestino(c.id) && conArea(c.id))

  if (!p) return tarjetas.length > 0 ? closestCenter({ ...args, droppableContainers: tarjetas }) : []

  const dentro = pointerWithin(args).filter((c) => conArea(c.id))

  if (estaEn(cajaVisible(zonas.dock), p)) return dentro.filter((c) => datos(c.id)?.zona === 'dock')

  const destinos = dentro.filter(
    (c) => esDestino(c.id) && (datos(c.id)?.zona !== 'sillas' || estaEn(cajaVisible(zonas.sillas), p)),
  )
  if (destinos.length > 0) return destinos

  const lista = cajaVisible(zonas.lista)
  if (!lista || !estaEn(lista, p)) return []
  const enVista = tarjetas.filter((c) => {
    const r = droppableRects.get(c.id)
    return !!r && r.bottom > lista.top && r.top < lista.bottom
  })
  if (enVista.length === 0) return []
  const bajoElPuntero = dentro.filter((c) => enVista.some((t) => t.id === c.id))
  if (bajoElPuntero.length > 0) return bajoElPuntero
  // En el hueco entre dos tarjetas: la más cercana al PUNTERO (no a la tarjeta
  // en la mano, que va corrida al costado del cursor).
  let mejor: { id: string | number; distancia: number } | null = null
  for (const c of enVista) {
    const r = droppableRects.get(c.id)
    if (!r) continue
    const distancia = Math.abs(r.top + r.height / 2 - p.y)
    if (!mejor || distancia < mejor.distancia) mejor = { id: c.id, distancia }
  }
  return mejor ? [{ id: mejor.id, data: { value: mejor.distancia } }] : []
}

/**
 * La tarjeta en la mano va al costado del puntero, no debajo: con el mouse,
 * abajo del cursor (como un archivo que se arrastra); con el dedo, arriba de la
 * yema. Así lo que está bajo el puntero —la silla que se pone blanca, "Soltá
 * acá"— siempre se ve. Nunca se sale de la pantalla: la columna de sillas está
 * contra el borde derecho.
 */
const alLadoDelPuntero: Modifier = ({ activatorEvent, activeNodeRect, overlayNodeRect, transform, windowRect }) => {
  if (!activatorEvent || !activeNodeRect) return transform
  const p = getEventCoordinates(activatorEvent)
  if (!p) return transform
  const esToque = typeof TouchEvent !== 'undefined' && activatorEvent instanceof TouchEvent
  const ancho = overlayNodeRect?.width ?? 304
  const alto = overlayNodeRect?.height ?? 56
  const anchoVentana = windowRect?.width ?? window.innerWidth
  const altoVentana = windowRect?.height ?? window.innerHeight
  // Dónde está el puntero ahora (donde se agarró + lo que se movió).
  const x = p.x + transform.x
  const y = p.y + transform.y
  let izquierda = esToque ? x - ancho / 2 : x + 14
  let arriba = esToque ? y - alto - 36 : y + 24
  if (!esToque && arriba + alto > altoVentana - 8) arriba = y - alto - 16
  if (esToque && arriba < 8) arriba = y + 48
  izquierda = Math.min(Math.max(izquierda, 8), anchoVentana - ancho - 8)
  return { ...transform, x: izquierda - activeNodeRect.left, y: arriba - activeNodeRect.top }
}

// Fijo (no depende de qué se arrastra): si cambiara al soltar, la tarjeta
// saltaría justo cuando empieza la animación.
const MODIFICADORES_DE_LA_MANO = [alLadoDelPuntero]

/** Al reordenar, la tarjeta vuelve volando a su lugar nuevo en la lista. */
const animacionAlSoltar: DropAnimation = {
  duration: 220,
  easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0.5' } } }),
}

/**
 * Soltada en una silla, la tarjeta se "mete" ahí (se achica y se apaga donde
 * se soltó). Con la animación de siempre volvía volando a la lista —el cliente
 * sigue en la fila, sólo cambió de barbero— y parecía que no se había pasado.
 */
const animacionAlSoltarEnSilla: DropAnimation = {
  duration: 180,
  easing: 'cubic-bezier(0.4, 0, 1, 1)',
  keyframes: ({ transform }) => [
    { opacity: 1, transform: CSS.Transform.toString(transform.initial) },
    { opacity: 0, transform: CSS.Transform.toString({ ...transform.initial, scaleX: 0.7, scaleY: 0.7 }) },
  ],
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function FilaClient({
  initialEntries,
  barbers,
  branches,
  breakConfigs,
  timezone,
  orgId,
  ventanaPorSucursal,
  soloTurnos,
}: FilaClientProps) {
  const selectedBranchId = useBranchStore((s) => s.selectedBranchId)
  const [entries, setEntries] = useState<QueueEntry[]>(initialEntries)
  const [liveBarbers, setLiveBarbers] = useState<BarberRow[]>(barbers)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  // Último estado confirmado de la base (para comparar en el drag).
  const confirmedEntriesRef = useRef<QueueEntry[]>(initialEntries)
  const [schedules, setSchedules] = useState<StaffSchedule[]>([])
  const [now, setNow] = useState(() => Date.now())
  const [shiftEndMargin, setShiftEndMargin] = useState(35)
  const [dailyServiceCounts, setDailyServiceCounts] = useState<Record<string, number>>({})
  const [latestAttendance, setLatestAttendance] = useState<Record<string, string>>({})
  // Turnos del día, sólo lectura: alimentan el "próximo turno" de cada silla.
  const [todayAppointments, setTodayAppointments] = useState<Appointment[]>([])
  // Servicios activos: sólo para nombrar lo que eligió cada uno en la fila.
  const [services, setServices] = useState<Service[]>([])

  const [completingEntry, setCompletingEntry] = useState<QueueEntry | null>(null)
  // Confirmación para sacar a un cliente de la fila o cancelar un corte en curso.
  const [cancelConfirmEntry, setCancelConfirmEntry] = useState<QueueEntry | null>(null)
  /** Cliente del pool al que hay que elegirle barbero antes de arrancar el corte. */
  const [asignarBarberoEntry, setAsignarBarberoEntry] = useState<QueueEntry | null>(null)

  const [draggedEntry, setDraggedEntry] = useState<QueueEntry | null>(null)
  const [draggedTemplate, setDraggedTemplate] = useState<BreakConfig | null>(null)
  /** La silla (o Menor espera) bajo el puntero mientras se arrastra. */
  const [sobre, setSobre] = useState<string | null>(null)
  /** Cómo termina el arrastre: se mete en una silla o vuelve a la lista. */
  const [soltadoEnSilla, setSoltadoEnSilla] = useState(false)
  /** La silla que acaba de recibir a alguien (la acusa un momento). */
  const [aterrizaje, setAterrizaje] = useState<string | null>(null)
  const aterrizajeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** Qué parte de la fila se ve: toda, la de Menor espera o la de un barbero. */
  const [filtro, setFiltro] = useState<string>('todos')
  /**
   * El orden de las sillas, congelado mientras se arrastra, mientras el mouse
   * está sobre la columna o el dedo sobre el riel (ver `ordenSillas`): una silla
   * que se libera corre a las demás, y el clic caía en la de al lado.
   */
  const [ordenCongelado, setOrdenCongelado] = useState<string[] | null>(null)
  const motivosCongelado = useRef({ arrastre: false, puntero: false, toque: false })
  const toqueTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [conexion, setConexion] = useState<Conexion>('conectando')

  const zonas = useRef<ZonasDelTablero>({ lista: null, sillas: null, dock: null })
  const deteccionDelTablero = useCallback<CollisionDetection>((args) => detectarEnElTablero(args, zonas.current), [])
  /** Sólo la lista y la columna de sillas scrollean solas al arrastrar cerca del borde (nunca la página). */
  const puedeScrollear = useCallback((el: Element) => el === zonas.current.lista || el === zonas.current.sillas, [])

  const supabase = useMemo(() => createClient(), [])

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 12 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // ── Lecturas ────────────────────────────────────────────────────────────────

  const fetchQueue = useCallback(async () => {
    // FIX #9: scopear por organization_id (sin esto el dashboard traía la cola
    // de TODAS las orgs). Embeds por nombre de constraint (Known Risk #15): con
    // dos FKs a `staff`, PostgREST rechaza la query entera con PGRST201. El `*`
    // trae `pidio_asesoria` y `asesoria_vista_at` (mig 217).
    const { data } = await supabase
      .from('queue_entries')
      .select('*, client:clients!queue_entries_client_id_fkey(id, name, phone), barber:staff!queue_entries_barber_id_fkey(id, full_name, avatar_url)')
      .eq('organization_id', orgId)
      .in('status', ['waiting', 'in_progress'])
      // `priority_order` es la llegada (el FIFO real) y `position` sólo desempata:
      // se recicla y se repite entre entradas vivas.
      .order('priority_order')
      .order('position')
    if (data) {
      const typed = data as QueueEntry[]
      setEntries(typed)
      confirmedEntriesRef.current = typed
    }
  }, [supabase, orgId])

  const fetchBarbers = useCallback(async () => {
    const { data } = await supabase
      .from('staff')
      .select('id, full_name, branch_id, status, is_active, hidden_from_checkin, avatar_url')
      .eq('organization_id', orgId)
      .or('role.eq.barber,is_also_barber.eq.true')
      .eq('is_active', true)
      .order('full_name')
    if (data) setLiveBarbers(data as BarberRow[])
  }, [supabase, orgId])

  const fetchSchedules = useCallback(async () => {
    // Bounds del día en la TZ de la org (no UTC): pasada la medianoche UTC los
    // cortes del día quedaban en 0 y el día de la semana saltaba.
    const { getLocalDayBounds } = await import('@/lib/time-utils')
    const { start: dayStartISO, end: dayEndISO } = getLocalDayBounds(timezone)
    const localDow = new Date(
      new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date()),
    ).getDay()

    const [schedRes, settingsRes, todayVisitsRes, attendanceRes] = await Promise.all([
      supabase.from('staff_schedules').select('*').eq('day_of_week', localDow).eq('is_active', true),
      // Por organización: `app_settings` se lee entera con cualquier rol. Sin el
      // filtro, `.maybeSingle()` recibía 14 filas, devolvía error y el tablero
      // usaba el margen de fin de turno por defecto (35) en vez del de la org.
      supabase
        .from('app_settings')
        .select('shift_end_margin_minutes')
        .eq('organization_id', orgId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('visits')
        .select('barber_id')
        .gte('completed_at', dayStartISO)
        .lte('completed_at', dayEndISO)
        .not('barber_id', 'is', null),
      supabase
        .from('attendance_logs')
        .select('staff_id, action_type')
        .gte('recorded_at', dayStartISO)
        .lte('recorded_at', dayEndISO)
        .order('recorded_at', { ascending: false }),
    ])

    if (schedRes.data) setSchedules(schedRes.data as StaffSchedule[])
    if (settingsRes.error) console.error('[fila] app_settings:', settingsRes.error.message)
    if (settingsRes.data) {
      const margin = (settingsRes.data as { shift_end_margin_minutes?: number }).shift_end_margin_minutes
      if (typeof margin === 'number' && margin >= 0) setShiftEndMargin(margin)
    }
    if (todayVisitsRes?.data) {
      const counts: Record<string, number> = {}
      for (const v of todayVisitsRes.data as { barber_id: string }[]) counts[v.barber_id] = (counts[v.barber_id] || 0) + 1
      setDailyServiceCounts(counts)
    }
    if (attendanceRes.data) {
      const latest: Record<string, string> = {}
      attendanceRes.data.forEach((log: { staff_id: string; action_type: string }) => {
        if (!latest[log.staff_id]) latest[log.staff_id] = log.action_type
      })
      setLatestAttendance(latest)
    }
  }, [supabase, timezone, orgId])

  /** Agenda del día: sólo para anunciar el próximo turno de cada silla. */
  const fetchAppointments = useCallback(async () => {
    const branchIds = selectedBranchId ? [selectedBranchId] : branches.map((b) => b.id)
    if (branchIds.length === 0) {
      setTodayAppointments([])
      return
    }
    // Sin red (o con el bundle de un deploy anterior) se queda con la agenda que
    // tenía: el refresco de 60 s lo vuelve a intentar. Sin el catch era una
    // promesa rechazada sin atrapar en cada intento.
    try {
      const { getAppointmentsForDateMultiBranch } = await import('@/lib/actions/appointments')
      const rows = await getAppointmentsForDateMultiBranch(branchIds, getLocalDateStr(timezone))
      setTodayAppointments(rows)
    } catch (e) {
      console.warn('[fila] agenda del día:', e)
    }
  }, [selectedBranchId, branches, timezone])

  // Un fetch al montar (y al cambiar de sucursal) + el refresco de 60 s: dato de
  // baja frecuencia, sin Realtime (la DB ya se ahogó una vez por escuchar de más).
  useEffect(() => {
    const apptId = setTimeout(() => { fetchAppointments() }, 0)
    return () => clearTimeout(apptId)
  }, [fetchAppointments])

  useVisibilityRefresh(fetchAppointments, 60_000)

  useEffect(() => {
    // Las primeras llamadas van diferidas: nada de setState en el cuerpo del effect.
    const initId = setTimeout(() => {
      fetchQueue()
      fetchBarbers()
      fetchSchedules()
    }, 0)

    const channel = supabase
      .channel('admin-queue')
      // FIX #9: filtrado por organization_id, sin el fan-out de otras orgs (mig 124).
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queue_entries', filter: `organization_id=eq.${orgId}` }, () =>
        fetchQueue(),
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff', filter: `organization_id=eq.${orgId}` }, () =>
        fetchBarbers(),
      )
      // attendance_logs no está en la publicación de Realtime: horarios y
      // fichajes se refrescan al reconectar y con el refresco de 30 s.
      .subscribe((status) => {
        queueMicrotask(() => {
          if (status === 'SUBSCRIBED') {
            setConexion('en_vivo')
            fetchQueue()
            fetchBarbers()
            fetchSchedules()
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            setConexion('reconectando')
          }
        })
      })

    return () => { clearTimeout(initId); supabase.removeChannel(channel) }
  }, [supabase, fetchQueue, fetchBarbers, fetchSchedules, orgId])

  // Al volver a la pestaña, y cada 30 s como respaldo.
  useVisibilityRefresh(
    useCallback(() => {
      fetchQueue()
      fetchBarbers()
      fetchSchedules()
    }, [fetchQueue, fetchBarbers, fetchSchedules]),
    30_000,
  )

  useEffect(() => {
    // Cada 5 s: los minutos no necesitan más resolución.
    const interval = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    supabase
      .from('services')
      .select('*')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => { if (data) setServices(data as Service[]) })
  }, [supabase])

  // ── Lo que se ve ────────────────────────────────────────────────────────────

  const notClockedInBarbers = useMemo(() => {
    const s = new Set<string>()
    for (const b of liveBarbers) if (latestAttendance[b.id] !== 'clock_in') s.add(b.id)
    return s
  }, [liveBarbers, latestAttendance])

  const filteredBarbers = useMemo(
    () => (selectedBranchId ? liveBarbers.filter((b) => b.branch_id === selectedBranchId) : liveBarbers),
    [selectedBranchId, liveBarbers],
  )

  const branchEntries = useMemo(
    () => (selectedBranchId ? entries.filter((e) => e.branch_id === selectedBranchId) : entries),
    [entries, selectedBranchId],
  )

  /** Toda la fila de la sucursal, en orden de llegada (descansos pendientes incluidos). */
  const fila = useMemo(
    () => branchEntries.filter((e) => e.status === 'waiting').sort(porOrdenDeLlegada),
    [branchEntries],
  )

  const inProgressData = useMemo(() => {
    const map: Record<string, QueueEntry> = {}
    for (const e of branchEntries) if (e.status === 'in_progress' && e.barber_id) map[e.barber_id] = e
    return map
  }, [branchEntries])

  const nextAppointmentByBarber = useMemo(() => {
    // Los turnos "con cualquiera" (barber_id NULL) no se anuncian en ninguna
    // silla: recién se sabe quién los atiende al hacer el check-in.
    const byBarber: Record<string, Appointment[]> = {}
    for (const appointment of todayAppointments) {
      if (!appointment.barber_id) continue
      if (selectedBranchId && appointment.branch_id !== selectedBranchId) continue
      ;(byBarber[appointment.barber_id] ??= []).push(appointment)
    }
    const map: Record<string, NextAppointmentInfo> = {}
    for (const [barberId, list] of Object.entries(byBarber)) {
      const next = findNextAppointment(list, now, timezone)
      if (next) map[barberId] = next
    }
    return map
  }, [todayAppointments, selectedBranchId, now, timezone])

  const nombreServicio = useMemo(() => {
    const map = new Map(services.map((s) => [s.id, s.name]))
    return (id: string | null) => (id ? (map.get(id) ?? null) : null)
  }, [services])

  /**
   * Hora RESERVADA de cada turno del día. `priority_order` no sirve para saber si
   * a un turno le llegó la hora: en una entrada adoptada de un walk-in es la
   * hora de llegada (mig 170). Lo mismo que hace el panel del barbero.
   */
  const inicioPorTurno = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of todayAppointments) map.set(a.id, appointmentInstantMs(a.appointment_date, a.start_time, timezone))
    return map
  }, [todayAppointments, timezone])

  const inicioDeTurno = useCallback(
    (e: QueueEntry) => {
      const deLaAgenda = e.appointment_id ? inicioPorTurno.get(e.appointment_id) : undefined
      // Si el turno todavía no está en la agenda cargada (lo registró el
      // mostrador hace segundos), `priority_order` es la mejor aproximación.
      return deLaAgenda !== undefined && Number.isFinite(deLaAgenda) ? deLaAgenda : new Date(e.priority_order).getTime()
    },
    [inicioPorTurno],
  )
  const horaDeTurno = (e: QueueEntry) => formatHourMinute(inicioDeTurno(e), timezone)

  /**
   * En qué orden los va a atender su barbero: un turno cuya hora llegó va antes
   * que todos (camino [A] del motor) y el resto por llegada. Con el orden de
   * llegada pelado, el walk-in que llegó antes decía "sigue" y el motor le daba
   * la silla al del turno.
   */
  const ordenDeAtencion = useCallback(
    (a: QueueEntry, b: QueueEntry) => {
      const va = a.is_appointment && inicioDeTurno(a) <= now
      const vb = b.is_appointment && inicioDeTurno(b) <= now
      if (va !== vb) return va ? -1 : 1
      if (va && vb) return inicioDeTurno(a) - inicioDeTurno(b)
      return porOrdenDeLlegada(a, b)
    },
    [inicioDeTurno, now],
  )

  /** La fila de cada barbero (sin el pool), en orden de atención: de acá sale "sigue" / "2º". */
  const filaPorBarbero = useMemo(() => {
    const map: Record<string, QueueEntry[]> = {}
    for (const e of fila) {
      if (e.is_break || esDelPool(e) || !e.barber_id) continue
      ;(map[e.barber_id] ??= []).push(e)
    }
    for (const lista of Object.values(map)) lista.sort(ordenDeAtencion)
    return map
  }, [fila, ordenDeAtencion])

  const pool = useMemo(() => fila.filter((e) => !e.is_break && esDelPool(e)), [fila])

  /** La fila que espera en cada sucursal (en orden de llegada): el motor decide por sucursal. */
  const filaPorSucursal = useMemo(() => {
    const map = new Map<string, QueueEntry[]>()
    for (const e of fila) {
      const lista = map.get(e.branch_id)
      if (lista) lista.push(e)
      else map.set(e.branch_id, [e])
    }
    return map
  }, [fila])

  const soloTurnosSet = useMemo(() => new Set(soloTurnos), [soloTurnos])

  /**
   * El estado de cada silla y, en las libres, lo que haría el motor
   * (`decidirSilla`, `_tablero/motor.ts`): sugerir lo que `claim_next_for_barber`
   * no haría era adelantar un walk-in a un turno cuya hora ya llegó, o meterle un
   * corte a un barbero con un turno en 20 minutos.
   */
  const sillas = useMemo(() => {
    const hoy = fechaLocal(now, timezone)
    const esDeHoy = (iso: string) => !!iso && fechaLocal(iso, timezone) === hoy

    const base = filteredBarbers.map((barbero) => {
      const enCurso = inProgressData[barbero.id]
      const fichado = !notClockedInBarbers.has(barbero.id)
      const finDeTurno =
        fichado &&
        isBarberBlockedByShiftEnd(barbero as unknown as Staff, enCurso ? [enCurso] : [], schedules, now, shiftEndMargin)
      const estado: EstadoSilla = enCurso
        ? enCurso.is_break
          ? 'descanso'
          : 'cortando'
        : !fichado
          ? 'sin_entrada'
          : finDeTurno
            ? 'fin_de_turno'
            : 'libre'
      const suFila = filaPorBarbero[barbero.id] ?? []
      const descansoPendiente = fila.some((e) => e.is_break && e.barber_id === barbero.id)
      const decision: DecisionSilla | null =
        estado === 'libre'
          ? decidirSilla({
              barberoId: barbero.id,
              fila: filaPorSucursal.get(barbero.branch_id ?? '') ?? [],
              ahora: now,
              ventanaMinutos: ventanaPorSucursal[barbero.branch_id ?? ''] ?? protectionWindowMinutes(),
              soloTurnos: soloTurnosSet.has(barbero.id),
              proximoTurno: nextAppointmentByBarber[barbero.id],
              inicioDeTurno,
            })
          : null
      return {
        barbero,
        estado,
        enCurso,
        fichado,
        suFila,
        decision,
        siguiente: decision?.tipo === 'turno' ? decision.entry : (undefined as QueueEntry | undefined),
        // Sin fichar y sin nadie: va a la línea "No ficharon hoy", no a una silla.
        plegada: !fichado && !enCurso && suFila.length === 0 && !descansoPendiente,
      }
    })

    // Las que van por la fila (FIFO), en dos pasadas para que ninguna quede
    // ociosa mientras alguien espera:
    //  1. las que no tienen walk-ins propios toman a los de Menor espera, por llegada;
    //  2. las que sí, al que llegó antes entre su primero y el próximo de Menor
    //     espera que quede (el FIFO de `claim_next_for_barber`).
    // Un cliente de Menor espera se le sugiere a una sola silla.
    const tomados = new Set<string>()
    const fifo = base.filter((s) => s.decision?.tipo === 'fifo')
    const topeDe = (s: (typeof base)[number]) => (s.decision?.tipo === 'fifo' ? s.decision.tope : null)
    const propiosDe = (s: (typeof base)[number]) =>
      s.suFila.filter((e) => candidatoFifo(e, s.barbero.id, topeDe(s), esDeHoy))
    const delPoolPara = (s: (typeof base)[number]) =>
      (filaPorSucursal.get(s.barbero.branch_id ?? '') ?? []).find(
        (e) => esDelPool(e) && !tomados.has(e.id) && candidatoFifo(e, s.barbero.id, topeDe(s), esDeHoy),
      )
    for (const silla of fifo) {
      if (propiosDe(silla).length > 0) continue
      const delPool = delPoolPara(silla)
      if (delPool) {
        silla.siguiente = delPool
        tomados.add(delPool.id)
      }
    }
    for (const silla of fifo) {
      const propio = propiosDe(silla)[0]
      if (!propio) continue
      const delPool = delPoolPara(silla)
      silla.siguiente = delPool && porOrdenDeLlegada(delPool, propio) < 0 ? delPool : propio
      if (delPool && silla.siguiente === delPool) tomados.add(delPool.id)
    }

    return base.map((silla) => ({
      ...silla,
      siguienteDelPool: !!silla.siguiente && esDelPool(silla.siguiente),
    }))
  }, [
    filteredBarbers,
    inProgressData,
    notClockedInBarbers,
    schedules,
    now,
    shiftEndMargin,
    filaPorBarbero,
    fila,
    filaPorSucursal,
    ventanaPorSucursal,
    soloTurnosSet,
    nextAppointmentByBarber,
    inicioDeTurno,
    timezone,
  ])

  const estadoDe = useMemo(() => new Map(sillas.map((s) => [s.barbero.id, s])), [sillas])

  /**
   * El orden de la columna responde la pregunta del mostrador, "¿qué silla está
   * libre?": primero las libres con alguien para atender, después las libres,
   * las que cortan (las de más minutos arriba: son las próximas en liberarse),
   * los descansos y al final las que terminan turno o no ficharon. Dentro de
   * cada grupo, por nombre. Se congela mientras se arrastra algo, mientras el
   * mouse está sobre la columna y mientras el dedo está sobre el riel: una silla
   * que se corre bajo el puntero hace soltar (o tocar) en la equivocada.
   */
  const ordenSillas = useMemo(() => {
    const grupo = (estado: EstadoSilla, conAlguien: boolean) =>
      estado === 'libre' ? (conAlguien ? 0 : 1) : estado === 'cortando' ? 2 : estado === 'descanso' ? 3 : 4
    return sillas
      .map((s, i) => ({
        id: s.barbero.id,
        i,
        g: grupo(s.estado, !!s.siguiente),
        m: s.estado === 'cortando' ? minutosEnLaSilla(s.enCurso, now) : 0,
      }))
      .sort((a, b) => a.g - b.g || (a.g === 2 ? b.m - a.m : 0) || a.i - b.i)
      .map((x) => x.id)
  }, [sillas, now])

  /** Congela (o suelta) el orden de las sillas por un motivo; se suelta cuando no queda ninguno. */
  function congelarSillas(motivo: keyof typeof motivosCongelado.current, si: boolean) {
    const m = motivosCongelado.current
    const antes = m.arrastre || m.puntero || m.toque
    m[motivo] = si
    const despues = m.arrastre || m.puntero || m.toque
    if (!antes && despues) setOrdenCongelado(ordenSillas)
    else if (antes && !despues) setOrdenCongelado(null)
  }

  /** El dedo sobre el riel congela; al levantarlo, un instante más (el toque termina en un clic). */
  function tocandoElRiel(tocando: boolean) {
    if (toqueTimer.current) clearTimeout(toqueTimer.current)
    toqueTimer.current = null
    if (tocando) congelarSillas('toque', true)
    else toqueTimer.current = setTimeout(() => congelarSillas('toque', false), 700)
  }

  useEffect(
    () => () => {
      if (toqueTimer.current) clearTimeout(toqueTimer.current)
      if (aterrizajeTimer.current) clearTimeout(aterrizajeTimer.current)
      document.documentElement.removeAttribute('data-arrastrando')
    },
    [],
  )

  const clientesEsperando = fila.filter((e) => !e.is_break)
  const masLarga = clientesEsperando.reduce((max, e) => Math.max(max, minutosDesde(e.checked_in_at, now)), 0)
  const cortando = sillas.filter((s) => s.estado === 'cortando').length
  const libres = sillas.filter((s) => s.estado === 'libre').length
  const fichados = sillas.filter((s) => s.fichado).length
  const cortesHoy = selectedBranchId
    ? filteredBarbers.reduce((sum, b) => sum + (dailyServiceCounts[b.id] || 0), 0)
    : Object.values(dailyServiceCounts).reduce((a, b) => a + b, 0)

  // El filtro apunta a un barbero que ya no está (cambio de sucursal): se ve todo.
  const filtroVigente = filtro === 'todos' || filtro === POOL || estadoDe.has(filtro) ? filtro : 'todos'
  const visibles = useMemo(() => {
    if (filtroVigente === 'todos') return fila
    if (filtroVigente === POOL) return fila.filter((e) => !e.is_break && esDelPool(e))
    return fila.filter((e) => !esDelPool(e) && e.barber_id === filtroVigente)
  }, [fila, filtroVigente])

  // Su número en la fila de la sucursal: la llegada, contando sólo clientes.
  const numeroEnLaFila = useMemo(() => {
    const map = new Map<string, number>()
    let n = 0
    for (const e of fila) if (!e.is_break) map.set(e.id, ++n)
    return map
  }, [fila])

  const chips = useMemo(() => {
    const deBarberos = sillas
      .filter((s) => s.suFila.length > 0 || filtroVigente === s.barbero.id)
      .map((s) => ({ id: s.barbero.id, barbero: s.barbero, cantidad: s.suFila.length }))
    return deBarberos
  }, [sillas, filtroVigente])

  // ── Acciones ────────────────────────────────────────────────────────────────

  // La X (ahora "Sacar de la fila") pide confirmación para cualquier CLIENTE y
  // cancela directo sólo los descansos. Sacar a alguien de la fila es lo menos
  // reversible de esta pantalla: el cliente no se entera y sigue esperando.
  function handleCancel(entryId: string) {
    const entry = entries.find((e) => e.id === entryId)
    if (entry && !entry.is_break) {
      setCancelConfirmEntry(entry)
      return
    }
    doCancel(entryId)
  }

  // El dashboard es admin (Supabase Auth): `allowInProgress` habilita el override
  // del servidor. El panel del barbero llama sin el flag y conserva la protección.
  async function doCancel(entryId: string) {
    const entry = entries.find((e) => e.id === entryId)
    setActionLoading(entryId)
    try {
      const result = await cancelQueueEntry(entryId, { allowInProgress: true })
      if ('error' in result) toast.error(result.error)
      else
        toast.success(
          entry?.is_break
            ? 'Descanso cancelado'
            : entry?.status === 'in_progress'
              ? 'Corte cancelado'
              : `${nombreDePila(entry?.client?.name)} salió de la fila`,
        )
    } catch (e) {
      avisarAccionFallida(e, 'No pudimos sacarlo de la fila. Revisá la conexión y probá de nuevo.')
    } finally {
      await fetchQueue()
      setActionLoading(null)
    }
  }

  /**
   * «Solo asesoría» desde un corte en curso (mig 217): si se asesoró y no se
   * hizo nada, la entrada se cierra SIN visita (`cancel_reason = 'solo_asesoria'`),
   * no como un corte cancelado. La misma acción que el cobro le ofrece al barbero.
   */
  async function doCerrarSoloAsesoria(entryId: string) {
    setActionLoading(entryId)
    try {
      const r = await cerrarSoloAsesoria(entryId)
      if ('error' in r) {
        toast.error(r.error)
      } else {
        // Las fotos de ese corte no van a ninguna ficha: el servidor ya intentó
        // borrarlas y esto lo reintenta. El aviso del servidor se muestra recién
        // al terminar el reintento, y sólo si el reintento no lo resolvió.
        const avisoDelServidor = r.aviso
        if (avisoDelServidor) console.warn('[fila] cerrarSoloAsesoria con aviso (lo reintenta descartarFotosDelCobro):', avisoDelServidor)
        void descartarFotosDelCobro(entryId).then((descarte) => {
          if (avisoDelServidor && descarte.quitadas === 0 && descarte.fallidas === 0) {
            toast.warning(avisoDelServidor, { duration: 12000 })
          }
        })
        toast.success('Asesoría cerrada sin cobro', {
          description: r.yaCerrada
            ? 'Ya se había cerrado desde otro dispositivo.'
            : r.breakAutoStarted
              ? 'Arrancó el descanso pendiente del barbero.'
              : undefined,
        })
      }
    } catch (e) {
      avisarAccionFallida(e, 'No pudimos cerrar la asesoría. Revisá la conexión y probá de nuevo.')
    } finally {
      await fetchQueue()
      setActionLoading(null)
    }
  }

  /** Arranca el corte de `entry` con `barberId` (la silla libre o el elegido). */
  async function atenderCon(entry: QueueEntry, barberId: string) {
    const barbero = liveBarbers.find((b) => b.id === barberId)
    setActionLoading(entry.id)
    try {
      const result = await startService(entry.id, barberId)
      if ('error' in result) toast.error(result.error)
      else toast.success(barbero ? `Corte iniciado con ${nombreDePila(barbero.full_name)}` : 'Corte iniciado')
    } catch (e) {
      avisarAccionFallida(e, 'No pudimos iniciar el corte. Revisá la conexión y probá de nuevo.')
    } finally {
      await fetchQueue()
      setActionLoading(null)
    }
  }

  /**
   * Las sillas que pueden tomar a este walk-in YA por el camino del motor: libres,
   * de su sucursal, sin turno ni descanso que les toque antes, y con el cliente
   * anterior a su descanso pendiente.
   */
  const sillasParaWalkIn = (entry: QueueEntry) =>
    sillas.filter(
      (s) =>
        s.estado === 'libre' &&
        s.barbero.branch_id === entry.branch_id &&
        s.decision?.tipo === 'fifo' &&
        (s.decision.tope === null || new Date(entry.priority_order).getTime() < s.decision.tope),
    )

  function handleStartService(entry: QueueEntry) {
    // Del pool ("Menor espera"): con una sola silla que lo pueda tomar se arranca
    // con ese barbero (su cara está en el botón); si no, se elige en "¿Quién lo
    // atiende?", que muestra también a los que el motor frena y por qué.
    if (esDelPool(entry)) {
      const libres = sillasParaWalkIn(entry)
      if (libres.length === 1) void atenderCon(entry, libres[0].barbero.id)
      else setAsignarBarberoEntry(entry)
      return
    }
    if (entry.barber_id) void atenderCon(entry, entry.barber_id)
  }

  /** La silla que acaba de recibir a alguien se ilumina un momento. */
  function marcarAterrizaje(barberId: string) {
    if (aterrizajeTimer.current) clearTimeout(aterrizajeTimer.current)
    setAterrizaje(barberId)
    aterrizajeTimer.current = setTimeout(() => setAterrizaje(null), 1400)
  }

  /** Escribe barbero / Menor espera de una entrada, con la pantalla adelantada y vuelta atrás si falla. */
  async function escribirBarbero(entry: QueueEntry, barberId: string | null, dinamico: boolean): Promise<boolean> {
    const barbero = barberId ? liveBarbers.find((b) => b.id === barberId) : undefined
    const original = confirmedEntriesRef.current
    const actualizado = original.map((e) =>
      e.id === entry.id
        ? ({
            ...e,
            barber_id: barberId,
            is_dynamic: dinamico,
            barber: barbero ? { id: barbero.id, full_name: barbero.full_name, avatar_url: barbero.avatar_url ?? null } : null,
          } as QueueEntry)
        : e,
    )
    setEntries(actualizado)
    confirmedEntriesRef.current = actualizado
    try {
      const r = await updateQueueOrder([{ id: entry.id, position: entry.position, barber_id: barberId, is_dynamic: dinamico }])
      if ('error' in r) {
        toast.error(r.error)
        setEntries(original)
        confirmedEntriesRef.current = original
        return false
      }
      return true
    } catch (e) {
      avisarAccionFallida(e, 'No pudimos pasarlo. Revisá la conexión y probá de nuevo.')
      setEntries(original)
      confirmedEntriesRef.current = original
      return false
    }
  }

  /**
   * Pasa a alguien a esperar a otro barbero, o a Menor espera. Es un cambio de
   * BARBERO, no de lugar: conserva su hora de llegada (`priority_order` no se
   * toca), igual que soltarlo en la columna de otro barbero en el tablero viejo.
   * Los turnos no se pasan desde acá (su barbero vive en `appointments`) y un
   * descanso es de su barbero: no se le pasa a otro.
   */
  async function moverA(entry: QueueEntry, destino: string) {
    if (entry.is_appointment || entry.is_break) return
    const aPool = destino === POOL
    const nuevoBarbero = aPool ? null : destino
    if (aPool ? esDelPool(entry) : !esDelPool(entry) && entry.barber_id === nuevoBarbero) return

    const barbero = nuevoBarbero ? liveBarbers.find((b) => b.id === nuevoBarbero) : undefined
    if (barbero && barbero.branch_id !== entry.branch_id) {
      toast.error(`${nombreDePila(barbero.full_name)} es de otra sucursal`)
      return
    }
    // Para "Deshacer": cómo estaba (también la pista de un dinámico).
    const antes = { barberId: entry.barber_id, dinamico: entry.is_dynamic }
    const nombre = nombreDePila(entry.client?.name)
    if (!(await escribirBarbero(entry, nuevoBarbero, aPool))) return

    if (nuevoBarbero) marcarAterrizaje(nuevoBarbero)
    const lugar = nuevoBarbero ? lugarAlPasar(entry, filaPorBarbero[nuevoBarbero] ?? [], ordenDeAtencion) : 0
    toast.success(aPool ? `${nombre} pasó a Menor espera` : `${nombre} ahora espera a ${nombreDePila(barbero?.full_name)}`, {
      id: `mover-${entry.id}`,
      description: aPool ? 'Lo atiende el primero que se libere.' : lugar === 1 ? 'Es el que sigue.' : `Queda ${lugar}º en su fila.`,
      action: {
        label: 'Deshacer',
        onClick: () => {
          const ahora = confirmedEntriesRef.current.find((e) => e.id === entry.id)
          if (!ahora || ahora.status !== 'waiting') {
            toast.error(`${nombre} ya no está esperando: no se puede deshacer`)
            return
          }
          void escribirBarbero(ahora, antes.barberId, antes.dinamico).then((ok) => {
            if (ok) toast.success(`${nombre} volvió a donde estaba`, { id: `mover-${entry.id}` })
          })
        },
      },
    })
  }

  async function asignarDescanso(barberId: string, config: BreakConfig) {
    const barbero = liveBarbers.find((b) => b.id === barberId)
    const branchId = barbero?.branch_id || selectedBranchId || config.branch_id
    if (!branchId) return
    setActionLoading('creating-break')
    try {
      const result = await createBreakEntry(branchId, barberId, config.name)
      if ('error' in result) toast.error(result.error)
      else toast.success(`${config.name} asignado a ${nombreDePila(barbero?.full_name)}`)
    } catch (e) {
      avisarAccionFallida(e, 'No pudimos asignar el descanso. Probá de nuevo.')
    } finally {
      await fetchQueue()
      setActionLoading(null)
    }
  }

  /**
   * Reordenar la fila: SÓLO se le toca `priority_order` al arrastrado, metiéndolo
   * entre sus vecinos nuevos. Hasta el 4/9/2026 se reescribía la fila entera
   * (ver el historial de este archivo): se perdía el orden de llegada, se disparaba
   * con un temblor de 5 px y adelantaba a los rebaseados por encima de todo el
   * que hizo check-in después. `position` se renumera porque es orden de dibujo,
   * pero no decide la llegada de nadie. Los turnos no se tocan: su
   * `priority_order` es la hora RESERVADA.
   */
  function reordenar(activeId: string, overId: string) {
    const activeIdx = entries.findIndex((e) => e.id === activeId)
    if (activeIdx === -1) return
    const arrastrada = entries[activeIdx]

    let finalEntries = [...entries]
    if (activeId !== overId) {
      const overIdx = finalEntries.findIndex((e) => e.id === overId)
      if (overIdx !== -1) finalEntries = arrayMove(finalEntries, activeIdx, overIdx)
    }

    // El scope por sucursal es obligatorio: sin él, reordenar en la vista de
    // todas las sucursales renumeraba la fila de las cuatro a la vez.
    const branchIdDelDrag = selectedBranchId || arrastrada.branch_id
    const waitingItems = finalEntries.filter((e) => e.status === 'waiting' && e.branch_id === branchIdDelDrag)

    const updates: { id: string; position: number; barber_id?: string | null; is_dynamic?: boolean; priority_order?: string }[] = []

    const movedEntry = activeId !== overId ? waitingItems.find((e) => e.id === activeId) : undefined
    if (movedEntry && !movedEntry.is_appointment) {
      const prioridadDe = (e: QueueEntry) => new Date(e.priority_order).getTime()
      // Vecinos walk-in en el orden nuevo (los turnos no sirven de cota: su
      // `priority_order` es la hora reservada, no una llegada).
      const vecinos = waitingItems.filter((e) => !e.is_appointment && !isNaN(prioridadDe(e)))
      const idx = vecinos.findIndex((e) => e.id === movedEntry.id)
      const anterior = idx > 0 ? prioridadDe(vecinos[idx - 1]) : null
      const siguiente = idx >= 0 && idx < vecinos.length - 1 ? prioridadDe(vecinos[idx + 1]) : null

      let nuevaPrioridad: number
      if (anterior !== null && siguiente !== null) {
        nuevaPrioridad = Math.floor((anterior + siguiente) / 2)
        // Vecinos pegados al milisegundo: no hay punto medio. Se corre al de
        // adelante 1 ms; empujar a UNA entrada es mucho menos daño que rebasear.
        if (nuevaPrioridad <= anterior || nuevaPrioridad >= siguiente) {
          nuevaPrioridad = anterior + 1
          updates.push({
            id: vecinos[idx + 1].id,
            position: vecinos[idx + 1].position,
            priority_order: new Date(anterior + 2).toISOString(),
          })
        }
      } else if (siguiente !== null) {
        nuevaPrioridad = siguiente - 1000 // lo pusieron primero
      } else if (anterior !== null) {
        nuevaPrioridad = anterior + 1000 // lo pusieron último
      } else {
        nuevaPrioridad = prioridadDe(movedEntry) // era el único
      }

      updates.push({
        id: movedEntry.id,
        position: movedEntry.position,
        barber_id: movedEntry.barber_id,
        is_dynamic: movedEntry.is_dynamic,
        priority_order: new Date(nuevaPrioridad).toISOString(),
      })
    }

    waitingItems.forEach((entry, index) => {
      const newPos = index + 1
      const yaEnLista = updates.find((u) => u.id === entry.id)
      if (entry.is_appointment) {
        if (entry.position !== newPos) updates.push({ id: entry.id, position: newPos })
        return
      }
      if (yaEnLista) {
        yaEnLista.position = newPos
        return
      }
      if (entry.position !== newPos) updates.push({ id: entry.id, position: newPos })
    })

    if (updates.length === 0) {
      setEntries(finalEntries)
      return
    }

    const originalEntries = [...entries]
    const locallyUpdated = finalEntries.map((e) => {
      const update = updates.find((u) => u.id === e.id)
      return update ? { ...e, position: update.position, ...(update.priority_order && { priority_order: update.priority_order }) } : e
    })
    setEntries(locallyUpdated)
    // El ref se actualiza ya, para que dos arrastres seguidos no esperen a la base.
    confirmedEntriesRef.current = locallyUpdated

    // Sin bloquear: la pantalla ya cambió. Si la base no lo confirma, se vuelve atrás y se dice.
    updateQueueOrder(updates).then(
      (result) => {
        if ('error' in result) {
          toast.error(result.error)
          setEntries(originalEntries)
          confirmedEntriesRef.current = originalEntries
        }
      },
      (e: unknown) => {
        avisarAccionFallida(e, 'No pudimos guardar el nuevo orden de la fila. Probá de nuevo.')
        setEntries(originalEntries)
        confirmedEntriesRef.current = originalEntries
      },
    )
  }

  // ── Arrastrar y soltar ──────────────────────────────────────────────────────

  function handleDragStart(event: DragStartEvent) {
    const { active, activatorEvent } = event
    // El shell del dashboard cambia de sección deslizando el dedo de costado:
    // con esto sabe que el gesto es un arrastre (ver dashboard-shell.tsx).
    document.documentElement.setAttribute('data-arrastrando', '')
    congelarSillas('arrastre', true)
    setSobre(null)
    setSoltadoEnSilla(false)
    // En el celular, un toque corto de vibración: "lo agarraste".
    if (typeof TouchEvent !== 'undefined' && activatorEvent instanceof TouchEvent) navigator.vibrate?.(12)
    if (active.data.current?.isTemplate) {
      setDraggedTemplate(active.data.current.config as BreakConfig)
      return
    }
    const activeEntry = branchEntries.find((e) => e.id === active.id)
    if (activeEntry) setDraggedEntry(activeEntry)
  }

  function handleDragOver(event: DragOverEvent) {
    const data = event.over?.data.current
    setSobre(data?.type === 'Column' ? (data.columnId as string) : null)
  }

  function terminarArrastre() {
    setDraggedEntry(null)
    setDraggedTemplate(null)
    setSobre(null)
    congelarSillas('arrastre', false)
    // Al próximo tick: el `touchend` que soltó la tarjeta todavía tiene que
    // llegarle al shell con la marca puesta, para que no lo tome como un swipe.
    setTimeout(() => document.documentElement.removeAttribute('data-arrastrando'), 0)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    const overData = over?.data.current
    const destino = overData?.type === 'Column' ? (overData.columnId as string) : null
    // Se decide en este mismo render: la animación de soltar lee el prop ahora.
    setSoltadoEnSilla(!!destino)
    terminarArrastre()
    if (!over) return

    if (active.data.current?.isTemplate) {
      // Un descanso sólo se le asigna a un barbero (no a Menor espera).
      if (destino && destino !== POOL) void asignarDescanso(destino, active.data.current.config as BreakConfig)
      return
    }

    const entry = entries.find((e) => e.id === active.id)
    if (!entry) return
    if (destino) {
      void moverA(entry, destino)
      return
    }
    reordenar(String(active.id), String(over.id))
  }

  // ── Datos de cada renglón ───────────────────────────────────────────────────

  function destinosDe(entry: QueueEntry): DestinoFila[] {
    const lista: DestinoFila[] = []
    if (!esDelPool(entry)) lista.push({ id: POOL, nombre: 'Menor espera', nota: 'el primero libre' })
    for (const s of sillas) {
      if (s.barbero.branch_id !== entry.branch_id) continue
      if (!esDelPool(entry) && s.barbero.id === entry.barber_id) continue
      const nota =
        s.estado === 'libre' ? 'libre' : s.estado === 'cortando' ? 'cortando' : s.estado === 'descanso' ? 'en descanso' : s.estado === 'fin_de_turno' ? 'termina turno' : 'sin fichar'
      lista.push({ id: s.barbero.id, nombre: s.barbero.full_name, nota })
    }
    return lista
  }

  /**
   * Si la tarjeta muestra «Atender». Un turno se puede arrancar a mano con su
   * barbero libre (igual que «Iniciar turno» en el panel). Un walk-in, con las
   * reglas del motor: si a su barbero le toca un turno o el descanso, o un turno
   * próximo frena los walk-ins, el botón no está y el menú dice por qué. Con la
   * fila mandando sobre el fichaje, el que no fichó igual se puede elegir.
   */
  function atenderDe(entry: QueueEntry): { habilitado: boolean; motivo?: string; con?: BarberRow } {
    if (entry.is_break) return { habilitado: false }
    if (esDelPool(entry) || !entry.barber_id) {
      const libres = sillasParaWalkIn(entry)
      if (libres.length === 1) return { habilitado: true, con: libres[0].barbero }
      if (libres.length > 1) return { habilitado: true }
      // Ninguna silla lo toma ya: queda elegir en "¿Quién lo atiende?" entre las
      // que no están ocupadas (las que no ficharon o terminan turno, las que el
      // motor frena). Las plegadas en "No ficharon hoy" no cuentan.
      const elegibles = sillas.filter(
        (s) => s.barbero.branch_id === entry.branch_id && !s.plegada && s.estado !== 'cortando' && s.estado !== 'descanso',
      )
      return elegibles.length > 0
        ? { habilitado: true }
        : { habilitado: false, motivo: 'Todas las sillas de la sucursal están ocupadas' }
    }
    const silla = estadoDe.get(entry.barber_id)
    const nombre = nombreDePila(silla?.barbero.full_name ?? entry.barber?.full_name)
    if (silla?.estado === 'cortando') {
      return { habilitado: false, motivo: `${nombre} está atendiendo a ${nombreDePila(silla.enCurso?.client?.name)}` }
    }
    if (silla?.estado === 'descanso') return { habilitado: false, motivo: `${nombre} está en descanso` }
    const d = silla?.decision
    if (!entry.is_appointment && d) {
      if (d.tipo === 'descanso') return { habilitado: false, motivo: `A ${nombre} le toca el descanso: lo arranca su tablet` }
      if (d.tipo === 'turno') {
        return {
          habilitado: false,
          motivo: `Primero va el turno de las ${horaDeTurno(d.entry)} (${nombreDePila(d.entry.client?.name)})`,
        }
      }
      if (d.tipo === 'protegida') {
        return {
          habilitado: false,
          motivo: d.turno
            ? `${nombre} tiene turno a las ${d.turno.timeLabel}: no entra otro corte antes`
            : `${nombre} sólo atiende turnos`,
        }
      }
    }
    return { habilitado: true }
  }

  /** Por qué el motor no le daría un walk-in a esta silla libre (para "¿Quién lo atiende?"). */
  function notaDelMotor(s: (typeof sillas)[number]): string | null {
    const d = s.decision
    if (s.estado !== 'libre' || !d) return null
    if (d.tipo === 'descanso') return 'le toca el descanso'
    if (d.tipo === 'turno') return `turno ${horaDeTurno(d.entry)}`
    if (d.tipo === 'protegida') return d.turno ? `turno ${d.turno.timeLabel}` : 'sólo turnos'
    return null
  }

  /** Lo que muestra una silla libre sin nadie para atender cuando lo decide el motor. */
  function avisoDe(s: (typeof sillas)[number]): AvisoSilla | undefined {
    const d = s.decision
    if (s.estado !== 'libre' || !d) return undefined
    if (d.tipo === 'descanso') return { tono: 'descanso', texto: 'Le toca el descanso: lo arranca su tablet' }
    if (d.tipo === 'protegida') {
      return {
        tono: 'turno',
        texto: d.turno
          ? `No entra otro corte antes del turno de las ${d.turno.timeLabel}${d.turno.minutesUntil > 1 ? ` (en ${d.turno.minutesUntil} min)` : ''}`
          : 'Sólo atiende turnos',
      }
    }
    return undefined
  }

  /** Qué es cada silla para lo que está en la mano (null sin arrastre). */
  function soltarEn(s: (typeof sillas)[number]): SoltarEnSilla | null {
    if (draggedTemplate) {
      if (draggedTemplate.branch_id && s.barbero.branch_id !== draggedTemplate.branch_id) {
        return { acepta: false, texto: 'Otra sucursal' }
      }
      return {
        acepta: true,
        texto: `${draggedTemplate.name} de ${draggedTemplate.duration_minutes} min para ${nombreDePila(s.barbero.full_name)}`,
      }
    }
    if (!draggedEntry) return null
    // Un descanso pendiente sólo se reordena en la lista: es de su barbero.
    if (draggedEntry.is_break) return { acepta: false, texto: '' }
    if (s.barbero.branch_id !== draggedEntry.branch_id) return { acepta: false, texto: 'Otra sucursal' }
    if (!esDelPool(draggedEntry) && draggedEntry.barber_id === s.barbero.id) return { acepta: false, texto: 'Ya espera con él' }
    const lugar = lugarAlPasar(draggedEntry, filaPorBarbero[s.barbero.id] ?? [], ordenDeAtencion)
    return {
      acepta: true,
      texto: `${nombreDePila(draggedEntry.client?.name)} pasa a esperarlo · ${lugar === 1 ? 'es el que sigue' : `queda ${lugar}º`}`,
    }
  }

  const cancelarAsesoriaEnCurso =
    cancelConfirmEntry?.status === 'in_progress' &&
    cancelConfirmEntry.pidio_asesoria === true &&
    !cancelConfirmEntry.appointment_id &&
    !cancelConfirmEntry.is_break

  // Cliente del pool que se pasó desde el aviso de WhatsApp (mig 218): el
  // selector dice a quién esperaba, porque conservó su lugar en esa fila.
  const asignarViaWhatsApp = !!asignarBarberoEntry && esMovidaPorWhatsApp(asignarBarberoEntry)
  const asignarEsperabaA =
    asignarViaWhatsApp && asignarBarberoEntry?.menor_espera_barbero_original_id
      ? liveBarbers.find((b) => b.id === asignarBarberoEntry.menor_espera_barbero_original_id)?.full_name
      : undefined

  const descansosDe = (branchId: string | null) =>
    breakConfigs.filter((c) => (branchId ? c.branch_id === branchId : !selectedBranchId || c.branch_id === selectedBranchId))
  const descansosVisibles = breakConfigs.filter((c) => !selectedBranchId || c.branch_id === selectedBranchId)
  // Congelado, el orden guardado manda; las sillas que aparecieron después
  // (alguien fichó) van al final, y las que ya no están se caen.
  const ordenVisible = ordenCongelado
    ? [...ordenCongelado.filter((id) => estadoDe.has(id)), ...ordenSillas.filter((id) => !ordenCongelado.includes(id))]
    : ordenSillas
  const sillasOrdenadas = ordenVisible.map((id) => estadoDe.get(id)).filter((s): s is NonNullable<typeof s> => !!s)
  const sillasVisibles = sillasOrdenadas.filter((s) => !s.plegada)
  const plegadas = sillasOrdenadas.filter((s) => s.plegada)
  const sinFichar = plegadas.map((s) => s.barbero)
  // Arrastrando a un cliente (los turnos no se arrastran y un descanso sólo se
  // reordena): en el celular sube el dock de barberos.
  const arrastraAlguien = !!draggedEntry && !draggedEntry.is_break && !draggedEntry.is_appointment
  // Y si no está en Menor espera, el chip de Menor espera de la lista se vuelve
  // un lugar donde soltarlo.
  const arrastraCliente = arrastraAlguien && !!draggedEntry && !esDelPool(draggedEntry)
  const nivelMasLarga = nivelEspera(masLarga)
  const nombreDelFiltro =
    filtroVigente === POOL ? 'Menor espera' : filtroVigente !== 'todos' ? estadoDe.get(filtroVigente)?.barbero.full_name : undefined

  /** Lo que dice la tarjeta en la mano al pasar por una silla o por Menor espera. */
  const destinoEnLaMano: DestinoEnLaMano | null = (() => {
    if (!draggedEntry || draggedEntry.is_break || !sobre) return null
    if (sobre === POOL) return { texto: 'Menor espera · el primero que se libere' }
    const s = estadoDe.get(sobre)
    if (!s) return null
    const lugar = lugarAlPasar(draggedEntry, filaPorBarbero[sobre] ?? [], ordenDeAtencion)
    return {
      barbero: s.barbero,
      texto: `${nombreDePila(s.barbero.full_name)} · ${lugar === 1 ? 'es el que sigue' : `queda ${lugar}º`}`,
    }
  })()

  /** Los blancos del dock del celular: Menor espera (si no está ahí) y los barberos de su sucursal. */
  const destinosDelDock: DestinoDock[] = (() => {
    if (!arrastraAlguien || !draggedEntry) return []
    const delPool = esDelPool(draggedEntry)
    const lista: DestinoDock[] = delPool
      ? []
      : [{ columnId: POOL, nombre: 'Menor espera', nota: 'el primero libre', acepta: true }]
    for (const s of sillasVisibles) {
      if (s.barbero.branch_id !== draggedEntry.branch_id) continue
      // Un dinámico puede traer la pista de un barbero: no "está" con él.
      const yaEsta = !delPool && draggedEntry.barber_id === s.barbero.id
      const nota = yaEsta
        ? 'ya está acá'
        : s.estado === 'libre'
          ? 'libre'
          : s.estado === 'cortando'
            ? `cortando ${Math.round(minutosEnLaSilla(s.enCurso, now))}′`
            : s.estado === 'descanso'
              ? 'en descanso'
              : s.estado === 'fin_de_turno'
                ? 'termina turno'
                : 'sin fichar'
      lista.push({
        columnId: s.barbero.id,
        nombre: nombreDePila(s.barbero.full_name),
        barbero: s.barbero,
        estado: s.estado,
        nota,
        acepta: !yaEsta,
      })
    }
    return lista
  })()

  /** Lo que necesita una silla (la de la columna o la del riel del celular). */
  function propsDeSilla(s: (typeof sillas)[number]): SillaProps {
    const turno = s.siguiente?.is_appointment ? s.siguiente : undefined
    return {
      barbero: s.barbero,
      estado: s.estado,
      enCurso: s.enCurso,
      ahora: now,
      cortesHoy: dailyServiceCounts[s.barbero.id] || 0,
      enSuFila: s.suFila.length,
      siguiente: s.siguiente,
      siguienteDelPool: s.siguienteDelPool,
      siguienteTurno: turno ? { hora: horaDeTurno(turno), aTiempo: inicioDeTurno(turno) <= now } : undefined,
      aviso: avisoDe(s),
      proximoTurno: nextAppointmentByBarber[s.barbero.id],
      oculto: s.barbero.hidden_from_checkin,
      sinFichar: !s.fichado,
      descansos: descansosDe(s.barbero.branch_id),
      soltar: soltarEn(s),
      aterrizaje: aterrizaje === s.barbero.id,
      ocupadoId: actionLoading,
      onCobrar: setCompletingEntry,
      onAtender: (entry) => void atenderCon(entry, s.barbero.id),
      onCancelar: (entry) => handleCancel(entry.id),
      onDescanso: (config) => void asignarDescanso(s.barbero.id, config),
      onVerSuFila: () => setFiltro(filtroVigente === s.barbero.id ? 'todos' : s.barbero.id),
      filtrada: filtroVigente === s.barbero.id,
      hayFila: clientesEsperando.length > 0,
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={deteccionDelTablero}
      autoScroll={{ threshold: { x: 0, y: 0.12 }, canScroll: puedeScrollear }}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setSoltadoEnSilla(false)
        terminarArrastre()
        fetchQueue()
      }}
    >
      {/* La PC del mostrador queda en esta pantalla todo el día: después de un
          deploy se recarga sola cuando está ociosa. Ver src/lib/recarga-version.ts. */}
      <RecargaPorVersion superficie="panel" />

      <div className="flex flex-col gap-4 md:h-full md:min-h-0 md:flex-row">
        {/* ── La fila ─────────────────────────────────────────────────────── */}
        <section
          aria-labelledby="fila-titulo"
          className="flex min-h-[18rem] flex-col overflow-hidden rounded-2xl border border-border bg-card md:min-h-0 md:flex-1"
        >
          <header className="flex shrink-0 flex-col gap-3 border-b border-border px-4 pb-3 pt-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id="fila-titulo" className="flex items-baseline gap-2.5 text-lg font-semibold tracking-[-0.01em]">
                  Esperando
                  <span className="font-mono text-[1.625rem] leading-none tabular-nums">{clientesEsperando.length}</span>
                </h2>
                <p className="mt-1 text-[0.8125rem] text-muted-foreground">
                  {clientesEsperando.length === 0 ? (
                    'Nadie esperando ahora'
                  ) : (
                    <>
                      En orden de llegada · la espera más larga{' '}
                      <TextoEspera minutos={masLarga} className={cn('font-semibold', TEXTO_NIVEL[nivelMasLarga])} />
                    </>
                  )}
                </p>
                {/* Pasar clientes a los barberos arrastrando es la gracia de esta
                    pantalla: se dice cómo, distinto con mouse y con el dedo. */}
                {clientesEsperando.length > 0 && filteredBarbers.length > 0 && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground/80">
                    <GripVertical className="size-3.5 shrink-0" aria-hidden />
                    <span className="pointer-coarse:hidden">Arrastrá un cliente a la silla de un barbero para pasárselo</span>
                    <span className="hidden pointer-coarse:inline">Mantené apretado un cliente y soltalo en un barbero</span>
                  </p>
                )}
              </div>
              <EnVivo conexion={conexion} />
            </div>

            {/* Filtro: toda la fila, Menor espera o la de un barbero */}
            {(chips.length > 0 || pool.length > 0 || arrastraCliente) && (
              <div
                role="group"
                aria-label="Filtrar la fila"
                // El borde derecho se desvanece: avisa que hay más chips para deslizar.
                className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [mask-image:linear-gradient(to_right,#000_calc(100%-2.5rem),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                <ChipFiltro activo={filtroVigente === 'todos'} onClick={() => setFiltro('todos')} cantidad={clientesEsperando.length}>
                  Todos
                </ChipFiltro>
                {(pool.length > 0 || filtroVigente === POOL || arrastraCliente) && (
                  <ChipMenorEspera
                    activo={filtroVigente === POOL}
                    onClick={() => setFiltro(POOL)}
                    cantidad={pool.length}
                    destino={arrastraCliente}
                  />
                )}
                {chips.map((c) => (
                  <ChipFiltro key={c.id} activo={filtroVigente === c.id} onClick={() => setFiltro(c.id)} cantidad={c.cantidad}>
                    <FotoBarbero barbero={c.barbero} tamano="xs" className="size-5" />
                    {nombreDePila(c.barbero.full_name)}
                  </ChipFiltro>
                ))}
              </div>
            )}
          </header>

          <div
            ref={(el) => { zonas.current.lista = el }}
            className="@container min-h-0 flex-1 overflow-y-auto overscroll-contain"
          >
            {visibles.length === 0 ? (
              <FilaVacia
                filtrada={filtroVigente !== 'todos'}
                nombreDelFiltro={nombreDelFiltro}
                onVerTodo={() => setFiltro('todos')}
              />
            ) : (
              <SortableContext items={visibles.map((e) => e.id)} strategy={verticalListSortingStrategy}>
                <ol aria-label="Clientes esperando, en orden de llegada" className="flex flex-col gap-1.5 p-2 @lg:gap-2 @lg:p-3">
                  {visibles.map((entry, i) => {
                    const barbero = entry.barber_id ? estadoDe.get(entry.barber_id)?.barbero ?? liveBarbers.find((b) => b.id === entry.barber_id) : undefined
                    const suFila = !esDelPool(entry) && entry.barber_id ? filaPorBarbero[entry.barber_id] : undefined
                    const lugar = suFila ? suFila.indexOf(entry) + 1 || undefined : undefined
                    return (
                      <RenglonFila
                        key={entry.id}
                        entry={entry}
                        orden={numeroEnLaFila.get(entry.id) ?? 0}
                        ahora={now}
                        horaTurno={entry.is_appointment ? horaDeTurno(entry) : undefined}
                        servicio={nombreServicio(entry.service_id)}
                        barbero={barbero}
                        lugar={lugar}
                        sucursal={!selectedBranchId ? branches.find((b) => b.id === entry.branch_id)?.name : undefined}
                        esperabaA={
                          entry.menor_espera_barbero_original_id
                            ? liveBarbers.find((b) => b.id === entry.menor_espera_barbero_original_id)?.full_name
                            : undefined
                        }
                        atender={atenderDe(entry)}
                        onAtender={() => handleStartService(entry)}
                        destinos={destinosDe(entry)}
                        onMover={(d) => void moverA(entry, d)}
                        onSubir={i > 0 ? () => reordenar(entry.id, visibles[i - 1].id) : undefined}
                        onBajar={i < visibles.length - 1 ? () => reordenar(entry.id, visibles[i + 1].id) : undefined}
                        onSacar={() => handleCancel(entry.id)}
                        ocupado={actionLoading === entry.id}
                      />
                    )
                  })}
                </ol>
              </SortableContext>
            )}
          </div>
        </section>

        {/* ── Las sillas ──────────────────────────────────────────────────── */}
        <section
          ref={(el) => { zonas.current.sillas = el }}
          aria-labelledby="sillas-titulo"
          // Con el mouse encima, el orden de las sillas se queda quieto.
          onPointerEnter={(e) => { if (e.pointerType === 'mouse') congelarSillas('puntero', true) }}
          onPointerLeave={(e) => { if (e.pointerType === 'mouse') congelarSillas('puntero', false) }}
          className="flex min-w-0 flex-col gap-3 max-md:-order-1 md:min-h-0 md:w-[20rem] md:shrink-0 md:overflow-y-auto md:overscroll-contain md:pb-2 xl:w-[22rem]"
        >
          <header className="flex items-baseline justify-between gap-3 px-1">
            <h2 id="sillas-titulo" className="text-lg font-semibold tracking-[-0.01em]">
              Sillas
            </h2>
            <p className="text-[0.8125rem] text-muted-foreground">
              <span className="font-mono tabular-nums text-foreground/90">{cortando}</span> de{' '}
              <span className="font-mono tabular-nums">{fichados}</span> cortando
              {libres > 0 && (
                <>
                  {' '}· <span className="font-mono tabular-nums text-foreground/90">{libres}</span>{' '}
                  {libres === 1 ? 'libre' : 'libres'}
                </>
              )}
              {' '}· <span className="font-mono tabular-nums">{cortesHoy}</span> {cortesHoy === 1 ? 'corte' : 'cortes'} hoy
            </p>
          </header>

          {filteredBarbers.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              Esta sucursal no tiene barberos activos.
            </p>
          ) : (
            <>
              {/* Celular: un riel que se ve entero (los que no ficharon, al final) */}
              <RielDeSillas
                sillas={[...sillasVisibles, ...plegadas].map(propsDeSilla)}
                onTocando={tocandoElRiel}
                className="md:hidden"
              />

              {/* Escritorio: la columna, con cada silla como lugar donde soltar */}
              <div className="hidden flex-col gap-3 md:flex">
                {sillasVisibles.map((s) => (
                  <Silla key={s.barbero.id} {...propsDeSilla(s)} />
                ))}
              </div>
            </>
          )}

          <SinFichar barberos={sinFichar} className="hidden md:flex" />

          {/* Descansos para arrastrar a una silla (en el celular, desde el menú de cada una) */}
          <div className="hidden flex-wrap items-center gap-2 px-1 md:flex">
            {descansosVisibles.map((config) => (
              <FichaDescanso key={config.id} config={config} />
            ))}
            {descansosVisibles.length > 0 && <span className="text-xs text-muted-foreground">Arrastralo a una silla ·</span>}
            <Link
              href="/dashboard/equipo?tab=descansos"
              className="inline-flex items-center gap-1 rounded text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Settings2 className="size-3.5" aria-hidden />
              {descansosVisibles.length > 0 ? 'Configurar' : 'Sin descansos configurados · Configurar'}
            </Link>
          </div>
        </section>
      </div>

      {/* Celular: mientras se arrastra a un cliente, los barberos suben en un
          dock abajo (el riel de arriba queda fuera de la pantalla con la fila
          scrolleada). */}
      {arrastraAlguien && draggedEntry && (
        <DockSoltar
          nombreCliente={nombreDePila(draggedEntry.client?.name)}
          destinos={destinosDelDock}
          refZona={(el) => { zonas.current.dock = el }}
        />
      )}

      <DragOverlay
        dropAnimation={soltadoEnSilla ? animacionAlSoltarEnSilla : animacionAlSoltar}
        modifiers={MODIFICADORES_DE_LA_MANO}
      >
        {draggedEntry && <RenglonFantasma entry={draggedEntry} ahora={now} destino={destinoEnLaMano} />}
        {draggedTemplate && (
          <div className="pointer-events-none rotate-[2deg]">
            <FichaDescanso config={draggedTemplate} />
          </div>
        )}
      </DragOverlay>

      {completingEntry && (
        <CompleteServiceDialog
          entry={completingEntry}
          branchId={completingEntry.branch_id}
          onClose={() => setCompletingEntry(null)}
          onCompleted={async (resultado) => {
            setCompletingEntry(null)
            // La asesoría cerrada sin cobro, el cobro que ya estaba registrado y
            // el que no pudo guardar el importe los avisa el diálogo.
            if (hayQueAnunciarCobro(resultado)) toast.success('Corte finalizado')
            await fetchQueue()
          }}
        />
      )}

      {/* ¿Quién lo atiende? (cliente de Menor espera). Los que atienden ahora
          quedan deshabilitados —un segundo corte choca contra
          `idx_queue_one_in_progress_per_barber`— y los que no ficharon se
          marcan, pero se pueden elegir: la fila real manda sobre el fichaje. */}
      <AlertDialog open={!!asignarBarberoEntry} onOpenChange={(open) => { if (!open) setAsignarBarberoEntry(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Quién lo atiende?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{asignarBarberoEntry?.client?.name ?? 'El cliente'}</strong> eligió &ldquo;Menor espera&rdquo;, así
              que no tiene barbero asignado. Elegí uno para arrancar el corte.
              {asignarViaWhatsApp && (
                <>
                  {' '}Se pasó desde el aviso de WhatsApp
                  {asignarEsperabaA ? <>: esperaba a <strong>{asignarEsperabaA}</strong>.</> : '.'}
                </>
              )}
            </AlertDialogDescription>
            {/* Mig 217: el panel del barbero elegido le muestra el pedido al empezar. */}
            {asignarBarberoEntry?.pidio_asesoria && (
              <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <AsesoriaBadge tono="oscuro" />
                <span>Pidió asesoría: el barbero que elijas ve el aviso al empezar.</span>
              </p>
            )}
          </AlertDialogHeader>
          <div className="grid max-h-[45vh] gap-2 overflow-y-auto py-1">
            {sillas
              .filter((s) => !asignarBarberoEntry || s.barbero.branch_id === asignarBarberoEntry.branch_id)
              // Primero los que pueden atender ya, después los libres que el motor
              // frena (turno inminente, descanso) y los que no ficharon o terminan
              // turno —se pueden elegir igual, con el motivo a la vista— y al
              // final los ocupados.
              .map((s, i) => ({
                s,
                i,
                g:
                  s.estado === 'libre' && !notaDelMotor(s)
                    ? 0
                    : s.estado === 'cortando' || s.estado === 'descanso'
                      ? 2
                      : 1,
              }))
              .sort((a, b) => a.g - b.g || a.i - b.i)
              .map(({ s }) => {
                const ocupado = s.estado === 'cortando' || s.estado === 'descanso'
                const nota = notaDelMotor(s)
                const loEsperaba = asignarViaWhatsApp && asignarBarberoEntry?.menor_espera_barbero_original_id === s.barbero.id
                return (
                  <Button
                    key={s.barbero.id}
                    variant="outline"
                    disabled={ocupado || actionLoading === asignarBarberoEntry?.id}
                    className="h-auto justify-start gap-3 py-2.5 text-left"
                    onClick={() => {
                      const entry = asignarBarberoEntry
                      if (!entry) return
                      setAsignarBarberoEntry(null)
                      void atenderCon(entry, s.barbero.id)
                    }}
                  >
                    <FotoBarbero barbero={s.barbero} tamano="md" />
                    <span className="flex-1 truncate font-medium">
                      {s.barbero.full_name}
                      {loEsperaba && <span className="ml-1.5 text-xs font-normal text-sky-400">· lo esperaba</span>}
                    </span>
                    {s.estado === 'cortando' ? (
                      <span className="text-xs text-muted-foreground">atendiendo</span>
                    ) : s.estado === 'descanso' ? (
                      <span className="text-xs text-amber-300">en descanso</span>
                    ) : !s.fichado ? (
                      <span className="text-xs text-amber-500">sin fichar</span>
                    ) : nota ? (
                      <span className={cn('text-xs', s.decision?.tipo === 'descanso' ? 'text-amber-300' : 'text-violet-300')}>{nota}</span>
                    ) : (
                      <span className="text-xs font-semibold text-foreground">libre</span>
                    )}
                  </Button>
                )
              })}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!cancelConfirmEntry} onOpenChange={(open) => { if (!open) setCancelConfirmEntry(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {cancelConfirmEntry?.status === 'in_progress' ? '¿Cancelar un corte en curso?' : '¿Sacar al cliente de la fila?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {cancelConfirmEntry?.status === 'in_progress' ? (
                <>
                  <strong>{cancelConfirmEntry?.client?.name ?? 'El cliente'}</strong> ya está siendo atendido. Si lo cancelás,
                  ese corte <strong>no se va a cobrar ni registrar</strong> y saldrá de la fila.
                  {cancelarAsesoriaEnCurso && (
                    <>
                      {' '}Pidió asesoría: si se asesoró y no se hizo nada, cerralo como <strong>solo asesoría</strong> y
                      queda registrado así, no como un corte cancelado.
                    </>
                  )}
                </>
              ) : (
                <>
                  <strong>{cancelConfirmEntry?.client?.name ?? 'El cliente'}</strong> queda marcado como ausente y sale de la
                  fila. Si todavía está en el local <strong>no se va a enterar</strong>: va a seguir esperando un turno que ya
                  no existe y va a tener que anotarse de nuevo.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            {cancelarAsesoriaEnCurso && (
              <AlertDialogAction
                variant="outline"
                onClick={() => {
                  const id = cancelConfirmEntry?.id
                  setCancelConfirmEntry(null)
                  if (id) void doCerrarSoloAsesoria(id)
                }}
              >
                <MessageCircleQuestionMark className="text-fuchsia-300" aria-hidden />
                Cerrar como solo asesoría
              </AlertDialogAction>
            )}
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const id = cancelConfirmEntry?.id
                setCancelConfirmEntry(null)
                if (id) doCancel(id)
              }}
            >
              {cancelConfirmEntry?.status === 'in_progress' ? 'Sí, cancelar corte' : 'Sí, sacarlo de la fila'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DndContext>
  )
}

// ─── Piezas chicas ────────────────────────────────────────────────────────────

/** Si el tablero está recibiendo los cambios en vivo (Realtime) o no. */
function EnVivo({ conexion }: { conexion: Conexion }) {
  const texto = conexion === 'en_vivo' ? 'En vivo' : conexion === 'reconectando' ? 'Reconectando…' : 'Conectando…'
  return (
    <span
      role="status"
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
        conexion === 'en_vivo'
          ? 'border-emerald-500/30 text-emerald-300'
          : conexion === 'reconectando'
            ? 'border-amber-500/40 text-amber-300'
            : 'border-border text-muted-foreground',
      )}
    >
      <span className="relative flex size-2" aria-hidden>
        <span
          className={cn(
            'relative inline-flex size-2 rounded-full',
            conexion === 'en_vivo' ? 'bg-emerald-400' : conexion === 'reconectando' ? 'bg-amber-400' : 'bg-muted-foreground',
          )}
        />
      </span>
      {texto}
    </span>
  )
}

function ChipFiltro({
  activo,
  onClick,
  cantidad,
  children,
}: {
  activo: boolean
  onClick: () => void
  cantidad: number
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={cn(
        'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[0.8125rem] font-medium outline-none transition-colors',
        'focus-visible:ring-2 focus-visible:ring-ring',
        activo
          ? 'border-foreground bg-foreground text-background'
          : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground',
      )}
    >
      {children}
      <span className={cn('font-mono tabular-nums', activo ? 'text-background/70' : 'text-muted-foreground')}>{cantidad}</span>
    </button>
  )
}

/**
 * El chip de Menor espera: filtra la fila y, mientras se arrastra a un cliente,
 * es el lugar donde soltarlo para que lo atienda el primero que se libere. Está
 * siempre a la vista (en el encabezado de la lista) y no corre nada al aparecer.
 */
function ChipMenorEspera({
  activo,
  onClick,
  cantidad,
  destino,
}: {
  activo: boolean
  onClick: () => void
  cantidad: number
  destino: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id: POOL, data: { type: 'Column', columnId: POOL, zona: 'lista' }, disabled: !destino })
  if (destino) {
    return (
      <span
        ref={setNodeRef}
        className={cn(
          'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border-2 border-dashed px-3 text-[0.8125rem] font-semibold transition-colors',
          isOver ? 'border-sky-300 bg-sky-500/25 text-sky-100' : 'border-sky-400/60 text-sky-300',
        )}
      >
        <span className="size-2 rounded-full bg-sky-400" aria-hidden />
        {isOver ? 'Soltá: Menor espera' : 'Soltalo acá: Menor espera'}
      </span>
    )
  }
  return (
    <span ref={setNodeRef} className="inline-flex shrink-0">
      <ChipFiltro activo={activo} onClick={onClick} cantidad={cantidad}>
        <span className="size-2 rounded-full bg-sky-400" aria-hidden />
        Menor espera
      </ChipFiltro>
    </span>
  )
}

function FilaVacia({
  filtrada,
  nombreDelFiltro,
  onVerTodo,
}: {
  filtrada: boolean
  nombreDelFiltro?: string
  onVerTodo: () => void
}) {
  return (
    <div className="flex h-full min-h-[14rem] flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Users className="size-5" aria-hidden />
      </span>
      {filtrada ? (
        <>
          <p className="text-[0.9375rem] font-medium">Nadie espera {nombreDelFiltro === 'Menor espera' ? 'en Menor espera' : `con ${nombreDelFiltro ?? 'este barbero'}`}</p>
          <Button variant="outline" size="sm" onClick={onVerTodo}>
            Ver toda la fila
          </Button>
        </>
      ) : (
        <>
          <p className="text-[0.9375rem] font-medium">No hay nadie esperando</p>
          <p className="max-w-xs text-[0.8125rem] text-muted-foreground">
            Los que se anotan en la tablet aparecen acá al instante, en orden de llegada. Para anotar a alguien desde acá,
            usá «Anotar cliente».
          </p>
        </>
      )}
    </div>
  )
}
