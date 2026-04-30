'use client'

import { useState, useEffect } from 'react'
import { Calendar } from '@/components/ui/calendar'
import { es } from 'date-fns/locale'
import { Loader2, CalendarDays, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { publicGetAvailableSlots } from '@/lib/actions/public-booking'
import type { PublicSlotGroup } from '@/lib/actions/public-booking'

interface Props {
  branchId: string
  serviceId: string
  staffId: string | null
  slotIntervalMinutes: number
  maxAdvanceDays: number
  appointmentDays: number[]
  selectedDate: Date | undefined
  selectedTime: string
  onDateChange: (d: Date | undefined) => void
  onSlotSelect: (time: string, staffId: string, staffName: string) => void
  branding: { primary: string; bg: string; text: string }
}

function formatDateISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function SlotStep({
  branchId,
  serviceId,
  staffId,
  maxAdvanceDays,
  appointmentDays,
  selectedDate,
  selectedTime,
  onDateChange,
  onSlotSelect,
  branding,
}: Props) {
  const [slotGroups, setSlotGroups] = useState<PublicSlotGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const maxDate = new Date()
  maxDate.setDate(maxDate.getDate() + maxAdvanceDays)
  maxDate.setHours(23, 59, 59, 999)

  // Cargar slots cuando cambia la fecha
  useEffect(() => {
    if (!selectedDate || !serviceId) return
    let cancelled = false

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError('')
    setSlotGroups([])

    const dateStr = formatDateISO(selectedDate)
    publicGetAvailableSlots(branchId, dateStr, serviceId, staffId ?? undefined).then(result => {
      if (cancelled) return
      setSlotGroups(result.slots)
      if (result.error) setError(result.error)
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [selectedDate, serviceId, staffId, branchId])

  const disabledDays = [
    { before: today },
    { after: maxDate },
    (date: Date) => !appointmentDays.includes(date.getDay()),
  ]

  const dateFormatted = selectedDate
    ? selectedDate.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
    : ''

  const hasAvailableSlots = slotGroups.some(g => g.slots.some(s => s.available))

  return (
    <div className="space-y-5">
      {/* Calendario */}
      <div
        className="flex justify-center rounded-xl border bg-white p-3 text-slate-900"
        style={{ borderColor: 'rgba(0,0,0,0.08)' }}
      >
        <Calendar
          mode="single"
          locale={es}
          selected={selectedDate}
          onSelect={d => {
            onDateChange(d)
            setSlotGroups([])
          }}
          disabled={disabledDays}
          defaultMonth={selectedDate ?? today}
          className="!bg-transparent [--cell-size:--spacing(11)]"
          classNames={{
            day: 'group/day relative aspect-square h-full w-full p-0 text-center select-none text-slate-900',
            weekday: 'flex-1 rounded-md text-[0.8rem] font-normal text-slate-500 select-none',
            caption_label: 'font-medium select-none text-sm text-slate-900',
            today: 'rounded-md bg-slate-100 text-slate-900 data-[selected=true]:rounded-none',
            outside: 'text-slate-400 aria-selected:text-slate-400',
            disabled: 'text-slate-300 opacity-40',
          }}
        />
      </div>

      {/* Panel de horarios */}
      {!selectedDate ? (
        <div
          className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center"
          style={{ borderColor: 'rgba(0,0,0,0.10)' }}
        >
          <CalendarDays className="h-8 w-8 opacity-30" style={{ color: branding.primary }} />
          <p className="text-sm" style={{ color: branding.text, opacity: 0.6 }}>
            Seleccioná un día para ver los turnos disponibles
          </p>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin" style={{ color: branding.primary }} />
        </div>
      ) : error ? (
        <div className="rounded-xl bg-red-50 p-4 text-center text-sm text-red-600">
          {error}
        </div>
      ) : !hasAvailableSlots ? (
        <div
          className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center"
          style={{ borderColor: 'rgba(0,0,0,0.10)' }}
        >
          <Clock className="h-7 w-7 opacity-30" style={{ color: branding.text }} />
          <p className="text-sm font-medium" style={{ color: branding.text }}>
            No hay turnos disponibles para{' '}
            <span className="capitalize">{dateFormatted}</span>
          </p>
          <p className="text-xs" style={{ color: branding.text, opacity: 0.55 }}>
            Probá con otro día o elegí &ldquo;Cualquiera disponible&rdquo; en el paso anterior
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: branding.text, opacity: 0.5 }}>
            <span className="capitalize">{dateFormatted}</span>
          </p>
          {slotGroups.map(group => {
            const available = group.slots.filter(s => s.available)
            const unavailable = group.slots.filter(s => !s.available)
            if (available.length === 0 && unavailable.length === 0) return null

            return (
              <div key={group.staff_id} className="space-y-2">
                {slotGroups.length > 1 && (
                  <p className="text-xs font-medium" style={{ color: branding.text, opacity: 0.65 }}>
                    {group.staff_name}
                  </p>
                )}
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                  {group.slots
                    .filter(s => s.available || /* mostrar ocupados como referencia */ group.slots.filter(x => x.available).length > 0)
                    .filter(s => s.available) // solo disponibles clickeables
                    .map(slot => (
                      <button
                        key={`${group.staff_id}-${slot.time}`}
                        type="button"
                        onClick={() => onSlotSelect(slot.time, group.staff_id, group.staff_name)}
                        className={cn(
                          'rounded-lg border-2 px-2 py-2.5 text-xs font-semibold transition-all active:scale-95',
                          'min-h-[44px]'
                        )}
                        style={
                          selectedTime === slot.time
                            ? {
                                backgroundColor: branding.primary,
                                borderColor: branding.primary,
                                color: '#ffffff',
                              }
                            : {
                                borderColor: `${branding.primary}50`,
                                color: branding.primary,
                                backgroundColor: 'transparent',
                              }
                        }
                      >
                        {slot.time}
                      </button>
                    ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
