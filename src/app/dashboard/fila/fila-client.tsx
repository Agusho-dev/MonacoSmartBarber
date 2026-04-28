'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
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
  closestCenter,
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
import { cancelQueueEntry, updateQueueOrder, createBreakEntry, startService, checkinClient } from '@/lib/actions/queue'
import { searchClients } from '@/lib/actions/clients'
import { CompleteServiceDialog } from '@/components/barber/complete-service-dialog'
import { useBranchStore } from '@/stores/branch-store'
import { BranchSelector } from '@/components/dashboard/branch-selector'
import type { QueueEntry, StaffStatus, StaffSchedule, Staff, BreakConfig, Service } from '@/lib/types/database'
import { isBarberBlockedByShiftEnd } from '@/lib/barber-utils'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Clock, User, Scissors, X, Pause, GripVertical, Zap, UserPlus, Play, Check, ChevronDown, Search, FileEdit, ExternalLink } from 'lucide-react'
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
}

type ColumnId = string // 'breaks', 'dynamic', or barber.id

/**
 * Detección de colisiones personalizada para el kanban horizontal.
 * Prioriza pointerWithin (el puntero está DENTRO de un droppable) para que
 * arrastrar a una fila vacía funcione correctamente. Si no hay coincidencia
 * (ej. el puntero está entre filas), usa rectIntersection y luego closestCenter como fallback.
 */
const kanbanCollisionDetection: CollisionDetection = (args) => {
  // 1. ¿El puntero está dentro de algún droppable?
  const pointerCollisions = pointerWithin(args)
  if (pointerCollisions.length > 0) return pointerCollisions

  // 2. ¿Hay intersección de rectangulos?
  const rectCollisions = rectIntersection(args)
  if (rectCollisions.length > 0) return rectCollisions

  // 3. Fallback: el centro más cercano
  return closestCenter(args)
}

// ─── Sortable QueueCard ────────────────────────────────────────────────────────

interface QueueCardProps {
  entry: QueueEntry
  formatElapsed: (ts: string) => string
  onCancel: (id: string) => void
  onStartService?: (entry: QueueEntry) => void
  actionLoading: string | null
  selectedBranchId: string | null
  getBranchName: (id: string) => string
}

function QueueCard({
  entry,
  formatElapsed,
  onCancel,
  onStartService,
  actionLoading,
  selectedBranchId,
  getBranchName,
}: QueueCardProps) {
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
  })

  // Evitar error visual de dnd-kit origin
  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? 'transform 200ms cubic-bezier(0.25, 1, 0.5, 1)',
  }

  const isBreak = entry.is_break
  const displayName = isBreak ? 'Descanso' : (entry.client?.name ?? 'Cliente')

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={[
        'w-full cursor-grab active:cursor-grabbing group relative rounded-xl border transition-colors duration-150 overflow-hidden',
        isDragging ? 'opacity-40 scale-[0.98] z-50' : 'bg-zinc-900/80',
        isBreak
          ? 'border-amber-900/50 bg-amber-950/30'
          : 'border-zinc-800 hover:border-zinc-700',
      ].join(' ')}
    >
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        {/* Handle visual */}
        <div className="shrink-0 text-zinc-700/50 group-hover:text-zinc-500 transition-colors">
          <GripVertical className="size-4" />
        </div>

        {/* Badge */}
        <div
          className={[
            'flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold',
            isBreak
              ? 'bg-amber-500/20 text-amber-400'
              : 'bg-zinc-800 text-zinc-300',
          ].join(' ')}
        >
          {isBreak ? <Pause className="size-3.5" /> : `#${entry.position}`}
        </div>

        {/* Datos */}
        <div className="min-w-0 flex-1 flex flex-col justify-center">
          <p
            className={`truncate text-sm font-medium ${
              isBreak ? 'text-amber-200' : 'text-zinc-200'
            }`}
          >
            {displayName}
          </p>
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 mt-0.5 min-w-0 overflow-hidden">
            {!isBreak && entry.client?.phone && (
              <span className="truncate shrink-0 max-w-[80px]">{entry.client.phone}</span>
            )}
            {!selectedBranchId && (
              <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-px text-[10px] text-zinc-400 truncate max-w-[60px]">
                {getBranchName(entry.branch_id)}
              </span>
            )}
            <span className="flex shrink-0 items-center gap-1 ml-auto min-w-0">
              <Clock className="size-3 shrink-0" />
              <span className="truncate">{formatElapsed(entry.checked_in_at)}</span>
            </span>
          </div>
        </div>

        {/* Acciones */}
        <div className="flex items-center gap-1 shrink-0">
          {!isBreak && entry.barber_id && onStartService && (
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => { e.stopPropagation(); onStartService(entry); }}
              onPointerDown={(e) => e.stopPropagation()}
              disabled={actionLoading === entry.id}
              className="size-7 text-green-400"
              title="Iniciar corte"
            >
              <Play className="size-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => { e.stopPropagation(); onCancel(entry.id); }}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={actionLoading === entry.id}
            className="size-7 text-red-400"
            title="Cancelar"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}


