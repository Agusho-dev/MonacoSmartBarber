'use client'

import { useState } from 'react'
import {
  CalendarPlus,
  Check,
  Clock,
  Copy,
  Link as LinkIcon,
  MapPin,
  Phone,
  Scissors,
  User,
} from 'lucide-react'
import { formatCurrency } from '@/lib/format'
import { getTzOffsetISO, toDateStr } from '@/lib/time-utils'
import { fechaLarga } from '../fechas'
import { Avatar } from './slot-step'
import type { PublicService } from '@/lib/actions/public-booking'

const TZ_FALLBACK = 'America/Argentina/Buenos_Aires'

interface Props {
  cancellationToken: string
  branch: {
    name: string
    address: string | null
    phone: string | null
    /** TZ de la SUCURSAL: la hora del turno es hora de pared de la barbería. */
    timezone: string
  }
  /** Servicios elegidos, en el orden en que los eligió el cliente. */
  services: PublicService[]
  totalPrice: number
  durationMinutes: number
  staffName: string
  staffAvatarUrl: string | null
  date: Date
  time: string
  clientName: string
  clientPhone: string
}

/**
 * Instante real del turno, resuelto en la timezone de la SUCURSAL.
 *
 * `date` + `time` son hora de PARED de la barbería. La versión anterior hacía
 * `start.setHours(hh, mm)`, que los interpreta en la zona del TELÉFONO: un
 * cliente que reservaba desde otra provincia o de viaje se agendaba el evento a
 * una hora que no existía. Mismo criterio que `appointmentInstant` en
 * `src/lib/actions/appointments.ts`.
 *
 * Devuelve null si la hora no es parseable, para no generar un link con
 * "Invalid Date" (y de paso no reventar el `toISOString()`).
 */
function instanteDelTurno(date: Date, time: string, timezone: string): Date | null {
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(time)) return null

  const dateStr = toDateStr(date)
  const hhmmss = time.length === 5 ? `${time}:00` : time.substring(0, 8)

  // El offset se mide EN esa fecha (no hoy): así un turno del otro lado de un
  // cambio de horario de verano no se corre una hora.
  let offset: string
  try {
    offset = getTzOffsetISO(new Date(`${dateStr}T12:00:00Z`), timezone || TZ_FALLBACK)
  } catch {
    // Intl tira RangeError con una TZ inválida cargada en la sucursal.
    offset = getTzOffsetISO(new Date(`${dateStr}T12:00:00Z`), TZ_FALLBACK)
  }

  const instante = new Date(`${dateStr}T${hhmmss}${offset}`)
  return Number.isNaN(instante.getTime()) ? null : instante
}

function buildGoogleCalendarUrl(opts: {
  title: string
  start: Date
  duration: number
  location: string
  description: string
}): string {
  const end = new Date(opts.start.getTime() + opts.duration * 60 * 1000)

  // Formato UTC básico (…Z): al ser un instante absoluto, Google lo muestra en
  // la zona de cada invitado sin necesidad de mandar `ctz`.
  function toCalDate(d: Date): string {
    return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  }

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: opts.title,
    dates: `${toCalDate(opts.start)}/${toCalDate(end)}`,
    location: opts.location,
    details: opts.description,
  })

  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

