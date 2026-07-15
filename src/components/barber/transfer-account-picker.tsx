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
import { AliasCopyHero } from './alias-copy-hero'
import { accountRemaining, type TransferAccountState } from '@/lib/payment-accounts'

interface TransferAccountPickerProps {
  accounts: TransferAccountState[]
  selectedAccountId: string
  onSelect: (id: string) => void
  /** Cuentas que el sistema salteó por estar llenas (aviso de que rotó). */
  rotatedFrom: TransferAccountState[]
  /** Todas las cuentas activas llegaron al tope: se cobra igual, pero hay que avisar. */
  allFull: boolean
  /** Monto a mostrar en el hero del alias (total a transferir, propina incluida). */
  amountText: string
  /** Si false, no dibuja el hero del alias (la venta directa no lo usa). */
  showAliasHero?: boolean
}

/**
 * Selector de cuenta de cobro para transferencias, compartido por el cobro de un
 * servicio (complete-service-dialog) y la venta directa (direct-sale-dialog), para
 * que las dos superficies nunca vuelvan a mostrar cosas distintas. Incluye el aviso
 * de rotación por tope y, opcionalmente, el hero gigante con el alias.
 */
export function TransferAccountPicker({
  accounts,
  selectedAccountId,
  onSelect,
  rotatedFrom,
  allFull,
  amountText,
  showAliasHero = true,
}: TransferAccountPickerProps) {
  if (accounts.length === 0) return null

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) ?? accounts[0]

  return (
    <div className="space-y-3">
      {/* El sistema rotó solo: la(s) cuenta(s) anterior(es) llegaron a su tope del mes. */}
      {rotatedFrom.length > 0 && !allFull && (
        <div className="flex items-start gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sky-700 dark:text-sky-300">
          <RefreshCw className="size-4 shrink-0 mt-0.5" />
          <p>
            <span className="font-semibold">{rotatedFrom.map((a) => a.name).join(', ')}</span>{' '}
            {rotatedFrom.length === 1 ? 'llegó' : 'llegaron'} al tope del mes. Cobrá en la cuenta de abajo.
          </p>
        </div>
      )}

      {/* Ninguna cuenta con margen: se cobra igual, pero el admin tiene que saberlo. */}
      {allFull && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <p>
            Todas las cuentas de la sucursal llegaron al tope del mes. Podés cobrar igual acá, o pedir el
            pago en efectivo y avisarle al admin.
          </p>
        </div>
      )}

      {accounts.length > 1 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
            <Wallet className="size-3.5" />
            Cuenta de cobro
          </p>
          <Select value={selectedAccountId} onValueChange={onSelect}>
            <SelectTrigger className="h-11 w-full text-sm">
              <SelectValue placeholder="Seleccionar cuenta..." />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((acc) => {
                const remaining = accountRemaining(acc)
                return (
                  <SelectItem key={acc.id} value={acc.id}>
                    <span className="font-medium">{acc.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
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

      {showAliasHero &&
        (!selectedAccount?.alias_or_cbu ? (
          <div className="rounded-2xl border border-dashed border-amber-500/40 bg-amber-500/5 p-4 text-center text-sm text-amber-700 dark:text-amber-400">
            Esta cuenta no tiene alias configurado. Avisá a tu admin.
          </div>
        ) : (
          <AliasCopyHero
            alias={selectedAccount.alias_or_cbu}
            accountName={selectedAccount.name}
            amountText={amountText}
          />
        ))}
    </div>
  )
}
