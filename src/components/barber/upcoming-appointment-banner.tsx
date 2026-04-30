'use client'

import { useState, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Bell, Clock, ChevronDown, ChevronUp } from 'lucide-react'
import type { Appointment } from '@/lib/types/database'
import { notifyClientArrival } from '@/lib/actions/barber-turnos'
import { toast } from 'sonner'

interface UpcomingAppointmentBannerProps {
  appointment: Appointment
  staffId: string
  branchId: string
  className?: string
}

function formatCountdown(totalSeconds: number): string {
  if (totalSeconds <= 0) return '0:00'
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/**
 * Banner que aparece cuando hay un turno en los próximos 15 minutos.
 * Modo "ignorado": colapsa a barra delgada pero reabre automáticamente si quedan < 2 min.
 */
export function UpcomingAppointmentBanner({
  appointment,
  staffId,
  branchId,
  className,
}: UpcomingAppointmentBannerProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [collapseUntil, setCollapseUntil] = useState<number | null>(null)
  const [secondsLeft, setSecondsLeft] = useState<number>(0)
  const [notifying, setNotifying] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Calcular segundos restantes hasta el turno
  useEffect(() => {
    function calcSeconds() {
      const [h, m] = appointment.start_time.split(':').map(Number)
      const now = new Date()
      const apptToday = new Date()
      apptToday.setHours(h, m, 0, 0)
      return Math.floor((apptToday.getTime() - now.getTime()) / 1000)
    }

    // Forzar primer cálculo a través del interval con delay=0
    const initial = setTimeout(() => {
      setSecondsLeft(calcSeconds())
    }, 0)

    intervalRef.current = setInterval(() => {
      const s = calcSeconds()
      setSecondsLeft(s)

      // Si quedan menos de 2 min (120s) y estaba colapsado, reabrir automáticamente
      if (s <= 120 && s >= 0) {
        setCollapsed(false)
        setCollapseUntil(null)
      }
    }, 1000)

    return () => {
      clearTimeout(initial)
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [appointment.start_time])

  // Respeto a "ignorar 5 min": colapsar hasta que pasen 5 min
  useEffect(() => {
    if (collapseUntil !== null) {
      const check = setInterval(() => {
        if (Date.now() >= collapseUntil!) {
          setCollapsed(false)
          setCollapseUntil(null)
          clearInterval(check)
        }
      }, 5000)
      return () => clearInterval(check)
    }
  }, [collapseUntil])

  function handleIgnore5Min() {
    setCollapsed(true)
    setCollapseUntil(Date.now() + 5 * 60 * 1000)
  }

  async function handleNotify() {
    setNotifying(true)
    const result = await notifyClientArrival(appointment.id, staffId, branchId)
    setNotifying(false)
    if ('error' in result) {
      toast.error(result.error)
    } else {
      toast.success('Notificación enviada al cliente')
    }
  }

  const clientName = appointment.client?.name ?? 'Cliente'
  const startLabel = appointment.start_time.substring(0, 5)
  const isUrgent = secondsLeft >= 0 && secondsLeft <= 120 // menos de 2 min
  const isPast = secondsLeft < 0

  if (isPast) return null

  // Vista colapsada: barra delgada con contador
  if (collapsed) {
    return (
      <div
        className={cn(
          'flex items-center justify-between gap-3 border-b px-4 py-1.5',
          isUrgent
            ? 'bg-destructive/10 border-destructive/30 text-destructive'
            : 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400',
          className
        )}
      >
        <div className="flex items-center gap-2 text-xs font-medium">
          <Clock className="size-3 shrink-0" />
          <span>
            Próximo turno: {clientName} a las {startLabel} —{' '}
            <span className="font-mono font-bold">{formatCountdown(secondsLeft)}</span>
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-xs"
          onClick={() => { setCollapsed(false); setCollapseUntil(null) }}
        >
          <ChevronDown className="size-3 mr-0.5" />
          Ver
        </Button>
      </div>
    )
  }

  // Vista expandida
  return (
    <div
      className={cn(
        'border-b px-4 py-3',
        isUrgent
          ? 'bg-destructive/10 border-destructive/30'
          : 'bg-amber-500/10 border-amber-500/30',
        className
      )}
      role="alert"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-xl',
            isUrgent ? 'bg-destructive/20 text-destructive' : 'bg-amber-500/20 text-amber-600'
          )}>
            <Bell className={cn('size-4', isUrgent && 'animate-bounce')} />
          </div>
          <div className="min-w-0">
            <p className={cn(
              'text-sm font-semibold leading-tight',
              isUrgent ? 'text-destructive' : 'text-amber-700 dark:text-amber-400'
            )}>
              {isUrgent ? 'Turno inminente' : 'Próximo turno'} —{' '}
              <span className="font-mono">{formatCountdown(secondsLeft)}</span>
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {clientName}
              {appointment.service?.name && ` · ${appointment.service.name}`}
              {' · '}{startLabel}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className={cn(
              'h-8 text-xs gap-1',
              isUrgent
                ? 'border-destructive/30 text-destructive hover:bg-destructive/10'
                : 'border-amber-500/30 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10'
            )}
            onClick={handleNotify}
            disabled={notifying}
          >
            <Bell className="size-3" />
            Avisar
          </Button>

          {!isUrgent && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs text-muted-foreground"
              onClick={handleIgnore5Min}
            >
              <ChevronUp className="size-3 mr-0.5" />
              5min
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
