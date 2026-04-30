'use client'

import { useState, useEffect, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Loader2, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getAvailableSlotsForBranch } from '@/lib/actions/turnos'
import type { TurnosSlot } from '@/lib/actions/turnos'

interface Props {
  branchId: string
  totalDurationMinutes: number
  staffId: string | null
  selectedDate: string | null
  selectedTime: string | null
  onSelect: (date: string, time: string) => void
}

/** Genera los días habilitados: hoy + próximos 30 días */
function buildCalendarDays(): { dateStr: string; label: string; dayNum: number; dayName: string }[] {
  const days: { dateStr: string; label: string; dayNum: number; dayName: string }[] = []
  const base = new Date()
  for (let i = 0; i < 30; i++) {
    const d = new Date(base)
    d.setDate(base.getDate() + i)
    const iso = d.toISOString().split('T')[0]
    days.push({
      dateStr: iso,
      label: d.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' }),
      dayNum: d.getDate(),
      dayName: d.toLocaleDateString('es-AR', { weekday: 'short' }),
    })
  }
  return days
}

function formatTimeHM(t: string) {
  return t.slice(0, 5)
}

export function SlotStep({
  branchId,
  totalDurationMinutes,
  staffId,
  selectedDate,
  selectedTime,
  onSelect,
}: Props) {
  const days = useMemo(() => buildCalendarDays(), [])
  const [activeDate, setActiveDate] = useState<string>(selectedDate ?? days[0].dateStr)
  const [slots, setSlots] = useState<TurnosSlot[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [weekOffset, setWeekOffset] = useState(0)

  const DAYS_PER_PAGE = 7
  const visibleDays = days.slice(weekOffset * DAYS_PER_PAGE, (weekOffset + 1) * DAYS_PER_PAGE)
  const canGoBack = weekOffset > 0
  const canGoForward = (weekOffset + 1) * DAYS_PER_PAGE < days.length

  useEffect(() => {
    if (!branchId || !activeDate || totalDurationMinutes <= 0) return

    let alive = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError('')
    setSlots([])

    getAvailableSlotsForBranch(branchId, activeDate, totalDurationMinutes, staffId).then((res) => {
      if (!alive) return
      if ('error' in res) {
        setError(res.error)
      } else {
        setSlots(res.data)
      }
      setLoading(false)
    })

    return () => { alive = false }
  }, [branchId, activeDate, totalDurationMinutes, staffId])

  const availableSlots = slots.filter((s) => s.available)
  const unavailableSlots = slots.filter((s) => !s.available)

  return (
    <div className="space-y-4">
      {/* Navegador de semana */}
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="size-7 shrink-0"
          onClick={() => setWeekOffset((w) => w - 1)}
          disabled={!canGoBack}
          aria-label="Semana anterior"
        >
          <ChevronLeft className="size-3.5" />
        </Button>

        <div className="flex flex-1 gap-1 overflow-hidden">
          {visibleDays.map((day) => {
            const isActive = day.dateStr === activeDate
            const isSelected = day.dateStr === selectedDate
            return (
              <button
                key={day.dateStr}
                type="button"
                onClick={() => {
                  setActiveDate(day.dateStr)
                  // Si cambia la fecha, limpiar el tiempo previamente seleccionado
                  if (day.dateStr !== selectedDate) {
                    // No limpiar aquí — el padre lo maneja al onSelect
                  }
                }}
                className={cn(
                  'flex flex-1 flex-col items-center rounded-md border px-1 py-1.5 text-center text-[11px] transition-colors hover:bg-accent',
                  isActive && !isSelected && 'border-primary/50 bg-primary/5',
                  isSelected && 'border-primary bg-primary text-primary-foreground'
                )}
              >
                <span className="font-medium capitalize">{day.dayName}</span>
                <span className={cn('text-base font-bold leading-tight', isSelected && 'text-primary-foreground')}>
                  {day.dayNum}
                </span>
              </button>
            )
          })}
        </div>

        <Button
          variant="outline"
          size="icon"
          className="size-7 shrink-0"
          onClick={() => setWeekOffset((w) => w + 1)}
          disabled={!canGoForward}
          aria-label="Semana siguiente"
        >
          <ChevronRight className="size-3.5" />
        </Button>
      </div>

      {/* Fecha activa label */}
      <p className="text-xs text-muted-foreground capitalize">
        {new Date(activeDate + 'T12:00:00').toLocaleDateString('es-AR', {
          weekday: 'long', day: 'numeric', month: 'long',
        })}
      </p>

      {/* Grilla de slots */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : totalDurationMinutes <= 0 ? (
        <p className="text-sm text-muted-foreground">
          Seleccioná al menos un servicio para ver la disponibilidad.
        </p>
      ) : availableSlots.length === 0 && unavailableSlots.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No hay horarios configurados para este día.
        </p>
      ) : availableSlots.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No hay horarios disponibles para este día. Probá otra fecha.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
            {slots.map((slot) => {
              const isSelected = slot.time === selectedTime && activeDate === selectedDate
              return (
                <button
                  key={slot.time}
                  type="button"
                  disabled={!slot.available}
                  onClick={() => onSelect(activeDate, slot.time)}
                  className={cn(
                    'flex items-center justify-center rounded border px-2 py-2 text-sm font-mono font-medium transition-colors',
                    slot.available
                      ? 'hover:border-primary hover:bg-primary/5 cursor-pointer'
                      : 'cursor-not-allowed border-dashed opacity-40',
                    isSelected && 'border-primary bg-primary text-primary-foreground hover:bg-primary'
                  )}
                >
                  {formatTimeHM(slot.time)}
                </button>
              )
            })}
          </div>

          <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block size-2.5 rounded-sm border border-primary bg-primary" />
              Seleccionado
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block size-2.5 rounded-sm border" />
              Disponible
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block size-2.5 rounded-sm border border-dashed opacity-40" />
              No disponible
            </span>
          </div>
        </div>
      )}

      {selectedDate && selectedTime && (
        <div className="flex items-center gap-2 rounded-md border border-green-500/30 bg-green-500/5 px-3 py-2 text-sm">
          <Clock className="size-3.5 text-green-600" />
          <span>
            Turno seleccionado:{' '}
            <span className="font-semibold">
              {new Date(selectedDate + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
              {' · '}
              {formatTimeHM(selectedTime)}
            </span>
          </span>
        </div>
      )}
    </div>
  )
}
