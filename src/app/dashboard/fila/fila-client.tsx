'use client'

import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useVisibilityRefresh } from '@/hooks/use-visibility-refresh'
import {
  DndContext,
  DragOverlay,
  useDraggable,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  pointerWithin,
  rectIntersection,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
  type CollisionDetection,
  defaultDropAnimationSideEffects,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  horizontalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { createClient } from '@/lib/supabase/client'
import { cancelQueueEntry, updateQueueOrder, createBreakEntry, startService, checkinClient, cerrarSoloAsesoria } from '@/lib/actions/queue'
import { asesoriaHabilitadaEnSucursal, type MotivoPedidoAsesoria } from '@/lib/actions/asesoria'
import { searchClients } from '@/lib/actions/clients'
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
import { useBranchStore } from '@/stores/branch-store'
import { BranchSelector } from '@/components/dashboard/branch-selector'
import { TurnoBadge } from '@/components/appointments/turno-badge'
import type { Appointment, QueueEntry, StaffStatus, StaffSchedule, Staff, BreakConfig, Service } from '@/lib/types/database'
import { esMovidaPorWhatsApp, isBarberBlockedByShiftEnd } from '@/lib/barber-utils'
import {
  appointmentInstantMs,
  appointmentTimeLabel,
  findNextAppointment,
  formatHourMinute,
  protectionWindowMinutes,
  type NextAppointmentInfo,
} from '@/lib/queue-appointments'
import { getLocalDateStr } from '@/lib/time-utils'
import { computeMinutes } from '@/hooks/use-timer-stage'
import { formatoEspera, nivelEspera, type NivelEspera } from '@/components/barber/fila/espera'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Clock, User, Scissors, X, Pause, GripVertical, Zap, UserPlus, Play, Check, ChevronDown, Search, FileEdit, ExternalLink, Sparkles, Info, CalendarClock, MessageCircle, MessageCircleQuestionMark, Settings2 } from 'lucide-react'
import { toast } from 'sonner'

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface BarberRow {
  id: string
  full_name: string
  branch_id: string | null
  status: StaffStatus
  is_active: boolean
  hidden_from_checkin: boolean
  avatar_url?: string | null
}

interface BranchRow {
  id: string
  name: string
}

interface FilaClientProps {
  initialEntries: QueueEntry[]
  barbers: BarberRow[]
  branches: BranchRow[]
  breakConfigs: BreakConfig[]
  timezone: string
  orgId: string
}

type ColumnId = string // 'breaks', 'dynamic', or barber.id

/**
 * Valor del desplegable de servicio del registro manual que significa «pidió
 * asesoría» (mig 217). Como en la tablet, la asesoría REEMPLAZA al servicio:
 * se manda `asesoria=1` y ningún `service_id`.
 */
const OPCION_ASESORIA = '__asesoria__'

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
 * Detección de colisiones personalizada para el kanban horizontal.
 * Prioriza pointerWithin (el puntero está DENTRO de un droppable) para que
 * arrastrar a una fila vacía funcione correctamente. Si no hay coincidencia
 * (ej. el puntero está entre filas), usa rectIntersection.
 *
 * Sin destino, no hay destino: hasta el 19/oct/2026 el último recurso era
 * `closestCenter`, que SIEMPRE encuentra uno, así que soltar una tarjeta en el
 * encabezado o en un costado vacío la pasaba al carril más cercano (le cambiaba
 * el barbero o el lugar a alguien sin que nadie lo pidiera). Ahora vuelve a su
 * lugar (`handleDragEnd` sin `over` relee la fila).
 */
const kanbanCollisionDetection: CollisionDetection = (args) => {
  // 1. ¿El puntero está dentro de algún droppable?
  const pointerCollisions = pointerWithin(args)
  if (pointerCollisions.length > 0) return pointerCollisions

  // 2. ¿Hay intersección de rectangulos?
  return rectIntersection(args)
}

// ─── Asesoría en el registro manual ──────────────────────────────────────────

/** «Pidió asesoría» al pie del desplegable de servicio del registro (mig 217). */
function OpcionAsesoriaDelRegistro() {
  return (
    <>
      <SelectSeparator />
      <SelectItem value={OPCION_ASESORIA}>
        <MessageCircleQuestionMark className="text-fuchsia-300" aria-hidden />
        Pidió asesoría · sin costo
      </SelectItem>
    </>
  )
}

/** Qué pasa con un cliente anotado pidiendo asesoría, dicho debajo del desplegable. */
function AyudaAsesoriaDelRegistro() {
  return (
    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
      <MessageCircleQuestionMark className="mt-px size-3.5 shrink-0 text-fuchsia-300" aria-hidden />
      No sabe qué hacerse: le avisamos en el panel del barbero y él elige el servicio al cobrar.
    </p>
  )
}

// ─── Sortable QueueCard ────────────────────────────────────────────────────────

/**
 * Lo que las tarjetas leen del tablero sin pasarlo por cada columna: la hora
 * RESERVADA de un turno (de la agenda del día; `null` si el turno no está en la
 * agenda cargada) y el reloj de 5 s con el que se miden esperas y cortes.
 */
interface Tablero {
  horaDeTurno: (entry: QueueEntry) => string | null
  /** Instante (ms) de la hora reservada de un turno; sin la agenda, `priority_order`. */
  inicioDeTurno: (entry: QueueEntry) => number
  ahora: number
}

const TableroContext = createContext<Tablero | null>(null)

/** Minutos desde un instante (0 sin dato, con un dato inválido o futuro). */
function minutosDesde(iso: string | null | undefined, ahora: number): number {
  if (!iso) return 0
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return 0
  return Math.max(0, (ahora - t) / 60_000)
}

/** La espera se colorea con los umbrales del panel: ámbar a los 40 min, rojo a los 70. */
const TEXTO_ESPERA: Record<NivelEspera, string> = {
  normal: 'text-muted-foreground',
  demorado: 'text-amber-300',
  critico: 'text-red-400',
}

const BARRA_ESPERA: Record<NivelEspera, string> = {
  normal: 'bg-white/30',
  demorado: 'bg-amber-400',
  critico: 'bg-red-500',
}

/** Los minutos del corte con el semáforo del panel (ámbar desde los 35, rojo desde los 45). */
function claseMinutosDeCorte(minutos: number): string {
  if (minutos >= 45) return 'text-red-400'
  if (minutos >= 35) return 'text-amber-300'
  return 'text-foreground'
}

/** Nada que nazca en los botones de una tarjeta arranca un arrastre (ver la nota en las acciones). */
const frenarArrastre = (e: React.SyntheticEvent) => e.stopPropagation()

interface QueueCardProps {
  entry: QueueEntry
  formatElapsed: (ts: string) => string
  onCancel: (id: string) => void
  onStartService?: (entry: QueueEntry) => void
  actionLoading: string | null
  selectedBranchId: string | null
  getBranchName: (id: string) => string
  /** Nombre de un barbero por id (para "esperaba a X" de Menor espera por WhatsApp). */
  getBarberName?: (id: string) => string | undefined
  timezone: string
  /** Es el próximo cliente de su carril (o de Dinámicos). */
  sigue?: boolean
}

function QueueCard({
  entry,
  onCancel,
  onStartService,
  actionLoading,
  selectedBranchId,
  getBranchName,
  getBarberName,
  timezone,
  sigue = false,
}: QueueCardProps) {
  // Los turnos no se arrastran. `handleDragEnd` renumera y reescribe
  // `priority_order` (que en un turno es su hora reservada, la clave de toda la
  // convivencia con la fila) y, al soltar en otra columna, le cambiaría el
  // barbero sin tocar `appointments.barber_id`: fila y agenda quedarían
  // diciendo cosas distintas. Se reprograman desde la agenda.
  const isAppointment = entry.is_appointment

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: entry.id,
    data: { entry },
    // Sólo `draggable`: la tarjeta sigue siendo droppable para que un walk-in
    // se pueda soltar antes o después del turno sin perder el punto de inserción.
    disabled: { draggable: isAppointment },
  })

  // Evitar error visual de dnd-kit origin
  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? 'transform 200ms cubic-bezier(0.25, 1, 0.5, 1)',
  }

  const isBreak = entry.is_break
  const displayName = isBreak ? 'Descanso' : (entry.client?.name ?? 'Cliente')
  // Mig 218: aceptó por WhatsApp pasarse a Menor espera y sigue en el pool. La
  // recepción tiene que saber a quién esperaba: conservó su lugar en la fila de
  // ese barbero, que lo sigue viendo en su panel y lo puede tomar primero.
  const viaWhatsApp = esMovidaPorWhatsApp(entry)
  const esperabaA =
    viaWhatsApp && entry.menor_espera_barbero_original_id
      ? getBarberName?.(entry.menor_espera_barbero_original_id)
      : undefined
  // Mig 217: pidió asesoría sin costo en la tablet (no sabe qué hacerse).
  const pidioAsesoria = !isBreak && entry.pidio_asesoria === true
  const tablero = useContext(TableroContext)
  const minutos = minutosDesde(entry.checked_in_at, tablero?.ahora ?? 0)
  const nivel = nivelEspera(minutos)
  // La pista de un dinámico (a quién se lo sugirió el hint): sólo informa.
  const pista = entry.is_dynamic && entry.barber?.full_name ? entry.barber.full_name.split(' ')[0] : null
  const conChips = (!selectedBranchId && !!entry.branch_id) || !!pista || pidioAsesoria || viaWhatsApp || isAppointment

  function explainNoDrag() {
    toast.info('Los turnos se mueven desde la agenda, no desde la fila', {
      description: 'Ahí se reprograma la hora o el barbero y la fila se actualiza sola.',
      action: {
        label: 'Ir a la agenda',
        onClick: () => { window.location.href = '/dashboard/turnos/agenda' },
      },
    })
  }

  /**
   * Avisa sólo si REALMENTE intentó arrastrar: mismo umbral de 5px que usa el
   * MouseSensor. Con un `onPointerDown` pelado, cualquier toque para scrollear
   * el kanban en la tablet levantaba el cartel y se volvía ruido.
   */
  function handleAppointmentPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const startX = e.clientX
    const startY = e.clientY

    function cleanup() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', cleanup)
      window.removeEventListener('pointercancel', cleanup)
    }

    function onMove(ev: PointerEvent) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return
      cleanup()
      explainNoDrag()
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', cleanup)
    window.addEventListener('pointercancel', cleanup)
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(isAppointment ? {} : attributes)}
      {...(isAppointment ? {} : listeners)}
      onPointerDown={isAppointment ? handleAppointmentPointerDown : undefined}
      title={isAppointment ? 'Los turnos se mueven desde la agenda, no desde la fila' : undefined}
      className={cn(
        // Sin selección de texto ni el menú de "guardar imagen" de iOS al
        // mantenerla apretada: ése es el gesto que la levanta en la tablet.
        // `shrink-0`: en Dinámicos (una columna de alto fijo) las tarjetas se
        // achicaban para entrar y les cortaba el segundo renglón.
        'group relative w-full min-w-0 shrink-0 select-none overflow-hidden rounded-xl border touch-manipulation [-webkit-touch-callout:none]',
        'transition-[border-color,background-color,opacity] duration-150',
        isAppointment ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
        isDragging
          ? 'z-50 border-dashed border-white/25 bg-transparent opacity-50'
          : isBreak
            ? 'border-amber-500/25 bg-amber-500/[0.06] hover:border-amber-400/50'
            : isAppointment
              ? 'border-violet-400/30 bg-violet-500/[0.07]'
              : sigue
                ? 'border-white/25 bg-white/[0.07] hover:border-white/40'
                : 'border-white/[0.08] bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]',
      )}
    >
      <div className="flex items-start gap-2 py-2.5 pl-2 pr-1.5">
        {/* Manija (en un turno, el ícono de reservado: no se arrastra) */}
        <span
          className={cn(
            'mt-0.5 shrink-0 transition-colors',
            isAppointment
              ? 'text-violet-300/80'
              : isBreak
                ? 'text-amber-400/60 group-hover:text-amber-300'
                : 'text-white/25 group-hover:text-white/60',
          )}
          aria-hidden
        >
          {isAppointment ? <CalendarClock className="size-4" /> : <GripVertical className="size-4" />}
        </span>

        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'flex min-w-0 items-center gap-1.5 text-[0.9375rem] font-semibold leading-tight',
              isBreak ? 'text-amber-200' : 'text-foreground',
            )}
          >
            {isBreak && <Pause className="size-3.5 shrink-0 text-amber-300" aria-hidden />}
            <span className="truncate">{displayName}</span>
          </p>

          {/* El número en la fila, "sigue" para el próximo, la espera (con el
              color del panel) y el teléfono si queda lugar. */}
          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="shrink-0 rounded-md bg-white/[0.07] px-1.5 py-px font-mono text-[11px] font-semibold tabular-nums text-foreground/75">
              #{entry.position}
            </span>
            {sigue && !isBreak && (
              <span
                className="shrink-0 rounded-md bg-foreground px-1.5 py-px text-[11px] font-semibold text-background"
                title="Es el próximo de este carril"
              >
                Sigue
              </span>
            )}
            {/* La hora RESERVADA sale de la agenda (`TableroContext`): en una
                entrada adoptada de un walk-in, `priority_order` es la hora de
                llegada (mig 170) y la tarjeta mostraba esa. Sin el turno en la
                agenda cargada, `priority_order` es la mejor aproximación. */}
            {isAppointment && (
              <TurnoBadge
                time={tablero?.horaDeTurno(entry) ?? appointmentTimeLabel(entry, timezone)}
                className="text-violet-300 dark:text-violet-300"
              />
            )}
            {/* En un turno manda la hora reservada: la espera no entra al lado. */}
            {!isBreak && !isAppointment && (
              <span
                className={cn('inline-flex shrink-0 items-center gap-1 font-mono text-xs font-semibold tabular-nums', TEXTO_ESPERA[nivel])}
                title="Tiempo esperando"
              >
                <Clock className="size-3" aria-hidden />
                {formatoEspera(minutos)}
              </span>
            )}
            {!isBreak && !isAppointment && entry.client?.phone && (
              <span className="min-w-0 truncate">{entry.client.phone}</span>
            )}
          </div>

          {/* Lo que no siempre está va abajo, en su propio renglón, y baja solo
              si no entra: sucursal, la pista de un dinámico, asesoría, WhatsApp. */}
          {conChips && (
            <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1">
              {!selectedBranchId && entry.branch_id && (
                <span className="max-w-[7rem] truncate rounded-md bg-white/[0.06] px-1.5 py-px text-[10px] text-muted-foreground">
                  {getBranchName(entry.branch_id)}
                </span>
              )}
              {pista && (
                <span
                  className="inline-flex max-w-[7rem] items-center gap-0.5 rounded-md bg-yellow-500/10 px-1.5 py-px text-[10px] text-yellow-300"
                  title="Sugerido para este barbero (lo toma igual el primero que se libere)"
                >
                  <Zap className="size-2.5 shrink-0" aria-hidden />
                  <span className="truncate">{pista}</span>
                </span>
              )}
              {pidioAsesoria && (
                <span
                  className="inline-flex"
                  title="Pidió asesoría sin costo: no sabe qué hacerse. El barbero lo ve al empezar a atenderlo."
                >
                  <AsesoriaBadge tono="oscuro" />
                </span>
              )}
              {viaWhatsApp && (
                <span
                  className="flex w-fit max-w-full items-start gap-1 rounded-md bg-sky-500/10 px-1.5 py-px text-[10px] font-medium leading-tight text-sky-300"
                  title="Aceptó pasarse a Menor espera desde el aviso de WhatsApp. Conserva su lugar en la fila."
                >
                  <MessageCircle className="mt-px size-2.5 shrink-0" aria-hidden />
                  <span>Por WhatsApp{esperabaA ? ` · esperaba a ${esperabaA}` : ''}</span>
                </span>
              )}
              {isAppointment && (
                <a
                  href="/dashboard/turnos/agenda"
                  onPointerDown={(e) => e.stopPropagation()}
                  className="inline-flex w-fit items-center gap-1 text-[10px] text-violet-300/80 transition-colors hover:text-violet-200"
                >
                  <ExternalLink className="size-2.5 shrink-0" aria-hidden />
                  Se mueve desde la agenda
                </a>
              )}
            </div>
          )}
        </div>

        {/* Acciones. Frenan `mousedown`/`touchstart`, que es lo que escuchan los
            sensores de dnd-kit: el `onPointerDown` de cada botón no los frena, y
            apretar ▶ o la X moviendo apenas el mouse (o un toque largo en la
            tablet) arrastraba la tarjeta en vez de apretar el botón. */}
        <div
          className="flex shrink-0 items-center"
          onMouseDown={frenarArrastre}
          onTouchStart={frenarArrastre}
          onPointerDown={frenarArrastre}
        >
          {/* El botón verde también va en las tarjetas del pool ("Menor espera",
              barber_id NULL). Sin esto, la ÚNICA acción posible sobre un cliente que
              eligió "Menor espera" era la X roja que lo borra de la fila: para
              atenderlo había que adivinar que se arrastra a la columna de un barbero.
              Con barbero asignado inicia el corte; sin barbero abre el selector. */}
          {!isBreak && onStartService && (
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => { e.stopPropagation(); onStartService(entry); }}
              disabled={actionLoading === entry.id}
              className="size-8 rounded-lg text-emerald-400 hover:bg-emerald-500/15 hover:text-emerald-300"
              title={entry.barber_id ? 'Iniciar corte' : 'Asignar barbero y atender'}
              aria-label={entry.barber_id ? `Iniciar el corte de ${displayName}` : `Elegir barbero para ${displayName}`}
            >
              <Play className="size-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => { e.stopPropagation(); onCancel(entry.id); }}
            disabled={actionLoading === entry.id}
            className="size-8 rounded-lg text-muted-foreground hover:bg-red-500/15 hover:text-red-400"
            title={isBreak ? 'Cancelar el descanso' : 'Sacar de la fila'}
            aria-label={isBreak ? 'Cancelar el descanso' : `Sacar a ${displayName} de la fila`}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {/* La espera dibujada por el borde de abajo: se llena a las 2 h, así un
          carril largo se lee de reojo (quién se está quedando atrás). */}
      {!isBreak && !isDragging && (
        <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-white/[0.04]">
          <span
            className={cn('block h-full', BARRA_ESPERA[nivel])}
            style={{ width: `${Math.max(4, Math.min(1, minutos / 120) * 100)}%` }}
          />
        </span>
      )}
    </div>
  )
}


