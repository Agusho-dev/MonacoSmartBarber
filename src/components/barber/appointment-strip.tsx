'use client'

import { useEffect, useMemo, useRef } from 'react'
import { CalendarDays } from 'lucide-react'
import { cn } from '@/lib/utils'
import { appointmentInstantMs, formatHourMinute } from '@/lib/queue-appointments'
import type { Appointment } from '@/lib/types/database'

interface AppointmentStripProps {
  /** Turnos del día de ESTE barbero (ya vienen ordenados por hora del server). */
  appointments: Appointment[]
  /** Reloj del panel (late cada 5s allá; no abrimos otro timer). */
  nowMs: number
  /** TZ de la sucursal: las horas del turno son hora de pared, no del dispositivo. */
  timeZone?: string | null
  onSelectAppointment: (appointment: Appointment) => void
  onOpenAgenda: () => void
  className?: string
}

/** Estados que todavía esperan algo del barbero. */
const ESTADOS_PENDIENTES = new Set(['confirmed', 'checked_in', 'pending_payment'])

interface TonoEstado {
  /** Barra de color a la izquierda del chip: el dato que se lee de reojo. */
  barra: string
  /** Etiqueta corta. `null` = no aporta nada (un turno "confirmado" es lo normal). */
  etiqueta: string | null
  etiquetaClass: string
  /** Turnos ya cerrados: quedan visibles pero no compiten por la atención. */
  apagado?: boolean
}

const TONO_POR_ESTADO: Record<string, TonoEstado> = {
  confirmed: { barra: 'bg-violet-500', etiqueta: null, etiquetaClass: '' },
  checked_in: {
    barra: 'bg-emerald-500',
    etiqueta: 'Llegó',
    etiquetaClass: 'text-emerald-600 dark:text-emerald-400',
  },
  in_progress: {
    barra: 'bg-emerald-600',
    etiqueta: 'En curso',
    etiquetaClass: 'text-emerald-700 dark:text-emerald-300',
  },
  pending_payment: {
    barra: 'bg-amber-500',
    etiqueta: 'Falta pago',
    etiquetaClass: 'text-amber-600 dark:text-amber-400',
  },
  completed: {
    barra: 'bg-muted-foreground/30',
    etiqueta: 'Listo',
    etiquetaClass: 'text-muted-foreground',
    apagado: true,
  },
  no_show: {
    barra: 'bg-destructive/60',
    etiqueta: 'Ausente',
    etiquetaClass: 'text-destructive',
    apagado: true,
  },
}

const TONO_DEFAULT: TonoEstado = TONO_POR_ESTADO.confirmed

type UrgenciaCuenta = 'curso' | 'urgente' | 'pronto' | 'neutro'

interface CuentaRegresiva {
  texto: string
  urgencia: UrgenciaCuenta
}

/**
 * Texto del chip destacado. Devuelve `null` cuando falta tanto que un contador
 * sólo sería ruido (más de una hora).
 */
function cuentaRegresiva(startMs: number, nowMs: number, status: string): CuentaRegresiva | null {
  if (status === 'in_progress') return { texto: 'En curso', urgencia: 'curso' }

  const minutos = Math.round((startMs - nowMs) / 60_000)
  if (minutos > 60) return null
  if (minutos >= 2) {
    return { texto: `en ${minutos} min`, urgencia: minutos <= 15 ? 'pronto' : 'neutro' }
  }
  if (minutos >= -1) return { texto: 'ahora', urgencia: 'urgente' }
  // Pasada la hora: si el cliente ya está en la fila no hay nada que apurar;
  // si sigue en "confirmado" es una tardanza y el barbero tiene que verla.
  if (status === 'checked_in') return { texto: 'esperando', urgencia: 'curso' }
  return { texto: `${Math.abs(minutos)} min tarde`, urgencia: 'urgente' }
}

const CLASE_CUENTA: Record<UrgenciaCuenta, string> = {
  curso: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  urgente: 'bg-destructive/15 text-destructive',
  pronto: 'bg-amber-500/20 text-amber-700 dark:text-amber-300',
  neutro: 'bg-secondary text-foreground',
}

/**
 * Tira compacta de turnos que vive ARRIBA de la cola walk-in.
 *
 * El 95% del volumen de la barbería entra sin turno: la pantalla es la cola.
 * Antes el panel en modo `hybrid` partía el alto 60/40 entre el timeline y la
 * cola, así que un día sin turnos dedicaba dos tercios de una tablet vertical a
 * decir "Sin turnos hoy" y aplastaba lo único que se usa. Acá los turnos ocupan
 * una franja fija de 72px y, **si no hay turnos, cero píxeles**: el componente
 * no renderiza nada.
 *
 * El timeline completo no desaparece — se abre a pantalla completa desde el
 * botón de la derecha.
 */
