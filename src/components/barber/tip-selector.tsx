'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/format'
import { Banknote, ArrowRightLeft, CreditCard, X, type LucideIcon } from 'lucide-react'
import { vibrate } from '@/lib/barber-feedback'
import type { PaymentMethod } from '@/lib/types/database'
import { CampoMontoTablet } from '@/components/barber/campo-tablet'
import { CLASE_OPCION, TituloCobro, claseEstadoOpcion } from './cobro/piezas-cobro'

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

/**
 * La propina en tinta, como toda la plata del panel (DESIGN.md): sin corazón
 * rojo. Un monto cargado a mano queda a la vista en su propio botón ("Otro ·
 * $1.500"); antes, confirmado, ningún botón decía cuánto se había puesto.
 */
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
  const esMontoPropio = hasTip && !quickAmounts.includes(value)

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
    <section aria-labelledby="cobro-propina">
      <TituloCobro
        id="cobro-propina"
        opcional
        className="items-center"
        detalle={
          hasTip && (
            <button
              type="button"
              onClick={handleClear}
              className="-my-2 flex min-h-11 items-center gap-1.5 rounded-xl px-2.5 text-[0.9375rem] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Quitar propina"
            >
              <X className="size-4" aria-hidden /> Quitar
            </button>
          )
        }
      >
        Propina
      </TituloCobro>

      <div role="group" aria-labelledby="cobro-propina" className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {quickAmounts.map((amount) => {
          const active = value === amount
          return (
            <button
              key={amount}
              type="button"
              onClick={() => handleSelectQuick(amount)}
              className={cn(
                'flex h-14 items-center justify-center rounded-2xl px-3 font-mono text-[1.0625rem] font-semibold tabular-nums',
                CLASE_OPCION,
                claseEstadoOpcion(active),
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
          aria-expanded={customOpen}
          className={cn(
            'flex h-14 min-w-0 flex-col items-center justify-center rounded-2xl px-3',
            CLASE_OPCION,
            customOpen
              ? 'border-foreground bg-card text-foreground'
              : claseEstadoOpcion(esMontoPropio),
          )}
        >
          {esMontoPropio && !customOpen ? (
            <>
              <span className="text-[0.8125rem] leading-tight opacity-75">Otro monto</span>
              <span className="font-mono text-[1.0625rem] font-semibold leading-tight tabular-nums">
                {formatCurrency(value)}
              </span>
            </>
          ) : (
            <span className="text-[0.9375rem] font-semibold">Otro monto</span>
          )}
        </button>
      </div>

      {customOpen && (
        // Con el panel girado 180° el teclado de Android sale al revés (el 6 se
        // lee 9): ahí se carga con el teclado del panel. Sin giro, el input de siempre.
        <div className="mt-2.5">
          <CampoMontoTablet
            valor={customValue}
            onCambiar={setCustomValue}
            etiqueta="Monto de propina personalizado"
            autoAbrir
            maxDigitos={7}
            onConfirmar={handleCustomConfirm}
            textoConfirmar="Confirmar propina"
          >
            <div className="flex gap-2.5">
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="Ej: 1500"
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value.replace(/[^0-9]/g, ''))}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCustomConfirm() } }}
                className="h-14 rounded-2xl font-mono text-lg font-semibold tabular-nums"
                aria-label="Monto de propina personalizado"
                autoFocus
              />
              <Button type="button" onClick={handleCustomConfirm} disabled={!customValue} className="h-14 rounded-2xl px-6 text-base">
                Confirmar
              </Button>
            </div>
          </CampoMontoTablet>
        </div>
      )}

      {hasTip && (
        <div className="mt-4">
          <p id="cobro-propina-medio" className="mb-2 text-[0.9375rem] font-medium">
            ¿Cómo la recibe?
          </p>
          <div role="group" aria-labelledby="cobro-propina-medio" className="grid grid-cols-3 gap-2.5">
            {TIP_METHOD_OPTIONS.map((opt) => {
              const Icon = opt.icon
              const active = effectiveMethod === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { vibrate(8); onChange(value, opt.value) }}
                  className={cn(
                    'flex min-h-[4.25rem] min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 sm:px-1.5',
                    CLASE_OPCION,
                    claseEstadoOpcion(active),
                  )}
                  aria-pressed={active}
                >
                  <Icon className="size-5 shrink-0" aria-hidden />
                  {/* Mismo criterio que los medios de cobro: en el celular, 13 px apretado. */}
                  <span className="max-w-full truncate text-[0.8125rem] font-semibold leading-tight tracking-[-0.02em] sm:text-[0.9375rem] sm:tracking-normal">
                    {opt.label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