// ─── En Servicio Card (No arrastrable) ───────────────────────────────────────

function InProgressCard({
  entry,
  onCancel,
  onComplete,
  actionLoading,
}: {
  entry: QueueEntry
  formatElapsed: (ts: string) => string
  onCancel: (id: string) => void
  onComplete?: (entry: QueueEntry) => void
  actionLoading: string | null
}) {
  const isBreak = entry.is_break
  const displayName = isBreak ? 'Descanso' : (entry.client?.name ?? 'Cliente')
  // Mig 217: el sello sigue en curso para que la recepción sepa que el barbero
  // tiene que elegir el servicio al cobrar (o cerrarla como solo asesoría).
  const pidioAsesoria = !isBreak && entry.pidio_asesoria === true
  const tablero = useContext(TableroContext)
  const ahora = tablero?.ahora ?? 0
  // Los minutos del corte se miden igual que en el panel del barbero (sin las
  // pausas); los del descanso, desde que arrancó.
  const minutos = isBreak
    ? minutosDesde(entry.started_at, ahora)
    : (computeMinutes(entry.started_at, entry.paused_duration_seconds ?? 0, entry.paused_at, ahora) ?? 0)
  const enPausa = !isBreak && !!entry.paused_at

  return (
    <div
      className={cn(
        'relative w-full min-w-0 overflow-hidden rounded-xl border',
        isBreak ? 'border-amber-400/35 bg-amber-500/[0.08]' : 'border-emerald-400/35 bg-emerald-500/[0.08]',
      )}
    >
      <div className="flex items-center gap-2 py-2.5 pl-2.5 pr-1.5">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide">
            {isBreak ? (
              <Pause className="size-3.5 shrink-0 text-amber-300" aria-hidden />
            ) : (
              <Scissors className="size-3.5 shrink-0 text-emerald-300" aria-hidden />
            )}
            <span className={isBreak ? 'text-amber-300' : enPausa ? 'text-amber-300' : 'text-emerald-300'}>
              {isBreak ? 'En descanso' : enPausa ? 'En pausa' : 'Cortando'}
            </span>
            <span
              className={cn(
                'ml-auto font-mono text-[0.9375rem] font-semibold normal-case tracking-normal tabular-nums',
                isBreak ? 'text-amber-200' : claseMinutosDeCorte(minutos),
              )}
              title={isBreak ? 'Minutos de descanso' : 'Minutos de corte'}
            >
              {Math.floor(minutos)}
              <span className="ml-0.5 font-sans text-[0.7em] font-medium">min</span>
            </span>
          </p>
          <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className="max-w-full truncate text-[0.9375rem] font-semibold text-foreground">{displayName}</span>
            {pidioAsesoria && (
              <span
                className="inline-flex shrink-0"
                title={
                  entry.asesoria_vista_at
                    ? 'Pidió asesoría · su barbero ya vio el aviso'
                    : 'Pidió asesoría · su barbero todavía no confirmó el aviso'
                }
              >
                <AsesoriaBadge tono="oscuro" />
              </span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {!isBreak && onComplete && (
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => { e.stopPropagation(); onComplete(entry); }}
              onPointerDown={(e) => e.stopPropagation()}
              disabled={actionLoading === entry.id}
              className="size-8 rounded-lg bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 hover:text-emerald-200"
              title="Cobrar y finalizar el corte"
              aria-label={`Cobrar el corte de ${displayName}`}
            >
              <Check className="size-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => { e.stopPropagation(); onCancel(entry.id); }}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={actionLoading === entry.id}
            className="size-8 rounded-lg text-muted-foreground hover:bg-red-500/15 hover:text-red-400"
            title={isBreak ? 'Terminar el descanso' : 'Cancelar el corte'}
            aria-label={isBreak ? 'Terminar el descanso' : `Cancelar el corte de ${displayName}`}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Break Template Card (Draggable) ────────────────────────────────────────

function BreakTemplateCard({ config }: { config: BreakConfig }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({
    id: `template-break-${config.id}`,
    data: { isTemplate: true, config },
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      {...attributes}
      {...listeners}
      aria-label={`Arrastrar ${config.name} (${config.duration_minutes} min) al carril de un barbero`}
      className={cn(
        'group inline-flex h-9 w-full cursor-grab select-none items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/[0.08] pl-2.5 pr-3.5 text-amber-200 touch-manipulation active:cursor-grabbing',
        'transition-[border-color,opacity] duration-150',
        isDragging ? 'opacity-40' : 'hover:border-amber-400/60',
      )}
    >
      <GripVertical className="size-3.5 shrink-0 text-amber-500/50 transition-colors group-hover:text-amber-300" aria-hidden />
      <Pause className="size-3.5 shrink-0 text-amber-300" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{config.name}</span>
      <span className="shrink-0 font-mono text-xs tabular-nums text-amber-300/80">{config.duration_minutes}′</span>
    </div>
  )
}

// ─── Kanban Column ──────────────────────────────────────────────────────────

interface KanbanColumnProps {
  id: ColumnId
  title: string
  icon?: React.ReactNode
  entries: QueueEntry[]
  inProgressEntry?: QueueEntry
  barber?: BarberRow
  notClockedInBarbers?: Set<string>
  schedules?: StaffSchedule[]
  now?: number
  shiftEndMargin?: number
  formatElapsed: (ts: string) => string
  onCancel: (id: string) => void
  onStartService?: (entry: QueueEntry) => void
  onCompleteService?: (entry: QueueEntry) => void
  actionLoading: string | null
  selectedBranchId: string | null
  getBranchName: (id: string) => string
  timezone: string
  children?: React.ReactNode
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function KanbanColumn({
  id,
  title,
  icon,
  entries,
  inProgressEntry,
  barber,
  notClockedInBarbers,
  schedules,
  now,
  shiftEndMargin,
  formatElapsed,
  onCancel,
  onStartService,
  onCompleteService,
  actionLoading,
  selectedBranchId,
  getBranchName,
  timezone,
  children,
}: KanbanColumnProps) {
  const { setNodeRef } = useSortable({
    id,
    data: { type: 'Column', columnId: id },
  })

  // Estilos y estado del barbero (si es columna de barbero)
  let isUnavailable = false
  let HeaderContent = null

  if (barber) {
    const isNotClocked = notClockedInBarbers?.has(barber.id)
    const isHidden = barber.hidden_from_checkin
    const isShiftEnd =
      !isNotClocked &&
      schedules &&
      now !== undefined &&
      shiftEndMargin !== undefined &&
      isBarberBlockedByShiftEnd(
        barber as unknown as Staff,
        inProgressEntry ? [inProgressEntry] : [],
        schedules,
        now,
        shiftEndMargin
      )
    isUnavailable = isHidden || isNotClocked || !!isShiftEnd

    let statusText: string
    let statusClass: string
    let dotClass: string

    if (isHidden) {
      statusText = 'Oculto en check-in'
      statusClass = 'text-zinc-500'
      dotClass = 'bg-zinc-600'
    } else if (isNotClocked) {
      statusText = 'Sin entrada'
      statusClass = 'text-zinc-500'
      dotClass = 'bg-zinc-600'
    } else if (isShiftEnd) {
      statusText = 'Fin de turno'
      statusClass = 'text-amber-400'
      dotClass = 'bg-amber-500'
    } else if (inProgressEntry) {
      statusText = inProgressEntry.is_break ? 'En descanso' : 'Atendiendo'
      statusClass = inProgressEntry.is_break ? 'text-amber-400' : 'text-green-400'
      dotClass = inProgressEntry.is_break ? 'bg-amber-500' : 'bg-green-500'
    } else {
      statusText = 'Disponible'
      statusClass = 'text-zinc-400'
      dotClass = 'bg-emerald-500'
    }

    HeaderContent = (
      <div className={`flex items-center gap-3 w-full transition-opacity ${isUnavailable ? 'opacity-50' : ''}`}>
        <div className="relative h-12 w-12 shrink-0">
          <div className="h-full w-full rounded-full bg-zinc-800 overflow-hidden ring-2 ring-zinc-800">
            {barber.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={barber.avatar_url}
                alt={barber.full_name}
                className="h-full w-full object-cover"
                style={{ objectPosition: 'center 15%' }}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <User className="size-5 text-zinc-500" />
              </div>
            )}
          </div>
          <div className={`absolute right-0 bottom-0 size-3.5 rounded-full ring-2 ring-zinc-900 z-10 ${dotClass}`} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-zinc-100 text-sm">{barber.full_name}</h3>
          <p className={`truncate text-xs mt-0.5 ${statusClass}`}>{statusText}</p>
        </div>
      </div>
    )
  } else {
    // Columnas genéricas (Dinámicos / Descansos)
    HeaderContent = (
      <div className="flex items-center gap-2 h-12">
        {icon}
        <h3 className="font-semibold text-zinc-100">{title}</h3>
      </div>
    )
  }

  const entryIds = useMemo(() => entries.map((e) => e.id), [entries])

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col w-[300px] shrink-0 bg-zinc-900/40 border border-zinc-800/50 rounded-2xl overflow-hidden ${
        isUnavailable ? 'opacity-70' : ''
      }`}
    >
      {/* Columna Header */}
      <div className="p-4 border-b border-zinc-800/60 bg-zinc-900/60">
        {HeaderContent}
      </div>

      {/* Listado */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2 min-h-[150px]">
        {inProgressEntry && (
          <InProgressCard
            entry={inProgressEntry}
            formatElapsed={formatElapsed}
            onCancel={onCancel}
            onComplete={onCompleteService}
            actionLoading={actionLoading}
          />
        )}

        <SortableContext items={entryIds} strategy={verticalListSortingStrategy}>
          {entries.map((entry) => (
            <QueueCard
              key={entry.id}
              entry={entry}
              formatElapsed={formatElapsed}
              onCancel={onCancel}
              onStartService={onStartService}
              actionLoading={actionLoading}
              selectedBranchId={selectedBranchId}
              getBranchName={getBranchName}
              timezone={timezone}
            />
          ))}
        </SortableContext>

        {entries.length === 0 && !inProgressEntry && !children && (
          <div className="flex flex-1 items-center justify-center h-24 border-2 border-dashed border-zinc-800/50 rounded-xl text-zinc-600">
            <p className="text-xs font-medium">Arrastrar aquí</p>
          </div>
        )}

        {children && (
          <div className="mt-2 pt-2 border-t border-zinc-800/50 flex flex-col gap-2">
            {children}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Ghost Drag Overlay ─────────────────────────────────────────────────────

function DragGhost({ entry }: { entry: QueueEntry }) {
  const isBreak = entry.is_break
  const displayName = isBreak ? 'Descanso' : (entry.client?.name ?? 'Cliente')
  const tablero = useContext(TableroContext)
  const minutos = minutosDesde(entry.checked_in_at, tablero?.ahora ?? 0)
  return (
    <div className="flex w-[264px] items-center gap-2.5 rounded-xl border border-white/25 bg-card px-3 py-2.5 shadow-[0_24px_48px_-12px_rgb(0_0_0/0.85)] motion-safe:rotate-[1.5deg]">
      {isBreak ? (
        <Pause className="size-4 shrink-0 text-amber-300" aria-hidden />
      ) : (
        <GripVertical className="size-4 shrink-0 text-white/50" aria-hidden />
      )}
      <span className="shrink-0 rounded-md bg-white/[0.08] px-1.5 py-px font-mono text-[11px] font-semibold tabular-nums text-foreground/75">
        #{entry.position}
      </span>
      <span className="min-w-0 flex-1 truncate text-[0.9375rem] font-semibold text-foreground">{displayName}</span>
      {!isBreak && (
        <span className={cn('shrink-0 font-mono text-xs font-semibold tabular-nums', TEXTO_ESPERA[nivelEspera(minutos)])}>
          {formatoEspera(minutos)}
        </span>
      )}
    </div>
  )
}

/**
 * Quién "sigue" en el carril de un barbero, con las reglas de
 * `claim_next_for_barber` (mig 170) para que la etiqueta no prometa lo que el
 * motor no hace: un descanso pendiente adelante va primero (no sigue ningún
 * cliente); un turno cuya hora llegó, antes que los walk-ins; con un turno
 * dentro de la ventana de protección, el del turno si ya está (y si no, nadie:
 * el barbero lo espera); si no, el primer walk-in. La hora del turno sale de la
 * agenda, no de `priority_order` (en una entrada adoptada es la de llegada).
 */
function quienSigue(
  entries: QueueEntry[],
  tablero: Tablero | null,
  proximoTurno?: NextAppointmentInfo | null,
): string | undefined {
  if (entries[0]?.is_break) return undefined
  if (!tablero) return entries.find((e) => !e.is_break && !e.is_appointment)?.id
  const { ahora, inicioDeTurno } = tablero
  const turnos = entries
    .filter((e) => e.is_appointment && !e.is_break)
    .sort((a, b) => inicioDeTurno(a) - inicioDeTurno(b))
  const vencido = turnos.find((e) => inicioDeTurno(e) <= ahora)
  if (vencido) return vencido.id
  const ventana = protectionWindowMinutes() * 60_000
  if (proximoTurno && proximoTurno.startsAtMs <= ahora + ventana) {
    return turnos.find((e) => inicioDeTurno(e) <= ahora + ventana)?.id
  }
  return entries.find((e) => !e.is_break && !e.is_appointment)?.id
}

// ─── Dynamic Column (Top-to-Bottom) ─────────────────────────────────────────

function DynamicColumn({
  id,
  entries,
  formatElapsed,
  onCancel,
  onStartService,
  actionLoading,
  selectedBranchId,
  getBranchName,
  getBarberName,
  timezone,
  destacado = false,
}: {
  id: ColumnId
  entries: QueueEntry[]
  formatElapsed: (ts: string) => string
  onCancel: (id: string) => void
  onStartService?: (entry: QueueEntry) => void
  actionLoading: string | null
  selectedBranchId: string | null
  getBranchName: (id: string) => string
  getBarberName?: (id: string) => string | undefined
  timezone: string
  /** Hay algo arrastrándose sobre esta columna. */
  destacado?: boolean
}) {
  const { setNodeRef } = useSortable({
    id,
    data: { type: 'Column', columnId: id },
  })

  const entryIds = useMemo(() => entries.map((e) => e.id), [entries])
  const sigueId = entries.find((e) => !e.is_break)?.id

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex w-full flex-col border-b border-white/[0.07] bg-background transition-colors duration-150 md:w-[280px] md:shrink-0 md:border-b-0 md:border-r',
        destacado && 'bg-yellow-400/[0.04] md:shadow-[inset_0_3px_0_0_rgb(250_204_21/0.6)]',
      )}
    >
      <div className="sticky top-0 z-40 border-b border-white/[0.07] bg-background/95 px-3 py-3 backdrop-blur md:px-4">
        <div className="flex items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-yellow-400/10">
            <Zap className="size-4 text-yellow-300" aria-hidden />
          </span>
          <h3 className="text-[0.9375rem] font-semibold text-foreground">Dinámicos</h3>
          <span className="ml-auto rounded-full bg-white/[0.07] px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-foreground/80">
            {entries.length}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Menor espera · lo toma el primero libre</p>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-2 md:min-h-[500px] md:p-3">
        <SortableContext items={entryIds} strategy={verticalListSortingStrategy}>
          {entries.map((entry) => (
            <QueueCard
              key={entry.id}
              entry={entry}
              formatElapsed={formatElapsed}
              onCancel={onCancel}
              onStartService={onStartService}
              actionLoading={actionLoading}
              selectedBranchId={selectedBranchId}
              getBranchName={getBranchName}
              getBarberName={getBarberName}
              timezone={timezone}
              sigue={entry.id === sigueId}
            />
          ))}
        </SortableContext>
        {entries.length === 0 && (
          <div
            className={cn(
              'flex min-h-[100px] flex-1 items-center justify-center rounded-xl border border-dashed text-xs font-medium transition-colors',
              destacado ? 'border-yellow-400/50 text-yellow-200' : 'border-white/10 text-muted-foreground',
            )}
          >
            Soltá acá para Menor espera
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Barber Row (Left-to-Right) ─────────────────────────────────────────────

function BarberRow({
  barber,
  entries,
  inProgressEntry,
  notClockedInBarbers,
  schedules,
  now,
  shiftEndMargin,
  formatElapsed,
  onCancel,
  onStartService,
  onCompleteService,
  actionLoading,
  selectedBranchId,
  getBranchName,
  timezone,
  nextAppointment,
  cortesHoy = 0,
  destacado = false,
}: {
  barber: BarberRow
  entries: QueueEntry[]
  inProgressEntry?: QueueEntry
  notClockedInBarbers?: Set<string>
  schedules?: StaffSchedule[]
  now?: number
  shiftEndMargin?: number
  formatElapsed: (ts: string) => string
  onCancel: (id: string) => void
  onStartService?: (entry: QueueEntry) => void
  onCompleteService?: (entry: QueueEntry) => void
  actionLoading: string | null
  selectedBranchId: string | null
  getBranchName: (id: string) => string
  timezone: string
  nextAppointment?: NextAppointmentInfo | null
  /** Cortes cobrados hoy. */
  cortesHoy?: number
  /** Hay algo arrastrándose sobre este carril. */
  destacado?: boolean
}) {
  const { setNodeRef } = useSortable({
    id: barber.id,
    data: { type: 'Column', columnId: barber.id },
  })

  const isNotClocked = notClockedInBarbers?.has(barber.id)
  const isHidden = barber.hidden_from_checkin
  const isShiftEnd =
    !isNotClocked &&
    schedules &&
    now !== undefined &&
    shiftEndMargin !== undefined &&
    isBarberBlockedByShiftEnd(
      barber as unknown as Staff,
      inProgressEntry ? [inProgressEntry] : [],
      schedules,
      now,
      shiftEndMargin
    )
  const isUnavailable = isHidden || isNotClocked || !!isShiftEnd

  // El estado del barbero: la etiqueta y el anillo de la foto dicen lo mismo.
  // Verde cortando, ámbar descanso o fin de turno, blanco libre (lo que el
  // mostrador tiene que mirar), gris si no está para la fila.
  let statusText: string
  let statusClass: string
  let anillo: string

  if (isHidden) {
    statusText = 'Oculto en check-in'
    statusClass = 'text-muted-foreground'
    anillo = 'ring-white/15'
  } else if (isNotClocked) {
    statusText = 'Sin entrada'
    statusClass = 'text-muted-foreground'
    anillo = 'ring-white/15'
  } else if (isShiftEnd) {
    statusText = 'Fin de turno'
    statusClass = 'text-amber-300'
    anillo = 'ring-amber-500/60'
  } else if (inProgressEntry) {
    statusText = inProgressEntry.is_break ? 'En descanso' : 'Atendiendo'
    statusClass = inProgressEntry.is_break ? 'text-amber-300' : 'text-emerald-300'
    anillo = inProgressEntry.is_break ? 'ring-amber-400' : 'ring-emerald-400'
  } else {
    statusText = 'Disponible'
    statusClass = 'text-foreground'
    anillo = 'ring-foreground/80'
  }

  const entryIds = useMemo(() => entries.map((e) => e.id), [entries])
  const tablero = useContext(TableroContext)
  const sigueId = quienSigue(entries, tablero, nextAppointment)
  const enEspera = entries.filter((e) => !e.is_break).length

  return (
    <div
      className={cn(
        'flex flex-col border-b border-white/[0.07] transition-colors duration-150 md:min-h-[96px] md:flex-row md:items-stretch',
        isUnavailable && !destacado && 'opacity-60',
        destacado && 'bg-white/[0.06]',
      )}
    >
      {/* ── El barbero (celda fija, pegada a la izquierda al scrollear) ── */}
      <div
        className={cn(
          'z-20 flex w-full items-center gap-3 border-b border-white/[0.07] px-3 py-2.5 transition-[background-color,box-shadow] md:sticky md:left-[280px] md:w-[216px] md:shrink-0 md:border-b-0 md:border-r md:px-3.5',
          destacado
            ? 'bg-card shadow-[inset_4px_0_0_0_rgb(255_255_255/0.85)] md:shadow-[inset_4px_0_0_0_rgb(255_255_255/0.85),8px_0_16px_-12px_rgba(0,0,0,0.8)]'
            : 'bg-background md:shadow-[8px_0_16px_-12px_rgba(0,0,0,0.8)]',
        )}
      >
        <span
          className={cn(
            'relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted ring-2 ring-offset-2 ring-offset-background',
            anillo,
          )}
        >
          {barber.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={barber.avatar_url}
              alt={barber.full_name}
              className="h-full w-full object-cover"
              style={{ objectPosition: 'center 15%' }}
              draggable={false}
            />
          ) : (
            <User className="size-5 text-muted-foreground" aria-hidden />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-sm font-semibold leading-tight text-foreground">{barber.full_name}</h3>
          <p className={cn('mt-0.5 truncate text-xs font-medium', statusClass)}>{statusText}</p>
          <p className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1" title={`${cortesHoy} ${cortesHoy === 1 ? 'corte' : 'cortes'} hoy`}>
              <Scissors className="size-3" aria-hidden />
              <span className="font-mono tabular-nums">{cortesHoy}</span> hoy
            </span>
            {enEspera > 0 && (
              <span>
                <span className="font-mono tabular-nums text-foreground/80">{enEspera}</span> en espera
              </span>
            )}
          </p>
          {/* Próximo turno del día: hasta acá el dashboard no tenía forma de
              saber que a este barbero le entra alguien con hora reservada. */}
          {nextAppointment && (
            <p
              className="mt-1 flex items-center gap-1 text-[11px] font-medium text-violet-300"
              title={`Próximo turno ${nextAppointment.timeLabel} · ${nextAppointment.appointment.client?.name ?? 'Cliente'}`}
            >
              <CalendarClock className="size-3 shrink-0" aria-hidden />
              <span className="truncate">
                Turno {nextAppointment.timeLabel} · {nextAppointment.appointment.client?.name ?? 'Cliente'}
              </span>
              {nextAppointment.minutesUntil <= 60 && (
                <span className="shrink-0 rounded bg-violet-500/15 px-1 py-px font-mono text-[10px] tabular-nums text-violet-200">
                  {nextAppointment.minutesUntil <= 1 ? 'ahora' : `${nextAppointment.minutesUntil}m`}
                </span>
              )}
            </p>
          )}
        </div>
      </div>

      {/* ── Sus clientes, de izquierda a derecha (arrastrables) ── */}
      <div
        ref={setNodeRef}
        className="isolate flex flex-1 flex-col gap-1.5 p-2 md:min-w-[280px] md:flex-row md:gap-0 md:p-0"
      >
        {inProgressEntry && (
          <div className="w-full md:w-[272px] md:shrink-0 md:p-2">
            <InProgressCard
              entry={inProgressEntry}
              formatElapsed={formatElapsed}
              onCancel={onCancel}
              onComplete={onCompleteService}
              actionLoading={actionLoading}
            />
          </div>
        )}

        <SortableContext items={entryIds} strategy={horizontalListSortingStrategy}>
          {entries.map((entry) => (
            <div key={entry.id} className="w-full md:w-[272px] md:shrink-0 md:p-2">
              <QueueCard
                entry={entry}
                formatElapsed={formatElapsed}
                onCancel={onCancel}
                onStartService={onStartService}
                actionLoading={actionLoading}
                selectedBranchId={selectedBranchId}
                getBranchName={getBranchName}
                timezone={timezone}
                sigue={entry.id === sigueId}
              />
            </div>
          ))}
        </SortableContext>

        {/* Carril vacío: un solo lugar, que se ilumina si le están por soltar a alguien */}
        {entries.length === 0 && !inProgressEntry && (
          <div className="w-full md:w-[272px] md:shrink-0 md:p-2">
            <div
              className={cn(
                'flex h-full min-h-[3.25rem] items-center justify-center rounded-xl border border-dashed text-xs font-medium transition-colors',
                destacado ? 'border-white/40 text-foreground' : 'border-white/[0.08] text-muted-foreground/70',
              )}
            >
              {destacado ? 'Soltá acá' : 'Sin clientes'}
            </div>
          </div>
        )}

        <div className="hidden md:flex md:min-w-[272px] md:flex-1" />
      </div>
    </div>
  )
}

// ─── Resumen ────────────────────────────────────────────────────────────────

/** Un número del resumen de arriba, con lo que lo explica al lado. */
function ResumenFila({
  icono,
  fondoIcono,
  titulo,
  valor,
  detalle,
}: {
  icono: React.ReactNode
  fondoIcono: string
  titulo: string
  valor: number
  detalle?: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 py-2.5">
      <span className={cn('hidden size-9 shrink-0 items-center justify-center rounded-lg sm:flex', fondoIcono)}>{icono}</span>
      <div className="min-w-0">
        <p className="truncate text-[11px] leading-none text-muted-foreground">{titulo}</p>
        <p className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-1.5 leading-none">
          <span className="font-mono text-xl font-semibold tabular-nums text-foreground">{valor}</span>
          {detalle && <span className="truncate text-[11px] text-muted-foreground">{detalle}</span>}
        </p>
      </div>
    </div>
  )
}

// ─── Componente Principal ───────────────────────────────────────────────────

export function FilaClient({ initialEntries, barbers, branches, breakConfigs, timezone, orgId }: FilaClientProps) {
  const selectedBranchId = useBranchStore(s => s.selectedBranchId)
  const [entries, setEntries] = useState<QueueEntry[]>(initialEntries)
  const [liveBarbers, setLiveBarbers] = useState<BarberRow[]>(barbers)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  // Ref que trackea el último estado confirmado de la DB (para comparar en drag & drop)
  const confirmedEntriesRef = useRef<QueueEntry[]>(initialEntries)
  const [schedules, setSchedules] = useState<StaffSchedule[]>([])
  const [now, setNow] = useState(() => Date.now())
  const [shiftEndMargin, setShiftEndMargin] = useState(35)
  const [dailyServiceCounts, setDailyServiceCounts] = useState<Record<string, number>>({})
  const [latestAttendance, setLatestAttendance] = useState<Record<string, string>>({})
  // Turnos del día, sólo lectura: alimentan el "próximo turno" de cada barbero.
  const [todayAppointments, setTodayAppointments] = useState<Appointment[]>([])
  
  const [completingEntry, setCompletingEntry] = useState<QueueEntry | null>(null)
  // Confirmación para cancelar un corte ya iniciado (in_progress) desde el dashboard.
  const [cancelConfirmEntry, setCancelConfirmEntry] = useState<QueueEntry | null>(null)
  /** Cliente del pool al que hay que elegirle barbero antes de arrancar el corte. */
  const [asignarBarberoEntry, setAsignarBarberoEntry] = useState<QueueEntry | null>(null)

  const [draggedEntry, setDraggedEntry] = useState<QueueEntry | null>(null)
  const [draggedTemplate, setDraggedTemplate] = useState<BreakConfig | null>(null)
  /** El carril (barbero o Dinámicos) sobre el que se está arrastrando: se ilumina. */
  const [carrilDestino, setCarrilDestino] = useState<ColumnId | null>(null)

  // ── Registro manual & búsqueda de clientes ─────────────────────────────────
  const [manualDialogOpen, setManualDialogOpen] = useState(false)
  const [searchDialogOpen, setSearchDialogOpen] = useState(false)
  const [services, setServices] = useState<Service[]>([])
  const DYNAMIC_BARBER = '__dynamic__'
  const [manualForm, setManualForm] = useState({ phone: '', name: '', serviceId: '', barberId: DYNAMIC_BARBER, isSpecial: false })
  const [manualLoading, setManualLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{ id: string; name: string; phone: string }[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchExecuted, setSearchExecuted] = useState(false)
  const [selectedSearchClient, setSelectedSearchClient] = useState<{ id: string; name: string; phone: string } | null>(null)
  const [searchServiceId, setSearchServiceId] = useState('')
  const [searchBarberId, setSearchBarberId] = useState(DYNAMIC_BARBER)
  const [searchCheckinLoading, setSearchCheckinLoading] = useState(false)
  // Asesoría (mig 217): el interruptor de la sucursal elegida, leído al abrir el
  // registro. Guarda de qué sucursal es: cambiar de sucursal no hereda el valor.
  const [asesoriaSucursal, setAsesoriaSucursal] = useState<{ branchId: string; habilitada: boolean } | null>(null)

  const supabase = useMemo(() => createClient(), [])

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 12 } }),
    useSensor(KeyboardSensor)
  )

  // ── Fetches (Omitido para brevedad en review, la lógica es la misma) ───────

  const fetchQueue = useCallback(async () => {
    // Query liviano: solo los campos que el kanban efectivamente renderiza.
    // Evitamos clients(*) y staff(*) que traen columnas no usadas.
    // FIX #9: scopear por organization_id. Sin esto (y con la policy pública
    // queue_entries_public_read) el dashboard traía la cola de TODAS las orgs.
    const { data } = await supabase
      .from('queue_entries')
      // Embeds por nombre de constraint (Known Risk #15): con dos FKs a `staff`,
      // PostgREST rechaza la query entera con PGRST201 y esto devolvía null.
      // El `*` trae `pidio_asesoria` y `asesoria_vista_at` (mig 217) sin
      // consultas extra: el sello de asesoría sale de la misma fila.
      .select('*, client:clients!queue_entries_client_id_fkey(id, name, phone), barber:staff!queue_entries_barber_id_fkey(id, full_name, avatar_url)')
      .eq('organization_id', orgId)
      .in('status', ['waiting', 'in_progress'])
      // Orden por `priority_order` (la hora de llegada = el FIFO real), NO por
      // `position`: esa columna se recicla (`next_queue_position` = MAX+1 sobre las
      // ACTIVAS, así que al vaciarse la fila vuelve a 1) y se repite entre entradas
      // vivas. Ordenando por ella, el kanban dibujaba la fila en un orden que no era
      // el de llegada — y como el drag derivaba de ese dibujo, ESE orden equivocado
      // era el que terminaba escrito en `priority_order`.
      .order('priority_order')
      .order('position')
    if (data) {
      const typed = data as QueueEntry[]
      setEntries(typed)
      confirmedEntriesRef.current = typed
    }
  }, [supabase, orgId])

  const fetchBarbers = useCallback(async () => {
    // FIX #9: scopear por organization_id (paridad con el server-fetch de page.tsx).
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
    // Bounds del día en TZ de la org (no UTC). El bug previo usaba
    // `new Date().setHours(0,0,0,0)` y `new Date().getDay()`: ambos basados
    // en runtime TZ del server (UTC en Vercel). Pasada la medianoche UTC el
    // dailyServiceCounts quedaba en 0 y el day_of_week saltaba un día.
    const { getLocalDayBounds } = await import('@/lib/time-utils')
    const { start: dayStartISO, end: dayEndISO } = getLocalDayBounds(timezone)
    const localDow = new Date(
      new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date()),
    ).getDay()

    const [schedRes, settingsRes, todayVisitsRes, attendanceRes] =
      await Promise.all([
        supabase
          .from('staff_schedules')
          .select('*')
          .eq('day_of_week', localDow)
          .eq('is_active', true),
        // Por organización: `app_settings` se lee entera con cualquier rol (policy
        // `settings_anon_read`), una fila por org. Sin el filtro `.maybeSingle()`
        // recibía 14 filas, devolvía error y el tablero usaba el margen de fin de
        // turno por defecto (35) donde Monaco configuró 15: marcaba "Fin de turno"
        // 20 minutos antes de tiempo.
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
        // (mig 131 / audit-2026-05-09): query `lastVisits` removida porque alimentaba
        // un state `lastCompletedAt` que nadie leía (el fairness gate del cliente
        // que lo usaba se eliminó). Se conserva el cálculo en queue-panel.tsx donde
        // sí se usa.
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
      const margin = (settingsRes.data as { shift_end_margin_minutes?: number })
        .shift_end_margin_minutes
      if (typeof margin === 'number' && margin >= 0) setShiftEndMargin(margin)
    }
    if (todayVisitsRes?.data) {
      const counts: Record<string, number> = {}
      for (const v of todayVisitsRes.data as { barber_id: string }[])
        counts[v.barber_id] = (counts[v.barber_id] || 0) + 1
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

  /**
   * Agenda del día de las sucursales visibles. Se usa sólo para anunciar el
   * próximo turno de cada barbero — la fila no cambia por esto.
   */
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

  /** Hora RESERVADA de cada turno del día (para la etiqueta de las tarjetas de turno). */
  const horaPorTurno = useMemo(() => {
    const map = new Map<string, string>()
    for (const a of todayAppointments) {
      const label = formatHourMinute(appointmentInstantMs(a.appointment_date, a.start_time, timezone), timezone)
      if (label) map.set(a.id, label)
    }
    return map
  }, [todayAppointments, timezone])

  const horaDeTurno = useCallback(
    (entry: QueueEntry) => (entry.appointment_id ? horaPorTurno.get(entry.appointment_id) ?? null : null),
    [horaPorTurno],
  )

  /** Instante (ms) de la hora reservada de cada turno del día. */
  const inicioPorTurno = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of todayAppointments) map.set(a.id, appointmentInstantMs(a.appointment_date, a.start_time, timezone))
    return map
  }, [todayAppointments, timezone])

  const inicioDeTurno = useCallback(
    (entry: QueueEntry) => {
      const deLaAgenda = entry.appointment_id ? inicioPorTurno.get(entry.appointment_id) : undefined
      return deLaAgenda !== undefined && Number.isFinite(deLaAgenda) ? deLaAgenda : new Date(entry.priority_order).getTime()
    },
    [inicioPorTurno],
  )

  /** Lo que las tarjetas leen del tablero: la hora de los turnos y el reloj de 5 s. */
  const tablero = useMemo(() => ({ horaDeTurno, inicioDeTurno, ahora: now }), [horaDeTurno, inicioDeTurno, now])

  // Un fetch al montar (y al cambiar de sucursal) + el refresco de 60s de más
  // abajo. Sin realtime ni polling corto: es dato de baja frecuencia y la DB ya
  // se ahogó una vez por escuchar de más (mig 124).
  useEffect(() => {
    const apptId = setTimeout(() => { fetchAppointments() }, 0)
    return () => clearTimeout(apptId)
  }, [fetchAppointments])

  useVisibilityRefresh(fetchAppointments, 60_000)

  useEffect(() => {
    // Diferimos las primeras llamadas para no disparar setState dentro del
    // effect body (React Compiler detecta cascading renders).
    const initId = setTimeout(() => {
      fetchQueue()
      fetchBarbers()
      fetchSchedules()
    }, 0)

    const channel = supabase
      .channel('admin-queue')
      // FIX #9: filtrar por organization_id para no recibir el fan-out de cambios
      // de queue_entries/staff de OTRAS orgs (regresión del incidente mig 124).
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queue_entries', filter: `organization_id=eq.${orgId}` }, () =>
        fetchQueue()
      )
      // staff → refresca lista de barberos y sus estados
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff', filter: `organization_id=eq.${orgId}` }, () =>
        fetchBarbers()
      )
      // NOTA: el listener de attendance_logs fue eliminado porque esa tabla fue
      // removida de la supabase_realtime publication. Los horarios/asistencia se
      // refrescan al reconectar el WebSocket (evento SUBSCRIBED) y vía polling de 30s.
      .subscribe((status) => {
        // Re-fetch todo al reconectar. Defer a microtask para no
        // disparar setState durante el callback de subscribe (cascading renders).
        if (status === 'SUBSCRIBED') {
          queueMicrotask(() => {
            fetchQueue()
            fetchBarbers()
            fetchSchedules()
          })
        }
      })

    return () => { clearTimeout(initId); supabase.removeChannel(channel) }
  }, [supabase, fetchQueue, fetchBarbers, fetchSchedules, orgId])

  // Refresh data when returning to tab or as polling fallback
  useVisibilityRefresh(
    useCallback(() => {
      fetchQueue()
      fetchBarbers()
      fetchSchedules()
    }, [fetchQueue, fetchBarbers, fetchSchedules]),
    30_000
  )

  useEffect(() => {
    // 5s en lugar de 1s: textos "elapsed" no necesitan resolución de segundo.
    // El cambio reduce ~30-60% CPU en tablets durante el horario de operación.
    const interval = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(interval)
  }, [])

  // ── Fetch servicios para registro manual ──────────────────────────────────
  useEffect(() => {
    supabase
      .from('services')
      .select('*')
      .eq('is_active', true)
      .in('availability', ['checkin', 'both'])
      .order('name')
      .then(({ data }) => { if (data) setServices(data as Service[]) })
  }, [supabase])

  // ── Asesoría en el registro manual (mig 217) ──────────────────────────────
  // «Pidió asesoría» se ofrece sólo si la sucursal la tiene prendida, igual que
  // en la tablet. Se pregunta cada vez que se abre un registro (el dueño la
  // prende y apaga desde Configuración). Falla CERRADA: sin el interruptor
  // confirmado no se ofrece, y el servidor la vuelve a validar al anotar.
  const dialogoDeAltaAbierto = manualDialogOpen || searchDialogOpen
  useEffect(() => {
    if (!dialogoDeAltaAbierto || !selectedBranchId) return
    let vigente = true
    asesoriaHabilitadaEnSucursal(selectedBranchId)
      .then((habilitada) => {
        if (vigente) setAsesoriaSucursal({ branchId: selectedBranchId, habilitada })
      })
      .catch((e: unknown) => {
        console.error('[fila] interruptor de asesoría', e)
        if (vigente) setAsesoriaSucursal({ branchId: selectedBranchId, habilitada: false })
      })
    return () => {
      vigente = false
    }
  }, [dialogoDeAltaAbierto, selectedBranchId])
  const asesoriaDisponible =
    !!selectedBranchId && asesoriaSucursal?.branchId === selectedBranchId && asesoriaSucursal.habilitada
  // Lo elegido en cada desplegable, sin una «asesoría» que la sucursal ya no ofrece.
  const servicioManual =
    manualForm.serviceId === OPCION_ASESORIA && !asesoriaDisponible ? '' : manualForm.serviceId
  const servicioBuscado = searchServiceId === OPCION_ASESORIA && !asesoriaDisponible ? '' : searchServiceId

  /** Pone el servicio o el pedido de asesoría en el FormData de `checkinClient`. */
  function cargarServicioOAsesoria(fd: FormData, valor: string): boolean {
    if (valor === OPCION_ASESORIA) {
      fd.set('asesoria', '1')
      return true
    }
    if (valor) fd.set('service_id', valor)
    return false
  }

  /**
   * El cliente ya tenía lugar: si pidió asesoría, qué pasó con el pedido.
   * `asesoriaMotivo` dice por qué NO se sumó (null = se sumó o no la pidió).
   */
  function avisarYaEnFila(r: {
    asesoriaPedida?: boolean
    asesoriaSumada?: boolean
    asesoriaMotivo?: MotivoPedidoAsesoria | null
  }) {
    const titulo = 'El cliente ya está en la fila'
    if (r.asesoriaSumada) {
      toast.info(titulo, { description: 'Sumamos su pedido de asesoría: le avisamos en el panel del barbero.' })
      return
    }
    if (!r.asesoriaPedida) {
      toast.info(titulo)
      return
    }
    switch (r.asesoriaMotivo) {
      case 'turno':
        // Un turno no tiene la salida «solo asesoría»: la marca no se le suma.
        toast.info(titulo, { description: 'Tiene turno: la asesoría se la pide a su barbero cuando lo atienda.' })
        return
      case 'limite':
        toast.warning(titulo, {
          description: 'No pudimos sumar su pedido de asesoría: esperá un momento y volvé a intentar.',
        })
        return
      case 'en_curso':
        toast.info(titulo, { description: 'Ya lo están atendiendo: avisale a su barbero que quiere asesoría.' })
        return
      case 'deshabilitada':
        toast.info(titulo, { description: 'La sucursal tiene la asesoría apagada: avisale a su barbero.' })
        return
      default:
        toast.info(titulo, { description: 'Avisale a su barbero que quiere asesoría.' })
    }
  }

  /** Alta hecha. Si pidió asesoría y el servidor la descartó (la apagaron en el medio), se dice. */
  function avisarAlta(titulo: string, pidioAsesoria: boolean, asesoriaQuedo: boolean) {
    if (pidioAsesoria && !asesoriaQuedo) {
      toast.warning(titulo, { description: 'Quedó sin el pedido de asesoría: la sucursal la tiene apagada.' })
    } else if (pidioAsesoria) {
      toast.success(titulo, { description: 'Pidió asesoría: le avisamos en el panel del barbero.' })
    } else {
      toast.success(titulo)
    }
  }

  // ── Handlers registro manual ──────────────────────────────────────────────
  const handleManualCheckin = async () => {
    if (!selectedBranchId) {
      toast.error('Seleccioná una sucursal primero')
      return
    }
    // Cliente especial: sin teléfono y con nombre opcional (lo resuelve el server).
    if (!manualForm.isSpecial && (!manualForm.phone || !manualForm.name)) {
      toast.error('Nombre y teléfono son obligatorios')
      return
    }
    setManualLoading(true)
    const fd = new FormData()
    fd.set('name', manualForm.name)
    fd.set('branch_id', selectedBranchId)
    if (manualForm.isSpecial) {
      fd.set('special', '1')
    } else {
      fd.set('phone', manualForm.phone)
    }
    // Alta manual del dashboard: el origen que queda en `clients.signup_source`
    // es 'staff', no la tablet (mig 210).
    fd.set('origen', 'staff')
    // La asesoría reemplaza al servicio, como en la tablet (mig 217).
    const pideAsesoria = cargarServicioOAsesoria(fd, servicioManual)
    if (manualForm.barberId && manualForm.barberId !== DYNAMIC_BARBER) {
      fd.set('barber_id', manualForm.barberId)
    }
    let result: Awaited<ReturnType<typeof checkinClient>>
    try {
      result = await checkinClient(fd)
    } catch (e) {
      avisarAccionFallida(e, 'No pudimos registrar al cliente. Revisá la conexión y probá de nuevo.')
      return
    } finally {
      setManualLoading(false)
    }
    if (result.error) {
      toast.error(result.error)
    } else if (result.alreadyInQueue) {
      avisarYaEnFila(result)
    } else {
      avisarAlta(
        manualForm.isSpecial ? 'Cliente especial agregado a la fila' : 'Cliente registrado en la fila',
        pideAsesoria,
        result.asesoria === true,
      )
      setManualForm({ phone: '', name: '', serviceId: '', barberId: DYNAMIC_BARBER, isSpecial: false })
      setManualDialogOpen(false)
    }
  }

  // ── Handlers búsqueda de clientes ─────────────────────────────────────────
  const handleSearch = useCallback(async (query: string) => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setSearchResults([])
      setSearchExecuted(false)
      return
    }
    setSearchLoading(true)
    setSearchExecuted(true)
    let result: Awaited<ReturnType<typeof searchClients>>
    try {
      result = await searchClients(trimmed)
    } catch (e) {
      avisarAccionFallida(e, 'No pudimos buscar clientes. Revisá la conexión y probá de nuevo.')
      return
    } finally {
      setSearchLoading(false)
    }
    if (result.error) {
      toast.error(result.error)
    } else {
      setSearchResults(result.data ?? [])
    }
  }, [])

  // Búsqueda automática al escribir (debounce). Diferimos los resets vía
  // setTimeout para que los setState se ejecuten fuera del effect body.
  useEffect(() => {
    let cancelled = false
    if (searchQuery.trim().length < 2) {
      const resetId = setTimeout(() => {
        if (cancelled) return
        setSearchResults([])
        setSearchExecuted(false)
      }, 0)
      return () => { cancelled = true; clearTimeout(resetId) }
    }
    const timer = setTimeout(() => handleSearch(searchQuery), 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [searchQuery, handleSearch])

  const handleSearchCheckin = async (client: { id: string; name: string; phone: string }) => {
    if (!selectedBranchId) {
      toast.error('Seleccioná una sucursal primero')
      return
    }
    setSearchCheckinLoading(true)
    const fd = new FormData()
    fd.set('name', client.name)
    fd.set('phone', client.phone)
    fd.set('branch_id', selectedBranchId)
    // El cliente ya existe (sale del buscador), así que acá no se crea ninguna
    // ficha; el origen viaja igual por si el alta terminara ocurriendo.
    fd.set('origen', 'staff')
    const pideAsesoria = cargarServicioOAsesoria(fd, servicioBuscado)
    if (searchBarberId && searchBarberId !== DYNAMIC_BARBER) {
      fd.set('barber_id', searchBarberId)
    }
    let result: Awaited<ReturnType<typeof checkinClient>>
    try {
      result = await checkinClient(fd)
    } catch (e) {
      avisarAccionFallida(e, 'No pudimos registrar al cliente. Revisá la conexión y probá de nuevo.')
      return
    } finally {
      setSearchCheckinLoading(false)
    }
    if (result.error) {
      toast.error(result.error)
    } else if (result.alreadyInQueue) {
      avisarYaEnFila(result)
    } else {
      avisarAlta(`${client.name} registrado en la fila`, pideAsesoria, result.asesoria === true)
      setSearchQuery('')
      setSearchResults([])
      setSelectedSearchClient(null)
      setSearchServiceId('')
      setSearchBarberId(DYNAMIC_BARBER)
      setSearchDialogOpen(false)
    }
  }

  // ── Filtros y Categorización ──────────────────────────────────────────────

  const notClockedInBarbers = useMemo(() => {
    const s = new Set<string>()
    for (const b of liveBarbers)
      if (latestAttendance[b.id] !== 'clock_in') s.add(b.id)
    return s
  }, [liveBarbers, latestAttendance])

  const filteredBarbers = useMemo(() => {
    return selectedBranchId
      ? liveBarbers.filter((b) => b.branch_id === selectedBranchId)
      : liveBarbers
  }, [selectedBranchId, liveBarbers])

  const branchEntries = useMemo(() => {
    return selectedBranchId
      ? entries.filter(e => e.branch_id === selectedBranchId)
      : entries
  }, [entries, selectedBranchId])

  const getEntryColumnId = useCallback((entry: QueueEntry): ColumnId => {
    if (entry.status === 'in_progress') return entry.barber_id ?? '__dynamic__'
    // Modelo pool (mig 134): el dinámico vive con barber_id = NULL y va a la
    // columna Dinámicos. Cualquier barbero libre lo reclama vía
    // claim_next_for_barber (pool FIFO no bloqueante) — no hay binding.
    if (entry.is_dynamic) return '__dynamic__'
    if (entry.barber_id) return entry.barber_id
    return '__dynamic__'
  }, [])

  const columnsData = useMemo(() => {
    const cols: Record<ColumnId, QueueEntry[]> = {
      __dynamic__: [],
    }
    for (const b of filteredBarbers) {
      cols[b.id] = []
    }

    // Orden por `priority_order` (llegada real), con `position` sólo de desempate.
    // Este sort es el que alimenta las columnas del tablero, así que pisaba el
    // `.order('priority_order')` del fetch: el kanban dibujaba la fila en orden de
    // `position` —una columna que se recicla y se duplica— mientras el panel del
    // barbero y `claim_next_for_barber` ejecutaban en orden de llegada. Y como el
    // drag deriva el nuevo orden de lo que está dibujado, ese orden equivocado era
    // el que terminaba escrito.
    const sortedEntries = [...branchEntries].sort((a, b) => {
      const pa = new Date(a.priority_order).getTime()
      const pb = new Date(b.priority_order).getTime()
      if (pa !== pb) return pa - pb
      return a.position - b.position
    })

    for (const entry of sortedEntries) {
      if (entry.status !== 'waiting') continue
      const colId = getEntryColumnId(entry)
      if (cols[colId]) cols[colId].push(entry)
    }

    return cols
  }, [branchEntries, filteredBarbers, getEntryColumnId])

  const nextAppointmentByBarber = useMemo(() => {
    // Los turnos "con cualquiera disponible" (barber_id NULL) no se anuncian en
    // ninguna columna: recién se sabe quién los atiende al hacer el check-in.
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

  const inProgressData = useMemo(() => {
    const map: Record<string, QueueEntry> = {}
    for (const e of branchEntries) {
      if (e.status === 'in_progress' && e.barber_id) {
        map[e.barber_id] = e
      }
    }
    return map
  }, [branchEntries])

  // ── Dnd handlers ─────────────────────────────────────────────────────────

  /**
   * El shell del dashboard cambia de sección deslizando el dedo de costado: con
   * esta marca sabe que el gesto es un arrastre de tarjeta y no navega
   * (dashboard-shell.tsx). Se saca un tick después, para que el `touchend` que
   * soltó la tarjeta todavía la vea.
   */
  function marcarArrastre(si: boolean) {
    if (si) document.documentElement.setAttribute('data-arrastrando', '')
    else setTimeout(() => document.documentElement.removeAttribute('data-arrastrando'), 0)
  }

  useEffect(() => () => document.documentElement.removeAttribute('data-arrastrando'), [])

  /**
   * Con "todas las sucursales" hay carriles de barberos de las cuatro: un
   * cliente no se pasa al barbero (ni al lugar en la fila) de otra sucursal —su
   * entrada seguiría en la suya con un barbero que no atiende ahí.
   */
  function esDeOtraSucursal(entry: QueueEntry, colId: ColumnId | null, overEntry?: QueueEntry) {
    if (overEntry && overEntry.branch_id !== entry.branch_id) return true
    if (!colId || colId === '__dynamic__') return false
    const barbero = liveBarbers.find((b) => b.id === colId)
    return !!barbero?.branch_id && barbero.branch_id !== entry.branch_id
  }

  function handleDragStart(event: DragStartEvent) {
    const { active } = event
    marcarArrastre(true)

    if (active.data.current?.isTemplate) {
      setDraggedTemplate(active.data.current.config)
      return
    }

    const activeEntry = branchEntries.find((e) => e.id === active.id)
    if (activeEntry) setDraggedEntry(activeEntry)
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event
    if (!over) {
      setCarrilDestino(null)
      return
    }

    const activeId = active.id
    const overId = over.id
    const isTemplate = active.data.current?.isTemplate

    // Encontrar columna destino (over puede ser una Row o una Columna)
    const overData = over.data.current
    let targetColId: ColumnId | null = null

    if (overData?.type === 'Column') {
      targetColId = overData.columnId
    } else {
      const overEntry = entries.find(e => e.id === overId)
      if (overEntry) targetColId = getEntryColumnId(overEntry)
    }

    if (!targetColId) {
      setCarrilDestino(null)
      return
    }

    if (isTemplate) {
      // It's a template, don't update `entries` optimistically during dragOver since it's not a real entry
      // It just hovers perfectly fine thanks to DragOverlay. Un descanso sólo va a un barbero.
      setCarrilDestino(targetColId === '__dynamic__' ? null : targetColId)
      return
    }

    // Encontrar entry original
    const activeEntry = entries.find(e => e.id === activeId)
    if (!activeEntry) return
    const otraSucursal = esDeOtraSucursal(activeEntry, targetColId, entries.find(e => e.id === overId))
    setCarrilDestino(otraSucursal ? null : targetColId)
    const activeColId = getEntryColumnId(activeEntry)

    if (activeColId === targetColId) return
    if (otraSucursal) return

    // Mover optimísticamente de columna usando setEntries
    setEntries(prev => {
      const activeItems = [...prev]
      const activeIdx = activeItems.findIndex(e => e.id === activeId)
      if (activeIdx === -1) return prev

      // Modificamos el item para que pertenezca a la nueva columna
      // (sin cambiar aún la DB)
      const newItem = { ...activeItems[activeIdx] }
      if (targetColId === '__dynamic__') {
        newItem.barber_id = null
        newItem.is_dynamic = true
      } else {
        newItem.barber_id = targetColId
        newItem.is_dynamic = false
      }

      // Lo quitamos de su pos anterior
      activeItems.splice(activeIdx, 1)

      // Si over es un item de la columna destino, lo ponemos antes/después
      const overIdx = activeItems.findIndex(e => e.id === overId)
      const newIndex = overIdx >= 0 ? overIdx : activeItems.length

      activeItems.splice(newIndex, 0, newItem)
      return activeItems
    })
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setDraggedEntry(null)
    // También el descanso en la mano: si quedaba puesto, el arrastre siguiente
    // de un cliente dibujaba las dos fichas juntas debajo del puntero.
    setDraggedTemplate(null)
    setCarrilDestino(null)
    marcarArrastre(false)

    if (!over) {
      fetchQueue()
      return
    }

    const activeId = active.id
    const overId = over.id
    const isTemplate = active.data.current?.isTemplate

    if (isTemplate) {
      // Identify target column
      const overData = over.data.current
      let targetColId: ColumnId | null = null

      if (overData?.type === 'Column') {
        targetColId = overData.columnId
      } else {
        const overEntry = entries.find(e => e.id === overId)
        if (overEntry) targetColId = getEntryColumnId(overEntry)
      }

      // Can only assign break to a barber column
      if (targetColId && targetColId !== '__dynamic__') {
        const config = active.data.current?.config as BreakConfig
        if (!config || !selectedBranchId && !config.branch_id) return // We need branch_id

        const branchId = selectedBranchId || config.branch_id
        setActionLoading('creating-break')
        try {
          const result = await createBreakEntry(branchId, targetColId, config.name)
          if ('error' in result) {
            toast.error(result.error)
          } else {
            toast.success('Descanso asignado al barbero')
          }
        } catch (e) {
          avisarAccionFallida(e, 'No pudimos asignar el descanso. Probá de nuevo.')
        } finally {
          await fetchQueue()
          setActionLoading(null)
        }
      }
      return
    }

    const activeIdx = entries.findIndex(e => e.id === activeId)
    if (activeIdx === -1) return
    const arrastrada = entries[activeIdx]

    // Soltada sobre un barbero (o una tarjeta) de otra sucursal: no se mezcla.
    const overEntryFinal = entries.find(e => e.id === overId)
    const overColId: ColumnId | null =
      over.data.current?.type === 'Column'
        ? (over.data.current.columnId as ColumnId)
        : overEntryFinal
          ? getEntryColumnId(overEntryFinal)
          : null
    if (esDeOtraSucursal(arrastrada, overColId, overEntryFinal)) {
      toast.error('No se puede pasar a alguien a otra sucursal')
      fetchQueue()
      return
    }

    let finalEntries = [...entries]

    // Si cambió el orden
    if (activeId !== overId) {
      const overIdx = finalEntries.findIndex(e => e.id === overId)
      if (overIdx !== -1) {
        finalEntries = arrayMove(finalEntries, activeIdx, overIdx)
      }
    }

    // Reconstruimos posiciones desde 1 para la fila esperando DE ESTA SUCURSAL.
    //
    // El scope por sucursal es obligatorio, no una optimización: sin `selectedBranchId`
    // el fetch trae la cola de TODA la organización (`.eq('organization_id', orgId)`),
    // así que arrastrar una tarjeta en la vista "todas las sucursales" renumeraba —y
    // antes rebaseaba— la fila de las cuatro sucursales a la vez, con un ancla de
    // tiempo compartida entre locales que no tienen nada que ver entre sí.
    const branchIdDelDrag = selectedBranchId || arrastrada.branch_id
    const waitingItems = finalEntries.filter(
      e => e.status === 'waiting' && e.branch_id === branchIdDelDrag
    )

    // Lista de updates para Supabase
    const updates: { id: string; position: number; barber_id?: string | null; is_dynamic?: boolean; priority_order?: string }[] = []

    // ── priority_order: SÓLO se le toca al que se arrastró ──────────────────────
    //
    // `priority_order` es la hora de llegada del cliente y la clave FIFO real de todo
    // el sistema (`claim_next_for_barber` ordena por ella, el panel del barbero también).
    // Hasta el 4/9/2026 este bloque la REESCRIBÍA para toda la fila: tomaba el mínimo
    // como base y repartía base+1s, base+2s… en el orden de dibujo. Tres consecuencias,
    // las tres verificadas contra producción:
    //
    //   1. El orden de llegada se perdía DENTRO de la cola de un mismo barbero (que
    //      es donde importa: `claim_next_for_barber` filtra `barber_id = yo OR
    //      barber_id IS NULL`, así que un barbero nunca compite con los clientes de
    //      otro). El 4/9 en Rondeau hubo 13 inversiones mismo-barbero y el 3/9, 8 —
    //      p. ej. Facundo Brusco (llegó 15:13) quedó con prio 14:38:24.974 y Joaquín
    //      yotti (llegó 16:01) con 14:38:22.974, los dos de Nico Maidana: 48 minutos
    //      de inversión. Y hacia afuera de la banda el daño es al revés: como el
    //      ancla queda en el PASADO, los rebaseados se le adelantan a todo el que
    //      hizo check-in después del último drag, sin que nadie lo haya pedido.
    //   2. Se disparaba sin que nadie quisiera reordenar nada. `position` se recicla y
    //      se repite (`next_queue_position` = MAX+1 sobre las activas), así que casi
    //      nunca vale 1..N: `entry.position !== newPos` daba true para toda la fila y
    //      un temblor de 5 px sobre una tarjeta (el `activationConstraint` del
    //      MouseSensor) rebaseaba la cola entera. Medido: 17-33 entradas reescritas
    //      por día sólo en Rondeau.
    //   3. Empates exactos de `priority_order` (78 pares en prod). Ojo: NO llegan al
    //      motor — nacen de dos pasadas distintas y para la segunda la primera fila
    //      ya no está `waiting`, que es lo único que leen la RPC y el panel. Se
    //      arregla de arrastre, pero no era el daño.
    //
    // Ahora se mueve UNA sola entrada, intercalando su timestamp entre sus vecinos
    // nuevos (los demás no se tocan). `position` se sigue renumerando porque es orden
    // de dibujo y conviene tenerlo prolijo, pero NO puede volver a decidir la hora de
    // llegada de nadie.
    const movedId = activeId !== overId ? String(activeId) : null
    const movedEntry = movedId ? waitingItems.find(e => e.id === movedId) : undefined
    // Cambiar a alguien de columna es cambiarle el BARBERO, no el lugar en la fila:
    // mantiene su hora de llegada. Sólo un reordenamiento dentro de su misma columna
    // significa "a éste atendelo antes/después", que es lo único que justifica
    // tocarle `priority_order`.
    const dbDelMovido = movedEntry
      ? confirmedEntriesRef.current.find(e => e.id === movedEntry.id) ?? movedEntry
      : undefined
    const cambioDeColumna =
      !!movedEntry && !!dbDelMovido && movedEntry.barber_id !== dbDelMovido.barber_id

    if (movedEntry && !movedEntry.is_appointment && !cambioDeColumna) {
      const prioridadDe = (e: QueueEntry) => new Date(e.priority_order).getTime()
      // Vecinos walk-in en el orden nuevo. Los turnos se saltean: su `priority_order`
      // es la hora RESERVADA, no una hora de llegada, y no sirve como cota.
      const vecinos = waitingItems.filter(e => !e.is_appointment && !isNaN(prioridadDe(e)))
      const idx = vecinos.findIndex(e => e.id === movedEntry.id)
      const anterior = idx > 0 ? prioridadDe(vecinos[idx - 1]) : null
      const siguiente = idx >= 0 && idx < vecinos.length - 1 ? prioridadDe(vecinos[idx + 1]) : null

      let nuevaPrioridad: number
      if (anterior !== null && siguiente !== null) {
        nuevaPrioridad = Math.floor((anterior + siguiente) / 2)
        // Vecinos pegados al milisegundo: no hay punto medio. Corremos al de adelante
        // 1 ms —empujar a UNA entrada es infinitamente menos daño que rebasear la fila.
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
        nuevaPrioridad = prioridadDe(movedEntry) // era el único: nada que reordenar
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
      const dbEntry = confirmedEntriesRef.current.find(e => e.id === entry.id) || entry
      const yaEnLista = updates.find(u => u.id === entry.id)

      // Un turno sólo puede recibir `position` (que es orden de dibujo, y hay que
      // renumerarlo o quedarían posiciones repetidas). Su `priority_order` es la
      // hora reservada —la clave de toda la convivencia con la fila— y su barbero
      // vive en `appointments`: tocarlos desde acá dejaría fila y agenda
      // desincronizadas. Se reprograma desde /dashboard/turnos/agenda.
      if (entry.is_appointment) {
        if (entry.position !== newPos) {
          updates.push({ id: entry.id, position: newPos })
        }
        return
      }

      if (yaEnLista) {
        yaEnLista.position = newPos
        return
      }

      // Cambió de columna (barbero / pool) sin ser el arrastrado, o se le corrió la
      // posición de dibujo. En ninguno de los dos casos se toca `priority_order`.
      const cambioBarbero =
        entry.barber_id !== dbEntry.barber_id || entry.is_dynamic !== dbEntry.is_dynamic

      if (cambioBarbero) {
        updates.push({
          id: entry.id,
          position: newPos,
          barber_id: entry.barber_id,
          is_dynamic: entry.is_dynamic,
        })
      } else if (entry.position !== newPos) {
        updates.push({ id: entry.id, position: newPos })
      }
    })

    if (updates.length > 0) {
      const originalEntries = [...entries]

      const locallyUpdated = finalEntries.map(e => {
        const update = updates.find(u => u.id === e.id)
        return update ? { ...e, position: update.position, ...(update.priority_order && { priority_order: update.priority_order }) } : e
      })
      setEntries(locallyUpdated)
      // Actualizar ref inmediatamente para que drags consecutivos funcionen sin esperar la DB
      confirmedEntriesRef.current = locallyUpdated

      // Fire-and-forget: la UI ya está actualizada, no bloquear el drag
      updateQueueOrder(updates).then(
        (result) => {
          if ('error' in result) {
            toast.error(result.error)
            setEntries(originalEntries)
            confirmedEntriesRef.current = originalEntries
          }
        },
        (e: unknown) => {
          // Sin respuesta: el orden de la pantalla no está confirmado. Se vuelve
          // al anterior y se dice (antes quedaba el optimista sin avisar).
          avisarAccionFallida(e, 'No pudimos guardar el nuevo orden de la fila. Probá de nuevo.')
          setEntries(originalEntries)
          confirmedEntriesRef.current = originalEntries
        },
      )
    } else {
      setEntries(finalEntries)
    }
  }

  // Dispatcher de la X: pide confirmación para cualquier CLIENTE (esperando o en
  // curso) y cancela directo sólo los descansos.
  //
  // Antes un cliente `waiting` se cancelaba con un solo tap, sin preguntar y sin
  // deshacer. Sacar a alguien de la fila es la acción menos reversible de esta
  // pantalla —no hay `cancelled_by` que mirar después (recién existe desde la mig
  // 211) y el cliente no se entera: se queda sentado esperando un turno que ya no
  // existe— y en producción hay 4 clientes por día que terminan así. El panel del
  // barbero ya confirmaba; el dashboard, que es donde además está el drag, no.
  function handleCancel(entryId: string) {
    const entry = entries.find((e) => e.id === entryId)
    if (entry && !entry.is_break) {
      setCancelConfirmEntry(entry)
      return
    }
    doCancel(entryId)
  }

  // El dashboard es admin (Supabase Auth) → allowInProgress: true habilita el
  // override server-side. El panel del barbero (PIN) llama sin el flag y conserva
  // la protección.
  async function doCancel(entryId: string) {
    const isBreak = entries.find((e) => e.id === entryId)?.is_break ?? false
    setActionLoading(entryId)
    try {
      const result = await cancelQueueEntry(entryId, { allowInProgress: true })
      if ('error' in result) toast.error(result.error)
      else toast.success(isBreak ? 'Descanso cancelado' : 'Turno cancelado')
    } catch (e) {
      avisarAccionFallida(e, 'No pudimos sacarlo de la fila. Revisá la conexión y probá de nuevo.')
    } finally {
      await fetchQueue()
      setActionLoading(null)
    }
  }

  /**
   * «Solo asesoría» desde la X de un corte en curso (mig 217): si el cliente se
   * asesoró y no se hizo nada, la entrada se cierra SIN visita y queda anotada
   * como asesoría (`cancel_reason = 'solo_asesoria'`), no como un corte
   * cancelado. Es la misma acción que el cobro ofrece al barbero.
   */
  async function doCerrarSoloAsesoria(entryId: string) {
    setActionLoading(entryId)
    try {
      const r = await cerrarSoloAsesoria(entryId)
      if ('error' in r) {
        // Entre otros, «No tenés acceso a esta sucursal.» (fuera del alcance del rol).
        toast.error(r.error)
      } else {
        // Las fotos de ese corte no van a ninguna ficha. El servidor ya intentó
        // borrarlas; esto lo reintenta (también lo que subió el celular), suelta
        // lo que este dispositivo tuviera del cobro y avisa con Reintentar sólo
        // si vuelve a fallar.
        //
        // El `aviso` del servidor (es sobre esas fotos) se muestra recién cuando
        // el reintento termina, y sólo si el reintento no lo dijo ni lo resolvió:
        // si borró algo, lo que había quedado ya está resuelto; si falló, ya hay
        // un aviso persistente con Reintentar y serían dos por lo mismo. Queda el
        // caso que el reintento no ve: el servidor borró las filas pero no los
        // archivos, y sin filas no hay nada que reintentar desde acá.
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

  async function handleStartService(entry: QueueEntry) {
    if (!entry.barber_id) {
      // Cliente del pool ("Menor espera"). Antes esto era un `toast.error` sin salida
      // y el botón ni siquiera se dibujaba, así que la única acción disponible sobre
      // esta tarjeta era la X. Ahora se elige el barbero acá mismo.
      setAsignarBarberoEntry(entry)
      return
    }
    setActionLoading(entry.id)
    try {
      const result = await startService(entry.id, entry.barber_id)
      if ('error' in result) toast.error(result.error)
      else toast.success('Corte iniciado')
    } catch (e) {
      avisarAccionFallida(e, 'No pudimos iniciar el corte. Revisá la conexión y probá de nuevo.')
    } finally {
      await fetchQueue()
      setActionLoading(null)
    }
  }

  function handleCompleteService(entry: QueueEntry) {
    setCompletingEntry(entry)
  }

  function formatElapsed(timestamp: string) {
    const elapsed = now - new Date(timestamp).getTime()
    if (isNaN(elapsed) || elapsed < 0) return '0m'
    const totalSeconds = Math.floor(elapsed / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
  }

  function getBranchName(branchId: string) {
    return branches.find((b) => b.id === branchId)?.name ?? ''
  }

  function getBarberName(barberId: string) {
    return liveBarbers.find((b) => b.id === barberId)?.full_name
  }

  // Cliente del pool que se pasó desde el aviso de WhatsApp (mig 218): el
  // selector "¿Quién lo atiende?" dice a quién esperaba y lo marca en la lista,
  // porque conservó su lugar en la fila de ese barbero.
  // Un corte en curso que pidió asesoría (y no es un turno): la X ofrece además
  // cerrarlo como «solo asesoría», que es lo que pasó si no se hizo nada.
  const cancelarAsesoriaEnCurso =
    cancelConfirmEntry?.status === 'in_progress' &&
    cancelConfirmEntry.pidio_asesoria === true &&
    !cancelConfirmEntry.appointment_id &&
    !cancelConfirmEntry.is_break

  const asignarViaWhatsApp = !!asignarBarberoEntry && esMovidaPorWhatsApp(asignarBarberoEntry)
  const asignarEsperabaA =
    asignarViaWhatsApp && asignarBarberoEntry?.menor_espera_barbero_original_id
      ? getBarberName(asignarBarberoEntry.menor_espera_barbero_original_id)
      : undefined

  const dropAnimation = {
    duration: 250,
    easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
    sideEffects: defaultDropAnimationSideEffects({
      styles: {
        active: {
          opacity: '0.5',
        },
      },
    }),
  }

  // ── Resumen ─────────────────────────────────────────────────────────────

  const descansosVisibles = breakConfigs.filter((c) => !selectedBranchId || c.branch_id === selectedBranchId)
  const enAtencion = branchEntries.filter((e) => e.status === 'in_progress' && !e.is_break).length
  const esperando = branchEntries.filter((e) => e.status === 'waiting' && !e.is_break)
  const enCola = esperando.length
  const esperaMasLarga = esperando.reduce((max, e) => Math.max(max, minutosDesde(e.checked_in_at, now)), 0)
  const fichados = filteredBarbers.filter((b) => !notClockedInBarbers.has(b.id)).length
  const serviciosDelDia = selectedBranchId
    ? filteredBarbers.reduce((sum, b) => sum + (dailyServiceCounts[b.id] || 0), 0)
    : Object.values(dailyServiceCounts).reduce((a, b) => a + b, 0)

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={kanbanCollisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setDraggedEntry(null)
        setDraggedTemplate(null)
        setCarrilDestino(null)
        marcarArrastre(false)
        fetchQueue() // reset visual state
      }}
    >
      <TableroContext.Provider value={tablero}>
      {/* La PC del mostrador queda en esta pantalla todo el día: después de un
          deploy se recarga sola cuando está ociosa (sin diálogos abiertos, sin
          nada escrito a medias, un minuto sin tocarla). Ver src/lib/recarga-version.ts. */}
      <RecargaPorVersion superficie="panel" />
      <div className="flex flex-col gap-2 lg:gap-4 p-1 max-md:pb-[calc(5rem+env(safe-area-inset-bottom,0px))] md:h-[calc(100dvh-9rem)] lg:h-[calc(100dvh-9.5rem)] md:overflow-hidden">

        {/* Encabezado y Descansos (Top Bar) */}
        <div className="flex shrink-0 flex-col gap-2 lg:gap-3 px-2">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-xl font-semibold tracking-[-0.01em] lg:text-2xl">Fila en vivo</h2>
              <p className="mt-0.5 hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
                <GripVertical className="size-3.5 shrink-0" aria-hidden />
                Arrastrá a un cliente al carril de un barbero para pasárselo, o entre clientes para cambiarle el lugar.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="h-9 shrink-0 gap-1.5"
                  >
                    <UserPlus className="size-4" />
                    <span className="hidden sm:inline">Registrar cliente</span>
                    <ChevronDown className="size-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <a
                      href={`/checkin${selectedBranchId ? `?branch=${selectedBranchId}` : ''}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="gap-2"
                    >
                      <ExternalLink className="size-4" />
                      Check-in normal
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setManualDialogOpen(true)} className="gap-2">
                    <FileEdit className="size-4" />
                    Registro manual
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setSearchDialogOpen(true)} className="gap-2">
                    <Search className="size-4" />
                    Buscar cliente existente
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <BranchSelector branches={branches} />
            </div>

            {/* Dialog: Registro manual */}
            <Dialog open={manualDialogOpen} onOpenChange={(open) => {
              setManualDialogOpen(open)
              if (!open) {
                setManualForm({ phone: '', name: '', serviceId: '', barberId: DYNAMIC_BARBER, isSpecial: false })
              }
            }}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Registro manual</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-4 py-2">
                  {/* Toggle "cliente especial": walk-in sin teléfono (niño, invitado, etc.).
                      Label + Switch como hermanos (no anidados) para no meter un button
                      dentro de otro y evitar el doble-toggle. */}
                  <div className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                    manualForm.isSpecial ? 'border-primary/40 bg-primary/10' : 'border-border bg-muted/30'
                  }`}>
                    <label htmlFor="manual-special-switch" className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer">
                      <span className={`flex size-9 shrink-0 items-center justify-center rounded-md transition-colors ${
                        manualForm.isSpecial ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
                      }`}>
                        <Sparkles className="size-5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium leading-tight">Cliente especial</span>
                        <span className="block text-xs text-muted-foreground leading-tight mt-0.5">
                          Sin teléfono — niños, invitados o quien no deja su número
                        </span>
                      </span>
                    </label>
                    <Switch
                      id="manual-special-switch"
                      checked={manualForm.isSpecial}
                      onCheckedChange={(v) => setManualForm((f) => ({ ...f, isSpecial: v }))}
                    />
                  </div>

                  {manualForm.isSpecial ? (
                    <div className="flex items-start gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                      <Info className="size-4 shrink-0 mt-0.5" />
                      <span>Se agrega sin teléfono. Cada cliente especial queda como un registro aparte en la fila.</span>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="manual-phone">Teléfono</Label>
                      <Input
                        id="manual-phone"
                        placeholder="Ej: 1122334455"
                        value={manualForm.phone}
                        onChange={(e) => setManualForm((f) => ({ ...f, phone: e.target.value }))}
                      />
                    </div>
                  )}
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="manual-name">{manualForm.isSpecial ? 'Nombre (opcional)' : 'Nombre'}</Label>
                    <Input
                      id="manual-name"
                      placeholder={manualForm.isSpecial ? 'Ej: Niño, Invitado…' : 'Nombre del cliente'}
                      value={manualForm.name}
                      onChange={(e) => setManualForm((f) => ({ ...f, name: e.target.value }))}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Servicio</Label>
                    <Select
                      value={servicioManual}
                      onValueChange={(v) => setManualForm((f) => ({ ...f, serviceId: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccionar servicio (opcional)" />
                      </SelectTrigger>
                      <SelectContent>
                        {services
                          .filter((s) => !selectedBranchId || s.branch_id === selectedBranchId || !s.branch_id)
                          .map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}
                            </SelectItem>
                          ))}
                        {asesoriaDisponible && <OpcionAsesoriaDelRegistro />}
                      </SelectContent>
                    </Select>
                    {servicioManual === OPCION_ASESORIA && <AyudaAsesoriaDelRegistro />}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Barbero</Label>
                    <Select
                      value={manualForm.barberId}
                      onValueChange={(v) => setManualForm((f) => ({ ...f, barberId: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Elegir barbero" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={DYNAMIC_BARBER}>Menor espera</SelectItem>
                        {liveBarbers
                          .filter((b) =>
                            b.is_active &&
                            !b.hidden_from_checkin &&
                            (!selectedBranchId || b.branch_id === selectedBranchId)
                          )
                          .map((b) => (
                            <SelectItem key={b.id} value={b.id}>
                              {b.full_name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={handleManualCheckin} disabled={manualLoading} className="w-full">
                    {manualLoading ? 'Registrando…' : (manualForm.isSpecial ? 'Agregar cliente especial' : 'Agregar a la fila')}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            {/* Dialog: Buscar cliente existente */}
            <Dialog open={searchDialogOpen} onOpenChange={(open) => {
              setSearchDialogOpen(open)
              if (!open) {
                setSearchQuery('')
                setSearchResults([])
                setSearchExecuted(false)
                setSelectedSearchClient(null)
                setSearchServiceId('')
                setSearchBarberId(DYNAMIC_BARBER)
              }
            }}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Buscar cliente</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-4 py-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input
                      placeholder="Nombre o teléfono…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9"
                      autoFocus
                    />
                  </div>

                  {searchLoading && (
                    <p className="text-sm text-muted-foreground text-center py-4">Buscando…</p>
                  )}

                  {searchResults.length > 0 && (
                    <div className="flex flex-col gap-1 max-h-60 overflow-y-auto">
                      {searchResults.map((client) => (
                        <button
                          key={client.id}
                          type="button"
                          onClick={() => setSelectedSearchClient(client)}
                          className={`flex items-center gap-3 px-3 py-2 rounded-md text-left text-sm transition-colors ${
                            selectedSearchClient?.id === client.id
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-zinc-900/50 active:bg-zinc-800'
                          }`}
                        >
                          <User className="size-4 shrink-0" />
                          <div className="min-w-0">
                            <p className="font-medium truncate">{client.name}</p>
                            <p className="text-xs opacity-70">{client.phone}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {searchResults.length === 0 && searchExecuted && !searchLoading && (
                    <p className="text-sm text-muted-foreground text-center py-4">No se encontraron clientes</p>
                  )}

                  {selectedSearchClient && (
                    <div className="flex flex-col gap-3 border-t pt-3">
                      <p className="text-sm font-medium">
                        Registrar a <span className="text-primary">{selectedSearchClient.name}</span>
                      </p>
                      <div className="flex flex-col gap-1.5">
                        <Label>Servicio</Label>
                        <Select value={servicioBuscado} onValueChange={setSearchServiceId}>
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar servicio (opcional)" />
                          </SelectTrigger>
                          <SelectContent>
                            {services
                              .filter((s) => !selectedBranchId || s.branch_id === selectedBranchId || !s.branch_id)
                              .map((s) => (
                                <SelectItem key={s.id} value={s.id}>
                                  {s.name}
                                </SelectItem>
                              ))}
                            {asesoriaDisponible && <OpcionAsesoriaDelRegistro />}
                          </SelectContent>
                        </Select>
                        {servicioBuscado === OPCION_ASESORIA && <AyudaAsesoriaDelRegistro />}
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label>Barbero</Label>
                        <Select value={searchBarberId} onValueChange={setSearchBarberId}>
                          <SelectTrigger>
                            <SelectValue placeholder="Elegir barbero" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={DYNAMIC_BARBER}>Menor espera</SelectItem>
                            {liveBarbers
                              .filter((b) =>
                                b.is_active &&
                                !b.hidden_from_checkin &&
                                (!selectedBranchId || b.branch_id === selectedBranchId)
                              )
                              .map((b) => (
                                <SelectItem key={b.id} value={b.id}>
                                  {b.full_name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        onClick={() => handleSearchCheckin(selectedSearchClient)}
                        disabled={searchCheckinLoading}
                        className="w-full"
                      >
                        {searchCheckinLoading ? 'Registrando…' : 'Agregar a la fila'}
                      </Button>
                    </div>
                  )}
                </div>
              </DialogContent>
            </Dialog>
          </div>
          
          <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <a
              href="/dashboard/equipo?tab=descansos"
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-white/10 px-3 text-xs font-semibold text-muted-foreground transition-colors hover:border-white/25 hover:text-foreground"
              title="Configurar los descansos de la sucursal"
            >
              <Settings2 className="size-3.5" aria-hidden />
              {descansosVisibles.length > 0 ? 'Descansos' : 'Sin descansos · configurar'}
            </a>
            {descansosVisibles.map((config) => (
              <div key={config.id} className="shrink-0">
                <BreakTemplateCard config={config} />
              </div>
            ))}
            {descansosVisibles.length > 0 && (
              <span className="hidden shrink-0 text-xs text-muted-foreground lg:inline">Arrastralos al carril de un barbero</span>
            )}
          </div>
        </div>

        {/* Resumen rápido: tres números y lo que los explica */}
        <div className="grid shrink-0 grid-cols-3 gap-2 px-2 lg:gap-3">
          <ResumenFila
            icono={<Scissors className="size-4 text-emerald-300" aria-hidden />}
            fondoIcono="bg-emerald-500/12"
            titulo="En atención"
            valor={enAtencion}
            detalle={fichados > 0 ? `de ${fichados} ${fichados === 1 ? 'fichado' : 'fichados'}` : undefined}
          />
          <ResumenFila
            icono={<Clock className="size-4 text-amber-300" aria-hidden />}
            fondoIcono="bg-amber-500/12"
            titulo="En cola"
            valor={enCola}
            detalle={
              enCola > 0 ? (
                <>
                  máx.{' '}
                  <span className={cn('font-mono font-semibold tabular-nums', TEXTO_ESPERA[nivelEspera(esperaMasLarga)])}>
                    {formatoEspera(esperaMasLarga)}
                  </span>
                </>
              ) : undefined
            }
          />
          <ResumenFila
            icono={<Check className="size-4 text-sky-300" aria-hidden />}
            fondoIcono="bg-sky-500/12"
            titulo="Servicios hoy"
            valor={serviciosDelDia}
          />
        </div>

        {/* Tablero Kanban (Grid Layout) */}
        <div className="relative mx-1 mt-1 flex flex-none overflow-visible rounded-2xl border border-white/[0.08] bg-background lg:mt-2 md:min-h-0 md:flex-1 md:overflow-auto">
          <div className="flex flex-col md:flex-row md:min-w-max w-full md:h-full">

            {/* Columna Dinámicos (Sticky a la izquierda) */}
            <div className="z-30 flex bg-background md:sticky md:left-0 md:shrink-0 md:shadow-[4px_0_24px_-8px_rgba(0,0,0,0.8)]">
              {/* `onStartService` también acá: el commit 2b42cc5 le agregó a las
                  tarjetas del pool el botón que abre "¿Quién lo atiende?", pero esta
                  columna —la única donde viven— nunca recibió el handler, así que el
                  botón no se dibujaba y lo único posible seguía siendo la X. */}
              <DynamicColumn
                id="__dynamic__"
                entries={columnsData['__dynamic__']}
                formatElapsed={formatElapsed}
                onCancel={handleCancel}
                onStartService={handleStartService}
                actionLoading={actionLoading}
                selectedBranchId={selectedBranchId}
                getBranchName={getBranchName}
                getBarberName={getBarberName}
                timezone={timezone}
                destacado={carrilDestino === '__dynamic__'}
              />
            </div>

            {/* Filas de Barberos (Se expanden a la derecha) */}
            <div className="flex flex-1 flex-col md:min-w-max">
              {filteredBarbers.map((barber) => (
                <BarberRow
                  key={barber.id}
                  barber={barber}
                  entries={columnsData[barber.id] || []}
                  inProgressEntry={inProgressData[barber.id]}
                  notClockedInBarbers={notClockedInBarbers}
                  schedules={schedules}
                  now={now}
                  shiftEndMargin={shiftEndMargin}
                  formatElapsed={formatElapsed}
                  onCancel={handleCancel}
                  onStartService={handleStartService}
                  onCompleteService={handleCompleteService}
                  actionLoading={actionLoading}
                  selectedBranchId={selectedBranchId}
                  getBranchName={getBranchName}
                  timezone={timezone}
                  nextAppointment={nextAppointmentByBarber[barber.id]}
                  cortesHoy={dailyServiceCounts[barber.id] || 0}
                  destacado={carrilDestino === barber.id}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <DragOverlay dropAnimation={dropAnimation}>
        {draggedEntry && <DragGhost entry={draggedEntry} />}
        {draggedTemplate && (
          <div className="pointer-events-none w-[220px] motion-safe:rotate-[2deg]">
            <BreakTemplateCard config={draggedTemplate} />
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
            // el que no pudo guardar el importe los avisa el diálogo: «Corte
            // finalizado» sólo para un cobro de ahora que quedó bien.
            if (hayQueAnunciarCobro(resultado)) toast.success('Corte finalizado')
            await fetchQueue()
          }}
        />
      )}

      {/* Selector de barbero para un cliente del pool ("Menor espera").
          Los barberos que atienden ahora quedan deshabilitados —arrancarles un
          segundo corte choca contra `idx_queue_one_in_progress_per_barber`— y los
          que no fichadaron se marcan, pero se pueden elegir igual: la fila real
          manda sobre el fichaje. */}
      <AlertDialog
        open={!!asignarBarberoEntry}
        onOpenChange={(open) => { if (!open) setAsignarBarberoEntry(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Quién lo atiende?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{asignarBarberoEntry?.client?.name ?? 'El cliente'}</strong> eligió
              &ldquo;Menor espera&rdquo;, así que no tiene barbero asignado. Elegí uno para
              arrancar el corte.
              {asignarViaWhatsApp && (
                <>
                  {' '}Se pasó desde el aviso de WhatsApp
                  {asignarEsperabaA ? <>: esperaba a <strong>{asignarEsperabaA}</strong>.</> : '.'}
                </>
              )}
            </AlertDialogDescription>
            {/* Mig 217: el panel del barbero elegido le muestra el pedido al
                empezar (sale del estado de la entrada, no del botón que la inició). */}
            {asignarBarberoEntry?.pidio_asesoria && (
              <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <AsesoriaBadge tono="oscuro" />
                <span>Pidió asesoría: el barbero que elijas ve el aviso al empezar.</span>
              </p>
            )}
          </AlertDialogHeader>
          <div className="grid max-h-[45vh] gap-2 overflow-y-auto py-1">
            {filteredBarbers
              .filter(b => !asignarBarberoEntry || b.branch_id === asignarBarberoEntry.branch_id)
              .map((barbero) => {
                const ocupado = entries.some(
                  e => e.barber_id === barbero.id && e.status === 'in_progress'
                )
                const loEsperaba =
                  asignarViaWhatsApp &&
                  asignarBarberoEntry?.menor_espera_barbero_original_id === barbero.id
                return (
                  <Button
                    key={barbero.id}
                    variant="outline"
                    disabled={ocupado || actionLoading === asignarBarberoEntry?.id}
                    className="h-auto justify-start py-2.5 text-left"
                    onClick={async () => {
                      const entry = asignarBarberoEntry
                      if (!entry) return
                      setAsignarBarberoEntry(null)
                      setActionLoading(entry.id)
                      try {
                        const result = await startService(entry.id, barbero.id)
                        if ('error' in result) toast.error(result.error)
                        else toast.success(`Corte iniciado con ${barbero.full_name}`)
                      } catch (e) {
                        avisarAccionFallida(e, 'No pudimos iniciar el corte. Revisá la conexión y probá de nuevo.')
                      } finally {
                        await fetchQueue()
                        setActionLoading(null)
                      }
                    }}
                  >
                    <span className="flex-1 truncate font-medium">
                      {barbero.full_name}
                      {loEsperaba && (
                        <span className="ml-1.5 text-xs font-normal text-sky-400">· lo esperaba</span>
                      )}
                    </span>
                    {ocupado ? (
                      <span className="text-xs text-muted-foreground">atendiendo</span>
                    ) : notClockedInBarbers.has(barbero.id) ? (
                      <span className="text-xs text-amber-500">sin fichar</span>
                    ) : (
                      <span className="text-xs text-green-500">libre</span>
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

      <AlertDialog
        open={!!cancelConfirmEntry}
        onOpenChange={(open) => { if (!open) setCancelConfirmEntry(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {cancelConfirmEntry?.status === 'in_progress'
                ? '¿Cancelar un corte en curso?'
                : '¿Sacar al cliente de la fila?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {cancelConfirmEntry?.status === 'in_progress' ? (
                <>
                  <strong>{cancelConfirmEntry?.client?.name ?? 'El cliente'}</strong> ya está siendo atendido. Si lo cancelás, ese corte <strong>no se va a cobrar ni registrar</strong> y saldrá de la fila.
                  {cancelarAsesoriaEnCurso && (
                    <>
                      {' '}Pidió asesoría: si se asesoró y no se hizo nada, cerralo como <strong>solo asesoría</strong> y
                      queda registrado así, no como un corte cancelado.
                    </>
                  )}
                </>
              ) : (
                <>
                  <strong>{cancelConfirmEntry?.client?.name ?? 'El cliente'}</strong> queda marcado como ausente y sale de la fila. Si todavía está en el local <strong>no se va a enterar</strong>: va a seguir esperando un turno que ya no existe y va a tener que anotarse de nuevo.
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
      </TableroContext.Provider>
    </DndContext>
  )
}
