'use client'

import * as React from 'react'
import { useMemo, useState, useRef, useEffect } from 'react'
import Image from 'next/image'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  DragOverlay,
  type DragEndEvent,
} from '@dnd-kit/core'
import { cn } from '@/lib/utils'
import { Loader2 } from 'lucide-react'
import type { Appointment, AppointmentStatus, AppointmentBlock } from '@/lib/types/database'

export interface GridBarber {
  id: string
  full_name: string
  avatar_url: string | null
}

export interface GridSlotSelection {
  barberId: string
  time: string  // "HH:mm"
}

export type ZoomLevel = 15 | 30 | 60

interface Props {
  date: string
  barbers: GridBarber[]
  appointments: Appointment[]
  blocks?: AppointmentBlock[]
  slotInterval: number  // settings base — zoom sobrescribe esto
  hoursOpen: string
  hoursClose: string
  zoom?: ZoomLevel
  onSlotClick?: (barberId: string, time: string) => void
  onAppointmentClick?: (appointment: Appointment) => void
  onAppointmentMove?: (args: {
    appointmentId: string
    newBarberId: string
    newTime: string
  }) => Promise<{ error?: string } | void>
  onAppointmentResize?: (args: {
    appointmentId: string
    newDurationMinutes: number
  }) => Promise<{ error?: string } | void>
  selected?: { appointmentId?: string; slot?: GridSlotSelection }
  className?: string
}

const STATUS_STYLES: Record<AppointmentStatus, string> = {
  pending_payment: 'bg-amber-500/70 text-white border-amber-600 border-dashed',
  confirmed:   'bg-blue-500/90 text-white border-blue-600',
  checked_in:  'bg-amber-500/90 text-white border-amber-600',
  in_progress: 'bg-emerald-500/90 text-white border-emerald-600',
  completed:   'bg-slate-400/80 text-white border-slate-500',
  cancelled:   'bg-red-400/60 text-white border-red-500 line-through opacity-70',
  no_show:     'bg-red-500/80 text-white border-red-600',
}