// ─── En Servicio Card (No arrastrable) ───────────────────────────────────────

function InProgressCard({
  entry,
  formatElapsed,
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

  return (
    <div className="w-full group relative rounded-xl border border-green-500/30 bg-green-950/20 shadow-md overflow-hidden min-w-0">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <div className="shrink-0 text-green-500/50 w-4 flex justify-center">
          <Scissors className="size-4" />
        </div>
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold bg-green-500/20 text-green-400">
          {isBreak ? <Pause className="size-3.5" /> : `#${entry.position}`}
        </div>
        <div className="min-w-0 flex-1 flex flex-col justify-center">
          <p className="truncate text-sm font-medium text-green-400">{displayName}</p>
          <div className="flex items-center gap-1.5 text-[11px] text-green-500/70 mt-0.5 min-w-0 overflow-hidden">
            <span className="flex shrink-0 items-center gap-1 min-w-0">
              <Clock className="size-3 shrink-0" />
              <span className="truncate">{entry.started_at ? formatElapsed(entry.started_at) : 'En curso'}</span>
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!isBreak && onComplete && (
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => { e.stopPropagation(); onComplete(entry); }}
              onPointerDown={(e) => e.stopPropagation()}
              disabled={actionLoading === entry.id}
              className="size-7 text-emerald-400"
              title="Finalizar corte"
            >
              <Check className="size-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => { e.stopPropagation(); onCancel(entry.id); }}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={actionLoading === entry.id}
            className="size-7 text-red-400"
            title="Cancelar"
          >
            <X className="size-3.5" />
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
      className={[
        'w-full cursor-grab active:cursor-grabbing group relative rounded-xl border border-amber-500/30 bg-amber-950/20 shadow-sm transition-all duration-150',
        isDragging ? 'opacity-40 scale-[0.98] z-50' : 'hover:border-amber-500/50',
      ].join(' ')}
    >
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <div className="shrink-0 text-amber-700/50 group-hover:text-amber-600 transition-colors">
          <GripVertical className="size-4" />
        </div>
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold bg-amber-500/20 text-amber-500">
          <Pause className="size-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-amber-200">
            {config.name}
          </p>
          <div className="flex items-center gap-2 text-[11px] text-amber-500/70 mt-0.5">
            <span className="flex shrink-0 items-center gap-1">
              <Clock className="size-3" />
              {config.duration_minutes} min
            </span>
          </div>
        </div>
      </div>
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
  children?: React.ReactNode
}

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
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-primary/50 bg-zinc-800/95 px-3.5 py-2.5 shadow-2xl shadow-black/70 rotate-[2deg] scale-105 opacity-90 w-[270px]">
      <div
        className={`flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-bold ${
          isBreak ? 'bg-amber-500/25 text-amber-400' : 'bg-zinc-700 text-zinc-200'
        }`}
      >
        {isBreak ? <Pause className="size-3" /> : `#${entry.position}`}
      </div>
      <span className="truncate text-sm font-semibold text-white">
        {displayName}
      </span>
    </div>
  )
}

