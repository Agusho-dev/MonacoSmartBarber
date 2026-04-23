'use client'

import { useState } from 'react'
import { ExternalLink, Undo2, XCircle, Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { formatCurrency, formatDate } from '@/lib/format'
import type { FixedExpensePeriod } from '@/lib/types/database'
import { CopyableChip } from './copyable-chip'
import { DueDateBadge } from './due-date-badge'
import { PayPeriodForm } from './pay-period-form'
import { RevertPaymentDialog } from './revert-payment-dialog'

interface PaymentAccountOption {
    id: string
    name: string
}

interface PeriodCardProps {
    period: FixedExpensePeriod
    paymentAccounts: PaymentAccountOption[]
    todayLocal: string                  // YYYY-MM-DD
    budgetAmount?: number | null        // amount del catálogo (referencia)
    branchName?: string | null
    defaultOpen?: boolean
}

export function PeriodCard({
    period,
    paymentAccounts,
    todayLocal,
    budgetAmount,
    branchName,
    defaultOpen,
}: PeriodCardProps) {
    const [showPayForm, setShowPayForm] = useState(
        defaultOpen && period.status === 'pending'
    )
    const [revertOpen, setRevertOpen] = useState(false)

    const copyables = [
        period.snapshot_copyable_1_label && period.snapshot_copyable_1_value
            ? { label: period.snapshot_copyable_1_label, value: period.snapshot_copyable_1_value }
            : null,
        period.snapshot_copyable_2_label && period.snapshot_copyable_2_value
            ? { label: period.snapshot_copyable_2_label, value: period.snapshot_copyable_2_value }
            : null,
    ].filter(Boolean) as { label: string; value: string }[]

    const isPaid = period.status === 'paid'
    const isCancelled = period.status === 'cancelled'

    return (
        <div
            className={cn(
                'rounded-xl border bg-card transition-all',
                isPaid && 'border-emerald-500/30 bg-emerald-500/[0.03]',
                isCancelled && 'opacity-60',
                !isPaid && !isCancelled && 'hover:shadow-md',
            )}
        >
            {/* ── Header ── */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 p-4 pb-3">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-base font-bold tracking-tight truncate">
                            {period.snapshot_name}
                        </h3>
                        {isCancelled && <Badge variant="outline" className="text-[10px]">Cancelado</Badge>}
                    </div>
                    <div className="mt-1 flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                        {period.snapshot_category && (
                            <Badge variant="outline" className="text-[10px] font-normal">
                                {period.snapshot_category}
                            </Badge>
                        )}
                        {branchName ? (
                            <span className="flex items-center gap-1">
                                <Building2 className="size-3" />
                                {branchName}
                            </span>
                        ) : (
                            <span className="flex items-center gap-1">
                                <Building2 className="size-3" />
                                Organización
                            </span>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    <DueDateBadge
                        dueDate={period.due_date}
                        today={todayLocal}
                        isPaid={isPaid}
                    />
                </div>
            </div>

            {/* ── Acciones rápidas: link + copiables ── */}
            {(period.snapshot_payment_url || copyables.length > 0) && !isCancelled && (
                <div className="px-4 pb-3 grid gap-2">
                    {period.snapshot_payment_url && (
                        <a
                            href={period.snapshot_payment_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={cn(
                                'group flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 transition-all',
                                'bg-primary/10 hover:bg-primary/15 border border-primary/20 hover:border-primary/40',
                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            )}
                        >
                            <div className="flex items-center gap-2 min-w-0">
                                <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/20">
                                    <ExternalLink className="size-4 text-primary" />
                                </div>
                                <div className="text-xs font-semibold uppercase tracking-wider text-primary">
                                    Pagar online
                                </div>
                            </div>
                            <ExternalLink className="size-3.5 text-primary/60 group-hover:text-primary transition-transform group-hover:translate-x-0.5" />
                        </a>
                    )}

                    {copyables.length > 0 && (
                        <div className={cn(
                            'grid gap-2',
                            copyables.length === 2 && 'sm:grid-cols-2',
                        )}>
                            {copyables.map((c, i) => (
                                <CopyableChip key={i} label={c.label} value={c.value} />
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* ── Estado: PAGADO ── */}
            {isPaid && (
                <div className="mx-4 mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                    <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                            <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                                Pagado el {period.paid_at ? formatDate(period.paid_at) : '—'}
                            </div>
                            <div className="mt-0.5 text-xl font-bold tabular-nums text-foreground">
                                {formatCurrency(Number(period.paid_amount ?? 0))}
                            </div>
                            {period.payment_account?.name && (
                                <div className="text-[11px] text-muted-foreground mt-0.5">
                                    desde {period.payment_account.name}
                                </div>
                            )}
                            {period.payment_notes && (
                                <div className="text-[11px] text-muted-foreground mt-1 italic">
                                    &ldquo;{period.payment_notes}&rdquo;
                                </div>
                            )}
                        </div>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setRevertOpen(true)}
                            className="text-xs text-muted-foreground hover:text-destructive shrink-0"
                        >
                            <Undo2 className="mr-1.5 size-3.5" />
                            Revertir
                        </Button>
                    </div>
                </div>
            )}

            {/* ── Estado: PENDIENTE + form inline ── */}
            {!isPaid && !isCancelled && (
                <div className="px-4 pb-4 space-y-2">
                    {!showPayForm ? (
                        <Button
                            type="button"
                            onClick={() => setShowPayForm(true)}
                            className="w-full h-11 font-bold"
                            size="lg"
                        >
                            Registrar pago
                        </Button>
                    ) : (
                        <div className="space-y-2">
                            <PayPeriodForm
                                periodId={period.id}
                                snapshotName={period.snapshot_name}
                                todayLocal={todayLocal}
                                paymentAccounts={paymentAccounts}
                                defaultAmount={budgetAmount}
                                onSuccess={() => setShowPayForm(false)}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPayForm(false)}
                                className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-1 underline-offset-2 hover:underline"
                            >
                                Cancelar
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* ── Estado: CANCELADO ── */}
            {isCancelled && (
                <div className="mx-4 mb-4 rounded-lg border bg-muted/30 p-3 text-center">
                    <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                        <XCircle className="size-3.5" />
                        {period.payment_notes || 'Cancelado para este mes'}
                    </div>
                </div>
            )}

            <RevertPaymentDialog
                open={revertOpen}
                onOpenChange={setRevertOpen}
                periodId={period.id}
                snapshotName={period.snapshot_name}
                hasExpenseTicket={!!period.expense_ticket_id}
            />
        </div>
    )
}
