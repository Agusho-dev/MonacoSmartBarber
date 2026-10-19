'use client'

import { Wallet, RefreshCw, AlertTriangle } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatCurrency } from '@/lib/format'
import { cn } from '@/lib/utils'
import { AliasCopyHero } from './alias-copy-hero'
import { claseAviso, useTonoDelTema } from './cobro/tono'
import { accountRemaining, type TransferAccountState } from '@/lib/payment-accounts'

interface TransferAccountPickerProps {
  accounts: TransferAccountState[]
  /** La cuenta que eligió el sistema (`pickTransferAccount`) o, en el dashboard, el dueño. */
  selectedAccountId: string
  onSelect?: (id: string) => void
  /**
   * Si se puede cambiar la cuenta a mano. En el panel del barbero NUNCA
   * (decisión del dueño, 19/oct/2026): se cobra en la que decide el sistema,
   * que rota sola cuando una cuenta llega a su tope. Sólo el dashboard la
   * habilita, para el dueño. Por defecto, cerrado.
   */
  puedeElegirCuenta?: boolean
  /** Cuentas que el sistema salteó por estar llenas (aviso de que rotó). */
  rotatedFrom: TransferAccountState[]
  /** Todas las cuentas activas llegaron al tope: se cobra igual, pero hay que avisar. */
  allFull: boolean
  /** Monto a mostrar en el ticket del alias (total a transferir, propina incluida). */
  amountText: string
}

/**
 * La cuenta de cobro de una transferencia, compartida por el cobro de un
 * servicio (complete-service-dialog) y la venta directa (direct-sale-dialog),
 * para que las dos superficies nunca muestren cosas distintas: el aviso de
 * rotación por tope y el ticket con el alias. El selector de cuenta sólo
 * aparece con `puedeElegirCuenta` (el dashboard): en el panel del barbero,
 * hasta el 19/oct/2026, era la puerta por la que un barbero podía cobrar en
 * una cuenta que no era la que tocaba.
 */
export function TransferAccountPicker({
  accounts,
  selectedAccountId,
  onSelect,
  puedeElegirCuenta = false,
  rotatedFrom,
  allFull,
  amountText,
}: TransferAccountPickerProps) {
  const tono = useTonoDelTema()
  if (accounts.length === 0) return null

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) ?? accounts[0]

  return (
    <div className="space-y-3">
      {/* El sistema rotó solo: la(s) cuenta(s) anterior(es) llegaron a su tope del mes. */}
      {rotatedFrom.length > 0 && !allFull && (
        <div className={cn('flex items-start gap-2.5 rounded-2xl border p-3.5 text-[0.9375rem] leading-snug', claseAviso('celeste', tono))}>
          <RefreshCw className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            <span className="font-semibold">{rotatedFrom.map((a) => a.name).join(', ')}</span>{' '}
            {rotatedFrom.length === 1 ? 'llegó' : 'llegaron'} al tope del mes. Cobrá en la cuenta de abajo.
          </p>
        </div>
      )}

      {/* Ninguna cuenta con margen: se cobra igual, pero el admin tiene que saberlo. */}
      {allFull && (
        <div className={cn('flex items-start gap-2.5 rounded-2xl border p-3.5 text-[0.9375rem] leading-snug', claseAviso('ambar', tono))}>
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            Todas las cuentas de la sucursal llegaron al tope del mes. Podés cobrar igual acá, o pedir el
            pago en efectivo y avisarle al admin.
          </p>
        </div>
      )}

      {puedeElegirCuenta && onSelect && accounts.length > 1 && (
        <div>
          <p id="cobro-cuenta" className="mb-2 flex items-center gap-1.5 text-[0.9375rem] font-medium">
            <Wallet className="size-4 text-muted-foreground" aria-hidden />
            Cuenta de cobro
          </p>
          <Select value={selectedAccountId} onValueChange={onSelect}>
            <SelectTrigger className="h-12 w-full rounded-xl text-base" aria-labelledby="cobro-cuenta">
              <SelectValue placeholder="Seleccionar cuenta..." />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((acc) => {
                const remaining = accountRemaining(acc)
                return (
                  <SelectItem key={acc.id} value={acc.id}>
                    <span className="font-medium">{acc.name}</span>
                    <span className="ml-2 text-sm text-muted-foreground">
                      {acc.is_full
                        ? 'Llegó al tope'
                        : remaining !== null
                          ? `Le entran ${formatCurrency(remaining)}`
                          : 'Sin tope'}
                    </span>
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        </div>
      )}

      {!selectedAccount?.alias_or_cbu ? (
        <div className={cn('rounded-2xl border border-dashed p-4 text-center text-[0.9375rem]', claseAviso('ambar', tono))}>
          Esta cuenta no tiene alias configurado. Avisá a tu admin.
        </div>
      ) : (
        <AliasCopyHero
          alias={selectedAccount.alias_or_cbu}
          accountName={selectedAccount.name}
          amountText={amountText}
        />
      )}
    </div>
  )
}
