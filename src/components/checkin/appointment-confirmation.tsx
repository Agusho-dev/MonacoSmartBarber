'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, Scissors, Clock } from 'lucide-react'
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
}

const AUTO_REDIRECT_SECONDS = 10

export function AppointmentConfirmation({
  barberName,
  onReset,
  isLightBg,
}: AppointmentConfirmationProps) {
  const [secondsLeft, setSecondsLeft] = useState(AUTO_REDIRECT_SECONDS)

  useEffect(() => {
    if (secondsLeft <= 0) {
      onReset()
      return
    }
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [secondsLeft, onReset])

  const progress = ((AUTO_REDIRECT_SECONDS - secondsLeft) / AUTO_REDIRECT_SECONDS) * 100

  return (
    <div
      key="appointment-confirmation"
      className="relative z-[1] w-full max-w-sm md:max-w-lg flex flex-col items-center gap-8 md:gap-10 px-6 pt-16 md:pt-20 pb-10 my-auto animate-in fade-in zoom-in-95 duration-500"
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
            ¡Llegada registrada!
          </h2>
          {barberName ? (
            <p
              className={cn(
                'text-lg md:text-2xl mt-2',
                isLightBg ? 'text-zinc-700' : terminalBodyMuted
              )}
            >
              <span
                className={cn(
                  'font-bold',
                  isLightBg ? 'text-zinc-900' : 'text-white'
                )}
              >
                {barberName}
              </span>{' '}
              ya sabe que llegaste.
            </p>
          ) : (
            <p
              className={cn(
                'text-lg md:text-2xl mt-2',
                isLightBg ? 'text-zinc-700' : terminalBodyMuted
              )}
            >
              Estás en la fila. ¡Ya vamos!
            </p>
          )}
        </div>
      </div>

      {/* Detalle barbero */}
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
          </p>
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
          <span>Volviendo al inicio en {secondsLeft}s...</span>
        </div>
      </div>

      {/* Botón para volver ya */}
      <button
        onClick={onReset}
        className={cn(
          'text-sm md:text-base underline underline-offset-4 transition-colors',
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
