'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { RefreshCw } from 'lucide-react'
import { requestPlanChange } from '@/lib/actions/billing'
import { Button } from '@/components/ui/button'

export function RenewButton({
  planId,
  billingCycle = 'monthly',
  label = 'Solicitar renovación',
}: {
  planId: string
  billingCycle?: 'monthly' | 'yearly'
  label?: string
}) {
  const [pending, start] = useTransition()

  const onClick = () => {
    start(async () => {
      const res = await requestPlanChange(planId, billingCycle, 'renewal')
      if ('error' in res) {
        toast.error(res.message)
        return
      }
      if ('mode' in res && res.mode === 'manual') {
        toast.success(res.message)
      }
    })
  }

  return (
    <Button onClick={onClick} disabled={pending} variant="default">
      <RefreshCw className="mr-2 size-4" />
      {pending ? 'Enviando…' : label}
    </Button>
  )
}
