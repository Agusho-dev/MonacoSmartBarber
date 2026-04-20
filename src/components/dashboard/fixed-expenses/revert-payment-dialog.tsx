'use client'

import { useTransition } from 'react'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { revertPeriodPayment } from '@/lib/actions/fixed-expenses'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'

interface RevertPaymentDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    periodId: string | null
    snapshotName: string
    hasExpenseTicket: boolean
}

export function RevertPaymentDialog({
    open,
    onOpenChange,
    periodId,
    snapshotName,
    hasExpenseTicket,
}: RevertPaymentDialogProps) {
    const [isPending, startTransition] = useTransition()

    const handleRevert = () => {
        if (!periodId) return
        startTransition(async () => {
            const result = await revertPeriodPayment(periodId)
            if (result.error) {
                toast.error(result.error)
                return
            }
            toast.success('Pago revertido')
            onOpenChange(false)
        })
    }

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>¿Revertir el pago de {snapshotName}?</AlertDialogTitle>
                    <AlertDialogDescription>
                        {hasExpenseTicket
                            ? 'Se borrará el registro asociado en Egresos y el gasto volverá a "pendiente". Esta acción no se puede deshacer.'
                            : 'El gasto volverá al estado "pendiente". Esta acción no se puede deshacer.'}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={(e) => {
                            e.preventDefault()
                            handleRevert()
                        }}
                        disabled={isPending}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                        {isPending ? (
                            <>
                                <Loader2 className="mr-2 size-4 animate-spin" />
                                Revirtiendo...
                            </>
                        ) : (
                            'Sí, revertir'
                        )}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
