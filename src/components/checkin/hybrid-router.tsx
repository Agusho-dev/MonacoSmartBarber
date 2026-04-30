'use client'

import { useState, useCallback } from 'react'
import {
  Zap,
  Calendar,
  Loader2,
  Delete,
  AlertCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  GlassRing,
  TerminalSectionGlow,
  terminalBodyMuted,
  terminalKeypadKey,
  terminalKeypadShell,
} from '@/components/checkin/terminal-theme'
import { AppointmentConfirmation } from '@/components/checkin/appointment-confirmation'
import { InlineQuickBookFlow } from '@/components/checkin/inline-quickbook-flow'
import { lookupAppointmentByPhone, confirmAppointmentArrival } from '@/lib/actions/kiosk-turnos'
import type { AppointmentInfo } from '@/lib/actions/kiosk-turnos'
import type { Service, Staff } from '@/lib/types/database'

// ─── Constantes ───────────────────────────────────────────────────────────────

const PHONE_LENGTH = 10
const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

function formatPhone(digits: string): string {
  if (!digits) return ''
  if (digits.length <= 2) return digits
  if (digits.length <= 6) return `${digits.slice(0, 2)} ${digits.slice(2)}`
  return `${digits.slice(0, 2)} ${digits.slice(2, 6)} ${digits.slice(6)}`
}

// ─── Tipos internos ───────────────────────────────────────────────────────────

type HybridStep =
  | 'phone_input'
  | 'has_appointment'
  | 'no_appointment_choice'
  | 'walk_in_branch'
  | 'booking'
  | 'confirmed'

