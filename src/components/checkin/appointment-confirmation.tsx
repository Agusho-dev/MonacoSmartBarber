'use client'

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { CheckCircle2, Scissors, Clock, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  TerminalSectionGlow,
  terminalBodyMuted,
  terminalH1Gradient,
} from '@/components/checkin/terminal-theme'

interface AppointmentConfirmationProps {
  barberName: string | null
  onReset: () => void
  isLightBg: boolean
  /** Título grande. Default: "¡Llegada registrada!". */
  title?: string
  /** Línea principal. Default: "<barbero> ya sabe que llegaste.". */
  message?: ReactNode
  /**
   * Avisos secundarios de una línea (enrolamiento facial hecho, turno sumado a
   * una entrada de fila existente…). Son parte del cierre, no errores.
   */
  notes?: string[]
  /** Hora del turno "HH:MM" — se muestra junto al barbero cuando hay. */
  appointmentTime?: string | null
  autoResetSeconds?: number
}

const AUTO_REDIRECT_SECONDS = 10

export function AppointmentConfirmation({
  barberName,
  onReset,
  isLightBg,
  title = '¡Llegada registrada!',
  message,
  notes,
  appointmentTime = null,
  autoResetSeconds = AUTO_REDIRECT_SECONDS,
}: AppointmentConfirmationProps) {
  const [secondsLeft, setSecondsLeft] = useState(autoResetSeconds)

  useEffect(() => {
    if (secondsLeft <= 0) {
      onReset()
      return
    }
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [secondsLeft, onReset])

  const progress = ((autoResetSeconds - secondsLeft) / autoResetSeconds) * 100

  const mensajePrincipal =
    message ??
    (barberName ? (
      <>
        <span className={cn('font-bold', isLightBg ? 'text-zinc-900' : 'text-white')}>
          {barberName}
        </span>{' '}
        ya sabe que llegaste.
      </>
    ) : (
      'Estás en la fila. ¡Ya vamos!'
    ))

  return (
    <div
      key="appointment-confirmation"
      className="relative z-[1] w-full max-w-sm md:max-w-lg flex flex-col items-center gap-6 md:gap-8 px-6 pt-12 md:pt-16 pb-10 my-auto animate-in fade-in zoom-in-95 duration-500"
    >
      <TerminalSectionGlow className={isLightBg ? 'hidden' : undefined} />

      {/* Icono de éxito */}
      <div className="relative flex flex-col items-center gap-4">
        <div
          className={cn(
            'size-24 md:size-32 rounded-full flex items-center justify-center ring-4',
            isLightBg
              ? 'bg-emerald-50 ring-emerald-200 border border-emerald-200'
              : 'bg-zinc-950/80 ring-emerald-400/30 border border-emerald-400/20 shadow-[0_0_48px_rgba(52,211,153,0.25)]'
          )}
        >
          <CheckCircle2
            className={cn(
              'size-14 md:size-20',
              isLightBg
                ? 'text-emerald-500'
                : 'text-emerald-400 drop-shadow-[0_0_16px_rgba(52,211,153,0.6)]'
            )}
            strokeWidth={1.5}
          />
        </div>

        <div className="text-center space-y-2">
          <h2
            className={cn(
              'text-3xl md:text-5xl font-extrabold',
              isLightBg ? 'text-zinc-900' : terminalH1Gradient
            )}
          >
            {title}
          </h2>
          <p
            className={cn(
              'text-lg md:text-2xl mt-2',
              isLightBg ? 'text-zinc-700' : terminalBodyMuted
            )}
          >
            {mensajePrincipal}
          </p>
        </div>
      </div>

      {/* Detalle barbero + hora */}
      {barberName && (
        <div
          className={cn(
            'flex items-center gap-3 px-5 py-3 rounded-2xl border',
            isLightBg
              ? 'bg-white border-zinc-200 shadow-sm'
              : 'bg-white/5 border-white/10'
          )}
        >
          <Scissors
            className={cn(
              'size-5 shrink-0',
              isLightBg ? 'text-cyan-600' : 'text-cyan-300'
            )}
            strokeWidth={1.75}
          />
          <p
            className={cn(
              'text-base md:text-lg font-medium',
              isLightBg ? 'text-zinc-800' : 'text-white/80'
            )}
          >
            Tu barbero:{' '}
            <span className={cn('font-bold', isLightBg ? 'text-zinc-900' : 'text-white')}>
              {barberName}
            </span>
            {appointmentTime && (
              <>
                {' · '}
                <span className={cn('font-bold', isLightBg ? 'text-zinc-900' : 'text-white')}>
                  {appointmentTime}
                </span>
              </>
            )}
          </p>
        </div>
      )}

      {/* Avisos del cierre */}
      {notes && notes.length > 0 && (
        <div className="w-full flex flex-col gap-2">
          {notes.map((note) => (
            <div
              key={note}
              className={cn(
                'flex items-start gap-2.5 px-4 py-3 rounded-2xl border text-base md:text-lg',
                isLightBg
                  ? 'bg-cyan-50 border-cyan-200 text-cyan-900'
                  : 'bg-cyan-500/10 border-cyan-400/25 text-cyan-100'
              )}
            >
              <Info className="size-5 shrink-0 mt-0.5" strokeWidth={1.75} />
              <span>{note}</span>
            </div>
          ))}
        </div>
      )}

      {/* Barra de progreso + contador regresivo */}
      <div className="w-full flex flex-col items-center gap-3">
        <div
          className={cn(
            'w-full h-1.5 rounded-full overflow-hidden',
            isLightBg ? 'bg-zinc-200' : 'bg-white/10'
          )}
        >
          <div
            className={cn(
              'h-full rounded-full transition-all duration-1000 ease-linear',
              isLightBg ? 'bg-emerald-500' : 'bg-emerald-400'
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div
          className={cn(
            'flex items-center gap-1.5 text-sm md:text-base',
            isLightBg ? 'text-zinc-500' : 'text-white/40'
          )}
        >
          <Clock className="size-4" />
          <span>Volviendo al inicio en {secondsLeft}s…</span>
        </div>
      </div>

      {/* Botón para volver ya */}
      <button
        onClick={onReset}
        className={cn(
          'text-base md:text-lg underline underline-offset-4 transition-colors',
          isLightBg
            ? 'text-zinc-500 hover:text-zinc-800'
            : 'text-white/35 hover:text-white/65'
        )}
      >
        Volver al inicio ahora
      </button>
    </div>
  )
}
