'use client'

import { useState, useCallback } from 'react'
import {
  Calendar,
  Loader2,
  CheckCircle2,
  Clock,
  User,
  Scissors,
  Delete,
  AlertCircle,
} from 'lucide-react'
import { format, parseISO, isWithinInterval, subMinutes, addMinutes } from 'date-fns'
import { es } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { GlassRing, TerminalSectionGlow, terminalBodyMuted, terminalKeypadKey, terminalKeypadShell } from '@/components/checkin/terminal-theme'
import { AppointmentConfirmation } from '@/components/checkin/appointment-confirmation'
import { lookupAppointmentByPhone, confirmAppointmentArrival } from '@/lib/actions/kiosk-turnos'
import type { AppointmentInfo } from '@/lib/actions/kiosk-turnos'

// ─── Constantes ───────────────────────────────────────────────────────────────

const PHONE_LENGTH = 10
const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

function formatPhone(digits: string): string {
  if (!digits) return ''
  if (digits.length <= 2) return digits
  if (digits.length <= 6) return `${digits.slice(0, 2)} ${digits.slice(2)}`
  return `${digits.slice(0, 2)} ${digits.slice(2, 6)} ${digits.slice(6)}`
}

function isWithinTolerance(startsAt: string, toleranceMinutes: number): boolean {
  const now = new Date()
  const start = parseISO(startsAt)
  const windowStart = subMinutes(start, toleranceMinutes)
  const windowEnd = addMinutes(start, toleranceMinutes)
  return isWithinInterval(now, { start: windowStart, end: windowEnd })
}

// ─── Tipos de paso interno ────────────────────────────────────────────────────

type InternalStep =
  | 'phone_input'
  | 'has_appointment'
  | 'no_appointment'
  | 'confirmed'

// ─── Props ────────────────────────────────────────────────────────────────────

