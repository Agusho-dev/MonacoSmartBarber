'use client'

import { useState, useTransition } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { formatCurrency } from '@/lib/format'
import { markPeriodAsPaid } from '@/lib/actions/fixed-expenses'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface PaymentAccountOption {
    id: string
    name: string
}

interface PayPeriodFormProps {
    periodId: string
    snapshotName: string
    todayLocal: string                              // YYYY-MM-DD
    paymentAccounts: PaymentAccountOption[]
    defaultAmount?: number | null                   // monto de referencia del catálogo
    onSuccess?: () => void
}

export function PayPeriodForm({
    periodId,
    snapshotName,
    todayLocal,
    paymentAccounts,
    defaultAmount,
    onSuccess,
}: PayPeriodFormProps) {
    const [amount, setAmount] = useState<string>(
        defaultAmount && defaultAmount > 0 ? String(defaultAmount) : ''
    )
    const [paidAt, setPaidAt] = useState(todayLocal)
    const [accountId, setAccountId] = useState<string>('')
    const [notes, setNotes] = useState('')
    const [registerAsExpense, setRegisterAsExpense] = useState(true)
    const [isPending, startTransition] = useTransition()

    const amountNumber = Number(amount.replace(',', '.'))
    const isValid = Number.isFinite(amountNumber) && amountNumber > 0 && paidAt.length === 10

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!isValid) {
            toast.error('Ingresá un monto válido')
            return
        }

        startTransition(async () => {
            const result = await markPeriodAsPaid(periodId, {
                paid_amount: amountNumber,
                paid_at: paidAt,
                payment_account_id: accountId || null,
                payment_notes: notes || null,
                create_expense_ticket: registerAsExpense,
            })
            if (result.error) {
                toast.error(result.error)
                return
            }
            toast.success(`${snapshotName}: pago registrado`, {
                description: formatCurrency(amountNumber),
                duration: 2400,
            })
            if (typeof navigator !== 'undefined' && navigator.vibrate) {
                navigator.vibrate([20, 40, 20])
            }
            onSuccess?.()
        })
    }

    return (
        <form onSubmit={handleSubmit} className="grid gap-3 rounded-lg border bg-muted/30 p-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Monto — principal, destacado */}
                <div className="grid gap-1.5 sm:col-span-2">
                    <Label htmlFor={`amount-${periodId}`} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Monto pagado
                    </Label>
                    <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-base font-bold text-muted-foreground">
                            $
                        </span>
                        <Input
                            id={`amount-${periodId}`}
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            min="0"
                            placeholder="0"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            className="pl-7 text-lg font-bold tabular-nums h-11"
                            autoFocus
                        />
                        {amountNumber > 0 && (
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground tabular-nums">
                                {formatCurrency(amountNumber)}
                            </span>
                        )}
                    </div>
                </div>

                <div className="grid gap-1.5">
                    <Label htmlFor={`paid-at-${periodId}`} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Fecha de pago
                    </Label>
                    <Input
                        id={`paid-at-${periodId}`}
                        type="date"
                        value={paidAt}
                        onChange={(e) => setPaidAt(e.target.value)}
                        max={todayLocal}
                        className="h-10"
                    />
                </div>

                <div className="grid gap-1.5">
                    <Label htmlFor={`account-${periodId}`} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Pagado desde
                    </Label>
                    <Select value={accountId} onValueChange={setAccountId}>
                        <SelectTrigger id={`account-${periodId}`} className="h-10">
                            <SelectValue placeholder="Seleccionar cuenta" />
                        </SelectTrigger>
                        <SelectContent>
                            {paymentAccounts.map((a) => (
                                <SelectItem key={a.id} value={a.id}>
                                    {a.name}
                                </SelectItem>
                            ))}
                            {paymentAccounts.length === 0 && (
                                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                                    Sin cuentas configuradas
                                </div>
                            )}
                        </SelectContent>
                    </Select>
                </div>

                <div className="grid gap-1.5 sm:col-span-2">
                    <Label htmlFor={`notes-${periodId}`} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Notas (opcional)
                    </Label>
                    <Input
                        id={`notes-${periodId}`}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Ej: Pagado con recargo por mora"
                        className="h-10"
                    />
                </div>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-md bg-background/60 border px-3 py-2">
                <div className="min-w-0">
                    <div className="text-xs font-semibold">Registrar en Egresos</div>
                    <div className="text-[11px] text-muted-foreground">
                        Aparece en el desglose de gastos del mes
                    </div>
                </div>
                <Switch
                    checked={registerAsExpense}
                    onCheckedChange={setRegisterAsExpense}
                    aria-label="Registrar como egreso"
                />
            </div>

            <Button
                type="submit"
                disabled={!isValid || isPending}
                size="lg"
                className={cn(
                    'h-12 font-bold',
                    isValid && !isPending && 'bg-emerald-600 hover:bg-emerald-700 text-white',
                )}
            >
                {isPending ? (
                    <>
                        <Loader2 className="mr-2 size-4 animate-spin" />
                        Registrando...
                    </>
                ) : (
                    <>
                        <Check className="mr-2 size-4" />
                        Marcar como pagado
                    </>
                )}
            </Button>
        </form>
    )
}