// Altura base por slot según zoom
const ROW_HEIGHT_BY_ZOOM: Record<ZoomLevel, number> = {
  15: 20,
  30: 36,
  60: 64,
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function minutesToTime(m: number): string {
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/**
 * Celda droppable (un slot vacío donde se puede soltar un turno).
 */
function DroppableSlot({
  barberId,
  time,
  isBlocked,
  isSelected,
  onClick,
  rowHeight,
  isEvenRow,
}: {
  barberId: string
  time: string
  isBlocked: boolean
  isSelected: boolean
  onClick?: () => void
  rowHeight: number
  isEvenRow: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `slot:${barberId}:${time}`,
    data: { barberId, time },
    disabled: isBlocked,
  })

  return (
    <div
      ref={setNodeRef}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      aria-label={`${barberId} ${time}`}
      className={cn(
        'border-b border-r transition-colors relative',
        onClick && !isBlocked && 'cursor-pointer hover:bg-primary/5',
        isOver && !isBlocked && 'bg-primary/15',
        isSelected && 'bg-primary/10 ring-1 ring-inset ring-primary',
        !isSelected && isEvenRow && !isBlocked && 'bg-muted/20',
        isBlocked && 'bg-[repeating-linear-gradient(-45deg,rgba(244,63,94,0.08)_0_6px,transparent_6px_12px)] cursor-not-allowed'
      )}
      style={{ height: rowHeight }}
    />
  )
}

/**
 * Turno draggable con resize-handle inferior.
 */
function DraggableAppointment({
  appointment,
  topPx,
  heightPx,
  isSelected,
  onClick,
  onResizeStart,
}: {
  appointment: Appointment
  topPx: number
  heightPx: number
  isSelected: boolean
  onClick?: () => void
  onResizeStart?: (e: React.PointerEvent) => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `appt:${appointment.id}`,
    data: { appointmentId: appointment.id, duration: appointment.duration_minutes },
  })

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        if (isDragging) return
        e.stopPropagation()
        onClick?.()
      }}
      className={cn(
        'pointer-events-auto absolute left-0.5 right-0.5 overflow-hidden rounded-md border-l-2 px-1.5 py-0.5 text-left text-[11px] shadow-sm cursor-grab active:cursor-grabbing',
        STATUS_STYLES[appointment.status],
        isSelected && 'ring-2 ring-ring ring-offset-1',
        isDragging && 'opacity-0'
      )}
      style={{ top: topPx + 1, height: heightPx }}
    >
      <div className="flex items-center gap-1 font-semibold leading-tight">
        <span className="font-mono">{appointment.start_time.slice(0, 5)}</span>
        <span className="truncate">{appointment.client?.name ?? 'Cliente'}</span>
      </div>
      {heightPx > 34 && appointment.service?.name && (
        <div className="truncate leading-tight opacity-90">{appointment.service.name}</div>
      )}
      {heightPx > 52 && appointment.payment_status === 'paid' && (
        <div className="truncate text-[10px] opacity-80">✓ Pagado</div>
      )}
      {appointment.source === 'manual' && (
        <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-white/70" title="Manual" />
      )}
      {onResizeStart && heightPx > 24 && (
        <div
          onPointerDown={(e) => {
            e.stopPropagation()
            onResizeStart(e)
          }}
          className="absolute bottom-0 left-0 right-0 h-1.5 cursor-ns-resize hover:bg-white/30"
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
  zoom: zoomProp,
  onSlotClick,
  onAppointmentClick,
  onAppointmentMove,
  onAppointmentResize,
  selected,
  className,
  date,
}: Props) {
  // Zoom = intervalo de render. Por defecto usa slotInterval (si es válido).
  const defaultZoom: ZoomLevel = (
    slotInterval === 15 || slotInterval === 30 || slotInterval === 60
      ? slotInterval
      : 30
  ) as ZoomLevel
  const zoom = zoomProp ?? defaultZoom
  const ROW_H = ROW_HEIGHT_BY_ZOOM[zoom]

  const openMin = timeToMinutes(hoursOpen.slice(0, 5))
  const closeMin = timeToMinutes(hoursClose.slice(0, 5))
  const rowCount = Math.max(1, Math.ceil((closeMin - openMin) / zoom))

  const rowLabels = useMemo(() => {
    const out: string[] = []
    for (let i = 0; i < rowCount; i++) {
      out.push(minutesToTime(openMin + i * zoom))
    }
    return out
  }, [rowCount, openMin, zoom])

  const apptsByBarber = useMemo(() => {
    const map = new Map<string, Appointment[]>()
    for (const a of appointments) {
      const key = a.barber_id ?? 'unassigned'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(a)
    }
    return map
  }, [appointments])

  // Indice rápido de celdas bloqueadas por (barberId, minutoSlot)
  const blockedCells = useMemo(() => {
    const set = new Set<string>()
    for (const b of blocks) {
      const bStart = new Date(b.start_at).getTime()
      const bEnd = new Date(b.end_at).getTime()
      for (const barber of barbers) {
        // Un bloque aplica a este barbero si: es org-wide, o es de la sucursal y barber_id es null o matchea
        const applies =
          b.branch_id === null ||
          (b.barber_id === null) ||
          (b.barber_id === barber.id)
        if (!applies) continue
        for (let m = openMin; m < closeMin; m += zoom) {
          const slotStart = new Date(`${date}T${minutesToTime(m)}:00`).getTime()
          const slotEnd = slotStart + zoom * 60000
          if (slotStart < bEnd && slotEnd > bStart) {
            set.add(`${barber.id}:${minutesToTime(m)}`)
          }
        }
      }
    }
    return set
  }, [blocks, barbers, openMin, closeMin, zoom, date])

  // Línea "ahora" (solo para hoy)
  const [nowOffset, setNowOffset] = useState<number | null>(null)
  useEffect(() => {
    const update = () => {
      const todayStr = new Date().toISOString().split('T')[0]
      if (date !== todayStr) {
        setNowOffset(null)
        return
      }
      const now = new Date()
      const nowMinutes = now.getHours() * 60 + now.getMinutes()
      if (nowMinutes < openMin || nowMinutes > closeMin) {
        setNowOffset(null)
        return
      }
      setNowOffset(((nowMinutes - openMin) / zoom) * ROW_H)
    }
    update()
    const id = setInterval(update, 60000)
    return () => clearInterval(id)
  }, [date, openMin, closeMin, zoom, ROW_H])

  // ─── DnD handlers ───────────────────────────────────────────────
  const sensors = useSensors(useSensor(PointerSensor, {
    activationConstraint: { distance: 5 },
  }))

  const [draggingId, setDraggingId] = useState<string | null>(null)
  const draggingAppt = useMemo(
    () => appointments.find(a => a.id === draggingId) ?? null,
    [draggingId, appointments]
  )
  const [movePending, setMovePending] = useState(false)

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setDraggingId(null)
    if (!over || !onAppointmentMove) return

    const appointmentId = String(active.id).replace(/^appt:/, '')
    const overData = over.data.current as { barberId?: string; time?: string } | undefined
    if (!overData?.barberId || !overData.time) return

    const appt = appointments.find(a => a.id === appointmentId)
    if (!appt) return
    if (appt.barber_id === overData.barberId && appt.start_time.slice(0, 5) === overData.time) return

    setMovePending(true)
    void onAppointmentMove({
      appointmentId,
      newBarberId: overData.barberId,
      newTime: overData.time,
    }).finally(() => setMovePending(false))
  }

  // ─── Resize handler ───────────────────────────────────────────────
  const resizeRef = useRef<{
    appointmentId: string
    initialHeight: number
    initialY: number
    initialDuration: number
    currentDuration: number
  } | null>(null)
  const [resizingDuration, setResizingDuration] = useState<Record<string, number>>({})

  function handleResizeStart(appointment: Appointment, e: React.PointerEvent) {
    const startMin = timeToMinutes(appointment.start_time.slice(0, 5))
    const endMin = timeToMinutes(appointment.end_time.slice(0, 5))
    const initialHeight = ((endMin - startMin) / zoom) * ROW_H
    resizeRef.current = {
      appointmentId: appointment.id,
      initialHeight,
      initialY: e.clientY,
      initialDuration: appointment.duration_minutes,
      currentDuration: appointment.duration_minutes,
    }
    const onMove = (ev: PointerEvent) => {
      if (!resizeRef.current) return
      const dy = ev.clientY - resizeRef.current.initialY
      const newHeight = Math.max(ROW_H, resizeRef.current.initialHeight + dy)
      // Snap al slot
      const newDuration = Math.max(zoom, Math.round(newHeight / ROW_H) * zoom)
      resizeRef.current.currentDuration = newDuration
      setResizingDuration(prev => ({ ...prev, [resizeRef.current!.appointmentId]: newDuration }))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const ref = resizeRef.current
      resizeRef.current = null
      if (!ref) return
      const newDur = ref.currentDuration
      setResizingDuration(prev => {
        const next = { ...prev }
        delete next[ref.appointmentId]
        return next
      })
      if (newDur !== ref.initialDuration && onAppointmentResize) {
        void onAppointmentResize({
          appointmentId: ref.appointmentId,
          newDurationMinutes: newDur,
        })
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(ev) => setDraggingId(String(ev.active.id).replace(/^appt:/, ''))}
      onDragCancel={() => setDraggingId(null)}
      onDragEnd={handleDragEnd}
    >
      <div className={cn('relative overflow-auto rounded-lg border bg-card', className)}>
        {movePending && (
          <div className="absolute right-2 top-2 z-30 flex items-center gap-1 rounded-md bg-background/90 px-2 py-1 text-xs shadow-sm">
            <Loader2 className="h-3 w-3 animate-spin" />
            Moviendo…
          </div>
        )}

        <div
          className="grid relative"
          style={{
            gridTemplateColumns: `64px repeat(${barbers.length}, minmax(140px, 1fr))`,
            gridTemplateRows: `auto repeat(${rowCount}, ${ROW_H}px)`,
          }}
        >
          {/* Header */}
          <div className="sticky top-0 z-20 border-b border-r bg-background/95 backdrop-blur-sm" />
          {barbers.map(b => (
            <div
              key={b.id}
              className="sticky top-0 z-20 flex items-center gap-2 border-b border-r bg-background/95 px-2 py-2 backdrop-blur-sm"
            >
              {b.avatar_url ? (
                <Image src={b.avatar_url} alt="" width={24} height={24} className="h-6 w-6 rounded-full object-cover" unoptimized />
              ) : (
                <div className="h-6 w-6 rounded-full bg-muted" />
              )}
              <span className="truncate text-sm font-medium">{b.full_name}</span>
            </div>
          ))}

          {/* Filas */}
          {rowLabels.map((label, i) => (
            <div key={`row-${label}`} className="contents">
              <div
                className="sticky left-0 z-10 flex items-start justify-end border-b border-r bg-background pr-1 pt-0.5 font-mono text-[10px] text-muted-foreground"
                style={{ height: ROW_H }}
              >
                {(zoom === 15 ? i % 4 === 0 : zoom === 30 ? i % 2 === 0 : true) ? label : ''}
              </div>
              {barbers.map(b => {
                const isSelectedSlot =
                  selected?.slot?.barberId === b.id && selected.slot.time === label
                const cellKey = `${b.id}:${label}`
                const isBlocked = blockedCells.has(cellKey)
                return (
                  <DroppableSlot
                    key={cellKey}
                    barberId={b.id}
                    time={label}
                    isBlocked={isBlocked}
                    isSelected={!!isSelectedSlot}
                    onClick={onSlotClick && !isBlocked ? () => onSlotClick(b.id, label) : undefined}
                    rowHeight={ROW_H}
                    isEvenRow={i % 2 === 1}
                  />
                )
              })}
            </div>
          ))}

          {/* Línea "ahora" — solo para hoy */}
          {nowOffset !== null && (
            <div
              className="pointer-events-none relative"
              style={{
                gridColumnStart: 2,
                gridColumnEnd: barbers.length + 2,
                gridRowStart: 2,
                gridRowEnd: rowCount + 2,
              }}
            >
              <div
                className="pointer-events-none absolute left-0 right-0 z-[15] border-t-2 border-red-500"
                style={{ top: nowOffset }}
              >
                <div className="absolute -left-1 -top-1.5 h-3 w-3 rounded-full bg-red-500" />
              </div>
            </div>
          )}

          {/* Overlays de turnos */}
          {barbers.map((b, colIdx) => {
            const list = apptsByBarber.get(b.id) ?? []
            return (
              <div
                key={`overlay-${b.id}`}
                className="pointer-events-none relative"
                style={{
                  gridColumnStart: colIdx + 2,
                  gridRowStart: 2,
                  gridRowEnd: rowCount + 2,
                }}
              >
                {list.map(a => {
                  const startMin = timeToMinutes(a.start_time.slice(0, 5))
                  const endMin = timeToMinutes(a.end_time.slice(0, 5))
                  const offsetPx = ((startMin - openMin) / zoom) * ROW_H
                  const overrideDur = resizingDuration[a.id]
                  const effectiveDur = overrideDur ?? (endMin - startMin)
                  const heightPx = Math.max(
                    ROW_H - 2,
                    (effectiveDur / zoom) * ROW_H - 2
                  )
                  const isSelected = selected?.appointmentId === a.id
                  return (
                    <DraggableAppointment
                      key={a.id}
                      appointment={a}
                      topPx={offsetPx}
                      heightPx={heightPx}
                      isSelected={isSelected}
                      onClick={() => onAppointmentClick?.(a)}
                      onResizeStart={onAppointmentResize ? (e) => handleResizeStart(a, e) : undefined}
                    />
                  )
                })}
              </div>
            )
          })}
        </div>

        {/* DragOverlay — muestra el turno siendo arrastrado */}
        <DragOverlay dropAnimation={null}>
          {draggingAppt && (
            <div
              className={cn(
                'rounded-md border-l-2 px-1.5 py-0.5 text-[11px] shadow-lg opacity-95',
                STATUS_STYLES[draggingAppt.status]
              )}
              style={{ width: 160 }}
            >
              <div className="flex items-center gap-1 font-semibold leading-tight">
                <span className="font-mono">{draggingAppt.start_time.slice(0, 5)}</span>
                <span className="truncate">{draggingAppt.client?.name ?? 'Cliente'}</span>
              </div>
              {draggingAppt.service?.name && (
                <div className="truncate leading-tight opacity-90">{draggingAppt.service.name}</div>
              )}
            </div>
          )}
        </DragOverlay>
      </div>
    </DndContext>
  )
}
