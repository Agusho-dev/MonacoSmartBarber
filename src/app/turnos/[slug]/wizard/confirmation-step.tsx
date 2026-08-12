'use client'

import { useState } from 'react'
import {
  CalendarPlus,
  CalendarX2,
  Check,
  Clock,
  Copy,
  Link as LinkIcon,
  MapPin,
  ScanFace,
  Scissors,
  Sparkles,
  User,
} from 'lucide-react'
import { formatCurrency } from '@/lib/format'
import { getTzOffsetISO, toDateStr } from '@/lib/time-utils'
import { cn } from '@/lib/utils'
import { glassPanel, glassInteractive } from '../glass'
import { fechaLarga } from '../fechas'
import { Avatar } from './avatar'
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
  /**
   * El cliente ya tiene la cara enrolada: la cámara de la tablet lo reconoce.
   * Define cuál de las dos instrucciones de llegada se muestra.
   */
  clienteTieneCara: boolean
  /** Primera reserva con este teléfono en la organización. */
  clienteEsNuevo: boolean
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

/** Retraso de entrada de cada bloque, en unidades de 30ms (ver `.t-rise`). */
const ORDEN = {
  cuando: 16,
  llegada: 19,
  detalle: 22,
  calendario: 25,
  gestion: 28,
  ayuda: 31,
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
  clienteTieneCara,
  clienteEsNuevo,
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

  const mapsUrl = branch.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(branch.address)}`
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
    <div className="space-y-4 pt-2">
      <TildeConfirmado />

      {/* CUÁNDO Y DÓNDE: es lo primero que el cliente necesita leer, así que se
          lleva la tarjeta más grande y la tipografía más grande de la pantalla.
          Todo lo demás (quién atiende, precio, links) es secundario. */}
      <section
        className={cn(glassPanel, 't-rise overflow-hidden p-5')}
        style={{ '--t-i': ORDEN.cuando } as React.CSSProperties}
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--t-text-muted)]">
          Tu turno
        </p>
        <p className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-4xl font-bold leading-none tabular-nums tracking-tight text-[var(--t-text)]">
            {time}
          </span>
          <span className="text-lg font-semibold leading-tight text-[var(--t-text)]">
            {dateFormatted}
          </span>
        </p>

        <div
          className="mt-4 flex items-start gap-2.5 border-t pt-4"
          style={{ borderColor: 'var(--t-glass-border)' }}
        >
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[var(--t-text-muted)]" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-[var(--t-text)]">{branch.name}</p>
            {branch.address && (
              <p className="text-sm text-[var(--t-text-muted)]">{branch.address}</p>
            )}
          </div>
          {mapsUrl && (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                glassInteractive,
                'flex h-9 shrink-0 items-center rounded-lg px-3 text-xs font-bold text-[var(--t-text)]'
              )}
            >
              Cómo llegar
            </a>
          )}
        </div>
      </section>

      <ComoRegistrarLlegada
        tieneCara={clienteTieneCara}
        esNuevo={clienteEsNuevo}
        orden={ORDEN.llegada}
      />

      {/* Detalle: quién atiende, qué se hace y cuánto sale */}
      <section
        className={cn(glassPanel, 't-rise p-4')}
        style={{ '--t-i': ORDEN.detalle } as React.CSSProperties}
      >
        <div className="flex items-center gap-3">
          <Avatar url={staffAvatarUrl} name={staffName} size={46} />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--t-text-muted)]">
              Te atiende
            </p>
            <p className="truncate text-base font-bold text-[var(--t-text)]">{staffName}</p>
          </div>
        </div>

        <div
          className="mt-4 space-y-3 border-t pt-4"
          style={{ borderColor: 'var(--t-glass-border)' }}
        >
          <DetailRow icon={<Scissors className="h-4 w-4" />} label="Servicio">
            <span className="font-semibold">{nombresServicios || '—'}</span>
            {totalPrice > 0 && (
              <span className="ml-1.5 font-bold text-[var(--t-accent)]">
                {formatCurrency(totalPrice)}
              </span>
            )}
          </DetailRow>

          <DetailRow icon={<Clock className="h-4 w-4" />} label="Duración">
            {durationMinutes} min
          </DetailRow>

          <DetailRow icon={<User className="h-4 w-4" />} label="A nombre de">
            {clientName}
            <span className="block text-[var(--t-text-muted)]">{clientPhone}</span>
          </DetailRow>
        </div>
      </section>

      {calendarUrl && (
        <a
          href={calendarUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="t-rise flex h-13 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold transition-[transform,box-shadow] duration-200 active:scale-[0.99]"
          style={{
            '--t-i': ORDEN.calendario,
            backgroundColor: 'var(--t-primary)',
            color: 'var(--t-on-primary)',
            boxShadow: '0 10px 30px -12px var(--t-ring), var(--t-glass-shadow)',
          } as React.CSSProperties}
        >
          <CalendarPlus className="h-4 w-4" />
          Agregar a Google Calendar
        </a>
      )}

      {/* Link de gestión */}
      <section
        className={cn(glassPanel, 't-rise p-4')}
        style={{ '--t-i': ORDEN.gestion } as React.CSSProperties}
      >
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--t-text-muted)]">
          <LinkIcon className="h-3 w-3" />
          Si no podés venir
        </p>
        <p className="mt-1.5 text-sm text-[var(--t-text-muted)]">
          Cancelá desde acá y le liberás el lugar a otra persona. El mismo link te llega por
          WhatsApp, así que no hace falta que lo guardes.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={manageUrl}
            className={cn(
              glassInteractive,
              'flex min-h-[46px] flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold'
            )}
            style={{ color: 'var(--t-text)' }}
          >
            <CalendarX2 className="h-4 w-4" />
            Ver o cancelar mi turno
          </a>
          <button
            type="button"
            onClick={copiarLink}
            aria-label="Copiar el link para gestionar el turno"
            className={cn(
              glassInteractive,
              'flex min-h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl text-[var(--t-text)]'
            )}
          >
            {copiado ? (
              <Check className="h-4 w-4 text-[var(--t-success-text)]" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </button>
        </div>
        {copiado && (
          <p className="mt-2 text-xs font-semibold text-[var(--t-success-text)]">Link copiado</p>
        )}
      </section>

      {branch.phone && (
        <p
          className="t-rise pb-4 text-center text-sm text-[var(--t-text-muted)]"
          style={{ '--t-i': ORDEN.ayuda } as React.CSSProperties}
        >
          ¿Alguna duda?{' '}
          <a href={`tel:${branch.phone}`} className="font-semibold text-[var(--t-accent)] underline underline-offset-2">
            Llamanos al {branch.phone}
          </a>
        </p>
      )}
    </div>
  )
}

// ─── Tilde animado ───────────────────────────────────────────────────

/**
 * El círculo se dibuja y después el tilde, con `stroke-dasharray` +
 * `stroke-dashoffset`, y cierra con un halo que se expande y se apaga.
 *
 * Es un SVG y no un GIF ni una librería (no hay ninguna instalada): pesa nada,
 * hereda el color del tema y se apaga solo con `prefers-reduced-motion`, donde
 * el trazo aparece completo en vez de a medio dibujar.
 *
 * Todo el movimiento son animaciones CSS de montaje, así que un re-render del
 * componente —el botón de copiar el link cambia de estado— no las re-dispara:
 * las clases de los elementos animados nunca cambian.
 */
function TildeConfirmado() {
  return (
    <div className="flex flex-col items-center gap-3 pb-1 text-center">
      <div className="t-check-shell relative flex h-24 w-24 items-center justify-center">
        <span
          className="t-check-halo pointer-events-none absolute inset-0 rounded-full"
          style={{
            background: 'radial-gradient(circle, var(--t-success), transparent 68%)',
          }}
          aria-hidden
        />
        <span
          className={cn(glassPanel, 'absolute inset-0 rounded-full')}
          aria-hidden
        />
        {/* Verde y no el color de marca: es la continuación del velo que acaba
            de pasar (`ConfirmacionVerde`), y sostener el mismo color hace que
            las dos pantallas se lean como un solo momento. */}
        <svg
          viewBox="0 0 64 64"
          className="relative h-14 w-14 text-[var(--t-success-text)]"
          fill="none"
          role="img"
          aria-label="Turno confirmado"
        >
          <circle
            cx="32"
            cy="32"
            r="26.5"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            className="t-check-ring"
            transform="rotate(-90 32 32)"
          />
          <path
            d="M19.5 33 L28 41.5 L44.5 24"
            stroke="currentColor"
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="t-check-tick"
          />
        </svg>
      </div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--t-text)]">
          Turno confirmado
        </h1>
        <p className="mt-1 text-sm text-[var(--t-text-muted)]">
          Te enviamos la confirmación por WhatsApp
        </p>
      </div>
    </div>
  )
}

// ─── Cómo registrar la llegada ───────────────────────────────────────

/**
 * Qué hacer al llegar a la barbería, escrito para alguien que nunca vio la
 * tablet de recepción.
 *
 * Los textos nombran EXACTAMENTE lo que el cliente va a leer en la pantalla
 * (la pregunta "¿Estás registrado?" y los botones "Sí" / "No", ver
 * `src/components/checkin/turnos-flow.tsx`). Una paráfrasis del tipo
 * "confirmá tu identidad" obliga a traducir, que es justo lo que hay que
 * evitar cuando alguien está parado en la puerta con el celular en la mano.
 *
 * La variante NO se adivina en el cliente: `client_has_face` viene del
 * servidor, que es el único que sabe si ese teléfono ya tiene una cara
 * enrolada.
 */
function ComoRegistrarLlegada({
  tieneCara,
  esNuevo,
  orden,
}: {
  tieneCara: boolean
  esNuevo: boolean
  orden: number
}) {
  if (tieneCara) {
    return (
      <section
        className={cn(glassPanel, 't-rise p-4')}
        style={{ '--t-i': orden } as React.CSSProperties}
      >
        <Encabezado icon={<ScanFace className="h-4 w-4" />}>
          Cuando llegues a la barbería
        </Encabezado>

        <ol className="mt-3.5 space-y-3">
          <PasoLlegada n={1}>
            En la tablet de recepción vas a ver{' '}
            <Resalte>¿Estás registrado?</Resalte>. Tocá <Resalte>Sí</Resalte>.
          </PasoLlegada>
          <PasoLlegada n={2}>
            Mirá la cámara un segundo. Te reconoce sola y quedás anotado.
          </PasoLlegada>
        </ol>

        <p
          className="mt-3.5 flex items-start gap-2 rounded-xl p-3 text-sm text-[var(--t-text-muted)]"
          style={{
            backgroundColor: 'var(--t-glass-inner)',
            boxShadow: 'inset 0 0 0 1px var(--t-glass-border)',
          }}
        >
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[var(--t-accent)]" />
          <span>
            Listo, no tenés que hacer nada más ni hablar con nadie. El barbero te
            llama cuando sea tu turno.
          </span>
        </p>
      </section>
    )
  }

  return (
    <section
      className={cn(glassPanel, 't-rise p-4')}
      style={{ '--t-i': orden } as React.CSSProperties}
    >
      <Encabezado icon={<ScanFace className="h-4 w-4" />}>
        Cuando llegues a la barbería
      </Encabezado>

      <ol className="mt-3.5 space-y-3">
        <PasoLlegada n={1}>
          En la tablet de recepción vas a ver{' '}
          <Resalte>¿Estás registrado?</Resalte>. Tocá <Resalte>No</Resalte>.
          {esNuevo ? ' Es tu primera vez, así que va por acá.' : ''}
        </PasoLlegada>
        <PasoLlegada n={2}>
          Poné tu teléfono y listo: quedás anotado y el barbero te llama cuando
          sea tu turno.
        </PasoLlegada>
      </ol>

      <p
        className="mt-3.5 flex items-start gap-2 rounded-xl p-3 text-sm text-[var(--t-text-muted)]"
        style={{
          backgroundColor: 'var(--t-glass-inner)',
          boxShadow: 'inset 0 0 0 1px var(--t-glass-border)',
        }}
      >
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[var(--t-accent)]" />
        <span>
          Aprovechá: después de poner el teléfono la tablet te ofrece{' '}
          <Resalte>Registrar mi cara</Resalte>. Si aceptás, la próxima entrás sin
          tocar nada.
        </span>
      </p>
    </section>
  )
}

function Encabezado({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-base font-bold text-[var(--t-text)]">
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: 'var(--t-primary)', color: 'var(--t-on-primary)' }}
      >
        {icon}
      </span>
      {children}
    </p>
  )
}

function PasoLlegada({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums"
        style={{ backgroundColor: 'var(--t-primary)', color: 'var(--t-on-primary)' }}
        aria-hidden
      >
        {n}
      </span>
      <p className="min-w-0 flex-1 text-sm leading-relaxed text-[var(--t-text-muted)]">
        {children}
      </p>
    </li>
  )
}

/** Lo que el cliente va a leer LITERAL en la pantalla de la tablet. */
function Resalte({ children }: { children: React.ReactNode }) {
  return <strong className="font-bold text-[var(--t-text)]">{children}</strong>
}

// ─── Piezas ──────────────────────────────────────────────────────────

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
