'use client'

/**
 * Teclado numérico del kiosko (tablet horizontal, uso de pie a ~1 metro).
 *
 * Existían cuatro copias byte a byte de este bloque (walk-in, lookup de turno,
 * router híbrido y reserva inline). Esta es la única del flujo de turnos: la del
 * walk-in sigue viviendo en `checkin-walk-in.tsx` a propósito — migrarla toca el
 * archivo de 2775 líneas que hoy funciona en producción, y el beneficio no paga
 * el riesgo.
 */

import { Delete, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { terminalKeypadKey, terminalKeypadShell } from '@/components/checkin/terminal-theme'

export const PHONE_LENGTH = 10

const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

/** 11 2345 6789 — sólo formato visual, el valor sigue siendo dígitos crudos. */
export function formatPhone(digits: string): string {
  if (!digits) return ''
  if (digits.length <= 2) return digits
  if (digits.length <= 6) return `${digits.slice(0, 2)} ${digits.slice(2)}`
  return `${digits.slice(0, 2)} ${digits.slice(2, 6)} ${digits.slice(6)}`
}

interface PhoneKeypadProps {
  value: string
  onChange: (next: string) => void
  /** Se dispara al completar `maxLength` dígitos (autosubmit). */
  onComplete?: (phone: string) => void
  isLightBg: boolean
  disabled?: boolean
  /** Muestra el velo de carga sobre el display. */
  loading?: boolean
  maxLength?: number
}

const lightKey =
  'relative rounded-2xl border border-zinc-300 bg-white text-zinc-900 font-semibold transition-all duration-200 hover:border-zinc-400 hover:-translate-y-0.5 active:translate-y-0 active:scale-95 disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600/35 shadow-sm'

export function PhoneKeypad({
  value,
  onChange,
  onComplete,
  isLightBg,
  disabled = false,
  loading = false,
  maxLength = PHONE_LENGTH,
}: PhoneKeypadProps) {
  const bloqueado = disabled || loading

  const pressDigit = (digit: string) => {
    if (bloqueado || value.length >= maxLength) return
    const next = value + digit
    onChange(next)
    if (next.length === maxLength) onComplete?.(next)
  }

  const pressDelete = () => {
    if (bloqueado || !value.length) return
    onChange(value.slice(0, -1))
  }

  const faltan = maxLength - value.length

  return (
    <div className="w-full flex flex-col gap-3 md:gap-4">
      {/* Display */}
      <div
        className={cn(
          'w-full rounded-2xl border p-3 md:p-4 text-center relative overflow-hidden',
          isLightBg ? 'border-zinc-300 bg-white shadow-sm' : terminalKeypadShell
        )}
      >
        <p
          className={cn(
            'text-3xl md:text-4xl font-mono font-bold tracking-[0.15em] min-h-10 md:min-h-12 flex items-center justify-center',
            isLightBg ? 'text-zinc-900' : 'text-white'
          )}
        >
          {value ? (
            formatPhone(value)
          ) : (
            <span className={isLightBg ? 'text-zinc-300' : 'text-white/20'}>__ ____ ____</span>
          )}
        </p>
        <p className={cn('text-sm md:text-base mt-1', isLightBg ? 'text-zinc-500' : 'text-white/45')}>
          {faltan > 0 ? `${faltan} ${faltan === 1 ? 'dígito restante' : 'dígitos restantes'}` : 'Buscando…'}
        </p>
        {loading && (
          <div className="absolute inset-0 bg-background/80 flex items-center justify-center backdrop-blur-sm animate-in fade-in duration-200">
            <Loader2 className="size-8 animate-spin" />
          </div>
        )}
      </div>

      {/* Teclas */}
      <div className="w-full grid grid-cols-3 gap-2.5 md:gap-3">
        {KEYPAD.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => pressDigit(d)}
            disabled={bloqueado}
            className={cn(
              'h-14 md:h-16 text-2xl md:text-3xl',
              isLightBg ? lightKey : terminalKeypadKey
            )}
          >
            {d}
          </button>
        ))}
        <button
          type="button"
          onClick={pressDelete}
          disabled={bloqueado || value.length === 0}
          aria-label="Borrar último dígito"
          className={cn(
            'h-14 md:h-16 flex items-center justify-center',
            isLightBg ? lightKey : terminalKeypadKey
          )}
        >
          <Delete className="size-6 md:size-7" />
        </button>
        <button
          type="button"
          onClick={() => pressDigit('0')}
          disabled={bloqueado}
          className={cn(
            'h-14 md:h-16 text-2xl md:text-3xl',
            isLightBg ? lightKey : terminalKeypadKey
          )}
        >
          0
        </button>
        <div />
      </div>
    </div>
  )
}
