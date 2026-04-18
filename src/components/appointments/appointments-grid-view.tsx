'use client'

import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import type { Appointment, AppointmentStatus } from '@/lib/types/database'

export interface GridBarber {
  id: string
  full_name: string
  avatar_url: string | null
}

export interface GridSlotSelection {
  barberId: string
  time: string  // "HH:mm"
}

interface Props {
  date: string                    // "YYYY-MM-DD" — usado para labels, no para lógica
  barbers: GridBarber[]
  appointments: Appointment[]     // deben estar en el mismo branch/date
  slotInterval: number            // en minutos (e.g. 30)
  hoursOpen: string               // "HH:mm" o "HH:mm:ss"
  hoursClose: string              // "HH:mm"
  onSlotClick?: (barberId: string, time: string) => void
  onAppointmentClick?: (appointment: Appointment) => void
  selected?: { appointmentId?: string; slot?: GridSlotSelection }
  className?: string
}

const STATUS_STYLES: Record<AppointmentStatus, string> = {
  confirmed:   'bg-blue-500/90 text-white border-blue-600',
  checked_in:  'bg-amber-500/90 text-white border-amber-600',
  in_progress: 'bg-emerald-500/90 text-white border-emerald-600',
  completed:   'bg-slate-400/80 text-white border-slate-500',
  cancelled:   'bg-red-400/60 text-white border-red-500 line-through opacity-70',
  no_show:     'bg-red-500/80 text-white border-red-600',
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

export function AppointmentsGridView({
  barbers,
  appointments,
  slotInterval,
  hoursOpen,
  hoursClose,
  onSlotClick,
  onAppointmentClick,
  selected,
  className,
}: Props) {
  const openMin = timeToMinutes(hoursOpen.slice(0, 5))
  const closeMin = timeToMinutes(hoursClose.slice(0, 5))
  const rowCount = Math.max(1, Math.ceil((closeMin - openMin) / slotInterval))

  const rowLabels = useMemo(() => {
    const out: string[] = []
    for (let i = 0; i < rowCount; i++) {
      out.push(minutesToTime(openMin + i * slotInterval))
    }
    return out
  }, [rowCount, openMin, slotInterval])

  const apptsByBarber = useMemo(() => {
    const map = new Map<string, Appointment[]>()
    for (const a of appointments) {
      const key = a.barber_id ?? 'unassigned'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(a)
    }
    return map
  }, [appointments])

  // Altura de cada fila en px: fijo para precisión visual del bloque
  const ROW_H = 28

  return (
    <div className={cn('overflow-auto rounded-lg border bg-card', className)}>
      <div
        className="grid"
        style={{
          gridTemplateColumns: `64px repeat(${barbers.length}, minmax(140px, 1fr))`,
        }}
      >
        {/* Header fila 0: etiqueta tiempo + nombres de barberos */}
        <div className="sticky top-0 z-20 border-b border-r bg-background/95 backdrop-blur-sm" />
        {barbers.map(b => (
          <div
            key={b.id}
            className="sticky top-0 z-20 flex items-center gap-2 border-b border-r bg-background/95 px-2 py-2 backdrop-blur-sm"
          >
            {b.avatar_url ? (
              <img src={b.avatar_url} alt="" className="h-6 w-6 rounded-full object-cover" />
            ) : (
              <div className="h-6 w-6 rounded-full bg-muted" />
            )}
            <span className="truncate text-sm font-medium">{b.full_name}</span>
          </div>
        ))}

        {/* Filas de tiempo */}
        {rowLabels.map((label, i) => (
          <div key={`row-${label}`} className="contents">
            <div
              className="sticky left-0 z-10 flex items-start justify-end border-b border-r bg-background pr-1 pt-0.5 font-mono text-[10px] text-muted-foreground"
              style={{ height: ROW_H }}
            >
              {i % 2 === 0 ? label : ''}
            </div>
            {barbers.map(b => {
              const isSelectedSlot =
                selected?.slot?.barberId === b.id && selected.slot.time === label
              return (
                <button
                  key={`${b.id}-${label}`}
                  type="button"
                  onClick={() => onSlotClick?.(b.id, label)}
                  disabled={!onSlotClick}
                  className={cn(
                    'border-b border-r transition-colors',
                    onSlotClick && 'hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary',
                    isSelectedSlot && 'bg-primary/10 ring-1 ring-inset ring-primary',
                    i % 2 === 1 && !isSelectedSlot && 'bg-muted/20',
                  )}
                  style={{ height: ROW_H }}
                  aria-label={`${b.full_name} a las ${label}`}
                />
              )
            })}
          </div>
        ))}

        {/* Bloques de turnos: overlay absoluto sobre cada columna */}
        {barbers.map((b, colIdx) => {
          const list = apptsByBarber.get(b.id) ?? []
          return (
            <div
              key={`overlay-${b.id}`}
              className="pointer-events-none relative"
              style={{
                gridColumnStart: colIdx + 2, // +1 por la col del time-label, +1 por 1-indexed
                gridRowStart: 2,
                gridRowEnd: rowCount + 2,
              }}
            >
              {list.map(a => {
                const startMin = timeToMinutes(a.start_time.slice(0, 5))
                const endMin = timeToMinutes(a.end_time.slice(0, 5))
                const offsetPx = ((startMin - openMin) / slotInterval) * ROW_H
                const heightPx = Math.max(
                  ROW_H - 2,
                  ((endMin - startMin) / slotInterval) * ROW_H - 2
                )
                const isSelected = selected?.appointmentId === a.id
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => onAppointmentClick?.(a)}
                    disabled={!onAppointmentClick}
                    className={cn(
                      'pointer-events-auto absolute left-0.5 right-0.5 overflow-hidden rounded-md border-l-2 px-1.5 py-0.5 text-left text-[11px] shadow-sm transition-all',
                      STATUS_STYLES[a.status],
                      onAppointmentClick && 'hover:brightness-110',
                      isSelected && 'ring-2 ring-ring ring-offset-1',
                    )}
                    style={{ top: offsetPx + 1, height: heightPx }}
                  >
                    <div className="flex items-center gap-1 font-semibold leading-tight">
                      <span className="font-mono">{a.start_time.slice(0, 5)}</span>
                      <span className="truncate">{a.client?.name ?? 'Cliente'}</span>
                    </div>
                    {heightPx > ROW_H && a.service?.name && (
                      <div className="truncate leading-tight opacity-90">{a.service.name}</div>
                    )}
                    {a.source === 'manual' && (
                      <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-white/70" title="Manual" />
                    )}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