export function ConfirmationStep({
  cancellationToken,
  branch,
  services,
  totalPrice,
  durationMinutes,
  staffName,
  staffAvatarUrl,
  date,
  time,
  clientName,
  clientPhone,
}: Props) {
  const [copiado, setCopiado] = useState(false)

  const dateFormatted = fechaLarga(date)

  // /gestionar y no /cancelar: es la ruta que ya circula por WhatsApp
  // (confirmación, recordatorio, reprogramación) y permite además de cancelar
  // ver el detalle del turno. Dos UIs distintas sobre el mismo token sólo
  // confundían.
  //
  // El paso de confirmación sólo se monta en el cliente (después de reservar),
  // así que `window` existe; el inicializador perezoso evita recalcularlo.
  const [manageUrl] = useState(
    () => `${typeof window !== 'undefined' ? window.location.origin : ''}/turnos/gestionar/${cancellationToken}`
  )

  const nombresServicios = services.map(s => s.name).join(' + ')

  const inicio = instanteDelTurno(date, time, branch.timezone)
  const calendarUrl = inicio
    ? buildGoogleCalendarUrl({
        title: `${nombresServicios || 'Turno'} en ${branch.name}`,
        start: inicio,
        duration: durationMinutes,
        location: branch.address ?? branch.name,
        description: `Turno con ${staffName}. Gestionalo en ${manageUrl}`,
      })
    : null

  async function copiarLink() {
    try {
      await navigator.clipboard.writeText(manageUrl)
      setCopiado(true)
      window.setTimeout(() => setCopiado(false), 2000)
    } catch {
      // Sin permiso de portapapeles el link igual queda visible y seleccionable.
    }
  }

  return (
    <div className="space-y-6">
      {/* Encabezado de éxito */}
      <div className="flex flex-col items-center gap-3 pt-2 text-center">
        <span
          className="flex h-16 w-16 items-center justify-center rounded-full"
          style={{ backgroundColor: 'var(--t-primary)', color: 'var(--t-on-primary)' }}
        >
          <Check className="h-8 w-8" strokeWidth={3} />
        </span>
        <div>
          <h1 className="text-2xl font-bold text-[var(--t-text)]">Turno confirmado</h1>
          <p className="mt-1 text-sm text-[var(--t-text-muted)]">
            Te enviamos la confirmación por WhatsApp
          </p>
        </div>
      </div>

      {/* Quién atiende: es lo primero que quiere saber el cliente */}
      <div
        className="flex items-center gap-4 rounded-2xl border p-4"
        style={{ backgroundColor: 'var(--t-surface)', borderColor: 'var(--t-border)' }}
      >
        <Avatar url={staffAvatarUrl} name={staffName} size={52} />
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--t-text-muted)]">
            Te atiende
          </p>
          <p className="truncate text-lg font-bold text-[var(--t-text)]">{staffName}</p>
        </div>
      </div>

      {/* Fecha y hora en grande */}
      <div
        className="rounded-2xl border p-5"
        style={{ backgroundColor: 'var(--t-surface)', borderColor: 'var(--t-border)' }}
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--t-text-muted)]">
          Cuándo
        </p>
        <p className="mt-1 text-2xl font-bold leading-tight text-[var(--t-text)]">
          {time}
          <span className="ml-2 text-base font-semibold text-[var(--t-text-muted)]">
            {dateFormatted}
          </span>
        </p>

        <div className="mt-4 space-y-3 border-t pt-4" style={{ borderColor: 'var(--t-border)' }}>
          <DetailRow icon={<Scissors className="h-4 w-4" />} label="Servicio">
            <span className="font-semibold">{nombresServicios || '—'}</span>
            {totalPrice > 0 && (
              <span className="ml-1.5 text-[var(--t-text-muted)]">
                · {formatCurrency(totalPrice)}
              </span>
            )}
          </DetailRow>

          <DetailRow icon={<Clock className="h-4 w-4" />} label="Duración">
            {durationMinutes} min
          </DetailRow>

          <DetailRow icon={<MapPin className="h-4 w-4" />} label="Sucursal">
            {branch.name}
            {branch.address && (
              <span className="block text-[var(--t-text-muted)]">{branch.address}</span>
            )}
          </DetailRow>

          <DetailRow icon={<User className="h-4 w-4" />} label="A nombre de">
            {clientName}
          </DetailRow>

          <DetailRow icon={<Phone className="h-4 w-4" />} label="Teléfono">
            {clientPhone}
          </DetailRow>
        </div>
      </div>

      {/* Acciones */}
      {calendarUrl && (
        <a
          href={calendarUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-13 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold transition-opacity hover:opacity-90 active:scale-[0.99]"
          style={{ backgroundColor: 'var(--t-primary)', color: 'var(--t-on-primary)' }}
        >
          <CalendarPlus className="h-4 w-4" />
          Agregar a Google Calendar
        </a>
      )}

      {/* Link de gestión */}
      <div
        className="rounded-2xl border p-4"
        style={{ backgroundColor: 'var(--t-surface)', borderColor: 'var(--t-border)' }}
      >
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--t-text-muted)]">
          <LinkIcon className="h-3 w-3" />
          Ver o cancelar tu turno
        </p>
        <p className="mt-1.5 text-sm text-[var(--t-text-muted)]">
          Guardá este link, te sirve para gestionarlo:
        </p>
        <a
          href={manageUrl}
          className="mt-2 block break-all text-sm font-semibold underline decoration-1 underline-offset-2 text-[var(--t-accent)]"
        >
          {manageUrl}
        </a>
        <button
          type="button"
          onClick={copiarLink}
          className="mt-3 flex min-h-[44px] items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition-colors"
          style={{
            backgroundColor: 'var(--t-surface-alt)',
            borderColor: 'var(--t-border)',
            color: 'var(--t-text)',
          }}
        >
          {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copiado ? 'Link copiado' : 'Copiar link'}
        </button>
      </div>

      {branch.phone && (
        <p className="pb-4 text-center text-sm text-[var(--t-text-muted)]">
          ¿Alguna duda?{' '}
          <a href={`tel:${branch.phone}`} className="font-semibold text-[var(--t-accent)] underline underline-offset-2">
            Llamanos al {branch.phone}
          </a>
        </p>
      )}
    </div>
  )
}

function DetailRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0 text-[var(--t-text-muted)]">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--t-text-muted)]">
          {label}
        </p>
        <p className="text-sm text-[var(--t-text)]">{children}</p>
      </div>
    </div>
  )
}
