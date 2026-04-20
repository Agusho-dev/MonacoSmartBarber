'use client'

import { cn } from '@/lib/utils'
import { Banknote, CreditCard, ArrowRightLeft, Gift, type LucideIcon } from 'lucide-react'
import { vibrate } from '@/lib/barber-feedback'
import type { PaymentMethod } from '@/lib/types/database'

export type PaymentOptionValue = PaymentMethod | 'points'

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
  allowPoints?: boolean
  className?: string
}

export function PaymentMethodButtons({
  value,
  onChange,
  allowPoints,
  className,
}: PaymentMethodButtonsProps) {
  const options: PaymentOption[] = allowPoints
    ? [...DEFAULT_OPTIONS, { value: 'points', label: 'Puntos', icon: Gift, hint: 'Canje de premio' }]
    : DEFAULT_OPTIONS

  return (
    <div
      className={cn(
        'grid gap-2 sm:gap-3',
        options.length === 4 ? 'grid-cols-2' : 'grid-cols-3',
        '[&>*]:min-w-0',
        className,
      )}
    >
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
              'group flex flex-col items-center justify-center gap-1.5 rounded-2xl border-2 px-2 py-3 sm:p-4 min-h-[88px]',
              'transition-all duration-200 min-w-0',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
              selected
                ? 'border-primary bg-primary text-primary-foreground shadow-lg scale-[1.02]'
                : 'border-border bg-card hover:border-primary/40 hover:bg-primary/5',
            )}
            aria-pressed={selected}
          >
            <Icon className={cn('size-7 sm:size-9 transition-transform shrink-0', selected && 'scale-110')} />
            <span className="text-[13px] sm:text-base font-bold leading-tight text-center truncate max-w-full">
              {opt.label}
            </span>
            {opt.hint && (
              <span
                className={cn(
                  'hidden sm:block text-[11px] font-medium leading-tight',
                  selected ? 'opacity-80' : 'text-muted-foreground',
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