interface AppointmentLookupFlowProps {
  branchId: string
  isLightBg: boolean
  onNoAppointmentBook: () => void
  onReset: () => void
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function AppointmentLookupFlow({
  branchId,
  isLightBg,
  onNoAppointmentBook,
  onReset,
}: AppointmentLookupFlowProps) {
  const [step, setStep] = useState<InternalStep>('phone_input')
  const [phone, setPhone] = useState('')
  const [isLooking, setIsLooking] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [error, setError] = useState('')
  const [appointment, setAppointment] = useState<AppointmentInfo | null>(null)

  // ── Keypad ──

  const lookup = useCallback(
    async (ph: string) => {
      setIsLooking(true)
      setError('')
      const result = await lookupAppointmentByPhone(branchId, ph)
      setIsLooking(false)

      if ('error' in result) {
        setError(result.error)
        setPhone('')
        return
      }

      if (result.data.found && result.data.appointment) {
        setAppointment(result.data.appointment)
        setStep('has_appointment')
      } else {
        setAppointment(null)
        setStep('no_appointment')
      }
    },
    [branchId]
  )

  const pressDigit = (digit: string) => {
    if (phone.length >= PHONE_LENGTH || isLooking) return
    const next = phone + digit
    setPhone(next)
    if (next.length === PHONE_LENGTH) {
      lookup(next)
    }
  }

  const pressDelete = () => {
    if (isLooking) return
    setPhone((p) => p.slice(0, -1))
  }

  // ── Confirmar llegada ──

  const handleConfirmArrival = useCallback(async () => {
    if (!appointment) return
    setIsConfirming(true)
    setError('')

    const result = await confirmAppointmentArrival(appointment.id)
    setIsConfirming(false)

    if ('error' in result) {
      setError(result.error)
      return
    }

    setStep('confirmed')
  }, [appointment])

  // ── Reset interno ──

  const resetFlow = useCallback(() => {
    setStep('phone_input')
    setPhone('')
    setError('')
    setAppointment(null)
    setIsLooking(false)
    setIsConfirming(false)
  }, [])

  // ─── Pantalla confirmación ──────────────────────────────────────────────────

  if (step === 'confirmed') {
    return (
      <AppointmentConfirmation
        barberName={appointment?.barber_name ?? null}
        onReset={onReset}
        isLightBg={isLightBg}
      />
    )
  }

  // ─── Pantalla ingreso de teléfono ───────────────────────────────────────────

  if (step === 'phone_input') {
    return (
      <div className="relative z-[1] w-full max-w-sm md:max-w-md flex flex-col items-center gap-5 px-4 md:px-8 py-6 my-auto animate-in fade-in zoom-in-95 duration-500">
        <TerminalSectionGlow className={isLightBg ? 'hidden' : undefined} />

        {/* Header */}
        <div className="text-center space-y-2">
          <div
            className={cn(
              'inline-flex size-14 md:size-16 items-center justify-center rounded-2xl mb-2',
              isLightBg
                ? 'bg-cyan-50 border border-cyan-200'
                : 'bg-cyan-500/10 border border-cyan-400/20 shadow-[0_0_24px_rgba(34,211,238,0.12)]'
            )}
          >
            <Calendar
              className={cn(
                'size-7 md:size-8',
                isLightBg ? 'text-cyan-600' : 'text-cyan-300'
              )}
              strokeWidth={1.75}
            />
          </div>
          <h2
            className={cn(
              'text-2xl md:text-4xl font-extrabold',
              isLightBg ? 'text-zinc-900' : 'text-white'
            )}
          >
            Esta sucursal trabaja con turnos
          </h2>
          <p
            className={cn(
              'text-base md:text-lg',
              isLightBg ? 'text-zinc-600' : terminalBodyMuted
            )}
          >
            Ingresá tu teléfono para buscar tu turno
          </p>
        </div>

        {/* Display del teléfono */}
        <div
          className={cn(
            'w-full rounded-2xl border p-3 md:p-4 text-center relative overflow-hidden',
            isLightBg
              ? 'border-zinc-300 bg-white shadow-sm'
              : terminalKeypadShell
          )}
        >
          <p
            className={cn(
              'text-2xl md:text-3xl font-mono font-bold tracking-[0.15em] min-h-8 md:min-h-10 flex items-center justify-center',
              isLightBg ? 'text-zinc-900' : 'text-white'
            )}
          >
            {phone ? (
              formatPhone(phone)
            ) : (
              <span className={isLightBg ? 'text-zinc-300' : 'text-white/20'}>
                __ ____ ____
              </span>
            )}
          </p>
          <p className="text-xs md:text-sm text-muted-foreground mt-1 md:mt-2">
            {phone.length < PHONE_LENGTH
              ? `${PHONE_LENGTH - phone.length} dígitos restantes`
              : 'Buscando...'}
          </p>
          {isLooking && (
            <div className="absolute inset-0 bg-background/80 flex items-center justify-center backdrop-blur-sm animate-in fade-in duration-200">
              <Loader2 className="size-8 animate-spin" />
            </div>
          )}
        </div>

        {/* Keypad */}
        <div className="w-full grid grid-cols-3 gap-2 md:gap-3">
          {KEYPAD.map((d) => (
            <button
              key={d}
              onClick={() => pressDigit(d)}
              disabled={isLooking}
              className={cn(
                'h-11 md:h-14 text-xl md:text-2xl',
                isLightBg
                  ? 'relative rounded-xl md:rounded-2xl border border-zinc-300 bg-white text-zinc-900 font-semibold transition-all duration-200 hover:border-zinc-400 hover:-translate-y-0.5 active:translate-y-0 active:scale-95 disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600/35 shadow-sm'
                  : terminalKeypadKey
              )}
            >
              {d}
            </button>
          ))}
          <button
            onClick={pressDelete}
            disabled={isLooking || phone.length === 0}
            className={cn(
              'h-11 md:h-14 flex items-center justify-center',
              isLightBg
                ? 'relative rounded-xl md:rounded-2xl border border-zinc-300 bg-white text-zinc-900 font-semibold transition-all duration-200 hover:border-zinc-400 hover:-translate-y-0.5 active:translate-y-0 active:scale-95 disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600/35 shadow-sm'
                : terminalKeypadKey
            )}
          >
            <Delete className="size-5 md:size-6" />
          </button>
          <button
            onClick={() => pressDigit('0')}
            disabled={isLooking}
            className={cn(
              'h-11 md:h-14 text-xl md:text-2xl',
              isLightBg
                ? 'relative rounded-xl md:rounded-2xl border border-zinc-300 bg-white text-zinc-900 font-semibold transition-all duration-200 hover:border-zinc-400 hover:-translate-y-0.5 active:translate-y-0 active:scale-95 disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600/35 shadow-sm'
                : terminalKeypadKey
            )}
          >
            0
          </button>
          <div />
        </div>

        {error && (
          <div
            className={cn(
              'flex items-center gap-2 px-4 py-3 rounded-xl border text-sm md:text-base w-full',
              isLightBg
                ? 'bg-red-50 border-red-200 text-red-700'
                : 'bg-red-950/30 border-red-500/30 text-red-300'
            )}
          >
            <AlertCircle className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Link reservar si no tiene turno */}
        <button
          onClick={onNoAppointmentBook}
          className={cn(
            'text-sm md:text-base underline underline-offset-4 transition-colors mt-2',
            isLightBg
              ? 'text-zinc-500 hover:text-cyan-700'
              : 'text-white/35 hover:text-cyan-300'
          )}
        >
          Sin turno? Reserva un turno
        </button>
      </div>
    )
  }

  // ─── Pantalla: tiene turno ──────────────────────────────────────────────────

  if (step === 'has_appointment' && appointment) {
    const canConfirm = isWithinTolerance(
      appointment.starts_at,
      appointment.no_show_tolerance_minutes
    )
    const startFormatted = format(parseISO(appointment.starts_at), "EEEE d 'de' MMMM 'a las' HH:mm", { locale: es })

    return (
      <div className="relative z-[1] w-full max-w-sm md:max-w-lg flex flex-col items-center gap-6 px-4 md:px-8 py-8 my-auto animate-in fade-in slide-in-from-right-4 duration-400">
        <TerminalSectionGlow className={isLightBg ? 'hidden' : undefined} />

        {/* Header saludo */}
        <div className="text-center space-y-1">
          <p
            className={cn(
              'text-lg md:text-xl',
              isLightBg ? 'text-zinc-600' : terminalBodyMuted
            )}
          >
            Encontramos tu turno
          </p>
          <h2
            className={cn(
              'text-3xl md:text-5xl font-extrabold',
              isLightBg ? 'text-zinc-900' : 'text-white'
            )}
          >
            Hola, {appointment.client_name.split(' ')[0]}!
          </h2>
        </div>

        {/* Card del turno */}
        <div
          className={cn(
            'w-full rounded-2xl border p-5 md:p-6 space-y-4',
            isLightBg
              ? 'bg-white border-zinc-200 shadow-sm'
              : 'bg-white/5 border-white/10'
          )}
        >
          {/* Fecha y hora */}
          <div className="flex items-start gap-3">
            <Calendar
              className={cn(
                'size-5 shrink-0 mt-0.5',
                isLightBg ? 'text-cyan-600' : 'text-cyan-300'
              )}
              strokeWidth={1.75}
            />
            <div>
              <p
                className={cn(
                  'text-xs md:text-sm font-semibold uppercase tracking-wider',
                  isLightBg ? 'text-zinc-500' : 'text-white/40'
                )}
              >
                Fecha y hora
              </p>
              <p
                className={cn(
                  'text-base md:text-lg font-semibold capitalize',
                  isLightBg ? 'text-zinc-900' : 'text-white'
                )}
              >
                {startFormatted}
              </p>
            </div>
          </div>

          {/* Barbero */}
          {appointment.barber_name && (
            <div className="flex items-start gap-3">
              <User
                className={cn(
                  'size-5 shrink-0 mt-0.5',
                  isLightBg ? 'text-violet-600' : 'text-violet-300'
                )}
                strokeWidth={1.75}
              />
              <div>
                <p
                  className={cn(
                    'text-xs md:text-sm font-semibold uppercase tracking-wider',
                    isLightBg ? 'text-zinc-500' : 'text-white/40'
                  )}
                >
                  Barbero
                </p>
                <p
                  className={cn(
                    'text-base md:text-lg font-semibold',
                    isLightBg ? 'text-zinc-900' : 'text-white'
                  )}
                >
                  {appointment.barber_name}
                </p>
              </div>
            </div>
          )}

          {/* Servicios */}
          {appointment.services.length > 0 && (
            <div className="flex items-start gap-3">
              <Scissors
                className={cn(
                  'size-5 shrink-0 mt-0.5',
                  isLightBg ? 'text-emerald-600' : 'text-emerald-300'
                )}
                strokeWidth={1.75}
              />
              <div>
                <p
                  className={cn(
                    'text-xs md:text-sm font-semibold uppercase tracking-wider',
                    isLightBg ? 'text-zinc-500' : 'text-white/40'
                  )}
                >
                  Servicios
                </p>
                <p
                  className={cn(
                    'text-base md:text-lg font-semibold',
                    isLightBg ? 'text-zinc-900' : 'text-white'
                  )}
                >
                  {appointment.services.join(', ')}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Advertencia de fuera de ventana */}
        {!canConfirm && (
          <div
            className={cn(
              'flex items-center gap-2 px-4 py-3 rounded-xl border text-sm md:text-base w-full',
              isLightBg
                ? 'bg-amber-50 border-amber-200 text-amber-700'
                : 'bg-amber-950/25 border-amber-400/25 text-amber-300'
            )}
          >
            <Clock className="size-4 shrink-0" />
            <span>
              Podés confirmar tu llegada hasta {appointment.no_show_tolerance_minutes} minutos
              antes o después de la hora del turno.
            </span>
          </div>
        )}

        {error && (
          <div
            className={cn(
              'flex items-center gap-2 px-4 py-3 rounded-xl border text-sm md:text-base w-full',
              isLightBg
                ? 'bg-red-50 border-red-200 text-red-700'
                : 'bg-red-950/30 border-red-500/30 text-red-300'
            )}
          >
            <AlertCircle className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* CTA confirmar llegada */}
        <GlassRing halo={!isLightBg} className="w-full">
          <button
            onClick={handleConfirmArrival}
            disabled={!canConfirm || isConfirming}
            className={cn(
              'relative w-full flex items-center justify-center gap-3 rounded-2xl border py-4 md:py-5 px-6 text-lg md:text-xl font-bold transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2',
              isLightBg
                ? 'bg-emerald-500 border-emerald-500 text-white hover:bg-emerald-600 focus-visible:ring-emerald-500/40 shadow-sm'
                : 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300 hover:border-emerald-400/70 hover:bg-emerald-500/25 focus-visible:ring-emerald-400/50 shadow-[0_0_24px_rgba(52,211,153,0.15)]'
            )}
          >
            {isConfirming ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <CheckCircle2 className="size-5" strokeWidth={2} />
            )}
            Confirmar mi llegada
          </button>
        </GlassRing>

        {/* Volver a buscar */}
        <button
          onClick={resetFlow}
          className={cn(
            'text-sm md:text-base underline underline-offset-4 transition-colors',
            isLightBg
              ? 'text-zinc-500 hover:text-zinc-800'
              : 'text-white/35 hover:text-white/65'
          )}
        >
          Buscar con otro numero
        </button>
      </div>
    )
  }

  // ─── Pantalla: sin turno ────────────────────────────────────────────────────

  if (step === 'no_appointment') {
    return (
      <div className="relative z-[1] w-full max-w-sm md:max-w-lg flex flex-col items-center gap-6 px-4 md:px-8 py-8 my-auto animate-in fade-in slide-in-from-right-4 duration-400">
        <TerminalSectionGlow className={isLightBg ? 'hidden' : undefined} />

        <div className="text-center space-y-2">
          <div
            className={cn(
              'inline-flex size-14 items-center justify-center rounded-2xl mb-2',
              isLightBg
                ? 'bg-amber-50 border border-amber-200'
                : 'bg-amber-500/10 border border-amber-400/20'
            )}
          >
            <Calendar
              className={cn(
                'size-7',
                isLightBg ? 'text-amber-600' : 'text-amber-300'
              )}
              strokeWidth={1.75}
            />
          </div>
          <h2
            className={cn(
              'text-2xl md:text-3xl font-extrabold',
              isLightBg ? 'text-zinc-900' : 'text-white'
            )}
          >
            Sin turno para hoy
          </h2>
          <p
            className={cn(
              'text-base md:text-lg',
              isLightBg ? 'text-zinc-600' : terminalBodyMuted
            )}
          >
            No encontramos un turno para el numero{' '}
            <span className="font-bold">{formatPhone(phone)}</span>
          </p>
        </div>

        {/* CTAs */}
        <div className="w-full flex flex-col gap-3">
          <GlassRing halo={!isLightBg} className="w-full">
            <button
              onClick={onNoAppointmentBook}
              className={cn(
                'relative w-full flex items-center justify-center gap-3 rounded-2xl border py-4 md:py-5 px-6 text-lg md:text-xl font-bold transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2',
                isLightBg
                  ? 'bg-cyan-500 border-cyan-500 text-white hover:bg-cyan-600 focus-visible:ring-cyan-500/40 shadow-sm'
                  : 'bg-cyan-500/15 border-cyan-400/40 text-cyan-300 hover:border-cyan-400/70 hover:bg-cyan-500/25 focus-visible:ring-cyan-400/50 shadow-[0_0_24px_rgba(34,211,238,0.12)]'
              )}
            >
              <Calendar className="size-5" strokeWidth={2} />
              Reservar un turno
            </button>
          </GlassRing>

          <button
            onClick={resetFlow}
            className={cn(
              'text-sm md:text-base underline underline-offset-4 transition-colors',
              isLightBg
                ? 'text-zinc-500 hover:text-zinc-800'
                : 'text-white/35 hover:text-white/65'
            )}
          >
            Buscar con otro numero
          </button>
        </div>
      </div>
    )
  }

  return null
}