// ─── Dynamic Column (Top-to-Bottom) ─────────────────────────────────────────

function DynamicColumn({
  id,
  entries,
  formatElapsed,
  onCancel,
  actionLoading,
  selectedBranchId,
  getBranchName,
}: {
  id: ColumnId
  entries: QueueEntry[]
  formatElapsed: (ts: string) => string
  onCancel: (id: string) => void
  actionLoading: string | null
  selectedBranchId: string | null
  getBranchName: (id: string) => string
}) {
  const { setNodeRef } = useSortable({
    id,
    data: { type: 'Column', columnId: id },
  })

  const entryIds = useMemo(() => entries.map((e) => e.id), [entries])

  return (
    <div
      ref={setNodeRef}
      className="flex flex-col w-full md:w-[260px] md:shrink-0 bg-zinc-950 border-b md:border-b-0 md:border-r border-zinc-800/80"
    >
      <div className="p-3 md:p-4 border-b border-zinc-800/80 bg-zinc-950 sticky top-0 z-40 shadow-sm">
        <div className="flex items-center gap-2 h-6">
          <Zap className="size-4 text-yellow-400" />
          <h3 className="font-semibold text-zinc-100 text-sm md:text-base">Dinámicos</h3>
        </div>
      </div>
      <div className="flex-1 p-2 md:p-3 flex flex-col gap-2 md:gap-3 md:min-h-[500px]">
        <SortableContext items={entryIds} strategy={verticalListSortingStrategy}>
          {entries.map((entry) => (
            <QueueCard
              key={entry.id}
              entry={entry}
              formatElapsed={formatElapsed}
              onCancel={onCancel}
              actionLoading={actionLoading}
              selectedBranchId={selectedBranchId}
              getBranchName={getBranchName}
            />
          ))}
        </SortableContext>
        {entries.length === 0 && (
          <div className="flex flex-1 items-center justify-center border-2 border-dashed border-zinc-800/40 rounded-xl text-zinc-600 min-h-[100px]">
            <p className="text-xs font-medium">Soltar aquí</p>
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

  const entryIds = useMemo(() => entries.map((e) => e.id), [entries])

  return (
    <div className={`flex flex-col md:flex-row md:min-h-[100px] md:items-stretch border-b border-zinc-800/80 ${isUnavailable ? 'opacity-60' : ''}`}>
      {/* ── Info Barbero (Celda Fija y Sticky) ── */}
      <div className="md:sticky md:left-[260px] z-20 w-full md:w-[200px] md:shrink-0 border-b md:border-b-0 md:border-r border-zinc-800/80 bg-zinc-950 px-3 py-2 md:p-3 flex items-center justify-start md:shadow-[8px_0_16px_-12px_rgba(0,0,0,0.8)]">
        <div className="flex flex-row items-center gap-2.5 md:gap-3 text-left w-full">
          <div className="relative h-10 w-10 md:h-12 md:w-12 shrink-0">
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
                  <User className="size-6 text-zinc-500" />
                </div>
              )}
            </div>
            <div className={`absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full ring-2 ring-zinc-900 z-10 ${dotClass}`} />
          </div>
          
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-bold text-zinc-100 text-sm">{barber.full_name}</h3>
            <p className={`truncate text-xs mt-0.5 font-medium ${statusClass}`}>{statusText}</p>
          </div>
        </div>
      </div>

      {/* ── Fila de Clientes (Arrastrables con grid infinito css) ── */}
      <div
        ref={setNodeRef}
        className="flex-1 flex flex-col md:flex-row isolate bg-zinc-900/10 md:min-w-[260px] p-2 md:p-0 gap-1.5 md:gap-0"
        style={{
          backgroundSize: '260px 100%',
          backgroundImage: 'linear-gradient(to right, transparent 259px, rgba(39, 39, 42, 0.4) 259px, rgba(39, 39, 42, 0.4) 260px)'
        }}
      >
        {inProgressEntry && (
          <div className="w-full md:w-[260px] md:shrink-0 md:p-3">
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
            <div key={entry.id} className="w-full md:w-[260px] md:shrink-0 md:p-3">
              <QueueCard
                entry={entry}
                formatElapsed={formatElapsed}
                onCancel={onCancel}
                onStartService={onStartService}
                actionLoading={actionLoading}
                selectedBranchId={selectedBranchId}
                getBranchName={getBranchName}
              />
            </div>
          ))}
        </SortableContext>
        
        {/* Un único filler para ayudar al drop visual si está vacío */}
        {entries.length === 0 && !inProgressEntry && (
          <div className="w-full md:w-[260px] p-3 flex items-center justify-center text-zinc-600/50">
            <p className="text-xs font-medium bg-zinc-900/40 px-3 py-1.5 rounded-md border border-zinc-800/40">Vacío</p>
          </div>
        )}

        <div className="hidden md:flex md:flex-1 md:min-w-[260px]" />
      </div>
    </div>
  )
}

