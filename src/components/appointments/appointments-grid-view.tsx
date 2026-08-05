'use client'

import * as React from 'react'
import { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import Image from 'next/image'
import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  DragOverlay,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { cn } from '@/lib/utils'
import { AlertTriangle, ArrowRight, Check, Loader2, Undo2, UserX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Appointment, AppointmentStatus, AppointmentBlock } from '@/lib/types/database'
import { toDateStr, todayDateStr } from '@/lib/time-utils'

export interface GridBarber {
  id: string
  full_name: string
  avatar_url: string | null
  /** Días con jornada cargada (0=domingo .. 6=sábado). */
  days?: number[]
  /** Extremos de la jornada, "HH:mm". Fuera de esa franja la columna se raya. */
  works_from?: string | null
  works_to?: string | null
  /**
   * El barbero no tiene jornada cargada para el día que se está mirando. Su
   * columna se dibuja igual (si no, sus turnos ya cargados desaparecerían) pero
   * entera rayada: el motor de disponibilidad lo saltea, así que ahí no se va a
   * poder reservar nada nuevo.
   */
  sinHorario?: boolean
  /**
   * Columna sintética: el barbero no vino en la lista `barbers` (lo dieron de
   * baja, lo sacaron de `appointment_staff`, cambió de sucursal) pero TIENE
   * turnos cargados ese día. La arma la propia grilla; existe sólo para que
   * esos turnos se vean, porque siguen ocupando el horario por la EXCLUSION
   * GiST. No acepta turnos nuevos ni recibe drops.
   */
  fueraDeAgenda?: boolean
}

export interface GridSlotSelection {
  barberId: string
  time: string  // "HH:mm"
}

/** Densidad de la grilla. El alto se resuelve en píxeles por minuto, no en filas. */
export type ZoomLevel = 'compacta' | 'normal' | 'amplia'

export interface GridMovePropuesto {
  appointmentId: string
  newBarberId: string
  newTime: string
}

interface Props {
  date: string
  barbers: GridBarber[]
  appointments: Appointment[]
  blocks?: AppointmentBlock[]
  /** Snap real de inicio de turno (`appointment_settings.slot_interval_minutes`). */
  slotInterval: number
  hoursOpen: string
  hoursClose: string
  zoom?: ZoomLevel
  onSlotClick?: (barberId: string, time: string) => void
  onAppointmentClick?: (appointment: Appointment) => void
  /** Sólo se llama cuando el usuario confirma el movimiento en la barra inferior. */
  onAppointmentMove?: (args: GridMovePropuesto) => Promise<{ error?: string } | void>
  onAppointmentResize?: (args: {
    appointmentId: string
    newDurationMinutes: number
  }) => Promise<{ error?: string } | void>
  selected?: { appointmentId?: string; slot?: GridSlotSelection }
  className?: string
}

const STATUS_STYLES: Record<AppointmentStatus, string> = {
  pending_payment: 'bg-amber-500/70 text-white border-amber-600',
  confirmed:   'bg-blue-500/90 text-white border-blue-600',
  checked_in:  'bg-amber-500/90 text-white border-amber-600',
  in_progress: 'bg-emerald-500/90 text-white border-emerald-600',
  completed:   'bg-slate-400/80 text-white border-slate-500',
  cancelled:   'bg-red-400/60 text-white border-red-500 line-through opacity-70',
  no_show:     'bg-red-500/80 text-white border-red-600',
}

/**
 * Píxeles por minuto. Todo el layout del cuerpo se deriva de acá: la grilla no
 * tiene filas. Con filas de alto fijo, un snap de 45 minutos (el que tiene
 * Monaco configurado) contra filas de 30 dejaba cada turno a media fila.
 */
const PX_POR_MINUTO: Record<ZoomLevel, number> = {
  compacta: 0.9,
  normal: 1.5,
  amplia: 2.4,
}

const ANCHO_GUTTER = 64
const ALTO_HEADER = 44
const ANCHO_MIN_COLUMNA = 150
/** Alto mínimo dibujable de una tarjeta: garantiza que siempre quede clickeable. */
const ALTO_MIN_TARJETA = 18

const RAYADO_FUERA_HORARIO =
  'repeating-linear-gradient(-45deg, rgba(148,163,184,0.16) 0 5px, transparent 5px 11px)'
const RAYADO_BLOQUEO =
  'repeating-linear-gradient(-45deg, rgba(244,63,94,0.22) 0 5px, transparent 5px 11px)'

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function minutesToTime(m: number): string {
  const total = ((m % 1440) + 1440) % 1440
  const h = Math.floor(total / 60)
  const mm = total % 60
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/**
 * Minuto del día de un instante ISO, referido a la fecha que se está mirando.
 * Un bloqueo que arranca el día anterior (o termina al siguiente) se recorta a
 * los extremos en vez de aparecer en un horario inventado.
 */
function instanteAMinutos(iso: string, fechaGrilla: string): number {
  const d = new Date(iso)
  const dia = toDateStr(d)
  if (dia < fechaGrilla) return Number.NEGATIVE_INFINITY
  if (dia > fechaGrilla) return Number.POSITIVE_INFINITY
  return d.getHours() * 60 + d.getMinutes()
}

interface Colocacion {
  appointment: Appointment
  inicioMin: number
  finMin: number
  lane: number
  lanes: number
  propuesta: boolean
}

/**
 * Reparte los turnos de una columna en carriles cuando se superponen. La
 * EXCLUSION GiST sólo protege los estados activos, así que un `completed` y un
 * `confirmed` pueden pisarse: sin carriles, uno de los dos queda invisible.
 */
function repartirEnCarriles(items: Omit<Colocacion, 'lane' | 'lanes'>[]): Colocacion[] {
  const ordenados = [...items].sort(
    (a, b) => a.inicioMin - b.inicioMin || a.finMin - b.finMin,
  )
  const salida: Colocacion[] = []
  let grupo: Omit<Colocacion, 'lane' | 'lanes'>[] = []
  let finGrupo = Number.NEGATIVE_INFINITY

  const cerrarGrupo = () => {
    if (!grupo.length) return
    const finPorCarril: number[] = []
    const conCarril = grupo.map(item => {
      let lane = finPorCarril.findIndex(fin => fin <= item.inicioMin)
      if (lane === -1) {
        lane = finPorCarril.length
        finPorCarril.push(item.finMin)
      } else {
        finPorCarril[lane] = item.finMin
      }
      return { ...item, lane }
    })
    for (const item of conCarril) salida.push({ ...item, lanes: finPorCarril.length })
    grupo = []
    finGrupo = Number.NEGATIVE_INFINITY
  }

  for (const item of ordenados) {
    if (grupo.length && item.inicioMin >= finGrupo) cerrarGrupo()
    grupo.push(item)
    finGrupo = Math.max(finGrupo, item.finMin)
  }
  cerrarGrupo()
  return salida
}

/** Celda invisible que recibe el drop y captura el click en un hueco libre. */
function SlotDroppable({
  barberId,
  time,
  topPx,
  altoPx,
  bloqueado,
  seleccionado,
  onClick,
}: {
  barberId: string
  time: string
  topPx: number
  altoPx: number
  bloqueado: boolean
  seleccionado: boolean
  onClick?: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `slot:${barberId}:${time}`,
    data: { barberId, time },
    disabled: bloqueado,
  })

  return (
    <div
      ref={setNodeRef}
      onClick={bloqueado ? undefined : onClick}
      role={onClick && !bloqueado ? 'button' : undefined}
      aria-label={onClick && !bloqueado ? `Reservar a las ${time}` : undefined}
      className={cn(
        'absolute inset-x-0 transition-colors',
        onClick && !bloqueado && 'cursor-pointer hover:bg-primary/10',
        isOver && !bloqueado && 'bg-primary/20 ring-1 ring-inset ring-primary',
        seleccionado && 'bg-primary/10 ring-1 ring-inset ring-primary',
        bloqueado && 'cursor-not-allowed',
      )}
      style={{ top: topPx, height: altoPx }}
    />
  )
}

/** El turno cae antes de la apertura o después del cierre que dibuja la grilla. */
type FueraDeGrilla = 'antes' | 'despues' | null

function TarjetaTurno({
  appointment,
  compacto,
  fueraDeGrilla = null,
}: {
  appointment: Appointment
  compacto: boolean
  fueraDeGrilla?: FueraDeGrilla
}) {
  return (
    <>
      <div className="flex items-center gap-1 font-semibold leading-tight">
        {fueraDeGrilla && <AlertTriangle className="size-3 shrink-0" />}
        <span className="font-mono">{appointment.start_time.slice(0, 5)}</span>
        <span className="truncate">{appointment.client?.name ?? 'Cliente'}</span>
      </div>
      {!compacto && appointment.service?.name && (
        <div className="truncate leading-tight opacity-90">{appointment.service.name}</div>
      )}
    </>
  )
}

function TurnoDraggable({
  colocacion,
  topPx,
  altoPx,
  seleccionado,
  arrastrable,
  fueraDeGrilla = null,
  onClick,
  onResizeStart,
}: {
  colocacion: Colocacion
  topPx: number
  altoPx: number
  seleccionado: boolean
  arrastrable: boolean
  fueraDeGrilla?: FueraDeGrilla
  onClick?: () => void
  onResizeStart?: (e: React.PointerEvent) => void
}) {
  const { appointment, lane, lanes, propuesta } = colocacion
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `appt:${appointment.id}`,
    data: { appointmentId: appointment.id, duration: appointment.duration_minutes },
    disabled: !arrastrable,
  })

  const anchoPct = 100 / lanes
  const compacto = altoPx < 34

  return (
    <div
      ref={setNodeRef}
      {...(arrastrable ? attributes : {})}
      {...(arrastrable ? listeners : {})}
      onClick={(e) => {
        if (isDragging) return
        e.stopPropagation()
        onClick?.()
      }}
      title={fueraDeGrilla
        ? `Este turno (${appointment.start_time.slice(0, 5)} a ${appointment.end_time.slice(0, 5)}) queda ${fueraDeGrilla === 'antes' ? 'antes de la apertura' : 'después del cierre'} que muestra la agenda. Se dibuja pegado al borde para que no desaparezca.`
        : undefined}
      className={cn(
        'absolute z-10 overflow-hidden rounded-md border-l-2 px-1.5 py-0.5 text-left text-[11px] shadow-sm',
        arrastrable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
        STATUS_STYLES[appointment.status],
        seleccionado && 'ring-2 ring-ring ring-offset-1',
        propuesta && 'border border-dashed border-white/80 opacity-80 ring-2 ring-primary',
        // Borde punteado del lado por el que el turno se sale de la grilla.
        fueraDeGrilla === 'antes' && 'border-t-2 border-dashed border-t-white/90',
        fueraDeGrilla === 'despues' && 'border-b-2 border-dashed border-b-white/90',
        isDragging && 'opacity-0',
      )}
      style={{
        top: topPx + 1,
        height: Math.max(16, altoPx - 2),
        left: `calc(${lane * anchoPct}% + 2px)`,
        width: `calc(${anchoPct}% - 4px)`,
      }}
    >
      <TarjetaTurno appointment={appointment} compacto={compacto} fueraDeGrilla={fueraDeGrilla} />
      {altoPx > 52 && appointment.payment_status === 'paid' && (
        <div className="truncate text-[10px] opacity-80">Pagado</div>
      )}
      {appointment.source === 'manual' && (
        <span
          className="absolute right-1 top-1 size-1.5 rounded-full bg-white/70"
          title="Cargado a mano"
        />
      )}
      {onResizeStart && altoPx > 24 && !propuesta && (
        <div
          onPointerDown={(e) => {
            e.stopPropagation()
            onResizeStart(e)
          }}
          className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize hover:bg-white/30"
          aria-label="Redimensionar"
        />
      )}
    </div>
  )
}

