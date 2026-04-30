'use client'

import { memo } from 'react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Clock, CheckCircle2, XCircle, Loader2, Play, Circle } from 'lucide-react'
import type { Appointment } from '@/lib/types/database'
import { PX_PER_MINUTE } from './timeline-time-axis'

interface TimelineBlockProps {
  appointment: Appointment
  startHour: number
  onClick: (appointment: Appointment) => void
}

function timeStringToMinutes(time: string): number {
  // time puede venir como "HH:MM:SS" o "HH:MM"
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

const STATUS_STYLES: Record<string, string> = {
  completed: 'opacity-50 bg-muted border-muted-foreground/20 border-dashed',
  in_progress: 'bg-emerald-500/10 border-emerald-500 border-l-4 animate-pulse-border',
  checked_in: 'bg-emerald-500/15 border-emerald-600 border-l-4',
  confirmed: 'bg-primary/10 border-primary',
  scheduled: 'bg-background border-muted-foreground/40 border-dashed',
  no_show: 'bg-destructive/10 border-destructive/50 border-dashed opacity-60',
  pending_payment: 'bg-amber-500/10 border-amber-500/50 border-dashed',
  cancelled: 'opacity-30 bg-muted border-dashed',
}

const STATUS_LABELS: Record<string, { label: string; Icon: typeof CheckCircle2 }> = {
  completed: { label: 'Completado', Icon: CheckCircle2 },
  in_progress: { label: 'En curso', Icon: Play },
  checked_in: { label: 'En espera', Icon: Loader2 },
  confirmed: { label: 'Confirmado', Icon: Circle },
  scheduled: { label: 'Sin confirmar', Icon: Circle },
  no_show: { label: 'No se presentó', Icon: XCircle },
  pending_payment: { label: 'Esperando pago', Icon: Clock },
  cancelled: { label: 'Cancelado', Icon: XCircle },
}

function TimelineBlockComponent({ appointment, startHour, onClick }: TimelineBlockProps) {
  const startMinutes = timeStringToMinutes(appointment.start_time) - startHour * 60
  const duration = appointment.duration_minutes
  const blockHeight = Math.max(duration * PX_PER_MINUTE, 40) // mínimo 40px para legibilidad
  const topPx = startMinutes * PX_PER_MINUTE

  const statusStyle = STATUS_STYLES[appointment.status] ?? STATUS_STYLES.confirmed
  const statusMeta = STATUS_LABELS[appointment.status] ?? STATUS_LABELS.confirmed
  const { Icon } = statusMeta

  const clientName = appointment.client?.name ?? 'Cliente'
  const serviceName = appointment.service?.name ?? ''
  const startLabel = appointment.start_time.substring(0, 5)
  const endLabel = appointment.end_time.substring(0, 5)

  const isVeryShort = blockHeight < 60

  return (
    <button
      onClick={() => onClick(appointment)}
      className={cn(
        'absolute left-12 right-1 rounded-lg border p-2 text-left transition-all hover:brightness-110 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        statusStyle
      )}
      style={{ top: topPx, height: blockHeight, zIndex: 10 }}
      aria-label={`Turno: ${clientName} — ${startLabel} a ${endLabel}. Estado: ${statusMeta.label}`}
    >
      <div className="flex h-full flex-col overflow-hidden">
        {/* Fila superior: ícono + nombre */}
        <div className="flex items-center gap-1 min-w-0">
          <Icon className="size-3 shrink-0 text-current opacity-70" />
          <span className="truncate text-xs font-semibold leading-tight">
            {clientName}
          </span>
        </div>

        {/* Datos adicionales si hay espacio */}
        {!isVeryShort && (
          <>
            {serviceName && (
              <span className="mt-0.5 truncate text-[10px] text-muted-foreground leading-tight">
                {serviceName}
              </span>
            )}
            <span className="mt-auto flex items-center gap-1 text-[10px] text-muted-foreground">
              <Clock className="size-2.5" />
              {startLabel} – {endLabel}
            </span>
          </>
        )}
      </div>

      {/* Badge de estado visible en bloques más altos */}
      {blockHeight >= 80 && (
        <div className="absolute bottom-1.5 right-1.5">
          <Badge
            variant="outline"
            className={cn(
              'h-4 px-1 text-[9px] uppercase tracking-wide border-current/30',
              appointment.status === 'in_progress' && 'bg-emerald-500/20 text-emerald-700 border-emerald-500/40',
              appointment.status === 'completed' && 'bg-muted text-muted-foreground',
              appointment.status === 'no_show' && 'bg-destructive/20 text-destructive border-destructive/40',
            )}
          >
            {statusMeta.label}
          </Badge>
        </div>
      )}
    </button>
  )
}

// memo: el bloque solo re-renderiza si el appointment cambia
export const TimelineBlock = memo(TimelineBlockComponent)
