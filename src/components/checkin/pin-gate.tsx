'use client'

import { useState, useTransition } from 'react'
import { Lock, Delete, Loader2, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { validateCheckinPinForOrg } from '@/lib/actions/checkin-pin'

interface PinGateProps {
  orgSlug: string
  orgName: string
  orgLogoUrl?: string | null
  /** Render que se monta una vez validado el PIN. */
  children: React.ReactNode
}

const PIN_MAX = 8
const PIN_MIN = 4

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

/**
 * Gate full-screen del kiosk: muestra keypad numérico y solo permite avanzar
 * cuando el PIN es correcto. Cuando se valida con éxito, el server setea la
 * cookie `checkin_session` y forzamos `location.reload()` para que el server
 * component re-evalúe y muestre el contenido protegido.
 */
export function PinGate({ orgSlug, orgName, orgLogoUrl, children: _children }: PinGateProps) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()

  function press(d: string) {
    setError(null)
    setPin((prev) => (prev.length >= PIN_MAX ? prev : prev + d))
  }

  function backspace() {
    setError(null)
    setPin((prev) => prev.slice(0, -1))
  }

  function clear() {
    setError(null)
    setPin('')
  }

  function submit() {
    if (pin.length < PIN_MIN) {
      setError('El PIN debe tener al menos 4 dígitos.')
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await validateCheckinPinForOrg(orgSlug, pin)
      if ('ok' in res) {
        setSuccess(true)
        // Pequeño delay para que el usuario vea el ✓ antes del reload
        setTimeout(() => {
          window.location.reload()
        }, 300)
      } else {
        setError(mapError(res.error))
        setPin('')
      }
    })
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-black px-6 text-white">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="mb-10 flex flex-col items-center gap-3 text-center">
          {orgLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={orgLogoUrl}
              alt={orgName}
              className="h-16 w-16 rounded-full object-cover ring-1 ring-white/10"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/5 ring-1 ring-white/10">
              <Lock className="h-7 w-7 text-white/50" />
            </div>
          )}
          <div>
            <p className="text-base font-medium text-white/90">{orgName}</p>
            <p className="mt-1 text-xs uppercase tracking-[0.18em] text-white/40">
              Ingresá el PIN
            </p>
          </div>
        </div>

        {/* PIN dots */}
        <div className="mb-6 flex items-center justify-center gap-3">
          {Array.from({ length: PIN_MAX }, (_, i) => {
            const filled = i < pin.length
            return (
              <span
                key={i}
                className={cn(
                  'h-3 w-3 rounded-full transition-all duration-150',
                  filled
                    ? success
                      ? 'bg-emerald-400 scale-110'
                      : 'bg-white scale-105'
                    : 'bg-white/15'
                )}
              />
            )
          })}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-2 text-center text-xs text-red-400">
            {error}
          </div>
        )}

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-3">
          {KEYS.map((k) => (
            <KeypadButton key={k} onClick={() => press(k)} disabled={isPending || success}>
              {k}
            </KeypadButton>
          ))}
          <KeypadButton onClick={clear} disabled={isPending || success || pin.length === 0} subtle>
            <span className="text-xs uppercase tracking-wider">C</span>
          </KeypadButton>
          <KeypadButton onClick={() => press('0')} disabled={isPending || success}>
            0
          </KeypadButton>
          <KeypadButton onClick={backspace} disabled={isPending || success || pin.length === 0} subtle>
            <Delete className="h-5 w-5" />
          </KeypadButton>
        </div>

        {/* Submit */}
        <button
          type="button"
          onClick={submit}
          disabled={isPending || success || pin.length < PIN_MIN}
          className={cn(
            'mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-base font-semibold transition-all',
            success
              ? 'bg-emerald-500 text-white'
              : 'bg-white text-black hover:bg-white/90',
            'disabled:opacity-40 disabled:pointer-events-none'
          )}
        >
          {isPending ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : success ? (
            <>✓ Acceso concedido</>
          ) : (
            <>
              Continuar
              <ArrowRight className="h-5 w-5" />
            </>
          )}
        </button>

        <p className="mt-8 text-center text-[11px] text-white/30">
          Solo personal autorizado.
        </p>
      </div>
    </div>
  )
}

function KeypadButton({
  onClick,
  disabled,
  subtle,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  subtle?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex h-16 items-center justify-center rounded-2xl text-2xl font-semibold transition-all',
        'active:scale-95 active:bg-white/20',
        subtle ? 'bg-white/[0.03] text-white/60' : 'bg-white/5 text-white',
        'hover:bg-white/10',
        'disabled:opacity-30 disabled:pointer-events-none'
      )}
    >
      {children}
    </button>
  )
}

function mapError(code: string): string {
  switch (code) {
    case 'INVALID_PIN':
      return 'PIN incorrecto. Intentá de nuevo.'
    case 'ORG_NOT_FOUND':
      return 'Barbería no encontrada.'
    case 'PIN_LENGTH_INVALID':
      return 'El PIN debe tener entre 4 y 8 dígitos.'
    case 'INVALID_INPUT':
      return 'Datos inválidos.'
    default:
      return 'Error al validar el PIN.'
  }
}
