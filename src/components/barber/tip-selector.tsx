'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/format'
import { Banknote, ArrowRightLeft, CreditCard, Heart, X, type LucideIcon } from 'lucide-react'
import { vibrate } from '@/lib/barber-feedback'
import type { PaymentMethod } from '@/lib/types/database'

interface TipSelectorProps {
  baseAmount: number
  /** Monto actual de la propina. 0 = sin propina. */
  value: number
  /** Método de pago de la propina (null = usa el mismo que el servicio). */
  method: PaymentMethod | null
  onChange: (amount: number, method: PaymentMethod | null) => void
  /** Método de pago del servicio: se usa como default para la propina. */
  serviceMethod: PaymentMethod | null
}

/** Chips con montos redondos predefinidos. Siempre 1000 / 2000 / 3000. */
function calcQuickAmounts(_base: number): number[] {
  return [1000, 2000, 3000]
}

const TIP_METHOD_OPTIONS: { value: PaymentMethod; label: string; icon: LucideIcon }[] = [
  { value: 'cash', label: 'Efectivo', icon: Banknote },
  { value: 'transfer', label: 'Transferencia', icon: ArrowRightLeft },
  { value: 'card', label: 'Tarjeta', icon: CreditCard },
]

export function TipSelector({
  baseAmount,
  value,
  method,
  onChange,
  serviceMethod,
}: TipSelectorProps) {
  const quickAmounts = calcQuickAmounts(baseAmount)
  const [customOpen, setCustomOpen] = useState(false)
  const [customValue, setCustomValue] = useState('')

  const hasTip = value > 0
  const effectiveMethod = method ?? serviceMethod

  const handleSelectQuick = (amount: number) => {
    vibrate(10)
    onChange(amount, effectiveMethod)
    setCustomOpen(false)
  }

  const handleClear = () => {
    vibrate(5)
    onChange(0, null)
    setCustomOpen(false)
    setCustomValue('')
  }

  const handleCustomConfirm = () => {
    const n = parseInt(customValue.replace(/[^0-9]/g, ''), 10)
    if (!Number.isFinite(n) || n <= 0) return
    vibrate(10)
    onChange(n, effectiveMethod)
    setCustomOpen(false)
    setCustomValue('')
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Heart className="size-4 text-rose-500" aria-hidden />
          <p className="text-sm font-semibold">Propina</p>
          <span className="text-xs text-muted-foreground">(opcional)</span>
        </div>
        {hasTip && (
          <button
            type="button"
            onClick={handleClear}
            className="text-xs font-semibold text-muted-foreground hover:text-foreground flex items-center gap-1"
            aria-label="Quitar propina"
          >
            <X className="size-3" /> Quitar
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {quickAmounts.map((amount) => {
          const active = value === amount
          return (
            <button
              key={amount}
              type="button"
              onClick={() => handleSelectQuick(amount)}
              className={cn(
                'rounded-full border-2 px-4 py-2 text-sm font-bold tabular-nums transition-all',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                active
                  ? 'border-primary bg-primary text-primary-foreground shadow scale-105'
                  : 'border-border bg-card hover:border-primary/40',
              )}
              aria-pressed={active}
            >
              {formatCurrency(amount)}
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => setCustomOpen((v) => !v)}
          className={cn(
            'rounded-full border-2 px-4 py-2 text-sm font-bold transition-all',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
            customOpen
              ? 'border-primary bg-primary/10'
              : 'border-border bg-card hover:border-primary/40',
          )}
        >
          Otro monto
        </button>
      </div>

      {customOpen && (
        <div className="flex gap-2">
          <Input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="Ej: 1500"
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCustomConfirm() } }}
            className="h-12 text-base font-semibold tabular-nums"
            aria-label="Monto de propina personalizado"
            autoFocus
          />
          <Button type="button" onClick={handleCustomConfirm} disabled={!customValue} className="h-12 px-5">
            Confirmar
          </Button>
        </div>
      )}

      {hasTip && (
        <div className="space-y-2 rounded-xl bg-muted/50 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            ¿Cómo la recibe?
          </p>
          <div className="grid grid-cols-3 gap-2">
            {TIP_METHOD_OPTIONS.map((opt) => {
              const Icon = opt.icon
              const active = effectiveMethod === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { vibrate(8); onChange(value, opt.value) }}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-lg border-2 p-2 text-xs font-semibold transition-all',
                    active
                      ? 'border-primary bg-primary text-primary-foreground shadow'
                      : 'border-transparent bg-background hover:border-primary/40',
                  )}
                  aria-pressed={active}
                >
                  <Icon className="size-4" />
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
