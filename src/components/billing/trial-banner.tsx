'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Sparkles, X, Clock } from 'lucide-react'
import { useEntitlements } from './entitlements-provider'
import { cn } from '@/lib/utils'

type BannerState =
  | { kind: 'trial-ending'; label: string; urgent: true; dismissable: false }
  | { kind: 'trial-soon'; label: string; urgent: true; dismissable: false }
  | { kind: 'trial-normal'; label: string; urgent: false; dismissable: true }
  | { kind: 'past-due'; label: string; urgent: true; dismissable: false }
  | { kind: 'cancelling'; label: string; urgent: false; dismissable: true }
  | null

/**
 * Banner superior visible cuando la org está en trial o en past_due.
 * Calculamos el estado en un efecto (con tick por minuto) para no llamar
 * Date.now() durante render y respetar las reglas de pureza de React 19.
 */
export function TrialBanner() {
  const ent = useEntitlements()
  const [dismissed, setDismissed] = useState(false)
  const [state, setState] = useState<BannerState>(null)

  useEffect(() => {
    function compute(): BannerState {
      if (!ent) return null
      if (ent.isGrandfathered) return null
      const now = Date.now()

      if (ent.status === 'trialing' && ent.trialEndsAt) {
        const ends = new Date(ent.trialEndsAt).getTime()
        const diffDays = Math.ceil((ends - now) / (1000 * 60 * 60 * 24))
        if (diffDays <= 0) return { kind: 'trial-ending', label: 'Tu trial termina hoy. Cargá tu medio de pago para no perder acceso.', urgent: true, dismissable: false }
        if (diffDays <= 3) return { kind: 'trial-soon', label: `Te quedan ${diffDays} días de trial. Cargá tu medio de pago para continuar.`, urgent: true, dismissable: false }
        return { kind: 'trial-normal', label: `Estás probando el plan ${ent.planName}. Quedan ${diffDays} días gratis.`, urgent: false, dismissable: true }
      }
      if (ent.status === 'past_due') {
        return { kind: 'past-due', label: 'Hay un pago pendiente. Actualizá tu método de pago antes de que perdamos acceso.', urgent: true, dismissable: false }
      }
      if (ent.status === 'cancelled' && ent.cancelAtPeriodEnd) {
        return { kind: 'cancelling', label: 'Tu suscripción se cancela al final del período actual. Podés reactivarla cuando quieras.', urgent: false, dismissable: true }
      }
      return null
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(compute())
    const id = setInterval(() => setState(compute()), 60_000)
    return () => clearInterval(id)
  }, [ent])

  if (!state || (dismissed && state.dismissable)) return null

  return (
    <div
      className={cn(
        'sticky top-0 z-40 flex items-center justify-center gap-3 px-4 py-2 text-sm',
        state.urgent
          ? 'bg-destructive text-destructive-foreground'
          : 'bg-primary/10 text-foreground',
      )}
    >
      {state.urgent ? <Clock className="size-4 shrink-0" /> : <Sparkles className="size-4 shrink-0" />}
      <span className="flex-1 text-center">{state.label}</span>
      <Link
        href="/dashboard/billing"
        className="rounded-md bg-background/10 px-3 py-1 font-medium hover:bg-background/20"
      >
        Gestionar plan
      </Link>
      {state.dismissable && (
        <button
          onClick={() => setDismissed(true)}
          className="rounded-md p-1 hover:bg-background/10"
          aria-label="Cerrar banner"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}
