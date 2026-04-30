'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { cancelMyPendingRequest } from '@/lib/actions/billing'

export function CancelRequestButton() {
  const [pending, start] = useTransition()

  const onClick = () => {
    if (!confirm('¿Cancelar la solicitud pendiente?')) return
    start(async () => {
      const res = await cancelMyPendingRequest()
      if ('error' in res) {
        toast.error(res.message)
        return
      }
      toast.success(`Solicitud cancelada (${res.cancelled})`)
    })
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="text-xs text-zinc-400 underline hover:text-zinc-200 disabled:opacity-50"
    >
      {pending ? 'Cancelando…' : 'Cancelar solicitud'}
    </button>
  )
}