// ─── Componente Principal ───────────────────────────────────────────────────

export function FilaClient({ initialEntries, barbers, branches, breakConfigs }: FilaClientProps) {
  const { selectedBranchId } = useBranchStore()
  const [entries, setEntries] = useState<QueueEntry[]>(initialEntries)
  const [liveBarbers, setLiveBarbers] = useState<BarberRow[]>(barbers)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  // Ref que trackea el último estado confirmado de la DB (para comparar en drag & drop)
  const confirmedEntriesRef = useRef<QueueEntry[]>(initialEntries)
  const [schedules, setSchedules] = useState<StaffSchedule[]>([])
  const [now, setNow] = useState(Date.now())
  const [shiftEndMargin, setShiftEndMargin] = useState(35)
  const [dailyServiceCounts, setDailyServiceCounts] = useState<Record<string, number>>({})
  const [lastCompletedAt, setLastCompletedAt] = useState<Record<string, string>>({})
  const [latestAttendance, setLatestAttendance] = useState<Record<string, string>>({})
  
  const [completingEntry, setCompletingEntry] = useState<QueueEntry | null>(null)

  const [draggedEntry, setDraggedEntry] = useState<QueueEntry | null>(null)
  const [draggedTemplate, setDraggedTemplate] = useState<BreakConfig | null>(null)

  // ── Registro manual & búsqueda de clientes ─────────────────────────────────
  const [manualDialogOpen, setManualDialogOpen] = useState(false)
  const [searchDialogOpen, setSearchDialogOpen] = useState(false)
  const [services, setServices] = useState<Service[]>([])
  const DYNAMIC_BARBER = '__dynamic__'
  const [manualForm, setManualForm] = useState({ phone: '', name: '', serviceId: '', barberId: DYNAMIC_BARBER })
  const [manualLoading, setManualLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{ id: string; name: string; phone: string }[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchExecuted, setSearchExecuted] = useState(false)
  const [selectedSearchClient, setSelectedSearchClient] = useState<{ id: string; name: string; phone: string } | null>(null)
  const [searchServiceId, setSearchServiceId] = useState('')
  const [searchBarberId, setSearchBarberId] = useState(DYNAMIC_BARBER)
  const [searchCheckinLoading, setSearchCheckinLoading] = useState(false)

  const supabase = useMemo(() => createClient(), [])

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 12 } }),
    useSensor(KeyboardSensor)
  )

  // ── Fetches (Omitido para brevedad en review, la lógica es la misma) ───────

  const fetchQueue = useCallback(async () => {
    const { data } = await supabase
      .from('queue_entries')
      .select('*, client:clients(*), barber:staff(*)')
      .in('status', ['waiting', 'in_progress'])
      .order('position')
    if (data) {
      const typed = data as QueueEntry[]
      setEntries(typed)
      confirmedEntriesRef.current = typed
    }
  }, [supabase])

  const fetchBarbers = useCallback(async () => {
    const { data } = await supabase
      .from('staff')
      .select('id, full_name, branch_id, status, is_active, hidden_from_checkin, avatar_url')
      .or('role.eq.barber,is_also_barber.eq.true')
      .eq('is_active', true)
      .order('full_name')
    if (data) setLiveBarbers(data as BarberRow[])
  }, [supabase])

  const fetchSchedules = useCallback(async () => {
    const dayStart = new Date()
    dayStart.setHours(0, 0, 0, 0)

    const [schedRes, settingsRes, monthlyVisitsRes, lastVisitsRes, attendanceRes] =
      await Promise.all([
        supabase
          .from('staff_schedules')
          .select('*')
          .eq('day_of_week', new Date().getDay())
          .eq('is_active', true),
        supabase.from('app_settings').select('shift_end_margin_minutes').maybeSingle(),
        supabase
          .from('visits')
          .select('barber_id')
          .gte('completed_at', dayStart.toISOString())
          .not('barber_id', 'is', null),
        supabase
          .from('visits')
          .select('barber_id, completed_at')
          .not('barber_id', 'is', null)
          .order('completed_at', { ascending: false })
          .limit(200),
        supabase
          .from('attendance_logs')
          .select('staff_id, action_type')
          .gte('recorded_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
          .order('recorded_at', { ascending: false }),
      ])

    if (schedRes.data) setSchedules(schedRes.data as StaffSchedule[])
    if (settingsRes.data) {
      const margin = (settingsRes.data as { shift_end_margin_minutes?: number })
        .shift_end_margin_minutes
      if (typeof margin === 'number' && margin >= 0) setShiftEndMargin(margin)
    }
    if (monthlyVisitsRes?.data) {
      const counts: Record<string, number> = {}
      for (const v of monthlyVisitsRes.data as { barber_id: string }[])
        counts[v.barber_id] = (counts[v.barber_id] || 0) + 1
      setDailyServiceCounts(counts)
    }
    if (lastVisitsRes?.data) {
      const lastMap: Record<string, string> = {}
      for (const v of lastVisitsRes.data as { barber_id: string; completed_at: string }[])
        if (!lastMap[v.barber_id]) lastMap[v.barber_id] = v.completed_at
      setLastCompletedAt(lastMap)
    }
    if (attendanceRes.data) {
      const latest: Record<string, string> = {}
      attendanceRes.data.forEach((log: { staff_id: string; action_type: string }) => {
        if (!latest[log.staff_id]) latest[log.staff_id] = log.action_type
      })
      setLatestAttendance(latest)
    }
  }, [supabase])

  useEffect(() => {
    fetchQueue()
    fetchBarbers()
    fetchSchedules()

    const channel = supabase
      .channel('admin-queue')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queue_entries' }, () =>
        fetchQueue()
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff' }, () =>
        fetchBarbers()
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance_logs' }, () =>
        fetchSchedules()
      )
      .subscribe((status) => {
        // Re-fetch everything on reconnection
        if (status === 'SUBSCRIBED') {
          fetchQueue()
          fetchBarbers()
          fetchSchedules()
        }
      })

    return () => { supabase.removeChannel(channel) }
  }, [supabase, fetchQueue, fetchBarbers, fetchSchedules])

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

  // ── Handlers registro manual ──────────────────────────────────────────────
  const handleManualCheckin = async () => {
    if (!manualForm.phone || !manualForm.name) {
      toast.error('Nombre y teléfono son obligatorios')
      return
    }
    if (!selectedBranchId) {
      toast.error('Seleccioná una sucursal primero')
      return
    }
    setManualLoading(true)
    const fd = new FormData()
    fd.set('name', manualForm.name)
    fd.set('phone', manualForm.phone)
    fd.set('branch_id', selectedBranchId)
    if (manualForm.serviceId) fd.set('service_id', manualForm.serviceId)
    if (manualForm.barberId && manualForm.barberId !== DYNAMIC_BARBER) {
      fd.set('barber_id', manualForm.barberId)
    }
    const result = await checkinClient(fd)
    setManualLoading(false)
    if (result.error) {
      toast.error(result.error)
    } else if (result.alreadyInQueue) {
      toast.info('El cliente ya está en la fila')
    } else {
      toast.success('Cliente registrado en la fila')
      setManualForm({ phone: '', name: '', serviceId: '', barberId: DYNAMIC_BARBER })
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
    const result = await searchClients(trimmed)
    setSearchLoading(false)
    if (result.error) {
      toast.error(result.error)
    } else {
      setSearchResults(result.data ?? [])
    }
  }, [])

  // Búsqueda automática al escribir (debounce)
  useEffect(() => {
    if (searchQuery.trim().length < 2) {
      setSearchResults([])
      setSearchExecuted(false)
      return
    }
    const timer = setTimeout(() => handleSearch(searchQuery), 300)
    return () => clearTimeout(timer)
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
    if (searchServiceId) fd.set('service_id', searchServiceId)
    if (searchBarberId && searchBarberId !== DYNAMIC_BARBER) {
      fd.set('barber_id', searchBarberId)
    }
    const result = await checkinClient(fd)
    setSearchCheckinLoading(false)
    if (result.error) {
      toast.error(result.error)
    } else if (result.alreadyInQueue) {
      toast.info('El cliente ya está en la fila')
    } else {
      toast.success(`${client.name} registrado en la fila`)
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

    const sortedEntries = [...branchEntries].sort((a, b) => a.position - b.position)

    for (const entry of sortedEntries) {
      if (entry.status !== 'waiting') continue
      const colId = getEntryColumnId(entry)
      if (cols[colId]) cols[colId].push(entry)
    }

    return cols
  }, [branchEntries, filteredBarbers, getEntryColumnId])

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

  function handleDragStart(event: DragStartEvent) {
    const { active } = event
    
    if (active.data.current?.isTemplate) {
      setDraggedTemplate(active.data.current.config)
      return
    }

    const activeEntry = branchEntries.find((e) => e.id === active.id)
    if (activeEntry) setDraggedEntry(activeEntry)
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event
    if (!over) return

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

    if (!targetColId) return

    if (isTemplate) {
      // It's a template, don't update `entries` optimistically during dragOver since it's not a real entry
      // It just hovers perfectly fine thanks to DragOverlay.
      return
    }

    // Encontrar entry original
    const activeEntry = entries.find(e => e.id === activeId)
    if (!activeEntry) return
    const activeColId = getEntryColumnId(activeEntry)

    if (activeColId === targetColId) return

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
        const result = await createBreakEntry(branchId, targetColId, config.name)
        if ('error' in result) {
          toast.error(result.error)
        } else {
          toast.success('Descanso asignado al barbero')
        }
        await fetchQueue()
        setActionLoading(null)
      }
      return
    }

    const activeIdx = entries.findIndex(e => e.id === activeId)
    if (activeIdx === -1) return

    let finalEntries = [...entries]

    // Si cambió el orden
    if (activeId !== overId) {
      const overIdx = finalEntries.findIndex(e => e.id === overId)
      if (overIdx !== -1) {
        finalEntries = arrayMove(finalEntries, activeIdx, overIdx)
      }
    }

    // Reconstruimos posiciones desde 1 para TODA la fila esperando (branch context)
    const waitingItems = finalEntries.filter(e => e.status === 'waiting' && (!selectedBranchId || e.branch_id === selectedBranchId))
    
    // Lista de updates para Supabase
    const updates: { id: string; position: number; barber_id?: string | null; is_dynamic?: boolean; priority_order?: string }[] = []

    // Calcular priority_order sintéticos: tomar el más antiguo como base y espaciar 1s entre cada uno
    const sortedByPriority = [...waitingItems].sort((a, b) =>
      new Date(a.priority_order).getTime() - new Date(b.priority_order).getTime()
    )
    const basePriority = sortedByPriority.length > 0
      ? new Date(sortedByPriority[0].priority_order).getTime()
      : Date.now()

    waitingItems.forEach((entry, index) => {
      const newPos = index + 1
      const newPriorityOrder = new Date(basePriority + index * 1000).toISOString()

      const dbEntry = confirmedEntriesRef.current.find(e => e.id === entry.id) || entry
      const wasChanged = entry.position !== newPos || entry.barber_id !== dbEntry.barber_id || entry.is_dynamic !== dbEntry.is_dynamic

      if (wasChanged) {
        updates.push({
          id: entry.id,
          position: newPos,
          barber_id: entry.barber_id,
          is_dynamic: entry.is_dynamic,
          priority_order: newPriorityOrder,
        })
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
      updateQueueOrder(updates).then((result) => {
        if ('error' in result) {
          toast.error(result.error)
          setEntries(originalEntries)
          confirmedEntriesRef.current = originalEntries
        }
      })
    } else {
      setEntries(finalEntries)
    }
  }

  async function handleCancel(entryId: string) {
    setActionLoading(entryId)
    const result = await cancelQueueEntry(entryId)
    if ('error' in result) toast.error(result.error)
    else toast.success('Turno cancelado')
    await fetchQueue()
    setActionLoading(null)
  }

  async function handleStartService(entry: QueueEntry) {
    if (!entry.barber_id) {
      toast.error('El cliente no tiene barbero asignado')
      return
    }
    setActionLoading(entry.id)
    const result = await startService(entry.id, entry.barber_id)
    if ('error' in result) toast.error(result.error)
    else toast.success('Corte iniciado')
    await fetchQueue()
    setActionLoading(null)
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
        fetchQueue() // reset visual state
      }}
    >
      <div className="flex flex-col gap-2 lg:gap-4 p-1 md:h-[calc(100dvh-9rem)] lg:h-[calc(100dvh-9.5rem)] md:overflow-hidden">

        {/* Encabezado y Descansos (Top Bar) */}
        <div className="flex shrink-0 flex-col gap-2 lg:gap-3 px-2">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h2 className="text-lg lg:text-xl font-bold tracking-tight">Fila en vivo</h2>
              <p className="text-xs text-muted-foreground hidden sm:block">
                Arrastrá clientes o descansos libremente para asignarlos o reordenarlos.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 shrink-0"
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
            <Dialog open={manualDialogOpen} onOpenChange={setManualDialogOpen}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Registro manual</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-4 py-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="manual-phone">Teléfono</Label>
                    <Input
                      id="manual-phone"
                      placeholder="Ej: 1122334455"
                      value={manualForm.phone}
                      onChange={(e) => setManualForm((f) => ({ ...f, phone: e.target.value }))}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="manual-name">Nombre</Label>
                    <Input
                      id="manual-name"
                      placeholder="Nombre del cliente"
                      value={manualForm.name}
                      onChange={(e) => setManualForm((f) => ({ ...f, name: e.target.value }))}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Servicio</Label>
                    <Select
                      value={manualForm.serviceId}
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
                      </SelectContent>
                    </Select>
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
                    {manualLoading ? 'Registrando…' : 'Agregar a la fila'}
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
                        <Select value={searchServiceId} onValueChange={setSearchServiceId}>
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
                          </SelectContent>
                        </Select>
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
          
          <div className="flex items-center gap-2 lg:gap-3 overflow-x-auto pb-1 lg:pb-2 -mx-1 px-1">
            <a
              href="/dashboard/equipo?tab=descansos"
              className="flex items-center gap-1.5 lg:gap-2 px-2.5 lg:px-3 py-1.5 lg:py-2 rounded-lg bg-amber-500/10 text-amber-500 text-xs lg:text-sm font-bold border border-amber-500/20 shrink-0 transition-colors active:bg-amber-500/20"
            >
              <Pause className="size-3.5 lg:size-4" />
              {breakConfigs.filter((c) => !selectedBranchId || c.branch_id === selectedBranchId).length > 0
                ? 'Descansos'
                : 'Sin descansos'}
            </a>
            {breakConfigs
              .filter((c) => !selectedBranchId || c.branch_id === selectedBranchId)
              .map((config) => (
                <div key={config.id} className="w-40 lg:w-48 shrink-0">
                  <BreakTemplateCard config={config} />
                </div>
              ))}
          </div>
        </div>

        {/* Cards resumen rápido */}
        <div className="grid grid-cols-3 gap-2 lg:gap-3 shrink-0 px-2">
          <div className="flex items-center gap-2.5 rounded-xl border border-zinc-800/80 bg-zinc-900/60 px-3 py-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-blue-500/15">
              <Scissors className="size-4 text-blue-400" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-muted-foreground leading-none">En atención</p>
              <p className="text-lg font-bold leading-tight text-zinc-100">
                {branchEntries.filter(e => e.status === 'in_progress' && !e.is_break).length}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 rounded-xl border border-zinc-800/80 bg-zinc-900/60 px-3 py-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-amber-500/15">
              <Clock className="size-4 text-amber-400" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-muted-foreground leading-none">En cola</p>
              <p className="text-lg font-bold leading-tight text-zinc-100">
                {branchEntries.filter(e => e.status === 'waiting' && !e.is_break).length}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 rounded-xl border border-zinc-800/80 bg-zinc-900/60 px-3 py-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/15">
              <Check className="size-4 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-muted-foreground leading-none">Servicios del día</p>
              <p className="text-lg font-bold leading-tight text-zinc-100">
                {selectedBranchId
                  ? filteredBarbers.reduce((sum, b) => sum + (dailyServiceCounts[b.id] || 0), 0)
                  : Object.values(dailyServiceCounts).reduce((a, b) => a + b, 0)}
              </p>
            </div>
          </div>
        </div>

        {/* Tablero Kanban (Grid Layout) */}
        <div className="relative mt-1 flex flex-none overflow-visible border-t border-zinc-800/80 bg-zinc-950/40 lg:mt-2 md:min-h-0 md:flex-1 md:overflow-auto">
          <div className="flex flex-col md:flex-row md:min-w-max w-full md:h-full">

            {/* Columna Dinámicos (Sticky a la izquierda) */}
            <div className="md:sticky md:left-0 z-30 flex md:shrink-0 md:shadow-[4px_0_24px_-8px_rgba(0,0,0,0.8)] bg-zinc-950">
              <DynamicColumn
                id="__dynamic__"
                entries={columnsData['__dynamic__']}
                formatElapsed={formatElapsed}
                onCancel={handleCancel}
                actionLoading={actionLoading}
                selectedBranchId={selectedBranchId}
                getBranchName={getBranchName}
              />
            </div>

            {/* Filas de Barberos (Se expanden a la derecha) */}
            <div className="flex-1 flex flex-col bg-zinc-950/20 md:min-w-max">
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
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <DragOverlay dropAnimation={dropAnimation}>
        {draggedEntry && <DragGhost entry={draggedEntry} />}
        {draggedTemplate && (
          <div className="rotate-[2deg] scale-105 opacity-90 w-[270px] pointer-events-none">
            <BreakTemplateCard config={draggedTemplate} />
          </div>
        )}
      </DragOverlay>

      {completingEntry && (
        <CompleteServiceDialog
          entry={completingEntry}
          branchId={completingEntry.branch_id}
          onClose={() => setCompletingEntry(null)}
          onCompleted={async () => {
            setCompletingEntry(null)
            toast.success('Corte finalizado')
            await fetchQueue()
          }}
        />
      )}
    </DndContext>
  )
}