export function AppointmentStrip({
  appointments,
  nowMs,
  timeZone,
  onSelectAppointment,
  onOpenAgenda,
  className,
}: AppointmentStripProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const chipsRef = useRef<Record<string, HTMLButtonElement | null>>({})

  const items = useMemo(() => {
    return appointments
      .map((appointment) => ({
        appointment,
        startMs: appointmentInstantMs(
          appointment.appointment_date,
          appointment.start_time,
          timeZone
        ),
      }))
      .sort((a, b) => a.startMs - b.startMs)
  }, [appointments, timeZone])

  /**
   * Turno destacado: el que el barbero tiene que tener en la cabeza ahora.
   * Prioridad: el que está en curso → el primero que todavía no empezó → el
   * pendiente más viejo (un turno cuya hora ya pasó y nadie cerró).
   */
  const destacadoId = useMemo(() => {
    const enCurso = items.find((i) => i.appointment.status === 'in_progress')
    if (enCurso) return enCurso.appointment.id

    const pendientes = items.filter((i) => ESTADOS_PENDIENTES.has(i.appointment.status))
    if (pendientes.length === 0) return null
    return (pendientes.find((i) => i.startMs >= nowMs) ?? pendientes[0]).appointment.id
  }, [items, nowMs])

  // Centrar el destacado. Se hace a mano en vez de con `scrollIntoView` porque
  // ése también scrollea a los ancestros y en una tablet eso mueve la cola.
  useEffect(() => {
    if (!destacadoId) return
    const scroller = scrollerRef.current
    const chip = chipsRef.current[destacadoId]
    if (!scroller || !chip) return
    const objetivo = chip.offsetLeft - (scroller.clientWidth - chip.offsetWidth) / 2
    scroller.scrollTo({ left: Math.max(0, objetivo), behavior: 'smooth' })
  }, [destacadoId])

  if (items.length === 0) return null

  return (
    <div
      className={cn('flex shrink-0 items-stretch border-b bg-muted/30', className)}
      role="region"
      aria-label={`Turnos de hoy: ${items.length}`}
    >
      <div
        ref={scrollerRef}
        className="flex flex-1 gap-2 overflow-x-auto px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map(({ appointment, startMs }) => {
          const tono = TONO_POR_ESTADO[appointment.status] ?? TONO_DEFAULT
          const esDestacado = appointment.id === destacadoId
          const cuenta = esDestacado
            ? cuentaRegresiva(startMs, nowMs, appointment.status)
            : null
          const nombre = appointment.client?.name ?? 'Cliente'
          const hora = formatHourMinute(startMs, timeZone)

          return (
            <button
              key={appointment.id}
              ref={(el) => {
                chipsRef.current[appointment.id] = el
              }}
              onClick={() => onSelectAppointment(appointment)}
              aria-label={`Turno ${hora}, ${nombre}${tono.etiqueta ? `, ${tono.etiqueta}` : ''}`}
              className={cn(
                'relative flex h-14 min-w-[9.5rem] max-w-[13rem] shrink-0 items-center',
                'overflow-hidden rounded-xl border px-3 text-left',
                'transition-colors active:bg-secondary',
                esDestacado
                  ? 'border-primary/40 bg-card shadow-sm ring-2 ring-primary/25'
                  : 'border-border bg-card',
                tono.apagado && !esDestacado && 'opacity-55'
              )}
            >
              {/* Barra de estado: color plano, legible de reojo y a un metro. */}
              <span
                aria-hidden="true"
                className={cn('absolute inset-y-0 left-0 w-1.5', tono.barra)}
              />

              <div className="min-w-0 flex-1 pl-1.5">
                <div className="flex items-center gap-1.5">
                  {/* La hora nunca se trunca: es el dato que el barbero busca. */}
                  <span className="shrink-0 text-lg font-black leading-none tabular-nums">{hora}</span>
                  {cuenta ? (
                    <span
                      className={cn(
                        'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold leading-none',
                        CLASE_CUENTA[cuenta.urgencia]
                      )}
                    >
                      {cuenta.texto}
                    </span>
                  ) : (
                    tono.etiqueta && (
                      <span
                        className={cn(
                          'shrink-0 text-[10px] font-bold uppercase leading-none tracking-wider',
                          tono.etiquetaClass
                        )}
                      >
                        {tono.etiqueta}
                      </span>
                    )
                  )}
                </div>
                <p className="mt-1.5 truncate text-xs font-medium text-muted-foreground">
                  {nombre}
                </p>
              </div>
            </button>
          )
        })}
      </div>

      <button
        onClick={onOpenAgenda}
        aria-label="Ver la agenda completa del día"
        className="flex w-20 shrink-0 flex-col items-center justify-center gap-1 border-l text-muted-foreground transition-colors active:bg-secondary"
      >
        <CalendarDays className="size-5" />
        <span className="text-[10px] font-bold leading-none">
          {items.length} turno{items.length === 1 ? '' : 's'}
        </span>
      </button>
    </div>
  )
}
