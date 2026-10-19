'use client'

import { cn } from '@/lib/utils'
import { Banknote, CreditCard, ArrowRightLeft, type LucideIcon } from 'lucide-react'
import { vibrate } from '@/lib/barber-feedback'
import type { PaymentMethod } from '@/lib/types/database'
import { CLASE_OPCION, claseEstadoOpcion } from './cobro/piezas-cobro'

// El valor 'points' (canje legacy pre-mig 204) se eliminó: el canje en el local
// va por el escáner de beneficios de la tablet, nunca por un método de pago.
export type PaymentOptionValue = PaymentMethod

interface PaymentOption {
  value: PaymentOptionValue
  label: string
  icon: LucideIcon
  hint?: string
}

const DEFAULT_OPTIONS: PaymentOption[] = [
  { value: 'cash', label: 'Efectivo', icon: Banknote, hint: 'Recibís en mano' },
  { value: 'transfer', label: 'Transferencia', icon: ArrowRightLeft, hint: 'Alias / CBU' },
  { value: 'card', label: 'Tarjeta', icon: CreditCard, hint: 'Posnet' },
]

interface PaymentMethodButtonsProps {
  value: PaymentOptionValue | null
  onChange: (value: PaymentOptionValue) => void
  className?: string
}

/**
 * Los tres medios de cobro, compartidos por el cobro de un servicio y la venta
 * directa. El elegido queda en grafito lleno y del mismo tamaño que los otros
 * (antes crecía un 2 % y empujaba a los de al lado).
 */
export function PaymentMethodButtons({
  value,
  onChange,
  className,
}: PaymentMethodButtonsProps) {
  const options: PaymentOption[] = DEFAULT_OPTIONS

  return (
    <div className={cn('grid grid-cols-3 gap-2.5 sm:gap-3 [&>*]:min-w-0', className)}>
      {options.map((opt) => {
        const Icon = opt.icon
        const selected = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => {
              vibrate(8)
              onChange(opt.value)
            }}
            className={cn(
              'flex min-h-24 min-w-0 flex-col items-center justify-center gap-1.5 rounded-2xl px-1 py-3 sm:min-h-[6.5rem] sm:px-2',
              CLASE_OPCION,
              claseEstadoOpcion(selected),
            )}
            aria-pressed={selected}
          >
            <Icon className="size-7 shrink-0" aria-hidden />
            {/* En el celular, 13 px y apretado: si no, "Transferencia" no entra en
                un tercio de pantalla. En la tablet, 17. */}
            <span className="max-w-full truncate text-center text-[0.8125rem] font-semibold leading-tight tracking-[-0.02em] sm:text-[1.0625rem] sm:tracking-normal">
              {opt.label}
            </span>
            {opt.hint && (
              <span
                className={cn(
                  'hidden text-[0.8125rem] leading-tight sm:block',
                  selected ? 'opacity-75' : 'text-muted-foreground',
                )}
              >
                {opt.hint}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