export function AppointmentsGridView({
  barbers,
  appointments,
  blocks = [],
  slotInterval,
  hoursOpen,
  hoursClose,
  zoom = 'normal',
  onSlotClick,
  onAppointmentClick,
  onAppointmentMove,
  onAppointmentResize,
  selected,
  className,
  date,
}: Props) {
  const pxPorMinuto = PX_POR_MINUTO[zoom] ?? PX_POR_MINUTO.normal
  const openMin = timeToMinutes(hoursOpen.slice(0, 5))
  const closeMinCrudo = timeToMinutes(hoursClose.slice(0, 5))
  // Un cierre "00:00" es medianoche del día siguiente, no las 0 del mismo día.
  const closeMin = closeMinCrudo <= openMin ? 24 * 60 : closeMinCrudo
  const totalMin = closeMin - openMin
  const altoCuerpo = Math.round(totalMin * pxPorMinuto)
  const snap = Number.isFinite(slotInterval) && slotInterval > 0 ? Math.round(slotInterval) : 15

  const minutosAPx = useCallback(
    (min: number) => (min - openMin) * pxPorMinuto,
    [openMin, pxPorMinuto],
  )

  /** Recorta una coordenada vertical al cuerpo de la grilla. */
  const clampPx = useCallback(
    (px: number) => Math.min(Math.max(px, 0), altoCuerpo),
    [altoCuerpo],
  )

  /**
   * Rectángulo dibujable de un turno, recortado al cuerpo de la grilla.
   *
   * `minutosAPx` es lineal y sin límites: un turno que empieza antes de la
   * apertura da un `top` NEGATIVO —queda debajo del encabezado sticky, fuera
   * del área scrolleable, invisible e inclickeable— y uno que termina después
   * del cierre se dibuja más abajo del alto del cuerpo. No es hipotético:
   * alcanza con mover el horario de apertura/cierre en Configuración, que
   * guarda sin mirar los turnos ya agendados.
   *
   * Un turno que existe sigue ocupando el horario por la EXCLUSION GiST, así
   * que esconderlo es la peor salida posible: se recorta contra el borde y se
   * marca como "fuera de horario" (`fuera`), pero se dibuja SIEMPRE.
   */
  const rectTurno = useCallback(
    (inicioMin: number, finMin: number) => {
      const topMax = Math.max(0, altoCuerpo - ALTO_MIN_TARJETA)
      const top = Math.min(Math.max(minutosAPx(inicioMin), 0), topMax)
      const fin = Math.max(clampPx(minutosAPx(finMin)), top + ALTO_MIN_TARJETA)
      const fuera: FueraDeGrilla =
        inicioMin < openMin ? 'antes' : finMin > closeMin ? 'despues' : null
      return { top, alto: fin - top, fuera }
    },
    [minutosAPx, clampPx, altoCuerpo, openMin, closeMin],
  )

  /**
   * Columnas efectivas. `barbers` es lo que el caller quiere mostrar; acá se le
   * suma una columna por cada barbero que TIENE turnos ese día y no está en esa
   * lista (lo dieron de baja, lo sacaron de `appointment_staff`, lo pasaron a
   * otra sucursal).
   *
   * Antes esos turnos se descartaban en silencio —`colocacionPorBarbero`
   * saltea todo `barber_id` sin columna—, así que desaparecían de la pantalla
   * aunque siguieran existiendo y bloqueando el horario por la EXCLUSION GiST.
   * El invariante de esta grilla es que un turno que existe SIEMPRE se ve; si
   * un caller nuevo arma mal su lista de barberos, se le nota, no se le
   * esconden turnos.
   */
  const columnas = useMemo<GridBarber[]>(() => {
    const conocidos = new Set(barbers.map(b => b.id))
    const faltantes = new Map<string, string>()
    for (const a of appointments) {
      if (!a.barber_id || conocidos.has(a.barber_id) || faltantes.has(a.barber_id)) continue
      // El nombre sale del embed del propio turno: cuando el barbero ya no
      // viene en `barbers`, es la única fuente que queda.
      faltantes.set(a.barber_id, a.barber?.full_name ?? 'Barbero dado de baja')
    }
    if (!faltantes.size) return barbers
    return [
      ...barbers,
      ...[...faltantes].map(([id, full_name]) => ({
        id,
        full_name,
        avatar_url: null,
        days: [],
        works_from: null,
        works_to: null,
        sinHorario: true,
        fueraDeAgenda: true,
      })),
    ]
  }, [barbers, appointments])

  // ─── Grilla visual: línea marcada en la hora, tenue en la media ────
  const lineas = useMemo(() => {
    const out: { min: number; enPunto: boolean }[] = []
    const primera = Math.ceil(openMin / 30) * 30
    for (let m = primera; m < closeMin; m += 30) {
      out.push({ min: m, enPunto: m % 60 === 0 })
    }
    return out
  }, [openMin, closeMin])

  /**
   * Etiqueta en CADA hora en punto. Antes se imprimía una de cada dos filas y,
   * con el auto-placement roto, terminaba viéndose una sola en toda la grilla.
   */
  const etiquetas = useMemo(() => {
    const out: number[] = []
    if (openMin % 60 !== 0) out.push(openMin)
    const primera = Math.ceil(openMin / 60) * 60
    for (let m = primera; m < closeMin; m += 60) out.push(m)
    return out
  }, [openMin, closeMin])

  // Slots de drop/click, alineados al snap real de la configuración.
  const slots = useMemo(() => {
    const out: { time: string; min: number; alto: number }[] = []
    for (let m = openMin; m < closeMin; m += snap) {
      out.push({
        time: minutesToTime(m),
        min: m,
        alto: Math.min(snap, closeMin - m) * pxPorMinuto,
      })
    }
    return out
  }, [openMin, closeMin, snap, pxPorMinuto])

  // ─── Bloqueos por barbero ──────────────────────────────────────────
  const bloqueosPorBarbero = useMemo(() => {
    const map = new Map<string, { inicio: number; fin: number; motivo: string | null }[]>()
    for (const barber of columnas) map.set(barber.id, [])
    for (const b of blocks) {
      const inicio = Math.max(openMin, instanteAMinutos(b.start_at, date))
      const fin = Math.min(closeMin, instanteAMinutos(b.end_at, date))
      if (!(fin > inicio)) continue
      for (const barber of columnas) {
        // Org-wide (branch_id null), de toda la sucursal (barber_id null) o del barbero.
        const aplica = b.branch_id === null || b.barber_id === null || b.barber_id === barber.id
        if (!aplica) continue
        map.get(barber.id)!.push({ inicio, fin, motivo: b.reason })
      }
    }
    return map
  }, [blocks, columnas, openMin, closeMin, date])

  const slotBloqueado = useCallback(
    (barberId: string, min: number) =>
      (bloqueosPorBarbero.get(barberId) ?? []).some(r => min >= r.inicio && min < r.fin),
    [bloqueosPorBarbero],
  )

  // ─── Movimiento propuesto (pendiente de confirmación) ──────────────
  const [pendiente, setPendiente] = useState<{
    appointmentId: string
    origenBarberId: string | null
    origenTime: string
    destinoBarberId: string
    destinoTime: string
  } | null>(null)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (!pendiente || guardando) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPendiente(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pendiente, guardando])

  /**
   * Turno de la propuesta. Si desapareció del listado (lo cancelaron, lo
   * movieron a otro día desde otra pantalla) queda en null y toda la UI de la
   * propuesta se apaga sola — por eso nada se guarda contra un `pendiente`
   * huérfano sin necesidad de limpiarlo desde un efecto.
   */
  const apptPendiente = useMemo(
    () => (pendiente ? appointments.find(a => a.id === pendiente.appointmentId) ?? null : null),
    [pendiente, appointments],
  )

  // ─── Colocación de los turnos en cada columna ──────────────────────
  const [duracionEnResize, setDuracionEnResize] = useState<Record<string, number>>({})

  const colocacionPorBarbero = useMemo(() => {
    const porBarbero = new Map<string, Omit<Colocacion, 'lane' | 'lanes'>[]>()
    for (const barber of columnas) porBarbero.set(barber.id, [])

    for (const a of appointments) {
      const movido = pendiente?.appointmentId === a.id ? pendiente : null
      const barberId = movido ? movido.destinoBarberId : a.barber_id
      if (!barberId || !porBarbero.has(barberId)) continue

      const inicioMin = timeToMinutes(movido ? movido.destinoTime : a.start_time.slice(0, 5))
      const duracion =
        duracionEnResize[a.id] ??
        Math.max(5, timeToMinutes(a.end_time.slice(0, 5)) - timeToMinutes(a.start_time.slice(0, 5)))
      porBarbero.get(barberId)!.push({
        appointment: a,
        inicioMin,
        finMin: inicioMin + duracion,
        propuesta: !!movido,
      })
    }

    const salida = new Map<string, Colocacion[]>()
    for (const [barberId, items] of porBarbero) {
      salida.set(barberId, repartirEnCarriles(items))
    }
    return salida
  }, [appointments, columnas, pendiente, duracionEnResize])

  // ─── Línea "ahora" (sólo si la grilla muestra el día de hoy) ───────
  const [ahoraMin, setAhoraMin] = useState<number | null>(null)
  useEffect(() => {
    const actualizar = () => {
      if (date !== todayDateStr()) {
        setAhoraMin(null)
        return
      }
      const now = new Date()
      const min = now.getHours() * 60 + now.getMinutes()
      setAhoraMin(min >= openMin && min <= closeMin ? min : null)
    }
    actualizar()
    const id = setInterval(actualizar, 60_000)
    return () => clearInterval(id)
  }, [date, openMin, closeMin])

  // Al abrir el día, encuadrar en lo que importa: el primer turno cargado o,
  // si es hoy, la hora actual. Abrir siempre en la apertura obliga a scrollear.
  const scrollRef = useRef<HTMLDivElement>(null)
  const encuadreRef = useRef<string>('')
  useEffect(() => {
    // La clave sólo distingue "ya llegaron turnos": si dependiera del total, el
    // scroll saltaría cada vez que se crea o cancela uno.
    const clave = `${date}:${zoom}:${appointments.length > 0}`
    if (!scrollRef.current || encuadreRef.current === clave) return
    encuadreRef.current = clave
    const primerTurno = appointments.reduce<number | null>((min, a) => {
      const m = timeToMinutes(a.start_time.slice(0, 5))
      return min === null || m < min ? m : min
    }, null)
    const foco = primerTurno ?? (date === todayDateStr() ? new Date().getHours() * 60 + new Date().getMinutes() : null)
    if (foco === null) return
    scrollRef.current.scrollTop = Math.max(0, (foco - openMin - 30) * pxPorMinuto)
  }, [date, zoom, appointments, openMin, pxPorMinuto])

  // ─── Drag & drop ───────────────────────────────────────────────────
  const sensors = useSensors(useSensor(PointerSensor, {
    activationConstraint: { distance: 6 },
  }))

  const [arrastrandoId, setArrastrandoId] = useState<string | null>(null)
  const [destino, setDestino] = useState<{ barberId: string; time: string } | null>(null)

  const apptArrastrado = useMemo(
    () => appointments.find(a => a.id === arrastrandoId) ?? null,
    [arrastrandoId, appointments],
  )

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id).replace(/^appt:/, '')
    // Sólo puede haber una propuesta viva: arrastrar otro turno descarta la
    // anterior en vez de dejar dos cambios sin guardar al mismo tiempo.
    setPendiente(prev => (prev && prev.appointmentId !== id ? null : prev))
    setArrastrandoId(id)
    setDestino(null)
  }

  function handleDragOver(event: DragOverEvent) {
    const data = event.over?.data.current as { barberId?: string; time?: string } | undefined
    setDestino(data?.barberId && data.time ? { barberId: data.barberId, time: data.time } : null)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setArrastrandoId(null)
    setDestino(null)
    if (!over || !onAppointmentMove) return

    const appointmentId = String(active.id).replace(/^appt:/, '')
    const data = over.data.current as { barberId?: string; time?: string } | undefined
    if (!data?.barberId || !data.time) return

    const appt = appointments.find(a => a.id === appointmentId)
    if (!appt) return
    const origenTime = appt.start_time.slice(0, 5)
    if (appt.barber_id === data.barberId && origenTime === data.time) {
      setPendiente(null)
      return
    }

    // No se guarda nada acá: se propone y espera confirmación explícita.
    setPendiente({
      appointmentId,
      origenBarberId: appt.barber_id,
      origenTime,
      destinoBarberId: data.barberId,
      destinoTime: data.time,
    })
  }

  function confirmarMovimiento() {
    if (!pendiente || !onAppointmentMove) return
    setGuardando(true)
    const propuesta = pendiente
    void Promise.resolve(
      onAppointmentMove({
        appointmentId: propuesta.appointmentId,
        newBarberId: propuesta.destinoBarberId,
        newTime: propuesta.destinoTime,
      }),
    )
      .then(res => {
        // El mensaje de error lo muestra el caller (viene del server, que
        // valida jornada del barbero, bloqueos y día habilitado). Acá sólo se
        // revierte la propuesta para no dejar el turno pintado donde no quedó.
        setPendiente(null)
        return res
      })
      // Sin `.catch`, una acción que RECHAZA (red caída, 500, action-id
      // inválido después de un deploy con la pestaña abierta) dejaba la
      // propuesta pintada para siempre y el botón en "Moviendo…": la agenda
      // mostraba el turno en un horario que la DB no tiene. La propuesta se
      // apaga igual; el aviso al usuario lo da el caller.
      .catch(() => { setPendiente(null) })
      .finally(() => setGuardando(false))
  }

  // ─── Resize ────────────────────────────────────────────────────────
  const resizeRef = useRef<{
    appointmentId: string
    altoInicial: number
    yInicial: number
    duracionInicial: number
    duracionActual: number
  } | null>(null)

  function handleResizeStart(appointment: Appointment, e: React.PointerEvent) {
    const inicio = timeToMinutes(appointment.start_time.slice(0, 5))
    const fin = timeToMinutes(appointment.end_time.slice(0, 5))
    resizeRef.current = {
      appointmentId: appointment.id,
      altoInicial: (fin - inicio) * pxPorMinuto,
      yInicial: e.clientY,
      duracionInicial: fin - inicio,
      duracionActual: fin - inicio,
    }
    const onMove = (ev: PointerEvent) => {
      const ref = resizeRef.current
      if (!ref) return
      const altoNuevo = Math.max(snap * pxPorMinuto, ref.altoInicial + (ev.clientY - ref.yInicial))
      const duracion = Math.max(snap, Math.round(altoNuevo / pxPorMinuto / snap) * snap)
      ref.duracionActual = duracion
      setDuracionEnResize(prev => ({ ...prev, [ref.appointmentId]: duracion }))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const ref = resizeRef.current
      resizeRef.current = null
      if (!ref) return
      setDuracionEnResize(prev => {
        const next = { ...prev }
        delete next[ref.appointmentId]
        return next
      })
      if (ref.duracionActual !== ref.duracionInicial && onAppointmentResize) {
        // `.catch` obligatorio: el caller es el que avisa (y el que revierte su
        // estado optimista), pero si la acción rechaza y nadie la atrapa queda
        // una unhandled rejection que en producción tumba el error boundary.
        void Promise.resolve(
          onAppointmentResize({
            appointmentId: ref.appointmentId,
            newDurationMinutes: ref.duracionActual,
          }),
        ).catch(() => {})
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // ─── Textos de destino (badge de arrastre y barra de confirmación) ──
  const duracionArrastrada = apptArrastrado
    ? Math.max(5, timeToMinutes(apptArrastrado.end_time.slice(0, 5)) - timeToMinutes(apptArrastrado.start_time.slice(0, 5)))
    : 0

  const badgeDestino = useMemo(() => {
    if (!destino || !apptArrastrado) return null
    const inicio = timeToMinutes(destino.time)
    const nombreDestino =
      destino.barberId !== apptArrastrado.barber_id
        ? columnas.find(b => b.id === destino.barberId)?.full_name ?? null
        : null
    return {
      rango: `${destino.time} a ${minutesToTime(inicio + duracionArrastrada)}`,
      barbero: nombreDestino,
    }
  }, [destino, apptArrastrado, columnas, duracionArrastrada])

  const resumenPendiente = useMemo(() => {
    if (!pendiente || !apptPendiente) return null
    const duracion = Math.max(
      5,
      timeToMinutes(apptPendiente.end_time.slice(0, 5)) - timeToMinutes(apptPendiente.start_time.slice(0, 5)),
    )
    const inicio = timeToMinutes(pendiente.destinoTime)
    const finMin = inicio + duracion
    const nombreDestino = columnas.find(b => b.id === pendiente.destinoBarberId)?.full_name ?? 'Sin asignar'
    const nombreOrigen = columnas.find(b => b.id === pendiente.origenBarberId)?.full_name ?? 'Sin asignar'

    // Aviso local: el server es el que decide, pero si ya se ve el choque
    // conviene decirlo antes de que el dueño apriete "Mover turno".
    const seSuperpone = appointments.some(a =>
      a.id !== apptPendiente.id &&
      a.barber_id === pendiente.destinoBarberId &&
      !['cancelled', 'no_show'].includes(a.status) &&
      timeToMinutes(a.start_time.slice(0, 5)) < finMin &&
      timeToMinutes(a.end_time.slice(0, 5)) > inicio,
    )
    const enBloqueo = (bloqueosPorBarbero.get(pendiente.destinoBarberId) ?? []).some(
      r => inicio < r.fin && finMin > r.inicio,
    )

    return {
      cliente: apptPendiente.client?.name ?? 'Cliente',
      origen: `${nombreOrigen} · ${pendiente.origenTime}`,
      destino: `${nombreDestino} · ${pendiente.destinoTime} a ${minutesToTime(finMin)}`,
      aviso: enBloqueo
        ? 'Cae sobre un bloqueo'
        : seSuperpone
          ? 'Se superpone con otro turno'
          : null,
    }
  }, [pendiente, apptPendiente, columnas, appointments, bloqueosPorBarbero])

  const hayBarberos = columnas.length > 0

  return (
    <DndContext
      sensors={sensors}
      // `rectIntersection` (el default) mide el rectángulo del turno: los turnos
      // largos caían siempre medio slot corridos. `pointerWithin` usa el cursor.
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragCancel={() => { setArrastrandoId(null); setDestino(null) }}
      onDragEnd={handleDragEnd}
    >
      <div className={cn('relative flex flex-col overflow-hidden rounded-lg border bg-card', className)}>
        <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto">
          {/* El ancho se fija explícito (no `max-content`): así la columna de
              horas puede quedarse pegada a la izquierda a lo largo de TODO el
              scroll horizontal, y con pocos barberos el `min-width: 100%` deja
              que las columnas se repartan el ancho sobrante. */}
          <div
            className="flex min-h-full"
            style={{
              width: ANCHO_GUTTER + Math.max(1, columnas.length) * ANCHO_MIN_COLUMNA,
              minWidth: '100%',
            }}
          >
            {/* Columna de horas */}
            <div
              className="sticky left-0 z-30 shrink-0 border-r bg-card"
              style={{ width: ANCHO_GUTTER }}
            >
              <div
                className="sticky top-0 z-10 border-b bg-card"
                style={{ height: ALTO_HEADER }}
              />
              <div className="relative" style={{ height: altoCuerpo }}>
                {etiquetas.map(min => {
                  const top = minutosAPx(min)
                  return (
                    <div
                      key={`hora-${min}`}
                      className={cn(
                        'absolute right-1.5 font-mono text-[11px] font-medium tabular-nums text-muted-foreground',
                        // La primera etiqueta cae en el borde: centrarla la corta.
                        top > 8 && '-translate-y-1/2',
                      )}
                      style={{ top }}
                    >
                      {minutesToTime(min)}
                    </div>
                  )
                })}
                {ahoraMin !== null && (
                  <div
                    className="absolute right-1 -translate-y-1/2 rounded bg-red-500 px-1 py-px font-mono text-[10px] font-semibold tabular-nums text-white"
                    style={{ top: minutosAPx(ahoraMin) }}
                  >
                    {minutesToTime(ahoraMin)}
                  </div>
                )}
              </div>
            </div>

            {/* Columnas de barberos */}
            {!hayBarberos ? (
              <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
                No hay barberos para mostrar en este día.
              </div>
            ) : columnas.map(barber => {
              const desde = barber.works_from ? timeToMinutes(barber.works_from) : null
              const hasta = barber.works_to ? timeToMinutes(barber.works_to) : null
              const colocaciones = colocacionPorBarbero.get(barber.id) ?? []
              const bloqueos = bloqueosPorBarbero.get(barber.id) ?? []

              return (
                <div
                  key={barber.id}
                  className="relative flex-1 border-r last:border-r-0"
                  style={{ minWidth: ANCHO_MIN_COLUMNA }}
                >
                  <div
                    className="sticky top-0 z-20 flex items-center gap-2 border-b bg-card px-2"
                    style={{ height: ALTO_HEADER }}
                  >
                    {barber.avatar_url ? (
                      <Image
                        src={barber.avatar_url}
                        alt=""
                        width={24}
                        height={24}
                        className="size-6 shrink-0 rounded-full object-cover"
                        unoptimized
                      />
                    ) : (
                      <div className="size-6 shrink-0 rounded-full bg-muted" />
                    )}
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate text-sm font-medium',
                        barber.fueraDeAgenda && 'text-muted-foreground line-through',
                      )}
                    >
                      {barber.full_name}
                    </span>
                    {barber.fueraDeAgenda ? (
                      <UserX
                        className="size-3.5 shrink-0 text-amber-500"
                        aria-label="No toma turnos, pero tiene turnos cargados"
                      />
                    ) : barber.sinHorario && (
                      <AlertTriangle
                        className="size-3.5 shrink-0 text-amber-500"
                        aria-label="Sin horario cargado"
                      />
                    )}
                  </div>

                  <div
                    className="relative"
                    title={barber.fueraDeAgenda
                      ? `${barber.full_name} no figura entre los barberos que toman turnos, pero tiene turnos cargados este día. Siguen ocupando el horario: reasignalos o cancelalos.`
                      : barber.sinHorario
                        ? `${barber.full_name} no tiene horario cargado para este día: no se le pueden reservar turnos nuevos.`
                        : undefined}
                    style={{ height: altoCuerpo }}
                  >
                    {/* Fuera de la jornada del barbero */}
                    {barber.sinHorario || barber.fueraDeAgenda ? (
                      <div
                        className="pointer-events-none absolute inset-0"
                        style={{ backgroundImage: RAYADO_FUERA_HORARIO }}
                      />
                    ) : (
                      // Los extremos se clampean: un barbero cuya jornada cae
                      // entera fuera del horario de la sucursal (works_to antes
                      // de la apertura, works_from después del cierre) generaba
                      // un rayado con top negativo o más alto que el cuerpo, que
                      // se comía el encabezado sticky y agregaba scroll fantasma.
                      <>
                        {desde !== null && desde > openMin && (
                          <div
                            className="pointer-events-none absolute inset-x-0 top-0"
                            style={{ height: clampPx(minutosAPx(desde)), backgroundImage: RAYADO_FUERA_HORARIO }}
                          />
                        )}
                        {hasta !== null && hasta < closeMin && (
                          <div
                            className="pointer-events-none absolute inset-x-0"
                            style={{
                              top: clampPx(minutosAPx(hasta)),
                              height: altoCuerpo - clampPx(minutosAPx(hasta)),
                              backgroundImage: RAYADO_FUERA_HORARIO,
                            }}
                          />
                        )}
                      </>
                    )}

                    {/* Líneas horarias */}
                    {lineas.map(l => (
                      <div
                        key={`linea-${barber.id}-${l.min}`}
                        className={cn(
                          'pointer-events-none absolute inset-x-0 border-t',
                          l.enPunto ? 'border-border' : 'border-border/40',
                        )}
                        style={{ top: minutosAPx(l.min) }}
                      />
                    ))}

                    {/* Bloqueos */}
                    {bloqueos.map((r, i) => (
                      <div
                        key={`bloqueo-${barber.id}-${i}`}
                        className="pointer-events-none absolute inset-x-0 border-y border-red-500/30"
                        title={r.motivo ?? 'Bloqueado'}
                        style={{
                          top: minutosAPx(r.inicio),
                          height: (r.fin - r.inicio) * pxPorMinuto,
                          backgroundImage: RAYADO_BLOQUEO,
                        }}
                      />
                    ))}

                    {/* Slots (drop + click en hueco libre). La columna de un
                        barbero fuera de la agenda no acepta ni clicks ni drops:
                        el server rechaza cualquier turno nuevo para él, así que
                        ofrecerlo sólo lleva a un error. Sacar turnos DE esa
                        columna hacia otra sigue funcionando. */}
                    {slots.map(s => (
                      <SlotDroppable
                        key={`slot-${barber.id}-${s.time}`}
                        barberId={barber.id}
                        time={s.time}
                        topPx={minutosAPx(s.min)}
                        altoPx={s.alto}
                        bloqueado={!!barber.fueraDeAgenda || slotBloqueado(barber.id, s.min)}
                        seleccionado={
                          selected?.slot?.barberId === barber.id && selected.slot.time === s.time
                        }
                        onClick={onSlotClick ? () => onSlotClick(barber.id, s.time) : undefined}
                      />
                    ))}

                    {/* Fantasma del origen mientras hay una propuesta sin confirmar.
                        Va por `rectTurno` como las tarjetas: si el turno salía de un
                        horario fuera de la grilla, el fantasma quedaba con top
                        negativo y el dueño no veía de dónde lo estaba moviendo. */}
                    {pendiente && pendiente.origenBarberId === barber.id && apptPendiente && (() => {
                      const inicioOrigen = timeToMinutes(pendiente.origenTime)
                      const duracionOrigen = Math.max(
                        5,
                        timeToMinutes(apptPendiente.end_time.slice(0, 5)) -
                          timeToMinutes(apptPendiente.start_time.slice(0, 5)),
                      )
                      const rect = rectTurno(inicioOrigen, inicioOrigen + duracionOrigen)
                      return (
                        <div
                          className="pointer-events-none absolute inset-x-0.5 z-[9] rounded-md border border-dashed border-muted-foreground/50 bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                          style={{ top: rect.top, height: Math.max(16, rect.alto - 2) }}
                        >
                          <span className="font-mono">{pendiente.origenTime}</span> · antes acá
                        </div>
                      )
                    })()}

                    {/* Turnos */}
                    {colocaciones.map(c => {
                      const rect = rectTurno(c.inicioMin, c.finMin)
                      return (
                        <TurnoDraggable
                          key={c.appointment.id}
                          colocacion={c}
                          topPx={rect.top}
                          altoPx={rect.alto}
                          fueraDeGrilla={rect.fuera}
                          seleccionado={selected?.appointmentId === c.appointment.id}
                          arrastrable={!!onAppointmentMove && !guardando}
                          onClick={() => onAppointmentClick?.(c.appointment)}
                          onResizeStart={
                            onAppointmentResize ? (e) => handleResizeStart(c.appointment, e) : undefined
                          }
                        />
                      )
                    })}

                    {/* Línea "ahora" — por encima de los turnos (z-10) pero por
                        debajo del encabezado sticky de la columna (z-20). */}
                    {ahoraMin !== null && (
                      <div
                        className="pointer-events-none absolute inset-x-0 z-[15] border-t-2 border-red-500"
                        style={{ top: minutosAPx(ahoraMin) }}
                      />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Barra de confirmación — nada se guarda hasta que el dueño la apriete */}
        {pendiente && resumenPendiente && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-40 flex justify-center px-3">
            <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-background/95 px-3 py-2 shadow-lg backdrop-blur">
              <div className="min-w-0 text-xs">
                <p className="truncate font-medium">{resumenPendiente.cliente}</p>
                <p className="flex flex-wrap items-center gap-1 text-muted-foreground">
                  <span className="font-mono">{resumenPendiente.origen}</span>
                  <ArrowRight className="size-3" />
                  <span className="font-mono font-semibold text-foreground">
                    {resumenPendiente.destino}
                  </span>
                </p>
                {resumenPendiente.aviso && (
                  <p className="mt-0.5 flex items-center gap-1 text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="size-3 shrink-0" />
                    {resumenPendiente.aviso}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPendiente(null)}
                  disabled={guardando}
                >
                  <Undo2 className="mr-1 size-3.5" />
                  Deshacer
                </Button>
                <Button size="sm" onClick={confirmarMovimiento} disabled={guardando}>
                  {guardando ? (
                    <><Loader2 className="mr-1 size-3.5 animate-spin" /> Moviendo…</>
                  ) : (
                    <><Check className="mr-1 size-3.5" /> Mover turno</>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        <DragOverlay dropAnimation={null}>
          {apptArrastrado && (
            <div className="pointer-events-none">
              <div
                className={cn(
                  'rounded-md border-l-2 px-1.5 py-0.5 text-[11px] shadow-lg',
                  STATUS_STYLES[apptArrastrado.status],
                )}
                style={{ width: ANCHO_MIN_COLUMNA }}
              >
                <TarjetaTurno appointment={apptArrastrado} compacto={false} />
              </div>
              {badgeDestino && (
                <div className="mt-1 inline-flex flex-col rounded-md bg-foreground px-2 py-1 text-[11px] font-semibold text-background shadow-lg">
                  <span className="font-mono">{badgeDestino.rango}</span>
                  {badgeDestino.barbero && (
                    <span className="font-normal opacity-80">{badgeDestino.barbero}</span>
                  )}
                </div>
              )}
            </div>
          )}
        </DragOverlay>
      </div>
    </DndContext>
  )
}