interface HybridRouterProps {
  branchId: string
  services: Service[]
  barbers: Staff[]
  isLightBg: boolean
  clientName: string
  /** Callback: el usuario eligió "entrar a la cola ahora" — delega en WalkInFlow */
  onWalkIn: () => void
  onReset: () => void
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function HybridRouter({
  branchId,
  services,
  barbers,
  isLightBg,
  onWalkIn,
  onReset,
}: HybridRouterProps) {
  const [step, setStep] = useState<HybridStep>('phone_input')
  const [phone, setPhone] = useState('')
  const [isLooking, setIsLooking] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [error, setError] = useState('')
  const [appointment, setAppointment] = useState<AppointmentInfo | null>(null)
  const [foundClientName, setFoundClientName] = useState('')

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
        setFoundClientName(result.data.appointment.client_name.split(' ')[0])
        setStep('has_appointment')
      } else {
        // Extraer nombre si está disponible (puede no estarlo en hybrid)
        setFoundClientName('')
        setAppointment(null)
        setStep('no_appointment_choice')
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

  // ── Confirmar llegada con turno ──

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

  // ── Reset ──

  const resetFlow = useCallback(() => {
    setStep('phone_input')
    setPhone('')
    setError('')
    setAppointment(null)
    setFoundClientName('')
    setIsLooking(false)
    setIsConfirming(false)
  }, [])

  // ─── Pantalla: reserva hecha ────────────────────────────────────────────────

  if (step === 'confirmed') {
    return (
      <AppointmentConfirmation
        barberName={appointment?.barber_name ?? null}
        onReset={onReset}
        isLightBg={isLightBg}
      />
    )
  }

  // ─── Pantalla: flujo de reserva inline ─────────────────────────────────────

  if (step === 'booking') {
    return (
      <InlineQuickBookFlow
        branchId={branchId}
        services={services}
        barbers={barbers}
        isLightBg={isLightBg}
        onBack={() => setStep('no_appointment_choice')}
        onReset={onReset}
      />
    )
  }

  // ─── Pantalla: ingreso de teléfono ──────────────────────────────────────────

  if (step === 'phone_input') {
    return (
      <div className="relative z-[1] w-full max-w-sm md:max-w-md flex flex-col items-center gap-5 px-4 md:px-8 py-6 my-auto animate-in fade-in zoom-in-95 duration-500">
        <TerminalSectionGlow className={isLightBg ? 'hidden' : undefined} />

        <div className="text-center space-y-2">
          <h2
            className={cn(
              'text-2xl md:text-4xl font-extrabold',
              isLightBg ? 'text-zinc-900' : 'text-white'
            )}
          >
            Tenes turno reservado?
          </h2>
          <p
            className={cn(
              'text-base md:text-lg',
              isLightBg ? 'text-zinc-600' : terminalBodyMuted
            )}
          >
            Ingresa tu telefono y lo buscamos
          </p>
        </div>

        <div
          className={cn(
            'w-full rounded-2xl border p-3 md:p-4 text-center relative overflow-hidden',
            isLightBg ? 'border-zinc-300 bg-white shadow-sm' : terminalKeypadShell
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
              ? `${PHONE_LENGTH - phone.length} digitos restantes`
              : 'Buscando...'}
          </p>
          {isLooking && (
            <div className="absolute inset-0 bg-background/80 flex items-center justify-center backdrop-blur-sm animate-in fade-in duration-200">
              <Loader2 className="size-8 animate-spin" />
            </div>
          )}
        </div>

        <div className="w-full grid grid-cols-3 gap-2 md:gap-3">
          {KEYPAD.map((d) => (
            <button
              key={d}
              onClick={() => pressDigit(d)}
              disabled={isLooking}
              className={cn(
                'h-11 md:h-14 text-xl md:text-2xl',
                isLightBg
                  ? 'relative rounded-xl md:rounded-2xl border border-zinc-300 bg-white text-zinc-900 font-semibold transition-all duration-200 hover:border-zinc-400 hover:-translate-y-0.5 active:translate-y-0 active:scale-95 disabled:opacity-40 disabled:pointer-events-none shadow-sm'
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
                ? 'relative rounded-xl md:rounded-2xl border border-zinc-300 bg-white text-zinc-900 font-semibold transition-all duration-200 hover:border-zinc-400 hover:-translate-y-0.5 active:translate-y-0 active:scale-95 disabled:opacity-40 disabled:pointer-events-none shadow-sm'
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
                ? 'relative rounded-xl md:rounded-2xl border border-zinc-300 bg-white text-zinc-900 font-semibold transition-all duration-200 hover:border-zinc-400 hover:-translate-y-0.5 active:translate-y-0 active:scale-95 disabled:opacity-40 disabled:pointer-events-none shadow-sm'
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
      </div>
    )
  }

  // ─── Pantalla: tiene turno ──────────────────────────────────────────────────

  if (step === 'has_appointment' && appointment) {
    return (
      <div className="relative z-[1] w-full max-w-sm md:max-w-lg flex flex-col items-center gap-6 px-4 md:px-8 py-8 my-auto animate-in fade-in slide-in-from-right-4 duration-400">
        <TerminalSectionGlow className={isLightBg ? 'hidden' : undefined} />

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
            Hola, {foundClientName || 'bienvenido'}!
          </h2>
        </div>

        {appointment.barber_name && (
          <div
            className={cn(
              'w-full rounded-2xl border p-4 text-center',
              isLightBg ? 'bg-white border-zinc-200 shadow-sm' : 'bg-white/5 border-white/10'
            )}
          >
            <p className={cn('text-sm font-semibold uppercase tracking-wider mb-1', isLightBg ? 'text-zinc-500' : 'text-white/40')}>
              Tu barbero
            </p>
            <p className={cn('text-xl md:text-2xl font-bold', isLightBg ? 'text-zinc-900' : 'text-white')}>
              {appointment.barber_name}
            </p>
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

        <GlassRing halo={!isLightBg} className="w-full">
          <button
            onClick={handleConfirmArrival}
            disabled={isConfirming}
            className={cn(
              'relative w-full flex items-center justify-center gap-3 rounded-2xl border py-4 md:py-5 px-6 text-lg md:text-xl font-bold transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2',
              isLightBg
                ? 'bg-emerald-500 border-emerald-500 text-white hover:bg-emerald-600 focus-visible:ring-emerald-500/40 shadow-sm'
                : 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300 hover:border-emerald-400/70 hover:bg-emerald-500/25 focus-visible:ring-emerald-400/50'
            )}
          >
            {isConfirming ? (
              <Loader2 className="size-5 animate-spin" />
            ) : null}
            Confirmar mi llegada
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
    )
  }

  // ─── Pantalla: sin turno → elegir ──────────────────────────────────────────

  if (step === 'no_appointment_choice') {
    return (
      <div className="relative z-[1] w-full max-w-sm md:max-w-lg flex flex-col items-center gap-6 px-4 md:px-8 py-8 my-auto animate-in fade-in slide-in-from-right-4 duration-400">
        <TerminalSectionGlow className={isLightBg ? 'hidden' : undefined} />

        <div className="text-center space-y-1">
          <h2
            className={cn(
              'text-2xl md:text-4xl font-extrabold',
              isLightBg ? 'text-zinc-900' : 'text-white'
            )}
          >
            Que querés hacer?
          </h2>
          <p
            className={cn(
              'text-base md:text-lg',
              isLightBg ? 'text-zinc-600' : terminalBodyMuted
            )}
          >
            No encontramos turno para el numero{' '}
            <span className="font-bold">{formatPhone(phone)}</span>
          </p>
        </div>

        <div className="w-full flex flex-col gap-4">
          {/* Walk-in */}
          <GlassRing halo={!isLightBg}>
            <button
              onClick={onWalkIn}
              className={cn(
                'group relative w-full flex items-center gap-4 md:gap-5 rounded-2xl border p-4 md:p-5 text-left overflow-hidden transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2',
                isLightBg
                  ? 'border-zinc-300 bg-white shadow-sm hover:border-zinc-400 hover:shadow-md focus-visible:ring-cyan-600/35'
                  : 'border-white/15 bg-white/5 hover:border-white/28 focus-visible:ring-white/50'
              )}
            >
              <div
                className={cn(
                  'size-12 md:size-14 rounded-xl border flex items-center justify-center shrink-0',
                  isLightBg
                    ? 'bg-emerald-50 border-emerald-300'
                    : 'bg-emerald-500/10 border-emerald-400/25 shadow-[0_0_16px_rgba(52,211,153,0.15)]'
                )}
              >
                <Zap
                  className={cn(
                    'size-6 md:size-7',
                    isLightBg ? 'text-emerald-600' : 'text-emerald-300'
                  )}
                  fill="currentColor"
                />
              </div>
              <div className="flex-1 min-w-0">
                <p
                  className={cn(
                    'text-lg md:text-xl font-bold',
                    isLightBg ? 'text-zinc-900' : 'text-white'
                  )}
                >
                  Entrar a la cola ahora
                </p>
                <p
                  className={cn(
                    'text-sm md:text-base mt-0.5',
                    isLightBg ? 'text-zinc-600' : 'text-white/50'
                  )}
                >
                  Sumate a la fila de espera
                </p>
              </div>
            </button>
          </GlassRing>

          {/* Reservar turno */}
          <GlassRing halo={false}>
            <button
              onClick={() => setStep('booking')}
              className={cn(
                'group relative w-full flex items-center gap-4 md:gap-5 rounded-2xl border p-4 md:p-5 text-left overflow-hidden transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2',
                isLightBg
                  ? 'border-zinc-300 bg-white shadow-sm hover:border-zinc-400 hover:shadow-md focus-visible:ring-cyan-600/35'
                  : 'border-white/15 bg-white/5 hover:border-white/28 focus-visible:ring-white/50'
              )}
            >
              <div
                className={cn(
                  'size-12 md:size-14 rounded-xl border flex items-center justify-center shrink-0',
                  isLightBg
                    ? 'bg-cyan-50 border-cyan-300'
                    : 'bg-cyan-500/10 border-cyan-400/25'
                )}
              >
                <Calendar
                  className={cn(
                    'size-6 md:size-7',
                    isLightBg ? 'text-cyan-600' : 'text-cyan-300'
                  )}
                  strokeWidth={1.75}
                />
              </div>
              <div className="flex-1 min-w-0">
                <p
                  className={cn(
                    'text-lg md:text-xl font-bold',
                    isLightBg ? 'text-zinc-900' : 'text-white'
                  )}
                >
                  Reservar un turno
                </p>
                <p
                  className={cn(
                    'text-sm md:text-base mt-0.5',
                    isLightBg ? 'text-zinc-600' : 'text-white/50'
                  )}
                >
                  Agenda tu visita para otro momento
                </p>
              </div>
            </button>
          </GlassRing>
        </div>

        <button
          onClick={resetFlow}
          className={cn(
            'text-sm md:text-base underline underline-offset-4 transition-colors',
            isLightBg
              ? 'text-zinc-500 hover:text-zinc-800'
              : 'text-white/35 hover:text-white/65'
          )}
        >
          Atras
        </button>
      </div>
    )
  }

  return null
}
