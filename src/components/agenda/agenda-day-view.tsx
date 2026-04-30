'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { AppointmentBlock } from './appointment-block'
import type { Appointment } from '@/lib/types/database'

interface Staff {
  id: string
  full_name: string
  avatar_url: string | null
}

interface Props {
  date: string
  staff: Staff[]
  appointments: Appointment[]
  /** Hora de apertura en formato HH:MM */
  hoursOpen: string
  /** Hora de cierre en formato HH:MM */
  hoursClose: string
  /** Intervalo de slots en minutos (15, 30 o 60) */
  slotInterval: number
  selectedAppointmentId: string | null
  onAppointmentClick: (appointment: Appointment) => void
  /** Se dispara al hacer click en un hueco vacío de la grilla */
  onSlotClick?: (staffId: string, date: string, time: string) => void
  className?: string
}

const PX_PER_MINUTE = 2 // 120px por hora

function timeToMinutes(t: string) {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function minutesToTime(m: number): string {
  const h = Math.floor(m / 60)
  const min = m % 60
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

export function AgendaDayView({
  date,
  staff,
  appointments,
  hoursOpen,
  hoursClose,
  slotInterval,
  selectedAppointmentId,
  onAppointmentClick,
  onSlotClick,
  className,
}: Props) {
  const openMin = timeToMinutes(hoursOpen)
  const closeMin = timeToMinutes(hoursClose)
  const totalMinutes = closeMin - openMin
  const gridHeight = totalMinutes * PX_PER_MINUTE

  // Slots del eje de tiempo
  const timeSlots = useMemo(() => {
    const slots: number[] = []
    for (let m = openMin; m <= closeMin; m += slotInterval) {
      slots.push(m)
    }
    return slots
  }, [openMin, closeMin, slotInterval])

  // Línea de hora actual
  const [nowOffset, setNowOffset] = useState<number | null>(null)
  const nowLineRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function calcNow() {
      const now = new Date()
      const todayStr = now.toISOString().split('T')[0]
      if (date !== todayStr) {
        setNowOffset(null)
        return
      }
      const nowMin = now.getHours() * 60 + now.getMinutes()
      const offset = (nowMin - openMin) * PX_PER_MINUTE
      if (offset >= 0 && offset <= gridHeight) {
        setNowOffset(offset)
      } else {
        setNowOffset(null)
      }
    }

    calcNow()
    const id = setInterval(calcNow, 60_000)
    return () => clearInterval(id)
  }, [date, openMin, gridHeight])

  // Hacer scroll a la hora actual al montar
  useEffect(() => {
    if (nowOffset !== null && nowLineRef.current) {
      nowLineRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  // Solo al montar
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Appointments por barbero
  const appointmentsByStaff = useMemo(() => {
    const map = new Map<string, Appointment[]>()
    for (const s of staff) map.set(s.id, [])
    for (const a of appointments) {
      if (a.barber_id && map.has(a.barber_id)) {
        map.get(a.barber_id)!.push(a)
      }
    }
    return map
  }, [staff, appointments])

  if (staff.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        No hay barberos habilitados para turnos en esta sucursal.
      </div>
    )
  }

  return (
    <div className={cn('flex min-h-0 overflow-auto', className)}>
      {/* Eje de tiempo */}
      <div className="relative w-14 shrink-0 select-none" style={{ height: gridHeight }}>
        {timeSlots.map((min) => (
          <div
            key={min}
            style={{ top: (min - openMin) * PX_PER_MINUTE }}
            className="absolute right-2 -translate-y-1/2 text-[10px] text-muted-foreground"
          >
            {minutesToTime(min)}
          </div>
        ))}
      </div>

      {/* Columnas por barbero */}
      <div className="flex min-w-0 flex-1 divide-x border-l">
        {staff.map((s) => {
          const barberAppts = appointmentsByStaff.get(s.id) ?? []

          return (
            <div key={s.id} className="flex flex-1 flex-col" style={{ minWidth: 120 }}>
              {/* Header barbero */}
              <div className="sticky top-0 z-20 flex items-center gap-1.5 border-b bg-background px-2 py-1.5">
                {s.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={s.avatar_url}
                    alt={s.full_name}
                    className="size-6 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold uppercase text-muted-foreground">
                    {s.full_name.charAt(0)}
                  </div>
                )}
                <span className="truncate text-[11px] font-semibold">{s.full_name}</span>
              </div>

              {/* Grid de la columna */}
              <div
                className="relative"
                style={{ height: gridHeight }}
                role="grid"
                aria-label={`Agenda de ${s.full_name}`}
              >
                {/* Líneas de slots */}
                {timeSlots.map((min) => (
                  <div
                    key={min}
                    style={{ top: (min - openMin) * PX_PER_MINUTE }}
                    className={cn(
                      'absolute inset-x-0 border-t',
                      min % 60 === 0 ? 'border-border' : 'border-border/30'
                    )}
                  />
                ))}

                {/* Huecos clickeables */}
                {timeSlots.slice(0, -1).map((min, idx) => {
                  const nextMin = timeSlots[idx + 1] ?? min + slotInterval
                  const top = (min - openMin) * PX_PER_MINUTE
                  const height = (nextMin - min) * PX_PER_MINUTE
                  const timeStr = minutesToTime(min)

                  return (
                    <button
                      key={min}
                      type="button"
                      style={{ top, height }}
                      onClick={() => onSlotClick?.(s.id, date, timeStr)}
                      className="absolute inset-x-0 z-0 hover:bg-primary/5"
                      aria-label={`Hueco libre a las ${timeStr}`}
                    />
                  )
                })}

                {/* Bloques de turno */}
                {barberAppts.map((appt) => {
                  const startMin = timeToMinutes(appt.start_time.slice(0, 5))
                  const endMin = timeToMinutes(appt.end_time.slice(0, 5))
                  const top = (startMin - openMin) * PX_PER_MINUTE
                  const height = (endMin - startMin) * PX_PER_MINUTE

                  return (
                    <AppointmentBlock
                      key={appt.id}
                      appointment={appt}
                      topPx={top}
                      heightPx={height}
                      pxPerMinute={PX_PER_MINUTE}
                      isSelected={appt.id === selectedAppointmentId}
                      onClick={() => onAppointmentClick(appt)}
                    />
                  )
                })}

                {/* Línea de hora actual */}
                {nowOffset !== null && (
                  <div
                    ref={nowLineRef}
                    style={{ top: nowOffset }}
                    className="pointer-events-none absolute inset-x-0 z-40 flex items-center"
                    aria-hidden
                  >
                    <div className="h-px flex-1 bg-red-500/80" />
                    <div className="size-2 rounded-full bg-red-500 shadow-md" />
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
