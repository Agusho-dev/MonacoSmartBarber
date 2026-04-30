'use client'

import { useTransition, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { requestPlanChange } from '@/lib/actions/billing'

type PlanRow = {
  id: string
  name: string
  tagline: string | null
  price_ars_monthly: number
  price_ars_yearly: number
  features: Record<string, boolean>
  limits: Record<string, number>
  sort_order: number
}

export function PlanCompareGrid({
  plans,
  currentPlanId,
}: {
  plans: PlanRow[]
  currentPlanId: string
}) {
  const [isPending, startTransition] = useTransition()
  const [targetId, setTargetId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function formatArs(centavos: number): string {
    return `AR$ ${(centavos / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
  }

  const handleChange = (planId: string) => {
    setError(null)
    setTargetId(planId)
    startTransition(async () => {
      const res = await requestPlanChange(planId, 'monthly', 'plan_change')
      if ('error' in res) {
        setError(res.message)
        toast.error(res.message)
        setTargetId(null)
        return
      }
      if ('mode' in res && res.mode === 'gateway' && 'checkoutUrl' in res) {
        window.location.href = res.checkoutUrl
        return
      }
      if ('mode' in res && res.mode === 'manual') {
        toast.success(res.message)
        window.location.reload()
        return
      }
    })
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {plans.map((p) => {
        const isCurrent = p.id === currentPlanId
        const currentIdx = plans.findIndex(pp => pp.id === currentPlanId)
        const thisIdx = plans.findIndex(pp => pp.id === p.id)
        const direction = thisIdx > currentIdx ? 'up' : 'down'
        return (
          <div
            key={p.id}
            className={cn(
              'flex flex-col rounded-xl border p-4',
              isCurrent ? 'border-primary bg-primary/5' : 'border-border bg-card',
            )}
          >
            <div className="flex items-baseline justify-between">
              <h3 className="font-semibold">{p.name}</h3>
              {isCurrent && <Badge variant="secondary">Actual</Badge>}
            </div>
            <div className="mt-2 text-2xl font-bold">
              {p.price_ars_monthly === 0 ? 'Gratis' : formatArs(p.price_ars_monthly)}
              {p.price_ars_monthly > 0 && <span className="text-xs font-normal text-muted-foreground">/mes</span>}
            </div>
            {p.tagline && <p className="mt-1 text-xs text-muted-foreground">{p.tagline}</p>}
            <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
              <li className="flex items-center gap-1.5">
                <Check className="size-3 text-emerald-500" />
                {p.limits.branches === -1 ? 'Sucursales ilimitadas' : `${p.limits.branches} sucursal${p.limits.branches > 1 ? 'es' : ''}`}
              </li>
              <li className="flex items-center gap-1.5">
                <Check className="size-3 text-emerald-500" />
                {p.limits.staff === -1 ? 'Staff ilimitado' : `${p.limits.staff} empleados`}
              </li>
              <li className="flex items-center gap-1.5">
                <Check className="size-3 text-emerald-500" />
                {p.limits.clients === -1 ? 'Clientes ilimitados' : `${p.limits.clients.toLocaleString('es-AR')} clientes`}
              </li>
            </ul>

            {!isCurrent && (
              <Button
                size="sm"
                variant={direction === 'up' ? 'default' : 'outline'}
                onClick={() => handleChange(p.id)}
                disabled={isPending}
                className="mt-4"
              >
                {isPending && targetId === p.id ? (
                  <><Loader2 className="mr-1 size-3 animate-spin" /> Procesando...</>
                ) : direction === 'up' ? (
                  'Solicitar este plan'
                ) : (
                  'Cambiar a este plan'
                )}
              </Button>
            )}
          </div>
        )
      })}
      {error && (
        <div className="col-span-full rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
    </div>
  )
}
