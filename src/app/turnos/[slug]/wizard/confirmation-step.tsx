'use client'

import { Check, Calendar, Clock, Scissors, User, MapPin, Phone, Link, CalendarPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/format'
import type { PublicService, PublicStaff } from '@/lib/actions/public-booking'

interface Props {
  appointmentId: string
  cancellationToken: string
  branch: { name: string; address: string | null; phone: string | null }
  service: PublicService | undefined
  staff: PublicStaff | null  // null = cualquiera asignado
  staffName: string
  date: Date
  time: string
  clientName: string
  clientPhone: string
  branding: { primary: string; bg: string; text: string }
}

function buildGoogleCalendarUrl(opts: {
  title: string
  date: Date
  time: string
  duration: number
  location: string
  description: string
}): string {
  const [hh, mm] = opts.time.split(':').map(Number)
  const start = new Date(opts.date)
  start.setHours(hh, mm, 0, 0)

  const end = new Date(start.getTime() + opts.duration * 60 * 1000)

  function toCalDate(d: Date): string {
    return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  }

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: opts.title,
    dates: `${toCalDate(start)}/${toCalDate(end)}`,
    location: opts.location,
    details: opts.description,
  })

  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

export function ConfirmationStep({
  cancellationToken,
  branch,
  service,
  staffName,
  date,
  time,
  clientName,
  clientPhone,
  branding,
}: Props) {
  const dateFormatted = date.toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  const cancelUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/turnos/cancelar/${cancellationToken}`

  const calendarUrl = service
    ? buildGoogleCalendarUrl({
        title: `${service.name} en ${branch.name}`,
        date,
        time,
        duration: service.duration_minutes ?? 30,
        location: branch.address ?? branch.name,
        description: `Turno con ${staffName}. Tel: ${clientPhone}`,
      })
    : null

  return (
    <div className="space-y-6 text-center">
      {/* Icono de éxito */}
      <div className="flex flex-col items-center gap-3">
        <div
          className="flex h-20 w-20 items-center justify-center rounded-full"
          style={{ backgroundColor: `${branding.primary}18` }}
        >
          <div
            className="flex h-14 w-14 items-center justify-center rounded-full"
            style={{ backgroundColor: branding.primary }}
          >
            <Check className="h-7 w-7 text-white" strokeWidth={3} />
          </div>
        </div>
        <div>
          <h2 className="text-xl font-bold" style={{ color: branding.text }}>
            ¡Turno confirmado!
          </h2>
          <p className="mt-1 text-sm" style={{ color: branding.text, opacity: 0.6 }}>
            Te enviamos la confirmación por WhatsApp
          </p>
        </div>
      </div>

      {/* Detalle del turno */}
      <div
        className="rounded-xl border p-5 text-left space-y-3"
        style={{ borderColor: 'rgba(0,0,0,0.10)', backgroundColor: `${branding.primary}06` }}
      >
        <DetailRow icon={<Scissors className="h-4 w-4" />} label="Servicio" branding={branding}>
          <span className="font-semibold">{service?.name ?? '—'}</span>
          {service && (
            <span className="ml-1.5 opacity-60">· {formatCurrency(service.price)}</span>
          )}
        </DetailRow>

        <DetailRow icon={<User className="h-4 w-4" />} label="Profesional" branding={branding}>
          {staffName}
        </DetailRow>

        <DetailRow icon={<Calendar className="h-4 w-4" />} label="Fecha" branding={branding}>
          <span className="capitalize">{dateFormatted}</span>
        </DetailRow>

        <DetailRow icon={<Clock className="h-4 w-4" />} label="Hora" branding={branding}>
          {time}
          {service?.duration_minutes && (
            <span className="ml-1.5 opacity-60">· {service.duration_minutes} min</span>
          )}
        </DetailRow>

        <DetailRow icon={<MapPin className="h-4 w-4" />} label="Sucursal" branding={branding}>
          {branch.name}
          {branch.address && (
            <span className="ml-1.5 block opacity-60">{branch.address}</span>
          )}
        </DetailRow>

        <DetailRow icon={<User className="h-4 w-4" />} label="Nombre" branding={branding}>
          {clientName}
        </DetailRow>

        <DetailRow icon={<Phone className="h-4 w-4" />} label="Teléfono" branding={branding}>
          {clientPhone}
        </DetailRow>
      </div>

      {/* Acciones */}
      <div className="space-y-3">
        {calendarUrl && (
          <Button
            asChild
            className="w-full h-12 text-sm font-semibold"
            style={{ backgroundColor: branding.primary, color: '#ffffff' }}
          >
            <a href={calendarUrl} target="_blank" rel="noopener noreferrer">
              <CalendarPlus className="mr-2 h-4 w-4" />
              Agregar a Google Calendar
            </a>
          </Button>
        )}

        {/* Link de cancelación */}
        <div
          className="rounded-xl border p-4 text-left"
          style={{ borderColor: 'rgba(0,0,0,0.08)' }}
        >
          <p
            className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide"
            style={{ color: branding.text, opacity: 0.5 }}
          >
            <Link className="h-3 w-3" />
            Para cancelar tu turno
          </p>
          <p className="text-xs" style={{ color: branding.text, opacity: 0.6 }}>
            Usá este link (válido hasta 2h antes):
          </p>
          <a
            href={cancelUrl}
            className="mt-1.5 block break-all text-xs font-medium hover:underline"
            style={{ color: branding.primary }}
          >
            {cancelUrl}
          </a>
        </div>
      </div>
    </div>
  )
}

function DetailRow({
  icon,
  label,
  children,
  branding,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
  branding: { primary: string; bg: string; text: string }
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0" style={{ color: branding.primary, opacity: 0.75 }}>
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: branding.text, opacity: 0.45 }}>
          {label}
        </p>
        <p className="text-sm" style={{ color: branding.text }}>
          {children}
        </p>
      </div>
    </div>
  )
}
