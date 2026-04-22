'use client'

import { useTransition, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { cancelSubscriptionAtPeriodEnd, reactivateSubscription } from '@/lib/actions/billing'

export function CancelReactivateButtons({
  status, cancelAtPeriodEnd,
}: {
  status: string
  cancelAtPeriodEnd: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)

  if (status === 'cancelled' || cancelAtPeriodEnd) {
    return (
      <Button
        variant="default"
        onClick={() => startTransition(async () => {
          await reactivateSubscription()
          window.location.reload()
        })}
        disabled={isPending}
      >
        {isPending ? 'Reactivando...' : 'Reactivar suscripción'}
      </Button>
    )
  }

  if (status === 'active' || status === 'trialing') {
    return (
      <>
        <Button variant="ghost" onClick={() => setOpen(true)}>
          Cancelar plan
        </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>¿Cancelar la suscripción?</DialogTitle>
              <DialogDescription>
                Vas a perder acceso a las funciones Pro al finalizar el período actual.
                Podés reactivar cuando quieras antes de esa fecha. Tus datos NO se borran.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Volver</Button>
              <Button
                variant="destructive"
                disabled={isPending}
                onClick={() => startTransition(async () => {
                  await cancelSubscriptionAtPeriodEnd()
                  setOpen(false)
                  window.location.reload()
                })}
              >
                {isPending ? 'Cancelando...' : 'Sí, cancelar al final del período'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    )
  }

  return null
}
